// Generator for the static kana datasets (data/kana/hiragana.json,
// data/kana/katakana.json). Kana is a fixed, closed, self-authored set — there
// is no scraping and convert.py is not involved. This script is the source of
// truth so the (error-prone) Hepburn romaji and the parallel hira/kata tables
// stay correct and regenerable. Run: `node scripts/gen-kana.mjs`.
//
// Each emitted kana entry:
//   { id, kana, romaji, type, row, col, script, audio, origin, mnemonic, lookalikes }
// id = "{script}:{kana}" (unique & stable). audio is null in audio Phase 1
// (browser TTS reads `kana`); a future `--tts` pass can fill mp3 paths.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const outDir = path.join(root, "data", "kana");

// --- gojūon seion grid (rows a/ka/sa/.../wa + n) -------------------------
// Each row: [rowKey, [ [kana, romaji] x5 ]]. null = an empty cell in the grid
// (e.g. ya-row yi/ye, wa-row wi/we). The vowel header is a i u e o.
const VOWELS = ["a", "i", "u", "e", "o"];

const HIRA_SEION = [
  ["a", [["あ", "a"], ["い", "i"], ["う", "u"], ["え", "e"], ["お", "o"]]],
  ["ka", [["か", "ka"], ["き", "ki"], ["く", "ku"], ["け", "ke"], ["こ", "ko"]]],
  ["sa", [["さ", "sa"], ["し", "shi"], ["す", "su"], ["せ", "se"], ["そ", "so"]]],
  ["ta", [["た", "ta"], ["ち", "chi"], ["つ", "tsu"], ["て", "te"], ["と", "to"]]],
  ["na", [["な", "na"], ["に", "ni"], ["ぬ", "nu"], ["ね", "ne"], ["の", "no"]]],
  ["ha", [["は", "ha"], ["ひ", "hi"], ["ふ", "fu"], ["へ", "he"], ["ほ", "ho"]]],
  ["ma", [["ま", "ma"], ["み", "mi"], ["む", "mu"], ["め", "me"], ["も", "mo"]]],
  ["ya", [["や", "ya"], null, ["ゆ", "yu"], null, ["よ", "yo"]]],
  ["ra", [["ら", "ra"], ["り", "ri"], ["る", "ru"], ["れ", "re"], ["ろ", "ro"]]],
  ["wa", [["わ", "wa"], null, null, null, ["を", "wo"]]],
  ["n", [["ん", "n"], null, null, null, null]],
];

const KATA_SEION = [
  ["a", [["ア", "a"], ["イ", "i"], ["ウ", "u"], ["エ", "e"], ["オ", "o"]]],
  ["ka", [["カ", "ka"], ["キ", "ki"], ["ク", "ku"], ["ケ", "ke"], ["コ", "ko"]]],
  ["sa", [["サ", "sa"], ["シ", "shi"], ["ス", "su"], ["セ", "se"], ["ソ", "so"]]],
  ["ta", [["タ", "ta"], ["チ", "chi"], ["ツ", "tsu"], ["テ", "te"], ["ト", "to"]]],
  ["na", [["ナ", "na"], ["ニ", "ni"], ["ヌ", "nu"], ["ネ", "ne"], ["ノ", "no"]]],
  ["ha", [["ハ", "ha"], ["ヒ", "hi"], ["フ", "fu"], ["ヘ", "he"], ["ホ", "ho"]]],
  ["ma", [["マ", "ma"], ["ミ", "mi"], ["ム", "mu"], ["メ", "me"], ["モ", "mo"]]],
  ["ya", [["ヤ", "ya"], null, ["ユ", "yu"], null, ["ヨ", "yo"]]],
  ["ra", [["ラ", "ra"], ["リ", "ri"], ["ル", "ru"], ["レ", "re"], ["ロ", "ro"]]],
  ["wa", [["ワ", "wa"], null, null, null, ["ヲ", "wo"]]],
  ["n", [["ン", "n"], null, null, null, null]],
];

// dakuon / handakuon rows (parallel hira/kata, same romaji)
const DAKUON = [
  ["ga", [["が", "ga"], ["ぎ", "gi"], ["ぐ", "gu"], ["げ", "ge"], ["ご", "go"]], [["ガ", "ga"], ["ギ", "gi"], ["グ", "gu"], ["ゲ", "ge"], ["ゴ", "go"]]],
  ["za", [["ざ", "za"], ["じ", "ji"], ["ず", "zu"], ["ぜ", "ze"], ["ぞ", "zo"]], [["ザ", "za"], ["ジ", "ji"], ["ズ", "zu"], ["ゼ", "ze"], ["ゾ", "zo"]]],
  ["da", [["だ", "da"], ["ぢ", "ji"], ["づ", "zu"], ["で", "de"], ["ど", "do"]], [["ダ", "da"], ["ヂ", "ji"], ["ヅ", "zu"], ["デ", "de"], ["ド", "do"]]],
  ["ba", [["ば", "ba"], ["び", "bi"], ["ぶ", "bu"], ["べ", "be"], ["ぼ", "bo"]], [["バ", "ba"], ["ビ", "bi"], ["ブ", "bu"], ["ベ", "be"], ["ボ", "bo"]]],
];
const HANDAKUON = [
  ["pa", [["ぱ", "pa"], ["ぴ", "pi"], ["ぷ", "pu"], ["ぺ", "pe"], ["ぽ", "po"]], [["パ", "pa"], ["ピ", "pi"], ["プ", "pu"], ["ペ", "pe"], ["ポ", "po"]]],
];

