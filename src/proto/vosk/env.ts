/** Feature detection and environment snapshot for the report. */

export interface EnvSnapshot {
  readonly at: string;
  readonly userAgent: string;
  readonly isIOS: boolean;
  readonly standalone: boolean;
  readonly webSpeech: boolean;
  readonly audioWorklet: boolean;
  readonly wasm: boolean;
  readonly wakeLock: boolean;
  readonly speechSynthesis: boolean;
  readonly mediaDevices: boolean;
  readonly micPermission: string;
  readonly storageQuotaMB: number | null;
  readonly storageUsageMB: number | null;
  readonly storagePersisted: boolean | null;
  readonly screen: string;
  readonly devicePixelRatio: number;
  readonly cores: number | null;
  readonly language: string;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true || matchMedia("(display-mode: standalone)").matches
  );
}

export function hasWebSpeech(): boolean {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

/** 'granted' | 'denied' | 'prompt' | 'unsupported' — read without triggering a prompt. */
export async function micPermissionState(): Promise<string> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    return "unsupported";
  }
}

/** Whether vosk-browser's IndexedDB store already exists (null if the browser can't tell). */
/**
 * Whether a fully unpacked model is already cached (null if the browser can't tell).
 * vosk-browser creates its "/vosk" IndexedDB before downloading, so the database alone
 * proves nothing; the "extracted.ok" marker is written only after a successful unpack.
 */
export async function hasVoskCache(): Promise<boolean | null> {
  try {
    if (typeof indexedDB.databases !== "function") return null;
    const dbs = await indexedDB.databases();
    if (!dbs.some((db) => db.name === "/vosk")) return false;
    return await new Promise<boolean | null>((resolve) => {
      const req = indexedDB.open("/vosk");
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        const done = (value: boolean | null) => {
          db.close();
          resolve(value);
        };
        try {
          if (!db.objectStoreNames.contains("FILE_DATA")) return done(false);
          const keys = db
            .transaction("FILE_DATA", "readonly")
            .objectStore("FILE_DATA")
            .getAllKeys();
          keys.onsuccess = () =>
            done(keys.result.some((k) => String(k).endsWith("/extracted.ok")));
          keys.onerror = () => done(null);
        } catch {
          done(null);
        }
      };
    });
  } catch {
    return null;
  }
}

const toMB = (bytes: number | undefined): number | null =>
  bytes === undefined ? null : Math.round(bytes / 1e5) / 10;

export async function snapshotEnv(): Promise<EnvSnapshot> {
  let quota: number | undefined;
  let usage: number | undefined;
  let persisted: boolean | null = null;
  try {
    const est = await navigator.storage?.estimate();
    quota = est?.quota;
    usage = est?.usage;
    persisted = (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    // storage API unavailable
  }
  return {
    at: new Date().toISOString(),
    userAgent: navigator.userAgent,
    isIOS: isIOS(),
    standalone: isStandalone(),
    webSpeech: hasWebSpeech(),
    audioWorklet: typeof AudioWorkletNode !== "undefined",
    wasm: typeof WebAssembly === "object",
    wakeLock: "wakeLock" in navigator,
    speechSynthesis: "speechSynthesis" in window,
    mediaDevices: !!navigator.mediaDevices?.getUserMedia,
    micPermission: await micPermissionState(),
    storageQuotaMB: toMB(quota),
    storageUsageMB: toMB(usage),
    storagePersisted: persisted,
    screen: `${screen.width}×${screen.height}`,
    devicePixelRatio: devicePixelRatio,
    cores: navigator.hardwareConcurrency ?? null,
    language: navigator.language,
  };
}
