package seatapp.service;

import java.util.Map;

/** 画面に出すメッセージ（番号は仕様書の E-xx / I-xx。今のテスト版サーバー・デモ版と同じ） */
public final class Messages {
    private static final Map<String, String> MSG = Map.ofEntries(
            Map.entry("E-01", "IDまたはパスワードが違います"),
            Map.entry("E-02", "このIDは使われています"),
            Map.entry("E-03", "満席です"),
            Map.entry("E-05", "未入力の項目があります"),
            Map.entry("E-07", "文字数が多すぎます（名前は100文字、課題の項目は200文字まで）"),
            Map.entry("E-09", "ログインに続けて失敗したため、しばらくロックされています。時間をおいてお試しください"),
            Map.entry("E-10", "IDは半角英数字の4〜20文字で入力してください"),
            Map.entry("E-11", "パスワードは8文字以上で入力してください"),
            Map.entry("I-01", "管理者アカウントを追加しました"),
            Map.entry("AUTH", "ログインしてください"),
            Map.entry("CSRF", "画面の有効期限が切れました。ページを読み込み直してください"));

    private Messages() { }

    public static String of(String code) { return MSG.getOrDefault(code, code); }
}
