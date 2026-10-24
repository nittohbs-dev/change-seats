package seatapp.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import seatapp.entity.Account;

public interface AccountRepository extends JpaRepository<Account, String> { }
