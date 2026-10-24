package seatapp.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 席。位置・向きなどの3D配置は web/office-seats.json（Blenderから書き出し）にあり、ここには席IDとグループだけ持つ。 */
@Entity
@Table(name = "seats")
public class Seat {
    @Id
    @Column(name = "seat_id")
    public Long seatId;

    @Column(name = "grp", length = 8, nullable = false)
    public String group;

    protected Seat() { }

    public Seat(Long seatId, String group) {
        this.seatId = seatId;
        this.group = group;
    }
}
