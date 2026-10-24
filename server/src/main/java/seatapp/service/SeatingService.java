package seatapp.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import seatapp.entity.Account;
import seatapp.entity.Seat;
import seatapp.entity.Seating;
import seatapp.repository.AccountRepository;
import seatapp.repository.SeatRepository;
import seatapp.repository.SeatingRepository;

/** 席決め（先着順）・帰社・席の図の元になるデータ */
@Service
public class SeatingService {
    private static final Logger log = LoggerFactory.getLogger(SeatingService.class);
    private final SeatRepository seats;
    private final SeatingRepository seatings;
    private final AccountRepository accounts;
    private final AccountService accountService;
    private final TransactionTemplate tx;
    private final Random random = new Random();

    @PersistenceContext
    private EntityManager em;

    public SeatingService(SeatRepository seats, SeatingRepository seatings, AccountRepository accounts,
                          AccountService accountService, PlatformTransactionManager txManager) {
        this.seats = seats;
        this.seatings = seatings;
        this.accounts = accounts;
        this.accountService = accountService;
        this.tx = new TransactionTemplate(txManager);
    }

    public boolean isSeated(String accountId) { return seatings.existsById(accountId); }

    /**
     * 席決め。空席からランダムに1席を選んで着席する。すでに着席していれば何もしない（二重着席の防止）。
     * 同時に同じ席を選んだ人がいて追加に失敗したら（一意制約違反）、残りの空席から選び直す。空席がなければ E-03。
     * 先着順は、DB（seatings の seat_id の一意制約）が保証する。
     */
    public void assign(String accountId, String name) {
        accountService.saveName(accountId, name);
        int attempts = (int) seats.count() + 1;   // 選び直しは、席の数だけ繰り返せば必ず終わる
        for (int i = 0; i < attempts; i++) {
            if (seatings.existsById(accountId)) return;
            Outcome r = tx.execute((status) -> {
                Set<Long> taken = seatings.findAll().stream().map((s) -> s.seatId).collect(Collectors.toSet());
                List<Long> free = new ArrayList<>();
                for (Seat s : seats.findAll()) if (!taken.contains(s.seatId)) free.add(s.seatId);
                if (free.isEmpty()) return Outcome.FULL;
                Long seatId = free.get(random.nextInt(free.size()));
                try {
                    em.persist(new Seating(accountId, seatId, Instant.now()));
                    em.flush();
                    return Outcome.OK;
                } catch (DataIntegrityViolationException | jakarta.persistence.PersistenceException e) {
                    status.setRollbackOnly();
                    return Outcome.RETRY;
                }
            });
            if (r == Outcome.OK) { log.info("席決め: id={}", accountId); return; }
            if (r == Outcome.FULL) throw new ApiException(409, "E-03");
        }
        throw new ApiException(409, "E-03");
    }

    private enum Outcome { OK, FULL, RETRY }

    /** 帰社。着席情報を削除する。 */
    public void leave(String accountId) {
        tx.executeWithoutResult((s) -> seatings.findById(accountId).ifPresent(seatings::delete));
        log.info("帰社: id={}", accountId);
    }

    /** 全員を強制帰社にする（午前0時の処理） */
    public void resetAll() {
        tx.executeWithoutResult((s) -> seatings.deleteAllInBatch());
        log.info("全員を強制帰社にした");
    }

    /** 席の図の元になるデータ。viewer が座っている席は mine、他の人は taken、空席は free。 */
    public Map<String, Object> seatMap(String viewer) {
        Map<Long, Seating> bySeat = new HashMap<>();
        for (Seating s : seatings.findAll()) bySeat.put(s.seatId, s);
        Map<String, Account> acc = accounts.findAllById(bySeat.values().stream().map((s) -> s.accountId).toList())
                .stream().collect(Collectors.toMap((a) -> a.accountId, (a) -> a));
        List<Seat> all = new ArrayList<>(seats.findAll());
        all.sort((a, b) -> Long.compare(a.seatId, b.seatId));
        List<Object> list = new ArrayList<>();
        for (Seat s : all) {
            Seating st = bySeat.get(s.seatId);
            Map<String, Object> seat = new LinkedHashMap<>();
            seat.put("id", s.seatId);
            seat.put("group", s.group);
            seat.put("state", st == null ? "free" : st.accountId.equals(viewer) ? "mine" : "taken");
            if (st != null) {
                Account a = acc.get(st.accountId);
                String shown = a == null || a.name == null || a.name.isEmpty() ? st.accountId : a.name;
                seat.put("name", shown);
                seat.put("initial", new String(Character.toChars(shown.codePointAt(0))).toUpperCase());
                seat.put("since", st.seatedAt.toEpochMilli());   // 着席時刻（分身の動きを全端末でそろえるため）
            }
            list.add(seat);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("seats", list);
        out.put("now", System.currentTimeMillis());               // サーバーの時刻（端末の時計のずれを補正するため）
        return out;
    }

    /** 席の人のプロフィール（名前・課題・取り組み）。空席なら null。 */
    public Map<String, Object> person(long seatId) {
        return seatings.findBySeatId(seatId).flatMap((s) -> accounts.findById(s.accountId)).map((a) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", a.name);
            m.put("issue", a.issue == null ? "" : a.issue);
            m.put("effort", a.effort == null ? "" : a.effort);
            return m;
        }).orElse(null);
    }
}
