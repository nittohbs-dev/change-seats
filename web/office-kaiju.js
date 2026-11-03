// 怪獣「モリザウルス」：怪獣ボタンを押すと、北の窓の外に巨大な上半身が現れ、口からビームを出してオフィスを壊す。3分後に元に戻る。
// - すべて「ボタンが押されてからの秒数」だけで決まる（乱数も、家具の順番と番号から作る）ので、全員の画面で同じ場面になる。
// - 時刻表は office-nav.js の KAIJU（分身が逃げる時刻と共通）。
// - 壊れ方：机・椅子などは吹き飛んで倒れ、壁は傾いて崩れ落ちる。焦げて黒くなり、破片・炎・煙が出る。床には焦げ跡が残る。
// 座標：Blender の床の平面 (x, y) は、画面の (x, -y)。床の上面が高さ 0。
import * as THREE from 'three';
import { KAIJU, hash32 } from '/static/office-nav.js';

const rnd = (...n) => hash32(...n) / 4294967296;                 // 0 以上 1 未満（どの端末でも同じ）
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

// 怪獣の位置（Blender 座標。北の壁の外）と、ビームがなぞる道（Blender 座標。オフィスの北から南へジグザグ）
const MONSTER_AT = [-4, 64];
const MONSTER_SCALE = 0.85;   // 怪獣の大きさ（1 で頭のてっぺんまで約10m）
const REST_DROP = 3;          // 出きった時も、これだけ（m）地面に沈めておく（いつもの視点で頭まで画面に入るように）
const BEAM_PATH = [[12, 38], [-50, 32], [-50, 14], [30, 12], [30, -5], [-52, -6], [-48, -22], [35, -22]];
const COLORS = { body: 0x5aa85f, belly: 0xcfe8a8, plate: 0x8fd36b, brow: 0x2f5e33, claw: 0xfaf6ea,
                 beamCore: 0xffffff, beamGlow: 0xff4fd8, burnt: 0x2a2320, ember: 0xff7a1a, smoke: 0x6b6460, debris: 0x7a6f66 };

/**
 * @param scene     オフィスの Scene
 * @param model     office.glb の Scene（壊す家具・壁はこの子）
 * @param floorMesh 床（壊さない）
 * @param k         1メートルあたりの長さ
 */
