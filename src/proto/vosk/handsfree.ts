import type { Pipeline } from "./pipeline.ts";
import type { VoskResult } from "./engine.ts";
import { isStandalone } from "./env.ts";
import { isHealthy } from "./mic.ts";
import { HANDSFREE_PHRASES } from "./phrases.ts";
import { compare, isIgnorable, summarize } from "./score.ts";
import { SYNONYMS } from "./synonyms.ts";
import type {
  ChatterRun,
  HandsFreeGroup,
  HandsFreeSession,
  TtsCheck,
} from "./store.ts";
import { $, errorMessage, fmtClock, fmtMs, setText, show } from "./ui.ts";

const PAUSE_MS = 800; // partial unchanged this long → finalise the phrase ourselves
const GROUP_GAP_MS = 2000; // results closer than this belong to one spoken turn
const TTS_TAIL_MS = 300; // keep the gate closed this long after speech ends
const TTS_WATCH_MS = 2500;
const TTS_SAFETY_MS = 8000;
const CHATTER_S = 60;
const RECOVER_EVERY_MS = 3000;
const SHOW_RESUME_AFTER_MS = 3000;

interface Segment {
  readonly text: string;
  readonly at: number;
  /** end of speech → this result, snapshotted on arrival */
  readonly latencyMs: number | null;
}

interface Chatter {
  readonly until: number;
  readonly ignoredAtStart: number;
  triggers: readonly string[];
}

/** Hands-free run: mic open all session, phrases finalised on pauses, no button per turn. */
export class HandsFreeRun {
  private active = false;
  private startedAt = 0;
  private startedIso = "";
  private results = 0;
  private ignored = 0;
  private finalizedByPause = 0;
  private events: readonly string[] = [];
  private recoveries = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private wakeLockState = "not requested";
  private groups: readonly HandsFreeGroup[] = [];
  private current: readonly Segment[] = [];
  private index = 0;
  private lastPartial = "";
  private lastPartialAt = 0;
  private lastRecoverAt = 0;
  private unhealthySince: number | null = null;
  private recovering: Promise<void> | null = null;
  private chatter: Chatter | null = null;
  private chatters: readonly ChatterRun[] = [];
  private tts: readonly TtsCheck[] = [];
  private ttsBusy = false;
  private ttsGated = true;
  private ttsWatchUntil = 0;
  private ttsHeard: readonly string[] = [];
  private ttsTimers: number[] = [];
  private monitor: number | undefined;
  private readonly onVisibility = () => void this.handleVisibility();

  constructor(
    private readonly p: Pipeline,
    private readonly record: (session: HandsFreeSession) => void,
  ) {
    $("hf-start").addEventListener("click", () => void this.start());
    $("hf-stop").addEventListener("click", () => this.stop());
    $("hf-tts").addEventListener("click", () => this.ttsTest(true));
    $("hf-tts-open").addEventListener("click", () => this.ttsTest(false));
    $("hf-chatter").addEventListener("click", () => this.startChatter());
    $("hf-redo").addEventListener("click", () => this.redoLastTurn());
    $("hf-resume").addEventListener("click", () => {
      this.p.mic.primeContext(); // inside the tap
      void this.recover(true);
    });
    for (const rating of ["loud", "quiet", "silent"] as const) {
      $(`hf-tts-${rating}`).addEventListener("click", () =>
        this.rateTts(rating),
      );
    }
    this.renderPrompt();
  }

  private log(message: string): void {
    const line = `${fmtClock((performance.now() - this.startedAt) / 1000)} ${message}`;
    this.events = [...this.events, line].slice(-200);
    setText("hf-log", this.events.slice(-30).join("\n"));
  }

