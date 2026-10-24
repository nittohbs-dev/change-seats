package seatapp.controller;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.util.List;
import java.util.Map;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import seatapp.entity.Account;
import seatapp.service.AccountService;
import seatapp.service.AppUser;
import seatapp.service.SeatingService;

/** 登録・ログイン・ログアウト・サーバーの有無の確認 */
@RestController
@RequestMapping("/api")
public class AuthApiController {
    private final AccountService accounts;
    private final SeatingService seating;
    private final SecurityContextRepository contextRepository;

    public AuthApiController(AccountService accounts, SeatingService seating, SecurityContextRepository contextRepository) {
        this.accounts = accounts;
        this.seating = seating;
        this.contextRepository = contextRepository;
    }

    /** 画面が「サーバーがあるか（ローカル版か、サーバーのないデモ版か）」を判定するための応答 */
    @GetMapping("/ping")
    Map<String, Object> ping() { return Map.of("ok", true); }

    @PostMapping("/register")
    Map<String, Object> register(@RequestParam(defaultValue = "") String id, @RequestParam(defaultValue = "") String password) {
        accounts.register(id, password, false);
        return Map.of("redirect", "/");
    }

    @PostMapping("/login")
    Map<String, Object> login(@RequestParam(defaultValue = "") String id, @RequestParam(defaultValue = "") String password,
                              HttpServletRequest req, HttpServletResponse res) {
        Account a = accounts.authenticate(id, password);
        AppUser user = new AppUser(a.accountId, a.admin);
        if (req.getSession(false) != null) req.changeSessionId();   // セッション固定化攻撃の対策
        SecurityContext ctx = SecurityContextHolder.createEmptyContext();
        ctx.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user, null,
                List.of(new SimpleGrantedAuthority(a.admin ? "ROLE_ADMIN" : "ROLE_USER"))));
        SecurityContextHolder.setContext(ctx);
        contextRepository.saveContext(ctx, req, res);
        return Map.of("redirect", PageController.homeOf(user, !a.admin && seating.isSeated(a.accountId)));
    }

    @PostMapping("/logout")
    Map<String, Object> logout(HttpServletRequest req) {
        endSession(req);
        return Map.of("redirect", "/");
    }

    /** ログイン状態を破棄する（ログアウトと帰社で使う） */
    static void endSession(HttpServletRequest req) {
        HttpSession s = req.getSession(false);
        if (s != null) s.invalidate();
        SecurityContextHolder.clearContext();
    }
}
