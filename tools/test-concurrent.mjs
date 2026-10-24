// 同時ログインの試験。実行: サーバーを起動してから  node tools/test-concurrent.mjs [URL] [管理者のパスワード]
//  - 25人が「同時に」アカウント登録 → ログイン → 席決めを行う。24人が別々の席に座り、1人だけ「満席です」になること
//  - 3回くり返す（管理者の「0時の処理」で全員を帰社させてから）
import { Client } from './client.mjs';

const BASE = process.argv[2] || 'http://localhost:8090';
const ADMIN_PW = process.argv[3] || process.env.SEAT_ADMIN_PASSWORD || 'adminpass123';
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'NG   ') + msg); if (!ok) failed++; };
const run = Date.now().toString(36).slice(-5);

const admin = new Client(BASE);
await admin.post('/api/login', { id: 'admin', password: ADMIN_PW });

for (let round = 1; round <= 3; round++) {
  await admin.post('/api/admin/daily-reset');
  const t0 = performance.now();
  const users = Array.from({ length: 25 }, (_, i) => ({ id: `c${run}r${round}u${i}`.slice(0, 20), client: new Client(BASE) }));
  const regs = await Promise.all(users.map((u) => u.client.post('/api/register', { id: u.id, password: 'password1' })));      // 25人が同時に登録
  const logins = await Promise.all(users.map((u) => u.client.post('/api/login', { id: u.id, password: 'password1' })));       // 同時にログイン
  const results = await Promise.all(users.map((u, i) => u.client.post('/api/seat-change/assign', { name: '人' + i })));        // 同時に席決め
  const ms = (performance.now() - t0).toFixed(0);
  const ok = results.filter((r) => r.body?.redirect === '/seat').length;
  const full = results.filter((r) => r.body?.error === 'E-03').length;
  const map = (await users[0].client.get('/api/seat-map')).body;
  const taken = map.seats.filter((s) => s.state !== 'free');
  console.log(`  第${round}回: ${ms} ミリ秒で、25人の登録＋ログイン＋席決めが終わった`);
  check(regs.every((r) => r.status === 200) && logins.every((r) => r.status === 200), `第${round}回: 25人とも、登録とログインに成功`);
  check(ok === 24 && full === 1, `第${round}回: 24人が着席し、1人が「満席です」になる（着席 ${ok}人 / 満席 ${full}人）`);
  check(taken.length === 24 && new Set(taken.map((s) => s.id)).size === 24, `第${round}回: 24席が別々の人で埋まり、重複がない（埋まった席 ${taken.length}）`);
  check(new Set(taken.map((s) => s.name)).size === 24, `第${round}回: 座った24人の名前がすべて別々`);
}
console.log(failed ? `\n${failed} 件が失敗` : '\nすべて合格');
process.exit(failed ? 1 : 0);
