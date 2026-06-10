// Pluggable audio layer. Each speaker button maps to a provider behind one
// interface: provider.play(card, settings) -> Promise<boolean> (true = audible).
//
// Phase 1 (now): both providers fall back to the browser Web Speech API (ja-JP).
// Phase 2 (later): "anime" plays a pre-generated VOICEVOX mp3 from card.audio_anime;
// "announcer" keeps the system voice with a reserved Azure-neural slot
// (card.audio_announcer). The UI never assumes a specific engine.

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

let voices = [];
function refreshVoices() {
  voices = synth ? synth.getVoices() : [];
}
if (synth) {
  refreshVoices();
  synth.addEventListener("voiceschanged", refreshVoices);
}

export function speechAvailable() {
  return !!synth;
}

export function japaneseVoiceAvailable() {
  return voices.some((v) => /^ja\b|ja-JP|japanese/i.test(v.lang + " " + v.name));
}

function pickJapaneseVoice() {
  return voices.find((v) => /^ja\b|ja-JP/i.test(v.lang)) || null;
}

function speak(text, { speechRate = 1.0 } = {}) {
  if (!synth || !text) return Promise.resolve(false);
  return new Promise((resolve) => {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = Math.min(1.5, Math.max(0.5, speechRate));
    const v = pickJapaneseVoice();
    if (v) u.voice = v;
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    synth.speak(u);
  });
}

function playMp3(path) {
  return new Promise((resolve) => {
    const audio = new Audio(`./${path}`);
    audio.onended = () => resolve(true);
    audio.onerror = () => resolve(false);
    audio.play().catch(() => resolve(false));
  });
}

// Speak the reading if present, else the written form.
function spokenText(card) {
  return card.reading || card.front;
}

// Provider registry — config-driven, not hardcoded in the UI.
export const PROVIDERS = [
  {
    id: "anime",
    label: "Anime",
    play(card, settings) {
      if (card.audio_anime) return playMp3(card.audio_anime); // Phase 2
      return speak(spokenText(card), settings);
    },
  },
  {
    id: "announcer",
    label: "Announcer",
    play(card, settings) {
      if (card.audio_announcer) return playMp3(card.audio_announcer); // reserved (Azure)
      return speak(spokenText(card), settings);
    },
  },
];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

export function stopSpeech() {
  if (synth) synth.cancel();
}