  async start(): Promise<void> {
    if (this.active) return;
    if (!this.p.canRecognise) {
      setText(
        "hf-status-idle",
        "Load the model and allow the microphone first.",
      );
      return;
    }
    if (
      !this.p.claim(
        "handsfree",
        (r) => this.onResult(r),
        (t, at) => this.onPartial(t, at),
      )
    ) {
      setText(
        "hf-status-idle",
        "Push-to-talk is listening. Wait for it to finish.",
      );
      return;
    }
    this.p.mic.primeContext(); // synchronously inside the tap
    this.resetSession(); // sets active first, so a double tap can't start twice
    ($("hf-start") as HTMLButtonElement).disabled = true;
    try {
      if (!isHealthy(this.p.mic.state)) await this.p.mic.open();
      this.p.engine.reset();
      this.p.setGate("handsfree", true);
      document.addEventListener("visibilitychange", this.onVisibility);
      await this.requestWakeLock();
      this.log("hands-free started");
      show("hf-running", true);
      show("hf-start", false);
      setText("hf-status-idle", "");
      this.renderPrompt();
      this.monitor = window.setInterval(() => this.tick(), 200);
    } catch (e) {
      this.active = false;
      this.p.release("handsfree");
      setText(
        "hf-status-idle",
        `Couldn't start hands-free: ${errorMessage(e)}`,
      );
    } finally {
      ($("hf-start") as HTMLButtonElement).disabled = false;
    }
  }

  private resetSession(): void {
    this.active = true;
    this.startedAt = performance.now();
    this.startedIso = new Date().toISOString();
    this.results = 0;
    this.ignored = 0;
    this.finalizedByPause = 0;
    this.events = [];
    this.recoveries = 0;
    this.groups = [];
    this.current = [];
    this.index = 0;
    this.unhealthySince = null;
    this.chatter = null;
    this.chatters = [];
    this.tts = [];
    this.ttsBusy = false;
  }

  stop(): void {
    if (!this.active) return;
    this.closeGroup();
    if (this.chatter) this.finishChatter(false);
    this.cancelTts();
    this.active = false;
    this.p.release("handsfree");
    window.clearInterval(this.monitor);
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.wakeLock?.release();
    this.wakeLock = null;
    const durationS = Math.round((performance.now() - this.startedAt) / 1000);
    const segs = this.groups.map((g) => g.segments);
    this.record({
      startedAt: this.startedIso,
      standalone: isStandalone(),
      durationS,
      results: this.results,
      ignored: this.ignored,
      finalizedByPause: this.finalizedByPause,
      events: this.events,
      recoveries: this.recoveries,
      wakeLock: this.wakeLockState,
      groups: this.groups,
      summary: summarize(this.groups),
      meanSegmentsPerTurn: segs.length
        ? segs.reduce((a, b) => a + b, 0) / segs.length
        : null,
      tts: this.tts,
      chatters: this.chatters,
      batteryStart: readPercent("hf-batt-start"),
      batteryEnd: readPercent("hf-batt-end"),
    });
    show("hf-running", false);
    show("hf-start", true);
    setText(
      "hf-status-idle",
      `Stopped after ${fmtClock(durationS)}. Saved to the report.`,
    );
  }

  private renderPrompt(): void {
    const phrase = HANDSFREE_PHRASES[this.index];
    setText(
      "hf-progress",
      phrase ? `${this.index + 1} / ${HANDSFREE_PHRASES.length}` : "Done",
    );
    setText(
      "hf-prompt",
      phrase
        ? phrase.say
        : "All turns done. Keep it running for the endurance test, or stop.",
    );
  }

  private tick(): void {
    const now = performance.now();
    if (this.lastPartial && now - this.lastPartialAt > PAUSE_MS) {
      this.finalizedByPause += 1;
      this.lastPartial = "";
      this.p.engine.finalize();
    }
    const last = this.current.at(-1);
    if (last && now - last.at > GROUP_GAP_MS && !this.chatter)
      this.closeGroup();
    if (this.chatter && now > this.chatter.until) this.finishChatter(true);
    const state = this.p.mic.state;
    const healthy = isHealthy(state);
    this.unhealthySince = healthy ? null : (this.unhealthySince ?? now);
    if (
      !healthy &&
      now - this.lastRecoverAt > RECOVER_EVERY_MS &&
      document.visibilityState === "visible"
    )
      void this.recover(false);
    show(
      "hf-resume",
      !healthy &&
        this.unhealthySince !== null &&
        now - this.unhealthySince > SHOW_RESUME_AFTER_MS,
    );
    setText(
      "hf-status",
      `${healthy ? "● Listening" : "○ Recovering…"} · ${fmtClock((now - this.startedAt) / 1000)} · audio ${state.context} · mic ${state.track}${state.muted ? " (muted)" : ""} · wake lock ${this.wakeLockState}`,
    );
    setText(
      "hf-counts",
      `${this.results} phrases · ${this.ignored} ignored · ${this.finalizedByPause} finalised on pause · ${this.recoveries} recoveries`,
    );
    if (this.chatter)
      setText(
        "hf-chatter-status",
        `Chatter test: ${Math.ceil((this.chatter.until - now) / 1000)} s left · ${this.chatter.triggers.length} false triggers`,
      );
  }

