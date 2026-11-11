import en from "../../voice/aliases/en.json";
import type { AliasFile } from "../../voice/grammar.ts";
import { accept, describeAccepted, toNotation } from "./accept.ts";
import type { VoskResult } from "./engine.ts";
import { isStandalone } from "./env.ts";
import {
  closeFlow,
  coverage,
  emptyFlow,
  noteGap,
  updateFlow,
  type Flow,
} from "./flow.ts";
import { isHealthy } from "./mic.ts";
import type { Pipeline } from "./pipeline.ts";
import { HANDSFREE_SCRIPT } from "./script.ts";
import { isIgnorable } from "./score.ts";
import { canSpeak, primeSpeech, SpeechOut, type SpeechEnd } from "./speech.ts";
import type {
  ChatterRun,
  HandsFreeSession,
  ReadBackStats,
  TtsCheck,
} from "./store.ts";
import {
  countTriggers,
  dropLastTurn,
  onPhrase,
  skipTurn,
  startRun,
  type RunOptions,
  type RunState,
  type TurnRecord,
} from "./turnrun.ts";
import { $, errorMessage, fmtClock, fmtMs, setText, show } from "./ui.ts";

const ALIASES = en as AliasFile;
const PAUSE_MS = 800; // partial unchanged this long → finalise the phrase ourselves
const TTS_WATCH_MS = 2500;
const CHATTER_S = 300;
const ENDURANCE_S = 1800;
const WAKE_WINDOW_MS = 4000;
const RECOVER_EVERY_MS = 3000;
const RECOVER_TIMEOUT_MS = 8000;
const SHOW_PAUSED_AFTER_MS = 3000;
const SAVE_EVERY_MS = 30_000; // provisional saves, so a killed page keeps its data
const AFTER_READBACK_MS = 3000; // the first phrase this soon after read-back is checked
const CUT_OFF_MS = 250; // speech already under way this close to unmuting = cut off
const ONE_AT_A_TIME_STYLES = new Set([
  "one at a time",
  "checkout on dart 2",
  "next after 2 darts",
  "done after 1 dart",
]);

interface Chatter {
  readonly startedAt: number;
  readonly until: number;
  phrases: readonly { readonly text: string; readonly at: number }[];
}

const checked = (id: string): boolean => ($(id) as HTMLInputElement).checked;
const emptyReadBacks = (): ReadBackStats => ({
  count: 0,
  failed: 0,
  suspectedCutOffs: 0,
  safetyTimeouts: 0,
});

/** Hands-free run: mic open all session, phrases finalised on pauses, no button per turn. */
export class HandsFreeRun {
  private active = false;
  private startedAt = 0;
  private startedIso = "";
  private grammar = true;
  private opts: RunOptions = {
    aliases: ALIASES,
    wakeRequired: false,
    wakeWindowMs: WAKE_WINDOW_MS,
  };
  private readBack = true;
  private run: RunState = startRun(HANDSFREE_SCRIPT);
  private results = 0;
  private ignored = 0;
  private finalizedByPause = 0;
  private latencies: readonly number[] = [];
  private events: readonly string[] = [];
  private recoveries = 0;
  private flow: Flow = emptyFlow();
  private pausedSince: number | null = null;
  private micPausedShown = 0;
  private micPausedMs = 0;
  private pageHidden = 0;
  private lastHiddenAt = -Infinity;
  private lastSavedAt = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private wakeLockState = "not requested";
  private wakeLockReleases = 0;
  private readBacks: ReadBackStats = emptyReadBacks();
  private unmutedAt = 0;
  private afterReadBackUntil = 0;
  private lastPartial = "";
  private lastPartialAt = 0;
  private lastRecoverAt = 0;
  private unhealthySince: number | null = null;
  private recovering: Promise<void> | null = null;
  private chatter: Chatter | null = null;
  private chatters: readonly ChatterRun[] = [];
  private tts: readonly TtsCheck[] = [];
  private ttsBusy = false;
  private ttsRatePending = false;
  private ttsGated = true;
  private ttsWatchUntil = 0;
  private ttsHeard: readonly string[] = [];
  private watchTimer: number | undefined;
  private monitor: number | undefined;
  private enduranceNoted = false;
  private readonly speech: SpeechOut;
  private readonly onVisibility = () => void this.handleVisibility();
  private readonly onPageHide = () => this.saveProvisional();

