// オフィスの3D座席配置図（Three.js）
// - office.glb（Blenderの office.blend から書き出し）を表示する
// - 席の位置・向き・座面の高さは office-seats.json（同じく書き出し）を使う
// - 着席者の分身（簡単な人型）が、決まったルートを歩いて席に戻る。頭上に名前を出し、押すとプロフィールを表示する
//   動きは office-nav.js が「サーバーの時刻」から計算するので、全端末で同じ動きになる
// - 左下のボタンで別の部屋へ移れる（yogibo部屋：yogibo.blend のランニングマシン ＋ Meshy_AI_Office_T_Pose_Running.glb の走る人）
// - ドラッグで回転、右ドラッグ／2本指で移動、ホイール／ピンチで拡大縮小。ボタンと矢印キーでも操作できる
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OfficeNav, speechAt } from '/static/office-nav.js';
import { LINES } from '/static/office-lines.js';

// 家具の色（モデルにマテリアルがないので、名前の種類で塗り分ける）
const COLORS = {
  chair: 0x4b5563, lounge_chair: 0x8a95a5, table: 0xf4efe6, side_table: 0xe2d3bd,
  sofa: 0x9db4c4, copier: 0xe7e9ec, wall: 0xfbf8f2,
  treadmill: 0x5b6573,
};
// 走る人の色。元の Meshy_AI_Office_T_Pose_Running.glb はマテリアルなし（ビューアでは明るいグレーに見える）なので、同じ見た目にする
const RUNNER_COLOR = 0xd9d9d9;
const PERSON = { mine: 0x4f9bf0, taken: 0xf08a4b, skin: 0xf6d2b8, legs: 0xb89d76 };

// 移れる部屋の一覧。部屋を増やす時はここに足す（load は初めて開いた時に1回だけ呼ぶ）
const ROOMS = [
  { id: 'office', label: 'オフィス', button: 'オフィスに戻る' },
  { id: 'yogibo', label: 'yogibo部屋', button: 'yogibo部屋', load: loadYogibo },
];

/**
 * container に3Dの座席配置図を作る。
 * opts.fetchPerson(seatId) … 名前を押した時にプロフィールを取得する関数（{name, issue, effort} を返す）
 * 戻り値の update(seatMap) に /api/seat-map の結果を渡すと、着席者の模型を更新する。
 */
