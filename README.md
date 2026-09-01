# デジタル花火大会

みんなで作る、一夜限りの花火大会。

来場者がスマートフォンで花火を描いて投稿すると、巨大スクリーンの夜空に
本物の花火のように打ち上がる参加型インスタレーション。

## 画面

| URL | 役割 |
| --- | --- |
| `/` | 投稿画面 — スマホで花火を描いて打ち上げる |
| `/screen` | スクリーン画面 — 大型ディスプレイに全画面表示 (クリックで開始) |
| `/admin` | 管理画面 — 投稿の非表示/再表示・全削除・スクリーン設定 |

## 起動

```bash
npm install
npm run dev
```

- 投稿: http://localhost:3000/
- スクリーン: http://localhost:3000/screen
- 管理: http://localhost:3000/admin

環境変数なしでそのまま動く (投稿は `.data/fireworks.json` にファイル保存され、
SSE でスクリーンへリアルタイム同期される)。

## Supabase を使う場合

1. Supabase プロジェクトを作成し、SQL Editor で `supabase/schema.sql` を実行
2. `.env.local.example` を `.env.local` にコピーして URL / anon key を設定
3. 再起動すると自動で Supabase + Realtime モードに切り替わる

## 構成

- Next.js 15 / React 19 / TypeScript
- 描画: HTML Canvas + Pointer Events (座標は 0..1 正規化のストロークとして保存)
- 花火: Three.js — 描いた線を等間隔サンプリングして数百〜1500 個のパーティクルへ変換し、
  爆心から描画形状へ展開 (Bloom / Trail / 火の粉 / 煙 / Z 方向の奥行き)
- 音: WebAudio による完全プロシージャル合成 (打ち上げ・爆発・火の粉・環境音。音源ファイル不使用)
- データ: Supabase (未設定時はローカルファイル + SSE にフォールバック)

## インターネット公開 (トンネル)

来場者以外も含め誰でもスマホから参加させたい場合は、トンネルで公開する。

```bash
npm run public
```

(`ADMIN_KEY` は `.env.local` に設定。ビルド出力は `.next-prod` に分離されるため、
公開中に `npm run dev` を動かしても公開側は壊れない)

別ターミナルで (Cloudflare, アカウント不要):

```bash
cloudflared tunnel --url http://localhost:3100
```

表示された `https://xxxx.trycloudflare.com` が参加者用URL。

- **スクリーンは会場のPCでローカルで開く**こと:
  `http://localhost:3100/screen?submit=https://xxxx.trycloudflare.com`
  (`?submit=` で QR の宛先を公開URLに上書き。QRの下に宛先ホスト名も小さく表示される)
- 管理画面は `http://localhost:3100/admin?key=<ADMIN_KEY>` を一度開けば以後キー不要。
  外出先など公開URL側から開く場合も同様に `https://xxxx.trycloudflare.com/admin?key=<ADMIN_KEY>`
  (キー無しだと 404 になるのが正常。ブラウザに Cookie が入るので2回目からは `/admin` だけでよい)
- `ADMIN_KEY` を設定すると、公開URL側では /admin は 404、非表示化/全削除/設定変更 API は 401 になる

注意:

- cloudflared のクイックトンネルは **SSE (リアルタイム通知) がバッファされて届かない**ため、
  スクリーンを公開URL側で開くと新着の即時打ち上げと設定のライブ反映が効かない
  (打ち上げ自体は数秒以内のポーリング取得で出るので致命的ではない)。
  スクリーンをローカルで開けばこの問題は無い。
- スクリーンも含めて全部を公開URLで動かしたい場合は ngrok を使う (SSEも通る):
  `ngrok http 3100`。ただし無料枠はスマホ初回アクセスに警告ページが挟まり、
  接続数制限もあるためイベント本番には不向き。
- trycloudflare の URL は起動のたびに変わる。固定したい場合は Cloudflare アカウントで
  Named Tunnel (無料) を作る。

## 会場運用メモ

- スクリーンはブラウザ自動再生制限のため最初に 1 クリック必要 (開始画面あり)
- スクリーン右下に投稿ページへの QR を表示 (管理画面で OFF 可)
- 投稿レートリミット: ローカルモードはサーバー側 (IP 別 + 全体上限)。
  Supabase モードは端末側スロットルのみ — 公開デプロイでは Edge Function / RLS で強化すること
- `/admin` に認証は無い — 会場ローカルネットワーク運用を前提。公開デプロイ時は保護すること
