package seatapp.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import seatapp.entity.Topic;

public interface TopicRepository extends JpaRepository<Topic, Long> { }
