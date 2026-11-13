package seatapp.controller;

import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import seatapp.entity.Account;
import seatapp.service.AccountService;
import seatapp.service.AppUser;
import seatapp.service.EventBus;
import seatapp.service.KaijuService;
import seatapp.service.SeatingService;
import seatapp.service.TopicService;

/** 席の図・席決め・帰社・アカウント情報（一般アカウント向け） */
@RestController
@RequestMapping("/api")
public class SeatApiController {
    private final AccountService accounts;
    private final SeatingService seating;
    private final TopicService topics;
    private final EventBus events;
    private final KaijuService kaiju;

    public SeatApiController(AccountService accounts, SeatingService seating, TopicService topics, EventBus events, KaijuService kaiju) {
        this.accounts = accounts;
        this.seating = seating;
        this.topics = topics;
        this.events = events;
        this.kaiju = kaiju;
    }

    @GetMapping("/me")
    Map<String, Object> me(@AuthenticationPrincipal AppUser user) {
        Account a = accounts.get(user.accountId());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.accountId);
        m.put("admin", a.admin);
        m.put("name", a.name == null ? "" : a.name);
        m.put("issue", a.issue == null ? "" : a.issue);
        m.put("effort", a.effort == null ? "" : a.effort);
        m.put("costume", AccountService.costumeOf(a));
        m.put("seated", seating.isSeated(a.accountId));
        m.put("topic", topics.todayText());
        return m;
    }

    @GetMapping("/seat-map")
    Map<String, Object> seatMap(@AuthenticationPrincipal AppUser user) {
        Map<String, Object> m = seating.seatMap(user.accountId());
        addKaiju(m, user.accountId(), kaiju);
        return m;
    }

    /** 座席図のデータに、怪獣の状態（押した時刻。暴れていなければ null）と、この人が怪獣ボタンを押せるかを足す */
    static void addKaiju(Map<String, Object> m, String viewer, KaijuService kaiju) {
        m.put("kaiju", kaiju.activeSince());
        m.put("canKaiju", kaiju.allowed(viewer));
    }

    /** 怪獣ボタン。全員の画面に、同じ時刻から怪獣が現れる */
    @PostMapping("/kaiju")
    Map<String, Object> kaiju(@AuthenticationPrincipal AppUser user) {
        long at = kaiju.start(user.accountId());
        events.changed();
        return Map.of("kaiju", at, "now", System.currentTimeMillis());
    }

    @GetMapping("/seats/{seatId}/person")
    ResponseEntity<Map<String, Object>> person(@PathVariable long seatId) {
        Map<String, Object> p = seating.person(seatId);
        if (p == null) return ResponseEntity.status(404).body(Map.of("error", "EMPTY", "message", "この席は空いています"));
        return ResponseEntity.ok(p);
    }

    /** 席決め。成功したら /seat へ。満席は E-03。すでに着席していれば何もせず /seat へ。 */
    @PostMapping("/seat-change/assign")
    Map<String, Object> assign(@AuthenticationPrincipal AppUser user, @RequestParam(defaultValue = "") String name) {
        seating.assign(user.accountId(), name);
        events.changed();
        return Map.of("redirect", "/seat");
    }

    /** 帰社。着席情報を削除してログアウトし、/ へ。 */
    @PostMapping("/seat/leave")
    Map<String, Object> leave(@AuthenticationPrincipal AppUser user, HttpServletRequest req) {
        seating.leave(user.accountId());
        AuthApiController.endSession(req);
        events.changed();
        return Map.of("redirect", "/");
    }

    /** アカウント情報の保存。名前は必須、課題と取り組みは任意。コスチュームは送られた時だけ変える。変更するまで保存され続ける。 */
    @PostMapping("/account")
    Map<String, Object> save(@AuthenticationPrincipal AppUser user, @RequestParam(defaultValue = "") String name,
                             @RequestParam(defaultValue = "") String issue, @RequestParam(defaultValue = "") String effort,
                             @RequestParam(defaultValue = "") String costume) {
        accounts.saveProfile(user.accountId(), name, issue, effort, costume);
        events.changed();
        return Map.of("redirect", "/seat");
    }
}
