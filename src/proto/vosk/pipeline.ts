import { MicCapture, VoiceActivity, type AudioChunk } from "./mic.ts";
import { VoskEngine, type VoskResult } from "./engine.ts";
import { GAP_MS } from "./flow.ts";

type ResultListener = (r: VoskResult) => void;
type PartialListener = (text: string, at: number) => void;
export type Owner = "ptt" | "handsfree";

/**
 * Mic → voice meter → (gate) → Vosk. One run owns the pipeline at a time, so push-to-talk
 * and hands-free can't close each other's gate. The gate lets the owner stop feeding audio
 * without closing the mic, e.g. while text-to-speech plays.
 */
export class Pipeline {
  readonly vad = new VoiceActivity();
  readonly engine = new VoskEngine();
  readonly mic: MicCapture;
  onLevel: (level: number, voiced: boolean) => void = () => {};
  /** performance.now() of the last mic chunk, gated or not: shows whether audio still flows. */
  lastChunkAt = 0;
  /** Called when mic chunks resume after a gap longer than GAP_MS (from, to: chunk times). */
  onGap: (fromAt: number, toAt: number) => void = () => {};
  private owner: Owner | null = null;
  private gate = false;
  private resultListener: ResultListener | null = null;
  private partialListener: PartialListener | null = null;

  constructor(readonly onEvent: (message: string) => void) {
    this.mic = new MicCapture(
      (chunk) => this.handleChunk(chunk),
      (message) => this.onEvent(message),
    );
    this.engine.onResult = (r) => this.resultListener?.(r);
    this.engine.onPartial = (t, at) => this.partialListener?.(t, at);
    this.engine.onError = (message) => this.onEvent(message);
  }

  get canRecognise(): boolean {
    return this.engine.ready && this.mic.sampleRate > 0;
  }

  get currentOwner(): Owner | null {
    return this.owner;
  }

  /** Takes the pipeline for a run. Returns false if another run holds it. */
  claim(
    owner: Owner,
    onResult: ResultListener,
    onPartial: PartialListener,
  ): boolean {
    if (this.owner !== null && this.owner !== owner) return false;
    this.owner = owner;
    this.resultListener = onResult;
    this.partialListener = onPartial;
    return true;
  }

  release(owner: Owner): void {
    if (this.owner !== owner) return;
    this.owner = null;
    this.gate = false;
    this.resultListener = null;
    this.partialListener = null;
  }

  setGate(owner: Owner, open: boolean): void {
    if (this.owner === owner) this.gate = open;
  }

  /** Dev/test hook: route results without claiming a run. */
  listen(
    onResult: ResultListener | null,
    onPartial: PartialListener | null,
  ): void {
    this.resultListener = onResult;
    this.partialListener = onPartial;
  }

  get gateOpen(): boolean {
    return this.gate;
  }

  private handleChunk(chunk: AudioChunk): void {
    const previous = this.lastChunkAt;
    this.lastChunkAt = chunk.at;
    if (previous > 0 && chunk.at - previous > GAP_MS)
      this.onGap(previous, chunk.at);
    const voiced = this.vad.update(chunk);
    this.onLevel(this.vad.level, voiced);
    if (this.gate && this.engine.ready)
      this.engine.feed(chunk.samples, this.mic.sampleRate, chunk.at);
  }
}
