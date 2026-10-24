// サーバー（Spring Boot）の試験：登録・ログイン・ロック・権限・CSRF・画面の出し分け・保存
// 実行: サーバーを起動してから  node tools/test-server.mjs [URL] [管理者のパスワード]
//   既定の URL は http://localhost:8090、管理者のパスワードは環境変数 SEAT_ADMIN_PASSWORD（なければ adminpass123）
import { Client } from './client.mjs';

const BASE = process.argv[2] || 'http://localhost:8090';
const ADMIN_PW = process.argv[3] || process.env.SEAT_ADMIN_PASSWORD || 'adminpass123';
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'NG   ') + msg); if (!ok) failed++; };
const run = Date.now().toString(36).slice(-6);          // 何度実行してもIDが重ならないように
const id = (n) => `t${run}${n}`.slice(0, 20);

// ---- 登録の入力条件 ----
const anon = new Client(BASE);
check((await anon.post('/api/register', { id: 'abc', password: 'password1' })).body?.error === 'E-10', 'IDが3文字だと E-10');
check((await anon.post('/api/register', { id: 'abc-def', password: 'password1' })).body?.error === 'E-10', 'IDに記号があると E-10');
check((await anon.post('/api/register', { id: 'a'.repeat(21), password: 'password1' })).body?.error === 'E-10', 'IDが21文字だと E-10');
check((await anon.post('/api/register', { id: id(1), password: 'short' })).body?.error === 'E-11', 'パスワードが5文字だと E-11');
check((await anon.post('/api/register', { id: '', password: '' })).body?.error === 'E-05', '未入力だと E-05');
const ok = await anon.post('/api/register', { id: id(1), password: 'password1' });
check(ok.status === 200 && ok.body?.redirect === '/', '正しい入力なら登録できる');
check((await anon.post('/api/register', { id: id(1), password: 'password1' })).body?.error === 'E-02', '同じIDは E-02');

// ---- ログイン ----
const u = new Client(BASE);
check((await u.post('/api/login', { id: id(1), password: 'wrongpass1' })).body?.error === 'E-01', '違うパスワードは E-01');
check((await u.post('/api/login', { id: 'nobodyxx', password: 'password1' })).body?.error === 'E-01', '存在しないIDも E-01（IDの有無は分からない）');
const login = await u.post('/api/login', { id: id(1), password: 'password1' });
check(login.body?.redirect === '/seat-change', 'ログインすると、未着席なら /seat-change へ');
check((await u.get('/api/me')).body?.id === id(1), 'ログイン後は /api/me で自分が分かる');

// ---- ロック（5回連続で失敗） ----
await anon.post('/api/register', { id: id(2), password: 'password1' });
const l = new Client(BASE);
const codes = [];
for (let i = 0; i < 5; i++) codes.push((await l.post('/api/login', { id: id(2), password: 'wrongpass1' })).body?.error);
check(codes.slice(0, 4).every((c) => c === 'E-01') && codes[4] === 'E-09', `5回続けて失敗すると5回目で E-09（${codes.join(',')}）`);
check((await l.post('/api/login', { id: id(2), password: 'password1' })).body?.error === 'E-09', 'ロック中は、正しいパスワードでも E-09');
// 成功すると失敗の回数が戻る
await anon.post('/api/register', { id: id(3), password: 'password1' });
const r = new Client(BASE);
for (let i = 0; i < 4; i++) await r.post('/api/login', { id: id(3), password: 'wrongpass1' });
check((await r.post('/api/login', { id: id(3), password: 'password1' })).status === 200, '4回失敗しても、成功すればログインできる');
for (let i = 0; i < 4; i++) await r.post('/api/login', { id: id(3), password: 'wrongpass1' });
check((await r.post('/api/login', { id: id(3), password: 'password1' })).status === 200, '成功すると失敗の回数が戻る（また4回までは失敗できる）');

// ---- 権限・CSRF ----
const guest = new Client(BASE);
check((await guest.get('/api/me')).status === 401, '未ログインの API は 401');
check((await guest.get('/api/admin/data')).status === 401, '未ログインは管理用 API も 401');
check((await u.get('/api/admin/data')).status === 403, '一般アカウントは管理用 API が 403');
check((await u.post('/api/seat-change/assign', { name: 'x' }, { csrf: false })).body?.error === 'CSRF', 'CSRF トークンがない書き込みは拒否される');
check((await new Client(BASE).post('/api/login', { id: id(1), password: 'password1' }, { csrf: false })).body?.error === 'CSRF', 'ログインも CSRF トークンが必要');

