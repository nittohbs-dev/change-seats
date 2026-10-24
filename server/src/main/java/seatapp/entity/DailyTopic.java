package seatapp.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;

/** 今日のお題。日ごとに1件。前日と同じお題を選ばない。 */
@Entity
@Table(name = "daily_topic")
public class DailyTopic {
    @Id
    @Column(name = "topic_date")
    public LocalDate topicDate;

    @Column(name = "topic_id", nullable = false)
    public Long topicId;

    protected DailyTopic() { }

    public DailyTopic(LocalDate topicDate, Long topicId) {
        this.topicDate = topicDate;
        this.topicId = topicId;
    }
}
