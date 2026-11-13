// 分身の形とコスチューム（バーチャルオフィスと、マイページの見本で同じものを使う）
// 分身：豆のような体（頭と胴が一体）に、出っぱった丸い目・小さな鼻・頭の芽と耳、細長い腕、ふくらんだ脚、平たい足。
// 腰・膝・肩を関節（Group）にして、座る・立つ・歩く・喧嘩を、関節の角度で表す（角度は office-view.js が決める）。
// コスチュームは、体・腕・脚に「少し大きい服の形」を重ねて作る。長さの単位はメートル（× k）

// 分身の色（全員同じ。自分かどうかは頭上の名前ラベルで見分ける）
const PERSON = { body: 0x8e5cc7, eyeWhite: 0xffffff, pupil: 0x222222, sprout: 0x6fbf5a };
export const THIGH = 0.42, SHIN = 0.46;          // 太もも・すねの長さ（m）

/** 選べるコスチューム（id はサーバーに保存する値。サーバーの AccountService.COSTUMES と同じにする） */
export const COSTUMES = [
  { id: 'none', name: 'いつもの', note: '紫のまま' },
  { id: 'suit', name: 'スーツ', note: '紺のスーツに赤いネクタイ' },
  { id: 'chef', name: 'コックさん', note: '白いコック帽とコックコート' },
  { id: 'ninja', name: '忍者', note: '黒装束に赤いはちまき' },
];
export const costumeOf = (id) => (COSTUMES.some((c) => c.id === id) ? id : 'none');

/**
 * 分身を1体作る。costume は COSTUMES の id。
 * 戻り値：root（置く場所）・pelvis（腰）・torso（体）・L/R（脚の thigh・knee）・armL/armR（肩）・top（頭のてっぺんの高さ。名前を出す高さ）
 */