export function createKaiju({ scene, model, floorMesh, k }) {
  let built = null;          // 初めて現れる時に作る
  let active = false;        // 今、壊れた状態などを表示しているか

  // ---- ビームの道（画面の座標） ----
  const path = BEAM_PATH.map(([x, y]) => new THREE.Vector3(x, 0, -y));
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
  const pathLen = cum[cum.length - 1];
  const beamTarget = (u) => {                                    // u: 0〜1（道の上の割合）
    const d = clamp01(u) * pathLen;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return path[i - 1].clone().lerp(path[i], f);
  };
  /** 点 p（画面の xz）に、ビームがいちばん近づく道の割合 */
  const nearestU = (p) => {
    let best = Infinity, bu = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], ab = b.clone().sub(a), t = clamp01(p.clone().sub(a).dot(ab) / ab.lengthSq());
      const q = a.clone().addScaledVector(ab, t), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < best) { best = d; bu = (cum[i - 1] + t * (cum[i] - cum[i - 1])) / pathLen; }
    }
    return bu;
  };
  const beamTime = (u) => KAIJU.BEAM_FROM + u * (KAIJU.BEAM_TO - KAIJU.BEAM_FROM);

  function build() {
    model.updateMatrixWorld(true);
    const monsterPos = new THREE.Vector3(MONSTER_AT[0], 0, -MONSTER_AT[1]);
    // ---- 壊れるもの（office.glb の家具・壁。床は除く） ----
    const parts = [];
    model.children.forEach((node, i) => {
      if (node === floorMesh) return;
      const box = new THREE.Box3().setFromObject(node);
      if (box.isEmpty()) return;
      node.updateMatrix();
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const kind = node.name.replace(/^mat_/, '').replace(/_\d+$/, '');
      const wall = kind === 'wall' || size.y > 8 * k / 5.74 * 1.0 && Math.max(size.x, size.z) > 6;
      const hit = beamTime(nearestU(c)) + rnd(i, 3) * 0.3;
      // 吹き飛ぶ向き：怪獣から離れる向きに、少しばらつかせる
      const away = c.clone().sub(monsterPos).setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (rnd(i, 5) - 0.5) * 1.2);
      parts.push({
        node, i, c, size, wall, hit, away,
        local: c.clone().sub(model.position),                    // 親（model）の中での中心（model は上下に動かしているだけ）
        orig: node.matrix.clone(),
        push: (2 + rnd(i, 7) * 4) * k / 5.74 * (wall ? 0.15 : 1),
        tilt: wall ? (rnd(i, 11) < 0.5 ? -1 : 1) * (0.18 + rnd(i, 13) * 0.15) : 1.0 + rnd(i, 17) * 0.6,
        burnt: null,
      });
    });
    // ---- 破片・炎・煙・焦げ跡（まとめて描く） ----
    const chunks = [];
    for (const p of parts) {
      const n = p.wall ? 8 : 4;
      for (let j = 0; j < n && chunks.length < 900; j++) {
        const s = (0.35 + rnd(p.i, j, 19) * 0.9) * k / 5.74 * (p.wall ? 1.6 : 1);
        chunks.push({
          p, s,
          from: p.c.clone().add(new THREE.Vector3((rnd(p.i, j, 23) - 0.5) * p.size.x * 0.8, (rnd(p.i, j, 29) - 0.3) * p.size.y * 0.6, (rnd(p.i, j, 31) - 0.5) * p.size.z * 0.8)),
          v: new THREE.Vector3((rnd(p.i, j, 37) - 0.5) * 14, 6 + rnd(p.i, j, 41) * 10, (rnd(p.i, j, 43) - 0.5) * 14).addScaledVector(p.away, 6),
          spin: new THREE.Vector3(rnd(p.i, j, 47), rnd(p.i, j, 53), rnd(p.i, j, 59)).multiplyScalar(8),
          color: new THREE.Color(rnd(p.i, j, 61) < 0.5 ? COLORS.debris : COLORS.burnt),
        });
      }
    }
    const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), chunks.length);
    chunks.forEach((c, j) => debris.setColorAt(j, c.color));
    debris.castShadow = true;
    const fires = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1.6, 7), new THREE.MeshBasicMaterial({ color: COLORS.ember, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), parts.length);
    const smokes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: COLORS.smoke, transparent: true, opacity: 0.22, depthWrite: false, roughness: 1 }), parts.length);
    const scorchPts = [];
    for (let d = 0; d <= pathLen; d += 3) scorchPts.push({ at: beamTarget(d / pathLen), t: beamTime(d / pathLen), s: (2.2 + rnd(d | 0, 67) * 1.6) * k / 5.74 });
    const scorch = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1c1714, transparent: true, opacity: 0.7, depthWrite: false }), scorchPts.length);
    for (const m of [debris, fires, smokes, scorch]) { m.frustumCulled = false; m.count = 0; scene.add(m); }

    // ---- ビーム（白い芯と、ピンクの光）と、当たったところの光 ----
    const beamGroup = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 12, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: COLORS.beamCore }));
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1, 16, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: COLORS.beamGlow, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beamGroup.add(core, glow);
    const impact = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd0f4, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    const light = new THREE.PointLight(0xff7ad9, 0, 90 * k / 5.74, 1.5);
    beamGroup.visible = impact.visible = false;
    scene.add(beamGroup, impact, light);

    const monster = makeMonster();
    monster.root.position.copy(monsterPos);
    monster.root.scale.setScalar(k * MONSTER_SCALE);
    monster.root.visible = false;
    scene.add(monster.root);
    return { parts, chunks, debris, fires, smokes, scorchPts, scorch, beamGroup, core, glow, impact, light, monster };
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);

  /** 壊れた姿の行列：中心を軸に、吹き飛ばして・倒して・沈める */
  function brokenMatrix(p, t) {
    const u = (t - p.hit) / (p.wall ? 1.6 : 0.9);
    if (u <= 0) {
      // 壁は、崩れる直前に少し震える
      if (p.wall && u > -0.35) return m4.makeTranslation(Math.sin(t * 60) * 0.12, 0, Math.cos(t * 53) * 0.12).multiply(p.orig);
      return null;
    }
    const f = ease(u);
    let axis, ang, dx, dy, dz;
    if (p.wall) {
      axis = p.size.x > p.size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      ang = p.tilt * f;
      dx = p.away.x * p.push * f; dz = p.away.z * p.push * f;
      dy = -p.size.y * 0.45 * f;
    } else {
      axis = new THREE.Vector3(-p.away.z, 0, p.away.x);          // 吹き飛ぶ向きに倒れる
      ang = p.tilt * f;
      dx = p.away.x * p.push * f; dz = p.away.z * p.push * f;
      dy = Math.sin(Math.PI * Math.min(1, u)) * 3 * k / 5.74 - p.size.y * 0.22 * f;
    }
    q.setFromAxisAngle(axis, ang);
    const back = new THREE.Matrix4().makeTranslation(-p.local.x, -p.local.y, -p.local.z);
    const rot = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const fwd = new THREE.Matrix4().makeTranslation(p.local.x + dx, p.local.y + dy, p.local.z + dz);
    return m4.copy(fwd).multiply(rot).multiply(back).multiply(p.orig);
  }

  /** 当たったものを焦がす（マテリアルを複製して黒っぽくする。元に戻す時は元のマテリアルへ） */
  function burn(p, t) {
    if (!p.burnt) {
      p.burnt = [];
      p.node.traverse((o) => {
        if (!o.isMesh) return;
        const orig = o.material;
        const list = (Array.isArray(orig) ? orig : [orig]).map((mm) => {
          const c = mm.clone();
          if (c.color) c.color.lerp(new THREE.Color(COLORS.burnt), 0.6);
          if (c.emissive) c.emissive.set(COLORS.ember);
          return c;
        });
        o.material = Array.isArray(orig) ? list : list[0];
        p.burnt.push({ o, orig, list });
      });
    }
    const glowAmt = Math.max(0, 1 - (t - p.hit) / 3);           // 当たった直後は赤く光り、だんだん消える
    for (const b of p.burnt) for (const mm of b.list) if (mm.emissive) mm.emissiveIntensity = glowAmt * 0.9;
  }

  function restore() {
    if (!built) return;
    for (const p of built.parts) {
      p.node.matrix.copy(p.orig);
      p.node.matrix.decompose(p.node.position, p.node.quaternion, p.node.scale);
      p.node.matrixAutoUpdate = true;
      if (p.burnt) {
        for (const b of p.burnt) { b.o.material = b.orig; for (const mm of b.list) mm.dispose(); }
        p.burnt = null;
      }
    }
    for (const mesh of [built.debris, built.fires, built.smokes, built.scorch]) mesh.count = 0;
    built.beamGroup.visible = built.impact.visible = false;
    built.light.intensity = 0;
    built.monster.root.visible = false;
    active = false;
  }

  /**
   * @param t 怪獣ボタンが押されてからの秒数。暴れていなければ null
   * @returns 画面の揺れの大きさ（0 以上。見ている視点を、この分だけ揺らす）
   */
  function update(t) {
    if (t == null || t < 0 || t >= KAIJU.RESTORE_S) { if (active) restore(); return 0; }
    built ??= build();
    active = true;
    const B = built, K = KAIJU;

    // ---- 怪獣：せり上がる → 吠える → ビーム → 沈む ----
    const mon = B.monster;
    const rise = ease(t / K.RISE_S), sink = ease((t - K.SINK_FROM) / (K.SINK_TO - K.SINK_FROM));
    mon.root.visible = t < K.SINK_TO;
    mon.root.position.y = (-REST_DROP - 16 * (1 - rise) - 18 * sink) * k;
    mon.root.rotation.z = Math.sin(t * 1.3) * 0.03;
    mon.body.scale.y = 1 + Math.sin(t * 2.2) * 0.015;            // 息づかい
    const beaming = t >= K.BEAM_FROM && t < K.BEAM_TO;
    const target = beamTarget((t - K.BEAM_FROM) / (K.BEAM_TO - K.BEAM_FROM));
    let jaw = 0.05, headUp = Math.sin(t * 0.9) * 0.08, look = Math.sin(t * 0.6) * 0.3;
    if (t >= K.ROAR_S && t < K.BEAM_FROM) {                      // 吠える・ためる
      const r = (t - K.ROAR_S) / (K.BEAM_FROM - K.ROAR_S);
      jaw = 0.55 * Math.sin(Math.PI * Math.min(1, r * 1.2)) + 0.3 * r; headUp = -0.45 * Math.sin(Math.PI * r);
    }
    if (beaming || (t >= K.BEAM_FROM - 0.2 && t < K.BEAM_TO + 0.3)) {
      // ビームの当たる所へ顔を向ける
      mon.head.updateWorldMatrix(true, false);
      const hp = mon.head.getWorldPosition(v);
      const dx = target.x - hp.x, dz = target.z - hp.z, dy = target.y - hp.y;
      look = Math.atan2(dx, dz); headUp = -Math.atan2(dy, Math.hypot(dx, dz)) - 0.1; jaw = 0.5;
    }
    mon.head.rotation.set(headUp, look, 0);
    mon.jaw.rotation.x = jaw;
    const charge = t >= K.ROAR_S && t < K.BEAM_TO ? Math.min(1, (t - K.ROAR_S) / (K.BEAM_FROM - K.ROAR_S)) : 0;
    mon.mouthGlow.scale.setScalar(0.2 + charge * (beaming ? 1.2 + Math.sin(t * 40) * 0.15 : 0.9));
    mon.mouthGlow.visible = charge > 0;
    mon.armL.rotation.x = mon.armR.rotation.x = -0.6 - (t > K.BEAM_TO && t < K.SINK_FROM ? 0.6 + Math.sin(t * 6) * 0.3 : 0);

    // ---- ビーム ----
    B.beamGroup.visible = B.impact.visible = beaming;
    B.light.intensity = beaming ? 4 + Math.sin(t * 30) : 0;
    if (beaming) {
      const mp = mon.mouthGlow.getWorldPosition(new THREE.Vector3());
      const len = mp.distanceTo(target);
      B.beamGroup.position.copy(mp);
      B.beamGroup.lookAt(target);
      const w = (1 + Math.sin(t * 35) * 0.12) * k / 5.74;
      B.core.scale.set(w, w, len);
      B.glow.scale.set(w * 1.3, w * 1.3, len);
      B.impact.position.copy(target).setY(0.6 * k / 5.74);
      B.impact.scale.setScalar((3 + Math.sin(t * 25) * 0.6) * k / 5.74);
      B.light.position.copy(target).setY(4 * k / 5.74);
    }

    // ---- 家具・壁が壊れる ----
    for (const p of B.parts) {
      const mat = brokenMatrix(p, t);
      if (mat) { p.node.matrixAutoUpdate = false; p.node.matrix.copy(mat); p.node.matrixWorldNeedsUpdate = true; }
      else if (!p.node.matrixAutoUpdate) { p.node.matrix.copy(p.orig); p.node.matrixWorldNeedsUpdate = true; }
      if (t >= p.hit) burn(p, t);
    }
    // 破片：放物線で飛んで、床で止まる
    const g = 30 * k / 5.74, floorY = 0.25 * k / 5.74;
    let n = 0;
    for (const c of B.chunks) {
      const tau = t - c.p.hit;
      if (tau < 0) continue;
      const tl = (c.v.y + Math.sqrt(c.v.y * c.v.y + 2 * g * Math.max(0, c.from.y - floorY))) / g;   // 床に着く時刻
      const s = Math.min(tau, tl);
      v.set(c.from.x + c.v.x * s * 0.6, Math.max(floorY, c.from.y + c.v.y * s - 0.5 * g * s * s), c.from.z + c.v.z * s * 0.6);
      e.set(c.spin.x * s, c.spin.y * s, c.spin.z * s);
      B.debris.setMatrixAt(n, m4.compose(v, q.setFromEuler(e), new THREE.Vector3(c.s, c.s * 0.6, c.s * 0.8)));
      B.debris.setColorAt(n, c.color);
      n++;
    }
    B.debris.count = n;
    B.debris.instanceMatrix.needsUpdate = true;
    if (B.debris.instanceColor) B.debris.instanceColor.needsUpdate = true;
    // 炎（当たってから 8 秒）と煙（14 秒）
    let nf = 0, ns = 0;
    for (const p of B.parts) {
      const tau = t - p.hit;
      if (tau < 0) continue;
      if (tau < 8) {
        const s = (1.2 + Math.sin(t * 13 + p.i) * 0.25) * Math.min(1, tau * 3) * (1 - tau / 8) * k / 5.74 * (p.wall ? 2.4 : 1.6);
        B.fires.setMatrixAt(nf++, m4.compose(v.set(p.c.x, Math.min(p.c.y, 2 * k / 5.74) + s * 0.6, p.c.z), q.identity(), new THREE.Vector3(s, s * 1.4, s)));
      }
      // 煙は1つの家具に1つ、10秒で消える（多すぎると部屋が見えなくなる）
      for (let j = 0; j < 1 && tau < 10; j++) {
        const tt = tau;
        const fade = Math.min(1, tt) * Math.min(1, (10 - tau) / 3);
        const s = (1.0 + tt * 0.45) * fade * k / 5.74 * (p.wall ? 1.3 : 0.9);
        B.smokes.setMatrixAt(ns++, m4.compose(v.set(p.c.x + Math.sin(tt + j) * 2, p.c.y + (2 + tt * 2.2) * k / 5.74, p.c.z + tt * 0.6), q.identity(), one.clone().multiplyScalar(s)));
      }
    }
    B.fires.count = nf; B.fires.instanceMatrix.needsUpdate = true;
    B.smokes.count = ns; B.smokes.instanceMatrix.needsUpdate = true;
    // 焦げ跡：ビームが通った所に残る
    let nsc = 0;
    for (const s of B.scorchPts) {
      if (t < s.t) continue;
      B.scorch.setMatrixAt(nsc++, m4.compose(v.set(s.at.x, 0.03 * k / 5.74, s.at.z), q.identity(), new THREE.Vector3(s.s, 1, s.s)));
    }
    B.scorch.count = nsc; B.scorch.instanceMatrix.needsUpdate = true;

    // ---- 画面の揺れ ----
    if (t < K.RISE_S) return 0.6 * (1 - t / K.RISE_S) + 0.3;
    if (t < K.BEAM_FROM) return 0.35;
    if (beaming) return 0.8;
    if (t < K.BEAM_TO + 2) return 0.5 * (1 - (t - K.BEAM_TO) / 2);
    if (t >= K.SINK_FROM && t < K.SINK_TO) return 0.3;
    return 0;
  }

  return { update, restore };
}