// yōon (i-row consonant + small ya/yu/yo). [hira3, kata3, romaji3]
const YOON = [
  [["きゃ", "きゅ", "きょ"], ["キャ", "キュ", "キョ"], ["kya", "kyu", "kyo"]],
  [["しゃ", "しゅ", "しょ"], ["シャ", "シュ", "ショ"], ["sha", "shu", "sho"]],
  [["ちゃ", "ちゅ", "ちょ"], ["チャ", "チュ", "チョ"], ["cha", "chu", "cho"]],
  [["にゃ", "にゅ", "にょ"], ["ニャ", "ニュ", "ニョ"], ["nya", "nyu", "nyo"]],
  [["ひゃ", "ひゅ", "ひょ"], ["ヒャ", "ヒュ", "ヒョ"], ["hya", "hyu", "hyo"]],
  [["みゃ", "みゅ", "みょ"], ["ミャ", "ミュ", "ミョ"], ["mya", "myu", "myo"]],
  [["りゃ", "りゅ", "りょ"], ["リャ", "リュ", "リョ"], ["rya", "ryu", "ryo"]],
  [["ぎゃ", "ぎゅ", "ぎょ"], ["ギャ", "ギュ", "ギョ"], ["gya", "gyu", "gyo"]],
  [["じゃ", "じゅ", "じょ"], ["ジャ", "ジュ", "ジョ"], ["ja", "ju", "jo"]],
  [["びゃ", "びゅ", "びょ"], ["ビャ", "ビュ", "ビョ"], ["bya", "byu", "byo"]],
  [["ぴゃ", "ぴゅ", "ぴょ"], ["ピャ", "ピュ", "ピョ"], ["pya", "pyu", "pyo"]],
];

// --- accepted romaji alternates (for the auto-grader) --------------------
// Canonical is Hepburn; we also accept common kunrei / wāpuro spellings.
const ALT = {
  shi: ["si"], chi: ["ti"], tsu: ["tu"], fu: ["hu"],
  sha: ["sya"], shu: ["syu"], sho: ["syo"],
  cha: ["tya"], chu: ["tyu"], cho: ["tyo"],
  ja: ["jya", "zya"], ju: ["jyu", "zyu"], jo: ["jyo", "zyo"],
  n: ["nn", "n'"],
};
// kana-specific extra accepts that romaji alone can't disambiguate.
const KANA_ALT = {
  じ: ["zi"], を: ["o"], ぢ: ["di", "zi"], づ: ["du"],
  ヲ: ["o"], ヂ: ["di", "zi"], ヅ: ["du"],
};
function acceptsFor(kana, romaji) {
  const set = new Set([romaji, ...(ALT[romaji] || []), ...(KANA_ALT[kana] || [])]);
  return [...set];
}

// --- glyph origins (字源) -------------------------------------------------
const ORIGIN_HIRA = {
  あ: "安", い: "以", う: "宇", え: "衣", お: "於",
  か: "加", き: "幾", く: "久", け: "計", こ: "己",
  さ: "左", し: "之", す: "寸", せ: "世", そ: "曽",
  た: "太", ち: "知", つ: "川", て: "天", と: "止",
  な: "奈", に: "仁", ぬ: "奴", ね: "祢", の: "乃",
  は: "波", ひ: "比", ふ: "不", へ: "部", ほ: "保",
  ま: "末", み: "美", む: "武", め: "女", も: "毛",
  や: "也", ゆ: "由", よ: "与",
  ら: "良", り: "利", る: "留", れ: "礼", ろ: "呂",
  わ: "和", を: "遠", ん: "无",
};
const ORIGIN_KATA = {
  ア: "阿", イ: "伊", ウ: "宇", エ: "江", オ: "於",
  カ: "加", キ: "幾", ク: "久", ケ: "介", コ: "己",
  サ: "散", シ: "之", ス: "須", セ: "世", ソ: "曽",
  タ: "多", チ: "千", ツ: "川", テ: "天", ト: "止",
  ナ: "奈", ニ: "二", ヌ: "奴", ネ: "祢", ノ: "乃",
  ハ: "八", ヒ: "比", フ: "不", ヘ: "部", ホ: "保",
  マ: "末", ミ: "三", ム: "牟", メ: "女", モ: "毛",
  ヤ: "也", ユ: "由", ヨ: "與",
  ラ: "良", リ: "利", ル: "流", レ: "礼", ロ: "呂",
  ワ: "和", ヲ: "乎", ン: "尔",
};

