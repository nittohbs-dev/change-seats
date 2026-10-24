// 分身の動き（web/office-nav.js）の試験。実行: node tools/test-nav.mjs
//  1. すべての「席 × ルート」の道が、家具を貫通しないか
//  2. 同時に同じルートを歩く分身がいないか／1人が同時に2か所にいないか／1ターンに収まるか
//  3. 別々に作った計算（別の端末を想定）で、同じ時刻なら同じ位置になるか
import { readFileSync } from 'node:fs';
import { OfficeNav, TURN_MS, speechAt, SPEECH_SLOT_S, SPEECH_SHOW_S } from '../web/office-nav.js';
import { LINES } from '../web/office-lines.js';

const read = (f) => JSON.parse(readFileSync(new URL('../web/' + f, import.meta.url), 'utf8'));
const layout = read('office-layout.json'), seatsData = read('office-seats.json');
const nav = new OfficeNav(layout, seatsData);
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'NG   ') + msg); if (!ok) failed++; };

// ---- 0. ルートと席の準備 ----
console.log('ルート:'); for (const r of nav.routes) console.log(`  ${r.id} ${r.name}: 目的地 ${r.points.length} 点`);
check(nav.routes.length === 24, `ルートが24本ある（${nav.routes.length}本）`);
check(seatsData.seats.length === 24, `席が24席ある（${seatsData.seats.length}席）`);
const noStand = [...nav.stands].filter(([, p]) => !p).map(([id]) => id);
check(noStand.length === 0, `すべての席に、椅子から立つ場所がある（なし: ${noStand.join(',') || '0席'}）`);

