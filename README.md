# ジャンケンバトラーズ オンライン対戦サーバー

2人対戦の「手」と「デッキ」を中継するだけのリレー型サーバーです。
ダメージ計算などのゲームロジックは一切持ちません（両クライアントが
同じロジックでローカル計算するので、サーバーはただの伝言役です）。

## ローカルで動作確認する

デプロイする前に、まず自分のPCで動かして確認するのがおすすめです。

```bash
cd server
npm install
npm start
```

`janken-battlers relay server listening on :3000` と出れば起動成功です。

ゲーム本体（`janken_battlers_app.html`）を開いて、以下の2行を書き換えます：

```js
const NET_MODE = 'real';                    // 'mock' から変更
const SERVER_URL = 'http://localhost:3000'; // ローカルで確認する場合はこのまま
```

保存して、**同じファイルを2つのブラウザタブ（またはPCとスマホ）で開き**、
片方で「部屋を作る」、もう片方で表示された4桁コードを「コードで参加」に
入力すれば、ローカルで対戦できます。

## Renderにデプロイする（無料枠）

1. [render.com](https://render.com) にアクセスしてアカウント作成（GitHubアカウントでOK）
2. このserverフォルダをGitHubリポジトリにアップロードする
   - GitHubに不慣れなら: GitHubで新規リポジトリを作成 → `server`フォルダの中身（`server.js`と`package.json`）をアップロード
3. Renderのダッシュボードで **New +** → **Web Service** を選択
4. さっき作ったGitHubリポジトリを選ぶ
5. 設定はこうする：
   - **Name**: 好きな名前（例: `janken-battlers-server`）
   - **Root Directory**: リポジトリ直下にserver.jsを置いた場合は空欄でOK
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
6. **Create Web Service** をクリック。数分待つとデプロイが終わり、
   `https://janken-battlers-server-xxxx.onrender.com` のようなURLが発行される
7. そのURLをコピーして、ゲーム本体の2行を書き換える：

```js
const NET_MODE = 'real';
const SERVER_URL = 'https://janken-battlers-server-xxxx.onrender.com'; // 発行されたURLに置き換え
```

8. ゲーム本体を保存し直して、友達と2台のスマホ/PCでそれぞれ開けば対戦できます。

## 無料枠の注意点

Renderの無料プランは **15分アクセスが無いとサーバーがスリープする** 仕様です。
スリープ中に誰かが接続しようとすると、起動に10〜30秒ほどかかります
（「部屋を作る」を押してすぐ反応がなくても、少し待てば繋がります）。

常時起動させたい場合は有料プラン（月$7〜）に上げるか、外部の
「定期的にpingを送るサービス」（UptimeRobotなど）でスリープを防ぐ方法もあります。

## 今後の拡張

今回は「リレー方式」（サーバーはゲームロジックを持たず中継のみ）で
実装しています。改造クライアントによるズルを厳密に防ぎたくなったら、
`server.js`にダメージ計算ロジックを移植して「サーバー権威方式」に
強化できます（`submit_hand`を受け取った時点でサーバー自身が勝敗と
ダメージを計算し、その結果だけをクライアントに送る形）。
