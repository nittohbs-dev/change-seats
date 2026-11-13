package seatapp.service;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 怪獣ボタン：押した時刻だけをサーバーで覚えて、全員の画面へ配る（座席図のデータの kaiju）。
 * 怪獣の出現・ビーム・破壊・分身が逃げる・3分後の復旧は、どの画面も「押した時刻からの経過時間」で計算するので、全員の画面で同じになる。
 * 押せるのは設定 app.kaiju.allowed-ids に書いたアカウントだけ。破壊から復旧して、分身が席に戻るまでは押し直せない。
 * 覚えるのはメモリの中だけ（サーバーを再起動すれば、何も起きていない状態に戻る）。
 */
@Service
public class KaijuService {
    /** 押してから、次に押せるようになるまで（復旧 3分 ＋ 分身が席へ戻る時間） */
    public static final long ACTIVE_MS = 240_000;

    private final Set<String> allowed;
    private volatile long startedAt = 0;

    public KaijuService(@Value("${app.kaiju.allowed-ids:}") String allowedIds) {
        this.allowed = Arrays.stream(allowedIds.split(",")).map(String::trim).filter((s) -> !s.isEmpty()).collect(Collectors.toSet());
    }

    public boolean allowed(String accountId) { return accountId != null && allowed.contains(accountId); }

    /** 怪獣を出す。押せない人は 403、暴れている間は 409。 */
    public synchronized long start(String accountId) {
        if (!allowed(accountId)) throw new ApiException(403, "KAIJU-FORBIDDEN");
        long now = System.currentTimeMillis();
        if (now - startedAt < ACTIVE_MS) throw new ApiException(409, "KAIJU-ACTIVE");
        startedAt = now;
        return now;
    }

    /** 暴れている間（押してから ACTIVE_MS の間）は押した時刻、それ以外は null */
    public Long activeSince() {
        long s = startedAt;
        return s > 0 && System.currentTimeMillis() - s < ACTIVE_MS ? s : null;
    }
}
