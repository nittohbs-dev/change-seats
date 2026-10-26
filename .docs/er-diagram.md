# ER図

更新日：2026-10-26。既存機能の確認対象：`origin/main` の `f2fb79c`。追加予定は未実装。

モデルアップロード対応を含む7テーブルの関係図。追加予定のレイアウト2テーブルと座席の拡張項目を含むため、現在のDBそのものを表す図ではない。主要なキーと座標のみを示す。

[機能一覧](function-list.md)・[画面一覧](screen-list.md)・[テーブル一覧](table-list.md)

```mermaid
erDiagram
    direction LR
    M_ACCOUNT["M_アカウント"] {
        varchar account_id PK
        varchar name
        boolean is_admin
    }
    M_LAYOUT["M_レイアウト"] {
        bigint layout_id PK
        varchar name
        bigint active_version_id FK
    }
    T_VERSION["T_レイアウト版"] {
        bigint version_id PK
        bigint layout_id FK
        varchar uploaded_by FK
        varchar status
        text source_path
        text glb_path
        text furniture_json_path
    }
    M_SEAT["M_座席"] {
        bigint seat_id PK
        bigint version_id FK
        varchar model_seat_key
        double x
        double y
        double z
        double rotation
    }
    T_SEATING["T_着席情報"] {
        varchar account_id PK,FK
        bigint seat_id FK,UK
        timestamp seated_at
    }
    M_TOPIC["M_お題"] {
        bigint topic_id PK
        varchar text
    }
    T_DAILY["T_日別お題"] {
        date topic_date PK
        bigint topic_id FK
    }
    M_ACCOUNT ||--o{ T_VERSION : アップロード
    M_LAYOUT ||--o{ T_VERSION : 版を保有
    M_LAYOUT o|--o| T_VERSION : 有効版を選択
    T_VERSION ||--o{ M_SEAT : 座席を保有
    M_ACCOUNT ||--o| T_SEATING : 着席
    M_SEAT ||--o| T_SEATING : 1席1人
    M_TOPIC ||--o{ T_DAILY : 日ごとに選択
```

- PK：主キー、FK：外部キー、UK：一意制約。FKの線は今回の関係案であり、現行DBの制約適用を保証するものではない。
- アカウントと着席情報、座席と着席情報はいずれも最大1対1。
- レイアウトは複数の版を持ち、そのうち最大1件を有効版に指定する。有効版は同じレイアウトに属する。
- 座席はレイアウト版に所属する。人と座標は着席情報を介して対応する。
