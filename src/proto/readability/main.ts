import "../proto.css";
import "./readability.css";
import tokens from "../../ui/theme/chalk.json";
import { applyTheme, preferredTheme, type ThemeName } from "../theme.ts";

type View = "hand" | "distance";
type Answer = "yes" | "no" | null;

interface Sample {
  readonly remaining: number;
  readonly route: readonly string[];
}

interface Check {
  readonly at: string;
  readonly view: View;
  readonly theme: ThemeName;
  readonly players: number;
  readonly light: string;
  readonly answers: Readonly<Record<string, Answer>>;
}

// Remaining scores with a standard checkout route; others have no route (> 170 or no finish shown).
const SAMPLES: readonly Sample[] = [
  { remaining: 170, route: ["T20", "T20", "BULL"] },
  { remaining: 141, route: ["T20", "T19", "D12"] },
  { remaining: 121, route: ["T20", "T11", "D14"] },
  { remaining: 112, route: ["T20", "12", "D20"] },
  { remaining: 100, route: ["T20", "D20"] },
  { remaining: 96, route: ["T20", "D18"] },
  { remaining: 87, route: ["T17", "D18"] },
  { remaining: 81, route: ["T19", "D12"] },
  { remaining: 64, route: ["T16", "D8"] },
  { remaining: 58, route: ["18", "D20"] },
  { remaining: 32, route: ["D16"] },
  { remaining: 301, route: [] },
  { remaining: 237, route: [] },
  { remaining: 188, route: [] },
];
const TURNS: readonly (readonly string[])[] = [
  ["T12", "T12", "8"],
  ["T20", "T20", "T20"],
  ["T19", "7", "D16"],
  ["20", "D20", "–"],
  ["BULL", "25", "T20"],
  ["T17", "T18", "BULL"],
  ["5", "1", "20"],
  ["D8", "–", "–"],
];
const NAMES = ["SAM", "ALEX", "JO", "KIM"];
const CHECK_KEYS = [
  "remaining",
  "turn total",
  "chips",
  "checkout route",
  "double vs treble",
  "other players",
] as const;
const STORAGE_KEY = "kc-readability-v1";

const dartValue = (d: string): number => {
  if (d === "–") return 0;
  if (d === "BULL") return 50;
  const m = /^([DT]?)(\d+)$/.exec(d);
  if (!m) return 0;
  const mult = m[1] === "T" ? 3 : m[1] === "D" ? 2 : 1;
  return mult * Number(m[2]);
};
const chipClass = (d: string): string =>
  d === "–"
    ? "chip miss"
    : d === "BULL" || d.startsWith("D")
      ? "chip dbl"
      : d.startsWith("T")
        ? "chip tpl"
        : "chip";
const chips = (darts: readonly string[], size: number): string =>
  darts
    .map(
      (d) =>
        `<span class="${chipClass(d)}" style="font-size:${size}px">${d}</span>`,
    )
    .join("");
const pick = <T>(xs: readonly T[]): T =>
  xs[Math.floor(Math.random() * xs.length)] as T;

const state = {
  view: "distance" as View,
  theme: preferredTheme(),
  players: 2,
  active: pick(SAMPLES),
  others: [pick(SAMPLES), pick(SAMPLES), pick(SAMPLES)],
  turn: pick(TURNS),
};

const size = tokens.typeScalePt;
const screenEl = document.getElementById("screen") as HTMLElement;

function playerName(i: number): string {
  return NAMES[i] ?? `P${i + 1}`;
}

function renderHand(): string {
  const total = state.turn.reduce((sum, d) => sum + dartValue(d), 0);
  const route = state.active.route.length ? state.active.route.join(" · ") : "";
  const cards =
    state.players === 2
      ? `<div class="cards">
          <div class="pc on"><div class="pn">▶ ${playerName(0)}<span class="legs">1</span></div>
            <div class="rem num" style="font-size:${size.hand.remaining2up.size}px">${state.active.remaining}</div>
            <div class="hint" style="font-size:${size.hand.checkoutHint.size}px">${route}</div>
            <div class="st" style="font-size:${size.hand.statLine.size}px">77.8 avg · 15 darts</div></div>
          <div class="pc"><div class="pn">${playerName(1)}<span class="legs">0</span></div>
            <div class="rem num" style="font-size:${size.hand.remaining2up.size}px">${state.others[0]?.remaining ?? 0}</div>
            <div class="hint"></div>
            <div class="st" style="font-size:${size.hand.statLine.size}px">44.0 avg · 18 darts</div></div>
        </div>`
      : `<div class="list">
          <div class="lr on"><span class="pn">▶ ${playerName(0)}</span><span class="rem num" style="font-size:${size.hand.remainingListActive.size}px">${state.active.remaining}</span><span class="hint" style="font-size:${size.hand.checkoutHint.size}px">${route}</span></div>
          ${state.others
            .slice(0, state.players - 1)
            .map(
              (o, i) =>
                `<div class="lr"><span class="pn">${playerName(i + 1)}</span><span class="rem num" style="font-size:${size.hand.remainingListOther.size}px">${o.remaining}</span></div>`,
            )
            .join("")}
        </div>`;
  const keys = Array.from(
    { length: 20 },
    (_, i) =>
      `<span class="k num" style="font-size:${size.hand.key.size}px">${i + 1}</span>`,
  ).join("");
  return `
    <div class="top"><span>‹</span><span>501 · First to 3 · Leg 2</span><span>⋯</span></div>
    ${cards}
    <div class="turn">
      <div class="chips">${chips(state.turn, size.hand.chip.size)}</div>
      <div class="total num" style="font-size:${size.hand.turnTotal.size}px">= ${total}</div>
    </div>
    <div class="pad">
      <div class="mult"><span class="on">SINGLE</span><span class="dblk">DOUBLE</span><span class="tplk">TREBLE</span></div>
      <div class="grid">${keys}</div>
      <div class="grid"><span class="k fn">UNDO</span><span class="k fn">MISS</span><span class="k mic">🎤</span><span class="k num">25</span><span class="k num">BULL</span></div>
    </div>`;
}

