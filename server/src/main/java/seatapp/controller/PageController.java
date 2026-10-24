package seatapp.controller;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import seatapp.config.AppPaths;
import seatapp.service.AppUser;
import seatapp.service.SeatingService;

/**
 * 画面（HTML）の出し分け。権限のない画面にアクセスしたら、今の状態に合う画面へ戻す。
 * 未ログイン → /、一般アカウントで未着席 → /seat-change、着席済み → /seat、管理者 → /admin。
 */
@RestController
public class PageController {
    private static final Map<String, String> FILES = Map.of(
            "/", "index.html", "/register", "register.html", "/seat-change", "seat-change.html", "/seat", "seat.html",
            "/account", "account.html", "/office", "office.html", "/admin", "admin.html");
    private final AppPaths paths;
    private final SeatingService seating;

    public PageController(AppPaths paths, SeatingService seating) {
        this.paths = paths;
        this.seating = seating;
    }

    @GetMapping({"/", "/register", "/seat-change", "/seat", "/account", "/office", "/admin"})
    ResponseEntity<?> page(jakarta.servlet.http.HttpServletRequest req, @AuthenticationPrincipal AppUser user) throws IOException {
        String path = req.getRequestURI();
        boolean loggedIn = user != null;
        boolean admin = loggedIn && user.admin();
        boolean seated = loggedIn && !admin && seating.isSeated(user.accountId());
        boolean allowed = switch (path) {
            case "/", "/register" -> !loggedIn;
            case "/seat-change", "/account" -> loggedIn && !admin;
            case "/seat", "/office" -> loggedIn && !admin && seated;
            case "/admin" -> admin;
            default -> false;
        };
        if (!allowed) {
            String to = homeOf(user, seated);
            return ResponseEntity.status(302).header(HttpHeaders.LOCATION, to).cacheControl(CacheControl.noStore()).build();
        }
        Path file = paths.webDir.resolve(FILES.get(path));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())   // 戻る操作で古い画面が出ないように
                .contentType(new MediaType("text", "html", java.nio.charset.StandardCharsets.UTF_8))
                .body(Files.readAllBytes(file));
    }

    /** ログイン後の遷移先：管理者 → /admin、着席済み → /seat、未着席 → /seat-change、未ログイン → / */
    public static String homeOf(AppUser user, boolean seated) {
        if (user == null) return "/";
        if (user.admin()) return "/admin";
        return seated ? "/seat" : "/seat-change";
    }
}
