/** Tiny DOM helpers. All dynamic text goes through textContent, never innerHTML. */

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export const setText = (id: string, text: string): void => {
  $(id).textContent = text;
};

export const show = (id: string, visible: boolean): void => {
  $(id).hidden = !visible;
};

export const fmtMs = (ms: number | null): string =>
  ms === null
    ? "–"
    : ms >= 1000
      ? `${(ms / 1000).toFixed(1)} s`
      : `${Math.round(ms)} ms`;

export const fmtPct = (x: number | null): string =>
  x === null ? "–" : `${Math.round(x * 100)}%`;

export const fmtClock = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
