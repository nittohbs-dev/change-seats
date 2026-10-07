// 全画面で使う共通処理
const E06 = '通信に失敗しました。もう一度お試しください';
const POLL_MS = 30000;

/** APIを呼ぶ。失敗時は {error, message} を持つ例外を投げる。 */
async function api(url, { method = 'GET', data } = {}) {
  let res;
  try {
    res = await fetch('/api' + url, {
      method,
      headers: data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
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