export async function createOfficeView(container, opts = {}) {
  container.classList.add('office-view');
  container.replaceChildren();

  // ---- 描画の土台（全部屋で共有） ----
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'office-labels';
  container.append(renderer.domElement, labels.domElement);
  const clock = new THREE.Clock();

  // ---- オフィスの読み込み ----
  const [gltf, seatData, layoutData] = await Promise.all([
    new GLTFLoader().loadAsync('/static/office.glb'),
    fetch('/static/office-seats.json').then((r) => r.json()),
    fetch('/static/office-layout.json').then((r) => r.json()),
  ]);
  const officeModel = gltf.scene;
  paint(officeModel);
  // 元データは家具ごとに高さの中心が0なので、家具ごとに底を床（高さ0）にそろえる
  officeModel.updateMatrixWorld(true);
  for (const child of officeModel.children) {
    const box = new THREE.Box3().setFromObject(child);
    child.position.y -= box.min.y;
  }
  const office = buildRoom(ROOMS[0], officeModel);

  // Blender の座標（Z上）→ Three.js の座標（Y上）。座面の高さは椅子の底からの高さ
  const seats = new Map(seatData.seats.map((s) => [s.id, {
    ...s,
    pos: new THREE.Vector3(s.x, s.z - s.floor, -s.y),
  }]));

  // ---- 部屋の管理 ----
  const rooms = new Map([['office', office]]);
  let room = office;   // 表示中の部屋

  // ---- 視点の操作 ----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.screenSpacePanning = false;        // 移動は床に沿って
  controls.maxPolarAngle = Math.PI * 0.47;    // 床の下には回り込まない
  controls.zoomToCursor = true;

  /** 部屋の大きさに合わせて、視点の範囲・カメラの描画範囲を設定する */
  function fitRoom(r) {
    controls.minDistance = r.span * 0.08;
    controls.maxDistance = r.span * 3;
    camera.near = r.span * 0.005;
    camera.far = r.span * 30;
    camera.updateProjectionMatrix();
  }
  // 部屋全体が画面の横幅に収まる距離（縦長のスマホ画面では遠くなる）
  const fitDistance = (r, base) => {
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return Math.max(base, (r.span * 0.58) / (halfH * Math.max(camera.aspect, 0.3)));
  };
  const homeView = (r = room) => ({
    target: r.center.clone(),
    position: r.center.clone().add(new THREE.Vector3(-0.4, 0.7, -0.72).setLength(fitDistance(r, r.span * 1.08))),
  });
  // 真上から見る。2D平面図と同じく、北（+y）が画面の上
  const topView = (r = room) => ({
    target: r.center.clone(),
    position: r.center.clone().add(new THREE.Vector3(0, 1, 0.02).setLength(fitDistance(r, r.span * 1.15))),
  });

  // なめらかに視点を移す
  let flight = null;
  let placed = false;   // 最初の視点を置いたか（画面の大きさが決まってから置く）
  function flyTo({ target, position }, ms = 600) {
    flight = {
      t0: performance.now(), ms,
      fromT: controls.target.clone(), toT: target,
      fromP: camera.position.clone(), toP: position,
    };
  }
  function jumpTo({ target, position }) {
    flight = null;
    controls.target.copy(target);
    camera.position.copy(position);
  }
  function zoom(factor) {
    const dir = camera.position.clone().sub(controls.target);
    const dist = THREE.MathUtils.clamp(dir.length() * factor, controls.minDistance, controls.maxDistance);
    flyTo({ target: controls.target.clone(), position: controls.target.clone().add(dir.setLength(dist)) }, 250);
  }
  function pan(dx, dz) {
    // 画面の向きに合わせて、床の上を前後左右に動かす
    const fwd = controls.target.clone().sub(camera.position).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const step = camera.position.distanceTo(controls.target) * 0.15;
    const move = right.multiplyScalar(dx * step).add(fwd.multiplyScalar(dz * step));
    flyTo({ target: controls.target.clone().add(move), position: camera.position.clone().add(move) }, 250);
  }

  // 操作ボタン（右上：ズームなど、右下：移動の矢印）
  const button = (label, title, fn, cls = 'office-btn') => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', fn);
    return b;
  };
  const toolbar = el('div', 'office-toolbar');
  toolbar.append(
    button('＋', 'ズームイン', () => zoom(0.7)),
    button('－', 'ズームアウト', () => zoom(1.4)),
    button('上', '真上から見る', () => flyTo(topView())),
    button('⟲', '最初の視点に戻す', () => flyTo(homeView())),
  );
  const pad = el('div', 'office-pad');
  for (const [label, title, dx, dz, area] of [
    ['▲', '奥へ移動', 0, 1, 'up'], ['◀', '左へ移動', -1, 0, 'left'],
    ['▶', '右へ移動', 1, 0, 'right'], ['▼', '手前へ移動', 0, -1, 'down'],
  ]) {
    const b = button(label, title, () => pan(dx, dz));
    b.style.gridArea = area;
    pad.append(b);
  }
  // 左上：今いる部屋の名前、左下：別の部屋へ移るボタン
  const roomName = el('div', 'office-room-name', office.label);
  const roomBar = el('div', 'office-rooms');
  const hint = el('div', 'office-hint', 'ドラッグ：回転　右ドラッグ／2本指：移動　ホイール／ピンチ：拡大縮小　ダブルクリック：その場所へ移動');
  container.append(toolbar, pad, roomName, roomBar, hint);

  function renderRoomButtons() {
    roomBar.replaceChildren(...ROOMS.filter((r) => r.id !== room.id).map((r) =>
      button(r.button, r.label + 'へ移動', () => switchRoom(r.id), 'office-room-btn')));
  }

  let switching = false;
  async function switchRoom(id) {
    if (switching || id === room.id) return;
    switching = true;
    roomBar.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      if (!rooms.has(id)) {
        const def = ROOMS.find((r) => r.id === id);
        roomName.textContent = def.label + '（読み込み中…）';
        rooms.set(id, buildRoom(def, await def.load()));
      }
      closeProfile();
      // 名前ラベルは表示中の部屋の分しか更新されないので、離れる部屋のラベルは隠しておく
      room.scene.traverse((o) => { if (o.isCSS2DObject) o.element.style.display = 'none'; });
      room = rooms.get(id);
      fitRoom(room);
      jumpTo(homeView());
    } catch (e) {
      console.error(e);
      alert('部屋を表示できませんでした');
    } finally {
      roomName.textContent = room.label;
      switching = false;
      renderRoomButtons();
    }
  }
  renderRoomButtons();

  // 矢印キーでも移動（図にフォーカスがある時だけ。入力欄の操作を邪魔しない）
  container.tabIndex = 0;
  container.addEventListener('keydown', (e) => {
    const k = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (k) { e.preventDefault(); pan(...k); }
    if (e.key === '+' || e.key === ';') zoom(0.7);
    if (e.key === '-') zoom(1.4);
  });

  // ダブルクリックした床の位置へ視点の中心を移す
  const raycaster = new THREE.Raycaster();
  renderer.domElement.addEventListener('dblclick', (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = raycaster.intersectObject(room.floor)[0];
    if (!hit) return;
    const move = hit.point.clone().setY(0).sub(controls.target);
    flyTo({ target: controls.target.clone().add(move), position: camera.position.clone().add(move).lerp(hit.point, 0.35) });
  });

  // ---- プロフィールの小ウィンドウ（オフィスのみ） ----
  const panel = el('div', 'office-profile');
  panel.hidden = true;
  container.append(panel);
  let panelSeat = null;
  function closeProfile() {
    panel.hidden = true;
    panelSeat = null;
    for (const f of figures.values()) f.label.element.classList.remove('selected');
  }
  async function openProfile(seatId) {
    closeProfile();
    panelSeat = seatId;
    figures.get(seatId)?.label.element.classList.add('selected');
    const close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '閉じる');
    close.addEventListener('click', closeProfile);
    panel.replaceChildren(close, el('div', 'name', '読み込み中…'));
    panel.hidden = false;
    // 押した人に視点を寄せる
    const at = figures.get(seatId)?.root.position ?? seats.get(seatId).pos;
    const off = camera.position.clone().sub(controls.target);
    const dist = Math.min(off.length(), office.span * 0.35);
    flyTo({ target: at.clone().setY(0), position: at.clone().setY(0).add(off.setLength(dist)) });
    try {
      const p = await opts.fetchPerson(seatId);
      if (panelSeat !== seatId) return;
      const dl = el('dl');
      dl.append(el('dt', null, '現状の個人の課題'), el('dd', null, p.issue || '（未入力）'),
                el('dt', null, '課題解決にむけて取り組んでいること'), el('dd', null, p.effort || '（未入力）'));
      panel.replaceChildren(close, el('div', 'name', p.name || '（名前なし）'), dl);
    } catch (e) {
      if (panelSeat !== seatId) return;
      panel.replaceChildren(close, el('div', 'name', e?.message || 'プロフィールを取得できませんでした'));
    }
  }

  // ---- 分身（オフィスの着席者） ----
  // 大きさは事務椅子に合わせる（座面＝床から約0.45m）
  const officeSeat = [...seats.values()].find((s) => s.type === 'chair') ?? [...seats.values()][0];
  const k = officeSeat.pos.y / 0.45;   // 1m あたりの大きさ
  const nav = new OfficeNav(layoutData, seatData, { unitsPerMeter: k });
  const figures = new Map();           // 席ID → 分身
  let seatedList = [];                 // 着席中の席 [{id, since}]
  let warmed = false;                  // 道の先読みが終わったか
  let clockOffset = 0;                 // サーバーの時刻 − この端末の時刻（全端末で同じ動きにするため）

  const STAND_HIP = 0.93 * k;                    // 立った時の腰の高さ
  const THIGH = 0.42 * k, SHIN = 0.46 * k, TORSO = 0.42 * k;
  const CHAIR_HIP = officeSeat.pos.y + 0.07 * k;  // 事務椅子に座った時の腰の高さ

  /**
   * 座った時の、腰の高さと、太もも・膝の角度。事務椅子と同じ高さなら、太ももを水平・すねを垂直にする。
   * ソファのように座面が低い席は、足を前の床につくように、2本の骨の長さから角度を計算する（膝が腰より上がる）。
   */
  function sitPose(seat) {
    const hip = seat.pos.y + 0.07 * k;
    if (Math.abs(hip - CHAIR_HIP) < 0.1 * k) return { hip, thigh: Math.PI / 2, knee: Math.PI / 2 };
    const reach = 0.62 * k;                        // 腰から足先までの前への距離
    const D = Math.hypot(reach, hip);
    const cosKnee = (THIGH * THIGH + SHIN * SHIN - D * D) / (2 * THIGH * SHIN);
    const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosKnee)));
    const beta = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + D * D - SHIN * SHIN) / (2 * THIGH * D))));
    return { hip, thigh: Math.atan2(reach, hip) + beta, knee };
  }
  const ease = (t) => t * t * (3 - 2 * t);

  /** 腰・膝・肩を関節（Group）にした簡単な人型。座る・立つ・歩くを、関節の角度で表す */
  function makeAvatar(mine, seat) {
    const sit = sitPose(seat);
    const root = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: mine ? PERSON.mine : PERSON.taken, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: PERSON.skin, roughness: 0.7 });
    const legMat = new THREE.MeshStandardMaterial({ color: PERSON.legs, roughness: 0.8 });
    const mesh = (parent, geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const pelvis = new THREE.Group();
    root.add(pelvis);
    const torso = mesh(pelvis, new THREE.CapsuleGeometry(0.16 * k, TORSO, 4, 12), cloth, 0, 0.08 * k + TORSO / 2, 0);
    const neckY = 0.08 * k + TORSO + 0.02 * k;
    mesh(pelvis, new THREE.SphereGeometry(0.12 * k, 20, 16), skin, 0, neckY + 0.2 * k, 0.03 * k);
    const leg = (sx) => {
      const thigh = new THREE.Group();
      thigh.position.set(sx * k, 0, 0);
      pelvis.add(thigh);
      mesh(thigh, new THREE.CapsuleGeometry(0.065 * k, THIGH - 0.13 * k, 4, 8), legMat, 0, -THIGH / 2, 0);
      const knee = new THREE.Group();
      knee.position.set(0, -THIGH, 0);
      thigh.add(knee);
      mesh(knee, new THREE.CapsuleGeometry(0.055 * k, SHIN - 0.11 * k, 4, 8), legMat, 0, -SHIN / 2, 0);
      return { thigh, knee };
    };
    const arm = (sx) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * k, neckY - 0.04 * k, 0);
      pelvis.add(shoulder);
      mesh(shoulder, new THREE.CapsuleGeometry(0.05 * k, 0.26 * k, 4, 8), cloth, 0, -0.16 * k, 0);
      return shoulder;
    };
    const L = leg(-0.1), R = leg(0.1);
    const armL = arm(-0.22), armR = arm(0.22);

    // 頭上の名前（押すとプロフィール）
    const tag = el('button', 'person-label' + (mine ? ' mine' : ''));
    tag.type = 'button';
    const label = new CSS2DObject(tag);
    label.position.set(0, neckY + 0.2 * k + 0.45 * k, 0);
    pelvis.add(label);
    if (room !== office) tag.style.display = 'none';

    // 頭上の吹き出し（名前の上。クリックは通す）。外側は描画ライブラリが位置を決め、内側を名前の上に浮かせる
    const speechWrap = el('div', 'speech-wrap');
    const speech = el('div', 'speech');
    speechWrap.append(speech);
    const bubble = new CSS2DObject(speechWrap);
    bubble.position.copy(label.position);
    pelvis.add(bubble);
    if (room !== office) speechWrap.style.display = 'none';

    office.scene.add(root);
    return { root, pelvis, torso, L, R, armL, armR, label, bubble, speech, said: -1, mine, yaw: null, sit };
  }

  /** 話しているセリフに合わせて、吹き出しを出す・消す（変わった時だけ DOM を触る） */
  function applySpeech(f, id, nowMs) {
    const line = speechAt(nowMs, id, LINES.length);
    if (line === f.said) return;
    f.said = line;
    if (line >= 0) f.speech.textContent = LINES[line];
    f.speech.classList.toggle('on', line >= 0);
  }

  /** その時刻の姿（office-nav.js の poses の1人分）を、関節の角度に反映する */
  function applyPose(f, pose, dt) {
    const e = pose.state === 'sit' ? 0 : pose.state === 'standup' || pose.state === 'sitdown' ? ease(pose.t) : 1;
    const walking = pose.state === 'walk';
    const ph = pose.phase;
    f.root.position.set(pose.x, 0, -pose.y);
    // 向き：座っている時は席の向き、歩いている間は進行方向へなめらかに回る
    if (f.yaw == null || pose.state === 'sit' || pose.state === 'standup' || pose.state === 'sitdown') f.yaw = pose.yaw;
    else {
      let d = pose.yaw - f.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      f.yaw += Math.sign(d) * Math.min(Math.abs(d), 8 * dt);
    }
    f.root.rotation.y = f.yaw;
    f.pelvis.position.set(0, f.sit.hip + (STAND_HIP - f.sit.hip) * e + (walking ? 0.02 * k * Math.cos(2 * ph) : 0), 0);
    f.torso.position.z = -0.05 * k * (1 - e);
    const sw = walking ? Math.sin(ph) : 0;
    const bendL = walking ? 0.12 + 0.9 * Math.max(0, Math.cos(ph)) : 0;
    const bendR = walking ? 0.12 + 0.9 * Math.max(0, -Math.cos(ph)) : 0;
    f.L.thigh.rotation.x = -f.sit.thigh * (1 - e) - sw * 0.6;
    f.R.thigh.rotation.x = -f.sit.thigh * (1 - e) + sw * 0.6;
    f.L.thigh.position.z = f.R.thigh.position.z = 0.05 * k * (1 - e);
    f.L.knee.rotation.x = f.sit.knee * (1 - e) + bendL;
    f.R.knee.rotation.x = f.sit.knee * (1 - e) + bendR;
    f.armL.rotation.x = -0.6 * (1 - e) + sw * 0.5;
    f.armR.rotation.x = -0.6 * (1 - e) - sw * 0.5;
  }

  function removePerson(id) {
    const f = figures.get(id);
    if (!f) return;
    office.scene.remove(f.root);
    f.label.element.remove();
    f.bubble.element.remove();
    f.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    figures.delete(id);
    if (panelSeat === id) closeProfile();
  }

  /** /api/seat-map の結果で、着席者の分身と名前を更新する（別の部屋を表示中でも更新しておく） */
  function update(data) {
    if (typeof data?.now === 'number') clockOffset = data.now - Date.now();
    const now = new Map((data?.seats ?? []).filter((s) => s.state !== 'free').map((s) => [s.id, s]));
    seatedList = [...now.values()].map((s) => ({ id: s.id, since: s.since ?? 0 }));
    for (const id of [...figures.keys()]) {
      if (!now.has(id) || figures.get(id).mine !== (now.get(id).state === 'mine')) removePerson(id);
    }
    for (const [id, s] of now) {
      if (!seats.has(id)) continue;
      if (!figures.has(id)) {
        const f = makeAvatar(s.state === 'mine', seats.get(id));
        f.label.element.addEventListener('click', (e) => { e.stopPropagation(); openProfile(id); });
        f.label.element.addEventListener('pointerdown', (e) => e.stopPropagation());
        figures.set(id, f);
        const seat = seats.get(id);
        applyPose(f, { x: seat.x, y: seat.y, yaw: seat.rot, state: 'sit', t: 0, phase: 0 }, 0);
      }
      const tag = figures.get(id).label.element;
      tag.textContent = (s.state === 'mine' ? '自分：' : '') + (s.name || s.initial || '');
      tag.setAttribute('aria-label', (s.name || '着席者') + 'のプロフィールを表示');
    }
  }

  // ---- 大きさの追従と描画 ----
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
    placeHome();
  }
  function placeHome() {
    if (placed || !container.clientWidth) return;
    jumpTo(homeView());
    placed = true;
  }
  fitRoom(office);
  jumpTo({ target: office.center.clone(), position: office.center.clone().add(new THREE.Vector3(0, office.span, -office.span)) });
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (flight) {
      const t = Math.min(1, (performance.now() - flight.t0) / flight.ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      controls.target.lerpVectors(flight.fromT, flight.toT, e);
      camera.position.lerpVectors(flight.fromP, flight.toP, e);
      if (t === 1) flight = null;
    }
    room.mixers?.forEach((m) => m.update(dt));   // 部屋のアニメーション（yogibo部屋の走る人・踊る人）
    if (!warmed) warmed = nav.warmUp(3) === 0;   // 24席×24ルートの道を、描画の合間に少しずつ先に計算しておく
    if (figures.size) {
      const poses = nav.poses(Date.now() + clockOffset, seatedList);
      const nowMs = Date.now() + clockOffset;
      for (const [id, f] of figures) {
        const p = poses.get(id);
        if (p) applyPose(f, p, dt);
        applySpeech(f, id, nowMs);
      }
    }
    controls.update();
    renderer.render(room.scene, camera);
    labels.render(room.scene, camera);
  });
  controls.addEventListener('start', () => { flight = null; });

  return { update, openProfile, closeProfile, switchRoom, seatCount: seats.size, nav };
}

