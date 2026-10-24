// デモ版: サーバー（SeatApp.java）がない環境（Vercelなど）で、サーバーの代わりにブラウザ内で処理する。
// 席・アカウント・お題は localStorage（同じブラウザの全タブで共有）、
// ログイン中のIDは sessionStorage（タブごと）に保存する。
// → 同じブラウザで別タブを開き、違うIDでログインすると複数人の席決めを試せる。
// URL・入力チェック・メッセージ・席の配置は SeatApp.java と同じにしている。
window.demoBackend = (() => {
  const MSG = {
    'E-01': 'IDまたはパスワードが違います',
    'E-02': 'このIDは使われています',
    'E-03': '満席です',
    'E-05': '未入力の項目があります',
    'E-07': '文字数が多すぎます（名前は100文字、課題の項目は200文字まで）',
    'E-10': 'IDは半角英数字の4〜20文字で入力してください',
    'E-11': 'パスワードは8文字以上で入力してください',
    'I-01': '管理者アカウントを追加しました',
    AUTH: 'ログインしてください',
  };

  // ---------- 席（office-seats.json から読む。SeatApp.java と同じ） ----------
  let SEATS = [];
  async function init() {
    const data = await (await fetch('/static/office-seats.json')).json();
    SEATS = data.seats.map((x) => ({ id: x.id, group: x.group }));
  }

  // ---------- データ保存 ----------
  const KEY = 'seat-demo-v4';

  function freshState() {
    const s = { accounts: {}, admins: ['admin'], seatings: {}, seatedAt: {}, topics: [], todayTopicId: null, nextTopicId: 1 };
    ['最近ハマっていること', '好きな食べ物', '週末にしたいこと', '子どもの頃の夢']
      .forEach((t) => s.topics.push({ id: s.nextTopicId++, text: t }));
    pickTopic(s);
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* 保存できない環境では毎回初期状態 */ }
    return freshState();
  }

  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 無視 */ }
  }

  const currentUser = () => { try { return sessionStorage.getItem('seat-demo-user'); } catch { return null; } };
  const setUser = (id) => {
    try { id ? sessionStorage.setItem('seat-demo-user', id) : sessionStorage.removeItem('seat-demo-user'); } catch { /* 無視 */ }
  };

  function pickTopic(s) {
    let ids = s.topics.map((t) => t.id);
    if (ids.length > 1) ids = ids.filter((id) => id !== s.todayTopicId);
    s.todayTopicId = ids.length ? ids[Math.floor(Math.random() * ids.length)] : null;
  }

  const isAdmin = (s, id) => s.admins.includes(id);
  const seatOf = (s, id) => Object.keys(s.seatings).find((k) => s.seatings[k] === id) ?? null;
  const account = (s, id) => (s.accounts[id] ??= { name: '', issue: '', effort: '' });
  const topicText = (s) => s.topics.find((t) => t.id === s.todayTopicId)?.text ?? null;
  const initialOf = (s, id) => [...(account(s, id).name || id)][0].toUpperCase();

  function seatMap(s, viewer) {
    return {
      seats: SEATS.map((seat) => {
        const who = s.seatings[seat.id];
        const state = !who ? 'free' : who === viewer ? 'mine' : 'taken';
        const o = { ...seat, state };
        if (who) { o.name = account(s, who).name || who; o.initial = initialOf(s, who); o.since = (s.seatedAt ?? {})[seat.id] ?? 0; }
        return o;
      }),
      now: Date.now(),
    };
  }

  const adminData = (s) => ({ ...seatMap(s, null), topics: s.topics, todayTopic: topicText(s) });

  /** list は [値, 必須か, 最大文字数] の配列。問題があればメッセージIDを返す。 */
  function validate(list) {
    for (const [v, required] of list) if (required && !v) return 'E-05';
    for (const [v, , max] of list) if ([...v].length > max) return 'E-07';
    return null;
  }

  /** 登録するアカウントの入力条件（サーバー版と同じ：IDは半角英数4〜20文字、パスワードは8文字以上） */
  function checkNewAccount(f) {
    if (!f.id || !f.password) err('E-05');
    if (!/^[A-Za-z0-9]{4,20}$/.test(f.id)) err('E-10');
    if (f.password.length < 8) err('E-11');
  }

  function err(code) { throw { error: code, message: MSG[code] }; }

  function homeOf(s, id) {
    if (!id) return '/';
    if (isAdmin(s, id)) return '/admin';
    return seatOf(s, id) !== null ? '/seat' : '/seat-change';
  }

  // ---------- サーバーの代わり（URLと動きは SeatApp.java と同じ） ----------
  function handle(url, method, f) {
    const s = load();
    const user = currentUser();
    const done = (result) => { save(s); return result; };

    if (method === 'GET' && url === '/ping') return { ok: true };
    if (method === 'POST' && url === '/login') {
      // テスト版: IDとパスワードが入っていれば誰でもログインできる（見た目だけ）
      if (!f.id || !f.password) err('E-01');
      account(s, f.id);
      setUser(f.id);
      return done({ redirect: homeOf(s, f.id) });
    }
    if (method === 'POST' && url === '/register') {
      checkNewAccount(f);
      if (s.accounts[f.id] || isAdmin(s, f.id)) err('E-02');
      account(s, f.id);
      return done({ redirect: '/' });
    }
    if (method === 'POST' && url === '/logout') { setUser(null); return { redirect: '/' }; }

    if (!user) { location.href = '/'; err('AUTH'); }

    if (url.startsWith('/admin/')) {
      if (!isAdmin(s, user)) err('AUTH');
      let m;
      if (method === 'GET' && url === '/admin/data') return adminData(s);
      if (method === 'POST' && url === '/admin/topics') {
        const bad = validate([[f.text ?? '', true, 100]]); if (bad) err(bad);
        s.topics.push({ id: s.nextTopicId++, text: f.text });
        return done(adminData(s));
      }
      if (method === 'PUT' && (m = url.match(/^\/admin\/topics\/(\d+)$/))) {
        const bad = validate([[f.text ?? '', true, 100]]); if (bad) err(bad);
        const t = s.topics.find((x) => x.id === Number(m[1]));
        if (t) t.text = f.text;
        return done(adminData(s));
      }
      if (method === 'POST' && url === '/admin/admins') {
        checkNewAccount(f);
        if (s.accounts[f.id] || isAdmin(s, f.id)) err('E-02');
        s.admins.push(f.id);
        return done({ message: MSG['I-01'] });
      }
      if (method === 'POST' && url === '/admin/daily-reset') {
        // テスト用: 午前0時の処理（強制帰社＋お題の選び直し）をその場で実行する
        s.seatings = {};
        s.seatedAt = {};
        pickTopic(s);
        return done(adminData(s));
      }
      throw { error: 'NOT_FOUND', message: '見つかりません' };
    }

    let m;
    if (method === 'GET' && url === '/me') {
      return { id: user, admin: isAdmin(s, user), ...account(s, user), seated: seatOf(s, user) !== null, topic: topicText(s) };
    }
    if (method === 'GET' && url === '/seat-map') return seatMap(s, user);
    if (method === 'GET' && (m = url.match(/^\/seats\/(\d+)\/person$/))) {
      const who = s.seatings[m[1]];
      if (!who) throw { error: 'EMPTY', message: 'この席は空いています' };
      const a = account(s, who);
      return { name: a.name, issue: a.issue ?? '', effort: a.effort ?? '' };
    }
    if (method === 'POST' && url === '/seat-change/assign') {
      const bad = validate([[f.name ?? '', true, 100]]); if (bad) err(bad);
      if (seatOf(s, user) !== null) return { redirect: '/seat' };
      account(s, user).name = f.name;
      const free = SEATS.filter((seat) => !s.seatings[seat.id]);
      if (!free.length) { save(s); err('E-03'); }
      const seatId = free[Math.floor(Math.random() * free.length)].id;
      s.seatings[seatId] = user;
      (s.seatedAt ??= {})[seatId] = Date.now();
      return done({ redirect: '/seat' });
    }
    if (method === 'POST' && url === '/seat/leave') {
      const k = seatOf(s, user);
      if (k !== null) { delete s.seatings[k]; delete (s.seatedAt ??= {})[k]; }
      save(s);
      setUser(null);
      return { redirect: '/' };
    }
    if (method === 'POST' && url === '/account') {
      // 課題の2項目は任意。保存した内容は、次に変更するまで残る（帰社・0時の処理でも消さない）
      const bad = validate([[f.name ?? '', true, 100], [f.issue ?? '', false, 200], [f.effort ?? '', false, 200]]); if (bad) err(bad);
      Object.assign(account(s, user), { name: f.name, issue: f.issue ?? '', effort: f.effort ?? '' });
      return done({ redirect: '/seat' });
    }
    throw { error: 'NOT_FOUND', message: '見つかりません' };
  }

  // ---------- 画面ごとのアクセス制御（SeatApp.java の page() と同じ） ----------
  /** 権限のない画面なら移動して true を返す。 */
  function guard() {
    const path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    const s = load();
    const user = currentUser();
    const loggedIn = !!user && (isAdmin(s, user) || !!s.accounts[user]);
    const admin = loggedIn && isAdmin(s, user);
    const seated = loggedIn && seatOf(s, user) !== null;
    const allowed = {
      '/': !loggedIn, '/index': !loggedIn, '/register': !loggedIn,
      '/seat-change': loggedIn && !admin,
      '/seat': loggedIn && !admin && seated,
      '/office': loggedIn && !admin && seated,
      '/account': loggedIn && !admin,
      '/admin': admin,
    }[path];
    if (allowed !== false) return false;
    const to = loggedIn ? homeOf(s, user) : '/';
    if (to === path) return false;
    location.replace(to);
    return true;
  }

  /** デモ版であることを、案内文に出す。 */
  function decorate() {
    const register = location.pathname.startsWith('/register');
    const lines = register
      ? ['デモ版: 作成は見た目だけです。ログイン画面ではどのIDでも入れます。']
      : ['デモ版: IDとパスワードを入れれば誰でもログインできます。',
         'ID を admin にすると管理用画面に入れます。',
         'データはこのブラウザ内に保存されます。別のタブを開いて違うIDでログインすると、複数人の席決めを試せます。'];
    document.querySelectorAll('.test-hint').forEach((h) => {
      h.replaceChildren(...lines.flatMap((l, i) => (i ? [document.createElement('br'), l] : [l])));
    });
  }

  return { init, handle, guard, decorate };
})();