  private onPartial(text: string, at: number): void {
    if (isIgnorable(text) || text === this.lastPartial) return;
    this.lastPartial = text;
    this.lastPartialAt = at;
    setText("hf-partial", text);
  }

  private onResult(r: VoskResult): void {
    this.lastPartial = "";
    setText("hf-partial", "");
    if (isIgnorable(r.text)) {
      this.ignored += 1;
      return;
    }
    this.results += 1;
    if (performance.now() < this.ttsWatchUntil || this.ttsBusy) {
      this.ttsHeard = [...this.ttsHeard, r.text];
      this.log(`heard during/after speech output: “${r.text}”`);
      return;
    }
    if (this.chatter) {
      this.chatter.triggers = [...this.chatter.triggers, r.text];
      this.log(`chatter trigger: “${r.text}”`);
      return;
    }
    const lastVoice = this.p.vad.lastVoiceAt;
    const latencyMs =
      lastVoice > 0 && r.at >= lastVoice ? Math.round(r.at - lastVoice) : null;
    this.current = [...this.current, { text: r.text, at: r.at, latencyMs }];
    setText("hf-heard", this.current.map((s) => s.text).join(" · "));
  }

  private closeGroup(): void {
    if (this.current.length === 0) return;
    const phrase = HANDSFREE_PHRASES[this.index];
    const heard = this.current.map((s) => s.text).join(" ");
    if (phrase) {
      const c = compare(phrase.expect, heard, SYNONYMS);
      const group: HandsFreeGroup = {
        id: phrase.id,
        expected: phrase.expect,
        heard,
        exact: c.exact,
        match: c.match,
        wer: c.wer,
        segments: this.current.length,
        latencyMs: this.current.at(-1)?.latencyMs ?? null,
      };
      this.groups = [...this.groups, group];
      this.log(
        `${c.match ? "✓" : "✗"} “${heard}” (${group.segments} part${group.segments > 1 ? "s" : ""}, ${fmtMs(group.latencyMs)})`,
      );
      setText(
        "hf-verdict",
        `${c.match ? (c.exact ? "✓ Match" : "✓ Same meaning") : "✗ Mismatch"}: “${heard}”${group.segments > 1 ? ` · arrived in ${group.segments} parts` : ""}`,
      );
      $("hf-verdict").className = c.match ? "ok" : "bad";
      this.index += 1;
      this.renderPrompt();
    } else {
      this.log(`heard: “${heard}”`);
    }
    this.current = [];
    setText("hf-heard", "");
  }

  /** For a stray noise that got scored as a turn: drop the last result and ask for it again. */
  private redoLastTurn(): void {
    if (!this.active || this.groups.length === 0) return;
    const dropped = this.groups.at(-1);
    this.groups = this.groups.slice(0, -1);
    this.index = Math.max(0, this.index - 1);
    this.current = [];
    this.log(`redo: dropped “${dropped?.heard ?? ""}”`);
    setText("hf-verdict", "Last turn dropped. Say it again.");
    $("hf-verdict").className = "";
    this.renderPrompt();
  }

