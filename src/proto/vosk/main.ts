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
new HandsFreeRun(pipeline, (session) =>
  update((r) => ({ ...r, handsFree: [...r.handsFree, session] })),
);

// Dev-only hook for the synthetic-speech engine test (tree-shaken out of production builds).
if (import.meta.env.DEV) {
  Object.assign(window, {
    __voskProto: { pipeline, grammar: GRAMMAR, modelUrl: MODEL_URL },
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
  lines.push(
    `  latency (speech end → result), median: Vosk endpoint ${fmtMs(latencyOf(endpointed))} (${endpointed.length} takes) · after 1.2 s auto-stop ${fmtMs(latencyOf(autoStopped))} (${autoStopped.length} takes) · stop → finalize reply ${fmtMs(percentile(stops, 50))}`,
  );
  const misses = ptt
    .filter((e) => !e.match)
    .map((e) => `  ✗ ${e.id} expected “${e.expected}” heard “${e.heard}”`);
  lines.push(...misses);
  r.handsFree.forEach((h, i) => {
    lines.push(
      `Hands-free #${i + 1} (${h.standalone ? "app" : "tab"}): ${fmtClock(h.durationS)}, turns correct ${fmtPct(h.summary.matchRate)} of ${h.summary.count}, parts/turn ${h.meanSegmentsPerTurn?.toFixed(1) ?? "–"}, latency median ${fmtMs(h.summary.medianLatencyMs)}, ignored ${h.ignored}, recoveries ${h.recoveries}, wake lock ${h.wakeLock}`,
    );
    if (h.tts.length)
      lines.push(
        `  speech output: ${h.tts.map((t) => `${t.gated ? "gated" : "mic open"}: ${t.rating ?? "?"}${t.selfHeard ? " (recogniser heard it!)" : ""}`).join(", ")}`,
      );
    h.chatters.forEach((c) =>
      lines.push(
        `  chatter${c.completed ? "" : " (stopped early)"}: ${c.falseTriggers.length} false triggers in ${c.seconds} s (${c.falseTriggers.join(" | ") || "none"})`,
      ),
    );
    if (h.batteryStart !== null && h.batteryEnd !== null)
      lines.push(
        `  battery: ${h.batteryStart}% → ${h.batteryEnd}% over ${fmtClock(h.durationS)}`,
      );
  });
  if (r.notes) lines.push(`Notes: ${r.notes}`);
  return lines.join("\n");
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

$("notes").addEventListener("change", (e) => {
  const notes = (e.target as HTMLTextAreaElement).value.slice(0, 2000);
  update((r) => ({ ...r, notes }));
});
($("notes") as HTMLTextAreaElement).value = report.notes;

renderReport();
void init();
