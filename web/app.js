// 全画面で使う共通処理
const E06 = '通信に失敗しました。もう一度お試しください';
const POLL_MS = 30000;

// サーバー（Java版）があればそこへ、なければ（Vercelなど）ブラウザ内のデモ版バックエンドで動く。
// 判定は /api/ping で行い、結果が出るまで api() は待つ。
const backendReady = (async () => {
  try {
    const r = await fetch('/api/ping');
    if ((await r.json()).ok) return 'server';
  } catch { /* サーバーなし */ }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/static/demo-backend.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  await window.demoBackend.init();
  // 権限のない画面なら移動する。移動が終わるまで、この画面の処理は止めておく。
  if (window.demoBackend.guard()) await new Promise(() => {});
  window.demoBackend.decorate();
  return 'demo';
})();

/** APIを呼ぶ。失敗時は {error, message} を持つ例外を投げる。 */
async function api(url, opts = {}) {
  return (await backendReady) === 'demo' ? demoApi(url, opts) : serverApi(url, opts);
}

async function demoApi(url, { method = 'GET', data } = {}) {
  const f = {};
  if (data) {
    const entries = data instanceof FormData ? [...data.entries()] : Object.entries(data);
    for (const [k, v] of entries) f[k] = String(v).trim();
  }
  try {
    return window.demoBackend.handle(url, method, f);
  } catch (e) {
    if (e && e.error) throw e;
    console.error(e);
    throw { error: 'E-06', message: E06 };
  }
}

/** CSRF 対策のトークン。サーバーが Cookie（XSRF-TOKEN）に入れたものを、書き込みの呼び出しでヘッダーに付けて返す */
function csrfToken() {
  const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function serverApi(url, { method = 'GET', data } = {}) {
  let res;
  try {
    const headers = {};
    if (data) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (method !== 'GET') headers['X-XSRF-TOKEN'] = csrfToken();
    res = await fetch('/api' + url, {
      method,
      headers,
      body: data ? new URLSearchParams(data) : undefined,
    });
  } catch {
    throw { error: 'E-06', message: E06 };
  }
  let body;
  try { body = await res.json(); } catch { throw { error: 'E-06', message: E06 }; }
  if (!res.ok) {
    if (body.error === 'AUTH') location.href = '/';
    throw body;
  }
  return body;
}

/**
 * 全員の画面の同期：サーバーが「席の状況などが変わった」と知らせてきたら（SSE）、すぐ refresh を呼ぶ。
 * 通知が届かない場合に備えて、30秒ごとにも呼ぶ。サーバーのないデモ版では、同じブラウザの別タブの変更に反応する。
 */
function watchSeatMap(refresh) {
  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); };   // 続けて届いた通知はまとめる
  setInterval(refresh, POLL_MS);
  backendReady.then((mode) => {
    if (mode === 'server') {
      const es = new EventSource('/api/events');   // 切れたらブラウザが自動で再接続し、再接続のたびに最新を取り直す
      es.addEventListener('changed', soon);
      es.onerror = () => { if (es.readyState === EventSource.CLOSED) es.close(); };   // ログインが切れていたら、あきらめる
    } else {
      window.addEventListener('storage', (e) => { if (e.key === 'seat-demo-v4') soon(); });
    }
  });
}

function showMsg(el, text, kind = 'error') {
  el.textContent = text || '';
  el.className = 'msg ' + kind;
}

function fail(el) {
  return (e) => showMsg(el, e && e.message ? e.message : E06);
}

/**
 * 3Dの座席配置図を container に作る（office-view.js を読み込む）。
 * 戻り値の update(seatMap) に /api/seat-map の結果を渡すと、着席者の模型と名前が更新される。
 * 名前を押すとプロフィール（/api/seats/{id}/person）を表示する。
 */
async function createSeatMap(container) {
  container.replaceChildren(el('div', 'office-loading', '座席配置図を読み込み中…'));
  try {
    const { createOfficeView } = await import('/static/office-view.js');
    return await createOfficeView(container, { fetchPerson: (id) => api(`/seats/${id}/person`) });
  } catch (e) {
    console.error(e);
    container.replaceChildren(el('div', 'office-loading', '座席配置図を表示できませんでした（3D表示に対応したブラウザで開いてください）'));
    return { update() {} };
  }
}

/**
 * 真上から見た2Dの座席配置図を container に作る（office-map2d.js を読み込む）。
 * 戻り値の update(seatMap) に /api/seat-map の結果を渡すと、席の状態が描き直される。
 */
async function createSeatMap2d(container) {
  container.replaceChildren(el('div', 'office-loading', '座席配置図を読み込み中…'));
  try {
    const { createOfficeMap2d } = await import('/static/office-map2d.js');
    return await createOfficeMap2d(container);
  } catch (e) {
    console.error(e);
    container.replaceChildren(el('div', 'office-loading', '座席配置図を表示できませんでした'));
    return { update() {} };
  }
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
