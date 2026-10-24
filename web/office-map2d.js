// 真上から見た2Dの座席配置図（<canvas>）
// 家具の位置は office-layout.json、席の位置は office-seats.json（どちらも office.blend から書き出し）。
// 空席は点線の円、着席者は頭文字の円、自分の席は色を変えて強調する。
const COLORS = {
  floor: '#f7f1e8', grid: '#eadfce',
  wall: ['#b9b2a8', '#8f877c'], table: ['#f4e6d2', '#d9c2a2'], side_table: ['#efe0c8', '#d9c2a2'],
  sofa: ['#cfdde6', '#9db4c4'], copier: ['#e7e9ec', '#aeb4bb'], chair: ['#e4dccf', '#cbbfae'], lounge_chair: ['#dbe1e8', '#b6c0cc'],
  text: '#8a7f78',
  free: '#c9b9a2', taken: ['#ffe2c7', '#f3b58c', '#9a4a1c'], mine: ['#4f9bf0', '#2f80d8', '#ffffff'],
};
const LABELS = { wall: '壁', copier: 'コピー機', sofa: 'ソファ' };
const SEAT_R = 2.0;   // 席の円の半径（モデルの単位）

/**
 * container に2D平面図を作る。戻り値の update(seatMap) に /api/seat-map の結果を渡すと、席の状態を描き直す。
 */
export async function createOfficeMap2d(container) {
  const [layout, seatData] = await Promise.all([
    fetch('/static/office-layout.json').then((r) => r.json()),
    fetch('/static/office-seats.json').then((r) => r.json()),
  ]);
  const b = layout.bounds;
  const W = b.x1 - b.x0, H = b.y1 - b.y0;
  container.classList.add('office-map2d');
  container.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '真上から見た座席配置図');
  container.append(canvas);
  const ctx = canvas.getContext('2d');
  let state = new Map();   // 席ID → {state, initial}

  function draw() {
    const cssW = container.clientWidth;
    if (!cssW) return;
    const cssH = Math.round(cssW * H / W);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const sc = cssW / W * dpr;                              // 1単位あたりのピクセル
    const X = (x) => (x - b.x0) * sc, Y = (y) => (b.y1 - y) * sc;   // 北（+y）を上にする

    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = Math.ceil(b.x0 / 10) * 10; x < b.x1; x += 10) { ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), canvas.height); ctx.stroke(); }
    for (let y = Math.ceil(b.y0 / 10) * 10; y < b.y1; y += 10) { ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(canvas.width, Y(y)); ctx.stroke(); }

    // 家具（壁・机・ソファ・コピー機。椅子は座席の円の下に薄く）
    const order = ['chair', 'lounge_chair', 'side_table', 'table', 'sofa', 'copier', 'wall'];
    for (const kind of order) {
      for (const it of layout.items.filter((i) => i.kind === kind)) {
        const [fill, stroke] = COLORS[kind] ?? COLORS.table;
        const x = X(it.x0), y = Y(it.y1), w = (it.x1 - it.x0) * sc, h = (it.y1 - it.y0) * sc;
        ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.18); ctx.fill(); ctx.stroke();
        if (LABELS[kind]) {
          ctx.fillStyle = COLORS.text;
          ctx.font = `700 ${Math.max(10 * dpr, 2.6 * sc)}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (h > w * 1.5) {                               // 細長い壁は、横に文字を添える
            ctx.textAlign = 'left';
            ctx.fillText(LABELS[kind], x + w + 3 * dpr, y + h / 2);
          } else {
            ctx.fillText(LABELS[kind], x + w / 2, y + h / 2);
          }
        }
      }
    }

    // 席
    for (const seat of seatData.seats) {
      const st = state.get(seat.id);
      const cx = X(seat.x), cy = Y(seat.y), r = SEAT_R * sc;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (!st || st.state === 'free') {
        ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.lineWidth = Math.max(1.5, 1.5 * dpr); ctx.strokeStyle = COLORS.free; ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      const [fill, stroke, text] = st.state === 'mine' ? COLORS.mine : COLORS.taken;
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = Math.max(2, 2 * dpr); ctx.strokeStyle = stroke; ctx.stroke();
      ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = st.state === 'mine' ? '自分' : st.initial || '';
      ctx.font = `700 ${r * (st.state === 'mine' ? 0.8 : 1.2)}px sans-serif`;
      ctx.fillText(label, cx, cy + r * 0.05);
    }
  }

  new ResizeObserver(draw).observe(container);
  draw();
  return {
    update(data) {
      state = new Map((data?.seats ?? []).map((s) => [s.id, s]));
      draw();
    },
  };
}
