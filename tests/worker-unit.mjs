import worker from '../cloud/worker.js';
const kv = new Map(); let putOpts = null; let failPut = false;
const SYNC = {
  async get(k, type) { const v = kv.get(k); if (v === undefined) return null; return type === 'arrayBuffer' ? v.buffer : v; },
  async put(k, v, opts) { if (failPut) throw new Error('KV put() limit exceeded for the day'); kv.set(k, v); putOpts = opts; },
  async delete(k) { kv.delete(k); },
};
let aiMode = 'ok';
const mp3 = new Uint8Array(800); mp3[0] = 0xff; mp3[1] = 0xf3;
const AI = { async run() { if (aiMode === 'quota') throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); if (aiMode === 'junk') return new Uint8Array(20); return mp3; } };
const env = { SYNC, AI };
const ctx = { waitUntil(p) { return p; } };
const O = { Origin: 'https://ravisraman.github.io' };
const call = async (method, path, body, headers = O) => { const r = await worker.fetch(new Request('https://w.test' + path, { method, body, headers: { ...headers, 'Content-Type': 'application/json' } }), env, ctx); return [r.status, r.headers.get('content-type'), (await r.text()).slice(0, 60)]; };
const C = '/sync/ABCDEFGHJKMN';
const good = JSON.stringify({ player: { name: 'Leo', hero: '🐼' }, games: { coinCrossing: { level: 2 } }, stars: 3 });
const out = [];
out.push(['PUT good', await call('PUT', C, good), putOpts && putOpts.expirationTtl]);
out.push(['GET', await call('GET', C)]);
out.push(['PUT not json', await call('PUT', C, '{oops')]);
out.push(['PUT unknown game', await call('PUT', C, JSON.stringify({ games: { evil: {} } }))]);
out.push(['PUT long hero', await call('PUT', C, JSON.stringify({ games: {}, player: { hero: '<img src=x onerror=alert(1)>' } }))]);
out.push(['PUT other origin', await call('PUT', C, good, { Origin: 'https://evil.example' })]);
failPut = true; out.push(['PUT kv limit', await call('PUT', C, good)]); failPut = false;
out.push(['DELETE other origin', await call('DELETE', C, undefined, { Origin: 'https://evil.example' })]);
out.push(['DELETE', await call('DELETE', C)]);
out.push(['GET after delete', await call('GET', C)]);
out.push(['TTS ok', await call('GET', '/tts?text=hello&lang=en')]);
out.push(['TTS cached', await call('GET', '/tts?text=hello&lang=en')]);
aiMode = 'quota'; const t0 = Date.now(); out.push(['TTS quota (no retries)', await call('GET', '/tts?text=new%20one&lang=en'), (Date.now() - t0) + 'ms']);
aiMode = 'junk'; out.push(['TTS junk audio', await call('GET', '/tts?text=junk&lang=en')]);
out.push(['TTS no origin', await call('GET', '/tts?text=x', undefined, {})]);
for (const o of out) console.log(JSON.stringify(o));