  private async requestWakeLock(): Promise<void> {
    if (!("wakeLock" in navigator)) {
      this.wakeLockState = "unsupported";
      return;
    }
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLockState = "held";
      this.wakeLock.addEventListener("release", () => {
        this.wakeLockState = "released";
        this.log("wake lock released");
      });
    } catch (e) {
      this.wakeLockState = `refused (${errorMessage(e)})`;
    }
  }

  private async handleVisibility(): Promise<void> {
    this.log(`page ${document.visibilityState}`);
    if (document.visibilityState === "visible" && this.active) {
      await this.recover(false);
      await this.requestWakeLock();
    }
  }

  /** Single-flight: overlapping triggers (tick, visibility, tap) share one attempt. */
  private recover(fromTap: boolean): Promise<void> {
    this.recovering ??= this.doRecover(fromTap).finally(() => {
      this.recovering = null;
    });
    return this.recovering;
  }

  private async doRecover(fromTap: boolean): Promise<void> {
    if (!this.active) return;
    this.lastRecoverAt = performance.now();
    const wasHealthy = isHealthy(this.p.mic.state);
    try {
      const running = await this.p.mic.resume();
      if (this.p.mic.state.track !== "live") {
        await this.p.mic.open();
        this.p.engine.reset();
        this.log("mic re-acquired");
      } else if (!running) {
        this.log("audio still suspended: tap “resume” if it stays like this");
      }
      if (!wasHealthy && isHealthy(this.p.mic.state)) {
        this.recoveries += 1;
        this.log(fromTap ? "resumed by tap" : "recovered automatically");
      }
    } catch (e) {
      this.log(`recovery failed: ${errorMessage(e)}`);
    }
  }

  /** gated = the app's design (recogniser deaf while speaking); open = echo test with the mic live. */
  private ttsTest(gated: boolean): void {
    if (!this.active || this.ttsBusy || !("speechSynthesis" in window)) return;
    this.ttsBusy = true;
    this.ttsGated = gated;
    this.ttsHeard = [];
    this.closeGroup();
    if (gated) {
      this.p.engine.finalize();
      this.p.setGate("handsfree", false);
    }
    let reopened = false;
    const reopen = () => {
      if (reopened || !this.active) return;
      reopened = true;
      this.p.setGate("handsfree", true);
      this.ttsWatchUntil = performance.now() + TTS_WATCH_MS;
      this.ttsTimers.push(
        window.setTimeout(() => {
          this.ttsBusy = false;
          show("hf-tts-rate", true);
        }, TTS_WATCH_MS),
      );
    };
    this.ttsTimers.push(window.setTimeout(reopen, TTS_SAFETY_MS));
    const u = new SpeechSynthesisUtterance("One hundred and eighty");
    u.lang = "en-GB";
    u.onend = () =>
      this.ttsTimers.push(window.setTimeout(reopen, gated ? TTS_TAIL_MS : 0));
    u.onerror = (e) => {
      this.log(`speech output error: ${e.error}`);
      reopen();
    };
    this.log(
      `speech output test (${gated ? "recogniser gated" : "mic left open"})`,
    );
    speechSynthesis.speak(u);
  }

  private cancelTts(): void {
    this.ttsTimers.forEach((t) => window.clearTimeout(t));
    this.ttsTimers = [];
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.ttsBusy = false;
    this.ttsWatchUntil = 0;
    show("hf-tts-rate", false);
  }

  private rateTts(rating: TtsCheck["rating"]): void {
    const heardAfter = this.ttsHeard.join(" ");
    this.tts = [
      ...this.tts,
      {
        at: new Date().toISOString(),
        gated: this.ttsGated,
        rating,
        selfHeard: /eighty|hundred/.test(heardAfter),
        heardAfter,
      },
    ];
    this.log(
      `speech output rated ${rating}${heardAfter ? `; recogniser heard “${heardAfter}”` : "; recogniser heard nothing"}`,
    );
    show("hf-tts-rate", false);
  }

  private startChatter(): void {
    if (!this.active || this.chatter) return;
    this.closeGroup();
    this.chatter = {
      until: performance.now() + CHATTER_S * 1000,
      triggers: [],
      ignoredAtStart: this.ignored,
    };
    this.log("chatter test started");
  }

  private finishChatter(completed: boolean): void {
    if (!this.chatter) return;
    const run: ChatterRun = {
      seconds: CHATTER_S,
      falseTriggers: this.chatter.triggers,
      ignored: this.ignored - this.chatter.ignoredAtStart,
      completed,
    };
    this.chatters = [...this.chatters, run];
    this.log(
      `chatter test ${completed ? "done" : "stopped early"}: ${run.falseTriggers.length} false triggers`,
    );
    setText(
      "hf-chatter-status",
      `Chatter test ${completed ? "done" : "stopped early"}: ${run.falseTriggers.length} false triggers.`,
    );
    this.chatter = null;
  }
}

function readPercent(id: string): number | null {
  const input = $(id) as HTMLInputElement;
  const v = Number(input.value);
  return input.value !== "" && Number.isFinite(v) && v >= 0 && v <= 100
    ? v
    : null;
}