  constructor(
    private readonly p: Pipeline,
    private readonly useGrammar: () => boolean,
    private readonly record: (session: HandsFreeSession) => void,
  ) {
    this.speech = new SpeechOut({
      mute: () => {
        this.p.engine.reset(); // drop the half-heard phrase (spec §6)
        this.p.setGate("handsfree", false);
      },
      unmute: () => {
        this.p.setGate("handsfree", true);
        this.unmutedAt = performance.now();
      },
      log: (m) => this.log(m),
      isActive: () => this.active,
    });
    $("hf-start").addEventListener("click", () => void this.start());
    $("hf-stop").addEventListener("click", () => this.stop());
    $("hf-tts").addEventListener("click", () => this.ttsTest(true));
    $("hf-tts-open").addEventListener("click", () => this.ttsTest(false));
    $("hf-chatter").addEventListener("click", () => this.startChatter());
    $("hf-redo").addEventListener("click", () => this.redoLastTurn());
    $("hf-skip").addEventListener("click", () => this.skip());
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
    this.events = [...this.events, line].slice(-300);
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
    // Synchronously inside the tap: iOS only starts audio and speech from a gesture.
    this.p.mic.primeContext();
    primeSpeech();
    this.resetSession(); // sets active first, so a double tap can't start twice
    ($("hf-start") as HTMLButtonElement).disabled = true;
    ($("use-grammar") as HTMLInputElement).disabled = true; // a mid-run change would rebuild the recogniser
    try {
      if (!isHealthy(this.p.mic.state)) await this.p.mic.open();
      if (!this.active) return; // stopped while the mic was opening
      this.p.engine.reset();
      this.p.setGate("handsfree", true);
      this.p.onGap = (from, to) => this.onGap(from, to);
      document.addEventListener("visibilitychange", this.onVisibility);
      window.addEventListener("pagehide", this.onPageHide);
      await this.requestWakeLock();
      if (!this.active) {
        void this.wakeLock?.release();
        return;
      }
      this.log(
        `hands-free started${this.grammar ? "" : " · OPEN VOCABULARY"}${this.opts.wakeRequired ? " · wake word on" : ""}${this.readBack ? " · read-back on" : ""}`,
      );
      show("hf-running", true);
      show("hf-start", false);
      show("hf-options", false);
      setText("hf-status-idle", "");
      this.renderPrompt();
      this.monitor = window.setInterval(() => this.tick(), 200);
    } catch (e) {
      this.teardown();
      setText(
        "hf-status-idle",
        `Couldn't start hands-free: ${errorMessage(e)}`,
      );
    } finally {
      ($("hf-start") as HTMLButtonElement).disabled = false;
    }
  }

  private resetSession(): void {
    const now = performance.now();
    this.active = true;
    this.startedAt = now;
    this.startedIso = new Date().toISOString();
    this.grammar = this.useGrammar();
    this.opts = { ...this.opts, wakeRequired: checked("hf-wake") };
    this.readBack = checked("hf-readback");
    this.run = startRun(HANDSFREE_SCRIPT);
    this.results = 0;
    this.ignored = 0;
    this.finalizedByPause = 0;
    this.latencies = [];
    this.events = [];
    this.recoveries = 0;
    this.flow = emptyFlow();
    this.pausedSince = null;
    this.micPausedShown = 0;
    this.micPausedMs = 0;
    this.pageHidden = 0;
    this.lastHiddenAt = -Infinity;
    this.lastSavedAt = now;
    this.wakeLockReleases = 0;
    this.readBacks = emptyReadBacks();
    this.unmutedAt = 0;
    this.afterReadBackUntil = 0;
    this.lastPartial = "";
    this.lastPartialAt = 0;
    this.unhealthySince = null;
    this.chatter = null;
    this.chatters = [];
    this.tts = [];
    this.ttsBusy = false;
    this.ttsRatePending = false;
    this.ttsWatchUntil = 0;
    this.enduranceNoted = false;
  }

