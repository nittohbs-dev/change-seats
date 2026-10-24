package seatapp.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 毎日午前0時（日本時間）の処理：全員を強制帰社にして、今日のお題を選ぶ。名前・課題・取り組みは消さない。 */
@Component
public class DailyResetJob {
    private static final Logger log = LoggerFactory.getLogger(DailyResetJob.class);
    private final SeatingService seating;
    private final TopicService topics;
    private final EventBus events;

    public DailyResetJob(SeatingService seating, TopicService topics, EventBus events) {
        this.seating = seating;
        this.topics = topics;
        this.events = events;
    }

    @Scheduled(cron = "0 0 0 * * *", zone = "${app.timezone}")
    public void midnight() {
        log.info("午前0時の処理を開始");
        reset();
        log.info("午前0時の処理を終了");
    }

    /** 強制帰社＋お題の選び直し。終わったら全員の画面へすぐ知らせる（座席画面の人はホームへ戻る）。 */
    public void reset() {
        seating.resetAll();
        topics.pickToday();
        events.changed();
    }
}
