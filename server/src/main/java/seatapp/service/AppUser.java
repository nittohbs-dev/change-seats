package seatapp.service;

import java.io.Serializable;

/** ログイン中の人（セッションに入る）。パスワードのハッシュは持たない。 */
public record AppUser(String accountId, boolean admin) implements Serializable { }
