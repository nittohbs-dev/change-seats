package seatapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import seatapp.entity.Account;
import seatapp.repository.AccountRepository;
import seatapp.service.AccountService;
import seatapp.service.ApiException;
import seatapp.service.DailyResetJob;
import seatapp.service.SeatingService;
import seatapp.service.TopicService;

/** 業務ロジックの単体試験（DB は試験用のメモリ上の H2）。画面を含めた確認は tools/ の Node の試験で行う。 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:seattest;DB_CLOSE_DELAY=-1",
        "app.admin.password=testadmin123",
        "app.lock.max-failures=3"
})
class SeatAppTests {
    @Autowired AccountService accounts;
    @Autowired AccountRepository accountRepo;
    @Autowired SeatingService seating;
    @Autowired TopicService topics;
    @Autowired DailyResetJob daily;

    @BeforeEach
    void clear() { seating.resetAll(); }

    private static String code(Runnable r) {
        try { r.run(); return "OK"; } catch (ApiException e) { return e.code; }
    }

    @Test
    void 登録の入力条件() {
        assertThat(code(() -> accounts.register("abc", "password1", false))).isEqualTo("E-10");
        assertThat(code(() -> accounts.register("ab-cd", "password1", false))).isEqualTo("E-10");
        assertThat(code(() -> accounts.register("a".repeat(21), "password1", false))).isEqualTo("E-10");
        assertThat(code(() -> accounts.register("userok1", "short", false))).isEqualTo("E-11");
        assertThat(code(() -> accounts.register("", "", false))).isEqualTo("E-05");
        assertThat(code(() -> accounts.register("userok1", "password1", false))).isEqualTo("OK");
        assertThat(code(() -> accounts.register("userok1", "password1", false))).isEqualTo("E-02");
    }

    @Test
    void パスワードはハッシュ化して保存される() {
        accounts.register("hashuser", "password1", false);
        Account a = accountRepo.findById("hashuser").orElseThrow();
        assertThat(a.passwordHash).isNotEqualTo("password1").startsWith("$2");   // BCrypt
    }

    @Test
    void 連続して失敗するとロックされ_成功すると回数が戻る() {
        accounts.register("lockuser", "password1", false);
        assertThat(code(() -> accounts.authenticate("lockuser", "wrongpass1"))).isEqualTo("E-01");
        assertThat(code(() -> accounts.authenticate("lockuser", "wrongpass1"))).isEqualTo("E-01");
        assertThat(code(() -> accounts.authenticate("lockuser", "password1"))).isEqualTo("OK");   // 成功で戻る
        for (int i = 0; i < 2; i++) assertThat(code(() -> accounts.authenticate("lockuser", "wrongpass1"))).isEqualTo("E-01");
        assertThat(code(() -> accounts.authenticate("lockuser", "wrongpass1"))).isEqualTo("E-09");   // 3回目でロック
        assertThat(code(() -> accounts.authenticate("lockuser", "password1"))).isEqualTo("E-09");    // ロック中は正しくても不可
        assertThat(code(() -> accounts.authenticate("nobody123", "password1"))).isEqualTo("E-01");
    }

    @Test
    void 席決めは先着順で_同じ席は1人だけ_24人まで() throws Exception {
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            String id = "seatuser" + i;
            accounts.register(id, "password1", false);
            ids.add(id);
        }
        ExecutorService pool = Executors.newFixedThreadPool(30);
        List<Callable<String>> jobs = new ArrayList<>();
        for (String id : ids) jobs.add(() -> { try { seating.assign(id, "名前" + id); return "OK"; } catch (ApiException e) { return e.code; } });
        List<String> results = new ArrayList<>();
        for (Future<String> f : pool.invokeAll(jobs)) results.add(f.get());
        pool.shutdown();

        assertThat(results.stream().filter("OK"::equals).count()).isEqualTo(24);        // 24席ぶんだけ座れる
        assertThat(results.stream().filter("E-03"::equals).count()).isEqualTo(6);         // 残りは満席
        Map<String, Object> map = seating.seatMap(ids.get(0));
        @SuppressWarnings("unchecked") List<Map<String, Object>> list = (List<Map<String, Object>>) map.get("seats");
        assertThat(list.stream().filter((s) -> !"free".equals(s.get("state"))).count()).isEqualTo(24);
        assertThat(list.stream().map((s) -> s.get("name")).filter(java.util.Objects::nonNull).distinct().count()).isEqualTo(24);
    }

    @Test
    void 二重着席しない() {
        accounts.register("dupseat", "password1", false);
        seating.assign("dupseat", "一人");
        seating.assign("dupseat", "一人");
        @SuppressWarnings("unchecked") List<Map<String, Object>> list = (List<Map<String, Object>>) seating.seatMap("dupseat").get("seats");
        assertThat(list.stream().filter((s) -> "mine".equals(s.get("state"))).count()).isEqualTo(1);
    }

    @Test
    void 帰社と0時の処理() {
        accounts.register("leaver1", "password1", false);
        seating.assign("leaver1", "帰る人");
        assertThat(seating.isSeated("leaver1")).isTrue();
        seating.leave("leaver1");
        assertThat(seating.isSeated("leaver1")).isFalse();

        accounts.register("leaver2", "password1", false);
        seating.assign("leaver2", "強制帰社の人");
        accounts.saveProfile("leaver2", "強制帰社の人", "残る課題", "残る取り組み");
        daily.reset();
        assertThat(seating.isSeated("leaver2")).isFalse();                                  // 全員が強制帰社
        Account a = accountRepo.findById("leaver2").orElseThrow();
        assertThat(a.name).isEqualTo("強制帰社の人");                                          // 名前・課題・取り組みは消えない
        assertThat(a.issue).isEqualTo("残る課題");
        assertThat(a.effort).isEqualTo("残る取り組み");
        assertThat(topics.todayText()).isNotNull();                                          // 今日のお題が選ばれる
    }

    @Test
    void 文字数の上限() {
        accounts.register("limituser", "password1", false);
        assertThatThrownBy(() -> accounts.saveProfile("limituser", "あ".repeat(101), "", "")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> accounts.saveProfile("limituser", "名前", "い".repeat(201), "")).isInstanceOf(ApiException.class);
        assertThat(accounts.saveProfile("limituser", "名前", "", "").issue).isEmpty();   // 課題・取り組みは任意
    }
}