// ---- 部屋ごとの読み込み ----

/**
 * yogibo部屋：ランニングマシン（yogibo.glb）、その上で走る人（yogibo-runner.glb）、踊る人（yogibo-dancer.glb）
 * 走る人は Meshy_AI_Office_T_Pose_Running.glb をそのまま使う（形を減らさず、見た目を変えない圧縮だけ）。
 * 置き場所は yogibo.blend と同じ（yogibo-room.json。tools/export_yogibo.py が書き出す）。
 */
async function loadYogibo() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [room, runner, dancer, place] = await Promise.all([
    loader.loadAsync('/static/yogibo.glb'),
    loader.loadAsync('/static/yogibo-runner.glb'),
    loader.loadAsync('/static/yogibo-dancer.glb'),
    fetch('/static/yogibo-room.json').then((r) => r.json()),
  ]);
  const model = room.scene;
  paint(model);

  const person = runner.scene;
  person.position.fromArray(place.runner.position);
  person.rotation.y = place.runner.rotationY;
  person.traverse((o) => {
    if (!o.isMesh) return;
    o.material = new THREE.MeshStandardMaterial({ color: RUNNER_COLOR, roughness: 0.8, metalness: 0 });
    o.castShadow = true;
    o.frustumCulled = false;   // 走って形が変わっても消えないように
  });
  model.add(person);

  // 人とマシンの位置関係を保つため、部屋全体で1回だけ、ランニングマシンの底を床にそろえる
  model.updateMatrixWorld(true);
  const machine = model.getObjectByName('treadmill') ?? model;
  model.position.y -= new THREE.Box3().setFromObject(machine).min.y;

  const mixers = [new THREE.AnimationMixer(person)];
  for (const clip of runner.animations) mixers[0].clipAction(clip).play();   // くり返し再生

  // 踊る人（Thriller Part 4.fbx。形・動きはそのまま）。ダンスは約37秒かけて前へ約3m進みながら踊る動きで、
  // くり返す時に出発点へ戻る。ランニングマシンにぶつからないよう、マシンの斜め前から、手前（初期の視点側）へ進ませる。
  const dance = dancer.scene;
  dance.position.set(DANCER.x, 0, DANCER.z);
  dance.rotation.y = DANCER.yaw;
  dance.traverse((o) => {
    if (!o.isMesh) return;
    o.material = new THREE.MeshStandardMaterial({ color: RUNNER_COLOR, roughness: 0.8, metalness: 0 });
    o.castShadow = true;
    o.frustumCulled = false;
  });
  const dancerMixer = new THREE.AnimationMixer(dance);
  for (const clip of dancer.animations) dancerMixer.clipAction(clip).play();
  mixers.push(dancerMixer);
  // 足元が床（高さ0）になるよう、床にそろえたあとの部屋と同じ階層に置く
  const world = new THREE.Group();
  world.add(model, dance);

  // 小さい部屋なので見回せるよう少し広めの大きさとして扱い、視点の中心は床ではなく人の胸のあたりにする
  return { model: world, mixers, minSpan: 7, lookHeight: 0.9 };
}

