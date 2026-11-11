import type { PluginOption } from "vite";
import { defineConfig } from "vitest/config";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "node:path";

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/kuggles-counter/").
// HTTPS=1 serves a self-signed cert on the LAN so the iPhone mic works during dev.
const base = process.env.BASE_PATH ?? "/";
const plugins: PluginOption[] = process.env.HTTPS === "1" ? [basicSsl()] : [];

export default defineConfig({
  base,
  plugins,
  build: {
    target: "es2022",
    // vosk-browser is one 5.8 MB file (WASM inlined); it is lazy-loaded on "Load model".
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        vosk: resolve(import.meta.dirname, "proto/vosk/index.html"),
        readability: resolve(import.meta.dirname, "readability/index.html"),
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/voice/**", "src/proto/vosk/score.ts"],
    },
  },
});
