// 分身の動きの計算（Three.js に依存しない。ブラウザと Node の両方で動く）
//
// 考え方
// - 動きは「サーバーの時刻」と「誰がいつから座っているか」だけから計算する。全員が同じ式で計算するので、
//   端末が違っても同じ動きになる（サーバーは動きを管理しない）。
// - 時間を TURN_MS（60秒）の「ターン」に区切り、ターンごとに、ルート0,1,2…へ着席者を1人ずつ割り当てる。
//   1人は1ターンに1ルートだけ、1ルートは1ターンに1人だけ → 同じルートを同時に歩くことはない。
//   割り当てられなかった人は座ったまま。割り当ては「最大ハッシュ」方式なので、誰かが座る・帰っても他の人の割り当ては変わりにくい。
// - 道は、家具の床面の長方形（office-layout.json）を分身の半径ぶん広げて「通れない場所」にした碁盤の目の上で、
//   A* 探索して作る。通路だけを通るので、家具や壁を貫通しない。
//
// 座標は Blender の XY 平面（office-seats.json と同じ）。向き(yaw)は office-seats.json の rot と同じ定義。

export const TURN_MS = 60000;
const CELL = 0.5;            // 碁盤の目の大きさ
const FINE = 0.25;           // 直線で歩けるかの判定に使う、細かい碁盤の目
const RADIUS = 1.0;          // 分身の半径（家具からこれだけ離れて歩く）
const STAND_UP_S = 1.0;      // 立ち上がる・座る時間
const WALK_MPS = 1.4;        // 歩く速さ（メートル/秒）
const STRIDE_M = 0.7;        // 歩幅（1歩 = 脚の振りの半周期）
const SKIP_RATE = 0.3;       // ルートごとに、そのターンは誰も歩かない確率（全員が一斉に歩かないように）

// 喧嘩：歩いている2人が CONTACT_M より近づいたら「接触」。接触の FIGHT_RATE の割合で取っ組み合いになり、
// FIGHT_S 秒のあと、2人とも怒ったまま速足（ANGRY_SPEED 倍）で自分の席へ戻る。
// 予定はターンの初めに 0.1 秒刻みで先に動かして決める（timeline）ので、全端末で同じ相手・同じ時刻・同じ勝ち負けになる。
// 怪獣（office-kaiju.js と共通の時刻表。押してからの秒）。分身は FLEE_FROM ごろから逃げ、RESTORE_S で元に戻ったあと席へ戻る
export const KAIJU = { RISE_S: 4, ROAR_S: 4.5, BEAM_FROM: 7, BEAM_TO: 17, SINK_FROM: 24, SINK_TO: 30, FLEE_FROM: 2.5, RESTORE_S: 180 };
const PANIC_MPS = 3.2;       // 逃げる速さ（メートル/秒）

export const FIGHT_S = 7;
export const FIGHT_PHASES = { grip: 0.6, throw: 4.4, down: 5.0, getUp: 6.0 };   // 寄る → つかみ合い → 投げ → 尻もち → 立つ（秒）
const FIGHT_RATE = 0.3;
const CONTACT_M = 0.5;       // 体の中心どうしの距離（メートル）
const GRAPPLE_M = 0.55;      // つかみ合っている時の距離
const PUSH_M = 0.6;          // 負けた方が押し飛ばされる距離
const ANGRY_SPEED = 1.3;
const STEP_S = 0.1;          // 予定を先に動かす刻み
const dist = (a, b) => Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));   // Math.hypot はブラウザで最後の桁が違うことがあるので使わない

// 吹き出し（セリフ）：分身ごとに SPEECH_SLOT_S 秒の枠に区切り、枠ごとに「話すか」「いつ話すか」「どのセリフか」を決める。
// 話す枠は半分ほどで、枠の中の開始位置もばらばらなので、間隔は不定期になる。時刻だけから決まるので、全端末で同じ吹き出しになる。
export const SPEECH_SLOT_S = 30;
export const SPEECH_SHOW_S = 5;
const SPEECH_RATE = 0.5;

