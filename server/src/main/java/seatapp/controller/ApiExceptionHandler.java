package seatapp.controller;

import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import seatapp.service.ApiException;
import seatapp.service.Messages;

/** どの API のエラーも {error, message} の JSON で返す（画面は error の番号で処理を分け、message を表示する） */
@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> api(ApiException e) {
        return body(e.status, e.code);
    }

    /** 想定していないエラー。画面には E-06（通信の失敗）として返し、詳しい内容はログにだけ残す。 */
    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> other(Exception e) {
        log.error("想定していないエラー", e);
        return body(500, "E-06");
    }

    private static ResponseEntity<Map<String, Object>> body(int status, String code) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", code);
        m.put("message", code.equals("E-06") ? "通信に失敗しました。もう一度お試しください" : Messages.of(code));
        return ResponseEntity.status(status).body(m);
    }
}