function renderDistance(): string {
  const total = state.turn.reduce((sum, d) => sum + dartValue(d), 0);
  const othersSize =
    state.players <= 4
      ? size.distance.remainingOther.size
      : size.distance.remainingOther5to8.size;
  return `
    <div class="top"><span>501 · Leg 2</span><span>☀︎ ⋯</span></div>
    <div class="dhead"><span class="pn">▶ ${playerName(0)}</span><span class="legs">legs 1</span></div>
    <div class="hero num" style="font-size:min(${size.distance.remainingActive.size}px, calc((100vw - 56px) / 1.2))">${state.active.remaining}</div>
    <div class="chips route">${state.active.route.length ? chips(state.active.route, size.distance.checkoutHint.size) : '<span class="muted">no checkout</span>'}</div>
    <div class="chips">${chips(state.turn, size.distance.chip.size)}</div>
    <div class="total num" style="font-size:${size.distance.turnTotal.size}px">= ${total}</div>
    <div class="others">${state.others
      .slice(0, state.players - 1)
      .map(
        (o, i) =>
          `<span><span class="pn">${playerName(i + 1)}</span> <span class="num" style="font-size:${othersSize}px">${o.remaining}</span></span>`,
      )
      .join("")}</div>
    <div class="bar"><span>Undo</span><span>● Listening…</span><span>Keypad ▴</span></div>`;
}

function render(): void {
  applyTheme(state.theme);
  screenEl.dataset.view = state.view;
  screenEl.innerHTML = state.view === "hand" ? renderHand() : renderDistance();
  for (const [id, label] of [
    ["t-view", state.view === "hand" ? "Hand view" : "Distance view"],
    ["t-theme", state.theme === "dark" ? "Chalk (dark)" : "Whiteboard (light)"],
    ["t-players", `${state.players} players`],
  ] as const) {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  }
}

function shuffle(): void {
  state.active = pick(SAMPLES);
  state.others = [pick(SAMPLES), pick(SAMPLES), pick(SAMPLES)];
  state.turn = pick(TURNS);
  render();
}

// ---------- checks ----------
const loadChecks = (): Check[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Check[];
  } catch {
    return [];
  }
};
let checks = loadChecks();
let answers: Record<string, Answer> = Object.fromEntries(
  CHECK_KEYS.map((k) => [k, null]),
);

function renderChecks(): void {
  const list = document.getElementById("checks") as HTMLElement;
  list.replaceChildren(
    ...CHECK_KEYS.map((key) => {
      const row = document.createElement("div");
      row.className = "row small";
      const label = document.createElement("span");
      label.textContent = key;
      label.style.minWidth = "9em";
      row.append(label);
      for (const value of ["yes", "no"] as const) {
        const b = document.createElement("button");
        b.textContent = value === "yes" ? "✓ readable" : "✗ not";
        b.className = answers[key] === value ? "primary" : "";
        b.addEventListener("click", () => {
          answers = { ...answers, [key]: value };
          renderChecks();
        });
        row.append(b);
      }
      return row;
    }),
  );
  const log = document.getElementById("check-log") as HTMLElement;
  log.textContent = checks
    .map(
      (c) =>
        `${c.view}/${c.theme}/${c.players}p/${c.light}: ${Object.entries(
          c.answers,
        )
          .map(([k, v]) => `${k} ${v ?? "?"}`)
          .join(", ")}`,
    )
    .join("\n");
}

document.getElementById("save-check")?.addEventListener("click", () => {
  const light = (document.getElementById("light") as HTMLSelectElement).value;
  checks = [
    ...checks,
    {
      at: new Date().toISOString(),
      view: state.view,
      theme: state.theme,
      players: state.players,
      light,
      answers,
    },
  ];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checks));
  } catch {
    // keep in memory only
  }
  answers = Object.fromEntries(CHECK_KEYS.map((k) => [k, null]));
  renderChecks();
  shuffle();
});

document.getElementById("copy-checks")?.addEventListener("click", async () => {
  const text = JSON.stringify({
    readability: checks,
    userAgent: navigator.userAgent,
    screen: `${screen.width}×${screen.height}`,
  });
  const status = document.getElementById("check-status") as HTMLElement;
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Copied. Paste it into the chat.";
  } catch {
    status.textContent = text;
  }
});

document.getElementById("t-view")?.addEventListener("click", () => {
  state.view = state.view === "hand" ? "distance" : "hand";
  render();
});
document.getElementById("t-theme")?.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  render();
});
document.getElementById("t-players")?.addEventListener("click", () => {
  state.players = state.players === 2 ? 4 : 2;
  render();
});
document.getElementById("t-shuffle")?.addEventListener("click", shuffle);
screenEl.addEventListener("click", shuffle);

render();
renderChecks();