  /** Everything recorded so far; completed = false for the periodic safety saves. */
  private snapshot(completed: boolean, now: number): HandsFreeSession {
    const hiddenNow = document.visibilityState === "hidden";
    const lastChunk = Math.max(this.p.lastChunkAt, this.startedAt);
    const flow = closeFlow(
      this.flow,
      now,
      lastChunk,
      hiddenNow || this.lastHiddenAt >= lastChunk,
    );
    const durationMs = now - this.startedAt;
    const visibleDrops = flow.dropouts
      .filter((d) => !d.hidden)
      .map((d) => d.ms);
    return {
      startedAt: this.startedIso,
      completed,
      standalone: isStandalone(),
      grammar: this.grammar,
      durationS: Math.round(durationMs / 1000),
      wakeRequired: this.opts.wakeRequired,
      readBack: this.readBack,
      results: this.results,
      ignored: this.ignored,
      finalizedByPause: this.finalizedByPause,
      turns: this.run.records,
      latenciesMs: this.latencies,
      flow: {
        coverage: coverage(flow, durationMs),
        visibleCoverage: coverage(flow, durationMs, true),
        dropouts: visibleDrops.length,
        hiddenDropouts: flow.dropouts.length - visibleDrops.length,
        longestDropoutMs: visibleDrops.length
          ? Math.round(Math.max(...visibleDrops))
          : null,
      },
      micPausedShown: this.micPausedShown,
      micPausedMs: Math.round(
        this.micPausedMs +
          (this.pausedSince !== null ? now - this.pausedSince : 0),
      ),
      pageHidden: this.pageHidden,
      recoveries: this.recoveries,
      wakeLock: this.wakeLockState,
      wakeLockReleases: this.wakeLockReleases,
      readBacks: this.readBacks,
      events: this.events,
      tts: this.tts,
      chatters: this.chatters,
      batteryStart: readPercent("hf-batt-start"),
      batteryEnd: readPercent("hf-batt-end"),
    };
  }

  private saveProvisional(): void {
    if (!this.active) return;
    const now = performance.now();
    this.lastSavedAt = now;
    this.record(this.snapshot(false, now));
  }

  stop(): void {
    if (!this.active) return;
    const now = performance.now();
    if (this.chatter) this.finishChatter(false);
    const session = this.snapshot(true, now);
    this.teardown();
    this.record(session);
    for (const id of ["hf-batt-start", "hf-batt-end"])
      ($(id) as HTMLInputElement).value = "";
    show("hf-running", false);
    show("hf-start", true);
    show("hf-options", true);
    show("hf-resume", false);
    setText(
      "hf-status-idle",
      `Stopped after ${fmtClock(session.durationS)}. Saved to the report.`,
    );
  }

  /** Releases everything the session holds; safe to call twice. */
  private teardown(): void {
    this.active = false;
    this.speech.cancel();
    window.clearTimeout(this.watchTimer);
    window.clearInterval(this.monitor);
    this.ttsBusy = false;
    this.ttsRatePending = false;
    show("hf-tts-rate", false);
    this.p.onGap = () => {};
    this.p.release("handsfree");
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    void this.wakeLock?.release();
    this.wakeLock = null;
    ($("use-grammar") as HTMLInputElement).disabled = false;
  }

  private renderPrompt(): void {
    const turn = HANDSFREE_SCRIPT[this.run.index];
    setText(
      "hf-progress",
      turn
        ? `Turn ${this.run.index + 1} / ${HANDSFREE_SCRIPT.length} · ${turn.style}`
        : "Script done",
    );
    setText(
      "hf-prompt",
      turn
        ? turn.say
        : "All turns done. Keep it running for the 30-minute endurance test, or stop.",
    );
    const hints = [
      turn && turn.remaining !== 501 ? `You need ${turn.remaining}.` : "",
      turn && ONE_AT_A_TIME_STYLES.has(turn.style)
        ? "Say each part on its own and pause 2–3 s between them, as if throwing."
        : "",
      this.opts.wakeRequired ? "Start each phrase with “score”." : "",
    ].filter(Boolean);
    setText("hf-hint", hints.join(" "));
    const pending = this.run.turn.darts;
    setText(
      "hf-heard",
      pending.length
        ? `So far: ${toNotation(pending)} (${pending.length} dart${pending.length > 1 ? "s" : ""})`
        : "",
    );
  }

