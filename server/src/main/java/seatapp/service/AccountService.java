package seatapp.service;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import seatapp.entity.Account;
import seatapp.repository.AccountRepository;

/** アカウントの登録・ログインの確認・プロフィールの保存 */
@Service
public class AccountService {
    private static final Logger log = LoggerFactory.getLogger(AccountService.class);

    private final AccountRepository accounts;
    private final PasswordEncoder encoder;
    private final int maxFailures;
    private final Duration lockTime;
    // 存在しないIDでも本物と同じ時間をかけて確認するための、使い道のないハッシュ（IDの有無を時間の差で知られないように）
    private final String dummyHash;

    public AccountService(AccountRepository accounts, PasswordEncoder encoder,
                          @Value("${app.lock.max-failures}") int maxFailures,
                          @Value("${app.lock.minutes}") long lockMinutes) {
        this.accounts = accounts;
        this.encoder = encoder;
        this.maxFailures = maxFailures;
        this.lockTime = Duration.ofMinutes(lockMinutes);
        this.dummyHash = encoder.encode("dummy-password-not-used");
    }

    /** アカウントを作る（admin=true なら管理者）。IDの重複は E-02。パスワードは BCrypt でハッシュ化して保存する。 */
    @Transactional
    public Account register(String id, String password, boolean admin) {
        Validators.accountId(id);
        Validators.password(password);
        if (accounts.existsById(id)) throw new ApiException(409, "E-02");
        Account a = accounts.save(new Account(id, encoder.encode(password), admin));
        log.info("アカウントを登録した: id={} admin={}", id, admin);
        return a;
    }

    /** ログインの確認。違えば E-01。連続して失敗するとロックし、ロック中は E-09。存在しないIDも同じ E-01。 */
    @Transactional(noRollbackFor = ApiException.class)
    public Account authenticate(String id, String password) {
        Account a = id == null ? null : accounts.findById(id).orElse(null);
        if (a == null) {
            encoder.matches(password == null ? "" : password, dummyHash);
            log.warn("ログイン失敗（IDなし）");
            throw new ApiException(401, "E-01");
        }
        Instant now = Instant.now();
        if (a.lockedUntil != null && a.lockedUntil.isAfter(now)) {
            log.warn("ログイン失敗（ロック中）: id={}", id);
            throw new ApiException(423, "E-09");
        }
        if (password == null || !encoder.matches(password, a.passwordHash)) {
            a.failedCount++;
            boolean locked = a.failedCount >= maxFailures;
            if (locked) {
                a.lockedUntil = now.plus(lockTime);
                a.failedCount = 0;
            }
            accounts.save(a);   // 失敗の回数は、エラーを返す場合でも保存する（noRollbackFor）
            log.warn("ログイン失敗: id={} ロックした={}", id, locked);
            throw new ApiException(locked ? 423 : 401, locked ? "E-09" : "E-01");
        }
        a.failedCount = 0;
        a.lockedUntil = null;
        accounts.save(a);
        log.info("ログイン成功: id={}", id);
        return a;
    }

    public Account get(String id) {
        return accounts.findById(id).orElseThrow(() -> new ApiException(401, "AUTH"));
    }

    /** 名前・課題・取り組みを保存する（変更するまで残る）。課題と取り組みは任意。 */
    @Transactional
    public Account saveProfile(String id, String name, String issue, String effort) {
        Account a = get(id);
        a.name = Validators.required(name, Validators.NAME_MAX);
        a.issue = Validators.optional(issue, Validators.LONG_MAX);
        a.effort = Validators.optional(effort, Validators.LONG_MAX);
        return accounts.save(a);
    }

    /** 席決めの時の名前だけを保存する */
    @Transactional
    public Account saveName(String id, String name) {
        Account a = get(id);
        a.name = Validators.required(name, Validators.NAME_MAX);
        return accounts.save(a);
    }
}
