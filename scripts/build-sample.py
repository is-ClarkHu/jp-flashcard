#!/usr/bin/env python3
"""Build the bundled sample / demo deck — data/sample/*.json + manifest.json.

A self-authored, copyright-free starter set (~210 everyday words across 18
themed lists) so the public web demo feels substantial on its own. The full
library still comes from convert.py + raw_data/ (gitignored); this is the only
deck shipped publicly. Re-run to regenerate, then run scripts/sample-tts.py to
add the six VOICEVOX voices.
"""
import json
from pathlib import Path

OUT = Path("data/sample")

# Each word: (front, reading, meaning_zh, meaning_en). Explanations + the
# Japanese gloss are generated below so the data stays compact and consistent.
GREET = [
    ("こんにちは", "こんにちは", "你好", "hello / good afternoon"),
    ("おはよう", "おはよう", "早上好（随意）", "good morning (casual)"),
    ("おはようございます", "おはようございます", "早上好（礼貌）", "good morning (polite)"),
    ("こんばんは", "こんばんは", "晚上好", "good evening"),
    ("おやすみ", "おやすみ", "晚安", "good night"),
    ("さようなら", "さようなら", "再见", "goodbye"),
    ("またね", "またね", "回头见", "see you"),
    ("はじめまして", "はじめまして", "初次见面", "nice to meet you"),
    ("ありがとう", "ありがとう", "谢谢", "thank you"),
    ("すみません", "すみません", "对不起 / 不好意思", "excuse me / sorry"),
    ("はい", "はい", "是的", "yes"),
    ("いいえ", "いいえ", "不是", "no"),
]
POLITE = [
    ("お願いします", "おねがいします", "拜托了 / 请", "please"),
    ("どういたしまして", "どういたしまして", "不客气", "you're welcome"),
    ("ごめんなさい", "ごめんなさい", "对不起", "I'm sorry"),
    ("失礼します", "しつれいします", "失礼了 / 告辞", "excuse me (entering/leaving)"),
    ("いただきます", "いただきます", "我开动了", "said before eating"),
    ("ごちそうさま", "ごちそうさま", "吃饱了 / 谢款待", "said after eating"),
    ("おめでとう", "おめでとう", "恭喜", "congratulations"),
    ("いらっしゃいませ", "いらっしゃいませ", "欢迎光临", "welcome (to a shop)"),
    ("お元気ですか", "おげんきですか", "你好吗", "how are you?"),
    ("大丈夫", "だいじょうぶ", "没关系 / 没问题", "it's okay / fine"),
    ("よろしく", "よろしく", "请多关照", "nice to meet you / regards"),
    ("お疲れ様", "おつかれさま", "辛苦了", "good work / thanks for your effort"),
]
NUM = [
    ("一", "いち", "一", "one"),
    ("二", "に", "二", "two"),
    ("三", "さん", "三", "three"),
    ("四", "よん", "四", "four"),
    ("五", "ご", "五", "five"),
    ("六", "ろく", "六", "six"),
    ("七", "なな", "七", "seven"),
    ("八", "はち", "八", "eight"),
    ("九", "きゅう", "九", "nine"),
    ("十", "じゅう", "十", "ten"),
    ("百", "ひゃく", "百", "hundred"),
    ("千", "せん", "千", "thousand"),
]
CAL = [
    ("月曜日", "げつようび", "星期一", "Monday"),
    ("火曜日", "かようび", "星期二", "Tuesday"),
    ("水曜日", "すいようび", "星期三", "Wednesday"),
    ("木曜日", "もくようび", "星期四", "Thursday"),
    ("金曜日", "きんようび", "星期五", "Friday"),
    ("土曜日", "どようび", "星期六", "Saturday"),
    ("日曜日", "にちようび", "星期日", "Sunday"),
    ("今日", "きょう", "今天", "today"),
    ("明日", "あした", "明天", "tomorrow"),
    ("昨日", "きのう", "昨天", "yesterday"),
    ("今", "いま", "现在", "now"),
    ("時間", "じかん", "时间 / 小时", "time / hour"),
]
FOOD = [
    ("ご飯", "ごはん", "米饭 / 饭", "cooked rice / meal"),
    ("パン", "パン", "面包", "bread"),
    ("肉", "にく", "肉", "meat"),
    ("魚", "さかな", "鱼", "fish"),
    ("野菜", "やさい", "蔬菜", "vegetables"),
    ("果物", "くだもの", "水果", "fruit"),
    ("卵", "たまご", "蛋", "egg"),
    ("寿司", "すし", "寿司", "sushi"),
    ("ラーメン", "ラーメン", "拉面", "ramen"),
    ("麺", "めん", "面条", "noodles"),
    ("米", "こめ", "米（生）", "(uncooked) rice"),
    ("弁当", "べんとう", "便当", "boxed lunch"),
]
DRINK = [
    ("水", "みず", "水", "water"),
    ("お茶", "おちゃ", "茶", "tea"),
    ("コーヒー", "コーヒー", "咖啡", "coffee"),
    ("牛乳", "ぎゅうにゅう", "牛奶", "milk"),
    ("ジュース", "ジュース", "果汁", "juice"),
    ("ビール", "ビール", "啤酒", "beer"),
    ("お酒", "おさけ", "酒", "alcohol / sake"),
    ("ワイン", "ワイン", "葡萄酒", "wine"),
    ("紅茶", "こうちゃ", "红茶", "black tea"),
    ("緑茶", "りょくちゃ", "绿茶", "green tea"),
    ("氷", "こおり", "冰", "ice"),
    ("コーラ", "コーラ", "可乐", "cola"),
]
PLACE = [
    ("家", "いえ", "家 / 房子", "house / home"),
    ("学校", "がっこう", "学校", "school"),
    ("駅", "えき", "车站", "station"),
    ("病院", "びょういん", "医院", "hospital"),
    ("銀行", "ぎんこう", "银行", "bank"),
    ("店", "みせ", "商店", "shop"),
    ("公園", "こうえん", "公园", "park"),
    ("図書館", "としょかん", "图书馆", "library"),
    ("会社", "かいしゃ", "公司", "company / office"),
    ("レストラン", "レストラン", "餐厅", "restaurant"),
    ("トイレ", "トイレ", "厕所", "toilet"),
    ("空港", "くうこう", "机场", "airport"),
]
TRANS = [
    ("車", "くるま", "车 / 汽车", "car"),
    ("電車", "でんしゃ", "电车", "train"),
    ("バス", "バス", "公交车", "bus"),
    ("自転車", "じてんしゃ", "自行车", "bicycle"),
    ("飛行機", "ひこうき", "飞机", "airplane"),
    ("船", "ふね", "船", "ship / boat"),
    ("地下鉄", "ちかてつ", "地铁", "subway"),
    ("タクシー", "タクシー", "出租车", "taxi"),
    ("新幹線", "しんかんせん", "新干线（高铁）", "bullet train"),
    ("道", "みち", "路 / 道", "road / way"),
    ("切符", "きっぷ", "车票", "ticket"),
    ("信号", "しんごう", "红绿灯 / 信号", "traffic light / signal"),
]
FAMILY = [
    ("家族", "かぞく", "家人 / 家庭", "family"),
    ("父", "ちち", "（自己的）父亲", "father (one's own)"),
    ("母", "はは", "（自己的）母亲", "mother (one's own)"),
    ("兄", "あに", "哥哥", "older brother"),
    ("姉", "あね", "姐姐", "older sister"),
    ("弟", "おとうと", "弟弟", "younger brother"),
    ("妹", "いもうと", "妹妹", "younger sister"),
    ("子供", "こども", "孩子", "child"),
    ("お父さん", "おとうさん", "父亲（尊称）", "father (polite)"),
    ("お母さん", "おかあさん", "母亲（尊称）", "mother (polite)"),
    ("祖父", "そふ", "祖父", "grandfather"),
    ("祖母", "そぼ", "祖母", "grandmother"),
]
PEOPLE = [
    ("私", "わたし", "我", "I / me"),
    ("あなた", "あなた", "你", "you"),
    ("彼", "かれ", "他 / 男朋友", "he / boyfriend"),
    ("彼女", "かのじょ", "她 / 女朋友", "she / girlfriend"),
    ("人", "ひと", "人", "person"),
    ("友達", "ともだち", "朋友", "friend"),
    ("先生", "せんせい", "老师", "teacher"),
    ("学生", "がくせい", "学生", "student"),
    ("男", "おとこ", "男人", "man"),
    ("女", "おんな", "女人", "woman"),
    ("名前", "なまえ", "名字", "name"),
    ("みんな", "みんな", "大家", "everyone"),
]
HOME = [
    ("部屋", "へや", "房间", "room"),
    ("机", "つくえ", "桌子", "desk"),
    ("椅子", "いす", "椅子", "chair"),
    ("ドア", "ドア", "门", "door"),
    ("窓", "まど", "窗户", "window"),
    ("電話", "でんわ", "电话", "telephone"),
    ("時計", "とけい", "钟 / 表", "clock / watch"),
    ("本", "ほん", "书", "book"),
    ("鍵", "かぎ", "钥匙", "key"),
    ("傘", "かさ", "伞", "umbrella"),
    ("服", "ふく", "衣服", "clothes"),
    ("靴", "くつ", "鞋", "shoes"),
]
DAILY = [
    ("食べる", "たべる", "吃", "to eat"),
    ("飲む", "のむ", "喝", "to drink"),
    ("行く", "いく", "去", "to go"),
    ("来る", "くる", "来", "to come"),
    ("見る", "みる", "看", "to see / watch"),
    ("聞く", "きく", "听 / 问", "to listen / ask"),
    ("話す", "はなす", "说", "to speak"),
    ("読む", "よむ", "读", "to read"),
    ("書く", "かく", "写", "to write"),
    ("寝る", "ねる", "睡觉", "to sleep"),
    ("起きる", "おきる", "起床", "to wake up"),
    ("買う", "かう", "买", "to buy"),
]
ANIMAL = [
    ("犬", "いぬ", "狗", "dog"),
    ("猫", "ねこ", "猫", "cat"),
    ("鳥", "とり", "鸟", "bird"),
    ("馬", "うま", "马", "horse"),
    ("牛", "うし", "牛", "cow"),
    ("豚", "ぶた", "猪", "pig"),
    ("鶏", "にわとり", "鸡", "chicken"),
    ("象", "ぞう", "大象", "elephant"),
    ("兎", "うさぎ", "兔子", "rabbit"),
    ("熊", "くま", "熊", "bear"),
    ("虫", "むし", "虫子", "insect / bug"),
    ("猿", "さる", "猴子", "monkey"),
]
NATURE = [
    ("空", "そら", "天空", "sky"),
    ("海", "うみ", "海", "sea"),
    ("山", "やま", "山", "mountain"),
    ("川", "かわ", "河", "river"),
    ("木", "き", "树", "tree"),
    ("花", "はな", "花", "flower"),
    ("雨", "あめ", "雨", "rain"),
    ("雪", "ゆき", "雪", "snow"),
    ("風", "かぜ", "风", "wind"),
    ("太陽", "たいよう", "太阳", "sun"),
    ("月", "つき", "月亮", "moon"),
    ("星", "ほし", "星星", "star"),
]
COLOR = [
    ("赤", "あか", "红色", "red"),
    ("青", "あお", "蓝色", "blue"),
    ("黄色", "きいろ", "黄色", "yellow"),
    ("緑", "みどり", "绿色", "green"),
    ("黒", "くろ", "黑色", "black"),
    ("白", "しろ", "白色", "white"),
    ("茶色", "ちゃいろ", "棕色", "brown"),
    ("紫", "むらさき", "紫色", "purple"),
    ("ピンク", "ピンク", "粉色", "pink"),
    ("色", "いろ", "颜色", "color"),
]
ADJ = [
    ("大きい", "おおきい", "大", "big"),
    ("小さい", "ちいさい", "小", "small"),
    ("新しい", "あたらしい", "新", "new"),
    ("古い", "ふるい", "旧 / 老", "old"),
    ("高い", "たかい", "高 / 贵", "tall / expensive"),
    ("安い", "やすい", "便宜", "cheap"),
    ("暑い", "あつい", "热（天气）", "hot (weather)"),
    ("寒い", "さむい", "冷", "cold"),
    ("おいしい", "おいしい", "好吃", "delicious"),
    ("楽しい", "たのしい", "快乐 / 有趣", "fun / enjoyable"),
    ("難しい", "むずかしい", "难", "difficult"),
    ("いい", "いい", "好", "good"),
]
VERB = [
    ("する", "する", "做", "to do"),
    ("ある", "ある", "有（物）", "to exist (things)"),
    ("いる", "いる", "有（人 / 动物）", "to exist (living)"),
    ("作る", "つくる", "做 / 制作", "to make"),
    ("使う", "つかう", "用", "to use"),
    ("待つ", "まつ", "等", "to wait"),
    ("持つ", "もつ", "拿 / 持有", "to hold / have"),
    ("入る", "はいる", "进入", "to enter"),
    ("出る", "でる", "出去 / 出来", "to exit"),
    ("立つ", "たつ", "站", "to stand"),
    ("座る", "すわる", "坐", "to sit"),
    ("歩く", "あるく", "走 / 步行", "to walk"),
]
BODY = [
    ("頭", "あたま", "头", "head"),
    ("顔", "かお", "脸", "face"),
    ("目", "め", "眼睛", "eye"),
    ("耳", "みみ", "耳朵", "ear"),
    ("鼻", "はな", "鼻子", "nose"),
    ("口", "くち", "嘴", "mouth"),
    ("手", "て", "手", "hand"),
    ("足", "あし", "脚 / 腿", "foot / leg"),
    ("歯", "は", "牙齿", "tooth"),
    ("髪", "かみ", "头发", "hair"),
    ("体", "からだ", "身体", "body"),
    ("心", "こころ", "心 / 心情", "heart / mind"),
]