// --- mnemonics (short English memory hooks) -------------------------------
const MNEMONIC_HIRA = {
  あ: "An 'A' with a curl — like a figure doing a cartwheel.",
  い: "Two strokes like two 'ee!' eels swimming.",
  う: "A person bowing — 'oo, my back!'",
  え: "A swirling 'eh?' — like an exotic bird's neck.",
  お: "Looks like 'o' with a tail — an octopus.",
  か: "A 'ka'-r (car) with a flag — か.",
  き: "A key (ki) shape hanging down.",
  く: "A cuckoo's open beak — く.",
  け: "A keg lying on its side.",
  こ: "Two 'co'-rds lying flat.",
  さ: "Looks like 'sa' — a smiling mouth with a tongue.",
  し: "A single fishing hook — 'she' caught a fish.",
  す: "A swirl with a loop — a 'swing'.",
  せ: "Looks like 'say' — a face saying it.",
  そ: "A zig-zag 'so' — sewing thread.",
  た: "A 't' plus a small mark — 'ta-da!'",
  ち: "Mirror of さ — a cheerful cheek (chi).",
  つ: "A wave shape — 'tsu'-nami curl.",
  て: "A hand pointing — 'te' (hand) in Japanese too.",
  と: "A toe with a thorn poking it.",
  な: "A complex knot — 'na'.",
  に: "Two lines plus a hook — 'knee'.",
  ぬ: "Noodles (nu) twirled on chopsticks.",
  ね: "A cat's tail loop — 'ne~' (meow).",
  の: "A single spiral 'no' — a swirl of dough.",
  は: "An 'h' with a flag — 'ha!'",
  ひ: "A smiling mouth — 'hee hee'.",
  ふ: "Mount Fuji's smoky outline — 'fu'.",
  へ: "A gentle hill slope — 'he'.",
  ほ: "は plus an extra bar — 'ho ho ho'.",
  ま: "A 'ma'-ze with a loop at the bottom.",
  み: "A number 21-ish swirl — 'me' counting.",
  む: "A cow saying 'muu' with a tail.",
  め: "ぬ's cousin — an eye (me).",
  も: "A fish hook with two crossbars — fishing for 'mo're'.",
  や: "A yacht with a sail — 'ya'.",
  ゆ: "A fish/loop — 'you' unique shape.",
  よ: "A yo-yo on a string.",
  ら: "A person sitting — 'la-la-la'.",
  り: "Two strokes like a dripping faucet — 'ri'.",
  る: "A loop at the bottom — a 'route' that curls.",
  れ: "Like る but the tail flicks out — 're'.",
  ろ: "る without the loop — a 'road' square.",
  わ: "Like ね/れ but with a rounded loop — 'wa'.",
  を: "A complex 'wo' — only used as the object particle.",
  ん: "A single 'n' squiggle — like a lowercase n.",
};
const MNEMONIC_KATA = {
  ア: "An 'A'-frame with a flag.",
  イ: "Two strokes leaning — an 'ee'gle's beak.",
  ウ: "A roof with a hook — 'oo'.",
  エ: "An 'E' / 工 shape (engineering).",
  オ: "An 'O' with a kick — like 'oh!'",
  カ: "Same idea as か — a 'car' corner.",
  キ: "A 'key' with two prongs.",
  ク: "An open mouth corner — 'ku'.",
  ケ: "A 'k' with a slash.",
  コ: "An open box — two 'co'-rners.",
  サ: "Like さ straightened — three strokes.",
  シ: "Two dots + an up-stroke — strokes go bottom-up (vs ツ).",
  ス: "A figure sitting — 'soo'.",
  セ: "A 'C' with a bar — 'se'.",
  ソ: "One dot + a down-stroke — top-down (vs ン).",
  タ: "Like ク with a stroke — 'ta'.",
  チ: "A 'ch'air seen sideways.",
  ツ: "Three strokes, two dots side-by-side; written top-down.",
  テ: "A 'T' with extra bars.",
  ト: "A 'T' minus an arm — toe.",
  ナ: "A 't' cross — 'na'.",
  ニ: "Two bars = 'ni' (2).",
  ヌ: "Like ス with a slash — noodles.",
  ネ: "A 't' plus marks — cat 'ne'.",
  ノ: "A single down-stroke — 'no'.",
  ハ: "Two strokes apart — 八 (eight), 'ha'.",
  ヒ: "An 'E'-ish hook — 'hee'.",
  フ: "A single hook — Fuji.",
  ヘ: "Same as へ — a hill.",
  ホ: "A 'tree' 木-like shape — 'ho'.",
  マ: "A check-mark loop — 'ma'.",
  ミ: "Three strokes = 三-like — 'mi' (3).",
  ム: "A small mouth corner — 'muu'.",
  メ: "An 'X' — crossed eyes (me).",
  モ: "Like も straightened.",
  ヤ: "A 'Y'-ish yacht.",
  ユ: "A 'U' tray — 'you'.",
  ヨ: "Three bars like a comb — 'yo'.",
  ラ: "A flag on a pole — 'la'.",
  リ: "Two strokes like り — 'ri'.",
  ル: "A loop kick — 'route'.",
  レ: "A single check-mark — 're'.",
  ロ: "A square box — 'ro'.",
  ワ: "An open-top box — 'wa' (vs ク/ケ).",
  ヲ: "A bar with a hook — rare 'wo'.",
  ン: "One dot + an up-stroke — bottom-up (vs ソ).",
};

