package seatapp.service;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 全員の画面へ「席の状況などが変わった」と即座に知らせる（SSE）。
 * 中身は送らず、変更の連番だけを送る。画面はそれを受けて最新の状態を取り直す（座席図は人ごとに見え方が違うため）。
 */
@Component
public class EventBus {
    private static final Logger log = LoggerFactory.getLogger(EventBus.class);
    private final Set<SseEmitter> clients = ConcurrentHashMap.newKeySet();
    private final AtomicLong version = new AtomicLong(System.currentTimeMillis());

    /** 画面が接続してきた時。再接続でも追いつけるよう、最初に今の連番を送る。 */
    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(0L);   // 時間切れにしない（切れたらブラウザが自動で再接続する）
        clients.add(emitter);
        emitter.onCompletion(() -> clients.remove(emitter));
        emitter.onTimeout(() -> clients.remove(emitter));
        emitter.onError((e) -> clients.remove(emitter));
        try {
            emitter.send(SseEmitter.event().reconnectTime(3000).name("changed").data(version.get()));
        } catch (IOException | IllegalStateException e) {
            clients.remove(emitter);
        }
        return emitter;
    }

    /** 変化があった時に、接続中の全員へ知らせる */
    public void changed() {
        long v = version.incrementAndGet();
        broadcast(SseEmitter.event().name("changed").data(v));
    }

    /** 15秒ごとの空信号（途中の機器に接続を切られないように）。接続が切れた画面はここで取り除く。 */
    @Scheduled(fixedRate = 15000)
    public void heartbeat() {
        broadcast(SseEmitter.event().comment("ping"));
    }

    public int clientCount() { return clients.size(); }

    private void broadcast(SseEmitter.SseEventBuilder event) {
        for (SseEmitter c : clients) {
            try {
                c.send(event);
            } catch (IOException | IllegalStateException e) {
                clients.remove(c);
                log.debug("接続が切れた画面を取り除いた");
            }
        }
    }
}
