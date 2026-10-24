package seatapp.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** アカウント。名前・課題・取り組みは、変更するまで保存され続ける。 */
@Entity
@Table(name = "accounts")
public class Account {
    @Id
    @Column(name = "account_id", length = 20)
    public String accountId;

    @Column(name = "password_hash", length = 100, nullable = false)
    public String passwordHash;

    @Column(name = "is_admin", nullable = false)
    public boolean admin;

    @Column(length = 100)
    public String name = "";

    /** 現状の個人の課題（任意） */
    @Column(length = 200)
    public String issue = "";

    /** 課題解決にむけて取り組んでいること（任意） */
    @Column(length = 200)
    public String effort = "";

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    /** 連続したログイン失敗の回数と、ロックが解ける時刻 */
    @Column(name = "failed_count", nullable = false)
    public int failedCount;

    @Column(name = "locked_until")
    public Instant lockedUntil;

    protected Account() { }

    public Account(String accountId, String passwordHash, boolean admin) {
        this.accountId = accountId;
        this.passwordHash = passwordHash;
        this.admin = admin;
    }
}