# (curriculum, [(list_id, list_name, file, words), ...])
CURRICULA = [
    ("Greetings", [
        ("greet-list01", "Hellos & Goodbyes", "sample/greet.json", GREET),
        ("polite-list01", "Polite Phrases", "sample/polite.json", POLITE),
    ]),
    ("Numbers & Time", [
        ("num-list01", "Numbers", "sample/num.json", NUM),
        ("cal-list01", "Days & Time", "sample/cal.json", CAL),
    ]),
    ("Food & Drink", [
        ("food-list01", "Food", "sample/food.json", FOOD),
        ("drink-list01", "Drinks", "sample/drink.json", DRINK),
    ]),
    ("Around Town", [
        ("place-list01", "Places", "sample/place.json", PLACE),
        ("trans-list01", "Transport", "sample/trans.json", TRANS),
    ]),
    ("People & Family", [
        ("family-list01", "Family", "sample/family.json", FAMILY),
        ("people-list01", "People & Pronouns", "sample/people.json", PEOPLE),
    ]),
    ("Home & Daily Life", [
        ("home-list01", "Home & Objects", "sample/home.json", HOME),
        ("daily-list01", "Daily Verbs", "sample/daily.json", DAILY),
    ]),
    ("Nature & World", [
        ("animal-list01", "Animals", "sample/animal.json", ANIMAL),
        ("nature-list01", "Nature & Weather", "sample/nature.json", NATURE),
        ("color-list01", "Colors", "sample/color.json", COLOR),
    ]),
    ("Describing Things", [
        ("adj-list01", "Adjectives", "sample/adj.json", ADJ),
        ("verb-list01", "Common Verbs", "sample/verb.json", VERB),
        ("body-list01", "The Body", "sample/body.json", BODY),
    ]),
]


