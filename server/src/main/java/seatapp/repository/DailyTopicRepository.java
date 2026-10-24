package seatapp.repository;

import java.time.LocalDate;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import seatapp.entity.DailyTopic;

public interface DailyTopicRepository extends JpaRepository<DailyTopic, LocalDate> {
    /** 指定日より前で、いちばん新しい行（前日のお題を調べるため） */
    Optional<DailyTopic> findFirstByTopicDateBeforeOrderByTopicDateDesc(LocalDate date);
}