/** モデルを部屋の Scene に入れ、光・床・グリッドを用意する */
function buildRoom(def, loaded) {
  const { model, mixers = null, minSpan = 0, lookHeight = 0 } = loaded.isObject3D ? { model: loaded } : loaded;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf7f1e8);
  scene.add(model);

  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, minSpan);
  center.y = lookHeight;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cbb8, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.position.set(center.x + span * 0.3, span * 0.9, center.z + span * 0.4);
  sun.target.position.set(center.x, 0, center.z);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -span * 0.8;
  sc.right = sc.top = span * 0.8;
  sc.near = span * 0.01;
  sc.far = span * 3;
  scene.add(sun, sun.target);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 1.6, span * 1.6),
    new THREE.MeshStandardMaterial({ color: 0xeee4d6, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x, 0, center.z);
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(span * 1.6, 32, 0xdccfbd, 0xe6dccd);
  grid.position.set(center.x, span * 0.0002, center.z);
  scene.add(grid);

  return { id: def.id, label: def.label, scene, center, span, floor, mixers };
}

// 踊る人の出発点と向き（向きは進む方向。初期の視点側＝手前へ進む）。ダンスは約3m前へ進む
const DANCER = { x: 3.5, z: 3.0, yaw: Math.atan2(-0.49, -0.87) };

/** マテリアルのないモデルに、名前の種類で色を塗る */
function paint(model) {
  model.traverse((o) => {
    if (!o.isMesh) return;
    const kind = Object.keys(COLORS).find((k) => o.name.startsWith(k)) ?? 'wall';
    o.material = new THREE.MeshStandardMaterial({
      color: COLORS[kind], roughness: 0.75, metalness: kind === 'chair' || kind === 'treadmill' ? 0.15 : 0,
    });
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
