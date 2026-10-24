// 全員の画面の同期（SSE）の試験。実行: サーバーを起動してから  node tools/test-sync.mjs [URL] [管理者のパスワード]
//  24人が接続している時、1人の変化（席決め・名前の変更・帰社・0時のリセット）が、全員へ1秒以内に届くこと。
//  切断している間の変化にも、再接続すれば追いつけること。
import { Client, sleep } from './client.mjs';

const BASE = process.argv[2] || 'http://localhost:8090';
const ADMIN_PW = process.argv[3] || process.env.SEAT_ADMIN_PASSWORD || 'adminpass123';
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'NG   ') + msg); if (!ok) failed++; };
const run = Date.now().toString(36).slice(-5);

const admin = new Client(BASE);
await admin.post('/api/login', { id: 'admin', password: ADMIN_PW });
await admin.post('/api/admin/daily-reset');

// 24人が登録・ログインして、全員がSSEに接続する
const users = Array.from({ length: 24 }, (_, i) => ({ id: `s${run}u${i}`.slice(0, 20), client: new Client(BASE), got: [] }));
await Promise.all(users.map(async (u) => {
  await u.client.post('/api/register', { id: u.id, password: 'password1' });
  await u.client.post('/api/login', { id: u.id, password: 'password1' });
  u.sse = await u.client.events((e) => { if (e.event === 'changed') u.got.push(e); });
}));
await sleep(500);
check(users.every((u) => u.got.length === 1), `24人がSSEに接続でき、接続した時に最新の連番を1回受け取る（${users.map((u) => u.got.length).join('')}）`);

/** action を実行し、全員（except を除く）に通知が届くまでの時間を測る */
async function measure(label, action, { except = [] } = {}) {
  const before = users.map((u) => u.got.length);
  const t0 = performance.now();
  await action();
  for (let i = 0; i < 40 && !users.every((u, j) => except.includes(j) || u.got.length > before[j]); i++) await sleep(25);
  const late = users.filter((u, j) => !except.includes(j) && u.got.length === before[j]).length;
  const worst = Math.max(...users.map((u, j) => (except.includes(j) || u.got.length === before[j] ? 0 : u.got[before[j]].at - t0)));
  check(late === 0 && worst < 1000, `${label}：全員に届いた（最も遅い人で ${worst.toFixed(0)} ミリ秒。届かなかった人 ${late}人）`);
}

await measure('1人の席決め', () => users[0].client.post('/api/seat-change/assign', { name: '一番' }));
await measure('名前・課題の変更', () => users[0].client.post('/api/account', { name: '一番さん', issue: '課題', effort: '取り組み' }));
await measure('別の人の席決め', () => users[1].client.post('/api/seat-change/assign', { name: '二番' }));
await measure('管理者のお題の登録', () => admin.post('/api/admin/topics', { text: '同期の試験' + run }));
await measure('1人の帰社', () => users[0].client.post('/api/seat/leave'));
users[0].sse.close();

// 切断している間の変化に、再接続で追いつく
users[2].sse.close();
const lastSeen = Number(users[2].got.at(-1).data);
await users[3].client.post('/api/seat-change/assign', { name: '三番' });
await sleep(200);
users[2].got.length = 0;
users[2].sse = await users[2].client.events((e) => { if (e.event === 'changed') users[2].got.push(e); });
await sleep(300);
check(users[2].got.length >= 1 && Number(users[2].got[0].data) > lastSeen, '切断中に変化があっても、再接続した時の最初の通知で「進んだ連番」を受け取り、取り直しに行ける');

// 0時の処理（全員の強制帰社）が、全員へ届き、席が空になる
await measure('管理者の「0時の処理」', () => admin.post('/api/admin/daily-reset'), { except: [0] });
const seated = (await users[3].client.get('/api/me')).body?.seated;
check(seated === false, '0時の処理のあと、座っていた人は未着席になる（座席画面の人はホームへ戻る）');
const map = (await users[1].client.get('/api/seat-map')).body;
check(map.seats.every((s) => s.state === 'free'), '0時の処理のあと、すべての席が空き席になる');

for (const u of users) u.sse.close();
console.log(failed ? `\n${failed} 件が失敗` : '\nすべて合格');
process.exit(failed ? 1 : 0);