/**
 * オリジナルの怪獣「モリザウルス」（単位はメートル。呼ぶ側で k 倍する）。
 * 丸みのある緑の体に、明るいお腹、背中に葉っぱのような板、大きな目と困り眉、短い腕。口は開け閉めでき、口の中が光る。
 */
function makeMonster() {
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra });
  const body = mat(COLORS.body), belly = mat(COLORS.belly), plate = mat(COLORS.plate), white = mat(0xffffff, { roughness: 0.3 }),
        black = mat(0x1d1d1d, { roughness: 0.3 }), brow = mat(COLORS.brow), claw = mat(COLORS.claw);
  const mesh = (parent, geo, m, x, y, z, s = null, r = null) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    if (s) o.scale.set(...s);
    if (r) o.rotation.set(...r);
    o.castShadow = false;
    parent.add(o);
    return o;
  };
  const root = new THREE.Group();
  // 胴体：下が太く、上へ向かって首へ細くなる（地面の下まで続く）
  const outline = new THREE.SplineCurve([[0, -9], [3.3, -9], [3.7, -5], [3.6, -1], [3.2, 2], [2.6, 4.5], [2.0, 6], [1.7, 7.2], [0, 7.4]]
    .map(([r, y]) => new THREE.Vector2(r, y)));
  const torso = mesh(root, new THREE.LatheGeometry(outline.getPoints(30), 30), body, 0, 0, 0);
  mesh(torso, new THREE.SphereGeometry(1, 24, 16), belly, 0, -0.5, 2.7, [2.6, 5.2, 1.2]);
  // 背中の葉っぱのような板（上から下へ）
  for (let i = 0; i < 6; i++) {
    const s = 1.1 + Math.sin((i / 5) * Math.PI) * 0.7;
    mesh(torso, new THREE.SphereGeometry(1, 14, 10), plate, 0, 6.6 - i * 1.9, -1.9 - Math.sin((i / 5) * Math.PI) * 1.2, [0.22, s * 1.3, s * 0.9], [-0.25, 0, 0]);
  }
  // 腕：短く太い。爪は白
  const arm = (sx) => {
    const a = new THREE.Group();
    a.position.set(sx * 3.1, 3.4, 1.0);
    torso.add(a);
    mesh(a, new THREE.CapsuleGeometry(0.75, 2.4, 6, 12), body, 0, -1.4, 0.4, null, [0.35, 0, sx * 0.25]);
    const hand = mesh(a, new THREE.SphereGeometry(0.85, 14, 10), body, sx * 0.4, -2.8, 1.1);
    for (let j = -1; j <= 1; j++) mesh(hand, new THREE.ConeGeometry(0.18, 0.6, 8), claw, j * 0.35, -0.2, 0.8, null, [Math.PI / 2, 0, 0]);
    return a;
  };
  const armL = arm(-1), armR = arm(1);
  // 頭：丸い頭と、前に出た口。下あごは開け閉めできる
  const head = new THREE.Group();
  head.position.set(0, 7.9, 0.4);
  torso.add(head);
  mesh(head, new THREE.SphereGeometry(1.9, 24, 18), body, 0, 0.3, 0, [1, 0.88, 1.12]);
  mesh(head, new THREE.SphereGeometry(1.35, 20, 14), body, 0, -0.2, 1.8, [1, 0.68, 1.25]);
  for (let j = 0; j < 6; j++) mesh(head, new THREE.ConeGeometry(0.13, 0.4, 6), claw, -0.75 + j * 0.3, -0.75, 2.5 - Math.abs(j - 2.5) * 0.12, null, [Math.PI, 0, 0]);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.65, 0.6);
  head.add(jaw);
  mesh(jaw, new THREE.SphereGeometry(1.2, 18, 12), belly, 0, -0.25, 1.15, [1, 0.38, 1.3]);
  const mouthGlow = mesh(head, new THREE.SphereGeometry(0.6, 16, 12),
    new THREE.MeshBasicMaterial({ color: COLORS.beamGlow, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), 0, -0.55, 2.2);
  for (const sx of [-1, 1]) {
    mesh(head, new THREE.SphereGeometry(0.5, 16, 12), white, sx * 0.85, 0.75, 1.35);
    mesh(head, new THREE.SphereGeometry(0.24, 12, 8), black, sx * 0.8, 0.72, 1.78);
    mesh(head, new THREE.BoxGeometry(0.9, 0.18, 0.3), brow, sx * 0.85, 1.35, 1.45, null, [0, 0, sx * -0.35]);   // 怒った眉
  }
  return { root, body: torso, head, jaw, mouthGlow, armL, armR };
}
