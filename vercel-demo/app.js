// デモ版: サーバーの代わりにブラウザ内で処理する共通スクリプト。
// 席・アカウント・お題は localStorage（同じブラウザの全タブで共有）、
// ログイン中のIDは sessionStorage（タブごと）に保存する。
// → 同じブラウザで別タブを開き、違うIDでログインすると複数人の席決めを試せる。
const E06 = '通信に失敗しました。もう一度お試しください';
const POLL_MS = 30000;

const MSG = {
  'E-01': 'IDまたはパスワードが違います',
  'E-02': 'このIDは使われています',
  'E-03': '満席です',
  'E-05': '未入力の項目があります',
  'E-07': '100文字以内で入力してください',
  'E-08': '着席中の人がいるテーブルは削除できません',
  'I-01': '管理者アカウントを追加しました',
  AUTH: 'ログインしてください',
};

// ---------- データ保存 ----------
const KEY = 'seat-demo-v1';

function freshState() {
  const s = {
    tables: [], accounts: {}, admins: ['admin'], seatings: {}, topics: [],
    todayTopicId: null, nextTableId: 1, nextSeatId: 1, nextTopicId: 1,
  };
  addTable(s); addTable(s);
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

function currentUser() {
  try { return sessionStorage.getItem('seat-demo-user'); } catch { return null; }
}
function setUser(id) {
  try { id ? sessionStorage.setItem('seat-demo-user', id) : sessionStorage.removeItem('seat-demo-user'); } catch { /* 無視 */ }
}

function addTable(s) {
  const seats = [];
  for (let row = 1; row <= 2; row++)
    for (let col = 1; col <= 4; col++) seats.push({ id: s.nextSeatId++, row, col });
  s.tables.push({ id: s.nextTableId++, seats });
}

function pickTopic(s) {
  let ids = s.topics.map((t) => t.id);
  if (ids.length > 1) ids = ids.filter((id) => id !== s.todayTopicId);
  s.todayTopicId = ids.length ? ids[Math.floor(Math.random() * ids.length)] : null;
}

const isAdmin = (s, id) => s.admins.includes(id);
const seatOf = (s, id) => Object.keys(s.seatings).find((k) => s.seatings[k] === id) ?? null;
const account = (s, id) => (s.accounts[id] ??= { name: '', comment: '', workingOn: '' });
const topicText = (s) => s.topics.find((t) => t.id === s.todayTopicId)?.text ?? null;

function initialOf(s, id) {
  const str = account(s, id).name || id;
  return [...str][0].toUpperCase();
}

function seatMap(s, viewer) {
  return {
    tables: s.tables.map((t, i) => ({
      id: t.id,
      label: 'テーブル' + (i < 26 ? String.fromCharCode(65 + i) : i + 1),
      seats: t.seats.map((seat) => {
        const who = s.seatings[seat.id];
        const state = !who ? 'free' : who === viewer ? 'mine' : 'taken';
        const o = { id: seat.id, row: seat.row, col: seat.col, state };
        if (state === 'taken') o.initial = initialOf(s, who);
        return o;
      }),
    })),
  };
}

function adminData(s) {
  return { ...seatMap(s, null), topics: s.topics, todayTopic: topicText(s) };
}

function validate(pairs) {
  for (const [v, required] of pairs) if (required && !v) return 'E-05';
  for (const [v] of pairs) if ([...v].length > 100) return 'E-07';
  return null;
}

function err(code) {
  const e = { error: code, message: MSG[code] };
  throw e;
}

// ---------- サーバーの代わり（URLと動きはJava版と同じ） ----------
function handle(url, method, f) {
  const s = load();
  const user = currentUser();
  const done = (result) => { save(s); return result; };

  if (method === 'POST' && url === '/login') {
    if (!f.id || !f.password) err('E-01');
    account(s, f.id);
    setUser(f.id);
    return done({ redirect: homeOf(s, f.id) });
  }
  if (method === 'POST' && url === '/register') {
    if (!f.id || !f.password) err('E-05');
    if (s.accounts[f.id] || isAdmin(s, f.id)) err('E-02');
    account(s, f.id);
    return done({ redirect: '/' });
  }
  if (method === 'POST' && url === '/logout') { setUser(null); return { redirect: '/' }; }

  if (!user) { location.href = '/'; err('AUTH'); }

  if (url.startsWith('/admin/')) {
    if (!isAdmin(s, user)) err('AUTH');
    if (method === 'GET' && url === '/admin/data') return adminData(s);
    if (method === 'POST' && url === '/admin/topics') {
      const bad = validate([[f.text ?? '', true]]); if (bad) err(bad);
      s.topics.push({ id: s.nextTopicId++, text: f.text });
      return done(adminData(s));
    }
    let m;
    if (method === 'PUT' && (m = url.match(/^\/admin\/topics\/(\d+)$/))) {
      const bad = validate([[f.text ?? '', true]]); if (bad) err(bad);
      const t = s.topics.find((x) => x.id === Number(m[1]));
      if (t) t.text = f.text;
      return done(adminData(s));
    }
    if (method === 'POST' && url === '/admin/seat-tables') { addTable(s); return done(adminData(s)); }
    if (method === 'DELETE' && (m = url.match(/^\/admin\/seat-tables\/(\d+)$/))) {
      const t = s.tables.find((x) => x.id === Number(m[1]));
      if (t) {
        if (t.seats.some((seat) => s.seatings[seat.id])) err('E-08');
        s.tables = s.tables.filter((x) => x !== t);
      }
      return done(adminData(s));
    }
    if (method === 'POST' && url === '/admin/admins') {
      if (!f.id || !f.password) err('E-05');
      if (s.accounts[f.id] || isAdmin(s, f.id)) err('E-02');
      s.admins.push(f.id);
      return done({ message: MSG['I-01'] });
    }
    if (method === 'POST' && url === '/admin/daily-reset') {
      s.seatings = {};
      pickTopic(s);
      return done(adminData(s));
    }
  }

  if (method === 'GET' && url === '/me') {
    const a = account(s, user);
    return done({ id: user, admin: isAdmin(s, user), ...a, seated: seatOf(s, user) !== null, topic: topicText(s) });
  }
  if (method === 'GET' && url === '/seat-map') return seatMap(s, user);
  let m;
  if (method === 'GET' && (m = url.match(/^\/seats\/(\d+)\/person$/))) {
    const who = s.seatings[m[1]];
    if (!who) throw { error: 'EMPTY', message: 'この席は空いています' };
    const a = account(s, who);
    return { name: a.name, comment: a.comment, workingOn: a.workingOn };
  }
  if (method === 'POST' && url === '/seat-change/assign') {
    const bad = validate([[f.name ?? '', true], [f.comment ?? '', true]]); if (bad) err(bad);
    if (seatOf(s, user) !== null) return { redirect: '/seat' };
    const a = account(s, user);
    a.name = f.name; a.comment = f.comment;
    const free = s.tables.flatMap((t) => t.seats).filter((seat) => !s.seatings[seat.id]);
    if (!free.length) { save(s); err('E-03'); }
    s.seatings[free[Math.floor(Math.random() * free.length)].id] = user;
    return done({ redirect: '/seat' });
  }
  if (method === 'POST' && url === '/seat/leave') {
    const k = seatOf(s, user);
    if (k !== null) delete s.seatings[k];
    save(s);
    setUser(null);
    return { redirect: '/' };
  }
  if (method === 'POST' && url === '/account') {
    const bad = validate([[f.name ?? '', true], [f.comment ?? '', true], [f.workingOn ?? '', false]]); if (bad) err(bad);
    Object.assign(account(s, user), { name: f.name, comment: f.comment, workingOn: f.workingOn ?? '' });
    return done({ redirect: '/seat' });
  }
  throw { error: 'NOT_FOUND', message: '見つかりません' };
}

function homeOf(s, id) {
  if (!id) return '/';
  if (isAdmin(s, id)) return '/admin';
  return seatOf(s, id) !== null ? '/seat' : '/seat-change';
}

/** サーバー版と同じ呼び方。失敗時は {error, message} を投げる。 */
async function api(url, { method = 'GET', data } = {}) {
  let f = {};
  if (data) {
    const entries = data instanceof FormData ? [...data.entries()] : Object.entries(data);
    for (const [k, v] of entries) f[k] = String(v).trim();
  }
  try {
    return handle(url, method, f);
  } catch (e) {
    if (e && e.error) throw e;
    console.error(e);
    throw { error: 'E-06', message: E06 };
  }
}

// ---------- 画面ごとのアクセス制御（サーバー版のpage()と同じ） ----------
(function guard() {
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
    '/account': loggedIn && !admin,
    '/admin': admin,
  }[path];
  if (allowed === false) {
    const to = loggedIn ? homeOf(s, user) : '/';
    if (to !== path) location.replace(to);
  }
})();

