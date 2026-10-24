# 座席管理アプリ（テスト版）

席決め → 2Dの座席図 → 3Dのバーチャルオフィス（分身が歩く）。ローカルでサーバーを立てて、全員の画面を同期できる。

## 起動（ローカルのサーバー）

`start.bat` をダブルクリック。初めてだけ、Maven（持ち運び版）と部品を自動で用意するので数分かかる。

- ブラウザで http://localhost:8081 が開く（このPCの設定）。
- **初めての起動では、管理者（ID `admin`）のパスワードが、黒い画面に1回だけ表示される。** 控えておくこと。
  決めたパスワードを使うなら、起動前に環境変数 `SEAT_ADMIN_PASSWORD` を設定する。
- **同じ LAN の他の PC からも使える。** 黒い画面に出る `http://（このPCのIPアドレス）:8081` を開く。
  初回は Windows のファイアウォールの許可が必要。HTTP のみ（HTTPS は本番で）。
- プログラムを直したあとは `start.bat rebuild`（起動中のサーバーは先に止める）。
- **このPCでは 8081 で起動する**（http://localhost:8081）。番号は `server/config/application.yml` の `server.port` で変えられる。その時だけ変えるなら、環境変数 `PORT`（例：PowerShell で `$env:PORT = 8082; .\start.bat`）。設定ファイルが無いPCでは 8080。

## できること

- **アカウント登録**：ID は半角英数字 4〜20 文字、パスワードは 8 文字以上。パスワードは BCrypt でハッシュ化して保存。5回続けて失敗すると5分間ロック。
- **全員の画面の同期**：席決め・帰社・名前やプロフィールの変更・お題の登録・0時のリセットが、全員の画面にすぐ反映される（SSE）。分身の動きとセリフは、サーバーの時刻から計算するので、全端末で同じ。
- **保存**：アカウント、名前・課題・取り組み、着席状況が、サーバーを再起動しても残る（PostgreSQL。下記）。
- **0時の処理**：毎日 0:00（日本時間）に全員が強制帰社し、今日のお題が選ばれる。0時をまたいで止まっていた時は、起動時に補正する。

## 構成

| 場所 | 中身 |
|---|---|
| `server/` | Spring Boot 3.5（Java 21 以上）。Spring Security・Spring Data JPA・H2／PostgreSQL・SSE |
| `web/` | 画面（HTML／JavaScript／Three.js）と、3Dモデル・席の位置（Blender から書き出し）。Vercel に置くデモ版も同じもの |
| `tools/` | Blender の書き出し（`export_*.py`）、試験（`test-*.mjs`）、起動の補助（`start.ps1`） |
| `SeatApp.java`、`start-simple.bat` | 以前のテスト版（Java 標準機能だけの簡易サーバー）。比較・戻し用 |

画面は、サーバーが `/api/ping` に答えるかで、**ローカル版（サーバーあり）** と **デモ版（サーバーなし。ブラウザ内に保存。Vercel）** を自動で切り替える。

## データベース（PostgreSQL）

このPCには **PostgreSQL 17** がインストール済み（Windows のサービス `postgresql-x64-17`、ポート 5432、PC の起動時に自動で開始）。

- アプリ用のユーザー・データベースは、どちらも `seatapp`。
- 接続先とパスワードは `server/config/application.yml`、管理用（`postgres`）とアプリ用のパスワードは `server/config/postgres-secrets.txt` にある。**このPCだけのファイルで、Git には入らない（`server/.gitignore`）。外に出さないこと。**
- 表（accounts・seats・seatings・topics・daily_topic）は、初回の起動で自動で作られる（`ddl-auto: update`。本番では Flyway などで管理する）。
- `start.bat` は起動前に、PostgreSQL のサービスが動いているかを確認する。止まっていたら、Windows の「サービス」から開始する。
- 中身を見る：`"C:\Program Files\PostgreSQL\17\bin\psql.exe" -h localhost -U seatapp -d seatapp`（パスワードは上のファイル）。
- **H2（ファイル保存）に戻す**：`server/config/application.yml` を削除（または名前を変える）すれば、`server/data/` の H2 を使う。

## 試験

サーバーを起動してから（例：`PORT=8090`）：

```
node tools/test-server.mjs        # 登録・ログイン・ロック・権限・CSRF・画面の出し分け・保存
node tools/test-concurrent.mjs    # 25人が同時に登録・ログイン・席決め（24人が座れて、1人は満席）
node tools/test-sync.mjs          # 24人への即時の通知（1秒以内）と、再接続での追いつき
node tools/test-browser.mjs       # 2つのブラウザ（Edge）で、画面の同期を確認
node tools/test-nav.mjs           # 分身の道（家具を貫通しない）・ルート・セリフ（サーバー不要）
cd server && ..\tools\maven\bin\mvn.cmd test   # 業務ロジックの単体試験（JUnit）
```

## 注意

- 管理画面の「0時の処理を今すぐ実行」は、テスト用。全員が帰社になる。
- 本番にする前に：HTTPS／WSS、DB のバックアップ、`ddl-auto` を使わずスキーマを管理する（Flyway など）、ログイン情報の運用を決める。
