package seatapp.service;

import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/** 入力の確認（基本設計書の案：IDは半角英数4〜20文字、パスワードは8文字以上、名前100文字、課題等200文字） */
public final class Validators {
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9]{4,20}$");
    public static final int NAME_MAX = 100, LONG_MAX = 200;

    private Validators() { }

    public static String accountId(String id) {
        if (id == null || id.isBlank()) throw new ApiException(400, "E-05");
        if (!ID.matcher(id).matches()) throw new ApiException(400, "E-10");
        return id;
    }

    public static String password(String pw) {
        if (pw == null || pw.isEmpty()) throw new ApiException(400, "E-05");
        // BCrypt は先頭の72バイトしか見ないので、それを超える長さは受け付けない
        if (pw.length() < 8 || pw.getBytes(StandardCharsets.UTF_8).length > 72) throw new ApiException(400, "E-11");
        return pw;
    }

    /** 必須の文字列（前後の空白は除く）。空なら E-05、長すぎれば E-07。 */
    public static String required(String v, int max) {
        String t = v == null ? "" : v.strip();
        if (t.isEmpty()) throw new ApiException(400, "E-05");
        return limit(t, max);
    }

    /** 任意の文字列。空でもよいが、長すぎれば E-07。 */
    public static String optional(String v, int max) {
        return limit(v == null ? "" : v.strip(), max);
    }

    private static String limit(String t, int max) {
        if (t.codePointCount(0, t.length()) > max) throw new ApiException(400, "E-07");
        return t;
    }
}
