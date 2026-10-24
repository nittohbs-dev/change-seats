// 試験用の小さな HTTP クライアント（Cookie と CSRF トークンを、ブラウザと同じように扱う）
export class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }

  keep(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
      if (/;\s*Max-Age=0/i.test(line) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, decodeURIComponent(value));
    }
  }

  /** method: GET/POST/PUT。data があれば form 形式で送る。csrf:false で、CSRF トークンを付けない（防御の試験用） */
  async req(method, path, data, { csrf = true, raw = false } = {}) {
    if (method !== 'GET' && csrf && !this.cookies.has('XSRF-TOKEN')) await this.req('GET', '/api/ping');
    const headers = { cookie: this.cookieHeader() };
    if (data) headers['content-type'] = 'application/x-www-form-urlencoded';
    if (method !== 'GET' && csrf) headers['x-xsrf-token'] = this.cookies.get('XSRF-TOKEN') ?? '';
    const res = await fetch(this.base + path, { method, headers, body: data ? new URLSearchParams(data) : undefined, redirect: 'manual' });
    this.keep(res);
    if (raw) return res;
    let body = null;
    try { body = await res.json(); } catch { /* JSON でない応答 */ }
    return { status: res.status, body };
  }

  get(path) { return this.req('GET', path); }
  post(path, data, opts) { return this.req('POST', path, data, opts); }

  /** SSE に接続して、届いた通知（event: changed）ごとに onEvent を呼ぶ。close() で切る。 */
  async events(onEvent) {
    const ac = new AbortController();
    const res = await fetch(this.base + '/api/events', { headers: { cookie: this.cookieHeader(), accept: 'text/event-stream' }, signal: ac.signal });
    if (!res.ok) { ac.abort(); throw new Error('SSE に接続できない: ' + res.status); }
    (async () => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event:\s*(.*)$/m.exec(block)?.[1];
            const data = /^data:\s*(.*)$/m.exec(block)?.[1];
            if (ev) onEvent({ event: ev, data, at: performance.now() });
          }
        }
      } catch { /* close() による中断 */ }
    })();
    return { close: () => ac.abort() };
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
