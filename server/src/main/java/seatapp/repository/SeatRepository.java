package seatapp.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import seatapp.entity.Seat;

public interface SeatRepository extends JpaRepository<Seat, Long> { }
