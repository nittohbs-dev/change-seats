// 2つの別々のブラウザ（Edge）で、全員の画面の同期を確かめる。実行: サーバーを起動してから
//   node tools/test-browser.mjs [URL] [管理者のパスワード] [保存先フォルダ]
//  登録 → ログイン → 席決め → 3D のバーチャルオフィスまでを画面の操作で行い、片方の操作が、
//  もう片方の画面に「再読み込みなし」で反映されること、0時の処理で座席画面の人がホームへ戻ることを確かめる。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { Client, sleep } from './client.mjs';

const BASE = process.argv[2] || 'http://localhost:8090';
const ADMIN_PW = process.argv[3] || process.env.SEAT_ADMIN_PASSWORD || 'adminpass123';
const OUT = process.argv[4] || process.env.TEMP + '/seat-browser';
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36).slice(-5);
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'NG   ') + msg); if (!ok) failed++; };

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

/** ブラウザを1つ起動して、操作用のハンドルを返す */
async function launch(name, port) {
  const dir = `${OUT}/prof-${name}`;
  rmSync(dir, { recursive: true, force: true });
  const proc = spawn(edge, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 60 && !ws; i++) { try { ws = (await (await fetch(`http://localhost:${port}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch { /* 起動待ち */ } await sleep(500); }
  const sock = new WebSocket(ws);
  await new Promise((r) => { sock.onopen = r; });
  let id = 0; const pend = {}; const b = { name, errors: [], dialogs: [] };
  sock.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) pend[d.id](d.result);
    if (d.method === 'Runtime.exceptionThrown') b.errors.push(d.params.exceptionDetails.exception?.description?.slice(0, 200));
    if (d.method === 'Page.javascriptDialogOpening') { b.dialogs.push(d.params.message); send('Page.handleJavaScriptDialog', { accept: true }); }
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; sock.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  Object.assign(b, {
    ev,
    go: async (path) => { await send('Page.navigate', { url: BASE + path }); await sleep(1800); },
    path: () => ev('location.pathname + location.search'),
    waitFor: async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await ev(expr)) return true; await sleep(200); } return false; },
    fill: (fields) => ev(`(()=>{const f=document.getElementById('form');${Object.entries(fields).map(([k, v]) => `(f.elements['${k}']||document.getElementById('${k}')).value=${JSON.stringify(v)};`).join('')}f.requestSubmit();})()`),
    hash: () => ev("(()=>{const c=document.querySelector('.office-map2d canvas'); if(!c) return ''; const d=c.toDataURL(); let h=0; for (let i=0;i<d.length;i+=7) h=(h*31+d.charCodeAt(i))|0; return h;})()"),
    shot: async (n) => writeFileSync(`${OUT}/${n}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')),
    close: () => { sock.close(); proc.kill(); },
  });
  return b;
}

// 前の試験で座ったままの人がいないよう、最初に管理者が全員を帰社させておく
const admin0 = new Client(BASE);
await admin0.post('/api/login', { id: 'admin', password: ADMIN_PW });
await admin0.post('/api/admin/daily-reset');

const A = await launch('A', 9611), B = await launch('B', 9612);
const idA = `ba${run}`, idB = `bb${run}`;

// ---- 登録 → ログイン（画面の操作） ----
for (const [br, uid] of [[A, idA], [B, idB]]) {
  await br.go('/register');
  await br.fill({ id: uid, password: 'password1', password2: 'password999' });
  await sleep(500);
  const mismatch = await br.ev("document.getElementById('msg').textContent");
  if (br === A) check(mismatch.includes('一致'), '確認用パスワードが違うと、登録画面にその旨が出る');
  await br.fill({ id: 'ab', password: 'password1', password2: 'password1' });
  await sleep(700);
  if (br === A) check((await br.ev("document.getElementById('msg').textContent")).includes('4〜20文字'), 'IDが短いと、サーバーのエラー（E-10）が登録画面に出る');
  await br.fill({ id: uid, password: 'password1', password2: 'password1' });
  await br.waitFor("location.pathname === '/'");
  if (br === A) check((await br.path()).includes('registered=1') && (await br.ev("document.getElementById('msg').textContent")).includes('アカウントを作成しました'), '登録できると、ログイン画面に戻って「作成しました」と出る');
  await br.fill({ id: uid, password: 'password1' });
  await br.waitFor("location.pathname === '/seat-change'");
}
check((await A.path()) === '/seat-change' && (await B.path()) === '/seat-change', '2人とも、画面の操作で登録・ログインでき、席決めの画面に進む');

// ---- 片方の席決めが、もう片方の画面に再読み込みなしで反映される ----
await A.waitFor("!!document.querySelector('.office-map2d canvas')");
await B.waitFor("!!document.querySelector('.office-map2d canvas')");
const before = await B.hash();
await A.fill({ name: '甲さん' });
await A.waitFor("location.pathname === '/seat'");
check((await A.path()) === '/seat', 'Aが席決めすると座席画面（2D）に進む');
let changed = false;
for (let i = 0; i < 20 && !changed; i++) { await sleep(150); changed = (await B.hash()) !== before; }
check(changed, 'Aの席決めが、Bの席決め画面の座席図に、再読み込みなしで1〜2秒以内に出る');
await B.fill({ name: '乙さん' });
await B.waitFor("location.pathname === '/seat'");
await A.go('/seat');
await sleep(1200);
const aBefore = await A.hash();
await B.go('/seat');   // Bの画面を開き直しても、Aには影響しない
await sleep(800);

// ---- 3D のバーチャルオフィス ----
await A.ev("document.querySelector('a[href=\"/office\"] button').click()");
await A.waitFor("location.pathname === '/office'");
await A.waitFor("document.querySelectorAll('.person-label').length >= 2", 20000);
await B.ev("document.querySelector('a[href=\"/office\"] button').click()");
await B.waitFor("location.pathname === '/office'");
await B.waitFor("document.querySelectorAll('.person-label').length >= 2", 20000);
const names = (br) => br.ev("[...document.querySelectorAll('.person-label')].map(e=>e.textContent).sort().join(',')");
check((await names(A)) === '乙さん,自分：甲さん' && (await names(B)) === '甲さん,自分：乙さん', '3Dのバーチャルオフィスに、2人の名前が出る（自分は「自分：」つき）');

// Cが後から着席すると、AとBの3Dにも再読み込みなしで現れる
const C = new Client(BASE);
const idC = `bc${run}`;
await C.post('/api/register', { id: idC, password: 'password1' });
await C.post('/api/login', { id: idC, password: 'password1' });
await C.post('/api/seat-change/assign', { name: '丙さん' });
const sawC = await Promise.all([A, B].map((br) => br.waitFor("[...document.querySelectorAll('.person-label')].some(e=>e.textContent==='丙さん')", 4000)));
check(sawC.every(Boolean), '3人目（丙さん）が席に着くと、AとBの3Dの画面にも、再読み込みなしで分身と名前が現れる');
await C.post('/api/account', { name: '丙太郎', issue: '', effort: '' });
const renamed = await Promise.all([A, B].map((br) => br.waitFor("[...document.querySelectorAll('.person-label')].some(e=>e.textContent==='丙太郎')", 4000)));
check(renamed.every(Boolean), '丙さんが名前を変えると、2人の画面の名前も、再読み込みなしで変わる');
await A.shot('browser-A-office');
await C.post('/api/seat/leave');
const left = await Promise.all([A, B].map((br) => br.waitFor("![...document.querySelectorAll('.person-label')].some(e=>e.textContent==='丙太郎')", 4000)));
check(left.every(Boolean), '丙さんが帰社すると、2人の3Dの画面から分身が消える');

// ---- 0時の処理（管理者のテスト実行）：座席画面にいる人は、その場でホームへ戻る ----
await A.go('/seat');
await sleep(1000);
const admin = new Client(BASE);
await admin.post('/api/login', { id: 'admin', password: ADMIN_PW });
await admin.post('/api/admin/daily-reset');
const homeA = await A.waitFor("location.pathname === '/'", 6000);
const homeB = await B.waitFor("location.pathname === '/'", 6000);
check(homeA && homeB, '管理者が0時の処理を行うと、座席画面（2D・3D）を開いていた2人が、その場でホームへ戻る（30秒待たない）');
check(A.dialogs.some((d) => d.includes('0時')), '戻る時に「0時になったため、自動で帰社しました」とお知らせが出る');
check(A.errors.length === 0 && B.errors.length === 0, `画面にエラーがない（A:${A.errors.length} / B:${B.errors.length}）`);

A.close(); B.close();
console.log(failed ? `\n${failed} 件が失敗` : '\nすべて合格');
process.exit(failed ? 1 : 0);