// --- look-alike confusion groups (per script) ----------------------------
// Each group: { g:[kana...], tip:{zh,en,ja} } — the tip is a concrete, localized
// "how to tell them apart" note (the highest-value memory aid for confusables).
const CONFUSION_HIRA = [
  { g: ["ね", "れ", "わ"], tip: { zh: "ね 右下打一个圈;れ 直直甩出去不打圈;わ 右边是圆鼓鼓的肚子。", en: "ね curls into a loop at the lower right; れ flicks straight out (no loop); わ has a round belly.", ja: "ねは右下が輪になる、れは跳ねるだけ、わは右が丸い。" } },
  { g: ["は", "ほ"], tip: { zh: "ほ = は 再加最上面一横。", en: "ほ is は with one extra horizontal stroke on top.", ja: "ほは「は」に上の横棒を一本足した形。" } },
  { g: ["は", "ま"], tip: { zh: "は 左边有一条竖;ま 是两横加一竖、下面收成圈。", en: "は has a vertical stroke on the left; ま has two horizontals ending in a loop.", ja: "はは左に縦棒、まは横二本＋下が輪。" } },
  { g: ["さ", "き"], tip: { zh: "き 比 さ 多一横。", en: "き has one more horizontal stroke than さ.", ja: "きは「さ」より横棒が一本多い。" } },
  { g: ["さ", "ち"], tip: { zh: "さ 与 ち 左右镜像;ち 的钩朝右下,さ 朝左。", en: "さ and ち are mirror images; ち hooks to the lower-right, さ to the left.", ja: "さとちは左右対称、ちは右下に曲がる。" } },
  { g: ["る", "ろ"], tip: { zh: "る 末尾打个圈,ろ 不打圈直接收。", en: "る ends in a loop; ろ has no loop.", ja: "るは最後に輪、ろは輪なし。" } },
  { g: ["ぬ", "め"], tip: { zh: "ぬ 末尾打圈(像打结),め 不打圈。", en: "ぬ ends in a loop; め does not.", ja: "ぬは最後が輪、めは輪なし。" } },
  { g: ["あ", "お"], tip: { zh: "あ 右边是封口的圈;お 右上有一点、不封口。", en: "あ has a closed loop on the right; お has a dot top-right and no closed loop.", ja: "あは右が閉じた輪、おは右上に点。" } },
  { g: ["い", "り"], tip: { zh: "い 两笔分得开、都往上翘;り 两笔靠近、右笔长而下垂。", en: "い's two strokes spread apart; り's are closer and the right one drops longer.", ja: "いは二画が離れる、りは近く右が長い。" } },
  { g: ["く", "へ"], tip: { zh: "く 是竖向的折角(开口朝右);へ 是横向的平缓山坡。", en: "く is a vertical angle opening right; へ is a shallow horizontal hill.", ja: "くは縦の折れ、へは横の山。" } },
  { g: ["つ", "し"], tip: { zh: "つ 是横向的弧(开口朝下);し 是竖向的钩(开口朝右)。", en: "つ is a horizontal curve; し is a vertical hook.", ja: "つは横の曲線、しは縦のかぎ。" } },
  { g: ["そ", "ろ"], tip: { zh: "そ 上面有「之」字折线,ろ 没有。", en: "そ has a zig-zag top; ろ does not.", ja: "そは上にジグザグ、ろはなし。" } },
  { g: ["す", "む"], tip: { zh: "す 圈小、收尾直下;む 末尾打圈且带一点。", en: "す has a small loop and a straight tail; む ends in a loop with a dot.", ja: "すは小さな輪、むは点付きで輪。" } },
  { g: ["な", "た"], tip: { zh: "な 右下打圈;た 右边是「こ」状、不打圈。", en: "な has a loop bottom-right; た's right side is two strokes, no loop.", ja: "なは右下に輪、たは輪なし。" } },
  { g: ["こ", "に"], tip: { zh: "に = こ 再加左边一竖。", en: "に is こ with a vertical stroke added on the left.", ja: "にはこに左の縦棒を足した形。" } },
];
const CONFUSION_KATA = [
  { g: ["シ", "ツ"], tip: { zh: "シ 两点竖排、第三笔由下往上挑;ツ 两点横排、第三笔由上往下撇。", en: "シ's dots stack vertically and the stroke sweeps up; ツ's dots sit side-by-side and the stroke goes down.", ja: "シは点が縦・下から上へ、ツは点が横・上から下へ。" } },
  { g: ["ソ", "ン"], tip: { zh: "ソ 第二笔由上往下;ン 第二笔由下往上挑。", en: "ソ's stroke goes top-down; ン's sweeps bottom-up.", ja: "ソは上から下、ンは下から上へ。" } },
  { g: ["ノ", "ソ", "ン"], tip: { zh: "ノ 只有一撇;ソ 加一点(往下);ン 加一点(往上)。", en: "ノ is a single stroke; ソ adds a downward dot; ン adds an upward dot.", ja: "ノは一画、ソ・ンは点の向きで区別。" } },
  { g: ["ク", "ワ", "ケ"], tip: { zh: "ク 带钩(像 9);ワ 开口大、无钩、底圆;ケ 多一斜撇穿出。", en: "ク has a hooked corner; ワ is open with no hook; ケ has an extra slash.", ja: "クはかぎ付き、ワは開いて鉤なし、ケは斜め棒あり。" } },
  { g: ["ア", "マ"], tip: { zh: "ア 的撇与主体分开;マ 是连成一笔的折(像对勾)。", en: "ア has a separate hooked stroke; マ is one connected check-mark.", ja: "アは離れた鉤、マは一筆のチェック。" } },
  { g: ["ナ", "メ"], tip: { zh: "ナ 是十字(横+竖撇);メ 是交叉两撇(像 X)。", en: "ナ is a cross; メ is two crossing strokes (like X).", ja: "ナは十字、メは交差。" } },
  { g: ["チ", "テ"], tip: { zh: "チ 像「千」、末笔竖钩穿下;テ 竖在正中、不带大钩。", en: "チ ends in a long vertical hook (like 千); テ has a centered vertical with no big hook.", ja: "チは縦のかぎ、テは真ん中に縦棒。" } },
  { g: ["ス", "ヌ", "フ"], tip: { zh: "フ 只有一折;ス 在フ下加一撇;ヌ 在フ下加交叉一捺。", en: "フ is one bend; ス adds a stroke below; ヌ adds a crossing stroke.", ja: "フは一画、スは下に一画、ヌは交差を足す。" } },
  { g: ["コ", "ユ"], tip: { zh: "コ 开口朝右;ユ 开口朝上、底横长。", en: "コ opens to the right; ユ opens upward with a long base.", ja: "コは右が開く、ユは上が開く。" } },
  { g: ["ウ", "ワ"], tip: { zh: "ウ 顶上有一点(宝盖头);ワ 没有点。", en: "ウ has a dot on top; ワ does not.", ja: "ウは上に点、ワは点なし。" } },
  { g: ["ル", "レ"], tip: { zh: "ル 是两笔(右笔上翘);レ 只有一笔的钩。", en: "ル has two strokes; レ is a single hook.", ja: "ルは二画、レは一画。" } },
  { g: ["カ", "ケ"], tip: { zh: "カ 是「力」字形;ケ 多一斜撇、更斜。", en: "カ looks like 力; ケ has an extra slash and leans more.", ja: "カは「力」、ケは斜め棒付き。" } },
  { g: ["セ", "ヤ"], tip: { zh: "セ 横长、竖在右带钩往左;ヤ 是一撇加一点。", en: "セ has a long horizontal with a hooked vertical; ヤ is a stroke plus a dot.", ja: "セは横長＋鉤、ヤは点付き。" } },
];

