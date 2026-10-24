package seatapp.controller;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import seatapp.service.AccountService;
import seatapp.service.DailyResetJob;
import seatapp.service.EventBus;
import seatapp.service.Messages;
import seatapp.service.SeatingService;
import seatapp.service.TopicService;

/** 管理用画面の操作（管理者だけ）：お題の登録・編集、管理者アカウントの追加、0時の処理のテスト実行 */
@RestController
@RequestMapping("/api/admin")
public class AdminApiController {
    private final SeatingService seating;
    private final TopicService topics;
    private final AccountService accounts;
    private final DailyResetJob daily;
    private final EventBus events;

    public AdminApiController(SeatingService seating, TopicService topics, AccountService accounts, DailyResetJob daily, EventBus events) {
        this.seating = seating;
        this.topics = topics;
        this.accounts = accounts;
        this.daily = daily;
        this.events = events;
    }

    /** 席の図（着席状況つき）・お題の一覧・今日のお題 */
    @GetMapping("/data")
    Map<String, Object> data() {
        Map<String, Object> m = seating.seatMap(null);
        m.put("topics", topics.list());
        m.put("todayTopic", topics.todayText());
        return m;
    }

    @PostMapping("/topics")
    Map<String, Object> addTopic(@RequestParam(defaultValue = "") String text) {
        topics.add(text);
        events.changed();
        return data();
    }

    @PutMapping("/topics/{id}")
    Map<String, Object> editTopic(@PathVariable long id, @RequestParam(defaultValue = "") String text) {
        topics.edit(id, text);
        events.changed();
        return data();
    }

    @PostMapping("/admins")
    Map<String, Object> addAdmin(@RequestParam(defaultValue = "") String id, @RequestParam(defaultValue = "") String password) {
        accounts.register(id, password, true);
        return Map.of("message", Messages.of("I-01"));
    }

    /** テスト用：午前0時の処理（強制帰社＋お題の選び直し）をその場で実行する */
    @PostMapping("/daily-reset")
    Map<String, Object> dailyReset() {
        daily.reset();
        return data();
    }
}
