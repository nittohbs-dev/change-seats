package seatapp.service;

/** 画面へ {error, message} の JSON で返す業務上のエラー（メッセージ番号は仕様書第7章） */
public class ApiException extends RuntimeException {
    public final int status;
    public final String code;

    public ApiException(int status, String code) {
        super(Messages.of(code));
        this.status = status;
        this.code = code;
    }
}
