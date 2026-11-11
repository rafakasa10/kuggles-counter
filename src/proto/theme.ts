import tokens from "../ui/theme/chalk.json";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";

export type ThemeName = "dark" | "light";

const STORAGE_KEY = "kc-theme";
const toCssName = (key: string): string =>
  `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;

/** Applies a Chalk theme by writing every token as a CSS custom property on <html>. */
export function applyTheme(name: ThemeName): void {
  const theme = tokens.themes[name];
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme))
    root.style.setProperty(toCssName(key), value);
  root.dataset.theme = name;
  root.style.colorScheme = name;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme.bg);
}

export function preferredTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // storage unavailable (private mode): fall back to the system setting
  }
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function saveTheme(name: ThemeName): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // not persisted; the choice still applies for this visit
  }
}