def card(list_id, idx, w):
    front, reading, zh, en = w
    prefix, num = list_id.split("-list")
    cid = f"{prefix}-l{num}-{idx:03d}"
    return {
        "id": cid,
        "front": front,
        "reading": reading,
        "meaning_zh": zh,
        "meaning_en": en,
        "meaning_ja": reading,
        "explain_zh": f"「{front}」（读音：{reading}）：{zh}。",
        "explain_en": f"“{front}” ({reading}) means {en}.",
        "explain_ja": f"「{front}」は「{reading}」と読みます。",
        "audio_anime": None,
        "audio_announcer": None,
        "audio_example": None,
        "duplicate_of": None,
        "extra": "",
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"curricula": []}
    total = 0
    for curr, lists in CURRICULA:
        mc = {"curriculum": curr, "groups": [{"group": curr, "lists": []}]}
        for list_id, list_name, file, words in lists:
            cards = [card(list_id, i, w) for i, w in enumerate(words, 1)]
            total += len(cards)
            data = {"curriculum": curr, "group": curr, "list_id": list_id,
                    "list_name": list_name, "cards": cards}
            (OUT / Path(file).name).write_text(
                json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            mc["groups"][0]["lists"].append(
                {"list_id": list_id, "list_name": list_name, "count": len(cards), "file": file})
        manifest["curricula"].append(mc)
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lists = sum(len(ls) for _, ls in CURRICULA)
    print(f"Built {total} words across {lists} lists in {len(CURRICULA)} curricula -> {OUT}")


if __name__ == "__main__":
    main()
