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

    public SeatApiController(AccountService accounts, SeatingService seating, TopicService topics, EventBus events) {
        this.accounts = accounts;
        this.seating = seating;
        this.topics = topics;
        this.events = events;
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
        m.put("seated", seating.isSeated(a.accountId));
        m.put("topic", topics.todayText());
        return m;
    }

    @GetMapping("/seat-map")
    Map<String, Object> seatMap(@AuthenticationPrincipal AppUser user) {
        return seating.seatMap(user.accountId());
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

    /** アカウント情報の保存。名前は必須、課題と取り組みは任意。変更するまで保存され続ける。 */
    @PostMapping("/account")
    Map<String, Object> save(@AuthenticationPrincipal AppUser user, @RequestParam(defaultValue = "") String name,
                             @RequestParam(defaultValue = "") String issue, @RequestParam(defaultValue = "") String effort) {
        accounts.saveProfile(user.accountId(), name, issue, effort);
        events.changed();
        return Map.of("redirect", "/seat");
    }
}
