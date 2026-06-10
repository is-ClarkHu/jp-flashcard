// Lightweight settings store (localStorage for now). The full settings UI and
// IndexedDB-backed persistence arrive with later modules; this gives the rest of
// the app a single place to read/write preferences.

const KEY = "settings";

const DEFAULTS = {
  defaultFace: "front", // "front" = Japanese-first, "back" = meaning-first
  speechRate: 1.0, // 0.5 – 1.5
  autoPlay: false, // auto-speak on flip
  autoSpeaker: "announcer", // which provider auto-plays
  uiLanguage: "en",
  explainLang: "en", // ZH / EN / JP toggle for explanations
  explainProvider: "claude", // which LLM powers "Explain deeper"
  apiKeys: {}, // per-provider keys (local only): { claude, openai, gemini, deepseek, moonshot, mistral }
  models: {}, // optional per-provider model overrides
  theme: "light",
  profileName: "", // names this progress profile; travels with exported data
  lastImportAt: "", // ISO timestamp of the last progress import
  activeAccountId: "", // which account's data is currently live
  timerEnabled: false, // self-test per-card countdown
  timerSeconds: 10, // seconds before auto-flip + mark wrong
  roundThreshold: 0.9, // each list's last-test accuracy must reach this to advance a course round
};

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}

// Replace the whole settings object (used by progress import).
export function setSettings(obj) {
  localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, ...obj }));
}
