/* Math Quest cloud helper (Cloudflare Worker, deployed as "math-quest").
   - /sync/<CODE>   GET / PUT the family's saved progress (JSON), stored in KV.
   - /tts           natural-sounding speech: Deepgram Aura-2 (English) and MeloTTS (Chinese)
                    via Workers AI. Each phrase is generated once and then served from KV.
   Bindings: SYNC (KV namespace "math-quest-sync"), AI (Workers AI). */

const SITE = 'https://ravisraman.github.io';
const VOICES = ['luna', 'thalia', 'athena', 'helena', 'apollo', 'arcas', 'aurora', 'cora', 'hera', 'orion'];

function corsFor(req) {
  const origin = req.headers.get('Origin') || '';
  const ok = origin === SITE || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? origin : SITE,
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function toBytes(result) {
  if (!result) throw new Error('empty result');
  if (result instanceof ReadableStream) return new Uint8Array(await new Response(result).arrayBuffer());
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (ArrayBuffer.isView(result)) return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  if (typeof result === 'object' && typeof result.audio === 'string') return b64ToBytes(result.audio);
  throw new Error('unexpected TTS result');
}

async function tts(url, env, headers) {
  const text = (url.searchParams.get('text') || '').trim().slice(0, 300);
  const lang = url.searchParams.get('lang') === 'zh' ? 'zh' : 'en';
  const voice = VOICES.includes(url.searchParams.get('voice')) ? url.searchParams.get('voice') : 'luna';
  if (!text) return json({ error: 'no text' }, 400, headers);

  const key = 'tts:' + (await sha256(`${lang}|${lang === 'en' ? voice : 'melo'}|${text}`));
  const audioHeaders = { ...headers, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable' };
  const cached = await env.SYNC.get(key, 'arrayBuffer');
  if (cached) return new Response(cached, { headers: { ...audioHeaders, 'X-Cache': 'hit' } });

  let bytes;
  if (lang === 'zh') {
    bytes = await toBytes(await env.AI.run('@cf/myshell-ai/melotts', { prompt: text, lang: 'zh' }));
  } else {
    bytes = await toBytes(await env.AI.run('@cf/deepgram/aura-2-en', { text, speaker: voice, encoding: 'mp3' }));
  }
  await env.SYNC.put(key, bytes, { expirationTtl: 60 * 60 * 24 * 180 });
  return new Response(bytes, { headers: { ...audioHeaders, 'X-Cache': 'miss' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsFor(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });

    try {
      const m = url.pathname.match(/^\/sync\/([A-Z0-9]{12,40})$/);
      if (m) {
        const key = 'save:' + m[1];
        if (req.method === 'GET') {
          const v = await env.SYNC.get(key);
          return new Response(v || 'null', { headers: { ...cors.headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        }
        if (req.method === 'PUT') {
          if (!cors.ok) return json({ error: 'forbidden' }, 403, cors.headers);
          const body = await req.text();
          if (body.length > 600000) return json({ error: 'too big' }, 413, cors.headers);
          const parsed = JSON.parse(body);
          if (!parsed || typeof parsed !== 'object' || typeof parsed.games !== 'object') return json({ error: 'bad save' }, 400, cors.headers);
          await env.SYNC.put(key, body);
          return json({ ok: true, at: Date.now() }, 200, cors.headers);
        }
      }
      if (url.pathname === '/tts' && req.method === 'GET') {
        if (!cors.ok) return json({ error: 'forbidden' }, 403, cors.headers);
        return await tts(url, env, cors.headers);
      }
      if (url.pathname === '/') return json({ ok: true, service: 'math-quest' }, 200, cors.headers);
      return json({ error: 'not found' }, 404, cors.headers);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500, cors.headers);
    }
  },
};
