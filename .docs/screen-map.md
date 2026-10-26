# 画面・機能・処理マップ（仮版）

> 旧版 `361e81c` の参照資料です。最新版の一覧は [機能一覧](function-list.md)、[画面一覧](screen-list.md)、[テーブル一覧](table-list.md) を参照してください。

確認日：2026-10-23。対象コミット：`361e81c`。全体構成は [アプリの全体マップ](app-map.md) を参照。

表の処理名はJava版のもの。APIの受付は `SeatApp.java` の `api()`、管理APIは `adminApi()` にある。`Store.*` は同ファイル内のデータ・業務処理を指す。

デモ版は各画面と同名の `vercel-demo/*.html` を読み、表のAPIに対応する分岐を `vercel-demo/app.js` の `handle()` で確認する。表示や通信エラーの調査では共通の `app.js`、見た目では各版の `style.css` を確認する。

## ログイン画面 `/`

未ログインの利用者がIDとパスワードを入力する。対象画面：`web/index.html`。

| 機能名 | 一行説明 | 対象ファイル・処理 |
|---|---|---|
| ログイン | ID・パスワードを送信し、ログイン状態を作る。 | 画面のフォーム送信 → `POST /api/login` → `Store.account()`、`sessions`、Cookie発行 |
| ログイン後の移動 | 管理者は管理用、着席済みは座席、未着席は席決めへ進む。 | `SeatApp.java` の `homeOf()` → `/admin`、`/seat`、`/seat-change` |
| アカウント作成への移動 | アカウント作成画面を開く。 | 画面のリンク → `/register` |
| エラー表示 | 入力不足や通信失敗のメッセージを表示する。 | `web/app.js` の `api()`、`fail()`、`showMsg()` |

注意：パスワード照合はない。空入力は `E-01`。入力は送信後に前後の空白を除去する。

## アカウント作成画面 `/register`

未ログインの利用者がIDを登録する。対象画面：`web/register.html`。

| 機能名 | 一行説明 | 対象ファイル・処理 |
|---|---|---|
| アカウント登録 | 入力とID重複を確認し、登録後はログイン画面へ戻る。 | フォーム送信 → `POST /api/register` → `Store.register()` → `/` |
| エラー表示 | 未入力は `E-05`、既存ID・管理者IDとの重複は `E-02` を表示する。 | `SeatApp.java` の登録分岐、`web/app.js` の `fail()` |

注意：パスワードは入力必須だが保存されない。登録直後はログイン状態にならない。

## 席決め画面 `/seat-change`

一般利用者が名前とひとことを入力して席を決める。対象画面：`web/seat-change.html`。

| 機能名 | 一行説明 | 対象ファイル・処理 |
|---|---|---|
| お題・プロフィール表示 | 今日のお題と、初回表示時の登録済みの名前・ひとことを表示する。 | 画面の `refresh(first)` → `GET /api/me` |
| 座席状況の表示 | 自分の席・着席中の席・空席を初回と30秒ごとに表示する。 | `refresh(first)` → `GET /api/seat-map` → `Store.seatMap()` → `web/app.js` の `renderSeatMap()` |
| ランダムな席決め | 名前とひとことを保存し、空席を1席割り当てて座席画面へ進む。 | フォーム送信 → `POST /api/seat-change/assign` → `validate()`、`Store.assign()` → `/seat` |
| 重複着席の防止 | 着席済みならボタンを無効にし、処理側でも再割り当てを防ぐ。 | `refresh(first)` の `me.seated`、`Store.assign()` の `seatOf()` |

注意：名前・ひとことは必須。未入力 `E-05`、100文字超過 `E-07`、満席 `E-03`。座席図の空席を押して選ぶ機能はない。

## 座席画面 `/seat`

着席済みの一般利用者が座席や利用者情報を確認する。対象画面：`web/seat.html`。

