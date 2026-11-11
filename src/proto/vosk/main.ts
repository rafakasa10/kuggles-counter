import "../proto.css";
import { applyTheme, preferredTheme } from "../theme.ts";
import en from "../../voice/aliases/en.json";
import { voskGrammarJson, type AliasFile } from "../../voice/grammar.ts";
import {
  hasVoskCache,
  isStandalone,
  micPermissionState,
  snapshotEnv,
} from "./env.ts";
import { Pipeline } from "./pipeline.ts";
import { PushToTalkRun } from "./ptt.ts";
import { HandsFreeRun } from "./handsfree.ts";
import { PHRASES } from "./phrases.ts";
import { percentile, summarize } from "./score.ts";
import {
  emptyReport,
  loadReport,
  saveReport,
  type HandsFreeSession,
  type PttEntry,
  type Report,
} from "./store.ts";
import {
  $,
  errorMessage,
  fmtClock,
  fmtMs,
  fmtPct,
  setText,
  show,
} from "./ui.ts";

const MODEL_FILE = "models/vosk-model-small-en-us-0.15.tar.gz";
// Absolute on purpose: vosk-browser's worker resolves relative URLs against the site root.
const MODEL_URL = new URL(
  `${import.meta.env.BASE_URL}${MODEL_FILE}`,
  location.href,
).href;
const GRAMMAR = voskGrammarJson(en as AliasFile);

let report: Report = loadReport();
let useGrammar = true;

function update(change: (r: Report) => Report): void {
  report = change(report);
  if (!saveReport(report))
    setText(
      "report-status",
      "Could not save to this browser’s storage; copy the report before leaving.",
    );
  renderReport();
}

applyTheme(preferredTheme());
const pipeline = new Pipeline((message) => setText("setup-event", message));
pipeline.onLevel = (level) => {
  ($("level").firstElementChild as HTMLElement).style.width =
    `${Math.round(level * 100)}%`;
};

// ---------- setup ----------
async function init(): Promise<void> {
  const env = await snapshotEnv();
  update((r) => ({
    ...r,
    env,
    launches: [
      ...r.launches,
      {
        at: env.at,
        standalone: env.standalone,
        micPermissionAtLaunch: env.micPermission,
      },
    ].slice(-50),
  }));
  setText(
    "env",
    `${env.isIOS ? "iPhone/iPad" : "Not iOS"} · ${env.standalone ? "installed app" : "browser tab"} · Web Speech ${env.webSpeech ? "available" : "not available"} · AudioWorklet ${env.audioWorklet ? "yes" : "no"} · Wake Lock ${env.wakeLock ? "yes" : "no"}`,
  );
  if (env.isIOS && !env.standalone) show("install-hint", true);
  if (!env.wasm || !env.mediaDevices)
    setText(
      "model-status",
      "This browser lacks WebAssembly or microphone access, so Vosk can’t run here.",
    );
}

function readyCheck(): void {
  if (!pipeline.canRecognise) return;
  pipeline.engine.createRecognizer(
    pipeline.mic.sampleRate,
    useGrammar ? GRAMMAR : undefined,
  );
  setText(
    "ready-status",
    `Ready · ${pipeline.mic.sampleRate} Hz · ${useGrammar ? "darts grammar on" : "open vocabulary"}`,
  );
  $("ready-status").className = "ok";
}

$("load-model").addEventListener("click", async () => {
  const button = $("load-model") as HTMLButtonElement;
  button.disabled = true;
  const t0 = performance.now();
  const timer = window.setInterval(
    () =>
      setText(
        "model-status",
        `Loading… ${fmtClock((performance.now() - t0) / 1000)} (downloads 41 MB the first time)`,
      ),
    250,
  );
  try {
    const cachedBefore = await hasVoskCache();
    const stats = await pipeline.engine.load(MODEL_URL, cachedBefore);
    update((r) => ({
      ...r,
      modelLoads: [
        ...r.modelLoads,
        { ...stats, at: new Date().toISOString(), standalone: isStandalone() },
      ],
    }));
    setText(
      "model-status",
      `Model ready in ${fmtMs(stats.libraryMs + stats.modelMs)} (library ${fmtMs(stats.libraryMs)}, model ${fmtMs(stats.modelMs)}${stats.cachedBefore ? ", from cache" : stats.cachedBefore === false ? ", downloaded" : ""}). Reload the page and load again to time a cached start.`,
    );
    readyCheck();
  } catch (e) {
    setText("model-status", `Model failed to load: ${errorMessage(e)}`);
    button.disabled = false;
  } finally {
    window.clearInterval(timer);
  }
});