// --- pronunciation / usage notes (localized; only the notable kana) -------
const PRON = {
  し: { zh: "讀作 shi(像英語 “she”),不是 “si”。", en: "Pronounced “shi” (like “she”), never “si”.", ja: "「し」は shi。" },
  ち: { zh: "讀作 chi(像 “cheese” 的開頭)。", en: "Pronounced “chi” (like the start of “cheese”).", ja: "「ち」は chi。" },
  つ: { zh: "讀作 tsu(像 “cats” 結尾的 ts + u),對母語非日語者較難。", en: "Pronounced “tsu” (the “ts” in “cats” + u) — tricky for English speakers.", ja: "「つ」は tsu。" },
  ふ: { zh: "介於 hu 和 fu 之間,雙唇輕送氣,上齒不碰下唇。", en: "Between “hu” and “fu” — a soft bilabial breath, teeth don't touch the lip.", ja: "「ふ」は hu と fu の中間音。" },
  ら: { zh: "ら行(ら・り・る・れ・ろ)是輕彈舌音,介於英語 r 與 l 之間。", en: "The ら-row is a light tapped sound, between English r and l.", ja: "ら行は軽くはじく音。" },
  を: { zh: "讀作 o;現代日語中只當受詞助詞用,不用來拼詞。", en: "Pronounced “o”; used only as the object-marking particle, not to spell words.", ja: "「を」は o。目的語の助詞専用。" },
  ん: { zh: "唯一的單獨輔音;絕不出現在詞首,只在詞中或詞尾(如 ほん)。", en: "The only standalone consonant; never starts a word — only mid- or word-final (e.g. ほん).", ja: "「ん」は語頭に立たない。" },
  じ: { zh: "讀作 ji;與 ぢ 同音,但 じ 常用得多。", en: "Pronounced “ji”; same sound as ぢ, but じ is far more common.", ja: "「じ」は ji。" },
  づ: { zh: "讀作 zu;與 ず 同音,づ 很少用。", en: "Pronounced “zu”; same as ず, but づ is rare.", ja: "「づ」は zu。まれ。" },
  は: { zh: "當主題助詞時讀作 wa(如 わたしは),其餘讀 ha。", en: "As the topic particle it's read “wa” (e.g. わたしは), otherwise “ha”.", ja: "助詞の「は」は wa。" },
  へ: { zh: "當方向助詞時讀作 e,其餘讀 he。", en: "As the direction particle it's read “e”, otherwise “he”.", ja: "助詞の「へ」は e。" },
};
const PRON_KATA = {
  シ: { zh: "讀作 shi。注意與 ツ 的筆順區別。", en: "Pronounced “shi”. Mind the stroke order vs ツ.", ja: "「シ」は shi。" },
  ツ: { zh: "讀作 tsu。注意與 シ 的筆順區別。", en: "Pronounced “tsu”. Mind the stroke order vs シ.", ja: "「ツ」は tsu。" },
  フ: { zh: "讀作 fu(同 ふ),雙唇輕送氣。", en: "Pronounced “fu” (like ふ), a soft bilabial breath.", ja: "「フ」は fu。" },
  ヲ: { zh: "讀作 o;現代外來語幾乎不用。", en: "Pronounced “o”; almost never used in modern loanwords.", ja: "「ヲ」は o。現代ではほぼ不使用。" },
  ン: { zh: "唯一的單獨輔音;絕不出現在詞首(如 パン)。", en: "The only standalone consonant; never starts a word (e.g. パン).", ja: "「ン」は語頭に立たない。" },
};

