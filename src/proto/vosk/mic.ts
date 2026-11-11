export interface AudioChunk {
  readonly samples: Float32Array;
  readonly rms: number;
  /** performance.now() when the chunk reached the main thread */
  readonly at: number;
}

export interface MicState {
  readonly context: AudioContextState | "interrupted" | "none";
  readonly track: MediaStreamTrackState | "none";
  readonly muted: boolean;
}

const CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};
// Served from public/ as a real file: Vite would otherwise inline it as a data: URL,
// which Safari's audioWorklet.addModule() may refuse.
const WORKLET_URL = `${import.meta.env.BASE_URL}worklets/capture-worklet.js`;
const RESUME_TIMEOUT_MS = 1500;
const OPEN_TIMEOUT_MS = 10_000;

export const isHealthy = (s: MicState): boolean =>
  s.context === "running" && s.track === "live" && !s.muted;

/**
 * Microphone capture: getUserMedia → AudioWorklet (ScriptProcessor fallback) → chunks.
 * Call primeContext() synchronously inside the user's tap, before any await: iOS only
 * lets an AudioContext start from a gesture.
 */
export class MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioNode | null = null;
  private sink: GainNode | null = null;
  private opening: Promise<{ grantMs: number }> | null = null;

  constructor(
    private readonly onChunk: (chunk: AudioChunk) => void,
    private readonly onEvent: (message: string) => void,
  ) {}

  get sampleRate(): number {
    return this.context?.sampleRate ?? 0;
  }

  get usingWorklet(): boolean {
    return (
      typeof AudioWorkletNode !== "undefined" &&
      this.node instanceof AudioWorkletNode
    );
  }

  get state(): MicState {
    const track = this.stream?.getAudioTracks()[0];
    return {
      context:
        (this.context?.state as MicState["context"] | undefined) ?? "none",
      track: track?.readyState ?? "none",
      muted: track?.muted ?? false,
    };
  }

  /** Creates the AudioContext and starts resuming it. Must run synchronously in a tap handler. */
  primeContext(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.context.onstatechange = () =>
        this.onEvent(`audio context → ${this.context?.state}`);
    }
    void this.context.resume();
  }

  /** Opens (or re-opens) the mic. Concurrent calls share one attempt. */
  open(): Promise<{ grantMs: number }> {
    this.opening ??= Promise.race([
      this.doOpen(),
      new Promise<never>((_, reject) =>
        window.setTimeout(
          () => reject(new Error("The microphone didn't open within 10 s.")),
          OPEN_TIMEOUT_MS,
        ),
      ),
    ]).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  /** Resumes the context; resolves false if it is still not running after a short wait. */
  async resume(): Promise<boolean> {
    if (!this.context) return false;
    await Promise.race([
      this.context.resume(),
      new Promise((r) => window.setTimeout(r, RESUME_TIMEOUT_MS)),
    ]);
    return this.context.state === "running";
  }

  close(): void {
    this.release();
    void this.context?.close();
    this.context = null;
  }

  private async doOpen(): Promise<{ grantMs: number }> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser has no microphone API (getUserMedia).");
    }
    this.primeContext();
    await this.resume();
    this.release();
    const t0 = performance.now();
    this.stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    const grantMs = Math.round(performance.now() - t0);
    this.watchTrack();
    await this.connect();
    return { grantMs };
  }

  /** Disconnects the graph and stops the current mic tracks (before a re-open or on close). */
  private release(): void {
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    if (this.node instanceof ScriptProcessorNode)
      this.node.onaudioprocess = null;
    if (
      typeof AudioWorkletNode !== "undefined" &&
      this.node instanceof AudioWorkletNode
    )
      this.node.port.onmessage = null;
    this.source = null;
    this.node = null;
    this.sink = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private watchTrack(): void {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return;
    track.onended = () => this.onEvent("mic track ended");
    track.onmute = () => this.onEvent("mic track muted");
    track.onunmute = () => this.onEvent("mic track unmuted");
  }

  private async connect(): Promise<void> {
    const ctx = this.context;
    if (!ctx || !this.stream) return;
    this.source = ctx.createMediaStreamSource(this.stream);
    // A silent sink keeps the graph pulled without echoing the mic to the speaker.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);
    this.node =
      (await this.createWorkletNode(ctx)) ?? this.createScriptProcessor(ctx);
    this.source.connect(this.node);
    this.node.connect(this.sink);
  }

  private async createWorkletNode(
    ctx: AudioContext,
  ): Promise<AudioWorkletNode | null> {
    if (typeof AudioWorkletNode === "undefined" || !ctx.audioWorklet)
      return null;
    try {
      await ctx.audioWorklet.addModule(WORKLET_URL);
      const node = new AudioWorkletNode(ctx, "capture-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      node.port.onmessage = (
        e: MessageEvent<{ samples: Float32Array; rms: number }>,
      ) =>
        this.onChunk({
          samples: e.data.samples,
          rms: e.data.rms,
          at: performance.now(),
        });
      return node;
    } catch (e) {
      this.onEvent(
        `AudioWorklet failed (${e instanceof Error ? e.message : String(e)}): using ScriptProcessor`,
      );
      return null;
    }
  }

  private createScriptProcessor(ctx: AudioContext): ScriptProcessorNode {
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => {
      const samples = new Float32Array(e.inputBuffer.getChannelData(0));
      let sum = 0;
      for (const s of samples) sum += s * s;
      this.onChunk({
        samples,
        rms: Math.sqrt(sum / samples.length),
        at: performance.now(),
      });
    };
    return sp;
  }
}

/** Adaptive voice-activity detector on chunk RMS: threshold = 3× the running noise floor. */
export class VoiceActivity {
  private noiseFloor = 0.004;
  lastVoiceAt = 0;
  level = 0;

  update(chunk: AudioChunk): boolean {
    const threshold = Math.max(0.012, this.noiseFloor * 3);
    const voiced = chunk.rms > threshold;
    if (voiced) this.lastVoiceAt = chunk.at;
    else this.noiseFloor = this.noiseFloor * 0.95 + chunk.rms * 0.05;
    this.level = Math.min(1, chunk.rms / 0.2);
    return voiced;
  }
}