  private tick(): void {
    const now = performance.now();
    if (this.lastPartial && now - this.lastPartialAt > PAUSE_MS) {
      this.finalizedByPause += 1;
      this.lastPartial = "";
      this.p.engine.finalize();
    }
    if (this.chatter && now > this.chatter.until) this.finishChatter(true);
    this.flow = updateFlow(
      this.flow,
      now,
      Math.max(this.p.lastChunkAt, this.startedAt),
    );
    const state = this.p.mic.state;
    const healthy = isHealthy(state);
    const visible = document.visibilityState === "visible";
    this.unhealthySince = healthy ? null : (this.unhealthySince ?? now);
    if (!healthy && now - this.lastRecoverAt > RECOVER_EVERY_MS && visible)
      void this.recover(false);
    const paused =
      visible &&
      ((this.unhealthySince !== null &&
        now - this.unhealthySince > SHOW_PAUSED_AFTER_MS) ||
        this.flow.gapStart !== null);
    this.setPaused(paused, now);
    const elapsedS = (now - this.startedAt) / 1000;
    if (elapsedS >= ENDURANCE_S && !this.enduranceNoted) {
      this.enduranceNoted = true;
      this.log("30 minutes reached");
    }
    if (now - this.lastSavedAt > SAVE_EVERY_MS) this.saveProvisional();
    setText(
      "hf-status",
      `${paused ? "⏸ Mic paused" : healthy ? "● Listening" : "○ Reconnecting…"} · ${fmtClock(elapsedS)}${elapsedS >= ENDURANCE_S ? " ✓ 30 min: enter battery % and stop" : " / 30:00"} · audio ${state.context} · mic ${state.track}${state.muted ? " (muted)" : ""} · wake lock ${this.wakeLockState}`,
    );
    const cov = coverage(this.flow, now - this.startedAt, true);
    setText(
      "hf-counts",
      `${this.results} phrases · ${this.ignored} ignored · ${this.finalizedByPause} finalised on pause · audio ${cov === null ? "–" : `${(cov * 100).toFixed(1)}%`} while visible · ${this.flow.dropouts.length} dropouts · ${this.recoveries} recoveries`,
    );
    if (this.chatter)
      setText(
        "hf-chatter-status",
        `Background test: ${fmtClock(Math.max(0, (this.chatter.until - now) / 1000))} left · ${this.chatter.phrases.length} phrases heard`,
      );
  }

  /** Called by the pipeline when mic chunks resume after a gap (works while timers are suspended). */
  private onGap(fromAt: number, toAt: number): void {
    if (!this.active || toAt <= this.startedAt) return;
    const from = Math.max(fromAt, this.startedAt);
    const hidden =
      document.visibilityState === "hidden" || this.lastHiddenAt >= from;
    this.flow = noteGap(this.flow, from, toAt, hidden);
    this.log(
      `audio gap of ${fmtMs(toAt - from)}${hidden ? " (page was hidden)" : ""}`,
    );
  }

