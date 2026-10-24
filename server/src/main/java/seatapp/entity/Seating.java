package seatapp.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * 着席。着席中の行だけを持ち、帰社・強制帰社は行の削除で表す。
 * seat_id の一意制約が、先着順と二重着席の防止の要（同じ席は1人しか取れない）。account_id が主キーなので1人1席まで。
 */
@Entity
@Table(name = "seatings")
public class Seating {
    @Id
    @Column(name = "account_id", length = 20)
    public String accountId;

    @Column(name = "seat_id", nullable = false, unique = true)
    public Long seatId;

    @Column(name = "seated_at", nullable = false)
    public Instant seatedAt;

    protected Seating() { }

    public Seating(String accountId, Long seatId, Instant seatedAt) {
        this.accountId = accountId;
        this.seatId = seatId;
        this.seatedAt = seatedAt;
    }
}