// --- example words (one common word per seion kana) -----------------------
// { w: word, r: kana reading, romaji, zh, en }
const EX_HIRA = {
  あ: { w: "あめ", r: "あめ", romaji: "ame", zh: "雨", en: "rain" },
  い: { w: "いぬ", r: "いぬ", romaji: "inu", zh: "狗", en: "dog" },
  う: { w: "うみ", r: "うみ", romaji: "umi", zh: "海", en: "sea" },
  え: { w: "えき", r: "えき", romaji: "eki", zh: "車站", en: "station" },
  お: { w: "おかね", r: "おかね", romaji: "okane", zh: "錢", en: "money" },
  か: { w: "かわ", r: "かわ", romaji: "kawa", zh: "河", en: "river" },
  き: { w: "きのう", r: "きのう", romaji: "kinō", zh: "昨天", en: "yesterday" },
  く: { w: "くち", r: "くち", romaji: "kuchi", zh: "嘴", en: "mouth" },
  け: { w: "けさ", r: "けさ", romaji: "kesa", zh: "今天早上", en: "this morning" },
  こ: { w: "こども", r: "こども", romaji: "kodomo", zh: "小孩", en: "child" },
  さ: { w: "さかな", r: "さかな", romaji: "sakana", zh: "魚", en: "fish" },
  し: { w: "しま", r: "しま", romaji: "shima", zh: "島", en: "island" },
  す: { w: "すし", r: "すし", romaji: "sushi", zh: "壽司", en: "sushi" },
  せ: { w: "せかい", r: "せかい", romaji: "sekai", zh: "世界", en: "world" },
  そ: { w: "そら", r: "そら", romaji: "sora", zh: "天空", en: "sky" },
  た: { w: "たまご", r: "たまご", romaji: "tamago", zh: "雞蛋", en: "egg" },
  ち: { w: "ちず", r: "ちず", romaji: "chizu", zh: "地圖", en: "map" },
  つ: { w: "つき", r: "つき", romaji: "tsuki", zh: "月亮", en: "moon" },
  て: { w: "てがみ", r: "てがみ", romaji: "tegami", zh: "信", en: "letter" },
  と: { w: "とり", r: "とり", romaji: "tori", zh: "鳥", en: "bird" },
  な: { w: "なつ", r: "なつ", romaji: "natsu", zh: "夏天", en: "summer" },
  に: { w: "にく", r: "にく", romaji: "niku", zh: "肉", en: "meat" },
  ぬ: { w: "ぬの", r: "ぬの", romaji: "nuno", zh: "布", en: "cloth" },
  ね: { w: "ねこ", r: "ねこ", romaji: "neko", zh: "貓", en: "cat" },
  の: { w: "のり", r: "のり", romaji: "nori", zh: "海苔", en: "seaweed" },
  は: { w: "はな", r: "はな", romaji: "hana", zh: "花", en: "flower" },
  ひ: { w: "ひと", r: "ひと", romaji: "hito", zh: "人", en: "person" },
  ふ: { w: "ふね", r: "ふね", romaji: "fune", zh: "船", en: "boat" },
  へ: { w: "へや", r: "へや", romaji: "heya", zh: "房間", en: "room" },
  ほ: { w: "ほし", r: "ほし", romaji: "hoshi", zh: "星星", en: "star" },
  ま: { w: "まど", r: "まど", romaji: "mado", zh: "窗戶", en: "window" },
  み: { w: "みず", r: "みず", romaji: "mizu", zh: "水", en: "water" },
  む: { w: "むし", r: "むし", romaji: "mushi", zh: "蟲", en: "insect" },
  め: { w: "めがね", r: "めがね", romaji: "megane", zh: "眼鏡", en: "glasses" },
  も: { w: "もり", r: "もり", romaji: "mori", zh: "森林", en: "forest" },
  や: { w: "やま", r: "やま", romaji: "yama", zh: "山", en: "mountain" },
  ゆ: { w: "ゆき", r: "ゆき", romaji: "yuki", zh: "雪", en: "snow" },
  よ: { w: "よる", r: "よる", romaji: "yoru", zh: "夜晚", en: "night" },
  ら: { w: "さくら", r: "さくら", romaji: "sakura", zh: "櫻花", en: "cherry blossom" },
  り: { w: "りんご", r: "りんご", romaji: "ringo", zh: "蘋果", en: "apple" },
  る: { w: "くるま", r: "くるま", romaji: "kuruma", zh: "汽車", en: "car" },
  れ: { w: "れきし", r: "れきし", romaji: "rekishi", zh: "歷史", en: "history" },
  ろ: { w: "ろく", r: "ろく", romaji: "roku", zh: "六", en: "six" },
  わ: { w: "わたし", r: "わたし", romaji: "watashi", zh: "我", en: "I / me" },
  を: { w: "ほんを よむ", r: "ほんをよむ", romaji: "hon o yomu", zh: "讀書(を 為助詞)", en: "read a book (を = particle)" },
  ん: { w: "ほん", r: "ほん", romaji: "hon", zh: "書(ん 在詞尾)", en: "book (ん at the end)" },
};
const EX_KATA = {
  ア: { w: "アイス", r: "アイス", romaji: "aisu", zh: "冰/冰淇淋", en: "ice / ice cream" },
  イ: { w: "イタリア", r: "イタリア", romaji: "itaria", zh: "義大利", en: "Italy" },
  ウ: { w: "ウール", r: "ウール", romaji: "ūru", zh: "羊毛", en: "wool" },
  エ: { w: "エアコン", r: "エアコン", romaji: "eakon", zh: "空調", en: "air conditioner" },
  オ: { w: "オレンジ", r: "オレンジ", romaji: "orenji", zh: "橙子", en: "orange" },
  カ: { w: "カメラ", r: "カメラ", romaji: "kamera", zh: "相機", en: "camera" },
  キ: { w: "キロ", r: "キロ", romaji: "kiro", zh: "公斤/公里", en: "kilo" },
  ク: { w: "クラス", r: "クラス", romaji: "kurasu", zh: "班級", en: "class" },
  ケ: { w: "ケーキ", r: "ケーキ", romaji: "kēki", zh: "蛋糕", en: "cake" },
  コ: { w: "コーヒー", r: "コーヒー", romaji: "kōhī", zh: "咖啡", en: "coffee" },
  サ: { w: "サラダ", r: "サラダ", romaji: "sarada", zh: "沙拉", en: "salad" },
  シ: { w: "シャツ", r: "シャツ", romaji: "shatsu", zh: "襯衫", en: "shirt" },
  ス: { w: "スプーン", r: "スプーン", romaji: "supūn", zh: "勺子", en: "spoon" },
  セ: { w: "セーター", r: "セーター", romaji: "sētā", zh: "毛衣", en: "sweater" },
  ソ: { w: "ソファ", r: "ソファ", romaji: "sofa", zh: "沙發", en: "sofa" },
  タ: { w: "タクシー", r: "タクシー", romaji: "takushī", zh: "計程車", en: "taxi" },
  チ: { w: "チーズ", r: "チーズ", romaji: "chīzu", zh: "起司", en: "cheese" },
  ツ: { w: "ツナ", r: "ツナ", romaji: "tsuna", zh: "金槍魚", en: "tuna" },
  テ: { w: "テレビ", r: "テレビ", romaji: "terebi", zh: "電視", en: "TV" },
  ト: { w: "トマト", r: "トマト", romaji: "tomato", zh: "番茄", en: "tomato" },
  ナ: { w: "ナイフ", r: "ナイフ", romaji: "naifu", zh: "刀", en: "knife" },
  ニ: { w: "ニュース", r: "ニュース", romaji: "nyūsu", zh: "新聞", en: "news" },
  ヌ: { w: "ヌードル", r: "ヌードル", romaji: "nūdoru", zh: "麵條", en: "noodle" },
  ネ: { w: "ネクタイ", r: "ネクタイ", romaji: "nekutai", zh: "領帶", en: "necktie" },
  ノ: { w: "ノート", r: "ノート", romaji: "nōto", zh: "筆記本", en: "notebook" },
  ハ: { w: "ハム", r: "ハム", romaji: "hamu", zh: "火腿", en: "ham" },
  ヒ: { w: "ヒント", r: "ヒント", romaji: "hinto", zh: "提示", en: "hint" },
  フ: { w: "フォーク", r: "フォーク", romaji: "fōku", zh: "叉子", en: "fork" },
  ヘ: { w: "ヘア", r: "ヘア", romaji: "hea", zh: "頭髮", en: "hair" },
  ホ: { w: "ホテル", r: "ホテル", romaji: "hoteru", zh: "酒店", en: "hotel" },
  マ: { w: "マスク", r: "マスク", romaji: "masuku", zh: "口罩", en: "mask" },
  ミ: { w: "ミルク", r: "ミルク", romaji: "miruku", zh: "牛奶", en: "milk" },
  ム: { w: "ゲーム", r: "ゲーム", romaji: "gēmu", zh: "遊戲", en: "game" },
  メ: { w: "メモ", r: "メモ", romaji: "memo", zh: "便條", en: "memo" },
  モ: { w: "モデル", r: "モデル", romaji: "moderu", zh: "模特", en: "model" },
  ヤ: { w: "タイヤ", r: "タイヤ", romaji: "taiya", zh: "輪胎(ヤ 在詞中)", en: "tire (ヤ inside)" },
  ユ: { w: "ユーロ", r: "ユーロ", romaji: "yūro", zh: "歐元", en: "euro" },
  ヨ: { w: "ヨット", r: "ヨット", romaji: "yotto", zh: "遊艇", en: "yacht" },
  ラ: { w: "ラジオ", r: "ラジオ", romaji: "rajio", zh: "收音機", en: "radio" },
  リ: { w: "リボン", r: "リボン", romaji: "ribon", zh: "絲帶", en: "ribbon" },
  ル: { w: "ルール", r: "ルール", romaji: "rūru", zh: "規則", en: "rule" },
  レ: { w: "レモン", r: "レモン", romaji: "remon", zh: "檸檬", en: "lemon" },
  ロ: { w: "ロボット", r: "ロボット", romaji: "robotto", zh: "機器人", en: "robot" },
  ワ: { w: "ワイン", r: "ワイン", romaji: "wain", zh: "葡萄酒", en: "wine" },
  ヲ: { w: "—", r: "", romaji: "o", zh: "現代外來語不使用", en: "unused in modern loanwords" },
  ン: { w: "パン", r: "パン", romaji: "pan", zh: "麵包(ン 在詞尾)", en: "bread (ン at the end)" },
};

