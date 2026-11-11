/**
 * Speech output for the hands-free run (read-back, tones and the speech tests). With
 * gated = true the recogniser is muted while the app makes a sound and for a short tail
 * after, so the app never hears itself. speechSynthesis' end event is unreliable on
 * iOS, so a safety timer unmutes the mic if it never arrives.
 *
 * The voice is always English (en-GB first), whatever the phone's language: a pt-BR
 * phone would otherwise read "triple twenty" with a Portuguese voice.
 */

export type SpeechEnd = "end" | "error" | "safety";

export interface SpeechHooks {
  readonly mute: () => void;
  /** endedAt: performance.now() when the sound itself ended (before the tail). */
  readonly unmute: (endedAt: number) => void;
  readonly log: (message: string) => void;
  readonly isActive: () => boolean;
}

export const TAIL_MS = 300;
const SAFETY_MS = 8000;
const TONE_S = 0.12;
const TONE_GAP_S = 0.06;

export const canSpeak = (): boolean => "speechSynthesis" in window;

/** The English voice to use: en-GB, else any English voice, else the browser's pick for lang en-GB. */
export function englishVoice(
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const lang = (v: SpeechSynthesisVoice) =>
    v.lang.toLowerCase().replace("_", "-");
  return (
    voices.find((v) => lang(v) === "en-gb") ??
    voices.find((v) => lang(v).startsWith("en")) ??
    null
  );
}

/** Call synchronously inside a tap: iOS only lets speechSynthesis start from a gesture. */
export function primeSpeech(): void {
  if (!canSpeak()) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}

export class SpeechOut {
  private timers: number[] = [];
  private busy = false;
  private tones: AudioContext | null = null;
  private voiceLogged = false;

  constructor(private readonly hooks: SpeechHooks) {}

  get speaking(): boolean {
    return this.busy;
  }

  /** Call inside a tap: iOS only starts audio from a gesture. */
  primeTones(): void {
    try {
      this.tones ??= new AudioContext();
      void this.tones.resume();
    } catch {
      this.tones = null;
    }
  }

  /** onDone runs once listening is back (after the tail when gated). */
  speak(text: string, gated: boolean, onDone: (how: SpeechEnd) => void): void {
    if (!canSpeak()) return;
    const finish = this.begin(gated, onDone);
    speechSynthesis.cancel(); // drop anything queued (e.g. the silent priming utterance)
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    const voice = englishVoice(speechSynthesis.getVoices());
    if (voice) u.voice = voice;
    if (!this.voiceLogged) {
      this.voiceLogged = true;
      this.hooks.log(
        `read-back voice: ${voice ? `${voice.name} (${voice.lang})` : "browser default for en-GB"}`,
      );
    }
    u.onend = () => finish("end");
    u.onerror = (e) => {
      this.hooks.log(`speech output error: ${e.error}`);
      finish("error");
    };
    speechSynthesis.speak(u);
  }

  /** Short tones (Hz each), gated like speech. Falls back to finishing at once without audio. */
  tone(
    pattern: readonly number[],
    gated: boolean,
    onDone: (how: SpeechEnd) => void,
  ): void {
    const ctx = this.tones;
    const finish = this.begin(gated, onDone);
    if (!ctx || ctx.state !== "running") {
      this.hooks.log("tone skipped: no running audio output");
      finish("error");
      return;
    }
    const start = ctx.currentTime + 0.02;
    pattern.forEach((hz, i) => {
      const at = start + i * (TONE_S + TONE_GAP_S);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + TONE_S);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + TONE_S + 0.01);
    });
    const ms = (pattern.length * (TONE_S + TONE_GAP_S) + 0.05) * 1000;
    this.later(() => finish("end"), ms);
  }

  cancel(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    if (canSpeak()) speechSynthesis.cancel();
    this.busy = false;
  }

  /** Mutes (when gated) and returns the one-shot finisher that unmutes after the tail. */
  private begin(
    gated: boolean,
    onDone: (how: SpeechEnd) => void,
  ): (how: SpeechEnd) => void {
    this.busy = true;
    if (gated) this.hooks.mute();
    let finished = false;
    const finish = (how: SpeechEnd) => {
      if (finished || !this.hooks.isActive()) return;
      finished = true;
      const endedAt = performance.now();
      if (how === "safety") {
        speechSynthesis.cancel();
        this.hooks.log(
          "speech output never reported its end: the safety timer unmuted the mic",
        );
      }
      this.later(
        () => {
          if (!this.hooks.isActive()) return;
          this.busy = false;
          if (gated) this.hooks.unmute(endedAt);
          onDone(how);
        },
        gated ? TAIL_MS : 0,
      );
    };
    this.later(() => finish("safety"), SAFETY_MS);
    return finish;
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }
}
