package seatapp;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** 座席管理アプリ（テスト版）。controller → service → repository → DB の一方向。 */
@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)   // ログインは自前で確認するので、自動生成のパスワードは使わない
@EnableScheduling
public class SeatApplication {
    public static void main(String[] args) {
        SpringApplication.run(SeatApplication.class, args);
    }
}