// --- "Did you know?" trivia (localized) -----------------------------------
// A curated, genuinely interesting note for the notable kana; everything else
// falls back to a script-level origin fact, so every kana shows something fun.
const SCRIPT_FACT = {
  hira: { zh: "平假名由漢字草書簡化而成,平安時代多由女性書寫,故稱「女手」。", en: "Hiragana evolved from the cursive of kanji and, in the Heian era, was written mostly by women — hence its old name 「女手」 (women's hand).", ja: "ひらがなは漢字の草書から生まれ、平安時代は主に女性が使ったため「女手」と呼ばれました。" },
  kata: { zh: "片假名由僧侶取漢字偏旁簡化而來,最初用於替漢文標注讀音。", en: "Katakana was created by Buddhist monks from fragments of kanji, originally to annotate the readings of Chinese texts.", ja: "カタカナは僧侶が漢字の一部を取って作り、漢文の読みを示すために使われました。" },
};
const TRIVIA_HIRA = {
  あ: { zh: "「あ」是五十音的第一個音,也是開口最大的母音。", en: "「あ」 is the very first kana — and the most open vowel sound.", ja: "「あ」は五十音の最初の音で、最も口を開く母音です。" },
  し: { zh: "「し」只用一筆寫成,是最好寫的假名之一。", en: "「し」 is written in a single stroke — one of the easiest kana to write.", ja: "「し」は一画で書ける、最も簡単な仮名の一つです。" },
  つ: { zh: "小寫的「っ」(促音)表示輔音雙寫的停頓,如 きって(kitte)。", en: "A small 「っ」 (sokuon) marks a doubled consonant / short pause, e.g. きって (kitte).", ja: "小さい「っ」は促音で、子音が重なる音を表します(例:きって)。" },
  ふ: { zh: "「ふ」的輪廓常被聯想成富士山的剪影。", en: "The shape of 「ふ」 is often imagined as the silhouette of Mt. Fuji.", ja: "「ふ」の形は富士山のシルエットに例えられます。" },
  を: { zh: "現代日語裡「を」只當受詞助詞,讀音和 お 一樣。", en: "Today 「を」 is used only as the object particle, and it's pronounced just like お.", ja: "現代では「を」は目的語の助詞専用で、発音は「お」と同じです。" },
  ん: { zh: "「ん」是唯一不能放在詞首的假名,也是唯一的單獨輔音。", en: "「ん」 is the only kana that can't start a word — and the only standalone consonant.", ja: "「ん」は語頭に立てない唯一の仮名で、唯一の独立した子音です。" },
  の: { zh: "「の」也是超高頻的所有格助詞,作用像英語的 ’s。", en: "「の」 is also the very common possessive particle — like English “’s”.", ja: "「の」は所有を表す助詞としても頻繁に使われます。" },
  は: { zh: "當主題助詞時「は」讀作 wa,是初學者最常見的「陷阱」。", en: "As the topic particle, 「は」 is read “wa” — the classic beginner gotcha.", ja: "助詞の「は」は「wa」と読み、初学者がつまずく定番です。" },
  ら: { zh: "ら行的音介於 r 和 l 之間,所以日本人常分不清英語的 r/l。", en: "The ら-row sits between r and l — which is why r/l is famously hard for Japanese speakers.", ja: "ら行は r と l の中間音。だから英語の r/l は難しいのです。" },
};
const TRIVIA_KATA = {
  シ: { zh: "「シ」「ツ」是片假名最容易混的一對,關鍵看筆順方向。", en: "「シ」 and 「ツ」 are the most-confused katakana pair — the giveaway is stroke direction.", ja: "「シ」と「ツ」は最も紛らわしい対。見分けは筆順の向きです。" },
  ツ: { zh: "「ツ」「シ」是片假名最容易混的一對,關鍵看筆順方向。", en: "「ツ」 and 「シ」 are the most-confused katakana pair — the giveaway is stroke direction.", ja: "「ツ」と「シ」は最も紛らわしい対。見分けは筆順の向きです。" },
  ン: { zh: "「ン」和 ん 一樣,絕不出現在詞首(如 パン)。", en: "Like ん, 「ン」 never starts a word (e.g. パン).", ja: "「ン」も「ん」と同様、語頭に立ちません(例:パン)。" },
  ヲ: { zh: "「ヲ」在現代外來語中幾乎用不到。", en: "「ヲ」 is almost never used in modern loanwords.", ja: "「ヲ」は現代の外来語ではほぼ使いません。" },
  ア: { zh: "片假名常用長音符「ー」拉長母音,如 アート(art)。", en: "Katakana lengthens vowels with the bar 「ー」, e.g. アート (art).", ja: "カタカナは長音符「ー」で母音を伸ばします(例:アート)。" },
};

