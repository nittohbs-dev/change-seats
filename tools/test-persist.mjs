// 再起動しても残るかの試験（2段階）。 node tools/test-persist.mjs before [URL]  → サーバーを止めて起動し直す →  node tools/test-persist.mjs after [URL]
import { Client } from './client.mjs';
const [phase, BASE = 'http://localhost:8090'] = process.argv.slice(2);
const ID = 'persistuser1';
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'NG   ') + msg); if (!ok) failed++; };
const c = new Client(BASE);
if (phase === 'before') {
  await c.post('/api/register', { id: ID, password: 'password1' });
  await c.post('/api/login', { id: ID, password: 'password1' });
  await c.post('/api/seat-change/assign', { name: '再起動さん' });
  await c.post('/api/account', { name: '再起動さん', issue: '残る課題', effort: '残る取り組み' });
  const me = (await c.get('/api/me')).body;
  check(me.seated && me.name === '再起動さん', '再起動の前：登録・着席・プロフィールの保存ができた');
  console.log('  → サーバーを止めて、起動し直してください');
} else {
  const l = await c.post('/api/login', { id: ID, password: 'password1' });
  check(l.status === 200, '再起動のあとも、同じIDとパスワードでログインできる（アカウントが残っている）');
  check(l.body?.redirect === '/seat', '着席状況も残っていて、ログインすると /seat へ進む');
  const me = (await c.get('/api/me')).body;
  check(me.name === '再起動さん' && me.issue === '残る課題' && me.effort === '残る取り組み', '名前・課題・取り組みが残っている');
  check((await c.post('/api/login', { id: ID, password: 'wrongpass1' })).body?.error === 'E-01', 'パスワードは保存したハッシュで確認される');
}
console.log(failed ? `\n${failed} 件が失敗` : '\nすべて合格');
process.exit(failed ? 1 : 0);