// ---- 画面の出し分け ----
const page = async (c, p) => { const res = await c.req('GET', p, null, { raw: true }); return { status: res.status, to: res.headers.get('location'), type: res.headers.get('content-type') }; };
const a1 = await page(guest, '/');
check(a1.status === 200 && /text\/html/.test(a1.type), '未ログインは / が開く');
check((await page(guest, '/seat')).to === '/' && (await page(guest, '/admin')).to === '/', '未ログインで /seat・/admin を開くと / へ戻される');
check((await page(u, '/')).to === '/seat-change', 'ログイン済みで / を開くと、状態に合う画面（未着席なら /seat-change）へ');
check((await page(u, '/seat')).to === '/seat-change' && (await page(u, '/office')).to === '/seat-change', '未着席で /seat・/office を開くと /seat-change へ');
check((await page(u, '/admin')).to === '/seat-change', '一般アカウントが /admin を開くと戻される');
check((await page(u, '/seat-change')).status === 200, '未着席は /seat-change が開く');
const st = await fetch(BASE + '/static/office-seats.json');
check(st.status === 200 && (await st.json()).seats.length === 24, '/static/ から席の位置（24席）が読める');

// ---- 席決め・プロフィールの保存 ----
check((await u.post('/api/seat-change/assign', { name: '' })).body?.error === 'E-05', '名前が空の席決めは E-05');
check((await u.post('/api/seat-change/assign', { name: 'あ'.repeat(101) })).body?.error === 'E-07', '名前が101文字の席決めは E-07');
check((await u.post('/api/seat-change/assign', { name: '山田' })).body?.redirect === '/seat', '席決めできる');
check((await page(u, '/seat')).status === 200 && (await page(u, '/office')).status === 200, '着席後は /seat・/office が開く');
check((await u.post('/api/account', { name: '山田', issue: '課題A', effort: '取り組みB' })).body?.redirect === '/seat', '課題と取り組みを保存できる（任意）');
check((await u.post('/api/account', { name: '山田', issue: 'あ'.repeat(201), effort: '' })).body?.error === 'E-07', '課題が201文字だと E-07');
check((await u.post('/api/account', { name: '山田', issue: '', effort: '' })).status === 200, '課題・取り組みは空でも保存できる');
await u.post('/api/account', { name: '山田', issue: '課題A', effort: '取り組みB' });
const map = (await u.get('/api/seat-map')).body;
const mine = map.seats.find((s) => s.state === 'mine');
check(map.seats.length === 24 && mine && typeof map.now === 'number' && typeof mine.since === 'number', '席の図に、自分の席・サーバー時刻・着席時刻がある');
const other = new Client(BASE);
await other.post('/api/register', { id: id(4), password: 'password1' });
await other.post('/api/login', { id: id(4), password: 'password1' });
const person = (await other.get(`/api/seats/${mine.id}/person`)).body;
check(person?.name === '山田' && person?.issue === '課題A' && person?.effort === '取り組みB', '他の人が、席の人のプロフィールを見られる');
// 帰社・再ログイン：プロフィールは残る
check((await u.post('/api/seat/leave')).body?.redirect === '/', '帰社できる');
check((await u.get('/api/me')).status === 401, '帰社するとログアウトされる');
const again = new Client(BASE);
await again.post('/api/login', { id: id(1), password: 'password1' });
const me = (await again.get('/api/me')).body;
check(me.name === '山田' && me.issue === '課題A' && me.effort === '取り組みB' && me.seated === false, '帰社しても、名前・課題・取り組みは残る');

// ---- 管理者 ----
const admin = new Client(BASE);
const al = await admin.post('/api/login', { id: 'admin', password: ADMIN_PW });
check(al.body?.redirect === '/admin', '管理者でログインすると /admin へ');
check((await page(admin, '/seat-change')).to === '/admin', '管理者が一般の画面を開くと /admin へ');
const data = (await admin.get('/api/admin/data')).body;
check(data.seats.length === 24 && Array.isArray(data.topics) && data.topics.length >= 1, '管理用のデータ（席・お題）が取れる');
check((await admin.post('/api/admin/admins', { id: id(5), password: 'password1' })).body?.message?.includes('管理者'), '管理者アカウントを追加できる');
check((await admin.post('/api/admin/admins', { id: id(5), password: 'password1' })).body?.error === 'E-02', '管理者の追加も、IDが重なると E-02');
const t = await admin.post('/api/admin/topics', { text: '試験のお題' + run });
check(t.body?.topics?.some((x) => x.text === '試験のお題' + run), 'お題を登録できる');

console.log(failed ? `\n${failed} 件が失敗` : '\nすべて合格');
process.exit(failed ? 1 : 0);
