# Partly Rainy ランキング用サーバー(Cloudflare Workers + D1)

ゲーム本体(`index.html`)とは別に、Cloudflare にこの小さなサーバーを置きます。
無料枠で足ります。Cloudflare のアカウント(無料)と Node.js が必要です。

## 公開手順(最初の1回)

PowerShell を `server` フォルダで開いて、順に実行します。

```powershell
# 1. ログイン(ブラウザが開きます)
npx wrangler login

# 2. データベースを作る。表示される database_id を wrangler.toml の database_id に貼る
npx wrangler d1 create partly-rainy-scores

# 3. テーブルを作る(本番)
npx wrangler d1 execute partly-rainy-scores --remote --file=schema.sql

# 4. (任意) IP の記録を匿名化するための塩。好きな長い文字列を入れる
npx wrangler secret put SALT

# 5. 公開する。最後に https://partly-rainy-scores.<あなたの名前>.workers.dev のURLが表示される
npx wrangler deploy
```

## ゲームにつなぐ

`index.html` の先頭付近にある次の行に、手順5で表示された URL(末尾に `/` を付けない)を入れます。

```js
const SCORE_API = 'https://partly-rainy-scores.<あなたの名前>.workers.dev';
```

空のままなら、ランキング機能は出ません(これまでどおり遊べます)。

## 公開後にやること

- `wrangler.toml` の `ALLOWED_ORIGINS` を、ゲームを公開する URL(例 `https://example.com`)に変えて、もう一度 `npx wrangler deploy` します。
  他のサイトから、勝手にこのサーバーへ登録されにくくなります。
- 動作確認: ブラウザで `<Worker の URL>/scores` を開くと、`{"scores":[]}` のような表示になります。

## API

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/scores?limit=10` | 上位のスコア(最大50件) |
| POST | `/scores` | 登録。`{ name, score, lines, level, pieces }` |

登録できるのは、名前が1〜12文字、点数がゲームの採点とつじつまが合うものだけです。
同じ端末からの登録は、15秒に1回までです。

## 注意

- ブラウザから送る得点は、完全には守れません。ここでの対策は、ありえない値を弾く簡易なものです。
- 名前に不適切な言葉が入ることを防ぐ機能は入っていません。必要なら `worker.js` の `cleanName` に足してください。
- 登録された得点を消したいときは、次のように実行します。
  ```powershell
  npx wrangler d1 execute partly-rainy-scores --remote --command "DELETE FROM scores WHERE id = 123"
  ```
