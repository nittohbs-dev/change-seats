// 座っている人の机の上のノートパソコンと、それで仕事をする腕の角度
// - 置き場所：席の正面へ少しずつ進みながら真下を調べ、最初に当たった机（table・side_table）の手前の縁から少し奥に置く。
//   長机・カフェのテーブル・ソファの前のテーブルのどれでも、高さと距離が自動で合う
// - 小さいテーブルを2人で使う席（カフェの椅子とソファ）は、ぶつからないように左右へ少しずらす
// - 長さの単位はメートル（× k）。ノートパソコンの向きは、席の向き（local +z ＝ 正面）にそろえる
import * as THREE from 'three';

const W = 0.31, D = 0.22, OPEN = 1.85;     // 幅・奥行き（m）、画面の開き（ラジアン。0で閉じる）
const ARM = 0.54;                          // 肩から手の中心までの長さ（m。office-avatar.js の腕）
const TABLE = /^(mat_)?(side_)?table/;

/**
 * seats は office-view.js の席（id → {pos, rot, ...}）。model は床にそろえたあとのオフィス。
 * 戻り値：spot(id)（置く場所。机がなければ null）、make(id)（ノートパソコンの Group）、arms(id, hip)（打つ時の腕の角度）
 */
export function createLaptops(model, seats, k) {
  const tables = [];
  model.updateMatrixWorld(true);
  model.traverse((o) => { if (o.isMesh && (TABLE.test(o.name) || TABLE.test(o.parent?.name ?? ''))) tables.push(o); });
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const forward = (s) => new THREE.Vector3(Math.sin(s.rot), 0, Math.cos(s.rot));
  const right = (s) => new THREE.Vector3(Math.cos(s.rot), 0, -Math.sin(s.rot));
  /** 席の正面 d（m）の真下の、机の上面の高さ（なければ null） */
  const tableAt = (s, d) => {
    const p = s.pos.clone().addScaledVector(forward(s), d * k);
    ray.set(new THREE.Vector3(p.x, s.pos.y + 0.9 * k, p.z), down);
    const hit = ray.intersectObjects(tables, false).find((h) => h.point.y > s.pos.y - 0.25 * k);
    return hit ? hit.point.y : null;
  };

  const spots = new Map();
  for (const [id, s] of seats) {
    let edge = null;
    for (let d = 0.15; d <= 1.3 && edge == null; d += 0.03) if (tableAt(s, d) != null) edge = d;
    if (edge == null) continue;
    let dist = edge + D / 2 + 0.05;
    let y = tableAt(s, dist);
    if (y == null) { dist = edge + 0.02; y = tableAt(s, dist); }
    if (y == null) continue;
    spots.set(id, { pos: s.pos.clone().setY(y).addScaledVector(forward(s), dist * k), dist, y, side: 0 });
  }
  // 近すぎる2台（同じ小さいテーブルを向かい合って使う席）は、左右へ反対にずらす
  const ids = [...spots.keys()].sort((a, b) => a - b);
  for (const a of ids) for (const b of ids) {
    if (a >= b) continue;
    const pa = spots.get(a), pb = spots.get(b);
    if (pa.pos.distanceTo(pb.pos) < 0.4 * k) {
      pa.pos.addScaledVector(right(seats.get(a)), 0.09 * k); pa.side += 0.09;
      pb.pos.addScaledVector(right(seats.get(b)), 0.09 * k); pb.side += 0.09;
    }
  }

  // 形と色は全員で共有する（席を立っても消さないので、捨てない）
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9bdc5, roughness: 0.35, metalness: 0.6 });
  const keys = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.85 });
  const screen = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: screenTexture(), emissiveIntensity: 0.85, roughness: 0.4 });
  const geo = {
    base: new THREE.BoxGeometry(W * k, 0.016 * k, D * k),
    keyboard: new THREE.PlaneGeometry(W * 0.84 * k, D * 0.48 * k),
    pad: new THREE.PlaneGeometry(W * 0.3 * k, D * 0.22 * k),
    lid: new THREE.BoxGeometry(W * k, 0.01 * k, D * k),
    display: new THREE.PlaneGeometry(W * 0.9 * k, D * 0.84 * k),
  };
  const part = (parent, g, m, x, y, z) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x * k, y * k, z * k);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  return {
    spot: (id) => spots.get(id) ?? null,

    /** ノートパソコン：手前（-z）にキーボード、奥（+z）の蝶番から画面を開く */
    make(id) {
      const sp = spots.get(id), s = seats.get(id);
      if (!sp) return null;
      const g = new THREE.Group();
      g.position.copy(sp.pos);
      g.rotation.y = s.rot;
      part(g, geo.base, metal, 0, 0.008, 0);
      part(g, geo.keyboard, keys, 0, 0.0165, -0.025).rotation.x = -Math.PI / 2;
      part(g, geo.pad, keys, 0, 0.0165, -D / 2 + 0.03).rotation.x = -Math.PI / 2;
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.016 * k, D / 2 * k);
      hinge.rotation.x = OPEN;
      g.add(hinge);
      part(hinge, geo.lid, metal, 0, 0.005, -D / 2);
      // 画面は、閉じた時に下を向く面。開くと、座っている人の方を向いて読める向きになる
      part(hinge, geo.display, screen, 0, -0.0005, -D / 2).rotation.set(Math.PI / 2, 0, Math.PI);
      return g;
    },

    /**
     * キーボードに手を置く腕の角度（肩の回転 x・z。左右）。hip は座った時の腰の高さ。
     * 腕は曲がらないので、届きすぎる時は手を少し奥へ、届かない時は手をキーボードの方へ向けるだけにする
     */
    arms(id, hip) {
      const sp = spots.get(id);
      if (!sp) return null;
      const out = {};
      for (const [name, sx] of [['L', -1], ['R', 1]]) {
        const dx = (sx * 0.13 + sp.side - sx * 0.265) * k;     // 肩（体の横）から、キーボードの左右の手の位置へ
        const dy = sp.y + 0.03 * k - (hip + 0.45 * k);
        let dz = (sp.dist - 0.06) * k;
        const L = ARM * k;
        if (dx * dx + dy * dy + dz * dz < L * L) dz = Math.sqrt(Math.max(0, L * L - dx * dx - dy * dy));
        const n = Math.hypot(dx, dy, dz);
        const u = { x: dx / n, y: dy / n, z: dz / n };
        out['b' + name] = Math.asin(Math.max(-1, Math.min(1, u.x)));            // 内側へ（z の回転）
        out['a' + name] = Math.max(-1.7, Math.min(-0.2, Math.atan2(-u.z, -u.y)));   // 前へ（x の回転）
      }
      return out;
    },
  };
}