// gojūon position label, e.g. か → "か行・あ段". Hiragana row markers are the
// conventional names regardless of script.
const ROW_MARK = ["あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ", "ん"];
const COL_MARK = ["あ", "い", "う", "え", "お"];
function positionLabel(type, row, col) {
  if (type !== "seion" || row == null || col == null) return "";
  if (ROW_MARK[row] === "ん") return "ん";
  return `${ROW_MARK[row]}行・${COL_MARK[col]}段`;
}

// Build per-kana lookalikes (the other glyphs sharing any confusion group).
function lookalikeMap(groups) {
  const m = new Map();
  for (const { g } of groups) {
    for (const k of g) {
      const others = g.filter((x) => x !== k);
      const cur = m.get(k) || new Set();
      others.forEach((o) => cur.add(o));
      m.set(k, cur);
    }
  }
  return m;
}

// Per-kana localized distinguishing tips (from every confusion group it's in).
function tipsMap(groups) {
  const m = new Map();
  for (const { g, tip } of groups) {
    for (const k of g) {
      const cur = m.get(k) || { zh: [], en: [], ja: [] };
      cur.zh.push(tip.zh);
      cur.en.push(tip.en);
      cur.ja.push(tip.ja);
      m.set(k, cur);
    }
  }
  return m;
}

function buildScript(scriptKey, name, seion, originMap, mnemonicMap, confusion, pronMap, exampleMap, triviaMap) {
  const looks = lookalikeMap(confusion);
  const tips = tipsMap(confusion);
  const fact = SCRIPT_FACT[scriptKey];
  const kana = [];
  const id = (k) => `${scriptKey}:${k}`;

  const push = (k, romaji, type, row, col) => {
    kana.push({
      id: id(k),
      kana: k,
      romaji,
      accepts: acceptsFor(k, romaji),
      type,
      row,
      col,
      script: scriptKey,
      audio: null,
      origin: originMap[k] || "",
      mnemonic: mnemonicMap[k] || "",
      position: positionLabel(type, row, col),
      pron: pronMap[k] || null,
      example: exampleMap[k] || null,
      trivia: triviaMap[k] || fact, // specific note, else the script-level fun fact
      lookalikes: [...(looks.get(k) || [])].map(id),
      tips: tips.get(k) || { zh: [], en: [], ja: [] },
    });
  };

  // seion grid (keeps row/col so the overview can lay it out as gojūon)
  seion.forEach(([rowKey, cells], r) => {
    cells.forEach((cell, c) => {
      if (cell) push(cell[0], cell[1], "seion", r, c);
    });
  });
  // dakuon / handakuon
  DAKUON.forEach(([, hira, kata]) => {
    (scriptKey === "hira" ? hira : kata).forEach(([k, romaji], c) => push(k, romaji, "dakuon", null, c));
  });
  HANDAKUON.forEach(([, hira, kata]) => {
    (scriptKey === "hira" ? hira : kata).forEach(([k, romaji], c) => push(k, romaji, "handakuon", null, c));
  });
  // yōon
  YOON.forEach(([hira3, kata3, romaji3], r) => {
    const trio = scriptKey === "hira" ? hira3 : kata3;
    trio.forEach((k, c) => push(k, romaji3[c], "yoon", r, c));
  });

  const special = [
    {
      type: "sokuon",
      title: "Sokuon 促音 (small っ/ッ)",
      kana: scriptKey === "hira" ? "っ" : "ッ",
      note: "A small つ/ツ marks a doubled (geminate) consonant — a short pause before the next sound. Romaji doubles the following consonant: きって = kitte, ベッド = beddo. It is never pronounced 'tsu' on its own.",
    },
    {
      type: "chouon",
      title: "Long vowels 長音",
      kana: scriptKey === "hira" ? "おう / ー" : "ー",
      note:
        scriptKey === "hira"
          ? "Hiragana lengthens a vowel by adding あ/い/う/え/お (e.g. おかあさん, こうこう, せんせい). Romaji shows it as a macron or doubled vowel: ō / ou."
          : "Katakana lengthens any vowel with a single bar ー (e.g. コーヒー kōhī, ラーメン rāmen). The bar follows the direction of writing.",
    },
  ];

  return {
    script: scriptKey,
    name,
    vowels: VOWELS,
    categories: ["seion", "dakuon", "handakuon", "yoon"],
    kana,
    special,
    confusion: confusion.map(({ g }) => g.map(id)),
  };
}

const hiragana = buildScript("hira", "Hiragana", HIRA_SEION, ORIGIN_HIRA, MNEMONIC_HIRA, CONFUSION_HIRA, PRON, EX_HIRA, TRIVIA_HIRA);
const katakana = buildScript("kata", "Katakana", KATA_SEION, ORIGIN_KATA, MNEMONIC_KATA, CONFUSION_KATA, PRON_KATA, EX_KATA, TRIVIA_KATA);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "hiragana.json"), JSON.stringify(hiragana, null, 2) + "\n");
fs.writeFileSync(path.join(outDir, "katakana.json"), JSON.stringify(katakana, null, 2) + "\n");
console.log(`hiragana: ${hiragana.kana.length} kana, ${hiragana.confusion.length} confusion groups`);
console.log(`katakana: ${katakana.kana.length} kana, ${katakana.confusion.length} confusion groups`);
