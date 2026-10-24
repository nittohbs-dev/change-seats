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
const RADIUS = 1.0;          // 分身の半径（家具からこれだけ離れて歩く）
const STAND_UP_S = 1.0;      // 立ち上がる・座る時間
const WALK_MPS = 1.4;        // 歩く速さ（メートル/秒）
const STRIDE_M = 0.7;        // 歩幅（1歩 = 脚の振りの半周期）
const SKIP_RATE = 0.3;       // ルートごとに、そのターンは誰も歩かない確率（全員が一斉に歩かないように）

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
    this.blocked = new Uint8Array(this.nx * this.ny);
    const pad = RADIUS + CELL * 0.7;   // 格子の中心だけで判定するので、少し余裕を見る
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const [x, y] = this.cellCenter(i, j);
        this.blocked[j * this.nx + i] = this.inside(x, y, pad) || !this.inBounds(x, y, 2) ? 1 : 0;
      }
    }
    this.stands = new Map();                              // 席ID → 椅子から立って出る場所
    for (const s of this.seats.values()) this.stands.set(s.id, this.standPoint(s));
    this.routes = this.buildRoutes();
    this.pathCache = new Map();
    this.turnCache = null;
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
  clear(x, y, r = RADIUS) { return this.inBounds(x, y, 1) && !this.inside(x, y, r); }
  /** 2点の間を、家具に触れずに直線で歩けるか */
  lineClear(a, b, r = RADIUS) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
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
    for (let d = 0; d < 40; d++) {
      let best = null, bd = Infinity;
      for (let j = cj - d; j <= cj + d; j++) {
        for (let i = ci - d; i <= ci + d; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== d) continue;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny || this.blocked[j * this.nx + i]) continue;
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
    const tables = this.items.filter((i) => i.kind === 'table').sort((a, b) => b.x0 - a.x0);
    // 机とその周りの椅子をまとめた枠を、少し広げた1周の道にする
    const loop = (table) => {
      const near = this.items.filter((i) => (i.kind === 'chair' || i === table)
        && i.x1 > table.x0 - 6 && i.x0 < table.x1 + 6 && i.y1 > table.y0 - 6 && i.y0 < table.y1 + 6);
      const x0 = Math.min(...near.map((i) => i.x0)) - 3.5, x1 = Math.max(...near.map((i) => i.x1)) + 3.5;
      const y0 = Math.min(...near.map((i) => i.y0)) - 3.5, y1 = Math.max(...near.map((i) => i.y1)) + 3.5;
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    };
    const copier = this.items.find((i) => i.kind === 'copier');
    const sofa = this.items.find((i) => i.kind === 'sofa');
    const wall = this.items.find((i) => i.kind === 'wall');
    const bb = this.b;
    const mid = (it) => [(it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2];
    /** 家具を d だけ広げた長方形の四隅（1周する道） */
    const around = (it, d) => [[it.x0 - d, it.y0 - d], [it.x1 + d, it.y0 - d], [it.x1 + d, it.y1 + d], [it.x0 - d, it.y1 + d]];
    // 机の列の間の通路の中心（東の机の西端と壁の間、中の机と西の机の間）
    const chairsNear = (t) => this.items.filter((i) => i.kind === 'chair' && i.x1 > t.x0 - 6 && i.x0 < t.x1 + 6 && i.y1 > t.y0 - 6 && i.y0 < t.y1 + 6);
    const westEdge = (t) => Math.min(...chairsNear(t).map((i) => i.x0)), eastEdge = (t) => Math.max(...chairsNear(t).map((i) => i.x1));
    const aisleAW = tables[0] && wall ? (wall.x1 + westEdge(tables[0])) / 2 : 4;
    const aisleBC = tables[1] && tables[2] ? (westEdge(tables[1]) + eastEdge(tables[2])) / 2 : -20.5;
    const M = 4;   // 隅・端から内側へ入る距離
    // ルートは24本（人数と同じ。1ターンに1ルート1人まで）。目的地は、いちばん近い歩ける場所に自動で合わせる。
    // dwell は最後の目的地で立ち止まる秒数の範囲（1周するルートは 0）
    const defs = [
      { name: 'コピー機へ', points: copier ? [[mid(copier)[0], copier.y0 - 3.5]] : [], dwell: [6, 10] },
      { name: 'コピー機の周りを回る', points: copier ? around(copier, 4) : [], dwell: [0, 0] },
      { name: 'ラウンジ前へ', points: sofa ? [[mid(sofa)[0], sofa.y0 - 11]] : [], dwell: [6, 12] },
      { name: 'ラウンジの東側へ', points: sofa ? [[sofa.x1 + 2.5, sofa.y0 - 1], [sofa.x1 + 2.5, sofa.y1 + 4]] : [], dwell: [4, 8] },
      { name: 'ラウンジの西側へ', points: sofa ? [[sofa.x0 - 2.5, sofa.y0 - 1], [sofa.x0 - 2.5, sofa.y1 + 4]] : [], dwell: [4, 8] },
      { name: 'ソファの裏を通る', points: sofa ? [[sofa.x0, sofa.y1 + 4.5], [sofa.x1, sofa.y1 + 4.5]] : [], dwell: [2, 5] },
      { name: 'ついたての北の端へ', points: wall ? [[mid(wall)[0], wall.y1 + 4]] : [], dwell: [4, 8] },
      { name: 'ついたての南の端へ', points: wall ? [[mid(wall)[0], wall.y0 - 3.5]] : [], dwell: [4, 8] },
      { name: 'ついたての周りを1周', points: wall ? around(wall, 3.5) : [], dwell: [0, 0] },
      { name: '机を1周（東）', points: tables[0] ? loop(tables[0]) : [], dwell: [0, 0] },
      { name: '机を1周（中）', points: tables[1] ? loop(tables[1]) : [], dwell: [0, 0] },
      { name: '机を1周（西）', points: tables[2] ? loop(tables[2]) : [], dwell: [0, 0] },
      { name: '東の机と壁の間の通路', points: [[aisleAW, -6], [aisleAW, -22]], dwell: [2, 5] },
      { name: '中と西の机の間の通路', points: [[aisleBC, -6], [aisleBC, -22]], dwell: [2, 5] },
      { name: '北の廊下を東へ', points: [[bb.x0 + 6, 12], [6, 12]], dwell: [3, 6] },
      { name: '北の廊下を西へ', points: [[bb.x1 - M, bb.y1 - 9], [bb.x0 + 6, bb.y1 - 9]], dwell: [3, 6] },
      { name: '西の端の通路', points: [[bb.x0 + 3, -4], [bb.x0 + 3, -26]], dwell: [3, 6] },
      { name: '南の通路を東西に往復', points: [[bb.x0 + 6, bb.y0 + 2.5], [bb.x1 - 6, bb.y0 + 2.5]], dwell: [2, 5] },
      { name: '北東の隅へ', points: [[bb.x1 - M, bb.y1 - M]], dwell: [4, 8] },
      { name: '北西の隅へ', points: [[bb.x0 + M, bb.y1 - M]], dwell: [4, 8] },
      { name: '南東の隅へ', points: [[bb.x1 - M, bb.y0 + M]], dwell: [4, 8] },
      { name: '南西の隅へ', points: [[bb.x0 + M, bb.y0 + M]], dwell: [4, 8] },
      { name: 'フロア中央をぶらぶら', points: [[-5, 12], [10, -1], [-12, 5]], dwell: [3, 6] },
      { name: 'ラウンジの前を東西に横切る', points: [[6, 3], [bb.x1 - 4, 3]], dwell: [2, 5] },
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
        for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
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

  // ---- 各着席者の、その時刻の姿 ----
  /**
   * @param nowMs 時刻（サーバーの時刻に合わせたもの）
   * @param seated 着席中の席 [{id, since}]
   * @returns Map(席ID → {x, y, yaw, state, t, phase})  state: sit | standup | walk | idle | sitdown
   */
  poses(nowMs, seated) {
    const turn = Math.floor(nowMs / TURN_MS);
    const turnStart = turn * TURN_MS;
    const sec = (nowMs - turnStart) / 1000;
    const out = new Map();
    for (const { id } of seated) {
      const s = this.seats.get(id);
      if (s) out.set(id, { x: s.x, y: s.y, yaw: s.rot, state: 'sit', t: 0, phase: 0 });
    }
    const participants = seated.filter((p) => (p.since ?? 0) <= turnStart && this.seats.has(p.id)).map((p) => p.id).sort((a, b) => a - b);
    for (const a of this.assignments(turn, participants)) {
      if (!out.has(a.seatId)) continue;
      const t = sec - a.start;
      const pose = out.get(a.seatId);
      if (t < 0 || t > a.dur) continue;
      if (t < STAND_UP_S) { pose.state = 'standup'; pose.t = t / STAND_UP_S; continue; }
      if (t > a.dur - STAND_UP_S) { pose.state = 'sitdown'; pose.t = 1 - (t - (a.dur - STAND_UP_S)) / STAND_UP_S; continue; }
      const w = t - STAND_UP_S;                                  // 歩き始めてからの時間
      const { len, dwellDist } = a.path;
      let dist, state = 'walk';
      if (dwellDist < 0) dist = Math.min(len, w * this.speed);   // 立ち止まらないルート（1周）
      else {
        const toDwell = dwellDist / this.speed;                  // 最後の目的地に着くまでの時間
        if (w < toDwell) dist = w * this.speed;
        else if (w < toDwell + a.dwell) { dist = dwellDist; state = 'idle'; }
        else dist = Math.min(len, dwellDist + (w - toDwell - a.dwell) * this.speed);
      }
      const at = this.at(a.path, dist);
      pose.x = at.x; pose.y = at.y; pose.yaw = at.yaw; pose.state = state; pose.t = 0;
      pose.phase = (dist / this.stride) * Math.PI;
    }
    return out;
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