// ---- 1. 貫通しないか ----
let pairs = 0, noPath = [], touching = 0, minClear = Infinity;
const rects = layout.items;
const distToRects = (x, y) => Math.min(...rects.map((it) => Math.hypot(Math.max(it.x0 - x, 0, x - it.x1), Math.max(it.y0 - y, 0, y - it.y1))));
for (const seat of seatsData.seats) {
  for (const rt of nav.routes) {
    const p = nav.pathFor(seat.id, rt.id);
    pairs++;
    if (!p) { noPath.push(`${seat.id}×${rt.id}`); continue; }
    // 椅子から立つ最初の区間と、座る最後の区間は、自分の椅子の中を通るので除く
    for (let k = 1; k < p.pts.length - 2; k++) {
      const [a, b] = [p.pts[k], p.pts[k + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
      for (let i = 0; i <= n; i++) {
        const x = a[0] + (b[0] - a[0]) * i / n, y = a[1] + (b[1] - a[1]) * i / n;
        const d = distToRects(x, y);
        minClear = Math.min(minClear, d);
        if (d <= 0) touching++;
      }
    }
  }
}
check(touching === 0, `道が家具・壁の中を通らない（家具の中を通った点: ${touching}。最も近づいた距離: ${minClear.toFixed(2)}）`);
check(noPath.length === 0, `すべての席×ルート（${pairs}組）に道がある（道なし: ${noPath.length}組 ${noPath.slice(0, 8).join(' ')}）`);
const longest = Math.max(...seatsData.seats.flatMap((s) => nav.routes.map((r) => nav.pathFor(s.id, r.id)?.len ?? 0)));
console.log(`     最長の道: ${(longest / nav.speed).toFixed(1)} 秒ぶん`);

// ---- 2. 同時に同じルートがないか ----
const ids = seatsData.seats.map((s) => s.id);
let overlap = 0, twice = 0, overrun = 0, walkers = 0, samples = 0, minGap = Infinity;
for (const subset of [ids, ids.filter((i) => i % 2), ids.slice(0, 5), ids.slice(0, 1)]) {
  const seated = subset.map((id) => ({ id, since: 0 }));
  for (let turn = 1000; turn < 1030; turn++) {
    const asg = nav.assignments(turn, subset);
    const rs = asg.map((a) => a.routeId), ss = asg.map((a) => a.seatId);
    if (new Set(rs).size !== rs.length) overlap++;
    if (new Set(ss).size !== ss.length) twice++;
    if (asg.some((a) => a.start + a.dur > TURN_MS / 1000)) overrun++;
    for (let t = 0; t < TURN_MS; t += 500) {
      const poses = nav.poses(turn * TURN_MS + t, seated);
      const moving = [...poses].filter(([, p]) => p.state !== 'sit');
      walkers += moving.length; samples++;
      for (let i = 0; i < moving.length; i++) for (let j = i + 1; j < moving.length; j++)
        minGap = Math.min(minGap, Math.hypot(moving[i][1].x - moving[j][1].x, moving[i][1].y - moving[j][1].y));
    }
  }
}
check(overlap === 0, `同じターンに、同じルートを歩く人がいない（重なり: ${overlap}）`);
check(twice === 0, `1人が同じターンに2つのルートを歩かない（重複: ${twice}）`);
check(overrun === 0, `すべての動きが1ターン（60秒）に収まる（はみ出し: ${overrun}）`);
console.log(`     平均で同時に動いている人: ${(walkers / samples).toFixed(1)} 人（歩いている人どうしが最も近づいた距離: ${minGap.toFixed(1)}）`);

// ---- 3. 別々に計算しても同じ動きか ----
const nav2 = new OfficeNav(read('office-layout.json'), read('office-seats.json'));
let diff = 0;
const seatedAll = ids.map((id) => ({ id, since: 0 }));
for (let t = 0; t < 5 * TURN_MS; t += 700) {
  const a = nav.poses(1700000000000 + t, seatedAll), b = nav2.poses(1700000000000 + t, seatedAll);
  for (const [id, p] of a) { const q = b.get(id); if (p.x !== q.x || p.y !== q.y || p.state !== q.state) diff++; }
}
check(diff === 0, `別々に作った計算でも、同じ時刻は同じ位置・同じ動きになる（違い: ${diff}）`);

// ---- 4. 途中で人が帰っても、他の人の動きがあまり変わらないか ----
let changed = 0, total = 0;
for (let turn = 2000; turn < 2030; turn++) {
  const full = nav.assignments(turn, ids), less = nav.assignments(turn, ids.filter((i) => i !== 7));
  for (const a of full) { if (a.seatId === 7) continue; total++; const b = less.find((x) => x.routeId === a.routeId); if (!b || b.seatId !== a.seatId) changed++; }
}
console.log(`     1人が帰った時に、他の人の割り当てが変わった割合: ${(100 * changed / Math.max(1, total)).toFixed(0)}%`);

// ---- 5. 吹き出し（セリフ） ----
const T0 = 1700000000000;
const heard = new Set(); let gaps = [], lastEnd = null, speakingMs = 0, spTotal = 0, badRange = 0, simult = 0, maxSimult = 0;
for (let t = 0; t < 6 * 3600 * 1000; t += 1000) {              // 6時間ぶん、1秒刻みで1人を観察
  const i = speechAt(T0 + t, 3, LINES.length);
  spTotal++;
  if (i >= LINES.length || i < -1) badRange++;
  if (i >= 0) { heard.add(i); speakingMs++; if (lastEnd !== null && t - lastEnd > 1000) gaps.push((t - lastEnd) / 1000); lastEnd = t; }
}
check(badRange === 0, `セリフの番号が範囲内（0〜${LINES.length - 1}）`);
check(heard.size >= LINES.length * 0.9, `${LINES.length}個のセリフのうち、6時間で ${heard.size} 個が選ばれる（ほぼ全部が出番を持つ）`);
check(speakingMs / spTotal > 0.03 && speakingMs / spTotal < 0.2, `話している時間の割合が適度（${(100 * speakingMs / spTotal).toFixed(1)}%）`);
const gmin = Math.min(...gaps), gmax = Math.max(...gaps);
check(gmax - gmin > 30, `話す間隔が不定期（最短 ${gmin.toFixed(0)} 秒 〜 最長 ${gmax.toFixed(0)} 秒）`);
for (let t = 0; t < 3600 * 1000; t += 1000) {                 // 21人が同時に話す人数
  let n = 0; for (const id of ids) if (speechAt(T0 + t, id, LINES.length) >= 0) n++;
  maxSimult = Math.max(maxSimult, n); simult += n;
}
console.log(`     21人のうち同時に話している人: 平均 ${(simult / 3600).toFixed(1)} 人、最大 ${maxSimult} 人。1回の表示は ${SPEECH_SHOW_S} 秒`);
let sdiff = 0;
for (let t = 0; t < 600000; t += 700) for (const id of ids) if (speechAt(T0 + t, id, LINES.length) !== speechAt(T0 + t, id, LINES.length)) sdiff++;
check(sdiff === 0, '同じ時刻なら、同じ人が同じセリフを話す（全端末で同じ吹き出し）');

// ---- 6. 24人が座っている時 ----
{
  const full = ids.map((id) => ({ id, since: 0 }));
  const used = new Set(); let walkSum = 0, walkMax = 0, n = 0;
  for (let turn = 5000; turn < 5040; turn++) {
    for (const a of nav.assignments(turn, ids)) used.add(a.routeId);
    for (let t = 0; t < TURN_MS; t += 1000) {
      const moving = [...nav.poses(turn * TURN_MS + t, full)].filter(([, p]) => p.state !== 'sit').length;
      walkSum += moving; walkMax = Math.max(walkMax, moving); n++;
    }
  }
  check(used.size === 24, `40ターンのうちに、24本すべてのルートが使われる（使われたルート: ${used.size}本）`);
  console.log(`     24人が座っている時、同時に歩いている人: 平均 ${(walkSum / n).toFixed(1)} 人、最大 ${walkMax} 人`);
  // ターンの切り替わりで、道の計算に時間がかかってカクつかないか（先に計算しておいた時／していない時）
  const cold = new OfficeNav(read('office-layout.json'), read('office-seats.json'));
  let t0 = performance.now(); cold.assignments(9001, ids); const coldMs = performance.now() - t0;
  const warm = new OfficeNav(read('office-layout.json'), read('office-seats.json'));
  t0 = performance.now(); let slices = 0; while (warm.warmUp(3) > 0) slices++; const warmAll = performance.now() - t0;
  t0 = performance.now(); warm.assignments(9001, ids); const warmMs = performance.now() - t0;
  console.log(`     ターン切り替わりの計算: 先に計算なし ${coldMs.toFixed(0)} ミリ秒 / 先に計算あり ${warmMs.toFixed(1)} ミリ秒（先に計算するのに全部で ${warmAll.toFixed(0)} ミリ秒、${slices + 1} 回に分けて）`);
  check(warmMs < 20, 'あらかじめ道を計算しておけば、ターンの切り替わりは20ミリ秒未満');
}

console.log(failed ? `\n${failed} 件が失敗` : '\nすべて合格');
process.exit(failed ? 1 : 0);