  private setPaused(paused: boolean, now: number): void {
    if (paused && this.pausedSince === null) {
      this.pausedSince = now;
      this.micPausedShown += 1;
      this.log("mic paused shown");
    } else if (!paused && this.pausedSince !== null) {
      this.micPausedMs += now - this.pausedSince;
      this.pausedSince = null;
      this.log("mic flowing again");
    }
    show("hf-resume", paused);
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
    this.checkCutOff(r);
    if (isIgnorable(r.text)) return; // empty or only [unk]: not even a phrase
    this.results += 1;
    if (this.ttsBusy || performance.now() < this.ttsWatchUntil) {
      this.ttsHeard = [...this.ttsHeard, r.text];
      this.log(`heard during/after speech test: “${r.text}”`);
      return;
    }
    if (this.chatter) {
      this.chatter.phrases = [
        ...this.chatter.phrases,
        { text: r.text, at: r.at },
      ];
      this.log(
        `background: “${r.text}” → ${describeAccepted(accept(r.text, ALIASES))}`,
      );
      return;
    }
    const a = accept(r.text, ALIASES);
    const parsedAt = performance.now();
    const latencyMs =
      r.speechEndAt !== null ? Math.round(parsedAt - r.speechEndAt) : null;
    if (a.kind === "ignored") this.ignored += 1;
    else if (latencyMs !== null)
      this.latencies = [...this.latencies, latencyMs];
    const before = this.run;
    this.run = onPhrase(
      before,
      HANDSFREE_SCRIPT,
      { text: r.text, at: r.at, latencyMs },
      this.opts,
    );
    const wakeMissed = this.run.phrases.at(-1)?.note === "no wake word";
    this.log(
      `“${r.text}” → ${describeAccepted(a)}${wakeMissed ? " · no wake word, not acted on" : ""} · ${fmtMs(latencyMs)}`,
    );
    if (this.run.finished && this.run.records.length > before.records.length)
      this.finishTurn(this.run.finished);
    else this.renderPrompt();
  }

  /** The first result after a read-back: speech already under way when the mic unmuted was cut off. */
  private checkCutOff(r: VoskResult): void {
    if (performance.now() > this.afterReadBackUntil) return;
    this.afterReadBackUntil = 0;
    if (
      r.speechStartAt === null ||
      r.speechStartAt > this.unmutedAt + CUT_OFF_MS
    )
      return;
    this.readBacks = {
      ...this.readBacks,
      suspectedCutOffs: this.readBacks.suspectedCutOffs + 1,
    };
    this.log(
      `speech was already under way when the mic unmuted: maybe cut off (“${r.text}”)`,
    );
  }

  private finishTurn(t: TurnRecord): void {
    setText(
      "hf-verdict",
      `${t.correct ? "✓" : "✗"} ${t.heard || "nothing"} (${t.end}) · expected ${t.expected} (${t.expectEnd}) · ${t.parts} part${t.parts === 1 ? "" : "s"}${t.ignored.length ? ` · ${t.ignored.length} ignored` : ""} · ${fmtMs(t.latencyMs)}`,
    );
    $("hf-verdict").className = t.correct ? "ok" : "bad";
    this.renderPrompt();
    if (this.readBack && t.end !== "skipped") this.readBackTurn(t);
  }

  private countSpeech(how: SpeechEnd): void {
    if (how === "safety")
      this.readBacks = {
        ...this.readBacks,
        safetyTimeouts: this.readBacks.safetyTimeouts + 1,
      };
  }

  private readBackTurn(t: TurnRecord): void {
    if (!canSpeak()) return;
    if (this.ttsBusy || this.speech.speaking) {
      this.log(`read-back skipped for ${t.id}: still speaking`);
      return;
    }
    const text =
      t.end === "checkout"
        ? "Game shot"
        : t.end === "bust"
          ? "Bust"
          : t.score === 0
            ? "No score"
            : String(t.score);
    this.speech.speak(text, true, (how) => {
      this.countSpeech(how);
      this.readBacks =
        how === "end"
          ? { ...this.readBacks, count: this.readBacks.count + 1 }
          : { ...this.readBacks, failed: this.readBacks.failed + 1 };
      this.afterReadBackUntil = performance.now() + AFTER_READBACK_MS;
    });
  }

  private skip(): void {
    if (!this.active || !HANDSFREE_SCRIPT[this.run.index]) return;
    this.run = skipTurn(this.run, HANDSFREE_SCRIPT);
    const t = this.run.finished;
    this.log(
      `skipped turn${t ? ` ${t.id} (heard ${t.heard || "nothing"})` : ""}`,
    );
    if (t) this.finishTurn(t);
  }

