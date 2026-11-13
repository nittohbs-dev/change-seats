// 真上から見た2Dの座席配置図（<canvas>）
// 家具の位置は office-layout.json、席の位置は office-seats.json（どちらも Blender のオフィスから書き出し。座標も Blender と同じ）。
// 家具・壁は、真上から見た形を小さな長方形の集まりにしたもの（Blender の形どおり）。
// 空席は点線の円、着席者は頭文字の円、自分の席は色を変えて強調する。
const COLORS = {
  floor: '#f7f1e8', grid: '#eadfce',
  wall: ['#b9b2a8', '#8f877c'], table: ['#f4e6d2', '#d9c2a2'], side_table: ['#efe0c8', '#d9c2a2'],
  sofa: ['#cfdde6', '#9db4c4'], copier: ['#e7e9ec', '#aeb4bb'], chair: ['#e4dccf', '#cbbfae'], lounge_chair: ['#dbe1e8', '#b6c0cc'],
  sofa2: ['#cfe3d2', '#9cc3a3'], desk: ['#e9d6bf', '#c9a982'], tv: ['#5b5f66', '#3d4046'], shelf: ['#e3d3bd', '#bfa684'],
  cabinet: ['#e6dfd4', '#c4b8a6'], plant: ['#cfe5c4', '#7fae6a'],
  decor: ['#e6d3a8', '#c7aa6a'], sign: ['#e6d3a8', '#c7aa6a'],
  text: '#8a7f78',
  free: '#c9b9a2', taken: ['#ffe2c7', '#f3b58c', '#9a4a1c'], mine: ['#4f9bf0', '#2f80d8', '#ffffff'],
};
// 名前を添える家具（office-layout.json の anchors の名前 → 表示）
const LABELS = { copier: 'コピー機', conference: '会議室', modju: 'くつろぎスペース', shelf: '棚' };
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

    // 家具と壁。小さな長方形の集まりなので、枠線は引かずに塗るだけにする（つなぎ目が見えないよう、少し重ねる）
    const order = ['chair', 'lounge_chair', 'side_table', 'table', 'sofa', 'copier', 'cabinet', 'plant', 'desk', 'sofa2', 'shelf', 'tv', 'decor', 'sign', 'wall'];
    const seam = 0.6 / sc * dpr;
    for (const kind of order) {
      ctx.fillStyle = (COLORS[kind] ?? COLORS.table)[kind === 'wall' || kind === 'tv' ? 1 : 0];
      for (const it of layout.items) {
        if (it.kind !== kind) continue;
        ctx.fillRect(X(it.x0 - seam), Y(it.y1 + seam), (it.x1 - it.x0 + seam * 2) * sc, (it.y1 - it.y0 + seam * 2) * sc);
      }
    }
    // 机の名前（A・B・C）と、家具の名前
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(10 * dpr, 2.6 * sc)}px sans-serif`;
    for (const t of layout.tables ?? []) ctx.fillText(t.label, X((t.top[0] + t.top[2]) / 2), Y((t.top[1] + t.top[3]) / 2));
    ctx.font = `700 ${Math.max(9 * dpr, 2.2 * sc)}px sans-serif`;
    for (const [key, text] of Object.entries(LABELS)) {
      const r = layout.anchors?.[key];
      if (r) ctx.fillText(text, X((r[0] + r[2]) / 2), Y((r[1] + r[3]) / 2));
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
