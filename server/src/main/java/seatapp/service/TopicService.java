package seatapp.service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import seatapp.entity.DailyTopic;
import seatapp.entity.Topic;
import seatapp.repository.DailyTopicRepository;
import seatapp.repository.TopicRepository;

/** お題の登録・編集と、今日のお題の選択（前日と同じお題は選ばない。お題が1件なら同じものを選ぶ） */
@Service
public class TopicService {
    private static final Logger log = LoggerFactory.getLogger(TopicService.class);
    private final TopicRepository topics;
    private final DailyTopicRepository daily;
    private final ZoneId zone;
    private final Random random = new Random();

    public TopicService(TopicRepository topics, DailyTopicRepository daily, @Value("${app.timezone}") String zone) {
        this.topics = topics;
        this.daily = daily;
        this.zone = ZoneId.of(zone);
    }

    public LocalDate today() { return LocalDate.now(zone); }

    public List<Map<String, Object>> list() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Topic t : topics.findAll()) out.add(Map.of("id", t.topicId, "text", t.text));
        out.sort((a, b) -> Long.compare((Long) a.get("id"), (Long) b.get("id")));
        return out;
    }

    @Transactional
    public Topic add(String text) {
        return topics.save(new Topic(Validators.required(text, Validators.NAME_MAX)));
    }

    @Transactional
    public void edit(long id, String text) {
        topics.findById(id).ifPresent((t) -> t.text = Validators.required(text, Validators.NAME_MAX));
    }

    /** 初めての起動で、お題が1件もない時のサンプル */
    @Transactional
    public void seedIfEmpty() {
        if (topics.count() > 0) return;
        for (String t : List.of("最近ハマっていること", "好きな食べ物", "週末にしたいこと", "子どもの頃の夢")) topics.save(new Topic(t));
    }

    /** 今日のお題の文。お題がなければ null（画面には「お題なし」と出る） */
    public String todayText() {
        return daily.findById(today()).flatMap((d) -> topics.findById(d.topicId)).map((t) -> t.text).orElse(null);
    }

    public boolean hasToday() { return daily.existsById(today()); }

    /** 今日のお題を選んで保存する。すでに今日の分があれば、それとも前日とも違うお題を選び直す。 */
    @Transactional
    public void pickToday() {
        LocalDate today = today();
        List<Topic> all = topics.findAll();
        if (all.isEmpty()) { log.info("お題が0件なので、今日のお題は選ばない"); return; }
        Long avoid = daily.findById(today).map((d) -> d.topicId)
                .or(() -> daily.findFirstByTopicDateBeforeOrderByTopicDateDesc(today).map((d) -> d.topicId)).orElse(null);
        List<Topic> candidates = new ArrayList<>(all);
        if (candidates.size() > 1 && avoid != null) candidates.removeIf((t) -> t.topicId.equals(avoid));
        Topic chosen = candidates.get(random.nextInt(candidates.size()));
        daily.save(new DailyTopic(today, chosen.topicId));
        log.info("今日のお題を選んだ: {}", chosen.text);
    }
}