  /** For a stray noise that got scored as a turn: drop the last turn and ask for it again. */
  private redoLastTurn(): void {
    if (!this.active || this.run.records.length === 0) return;
    const dropped = this.run.records.at(-1);
    this.run = dropLastTurn(this.run, HANDSFREE_SCRIPT);
    this.log(`redo: dropped ${dropped?.id ?? ""} (${dropped?.heard ?? ""})`);
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
        this.wakeLockReleases += 1;
        this.log("wake lock released");
      });
    } catch (e) {
      this.wakeLockState = `refused (${errorMessage(e)})`;
    }
  }

  private async handleVisibility(): Promise<void> {
    this.log(`page ${document.visibilityState}`);
    if (document.visibilityState === "hidden") {
      this.pageHidden += 1;
      this.lastHiddenAt = performance.now();
      this.saveProvisional(); // iOS may kill a hidden page with a big WASM heap
    }
    if (document.visibilityState === "visible" && this.active) {
      this.lastHiddenAt = performance.now(); // a gap that ends now overlapped hidden time
      await this.recover(false);
      if (this.active) await this.requestWakeLock();
    }
  }

  /**
   * Single-flight: overlapping triggers (tick, visibility, tap) share one attempt.
   * An attempt that hangs (e.g. getUserMedia never settles) is abandoned after a timeout.
   */
  private recover(fromTap: boolean): Promise<void> {
    this.recovering ??= Promise.race([
      this.doRecover(fromTap),
      new Promise<void>((resolve) =>
        window.setTimeout(() => {
          if (this.active) this.log("recovery attempt timed out");
          resolve();
        }, RECOVER_TIMEOUT_MS),
      ),
    ]).finally(() => {
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
        this.log(
          "audio still suspended: tap “Mic paused” if it stays like this",
        );
      }
      if (!wasHealthy && isHealthy(this.p.mic.state)) {
        this.recoveries += 1;
        this.log(fromTap ? "resumed by tap" : "recovered automatically");
      }
    } catch (e) {
      this.log(`recovery failed: ${errorMessage(e)}`);
    }
  }

  /** gated = the app's design (recogniser muted while speaking); open = echo test with the mic live. */
  private ttsTest(gated: boolean): void {
    if (!this.active || this.ttsBusy || this.speech.speaking || !canSpeak())
      return;
    this.ttsBusy = true;
    this.ttsRatePending = false;
    this.ttsGated = gated;
    this.ttsHeard = [];
    show("hf-tts-rate", false);
    this.log(`speech output test (${gated ? "mic muted" : "mic left open"})`);
    this.speech.speak("One hundred and eighty", gated, (how) => {
      this.countSpeech(how);
      this.ttsWatchUntil = performance.now() + TTS_WATCH_MS;
      this.watchTimer = window.setTimeout(() => {
        this.ttsBusy = false;
        this.ttsRatePending = true;
        show("hf-tts-rate", true);
      }, TTS_WATCH_MS);
    });
  }

  private rateTts(rating: TtsCheck["rating"]): void {
    if (!this.ttsRatePending) return; // only once per test, after the watch window
    this.ttsRatePending = false;
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
    const now = performance.now();
    this.chatter = {
      startedAt: now,
      until: now + CHATTER_S * 1000,
      phrases: [],
    };
    this.log("background test started (5 min: conversation + music, no darts)");
  }

  private finishChatter(completed: boolean): void {
    if (!this.chatter) return;
    const c = countTriggers(this.chatter.phrases, ALIASES, WAKE_WINDOW_MS);
    const run: ChatterRun = {
      plannedS: CHATTER_S,
      elapsedS: Math.round((performance.now() - this.chatter.startedAt) / 1000),
      completed,
      phrases: this.chatter.phrases.map((p) => p.text),
      acted: c.acted,
      actedWithWake: c.actedWithWake,
      kinds: c.kinds,
      actedTexts: c.actedTexts,
    };
    this.chatters = [...this.chatters, run];
    const summary = `${run.acted} false triggers (${run.actedWithWake} with the wake word) from ${run.phrases.length} phrases`;
    this.log(
      `background test ${completed ? "done" : "stopped early"}: ${summary}`,
    );
    setText(
      "hf-chatter-status",
      `Background test ${completed ? "done" : "stopped early"}: ${summary}.`,
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