$("allow-mic").addEventListener("click", async () => {
  const button = $("allow-mic") as HTMLButtonElement;
  button.disabled = true;
  // Before any await: iOS only lets an AudioContext start inside the tap itself.
  pipeline.mic.primeContext();
  const permissionBefore = await micPermissionState();
  try {
    const { grantMs } = await pipeline.mic.open();
    update((r) => ({
      ...r,
      micGrants: [
        ...r.micGrants,
        {
          at: new Date().toISOString(),
          standalone: isStandalone(),
          permissionBefore,
          grantMs,
          error: null,
          sampleRate: pipeline.mic.sampleRate,
          worklet: pipeline.mic.usingWorklet,
        },
      ],
    }));
    setText(
      "mic-status",
      `Microphone on (${permissionBefore} → granted in ${fmtMs(grantMs)}, ${pipeline.mic.sampleRate} Hz, ${pipeline.mic.usingWorklet ? "AudioWorklet" : "ScriptProcessor"}).`,
    );
    readyCheck();
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    const help =
      name === "NotAllowedError"
        ? "Microphone access was refused. On iPhone: Settings › Safari › Microphone → Ask or Allow, then reload."
        : `Microphone failed: ${errorMessage(e)}`;
    update((r) => ({
      ...r,
      micGrants: [
        ...r.micGrants,
        {
          at: new Date().toISOString(),
          standalone: isStandalone(),
          permissionBefore,
          grantMs: null,
          error: `${name} ${errorMessage(e)}`.trim(),
          sampleRate: 0,
          worklet: false,
        },
      ],
    }));
    setText("mic-status", help);
    button.disabled = false;
  }
});

$("use-grammar").addEventListener("change", (e) => {
  useGrammar = (e.target as HTMLInputElement).checked;
  readyCheck();
});

// ---------- runs ----------
new PushToTalkRun(
  pipeline,
  () => useGrammar,
  (entry) => update((r) => ({ ...r, ptt: [...r.ptt, entry] })),
);
// Sessions are saved provisionally while running, so replace by start time.
const handsFree = new HandsFreeRun(
  pipeline,
  () => useGrammar,
  (session) =>
    update((r) => ({
      ...r,
      handsFree: [
        ...r.handsFree.filter((h) => h.startedAt !== session.startedAt),
        session,
      ],
    })),
);

// Dev-only hook for the synthetic-speech engine test (tree-shaken out of production builds).
if (import.meta.env.DEV) {
  Object.assign(window, {
    __voskProto: { pipeline, handsFree, grammar: GRAMMAR, modelUrl: MODEL_URL },
  });
}

// ---------- report ----------
const latestPerPhrase = (entries: readonly PttEntry[]): PttEntry[] => [
  ...new Map(entries.map((e) => [e.id, e])).values(),
];

