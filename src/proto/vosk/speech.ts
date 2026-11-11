/**
 * Speech output for the hands-free run (read-back and the speech tests). With
 * gated = true the recogniser is muted while the app speaks and for a short tail
 * after, so the app never hears itself. speechSynthesis' end event is unreliable
 * on iOS, so a safety timer unmutes the mic if it never arrives.
 */

export type SpeechEnd = "end" | "error" | "safety";

export interface SpeechHooks {
  readonly mute: () => void;
  readonly unmute: () => void;
  readonly log: (message: string) => void;
  readonly isActive: () => boolean;
}

const TAIL_MS = 300;
const SAFETY_MS = 8000;

export const canSpeak = (): boolean => "speechSynthesis" in window;

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

  constructor(private readonly hooks: SpeechHooks) {}

  get speaking(): boolean {
    return this.busy;
  }

  /** onDone runs once listening is back (after the tail when gated). */
  speak(text: string, gated: boolean, onDone: (how: SpeechEnd) => void): void {
    if (!canSpeak()) return;
    this.busy = true;
    speechSynthesis.cancel(); // drop anything queued (e.g. the silent priming utterance)
    if (gated) this.hooks.mute();
    let finished = false;
    const finish = (how: SpeechEnd) => {
      if (finished || !this.hooks.isActive()) return;
      finished = true;
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
          if (gated) this.hooks.unmute();
          onDone(how);
        },
        gated ? TAIL_MS : 0,
      );
    };
    this.later(() => finish("safety"), SAFETY_MS);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    u.onend = () => finish("end");
    u.onerror = (e) => {
      this.hooks.log(`speech output error: ${e.error}`);
      finish("error");
    };
    speechSynthesis.speak(u);
  }

  cancel(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    if (canSpeak()) speechSynthesis.cancel();
    this.busy = false;
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }
}