| 機能名 | 一行説明 | 対象ファイル・処理 |
|---|---|---|
| 座席状況の表示 | 座席情報を初回と30秒ごとに更新する。 | 画面の `refresh()` → `GET /api/me`、`GET /api/seat-map` → `renderSeatMap()` |
| 利用者情報の表示 | 着席中の席を押すと名前・ひとこと・今頑張っていることを表示する。 | `openPopup()` → `GET /api/seats/{id}/person` → `Store.personAt()` |
| プロフィール画面への移動 | 自分の情報を編集する画面を開く。 | アカウント情報ボタン → `/account` |
| 帰社・ログアウト | 自分の席を解放してログアウトし、ログイン画面へ戻る。 | `POST /api/seat/leave` → `Store.leave()`、`logout()` → `/` |
| 座席解除の検知 | 自分の着席がなくなったら通知してログアウトする。 | `refresh()` の `me.seated` → `web/app.js` の `logoutAndGoHome()` |

注意：座席解除の通知文は「0時になったため」だが、手動リセットによる解除でも同じ文言になる。空席の利用者情報は取得できない。

## アカウント情報画面 `/account`

一般利用者がプロフィールを編集する。対象画面：`web/account.html`。

| 機能名 | 一行説明 | 対象ファイル・処理 |
|---|---|---|
| 登録内容とお題の表示 | 名前・ひとこと・今頑張っていること・今日のお題を読み込む。 | 初回の `GET /api/me` → `Store.account()`、`todayTopicText()` |
| プロフィール更新 | 入力内容を保存し、座席画面へ進む。 | フォーム送信 → `POST /api/account` → `validate()`、`Store.saveProfile()` → `/seat` |

注意：名前・ひとことは必須、今頑張っていることは任意。各100文字以内。未着席でもURLにアクセスできるが、保存後の `/seat` へのアクセスは席決め画面へ振り分けられる。

## 管理用画面 `/admin`

管理者が3つのタブで設定を管理する。対象画面：`web/admin.html`。API側では `Store.isAdmin()` で権限を確認する。

| 機能名 | 一行説明 | 対象ファイル・処理 |
|---|---|---|
| 初期データ表示 | お題一覧・今日のお題・座席配置をまとめて取得する。 | `GET /api/admin/data` → `adminData()` → 画面の `render()` |
| タブ切り替え | お題・座席配置・管理者追加を再読み込みせず切り替える。 | 画面の `.tabs button` のクリック処理 |
| お題の追加 | 必須・100文字以内でお題候補を登録する。 | `POST /api/admin/topics` → `Store.addTopic()` |
| お題の編集 | 一覧から選んだお題の本文を更新する。 | `PUT /api/admin/topics/{id}` → `Store.editTopic()` |
| テーブル追加 | 8席のテーブルを1台追加する。 | `POST /api/admin/seat-tables` → `Store.addTable()` |
| テーブル削除 | 着席者がいないテーブルを削除する。 | `DELETE /api/admin/seat-tables/{id}` → `Store.deleteTable()`、着席中なら `E-08` |
| 管理者追加 | IDの未入力・重複を確認して管理者IDを追加する。 | `POST /api/admin/admins` → `Store.addAdmin()` |
| 一括リセット | 確認後に全席を解除し、今日のお題を選び直す。 | `POST /api/admin/daily-reset` → `Store.dailyReset()` → `pickTodayTopic()` |
| ログアウト | 管理者のログイン状態を解除する。 | `web/app.js` の `logoutAndGoHome()` → `POST /api/logout` → `logout()` → `/` |

注意：管理者追加でもパスワードは保存されない。お題が複数なら選び直しで前回のIDを除外する。お題の追加だけでは今日のお題は切り替わらない。

## 共通処理を調べる入口

| 症状 | 最初に確認する処理 |
|---|---|
| 画面を開けない・違う画面へ飛ぶ | Java版は `SeatApp.java` の `page()`、`homeOf()`、`currentUser()`。デモ版は `guard()`、`homeOf()`、`currentUser()`。 |
| 通信・エラー表示がおかしい | Java版は `web/app.js` の `api()`、`fail()`、`showMsg()` と該当API。デモ版は `api()`、`handle()` と表示処理。 |
| 座席図の表示がおかしい | 各版の `app.js` の `renderSeatMap()`、`tableBlock()`、`seatButton()` と `style.css`。データがおかしければ `seatMap()`。 |
| データが消える・共有されない | Java版は `Store` とサーバー再起動の有無。デモ版は `load()`、`save()` とブラウザ内保存の範囲。 |

該当画面と上記の処理から調査を始め、実際に依存する処理に沿って範囲を広げる。