function summaryText(r: Report): string {
  const lines: string[] = [];
  const env = r.env;
  if (env)
    lines.push(
      `Device: ${env.isIOS ? "iOS" : "not iOS"}, ${env.standalone ? "installed app" : "browser tab"}, Web Speech ${env.webSpeech ? "yes" : "no"}, ${env.cores ?? "?"} cores`,
    );
  lines.push(
    `Mic permission at each launch: ${
      r.launches
        .slice(-8)
        .map(
          (l) => `${l.standalone ? "app" : "tab"}:${l.micPermissionAtLaunch}`,
        )
        .join(", ") || "–"
    }`,
  );
  lines.push(
    `Mic grants: ${r.micGrants.map((g) => (g.error ? `error (${g.error})` : `${g.permissionBefore}→${fmtMs(g.grantMs)}`)).join(", ") || "–"}`,
  );
  lines.push(
    `Model loads: ${r.modelLoads.map((m) => `${fmtMs(m.libraryMs + m.modelMs)}${m.cachedBefore ? " (cache)" : m.cachedBefore === false ? " (download)" : ""}`).join(", ") || "–"}`,
  );
  const ptt = latestPerPhrase(r.ptt);
  const s = summarize(ptt);
  const stops = ptt.flatMap((e) =>
    e.stopToResultMs === null ? [] : [e.stopToResultMs],
  );
  lines.push(
    `Push-to-talk: ${s.count}/${PHRASES.length} phrases, correct ${fmtPct(s.matchRate)} (literal ${fmtPct(ptt.length ? ptt.filter((e) => e.exact).length / ptt.length : null)}), mean WER ${s.meanWer === null ? "–" : s.meanWer.toFixed(2)}, split turns ${ptt.filter((e) => e.segments > 1).length}`,
  );
  const endpointed = ptt.filter((e) => e.endpointedBeforeStop);
  const autoStopped = ptt.filter((e) => !e.endpointedBeforeStop);
  const latencyOf = (es: readonly PttEntry[]) =>
    percentile(
      es.flatMap((e) => (e.latencyMs === null ? [] : [e.latencyMs])),
      50,
    );
  const parsedLatency = ptt.flatMap((e) =>
    typeof e.speechEndToParsedMs === "number" ? [e.speechEndToParsedMs] : [],
  );
  lines.push(
    `  speech end → parsed result (word timestamps): median ${fmtMs(percentile(parsedLatency, 50))}, p90 ${fmtMs(percentile(parsedLatency, 90))} (${parsedLatency.length} takes)`,
  );
  lines.push(
    `  by voice meter, median: Vosk endpoint ${fmtMs(latencyOf(endpointed))} (${endpointed.length} takes) · after 1.2 s auto-stop ${fmtMs(latencyOf(autoStopped))} (${autoStopped.length} takes) · stop → finalize reply ${fmtMs(percentile(stops, 50))}`,
  );
  const misses = ptt
    .filter((e) => !e.match)
    .map(
      (e) =>
        `  ✗ ${e.id} expected “${e.expected}” heard “${e.heard}” → ${e.parsed ?? "?"}`,
    );
  lines.push(...misses);
  r.handsFree.forEach((h, i) => lines.push(...handsFreeLines(h, i)));
  const answered = Object.entries(r.answers).filter(([, v]) => v);
  if (answered.length)
    lines.push(`Answers: ${answered.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (r.notes) lines.push(`Notes: ${r.notes}`);
  return lines.join("\n");
}

const STYLE_GROUPS: readonly (readonly [string, (style: string) => boolean])[] =
  [
    ["one breath", (s) => s === "one breath"],
    ["one at a time", (s) => s === "one at a time"],
    ["checkout/bust early", (s) => /checkout|bust/.test(s)],
    ["next/done early", (s) => /next|done/.test(s)],
  ];

const MIN_BATTERY_MINUTES = 10;

function handsFreeLines(h: HandsFreeSession, i: number): string[] {
  const lines: string[] = [];
  const turns = Array.isArray(h.turns) ? h.turns : [];
  const latencies = Array.isArray(h.latenciesMs) ? h.latenciesMs : [];
  const flow = h.flow ?? {};
  const rb = h.readBacks ?? {};
  const correct = turns.filter((t) => t.correct).length;
  const byStyle = STYLE_GROUPS.map(([label, test]) => {
    const group = turns.filter((t) => test(t.style));
    return `${label} ${group.filter((t) => t.correct).length}/${group.length}`;
  }).join(", ");
  const minutes = h.durationS / 60;
  const tags = [
    h.standalone ? "app" : "tab",
    h.grammar === false ? "OPEN VOCABULARY" : "",
    h.wakeRequired ? "wake word on" : "",
    h.readBack ? "read-back on" : "",
    h.completed === false ? "not stopped: last safety save" : "",
  ].filter(Boolean);
  lines.push(
    `Hands-free #${i + 1} (${tags.join(", ")}): ${fmtClock(h.durationS)}, turns correct ${correct}/${turns.length} (${byStyle})`,
  );
  const parts = turns.map((t) => t.parts);
  const missedReal = turns.flatMap((t) => t.ignored ?? []);
  const dropped = turns.reduce((sum, t) => sum + (t.dropped ?? 0), 0);
  lines.push(
    `  parts/turn ${parts.length ? (parts.reduce((a, b) => a + b, 0) / parts.length).toFixed(1) : "–"} · ignored during turns ${missedReal.length}${missedReal.length ? ` (${missedReal.slice(0, 8).join(" | ")})` : ""} · ignored overall ${h.ignored} of ${h.results}${dropped ? ` · darts dropped after a turn ended ${dropped}` : ""}`,
  );
  lines.push(
    `  speech end → parsed result: median ${fmtMs(percentile(latencies, 50))}, p90 ${fmtMs(percentile(latencies, 90))} (${latencies.length} phrases)`,
  );
  turns
    .filter((t) => !t.correct)
    .forEach((t) =>
      lines.push(
        `  ✗ ${t.id} ${t.style}: expected ${t.expected} (${t.expectEnd}), got ${t.heard || "nothing"} (${t.end})`,
      ),
    );
  const pct = (x: number | null | undefined) =>
    typeof x === "number" ? `${(x * 100).toFixed(1)}%` : "–";
  lines.push(
    `  listening: audio ${pct(flow.visibleCoverage)} while visible (${pct(flow.coverage)} overall), ${flow.dropouts ?? "–"} dropouts while visible (longest ${fmtMs(flow.longestDropoutMs ?? null)}), ${flow.hiddenDropouts ?? "–"} while hidden, mic paused shown ${h.micPausedShown}× (${fmtClock((h.micPausedMs ?? 0) / 1000)}), page hidden ${h.pageHidden}×, recoveries ${h.recoveries}, wake lock ${h.wakeLock} (released ${h.wakeLockReleases}×)`,
  );
  if (h.readBack)
    lines.push(
      `  read-back: ${rb.count ?? 0} spoken, ${rb.failed ?? 0} failed, suspected cut-offs ${rb.suspectedCutOffs ?? 0}, end event missing ${rb.safetyTimeouts ?? 0}×`,
    );
  const tts = Array.isArray(h.tts) ? h.tts : [];
  if (tts.length)
    lines.push(
      `  speech output: ${tts.map((t) => `${t.gated ? "muted" : "mic open"}: ${t.rating ?? "?"}${t.selfHeard ? " (recogniser heard it!)" : ""}`).join(", ")}`,
    );
  (Array.isArray(h.chatters) ? h.chatters : []).forEach((c) =>
    lines.push(
      `  background ${fmtClock(c.elapsedS)}${c.completed ? "" : " (stopped early)"}: false triggers ${c.acted} without wake word (${c.elapsedS ? ((c.acted * 300) / c.elapsedS).toFixed(1) : "–"} per 5 min), ${c.actedWithWake} with it, from ${c.phrases.length} phrases${c.actedTexts.length ? ` (${c.actedTexts.slice(0, 10).join(" | ")})` : ""}`,
    ),
  );
  if (h.batteryStart !== null && h.batteryEnd !== null)
    lines.push(
      `  battery: ${h.batteryStart}% → ${h.batteryEnd}% over ${fmtClock(h.durationS)}${minutes >= MIN_BATTERY_MINUTES ? ` = ${(((h.batteryStart - h.batteryEnd) * 30) / minutes).toFixed(1)}% per 30 min` : " (too short to work out a rate)"}`,
    );
  return lines;
}

