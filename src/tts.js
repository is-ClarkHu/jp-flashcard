// Pluggable audio layer. The app ships six VOICEVOX voices (see speakers.js).
// A card may carry pre-generated mp3s in card.audio = { <speakerKey>: path }.
// playSpeaker(card, key) plays that voice's mp3 if present, else falls back to
// the browser Web Speech API (ja-JP). resolveSpeaker() decides which voice to
// use for auto-play (fixed default or random-per-card), unless the user tapped
// a specific voice on the card.

import { SPEAKERS } from "./speakers.js";

// Re-export so views can pull the voice list from the audio layer.
export { SPEAKERS };

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

let currentAudio = null;
function playMp3(path) {
  return new Promise((resolve) => {
    const audio = new Audio(`./${path}`);
    currentAudio = audio;
    const done = (ok) => {
      if (currentAudio === audio) currentAudio = null;
      resolve(ok);
    };
    audio.onended = () => done(true);
    audio.onerror = () => done(false);
    audio.play().catch(() => done(false));
  });
}

// Speak the reading if present, else the written form.
function spokenText(card) {
  return card.reading || card.front;
}

// Play a card with a specific voice. Uses the pre-generated mp3 if the card has
// one for that voice; otherwise falls back to the browser's Japanese TTS.
export function playSpeaker(card, speakerKey, settings = {}) {
  const path = card && card.audio && card.audio[speakerKey];
  if (path) return playMp3(path);
  return speak(spokenText(card), settings);
}

// Which voice to use when the user hasn't tapped one on the card:
// explicit override > random-per-card (voiceMode) > fixed default.
export function resolveSpeaker(settings = {}, override) {
  if (override) return override;
  if (settings.voiceMode === "random") {
    return SPEAKERS[Math.floor(Math.random() * SPEAKERS.length)].key;
  }
  return settings.defaultSpeaker || SPEAKERS[0].key;
}

export function stopSpeech() {
  if (synth) synth.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}
