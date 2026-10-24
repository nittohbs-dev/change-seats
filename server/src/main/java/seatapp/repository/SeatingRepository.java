package seatapp.repository;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import seatapp.entity.Seating;

public interface SeatingRepository extends JpaRepository<Seating, String> {
    Optional<Seating> findBySeatId(Long seatId);
}
