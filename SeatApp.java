import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;

import static java.nio.charset.StandardCharsets.UTF_8;

/**
 * 座席管理Webアプリ テスト版。
 * 外部ライブラリなしで動かすため、JDK標準のHTTPサーバーとメモリ上のデータで実装している。
 * 起動: java SeatApp.java  →  http://localhost:8080
 */
public class SeatApp {

    static final Path WEB = Path.of("web").toAbsolutePath().normalize();
    static final Store store = new Store();
    /** セッションID → アカウントID */
    static final Map<String, String> sessions = new ConcurrentHashMap<>();

    static final Map<String, String> MSG = Map.of(
            "E-01", "IDまたはパスワードが違います",
            "E-02", "このIDは使われています",
            "E-03", "満席です",
            "E-05", "未入力の項目があります",
            "E-07", "文字数が多すぎます（名前は100文字、課題の項目は200文字まで）",
            "I-01", "管理者アカウントを追加しました",
            "AUTH", "ログインしてください");

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", SeatApp::handle);
        server.setExecutor(Executors.newFixedThreadPool(32));
        server.start();
        System.out.println("Seat app (test) started: http://localhost:" + port);
    }

    static void handle(HttpExchange ex) {
        try {
            String path = ex.getRequestURI().getPath();
            String user = currentUser(ex);
            if (path.startsWith("/static/")) {
                serveFile(ex, path.substring("/static/".length()));
            } else if (path.startsWith("/api/")) {
                api(ex, ex.getRequestMethod(), path.substring("/api".length()), user);
            } else {
                page(ex, path, user);
            }
        } catch (Exception e) {
            e.printStackTrace();
            try { send(ex, 500, "text/plain; charset=utf-8", "サーバーエラー"); } catch (IOException ignored) { }
        } finally {
            ex.close();
        }
    }

    // ---------- 画面（アクセス制御つき） ----------

    static String homeOf(String user) {
        if (user == null) return "/";
        if (store.isAdmin(user)) return "/admin";
        return store.seatOf(user) != null ? "/seat" : "/seat-change";
    }

    static void page(HttpExchange ex, String path, String user) throws IOException {
        boolean loggedIn = user != null;
        boolean admin = loggedIn && store.isAdmin(user);
        boolean seated = loggedIn && store.seatOf(user) != null;
        String file;
        boolean allowed;
        switch (path) {
            case "/" -> { file = "index.html"; allowed = !loggedIn; }
            case "/register" -> { file = "register.html"; allowed = !loggedIn; }
            case "/seat-change" -> { file = "seat-change.html"; allowed = loggedIn && !admin; }
            case "/seat" -> { file = "seat.html"; allowed = loggedIn && !admin && seated; }
            case "/office" -> { file = "office.html"; allowed = loggedIn && !admin && seated; }
            case "/account" -> { file = "account.html"; allowed = loggedIn && !admin; }
            case "/admin" -> { file = "admin.html"; allowed = admin; }
            default -> { send(ex, 404, "text/plain; charset=utf-8", "ページが見つかりません"); return; }
        }
        if (!allowed) {
            redirect(ex, homeOf(user));
            return;
        }
        serveFile(ex, file);
    }

    // ---------- API ----------

    static void api(HttpExchange ex, String method, String p, String user) throws IOException {
        Map<String, String> f = method.equals("GET") ? Map.of() : form(ex);

        // ログイン不要
        if (method.equals("GET") && p.equals("/ping")) {
            // 画面側が「サーバーがあるか」を判定するための応答（Vercelなどサーバーがない環境ではここが404になる）
            json(ex, 200, obj("ok", true));
            return;
        }
        if (method.equals("POST") && p.equals("/login")) {
            // テスト版: IDとパスワードが入っていれば誰でもログインできる（見た目だけ）
            String id = f.getOrDefault("id", ""), pw = f.getOrDefault("password", "");
            if (id.isEmpty() || pw.isEmpty()) { error(ex, 400, "E-01"); return; }
            store.account(id);
            String sid = UUID.randomUUID().toString();
            sessions.put(sid, id);
            ex.getResponseHeaders().add("Set-Cookie", "SID=" + sid + "; Path=/; HttpOnly; SameSite=Lax");
            json(ex, 200, obj("redirect", homeOf(id)));
            return;
        }
        if (method.equals("POST") && p.equals("/register")) {
            String id = f.getOrDefault("id", ""), pw = f.getOrDefault("password", "");
            if (id.isEmpty() || pw.isEmpty()) { error(ex, 400, "E-05"); return; }
            if (!store.register(id)) { error(ex, 409, "E-02"); return; }
            json(ex, 200, obj("redirect", "/"));
            return;
        }
        if (method.equals("POST") && p.equals("/logout")) {
            logout(ex);
            json(ex, 200, obj("redirect", "/"));
            return;
        }

        if (user == null) { error(ex, 401, "AUTH"); return; }

        // 管理者向け
        if (p.startsWith("/admin/")) {
            if (!store.isAdmin(user)) { error(ex, 403, "AUTH"); return; }
            adminApi(ex, method, p, f);
            return;
        }

        // 一般アカウント向け
        if (method.equals("GET") && p.equals("/me")) {
            Store.Account a = store.account(user);
            json(ex, 200, obj("id", user, "admin", store.isAdmin(user),
                    "name", a.name, "issue", a.issue, "effort", a.effort,
                    "seated", store.seatOf(user) != null, "topic", store.todayTopicText()));
        } else if (method.equals("GET") && p.equals("/seat-map")) {
            json(ex, 200, store.seatMap(user));
        } else if (method.equals("GET") && p.matches("/seats/\\d+/person")) {
            long seatId = Long.parseLong(p.split("/")[2]);
            Store.Account a = store.personAt(seatId);
            if (a == null) { json(ex, 404, obj("error", "EMPTY", "message", "この席は空いています")); return; }
            json(ex, 200, obj("name", a.name, "issue", a.issue, "effort", a.effort));
        } else if (method.equals("POST") && p.equals("/seat-change/assign")) {
            String name = f.getOrDefault("name", "");
            String bad = validate(name, true, 100);
            if (bad != null) { error(ex, 400, bad); return; }
            String result = store.assign(user, name);
            if (result != null) { error(ex, 409, result); return; }
            json(ex, 200, obj("redirect", "/seat"));
        } else if (method.equals("POST") && p.equals("/seat/leave")) {
            store.leave(user);
            logout(ex);
            json(ex, 200, obj("redirect", "/"));
        } else if (method.equals("POST") && p.equals("/account")) {
            // 課題の2項目は任意。保存した内容は、次に変更するまで残る（帰社・0時の処理でも消さない）
            String name = f.getOrDefault("name", "");
            String issue = f.getOrDefault("issue", ""), effort = f.getOrDefault("effort", "");
            String bad = validate(name, true, 100, issue, false, 200, effort, false, 200);
            if (bad != null) { error(ex, 400, bad); return; }
            store.saveProfile(user, name, issue, effort);
            json(ex, 200, obj("redirect", "/seat"));
        } else {
            json(ex, 404, obj("error", "NOT_FOUND", "message", "見つかりません"));
        }
    }

    static void adminApi(HttpExchange ex, String method, String p, Map<String, String> f) throws IOException {
        if (method.equals("GET") && p.equals("/admin/data")) {
            json(ex, 200, adminData());
        } else if (method.equals("POST") && p.equals("/admin/topics")) {
            String text = f.getOrDefault("text", "");
            String bad = validate(text, true, 100);
            if (bad != null) { error(ex, 400, bad); return; }
            store.addTopic(text);
            json(ex, 200, adminData());
        } else if (method.equals("PUT") && p.matches("/admin/topics/\\d+")) {
            String text = f.getOrDefault("text", "");
            String bad = validate(text, true, 100);
            if (bad != null) { error(ex, 400, bad); return; }
            store.editTopic(Long.parseLong(p.split("/")[3]), text);
            json(ex, 200, adminData());
        } else if (method.equals("POST") && p.equals("/admin/admins")) {
            String id = f.getOrDefault("id", ""), pw = f.getOrDefault("password", "");
            if (id.isEmpty() || pw.isEmpty()) { error(ex, 400, "E-05"); return; }
            if (!store.addAdmin(id)) { error(ex, 409, "E-02"); return; }
            json(ex, 200, obj("message", MSG.get("I-01")));
        } else if (method.equals("POST") && p.equals("/admin/daily-reset")) {
            // テスト用: 午前0時の処理（強制帰社＋お題の選び直し）をその場で実行する
            store.dailyReset();
            json(ex, 200, adminData());
        } else {
            json(ex, 404, obj("error", "NOT_FOUND", "message", "見つかりません"));
        }
    }

    static Map<String, Object> adminData() {
        Map<String, Object> m = store.seatMap(null);
        m.put("topics", store.topicList());
        m.put("todayTopic", store.todayTopicText());
        return m;
    }

    /** 引数は (値, 必須か, 最大文字数) の組。問題があればメッセージIDを返す。 */
    static String validate(Object... triples) {
        for (int i = 0; i < triples.length; i += 3) {
            String v = (String) triples[i];
            if ((Boolean) triples[i + 1] && v.isEmpty()) return "E-05";
        }
        for (int i = 0; i < triples.length; i += 3) {
            String v = (String) triples[i];
            if (v.codePointCount(0, v.length()) > (Integer) triples[i + 2]) return "E-07";
        }
        return null;
    }

    // ---------- セッション ----------

    static String sessionId(HttpExchange ex) {
        for (String header : ex.getRequestHeaders().getOrDefault("Cookie", List.of())) {
            for (String c : header.split(";")) {
                String t = c.trim();
                if (t.startsWith("SID=")) return t.substring(4);
            }
        }
        return null;
    }

    static String currentUser(HttpExchange ex) {
        String sid = sessionId(ex);
        return sid == null ? null : sessions.get(sid);
    }

    static void logout(HttpExchange ex) {
        String sid = sessionId(ex);
        if (sid != null) sessions.remove(sid);
        ex.getResponseHeaders().add("Set-Cookie", "SID=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    }

    // ---------- HTTPの小道具 ----------

    static Map<String, String> form(HttpExchange ex) throws IOException {
        String body = new String(ex.getRequestBody().readAllBytes(), UTF_8);
        Map<String, String> m = new HashMap<>();
        for (String part : body.split("&")) {
            if (part.isEmpty()) continue;
            int i = part.indexOf('=');
            String k = URLDecoder.decode(i < 0 ? part : part.substring(0, i), UTF_8);
            String v = i < 0 ? "" : URLDecoder.decode(part.substring(i + 1), UTF_8);
            m.put(k, v.trim());
        }
        return m;
    }

    static void serveFile(HttpExchange ex, String rel) throws IOException {
        Path file = WEB.resolve(rel).normalize();
        if (!file.startsWith(WEB) || !Files.isRegularFile(file)) {
            send(ex, 404, "text/plain; charset=utf-8", "ファイルが見つかりません");
            return;
        }
        String type = rel.endsWith(".css") ? "text/css; charset=utf-8"
                : rel.endsWith(".js") ? "text/javascript; charset=utf-8"
                : rel.endsWith(".json") ? "application/json; charset=utf-8"
                : rel.endsWith(".glb") ? "model/gltf-binary"
                : "text/html; charset=utf-8";
        send(ex, 200, type, Files.readAllBytes(file));
    }

    static void redirect(HttpExchange ex, String to) throws IOException {
        ex.getResponseHeaders().set("Location", to);
        ex.sendResponseHeaders(302, -1);
    }

    static void error(HttpExchange ex, int status, String code) throws IOException {
        json(ex, status, obj("error", code, "message", MSG.get(code)));
    }

    static void json(HttpExchange ex, int status, Object body) throws IOException {
        send(ex, status, "application/json; charset=utf-8", toJson(body));
    }

    static void send(HttpExchange ex, int status, String type, String body) throws IOException {
        send(ex, status, type, body.getBytes(UTF_8));
    }

    static void send(HttpExchange ex, int status, String type, byte[] body) throws IOException {
        ex.getResponseHeaders().set("Content-Type", type);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(status, body.length);
        ex.getResponseBody().write(body);
    }

    static Map<String, Object> obj(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    static String toJson(Object o) {
        if (o == null) return "null";
        if (o instanceof String s) return quote(s);
        if (o instanceof Number || o instanceof Boolean) return o.toString();
        if (o instanceof Map<?, ?> m) {
            StringJoiner j = new StringJoiner(",", "{", "}");
            m.forEach((k, v) -> j.add(quote(k.toString()) + ":" + toJson(v)));
            return j.toString();
        }
        if (o instanceof Collection<?> c) {
            StringJoiner j = new StringJoiner(",", "[", "]");
            c.forEach(v -> j.add(toJson(v)));
            return j.toString();
        }
        throw new IllegalArgumentException("JSONにできない型: " + o.getClass());
    }

    static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                case '<' -> b.append("\\u003c");
                default -> {
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
                }
            }
        }
        return b.append('"').toString();
    }

    // ---------- データ（メモリ上。再起動で初期状態に戻る） ----------

    static class Store {
        /** 席。位置・向きなどの3D配置は web/office-seats.json（Blenderから書き出し）にあり、画面側が使う。 */
        record Seat(long id, String group) { }

        static class Account {
            final String id;
            /** issue: 現状の個人の課題、effort: 課題解決にむけて取り組んでいること（どちらも任意） */
            String name = "", issue = "", effort = "";
            Account(String id) { this.id = id; }
        }

        final List<Seat> seats = new ArrayList<>();
        final Map<String, Account> accounts = new HashMap<>();
        final Set<String> admins = new HashSet<>(Set.of("admin"));
        /** 着席: 席ID → アカウントID。1席1人、1人1席。 */
        final Map<Long, String> seatings = new HashMap<>();
        /** 着席した時刻（ミリ秒）: 席ID → 時刻。分身の動きを全端末でそろえるために画面へ渡す。 */
        final Map<Long, Long> seatedAt = new HashMap<>();
        final Map<Long, String> topics = new LinkedHashMap<>();
        Long todayTopicId;
        long nextTopicId = 1;
        final Random random = new Random();

        Store() {
            layout();
            for (String t : List.of("最近ハマっていること", "好きな食べ物", "週末にしたいこと", "子どもの頃の夢"))
                addTopic(t);
            pickTodayTopic();
        }

        synchronized boolean isAdmin(String id) { return admins.contains(id); }

        synchronized Account account(String id) { return accounts.computeIfAbsent(id, Account::new); }

        synchronized boolean register(String id) {
            if (accounts.containsKey(id) || admins.contains(id)) return false;
            accounts.put(id, new Account(id));
            return true;
        }

        synchronized boolean addAdmin(String id) {
            if (accounts.containsKey(id) || admins.contains(id)) return false;
            admins.add(id);
            return true;
        }

        synchronized Long seatOf(String accountId) {
            for (var e : seatings.entrySet()) if (e.getValue().equals(accountId)) return e.getKey();
            return null;
        }

        synchronized Account personAt(long seatId) {
            String who = seatings.get(seatId);
            return who == null ? null : account(who);
        }

        synchronized void saveProfile(String id, String name, String issue, String effort) {
            Account a = account(id);
            a.name = name;
            a.issue = issue;
            a.effort = effort;
        }

        /** 席決め。成功ならnull、満席なら"E-03"。すでに着席済みなら何もしない。 */
        synchronized String assign(String id, String name) {
            if (seatOf(id) != null) return null;
            Account a = account(id);
            a.name = name;
            List<Long> free = new ArrayList<>();
            for (Seat s : seats) if (!seatings.containsKey(s.id())) free.add(s.id());
            if (free.isEmpty()) return "E-03";
            long seatId = free.get(random.nextInt(free.size()));
            seatings.put(seatId, id);
            seatedAt.put(seatId, System.currentTimeMillis());
            return null;
        }

        synchronized void leave(String id) {
            Long seatId = seatOf(id);
            if (seatId != null) { seatings.remove(seatId); seatedAt.remove(seatId); }
        }

        /** 席の一覧を web/office-seats.json から読む（1行に1席。席IDとグループだけ使う）。 */
        private void layout() {
            try {
                var m = java.util.regex.Pattern.compile("\"id\":\\s*(\\d+),\\s*\"group\":\\s*\"([^\"]*)\"")
                        .matcher(Files.readString(WEB.resolve("office-seats.json")));
                while (m.find()) seats.add(new Seat(Long.parseLong(m.group(1)), m.group(2)));
            } catch (IOException e) {
                throw new UncheckedIOException("web/office-seats.json を読めません", e);
            }
            if (seats.isEmpty()) throw new IllegalStateException("web/office-seats.json に席がありません");
        }

        synchronized void addTopic(String text) { topics.put(nextTopicId++, text); }

        synchronized void editTopic(long id, String text) { if (topics.containsKey(id)) topics.put(id, text); }

        synchronized List<Object> topicList() {
            List<Object> list = new ArrayList<>();
            topics.forEach((id, text) -> list.add(obj("id", id, "text", text)));
            return list;
        }

        synchronized String todayTopicText() { return todayTopicId == null ? null : topics.get(todayTopicId); }

        /** 前日と同じお題を避けて選ぶ。1件しかなければ同じものを選ぶ。 */
        synchronized void pickTodayTopic() {
            List<Long> ids = new ArrayList<>(topics.keySet());
            if (ids.size() > 1) ids.remove(todayTopicId);
            todayTopicId = ids.isEmpty() ? null : ids.get(random.nextInt(ids.size()));
        }

        /** 午前0時の処理: 全員を強制帰社にして、今日のお題を選び直す。 */
        synchronized void dailyReset() {
            seatings.clear();
            seatedAt.clear();
            pickTodayTopic();
        }

        /** 席の図に出す頭文字。名前の1文字目、名前がなければアカウントIDの1文字目。 */
        static String initialOf(Account a) {
            String s = a.name.isEmpty() ? a.id : a.name;
            return new String(Character.toChars(s.codePointAt(0))).toUpperCase();
        }

        synchronized Map<String, Object> seatMap(String viewer) {
            List<Object> list = new ArrayList<>();
            for (Seat s : seats) {
                String who = seatings.get(s.id());
                String state = who == null ? "free" : who.equals(viewer) ? "mine" : "taken";
                Map<String, Object> seat = obj("id", s.id(), "group", s.group(), "state", state);
                if (who != null) {
                    Account a = account(who);
                    seat.put("name", a.name.isEmpty() ? a.id : a.name);
                    seat.put("initial", initialOf(a));
                    seat.put("since", seatedAt.getOrDefault(s.id(), 0L));
                }
                list.add(seat);
            }
            return obj("seats", list, "now", System.currentTimeMillis());
        }
    }
}
