// The six VOICEVOX voices shipped with the app. `styleId` is the VOICEVOX style
// id that convert.py --tts uses to synthesize every word; `key` names both the
// per-card audio file (data/<course>/audio/<id>/<key>.mp3) and the saved voice
// preference. Keep this list in sync with the SPEAKERS table in convert.py.
export const SPEAKERS = [
  { key: "aoyama", label: "青山龍星", styleId: 13, desc: "Calm male" },
  { key: "kyushu", label: "九州そら", styleId: 17, desc: "Mellow lady" },
  { key: "yurei", label: "ユーレイちゃん", styleId: 103, desc: "Cute" },
  { key: "zunda", label: "ずんだもん", styleId: 3, desc: "Lively" },
  { key: "no7", label: "No.7", styleId: 30, desc: "Announcer" },
  { key: "metan", label: "四国めたん", styleId: 6, desc: "Tsundere" },
];

export const SPEAKER_KEYS = SPEAKERS.map((s) => s.key);

export function speakerLabel(key) {
  const s = SPEAKERS.find((x) => x.key === key);
  return s ? s.label : key;
}
