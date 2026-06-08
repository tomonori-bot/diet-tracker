#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
デモ用の架空顧客2人を、30日分のリアルな記録つきで本番に投入するスクリプト。

使い方（ターミナルで）:
    python3 seed_demo.py <ユーザー名> <パスワード>

例:
    python3 seed_demo.py mytrainer mypassword123

※ ID/パスワードは引数で渡すだけ。スクリプト内には保存しません。
※ 本番URLにログインし、あなたのアカウントに2人の顧客を作成します。
※ 何度も実行すると顧客が重複して増えるので注意（その場合は管理画面から削除）。
"""

import sys, json, urllib.request, urllib.error, datetime, random

BASE = "https://diet-tracker-svq1.onrender.com"
random.seed(42)
TODAY = datetime.date.today()
DAYS = 30

def api(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="ignore")
        raise SystemExit(f"\n[エラー] {method} {path} -> {e.code}: {msg}")
    except Exception as e:
        raise SystemExit(f"\n[通信エラー] {method} {path}: {e}")

def daterange(n):
    return [(TODAY - datetime.timedelta(days=n-1-i)) for i in range(n)]

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit("引数が足りません。 python3 seed_demo.py <ユーザー名> <パスワード>")
    username, password = sys.argv[1], sys.argv[2]

    print(f"・{BASE} にログイン中...")
    auth = api("POST", "/api/auth/login", body={"username": username, "password": password})
    token = auth["token"]
    print(f"  ログイン成功（{auth.get('username')}）")

    dates = daterange(DAYS)

    # ───────── 顧客1：田中 美咲（順調な人） ─────────
    print("\n・顧客1『田中 美咲』を作成中...")
    p1 = api("POST", "/api/patients", token, {
        "name": "田中 美咲", "kana": "タナカ ミサキ", "gender": "女性",
        "birthdate": "1994-04-12", "height": 162,
        "startWeight": 65.0, "targetWeight": 58.0,
        "startDate": dates[0].isoformat(),
        "purpose": "ダイエット",
        "finalGoal": "夏までに-5kg、お腹周りをすっきりさせたい",
        "midGoal": "1ヶ月で-1.5kg、週3回の運動習慣をつける",
        "karteInfo": "デスクワーク中心。運動経験は少なめだが意欲は高い。",
    })
    id1 = p1["id"]
    items1 = [
        {"id": "t1a", "text": "スクワット20回"},
        {"id": "t1b", "text": "ウォーキング30分"},
        {"id": "t1c", "text": "ストレッチ10分"},
    ]
    api("PUT", f"/api/patients/{id1}", token, {"trainingItems": items1})
    print("  トレーニング項目を設定")

    print("  30日分の記録を投入中", end="", flush=True)
    for i, d in enumerate(dates):
        target = 65.0 - 3.2 * (i / (DAYS - 1))
        weight = round(target + random.uniform(-0.25, 0.25), 1)
        moti = random.choice([4, 4, 5, 5, 5])
        checks = {it["id"]: (random.random() < 0.85) for it in items1}
        body = {"date": d.isoformat(), "weight": weight, "moti": moti, "checkResults": checks}
        # たまに振り返りメモ
        if i % 6 == 0:
            body["reflection"] = random.choice([
                "今日は調子よかった！", "間食を我慢できた", "少し疲れたけど続けられた",
                "体が軽くなってきた気がする",
            ])
        api("POST", f"/api/patients/{id1}/self-record", token, body)
        print(".", end="", flush=True)
    print(" 完了")

    # 田中さんのセッション記録（週1ペース・重量が伸びる）
    sess1 = [
        (27, "スクワット40kg×10 / レッグプレス60kg×12", "フォーム安定。下半身の動きが良くなってきた", "毎日スクワット20回、よく歩く"),
        (20, "スクワット45kg×10 / ヒップスラスト50kg×10", "前回より重量UP。お尻に効いている", "ウォーキング継続、糖質ひかえめ"),
        (13, "スクワット50kg×8 / レッグカール30kg×12", "体重も順調に減少中、モチベ高い", "このペースで継続"),
        (6,  "スクワット50kg×10 / ランジ", "見た目の変化が出てきた。本人も実感", "夏に向けてラストスパート"),
    ]
    for ago, treat, resp, hw in sess1:
        d = (TODAY - datetime.timedelta(days=ago)).isoformat()
        api("POST", f"/api/patients/{id1}/sessions", token, {
            "date": d, "duration": 60, "treatment": treat, "response": resp,
            "homework": hw, "nextPlan": "2週間後に体組成チェック",
        })
    print("  セッション記録 4件を投入")

    # ───────── 顧客2：佐藤 健一（ムラがある人） ─────────
    print("\n・顧客2『佐藤 健一』を作成中...")
    p2 = api("POST", "/api/patients", token, {
        "name": "佐藤 健一", "kana": "サトウ ケンイチ", "gender": "男性",
        "birthdate": "1981-09-03", "height": 172,
        "startWeight": 80.0, "targetWeight": 74.0,
        "startDate": dates[0].isoformat(),
        "purpose": "姿勢改善・腰痛改善",
        "finalGoal": "腰痛なく過ごせる体に。姿勢を改善したい",
        "midGoal": "まずは体幹を安定させ、デスクワークの負担を減らす",
        "karteInfo": "営業職で多忙。長時間運転と座位が多い。慢性的な腰の張り。",
    })
    id2 = p2["id"]
    items2 = [
        {"id": "t2a", "text": "プランク1分"},
        {"id": "t2b", "text": "体幹トレ15回"},
        {"id": "t2c", "text": "朝の散歩"},
    ]
    api("PUT", f"/api/patients/{id2}", token, {"trainingItems": items2})
    print("  トレーニング項目を設定")

    print("  30日分の記録を投入中", end="", flush=True)
    for i, d in enumerate(dates):
        target = 80.0 - 1.5 * (i / (DAYS - 1))
        weight = round(target + random.uniform(-0.4, 0.4), 1)
        moti = random.choice([2, 3, 3, 4])
        checks = {it["id"]: (random.random() < 0.5) for it in items2}
        body = {"date": d.isoformat(), "weight": weight, "moti": moti, "checkResults": checks}
        if i % 7 == 0:
            body["reflection"] = random.choice([
                "仕事が忙しくてあまりできなかった", "腰が少し楽な日もある",
                "なかなか時間が取れない…", "散歩はできた",
            ])
        api("POST", f"/api/patients/{id2}/self-record", token, body)
        print(".", end="", flush=True)
    print(" 完了")

    sess2 = [
        (25, "骨盤調整 / 体幹アクティベーション", "施術直後は腰が楽。可動域改善", "毎日プランク1分から"),
        (18, "ストレッチ指導 / 体幹トレ", "ホームワークの実行が不安定。声かけ必要", "通勤時に一駅歩く"),
        (11, "腰部ケア / 姿勢チェック", "座り姿勢の癖を確認。デスク環境を提案", "1時間ごとに立つ"),
        (4,  "体幹強化 / モビリティ", "やれた週は調子が良い。継続が課題", "朝の散歩を習慣に"),
    ]
    for ago, treat, resp, hw in sess2:
        d = (TODAY - datetime.timedelta(days=ago)).isoformat()
        api("POST", f"/api/patients/{id2}/sessions", token, {
            "date": d, "duration": 50, "treatment": treat, "response": resp,
            "homework": hw, "nextPlan": "次回までにホームワーク実行率を上げる",
            "staffNote": "多忙でムラあり。短時間でできるメニューに調整検討",
        })
    print("  セッション記録 4件を投入")

    print("\n✅ 完了しました！管理画面にログインして確認してください。")
    print("   - 田中 美咲（順調・継続率高い）")
    print("   - 佐藤 健一（ムラあり・継続率まばら）")
    print("   ※ デモ後に消したい場合は、管理画面の各顧客カードの×から削除できます。")

if __name__ == "__main__":
    main()