/** 画面の中身：資料とコードが並んだ、仕事中の画面（絵として1回だけ描く） */
function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 176;
  const g = c.getContext('2d');
  g.fillStyle = '#eef2f7'; g.fillRect(0, 0, 256, 176);
  g.fillStyle = '#3b6fd8'; g.fillRect(0, 0, 256, 18);                 // 上のバー
  for (const [x, col] of [[8, '#ff6b5f'], [20, '#ffbd2e'], [32, '#28c840']]) { g.fillStyle = col; g.beginPath(); g.arc(x, 9, 4, 0, 7); g.fill(); }
  g.fillStyle = '#d9e1ec'; g.fillRect(0, 18, 64, 158);                // 左の一覧
  for (let i = 0; i < 8; i++) { g.fillStyle = i === 2 ? '#3b6fd8' : '#9aa8bb'; g.fillRect(8, 28 + i * 17, 40 + (i * 7) % 12, 6); }
  g.fillStyle = '#1f2633'; g.fillRect(70, 24, 180, 92);               // コード
  const code = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff', '#ffcb6b'];
  for (let i = 0; i < 9; i++) {
    let x = 78 + (i % 3 === 1 ? 10 : 0);
    for (let j = 0; j < 3; j++) { const w = 12 + ((i * 13 + j * 29) % 34); g.fillStyle = code[(i + j * 2) % code.length]; g.fillRect(x, 31 + i * 9, w, 4); x += w + 6; }
  }
  g.fillStyle = '#ffffff'; g.fillRect(70, 122, 180, 48);              // グラフ
  g.fillStyle = '#3b6fd8';
  [18, 30, 22, 36, 28, 40].forEach((h, i) => g.fillRect(84 + i * 26, 164 - h, 14, h));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