function renderReport(): void {
  setText("report-summary", summaryText(report));
  ($("report-json") as HTMLTextAreaElement).value = JSON.stringify(
    report,
    null,
    2,
  );
}

$("copy-report").addEventListener("click", async () => {
  const text = `${summaryText(report)}\n\n${JSON.stringify(report)}`;
  try {
    await navigator.clipboard.writeText(text);
    setText("report-status", "Copied. Paste it into the chat.");
  } catch {
    const area = $("report-json") as HTMLTextAreaElement;
    area.focus();
    area.select();
    setText(
      "report-status",
      "Copy was blocked; the JSON is selected, so use Copy from the menu.",
    );
  }
});

$("share-report").addEventListener("click", async () => {
  if (!navigator.share) {
    setText("report-status", "Sharing isn’t available here; use Copy instead.");
    return;
  }
  try {
    await navigator.share({
      title: "Vosk prototype report",
      text: `${summaryText(report)}\n\n${JSON.stringify(report)}`,
    });
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError"))
      setText("report-status", `Share failed: ${errorMessage(e)}`);
  }
});

let resetArmed = false;
$("reset-report").addEventListener("click", () => {
  if (!resetArmed) {
    resetArmed = true;
    setText("reset-report", "Tap again to erase all results");
    window.setTimeout(() => {
      resetArmed = false;
      setText("reset-report", "Erase results");
    }, 4000);
    return;
  }
  resetArmed = false;
  update(() => ({ ...emptyReport(), env: report.env }));
  setText("reset-report", "Erase results");
  setText("report-status", "Results erased.");
});

document.querySelectorAll<HTMLSelectElement>("#answers select").forEach((sel) => {
  const q = sel.dataset.q ?? "";
  sel.value = report.answers[q] ?? "";
  sel.addEventListener("change", () =>
    update((r) => ({ ...r, answers: { ...r.answers, [q]: sel.value } })),
  );
});

$("notes").addEventListener("change", (e) => {
  const notes = (e.target as HTMLTextAreaElement).value.slice(0, 2000);
  update((r) => ({ ...r, notes }));
});
($("notes") as HTMLTextAreaElement).value = report.notes;

renderReport();
void init();