export function buildAvatar(THREE, k, costume = 'none') {
  const root = new THREE.Group();
  const mat = (color, roughness = 0.55, side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color, roughness, side });
  const body = mat(PERSON.body);
  const mesh = (parent, geo, material, x, y, z, scale = null) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x * k, y * k, z * k);
    if (scale) m.scale.set(...scale);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const ball = (r, w = 16, h = 12) => new THREE.SphereGeometry(r * k, w, h);
  const pelvis = new THREE.Group();
  root.add(pelvis);

  // 体：下がふくらみ、上が少し細い豆の形（腰の少し下から、高さ約0.9m）。輪郭を曲線にして回転させる
  const outline = new THREE.SplineCurve([
    [0, -0.08], [0.15, -0.065], [0.23, 0.0], [0.26, 0.14], [0.26, 0.28], [0.24, 0.42],
    [0.215, 0.56], [0.2, 0.66], [0.17, 0.75], [0.1, 0.8], [0, 0.815],
  ].map(([r, y]) => new THREE.Vector2(r * k, y * k)));
  const torso = mesh(pelvis, new THREE.LatheGeometry(outline.getPoints(28), 28), body, 0, 0, 0);
  // 顔（正面＝+z）：出っぱった白い目と黒目、小さな鼻
  const eyeWhite = mat(PERSON.eyeWhite, 0.3), pupil = mat(PERSON.pupil, 0.3), sprout = mat(PERSON.sprout, 0.6);
  for (const sx of [-1, 1]) {
    mesh(torso, ball(0.048), eyeWhite, sx * 0.075, 0.6, 0.185, [1, 1, 0.75]);
    mesh(torso, ball(0.02, 12, 8), pupil, sx * 0.07, 0.6, 0.222);
    // 頭の上の小さな耳
    mesh(torso, ball(0.032, 12, 8), body, sx * 0.11, 0.765, 0, [1, 0.8, 0.8]);
  }
  mesh(torso, ball(0.013, 10, 8), body, 0, 0.52, 0.222);
  // 頭の芽：少し傾いた細い茎と、葉
  const stem = mesh(torso, new THREE.CapsuleGeometry(0.008 * k, 0.07 * k, 4, 6), sprout, 0.01, 0.85, 0);
  stem.rotation.z = -0.3;
  const leaf = mesh(torso, ball(0.035, 12, 8), sprout, 0.045, 0.895, 0, [1, 0.35, 0.6]);
  leaf.rotation.z = 0.5;

  const leg = (sx) => {
    const thigh = new THREE.Group();
    thigh.position.set(sx * k, 0, 0);
    pelvis.add(thigh);
    // 真ん中がふくらんだ太もも・すね（球を縦に伸ばしたもの）、膝の丸い関節、前に伸びた平たい足
    mesh(thigh, ball(0.075), body, 0, -THIGH / 2, 0, [1, THIGH / 2 / 0.075, 1]);
    const knee = new THREE.Group();
    knee.position.set(0, -THIGH * k, 0);
    thigh.add(knee);
    mesh(knee, ball(0.05), body, 0, 0, 0);
    mesh(knee, ball(0.065), body, 0, -SHIN / 2, 0, [1, (SHIN / 2) * 0.92 / 0.065, 1]);
    mesh(knee, ball(0.07), body, 0, -SHIN - 0.02, 0.05, [0.85, 0.35, 1.5]);
    return { thigh, knee };
  };
  const arm = (sx) => {
    // 肩は体の側面の、真ん中より少し上。細長い腕と丸い手を、体の外側に垂らす
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.265 * k, 0.45 * k, 0);
    pelvis.add(shoulder);
    mesh(shoulder, new THREE.CapsuleGeometry(0.032 * k, 0.48 * k, 4, 8), body, 0, -0.27, 0);
    mesh(shoulder, ball(0.045), body, 0, -0.54, 0);
    return shoulder;
  };
  const L = leg(-0.11), R = leg(0.11);
  const armL = arm(-1), armR = arm(1);
  const f = { root, pelvis, torso, L, R, armL, armR, top: 1.08 };

  // ---- コスチューム ----
  const pts = outline.getPoints(120);
  /** 体の、高さ y0〜y1（m）の部分を s 倍に広げた服の形。width（ラジアン）を渡すと、正面のその幅だけの帯になる */
  const shell = (y0, y1, s, material, width = null) => {
    const band = pts.filter((p) => p.y >= y0 * k && p.y <= y1 * k).map((p) => new THREE.Vector2(p.x * s, p.y));
    const geo = width ? new THREE.LatheGeometry(band, 16, -width / 2, width) : new THREE.LatheGeometry(band, 28);
    return mesh(torso, geo, material, 0, 0, 0);
  };
  /** 高さ y（m）での体の半径（m） */
  const radiusAt = (y) => pts.reduce((a, p) => (Math.abs(p.y - y * k) < Math.abs(a.y - y * k) ? p : a)).x / k;
  /** 袖・ズボン・靴：腕と脚に、少し太い同じ形を重ねる */
  const clothe = (cloth, shoe, sleeve = cloth) => {
    for (const s of [armL, armR]) mesh(s, new THREE.CapsuleGeometry(0.041 * k, 0.42 * k, 4, 8), sleeve, 0, -0.24, 0);
    for (const { thigh, knee } of [L, R]) {
      mesh(thigh, ball(0.083), cloth, 0, -THIGH / 2, 0, [1, (THIGH / 2 + 0.01) / 0.083, 1]);
      mesh(knee, ball(0.058), cloth, 0, 0, 0);
      mesh(knee, ball(0.073), cloth, 0, -SHIN / 2, 0, [1, (SHIN / 2) * 0.97 / 0.073, 1]);
      mesh(knee, ball(0.077), shoe, 0, -SHIN - 0.02, 0.05, [0.85, 0.38, 1.5]);
    }
  };
  if (costume === 'suit') {
    // 紺のスーツ：上着（胴）・白いシャツの胸元・赤いネクタイ・袖とズボン・黒い靴
    const navy = mat(0x27324a, 0.6), shirt = mat(0xf4f4f0, 0.5, THREE.DoubleSide), tie = mat(0xc0392b, 0.45, THREE.DoubleSide);
    shell(-0.08, 0.47, 1.035, navy);
    shell(0.2, 0.47, 1.045, shirt, 0.75);
    shell(0.1, 0.46, 1.06, tie, 0.17);
    for (const sx of [-1, 1]) mesh(torso, ball(0.012, 8, 6), mat(0x111111), sx * 0.09, 0.1, radiusAt(0.1) * 1.035 + 0.004);   // 上着のボタン
    clothe(navy, mat(0x161616, 0.35));
  } else if (costume === 'chef') {
    // コックさん：白いコックコート（2列のボタン）・赤いスカーフ・背の高いコック帽・グレーのズボン
    const white = mat(0xf7f6f0, 0.6);
    shell(-0.08, 0.47, 1.035, white);
    shell(0.43, 0.51, 1.07, mat(0xd8343a, 0.5));
    for (const sx of [-1, 1]) for (const y of [0.1, 0.22, 0.34]) {
      const r = radiusAt(y) * 1.035, x = sx * 0.07;
      mesh(torso, ball(0.013, 8, 6), mat(0x9a9a9a, 0.4), x, y, Math.sqrt(r * r - x * x) + 0.004);
    }
    mesh(torso, new THREE.CylinderGeometry(0.15 * k, 0.155 * k, 0.17 * k, 24), white, 0, 0.84, 0);
    mesh(torso, ball(0.2, 20, 14), white, 0, 0.97, 0, [1, 0.62, 1]);
    clothe(mat(0x4d4f55, 0.7), mat(0x161616, 0.35), white);
    f.top = 1.24;
  } else if (costume === 'ninja') {
    // 忍者：黒装束（目のところだけ開いた頭巾）・赤いはちまき（後ろに結び目の端）・帯
    const black = mat(0x22253a, 0.75), red = mat(0xc62f3e, 0.5);
    shell(-0.08, 0.548, 1.03, black);
    shell(0.655, 0.815, 1.04, black);
    shell(0.655, 0.7, 1.06, red);
    for (const sx of [-1, 1]) {
      const tail = mesh(torso, new THREE.BoxGeometry(0.035 * k, 0.17 * k, 0.012 * k), red, sx * 0.035, 0.6, -radiusAt(0.68) * 1.06 - 0.01);
      tail.rotation.z = sx * 0.35;
    }
    shell(0.06, 0.12, 1.05, mat(0x4a3b55, 0.6));
    clothe(black, black);
  }
  return f;
}