function showMsg(el, text, kind = 'error') {
  el.textContent = text || '';
  el.className = 'msg ' + kind;
}

function fail(el) {
  return (e) => showMsg(el, e && e.message ? e.message : E06);
}

/**
 * 席の図を描く。
 * opts.onSeatClick(seat, el) … 席を押した時（着席者のいる席のみ）
 * opts.selectedId … 枠を付ける席
 * opts.landmarks … 窓・入口を出すか
 */
function renderSeatMap(container, data, opts = {}) {
  const { onSeatClick, selectedId, landmarks = true } = opts;
  container.replaceChildren();
  if (landmarks) container.append(el('div', 'landmark', '窓'));
  for (const table of data.tables) container.append(tableBlock(table, onSeatClick, selectedId));
  if (landmarks) container.append(el('div', 'landmark', '入口'));
}

function tableBlock(table, onSeatClick, selectedId) {
  const block = el('div', 'table-block');
  for (const row of [1, 2]) {
    const rowEl = el('div', 'seat-row');
    table.seats
      .filter((s) => s.row === row)
      .sort((a, b) => a.col - b.col)
      .forEach((s) => rowEl.append(seatButton(s, onSeatClick, selectedId)));
    block.append(rowEl);
    if (row === 1) block.append(el('div', 'table-bar', table.label));
  }
  return block;
}

function seatButton(seat, onSeatClick, selectedId) {
  const label = { free: '', taken: seat.initial, mine: '自分' }[seat.state];
  const b = el('button', 'seat ' + seat.state, label);
  b.type = 'button';
  b.dataset.seatId = seat.id;
  b.setAttribute('aria-label', { free: '空席', taken: '着席中の席', mine: '自分の席' }[seat.state]);
  if (seat.id === selectedId) b.classList.add('selected');
  if (onSeatClick && seat.state !== 'free') b.addEventListener('click', () => onSeatClick(seat, b));
  else b.tabIndex = -1;
  return b;
}

/** textContentで入れるので、利用者の入力がHTMLとして解釈されることはない */
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

async function logoutAndGoHome() {
  try { await api('/logout', { method: 'POST' }); } catch { /* 画面は移動する */ }
  location.href = '/';
}