/** 32ビットの混ぜ関数（整数だけを使うので、どの端末でも同じ結果になる） */
export function hash32(...nums) {
  let h = 2166136261;
  for (const n of nums) {
    h ^= (n | 0);
    h = Math.imul(h, 16777619);
    h ^= h >>> 15;
    h = Math.imul(h, 2246822519);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
const unit = (...nums) => hash32(...nums) / 4294967296;   // 0 以上 1 未満

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * その時刻に、この席の分身が話しているセリフの番号（0 以上 lineCount 未満）。話していなければ -1。
 * fade は、出る・消える時の透明度（0〜1）を返すために使える。
 */
export function speechAt(nowMs, seatId, lineCount) {
  const slot = Math.floor(nowMs / (SPEECH_SLOT_S * 1000));
  const sec = (nowMs - slot * SPEECH_SLOT_S * 1000) / 1000;
  if (unit(slot, seatId, 11) >= SPEECH_RATE) return -1;
  const start = unit(slot, seatId, 13) * (SPEECH_SLOT_S - SPEECH_SHOW_S);
  if (sec < start || sec >= start + SPEECH_SHOW_S) return -1;
  return hash32(slot, seatId, 17) % lineCount;
}

export class OfficeNav {
  /**
   * @param layout office-layout.json（{bounds, items:[{kind,x0,y0,x1,y1}]}）
   * @param seatsData office-seats.json（{seats:[{id,x,y,rot,type,...}]}）
   * @param opts.unitsPerMeter モデルの1メートルあたりの長さ（歩く速さの換算に使う）
   */
  constructor(layout, seatsData, { unitsPerMeter = 5.6 } = {}) {
    this.layout = layout;
    this.items = layout.items;
    this.upm = unitsPerMeter;
    this.speed = WALK_MPS * unitsPerMeter;
    this.stride = STRIDE_M * unitsPerMeter;
    this.seats = new Map(seatsData.seats.map((s) => [s.id, s]));
    this.b = layout.bounds;
    this.nx = Math.ceil((this.b.x1 - this.b.x0) / CELL);
    this.ny = Math.ceil((this.b.y1 - this.b.y0) / CELL);
    // 通れない場所：家具の長方形を分身の半径ぶん広げて、碁盤の目に塗る（格子の中心だけで判定するので、少し余裕を見る）
    this.blocked = this.paint(CELL, RADIUS + CELL * 0.7, 2);
    // 細かい判定用（道を直線にまとめる時に使う）
    this.fine = this.paint(FINE, RADIUS, 1);
    this.fnx = Math.ceil((this.b.x1 - this.b.x0) / FINE);
    // 席から歩いて行ける場所（壁の外や、入口のない部屋は除く）
    this.reach = this.flood();
    this.stands = new Map();                              // 席ID → 椅子から立って出る場所
    for (const s of this.seats.values()) this.stands.set(s.id, this.standPoint(s));
    this.routes = this.buildRoutes();
    this.pathCache = new Map();
    this.turnCache = null;
  }

  /** 長方形を r だけ広げて、大きさ cell の碁盤の目に塗る。枠から m 以内も塗る */
  paint(cell, r, m) {
    const b = this.b, nx = Math.ceil((b.x1 - b.x0) / cell), ny = Math.ceil((b.y1 - b.y0) / cell);
    const g = new Uint8Array(nx * ny);
    const fill = (x0, y0, x1, y1) => {     // 中心が (x0..x1, y0..y1) に入る格子
      const i0 = Math.max(0, Math.ceil((x0 - b.x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((x1 - b.x0) / cell - 0.5));
      const j0 = Math.max(0, Math.ceil((y0 - b.y0) / cell - 0.5)), j1 = Math.min(ny - 1, Math.floor((y1 - b.y0) / cell - 0.5));
      for (let j = j0; j <= j1; j++) if (i0 <= i1) g.fill(1, j * nx + i0, j * nx + i1 + 1);
    };
    for (const it of this.items) fill(it.x0 - r, it.y0 - r, it.x1 + r, it.y1 + r);
    fill(b.x0 - 1, b.y0 - 1, b.x0 + m, b.y1 + 1); fill(b.x1 - m, b.y0 - 1, b.x1 + 1, b.y1 + 1);
    fill(b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y0 + m); fill(b.x0 - 1, b.y1 - m, b.x1 + 1, b.y1 + 1);
    return g;
  }

  /** 最初の席の近くから、歩いて行ける格子をすべて調べる */
  flood() {
    const reach = new Uint8Array(this.nx * this.ny);
    const first = [...this.seats.values()][0];
    if (!first) return reach;
    let start = -1;
    const [ci, cj] = this.cellOf(first.x, first.y);
    for (let d = 0; d < 40 && start < 0; d++) {
      for (let j = cj - d; j <= cj + d && start < 0; j++) {
        for (let i = ci - d; i <= ci + d; i++) {
          if (i >= 0 && j >= 0 && i < this.nx && j < this.ny && !this.blocked[j * this.nx + i]) { start = j * this.nx + i; break; }
        }
      }
    }
    if (start < 0) return reach;
    const stack = [start];
    reach[start] = 1;
    while (stack.length) {
      const c = stack.pop(), i = c % this.nx, j = (c - i) / this.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, n = nj * this.nx + ni;
        if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.ny || reach[n] || this.blocked[n]) continue;
        reach[n] = 1;
        stack.push(n);
      }
    }
    return reach;
  }

  // ---- 場所の判定 ----
  cellCenter(i, j) { return [this.b.x0 + (i + 0.5) * CELL, this.b.y0 + (j + 0.5) * CELL]; }
  cellOf(x, y) {
    return [Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.b.x0) / CELL))),
            Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.b.y0) / CELL)))];
  }
  inBounds(x, y, m) { return x > this.b.x0 + m && x < this.b.x1 - m && y > this.b.y0 + m && y < this.b.y1 - m; }
  /** 点が、家具の長方形を r だけ広げた中にあるか */
  inside(x, y, r) {
    for (const it of this.items) {
      if (x > it.x0 - r && x < it.x1 + r && y > it.y0 - r && y < it.y1 + r) return true;
    }
    return false;
  }
  /** 半径 r の分身が、この点に立てるか（家具に触れず、枠の中） */
  clear(x, y, r = RADIUS) {
    if (r !== RADIUS) return this.inBounds(x, y, 1) && !this.inside(x, y, r);
    if (!this.inBounds(x, y, 1)) return false;
    return !this.fine[Math.floor((y - this.b.y0) / FINE) * this.fnx + Math.floor((x - this.b.x0) / FINE)];
  }
  /** 2点の間を、家具に触れずに直線で歩けるか */
  lineClear(a, b, r = RADIUS) {
    const len = dist(a, b);
    const n = Math.max(1, Math.ceil(len / 0.25));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (!this.clear(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r)) return false;
    }
    return true;
  }

  /** (x,y) に一番近い、歩ける格子の中心を返す */
  findFree(x, y) {
    const [ci, cj] = this.cellOf(x, y);
    for (let d = 0; d < 60; d++) {
      let best = null, bd = Infinity;
      for (let j = cj - d; j <= cj + d; j++) {
        for (let i = ci - d; i <= ci + d; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== d) continue;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny || !this.reach[j * this.nx + i]) continue;
          const [cx, cy] = this.cellCenter(i, j);
          const dd = (cx - x) ** 2 + (cy - y) ** 2;
          if (dd < bd) { bd = dd; best = [cx, cy]; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** 椅子から立った時に出る場所：椅子の背もたれ側（机と反対側） */
  standPoint(seat) {
    const fx = Math.sin(seat.rot), fy = -Math.cos(seat.rot);   // 椅子の正面（机の方向）
    const dist = seat.type === 'lounge_chair' ? 3.4 : 3.8;
    return this.findFree(seat.x - fx * dist, seat.y - fy * dist);
  }

  // ---- 道探索（A*） ----
  astar(a, b) {
    const s = this.cellOf(a[0], a[1]), g = this.cellOf(b[0], b[1]);
    const nx = this.nx, ny = this.ny;
    const idx = (i, j) => j * nx + i;
    const dist = new Map([[idx(...s), 0]]);
    const from = new Map();
    const open = new MinHeap();
    const h = (i, j) => { const dx = Math.abs(i - g[0]), dy = Math.abs(j - g[1]); return 10 * (dx + dy) - 6 * Math.min(dx, dy); };
    open.push([h(...s), idx(...s), s[0], s[1]]);
    const done = new Set();
    const free = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && !this.blocked[idx(i, j)];
    while (open.size) {
      const [, id, i, j] = open.pop();
      if (done.has(id)) continue;
      done.add(id);
      if (i === g[0] && j === g[1]) {
        const cells = [];
        for (let c = id; c !== undefined; c = from.get(c)) cells.push([c % nx, Math.floor(c / nx)]);
        return cells.reverse().map(([ci, cj]) => this.cellCenter(ci, cj));
      }
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj;
          if (!free(ni, nj)) continue;
          if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue;   // 角をかすめない
          const nid = idx(ni, nj);
          const cost = dist.get(id) + (di && dj ? 14 : 10);
          if (cost < (dist.get(nid) ?? Infinity)) {
            dist.set(nid, cost);
            from.set(nid, id);
            open.push([cost + h(ni, nj), nid, ni, nj]);
          }
        }
      }
    }
    return null;
  }

  /** 2点の間の道。碁盤の目の折れ線を、見通せる所まで直線にまとめる */
  route(a, b) {
    const cells = this.astar(a, b);
    if (!cells) return null;
    const out = [cells[0]];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.lineClear(cells[i], cells[j])) j--;
      out.push(cells[j]);
      i = j;
    }
    return out;
  }

  // ---- ルート（目的地の並び） ----
  buildRoutes() {
    // 目印（office-layout.json の anchors・tables。Blender の家具の外枠）。無い時は、そのルートを使わない
    const A = this.layout.anchors || {};
    const T = Object.fromEntries((this.layout.tables || []).map((t) => [t.label, t]));
    const mid = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
    /** 長方形を d だけ広げた四隅（1周する道） */
    const around = (r, d) => [[r[0] - d, r[1] - d], [r[2] + d, r[1] - d], [r[2] + d, r[3] + d], [r[0] - d, r[3] + d]];
    const has = (...rs) => rs.every(Boolean);
    const { copier, lounge, partition, modju, shelf, desk1, desk2 } = A;
    const ta = T.A?.area, tb = T.B?.area, tc = T.C?.area;
    const aisleBC = has(tb, tc) ? (tb[0] + tc[2]) / 2 : 0;                  // 中の机と西の机の間の通路
    const aisleWest = has(tc) ? tc[0] - 4 : 0;                               // 西の机のさらに西の通路
    const aisleAB = has(tb, partition) ? (tb[2] + partition[0]) / 2 : 0;     // 中の机と、ついたての間の通路
    const north = has(tb) ? tb[3] + 3 : 0;                                   // 机の列の北側
    const center = has(lounge) ? lounge[1] - 4 : 0;                          // ラウンジの南（フロア中央の通路）
    // ルートは24本（人数と同じ。1ターンに1ルート1人まで）。目的地は、いちばん近い歩ける場所に自動で合わせる。
    // dwell は最後の目的地で立ち止まる秒数の範囲（1周するルートは 0）
    const defs = [
      { name: 'コピー機へ', points: has(copier) ? [[mid(copier)[0], copier[1] - 3]] : [], dwell: [6, 10] },
      { name: 'コピー機の前を通って西へ', points: has(copier) ? [[mid(copier)[0], copier[1] - 3.5], [copier[0] - 18, copier[1] - 3.5]] : [], dwell: [3, 6] },
      { name: 'ラウンジ前へ', points: has(lounge) ? [[mid(lounge)[0], lounge[1] - 3]] : [], dwell: [6, 12] },
      { name: 'ラウンジの東側へ', points: has(lounge) ? [[lounge[2] + 2.5, mid(lounge)[1]]] : [], dwell: [4, 8] },
      { name: 'ラウンジの西側へ', points: has(lounge) ? [[lounge[0] - 2.5, mid(lounge)[1]]] : [], dwell: [4, 8] },
      { name: 'ラウンジの前を東西に横切る', points: has(lounge) ? [[lounge[0] - 3, center], [lounge[2] + 4, center]] : [], dwell: [2, 5] },
      { name: 'ついたての北の端へ', points: has(partition) ? [[mid(partition)[0], partition[3] + 3]] : [], dwell: [4, 8] },
      { name: 'ついたての南の端へ', points: has(partition) ? [[mid(partition)[0] - 2, partition[1] - 3]] : [], dwell: [4, 8] },
      { name: 'ついたての西の通路', points: has(tb, partition) ? [[aisleAB, north], [aisleAB, tb[1] + 2]] : [], dwell: [2, 5] },
      { name: '東の机を1周', points: has(ta, partition) ? around([partition[0], ta[1], ta[2], ta[3]], 3) : [], dwell: [0, 0] },
      { name: '東の机の東側へ', points: has(ta) ? [[ta[2] + 4, mid(ta)[1]]] : [], dwell: [4, 8] },
      { name: '南東の隅へ', points: has(ta) ? [[ta[2] + 8, ta[1]]] : [], dwell: [4, 8] },
      { name: '中と西の机の間の通路', points: has(tb, tc) ? [[aisleBC, north], [aisleBC, tb[1] + 2]] : [], dwell: [2, 5] },
      { name: '西の机の西の通路', points: has(tc) ? [[aisleWest, north], [aisleWest, tc[1] + 2]] : [], dwell: [2, 5] },
      { name: '中の机の北側を通る', points: has(tb) ? [[tb[0] - 1, north], [tb[2] + 1, north]] : [], dwell: [2, 5] },
      { name: '西の机の北側を通る', points: has(tc) ? [[tc[2] + 1, north], [tc[0] - 1, north]] : [], dwell: [2, 5] },
      { name: '西の事務机へ', points: has(desk1) ? [[desk1[2] + 3, mid(desk1)[1]]] : [], dwell: [5, 9] },
      { name: '南西の事務机へ', points: has(desk2) ? [[desk2[2] + 3, mid(desk2)[1]]] : [], dwell: [5, 9] },
      { name: 'くつろぎスペースへ', points: has(modju) ? [[mid(modju)[0] + 4, mid(modju)[1]]] : [], dwell: [6, 12] },
      { name: 'くつろぎスペースを1周', points: has(modju) ? around([modju[0] + 9, modju[1] + 9, modju[2] - 2, modju[3] - 6], 0) : [], dwell: [0, 0] },
      { name: '棚へ', points: has(shelf) ? [[shelf[2] + 2.5, mid(shelf)[1]]] : [], dwell: [5, 9] },
      { name: 'フロア中央の通路を東へ', points: has(tc, lounge) ? [[tc[0], center - 4], [lounge[2] + 3, center - 4]] : [], dwell: [2, 5] },
      { name: 'フロア中央の通路を西へ', points: has(tc, lounge) ? [[lounge[2] + 3, center - 7], [tc[0] - 3, center - 7]] : [], dwell: [2, 5] },
      { name: 'フロアをぶらぶら', points: has(tb, lounge) ? [[tb[0] - 8, center], [lounge[0] - 4, north + 2], [mid(tb)[0], center + 6]] : [], dwell: [3, 6] },
    ];
    return defs.filter((d) => d.points.length).map((d, id) => ({ id, ...d, points: d.points.map(([x, y]) => this.findFree(x, y)).filter(Boolean) }));
  }

  /** 席 → ルート の道（席→立つ場所→目的地…→立つ場所→席）。通れなければ null */
  pathFor(seatId, routeId) {
    const key = seatId * 64 + routeId;   // ルートは最大64本まで
    if (this.pathCache.has(key)) return this.pathCache.get(key);
    const seat = this.seats.get(seatId), rt = this.routes[routeId], stand = this.stands.get(seatId);
    let result = null;
    if (seat && rt && stand) {
      const nodes = [stand, ...rt.points, stand];
      const pts = [[seat.x, seat.y]];
      let ok = true, dwellAt = -1;
      for (let k = 0; k < nodes.length - 1 && ok; k++) {
        const leg = this.route(nodes[k], nodes[k + 1]);
        if (!leg) { ok = false; break; }
        pts.push(...leg);
        if (k === nodes.length - 3) dwellAt = pts.length - 1;   // 最後の目的地に着いた点
      }
      if (ok) {
        pts.push([seat.x, seat.y]);
        const cum = [0];
        for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + dist(pts[k - 1], pts[k]));
        result = { pts, cum, len: cum[cum.length - 1], dwellDist: rt.dwell[1] > 0 && dwellAt >= 0 ? cum[dwellAt] : -1 };
      }
    }
    this.pathCache.set(key, result);
    return result;
  }

  /** まだ計算していない「席×ルート」の道を、maxMs ミリ秒だけ先に計算しておく。残りの数を返す（0 なら完了） */
  warmUp(maxMs = 3) {
    const t0 = Date.now();
    for (const seatId of this.seats.keys()) {
      for (const rt of this.routes) {
        if (this.pathCache.has(seatId * 64 + rt.id)) continue;
        this.pathFor(seatId, rt.id);
        if (Date.now() - t0 >= maxMs) return this.seats.size * this.routes.length - this.pathCache.size;
      }
    }
    return 0;
  }

  // ---- ターンごとの割り当て ----
  /** そのターンに歩く人とルート。participants は、ターンの開始時点で座っていた席のID */
  assignments(turn, participants) {
    const key = turn + ':' + participants.join(',');
    if (this.turnCache?.key === key) return this.turnCache.value;
    const value = [];
    const taken = new Set();
    for (const rt of this.routes) {
      if (unit(turn, rt.id, 7) < SKIP_RATE) continue;            // このルートは、このターンは誰も歩かない
      let best = null, bestH = -1;
      for (const id of participants) {                           // 最大ハッシュ：メンバーが変わっても他の人は変わりにくい
        if (taken.has(id)) continue;
        const hv = hash32(turn, rt.id, id);
        if (hv > bestH) { bestH = hv; best = id; }
      }
      if (best == null) continue;
      taken.add(best);
      const path = this.pathFor(best, rt.id);
      if (!path) continue;
      const dwell = rt.dwell[0] + unit(turn, rt.id, best, 3) * (rt.dwell[1] - rt.dwell[0]);
      const walkS = path.len / this.speed;
      const dur = STAND_UP_S * 2 + walkS + (path.dwellDist >= 0 ? dwell : 0);
      const room = TURN_MS / 1000 - dur - 1;
      if (room <= 0) continue;                                   // 1ターンに収まらないルートは使わない
      value.push({ seatId: best, routeId: rt.id, start: 0.5 + unit(turn, rt.id, best, 5) * room, dwell: path.dwellDist >= 0 ? dwell : 0, path, dur });
    }
    this.turnCache = { key, value };
    return value;
  }

  // ---- 喧嘩を含めた、ターンの予定表 ----
  /**
   * そのターンの予定（assignments の各人に、喧嘩の予定 fight を足したもの）。
   * ターンを STEP_S 秒刻みで先に動かし、歩いている2人が近づいたら、FIGHT_RATE の割合で喧嘩にする。
   * 喧嘩した2人は、その時点から「喧嘩 → 怒ったまま席へ戻る」に予定を書き換える（それより前の動きは変わらない）。
   */
  timeline(turn, participants) {
    const key = turn + ':' + participants.join(',');
    if (this.timelineCache?.key === key) return this.timelineCache.value;
    const plans = this.assignments(turn, participants).map((a) => ({ ...a, fight: null, end: a.start + a.dur }));
    const contact = CONTACT_M * this.upm;
    const checked = new Set();          // そのターンで、もう調べた2人の組
    const busy = new Set();             // 喧嘩した人（そのターンは、もう喧嘩しない）
    const steps = Math.floor(TURN_MS / 1000 / STEP_S);
    for (let i = 0; i < steps; i++) {
      const sec = i * STEP_S;
      const moving = [];
      for (const p of plans) {
        if (busy.has(p.seatId)) continue;
        const m = this.motion(p, sec);
        if (m.state === 'walk' || m.state === 'idle') moving.push([p, m]);
      }
      for (let a = 0; a < moving.length; a++) {
        for (let b = a + 1; b < moving.length; b++) {
          const [pa, ma] = moving[a], [pb, mb] = moving[b];
          if (busy.has(pa.seatId) || busy.has(pb.seatId)) continue;
          const dx = mb.x - ma.x, dy = mb.y - ma.y;
          if (dx * dx + dy * dy >= contact * contact) continue;
          const lo = Math.min(pa.seatId, pb.seatId), hi = Math.max(pa.seatId, pb.seatId);
          const pair = lo * 1000 + hi;
          if (checked.has(pair)) continue;
          checked.add(pair);
          if (unit(turn, lo, hi, 23) >= FIGHT_RATE) continue;    // すれ違うだけ
          if (this.startFight(turn, sec, pa, ma, pb, mb)) { busy.add(pa.seatId); busy.add(pb.seatId); }
        }
      }
    }
    plans.contacts = checked.size;      // 接触した組の数（試験用）
    this.timelineCache = { key, value: plans };
    return plans;
  }

  /** 2人の喧嘩の予定を作る。喧嘩のあとの戻り道が無い、またはターンに収まらない時は false（喧嘩にしない） */
  startFight(turn, sec, pa, ma, pb, mb) {
    const lo = Math.min(pa.seatId, pb.seatId), hi = Math.max(pa.seatId, pb.seatId);
    const loser = hash32(turn, lo, hi, 29) & 1 ? lo : hi;
    let ux = mb.x - ma.x, uy = mb.y - ma.y;                     // a から b への向き
    const d = Math.sqrt(ux * ux + uy * uy);
    if (d > 1e-6) { ux /= d; uy /= d; } else { ux = Math.sin(ma.yaw); uy = -Math.cos(ma.yaw); }
    const mx = (ma.x + mb.x) / 2, my = (ma.y + mb.y) / 2, g = GRAPPLE_M * this.upm / 2, push = PUSH_M * this.upm;
    const make = (p, m, sign) => {                              // sign: a は -1、b は +1（中間点からの向き）
      const grip = [mx + sign * ux * g, my + sign * uy * g];
      const toPartner = [-sign * ux, -sign * uy];
      const role = p.seatId === loser ? 'lose' : 'win';
      const rest = role === 'lose' ? [grip[0] - toPartner[0] * push, grip[1] - toPartner[1] * push] : grip;
      const seat = this.seats.get(p.seatId), stand = this.stands.get(p.seatId);
      const leg = stand && this.route(rest, stand);
      if (!leg) return null;
      const pts = [rest, ...leg, [seat.x, seat.y]];
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + dist(pts[k - 1], pts[k]));
      const len = cum[cum.length - 1];
      const end = sec + FIGHT_S + len / (this.speed * ANGRY_SPEED) + STAND_UP_S;
      return { t0: sec, role, partner: null, from: [m.x, m.y], grip, rest, toPartner, sway: [ux, uy],
               path: { pts, cum, len }, end, key: hash32(turn, lo, hi, Math.round(sec / STEP_S)) };
    };
    const fa = make(pa, ma, -1), fb = make(pb, mb, 1);
    if (!fa || !fb || Math.max(fa.end, fb.end) > TURN_MS / 1000 - 0.5) return false;   // 1ターンに収まらない
    fa.partner = pb.seatId; fb.partner = pa.seatId;
    pa.fight = fa; pa.end = fa.end;
    pb.fight = fb; pb.end = fb.end;
    return true;
  }

  /**
   * 予定 p の人の、ターンの開始から sec 秒の姿。
   * state: sit | standup | walk | idle | sitdown | fight。fight の時は t（喧嘩の経過秒）・role・partner・key。
   * 喧嘩のあとの戻り道は walk に angry: true と rt（戻り始めてからの秒）・key が付く
   */
  motion(p, sec) {
    const s = this.seats.get(p.seatId);
    const sit = { x: s.x, y: s.y, yaw: s.rot, state: 'sit', t: 0, phase: 0 };
    const t = sec - p.start, len = p.end - p.start;
    if (t < 0 || t > len) return sit;
    if (t < STAND_UP_S) return { ...sit, state: 'standup', t: t / STAND_UP_S };
    if (t > len - STAND_UP_S) return { ...sit, state: 'sitdown', t: 1 - (t - (len - STAND_UP_S)) / STAND_UP_S };
    const f = p.fight;
    if (f && sec >= f.t0) {
      const ft = sec - f.t0;
      if (ft < FIGHT_S) return { ...this.fightPlace(f, ft), state: 'fight', t: ft, role: f.role, partner: f.partner, key: f.key, phase: 0 };
      const d = Math.min(f.path.len, (ft - FIGHT_S) * this.speed * ANGRY_SPEED);
      const at = this.at(f.path, d);
      return { x: at.x, y: at.y, yaw: at.yaw, state: 'walk', t: 0, phase: (d / this.stride) * Math.PI, angry: true, rt: ft - FIGHT_S, key: f.key };
    }
    const w = t - STAND_UP_S;                                    // 歩き始めてからの時間
    const { len: plen, dwellDist } = p.path;
    let d, state = 'walk';
    if (dwellDist < 0) d = Math.min(plen, w * this.speed);       // 立ち止まらないルート（1周）
    else {
      const toDwell = dwellDist / this.speed;                    // 最後の目的地に着くまでの時間
      if (w < toDwell) d = w * this.speed;
      else if (w < toDwell + p.dwell) { d = dwellDist; state = 'idle'; }
      else d = Math.min(plen, dwellDist + (w - toDwell - p.dwell) * this.speed);
    }
    const at = this.at(p.path, d);
    return { x: at.x, y: at.y, yaw: at.yaw, state, t: 0, phase: (d / this.stride) * Math.PI };
  }

  /** 喧嘩中の位置と向き：寄る → つかみ合って押し合う（2人で同じ向きに揺れる）→ 負けた方は押し飛ばされる */
  fightPlace(f, ft) {
    const P = FIGHT_PHASES;
    const yaw = Math.atan2(f.toPartner[0], -f.toPartner[1]);
    const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    if (ft < P.grip) {
      const e = ease(ft / P.grip);
      return { x: f.from[0] + (f.grip[0] - f.from[0]) * e, y: f.from[1] + (f.grip[1] - f.from[1]) * e, yaw };
    }
    if (ft < P.throw) {
      const sway = Math.sin((ft - P.grip) * Math.PI * 2 * 0.8) * 0.12 * this.upm;
      return { x: f.grip[0] + f.sway[0] * sway, y: f.grip[1] + f.sway[1] * sway, yaw };
    }
    const e = ease((ft - P.throw) / (P.down - P.throw));
    return { x: f.grip[0] + (f.rest[0] - f.grip[0]) * e, y: f.grip[1] + (f.rest[1] - f.grip[1]) * e, yaw };
  }

  // ---- 各着席者の、その時刻の姿 ----
  /**
   * @param nowMs 時刻（サーバーの時刻に合わせたもの）
   * @param seated 着席中の席 [{id, since}]
   * @param kaijuAt 怪獣ボタンが押された時刻（サーバーの時刻）。暴れていなければ null
   * @returns Map(席ID → {x, y, yaw, state, t, phase, ...})  state: sit | standup | walk | idle | sitdown | fight | panic（motion・kaijuMotion を参照）
   */
  poses(nowMs, seated, kaijuAt = null) {
    if (kaijuAt != null && nowMs >= kaijuAt) {
      const plan = this.kaijuPlan(kaijuAt, seated);
      const out = this.sitting(seated);
      if (nowMs < plan.end) {
        const sec = (nowMs - kaijuAt) / 1000;
        for (const p of plan.items) if (out.has(p.seatId)) out.set(p.seatId, this.kaijuMotion(p, sec));
        return out;
      }
      // 席に戻ったあとは、次のターンが始まるまで座ったまま（ターンの途中から急に歩き出さないように）
      if (Math.floor(nowMs / TURN_MS) * TURN_MS < plan.end) return out;
    }
    return this.turnPoses(nowMs, seated);
  }

  /** 全員が座っている姿 */
  sitting(seated) {
    const out = new Map();
    for (const { id } of seated) {
      const s = this.seats.get(id);
      if (s) out.set(id, { x: s.x, y: s.y, yaw: s.rot, state: 'sit', t: 0, phase: 0 });
    }
    return out;
  }

  /** ふだんの姿（ターンごとのルート歩き・喧嘩） */
  turnPoses(nowMs, seated) {
    const turn = Math.floor(nowMs / TURN_MS);
    const turnStart = turn * TURN_MS;
    const sec = (nowMs - turnStart) / 1000;
    const out = this.sitting(seated);
    const participants = seated.filter((p) => (p.since ?? 0) <= turnStart && this.seats.has(p.id)).map((p) => p.id).sort((a, b) => a - b);
    for (const p of this.timeline(turn, participants)) {
      if (!out.has(p.seatId)) continue;
      const m = this.motion(p, sec);
      // 喧嘩の相手が途中で帰社した時は、その場で怒って立っている（予定どおりの時刻に席へ戻る）
      if (m.state === 'fight' && !out.has(m.partner)) { m.state = 'idle'; m.angry = true; }
      out.set(p.seatId, m);
    }
    return out;
  }

  // ---- 怪獣が出た時：大慌てで逃げて、復旧したら席へ戻る ----
  /** 逃げる先の候補：怪獣（北）から遠い、南側の歩ける場所を、少しずつ離して選ぶ */
  safeSpots() {
    if (this._safe) return this._safe;
    const b = this.b, south = b.y0 + (b.y1 - b.y0) * 0.32, out = [];
    for (let y = b.y0 + 3; y < south; y += 3) {
      for (let x = b.x0 + 3; x < b.x1 - 3; x += 3) {
        const [i, j] = this.cellOf(x, y);
        if (this.reach[j * this.nx + i]) out.push(this.cellCenter(i, j));
      }
    }
    this._safe = out;
    return out;
  }

  /**
   * 怪獣が出た時の、一人ひとりの予定（押した時刻と着席者だけから決まるので、全端末で同じ）。
   * 押した時に歩いていた人はその場から、座っていた人は立ち上がってから、南側の逃げ場所へ走る。
   * 逃げ場所では慌てて手を振り、復旧（RESTORE_S）のあと、ふつうの速さで席へ戻って座る。
   */
  kaijuPlan(kaijuAt, seated) {
    const ids = seated.filter((p) => (p.since ?? 0) <= kaijuAt && this.seats.has(p.id)).map((p) => p.id).sort((a, b) => a - b);
    const key = kaijuAt + ':' + ids.join(',');
    if (this.kaijuCache?.key === key) return this.kaijuCache.value;
    const base = this.turnPoses(kaijuAt, seated.filter((p) => ids.includes(p.id)));   // 押した瞬間の姿
    const spots = this.safeSpots(), seed = kaijuAt % 1000003;
    const panic = PANIC_MPS * this.upm;
    const items = [], used = new Set();
    let end = kaijuAt + KAIJU.RESTORE_S * 1000;
    for (const id of ids) {
      const seat = this.seats.get(id), stand = this.stands.get(id), b = base.get(id);
      if (!seat || !stand) continue;
      const moving = b && (b.state === 'walk' || b.state === 'idle' || b.state === 'fight');
      const from = moving ? [b.x, b.y] : stand;
      // 逃げ場所は人ごとに散らす（空いている候補が無くなるまでは、ほかの人と重ならない）
      let si = spots.length ? hash32(seed, id, 37) % spots.length : -1;
      for (let n = 0; si >= 0 && used.has(si) && n < spots.length; n++) si = (si + 1) % spots.length;
      if (si >= 0) used.add(si);
      const spot = si >= 0 ? spots[si] : stand;
      const toSpot = this.route(from, spot);
      const back = this.route(spot, stand);
      if (!toSpot || !back) continue;                         // 道が無ければ、座ったまま
      const mk = (pts) => { const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + dist(pts[k - 1], pts[k])); return { pts, cum, len: cum[cum.length - 1] }; };
      const run = mk(moving ? toSpot : [[seat.x, seat.y], ...toSpot]);
      const ret = mk([...back, [seat.x, seat.y]]);
      const t0 = KAIJU.FLEE_FROM + unit(seed, id, 41) * 1.5;  // 気づいて逃げ始める時刻（人によって少しずれる）
      const runFrom = t0 + (moving ? 0 : STAND_UP_S);
      const arrive = runFrom + run.len / panic;
      const backFrom = KAIJU.RESTORE_S + unit(seed, id, 43) * 4;
      const sitFrom = backFrom + ret.len / this.speed;
      const item = { seatId: id, from, moving, fromYaw: b?.yaw ?? seat.rot, t0, runFrom, arrive, run, ret, backFrom, sitFrom, spot };
      items.push(item);
      end = Math.max(end, kaijuAt + (sitFrom + STAND_UP_S) * 1000);
    }
    const value = { items, end };
    this.kaijuCache = { key, value };
    return value;
  }

  /** 怪獣が出てから sec 秒の姿。panic は逃げ場所で慌てている姿（t は経過秒）。逃げる・戻る間は walk に kaiju: true */
  kaijuMotion(p, sec) {
    const seat = this.seats.get(p.seatId);
    const sit = { x: seat.x, y: seat.y, yaw: seat.rot, state: 'sit', t: 0, phase: 0 };
    const north = Math.PI;                                   // 北（怪獣の方）を向く向き
    if (sec < p.t0) return p.moving ? { x: p.from[0], y: p.from[1], yaw: p.fromYaw, state: 'idle', t: 0, phase: 0, kaiju: true } : sit;
    if (!p.moving && sec < p.runFrom) return { ...sit, state: 'standup', t: (sec - p.t0) / STAND_UP_S };
    if (sec < p.arrive) {
      const d = (sec - p.runFrom) * PANIC_MPS * this.upm, at = this.at(p.run, d);
      return { x: at.x, y: at.y, yaw: at.yaw, state: 'walk', t: 0, phase: (d / this.stride) * Math.PI, kaiju: true, panicRun: true };
    }
    if (sec < p.backFrom) return { x: p.spot[0], y: p.spot[1], yaw: north, state: 'panic', t: sec, phase: 0, kaiju: true };
    if (sec < p.sitFrom) {
      const d = (sec - p.backFrom) * this.speed, at = this.at(p.ret, d);
      return { x: at.x, y: at.y, yaw: at.yaw, state: 'walk', t: 0, phase: (d / this.stride) * Math.PI, kaiju: true, relieved: true };
    }
    if (sec < p.sitFrom + STAND_UP_S) return { ...sit, state: 'sitdown', t: 1 - (sec - p.sitFrom) / STAND_UP_S };
    return sit;
  }

  /** 道の上の、距離 d の地点と進行方向 */
  at(path, d) {
    const { pts, cum } = path;
    let k = 1;
    while (k < cum.length - 1 && cum[k] < d) k++;
    const seg = cum[k] - cum[k - 1] || 1;
    const f = Math.min(1, Math.max(0, (d - cum[k - 1]) / seg));
    const dx = pts[k][0] - pts[k - 1][0], dy = pts[k][1] - pts[k - 1][1];
    return { x: pts[k - 1][0] + dx * f, y: pts[k - 1][1] + dy * f, yaw: Math.atan2(dx, -dy) };
  }
}
