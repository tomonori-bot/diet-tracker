# 手順：Supabaseの準備（ステップ1）

> ゴール：Supabaseのアカウント・プロジェクトを作り、接続情報を取得して、Renderに設定する。
> ここまでできれば、次回からコード書き換えに入れる。
> 所要：15〜20分くらい

---

## A. アカウントを作る

1. ブラウザで **https://supabase.com** を開く
2. 右上の **「Start your project」** をクリック
3. **「Continue with GitHub」** を選ぶ（あなたのGitHub: tomonori-bot を使う／一番ラク）
4. GitHubの認証画面が出たら **「Authorize supabase」** をクリック
5. Supabaseのダッシュボード（管理画面）が開けばOK

---

## B. プロジェクトを作る

1. ダッシュボードで **「New project」** をクリック
2. 組織（Organization）を聞かれたら、デフォルトのままでOK（無ければ作成される）
3. 入力欄：
   - **Name（プロジェクト名）**：`bodylog`
   - **Database Password**：強いパスワードを入れる（自動生成ボタンがあれば使う）
     - ⚠️ **このパスワードは必ずメモして保管**（後で使う可能性。なくすと面倒）
   - **Region（地域）**：`Northeast Asia (Tokyo)` を選ぶ（日本に一番近い＝速い）
   - **Pricing Plan**：**Free**（無料）を選ぶ
4. **「Create new project」** をクリック
5. 「Setting up project...」のような表示で **1〜2分待つ**（DBの準備中）

---

## C. 接続情報を取得する（重要）

> プロジェクトができたら、アプリから接続するための「鍵」を2つ取得する。

1. 左メニューの一番下あたりの **歯車アイコン（Project Settings）** をクリック
2. **「API」** または **「Data API」** という項目を開く
3. 次の2つをコピーして、安全な場所にメモ：

   **① Project URL**
   - `https://xxxxxxxxxxxx.supabase.co` のような形
   - → これをメモ

   **② API Key（service_role）**
   - 「Project API keys」の中に `anon` と `service_role` の2つがある
   - **`service_role`** の方の「Reveal」を押して表示 → コピー
   - ⚠️ これは**強い権限の秘密鍵**。絶対に他人に見せない・SNSに貼らない
   - → これをメモ

> ※ どちらを使うかは、コード書き換え時に最終確認する。
>   まずは両方（URL ＋ service_role キー）を控えておく。

---

## D. Renderに接続情報を設定する

> 取得した鍵を、コードに直書きせず、Renderの環境変数に入れる（安全のため）。

1. Renderダッシュボード → **diet-tracker** → **Environment**
2. **「Add Environment Variable」** で2つ追加：
   - Key：`SUPABASE_URL` / Value：①でメモしたProject URL
   - Key：`SUPABASE_KEY` / Value：②でメモしたservice_role キー
3. **「Save Changes」**（このあと自動で再起動するが、まだコードが使っていないので影響なし）

---

## 完了の合図
- A〜Dまで終わったら「ステップ1できた」と伝える
- 接続情報（URL・キー）の値は**私に教えなくてOK**。Renderに入れてあれば、コードはそこから読む

---

## 次回（ステップ2〜3）
- Supabaseにテーブルを作る（DB設計）
- コードをファイル保存→DB保存に書き換える
