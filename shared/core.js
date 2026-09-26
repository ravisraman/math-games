/* Math Quest — shared helpers used by the portal and every game:
   save data (localStorage), sound effects, read-aloud, money + Chinese number formatting. */
(function () {
  'use strict';

  const KEY = 'mathQuest.save.v1';

  // Heroes unlock as the player earns stars across all games. They are Kenney "Cube Pets" block
  // animals (sprites in shared/art/heroes, drawn by shared/fx.js). The save keeps the short id.
  const HEROES = [
    { id: 'chick', emoji: '🐥', name: 'Chick', zh: '小鸡', stars: 0 },
    { id: 'bunny', emoji: '🐰', name: 'Bunny', zh: '兔子', stars: 5 },
    { id: 'cat', emoji: '🐱', name: 'Cat', zh: '小猫', stars: 10 },
    { id: 'dog', emoji: '🐶', name: 'Dog', zh: '小狗', stars: 15 },
    { id: 'panda', emoji: '🐼', name: 'Panda', zh: '熊猫', stars: 25 },
    { id: 'fox', emoji: '🦊', name: 'Fox', zh: '狐狸', stars: 35 },
    { id: 'tiger', emoji: '🐯', name: 'Tiger', zh: '老虎', stars: 45 },
    { id: 'penguin', emoji: '🐧', name: 'Penguin', zh: '企鹅', stars: 55 },
    { id: 'pig', emoji: '🐷', name: 'Pig', zh: '小猪', stars: 65 },
    { id: 'cow', emoji: '🐮', name: 'Cow', zh: '奶牛', stars: 75 },
    { id: 'monkey', emoji: '🐵', name: 'Monkey', zh: '猴子', stars: 90 },
    { id: 'koala', emoji: '🐨', name: 'Koala', zh: '考拉', stars: 105 },
    { id: 'lion', emoji: '🦁', name: 'Lion', zh: '狮子', stars: 120 },
    { id: 'deer', emoji: '🦌', name: 'Deer', zh: '小鹿', stars: 135 },
    { id: 'parrot', emoji: '🦜', name: 'Parrot', zh: '鹦鹉', stars: 150 },
    { id: 'elephant', emoji: '🐘', name: 'Elephant', zh: '大象', stars: 170 },
    { id: 'giraffe', emoji: '🦒', name: 'Giraffe', zh: '长颈鹿', stars: 190 },
    { id: 'crab', emoji: '🦀', name: 'Crab', zh: '螃蟹', stars: 210 },
    { id: 'polar', emoji: '🐻‍❄️', name: 'Polar Bear', zh: '北极熊', stars: 235 },
    { id: 'beaver', emoji: '🦫', name: 'Beaver', zh: '河狸', stars: 260 },
    { id: 'bee', emoji: '🐝', name: 'Bee', zh: '蜜蜂', stars: 285 },
    { id: 'fish', emoji: '🐠', name: 'Clownfish', zh: '小丑鱼', stars: 310 },
    { id: 'hog', emoji: '🐗', name: 'Boar', zh: '野猪', stars: 340 },
    { id: 'worm', emoji: '🐛', name: 'Caterpillar', zh: '毛毛虫', stars: 370 },
  ];
  // Saves from before the block animals stored an emoji. Each maps to an animal unlocked at the
  // same number of stars or fewer, so nothing he had unlocked becomes locked.
  const OLD_HEROES = { '🐥': 'chick', '🐸': 'cat', '🐼': 'panda', '🐯': 'tiger', '🐲': 'pig', '🦄': 'monkey', '🤖': 'deer', '🦖': 'giraffe' };
  function heroId(v) {
    if (HEROES.some((h) => h.id === v)) return v;
    return OLD_HEROES[v] || 'chick';
  }
  function heroInfo(v) { const id = heroId(v); return HEROES.find((h) => h.id === id); }

  function defaults() {
    return {
      version: 1,
      player: { name: '', hero: 'chick' },
      settings: { sound: true, music: true, voice: true, chinese: true },
      stars: 0,
      playSeconds: 0,
      games: {},
    };
  }

  // ---------- Saving + syncing between devices ----------
  // Every part of the save carries a timestamp in data.stamps (player, each setting, each game),
  // so two devices can be merged safely:
  //  - games merge field by field: the copy with more finished rounds decides the current level,
  //    while maxLevel / rounds played / skill tallies / time take the larger value and the round
  //    histories are combined;
  //  - each setting and the player (name + hero) take the newer value;
  //  - stars and play time are counted per device (starsBy / secondsBy) and added up;
  //  - "Start over" / "Restore backup" set resetAt: older progress from other devices is dropped,
  //    anything played after it is kept.
  const SYNC_KEY = 'mathQuest.sync.v1';
  const CLOUD = 'https://math-quest.rraman.workers.dev';
  const DAY = 86400000;

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function syncState() {
    const st = readJSON(SYNC_KEY) || {};
    if (!st.device) {
      st.device = 'D' + Math.random().toString(36).slice(2, 10).toUpperCase();
      writeJSON(SYNC_KEY, st);
    }
    return st;
  }

  // Keep saves well-formed even if a copy was damaged or tampered with.
  function sane(d) {
    if (!d || typeof d !== 'object') return d;
    const limit = Date.now() + DAY;
    const clamp = (t) => { t = Number(t) || 0; return t > limit ? 0 : t; };
    if (d.player && typeof d.player === 'object') {
      d.player.hero = heroId(d.player.hero);
      d.player.name = String(d.player.name || '').slice(0, 20);
    }
    if (d.town !== undefined) {
      // { placed: [{ id, x, z, r }] }: piece ids from MQ.TOWN, whole-number tiles, 4 turns.
      const placed = d.town && Array.isArray(d.town.placed) ? d.town.placed : [];
      d.town = { placed: placed.slice(0, 800).filter((p) => p && typeof p === 'object' && /^[a-z]{1,12}$/.test(String(p.id)))
        .map((p) => ({ id: String(p.id), x: Math.max(-60, Math.min(60, Math.round(Number(p.x) || 0))), z: Math.max(-60, Math.min(60, Math.round(Number(p.z) || 0))), r: ((Math.round(Number(p.r) || 0) % 4) + 4) % 4 })) };
    }
    if (d.stamps && typeof d.stamps === 'object') {
      d.stamps.player = clamp(d.stamps.player);
      d.stamps.town = clamp(d.stamps.town);
      d.stamps.settings = clamp(d.stamps.settings);
      for (const k of ['set', 'games']) {
        const o = d.stamps[k];
        if (o && typeof o === 'object') for (const id of Object.keys(o)) o[id] = clamp(o[id]);
      }
    }
    d.resetAt = clamp(d.resetAt);
    if (!d.games || typeof d.games !== 'object' || Array.isArray(d.games)) d.games = {};
    // Numbers must be numbers (they end up on screen).
    const num = (v, dflt = 0) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };
    for (const [id, g] of Object.entries(d.games)) {
      if (!g || typeof g !== 'object' || Array.isArray(g)) { delete d.games[id]; continue; }
      for (const k of ['level', 'maxLevel']) if (k in g) g[k] = Math.max(1, Math.round(num(g[k], 1)));
      for (const k of ['played', 'seconds', 'struggles', 'goodStreak']) if (k in g) g[k] = Math.max(0, num(g[k]));
      if ('history' in g) {
        g.history = (Array.isArray(g.history) ? g.history : []).filter((h) => h && typeof h === 'object').map((h) => ({
          ...h, level: num(h.level, 1), stars: Math.max(0, Math.min(3, num(h.stars))), seconds: num(h.seconds), date: String(h.date || ''),
        }));
      }
    }
    for (const k of ['stars', 'playSeconds']) if (k in d) d[k] = Math.max(0, num(d[k]));
    return d;
  }

  function normalize(s) {
    const d = defaults();
    return sane({
      ...d,
      ...s,
      player: { ...d.player, ...(s.player || {}) },
      settings: { ...d.settings, ...(s.settings || {}) },
      games: s.games || {},
    });
  }

  // What counts as a change worth stamping/syncing: time spent alone doesn't.
  function gameSig(g) {
    if (!g || typeof g !== 'object') return JSON.stringify(g);
    const { seconds, ...rest } = g;
    return JSON.stringify(rest);
  }
  function sections(d) {
    const out = { player: JSON.stringify(d.player || {}), town: JSON.stringify(d.town || null), settings: {}, games: {} };
    for (const k of Object.keys(d.settings || {})) out.settings[k] = JSON.stringify(d.settings[k]);
    for (const id of Object.keys(d.games || {})) out.games[id] = gameSig(d.games[id]);
    return out;
  }

  // Older saves didn't record which device earned the stars; credit them to this device.
  function ensureCounters(d) {
    if (!d) return d;
    const dev = syncState().device;
    if (!d.starsBy || !Object.keys(d.starsBy).length) d.starsBy = { [dev]: Number(d.stars) || 0 };
    if (!d.secondsBy || !Object.keys(d.secondsBy).length) d.secondsBy = { [dev]: Number(d.playSeconds) || 0 };
    return d;
  }

  let snapshot = null; // what this page last loaded/saved, to spot which parts changed
  let live = null; // the data object this page got from load(); kept up to date in place
  let base = { stars: 0, seconds: 0 }; // totals this page last saw, to count only its own progress
  let savedSinceLoad = false;

  function load() {
    const s = readJSON(KEY);
    const data = ensureCounters(s ? normalize(s) : defaults());
    snapshot = sections(data);
    base = { stars: Number(data.stars) || 0, seconds: Number(data.playSeconds) || 0 };
    live = data;
    return data;
  }

  function gameTime(d, id) {
    const t = d.stamps && d.stamps.games && d.stamps.games[id];
    if (t) return t;
    const h = d.games && d.games[id] && d.games[id].history;
    const last = h && h.length && Date.parse(h[h.length - 1].date);
    return last || 0;
  }
  function settingTime(d, key) {
    const st = d.stamps || {};
    return (st.set && st.set[key]) || st.settings || 0;
  }

  function sumValues(o) { return Object.values(o || {}).reduce((a, v) => a + (Number(v) || 0), 0); }

  function maxMerge(a, b) {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b || {})) out[k] = Math.max(Number(out[k]) || 0, Number(v) || 0);
    return out;
  }

  const histKey = (h) => `${h && h.date}|${h && h.level}|${h && h.stars}`;

  // Skill tallies ({key: {right, tries, ...}}): keep the entry with more tries for each key.
  function mergeTallies(a, b) {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b || {})) {
      const o = out[k];
      if (!o || (Number(v && v.tries) || 0) >= (Number(o.tries) || 0)) out[k] = v;
    }
    return out;
  }

  function mergeGame(ga, gb, ta, tb) {
    const pa = Number(ga.played) || 0;
    const pb = Number(gb.played) || 0;
    // The copy with more finished rounds decides the current level (newer one if tied).
    const win = pa > pb || (pa === pb && ta > tb) ? ga : gb;
    const out = { ...win };
    let union = null;
    if (Array.isArray(ga.history) || Array.isArray(gb.history)) {
      const seen = new Set();
      union = [...(ga.history || []), ...(gb.history || [])]
        .filter((h) => { const k = histKey(h); if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((x, y) => String(x.date).localeCompare(String(y.date)));
      out.history = union.slice(-200);
    }
    out.played = Math.max(pa, pb, union && union.length < 200 ? union.length : 0);
    if ('maxLevel' in ga || 'maxLevel' in gb) out.maxLevel = Math.max(Number(ga.maxLevel) || 0, Number(gb.maxLevel) || 0, Number(out.level) || 0);
    if ('seconds' in ga || 'seconds' in gb) out.seconds = Math.max(Number(ga.seconds) || 0, Number(gb.seconds) || 0);
    for (const k of ['quiz', 'skills']) if (ga[k] || gb[k]) out[k] = mergeTallies(ga[k], gb[k]);
    return out;
  }

  // Drop the parts of a save that were made before a "start over" elsewhere.
  function sinceReset(d, resetAt) {
    const out = { ...d, games: {}, player: undefined, settings: {}, starsBy: {}, secondsBy: {}, stamps: { player: 0, set: {}, games: {} } };
    const st = d.stamps || {};
    for (const id of Object.keys(d.games || {})) {
      const t = gameTime(d, id);
      if (t > resetAt) { out.games[id] = d.games[id]; out.stamps.games[id] = t; }
    }
    if ((st.player || 0) > resetAt) { out.player = d.player; out.stamps.player = st.player; }
    if (d.town && (st.town || 0) > resetAt) { out.town = d.town; out.stamps.town = st.town; } else out.town = undefined;
    for (const k of Object.keys(d.settings || {})) {
      const t = settingTime(d, k);
      if (t > resetAt) { out.settings[k] = d.settings[k]; out.stamps.set[k] = t; }
    }
    out.resetAt = resetAt;
    return out;
  }

  // Combine two saves (b wins exact ties).
  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;
    a = sane(a);
    b = sane(b);
    const ra = a.resetAt || 0;
    const rb = b.resetAt || 0;
    if (ra > rb) b = sinceReset(b, ra);
    else if (rb > ra) a = sinceReset(a, rb);
    const sa = a.stamps || {};
    const sb = b.stamps || {};
    const out = { ...a, ...b, resetAt: Math.max(ra, rb), stamps: { player: 0, settings: 0, set: {}, games: {} } };
    // Player (name + hero) as one piece; the newer one wins.
    const pA = a.player ? sa.player || 0 : -Infinity;
    const pB = b.player ? sb.player || 0 : -Infinity;
    out.player = pA > pB ? a.player : b.player || a.player;
    out.stamps.player = Math.max(sa.player || 0, sb.player || 0);
    // His town (the pieces he placed) as one piece too; the newer layout wins.
    const tA = a.town ? sa.town || 0 : -Infinity;
    const tB = b.town ? sb.town || 0 : -Infinity;
    out.town = tA > tB ? a.town : b.town || a.town;
    out.stamps.town = Math.max(sa.town || 0, sb.town || 0);
    // Each setting on its own; the newer one wins.
    out.settings = {};
    for (const k of new Set([...Object.keys(a.settings || {}), ...Object.keys(b.settings || {})])) {
      const inA = a.settings && k in a.settings;
      const inB = b.settings && k in b.settings;
      const tA = settingTime(a, k);
      const tB = settingTime(b, k);
      out.settings[k] = inA && (!inB || tA > tB) ? a.settings[k] : b.settings[k];
      out.stamps.set[k] = Math.max(inA ? tA : 0, inB ? tB : 0);
    }
    out.games = {};
    for (const id of new Set([...Object.keys(a.games || {}), ...Object.keys(b.games || {})])) {
      const ga = a.games && a.games[id];
      const gb = b.games && b.games[id];
      const ta = ga ? gameTime(a, id) : 0;
      const tb = gb ? gameTime(b, id) : 0;
      out.games[id] = !ga || !gb ? ga || gb : mergeGame(ga, gb, ta, tb);
      out.stamps.games[id] = Math.max(ta, tb);
    }
    out.starsBy = maxMerge(a.starsBy, b.starsBy);
    out.secondsBy = maxMerge(a.secondsBy, b.secondsBy);
    out.stars = Object.keys(out.starsBy).length ? sumValues(out.starsBy) : Number(b.stars) || 0;
    out.playSeconds = Object.keys(out.secondsBy).length ? sumValues(out.secondsBy) : Number(b.playSeconds) || 0;
    return out;
  }

  function stamp(data, stored) {
    const now = Date.now();
    const snap = snapshot || sections(defaults());
    const cur = sections(data);
    data.stamps = data.stamps || {};
    data.stamps.games = data.stamps.games || {};
    data.stamps.set = data.stamps.set || {};
    if (cur.player !== snap.player) data.stamps.player = now;
    if (cur.town !== snap.town) data.stamps.town = now;
    for (const k of Object.keys(cur.settings)) if (cur.settings[k] !== snap.settings[k]) data.stamps.set[k] = now;
    for (const id of Object.keys(cur.games)) if (cur.games[id] !== snap.games[id]) data.stamps.games[id] = now;
    // Credit only what this page earned since it last looked (so two tabs never undo each other).
    const dev = syncState().device;
    const prev = ensureCounters(stored ? { ...stored } : { stars: base.stars, playSeconds: base.seconds });
    data.starsBy = { ...(data.starsBy || {}) };
    data.secondsBy = { ...(data.secondsBy || {}) };
    data.starsBy[dev] = Math.max(0, (Number(prev.starsBy[dev]) || 0) + (Number(data.stars) || 0) - base.stars);
    data.secondsBy[dev] = Math.max(0, (Number(prev.secondsBy[dev]) || 0) + (Number(data.playSeconds) || 0) - base.seconds);
  }

  // Bring newer values (e.g. from the other device) into the page's own data object in place, so
  // games holding references to data / data.games[id] see them and don't overwrite them later.
  function applyToLive(merged) {
    if (!live || !merged) return;
    // A "start over" arrived: forget the games it removed, or this page would bring them back.
    if ((merged.resetAt || 0) !== (live.resetAt || 0) && live.games) {
      for (const id of Object.keys(live.games)) if (!merged.games || !(id in merged.games)) delete live.games[id];
    }
    live.player = live.player || {};
    Object.assign(live.player, merged.player || {});
    live.settings = live.settings || {};
    Object.assign(live.settings, merged.settings || {});
    live.games = live.games || {};
    for (const [id, g] of Object.entries(merged.games || {})) {
      if (live.games[id] && typeof live.games[id] === 'object') Object.assign(live.games[id], g);
      else live.games[id] = g;
    }
    for (const k of ['stars', 'playSeconds', 'starsBy', 'secondsBy', 'stamps', 'resetAt', 'town']) live[k] = merged[k];
    snapshot = sections(live);
    base = { stars: Number(live.stars) || 0, seconds: Number(live.playSeconds) || 0 };
    try { applySettings(live.settings); } catch (e) { /* ignore */ }
  }

  function save(data) {
    try {
      const stored = readJSON(KEY);
      stamp(data, stored);
      const merged = merge(stored, data);
      localStorage.setItem(KEY, JSON.stringify(merged));
      savedSinceLoad = true;
      if (data === live || !live) { live = data; applyToLive(merged); }
      else { snapshot = sections(data); base = { stars: Number(data.stars) || 0, seconds: Number(data.playSeconds) || 0 }; }
      Sync.schedule();
      return true;
    } catch (e) {
      return false;
    }
  }

  function exportFile(data) {
    const blob = new Blob([JSON.stringify(readJSON(KEY) || data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const day = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob);
    a.download = `math-quest-progress-${day}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function importText(text) {
    const s = JSON.parse(text);
    if (!s || typeof s !== 'object' || typeof s.games !== 'object') {
      throw new Error('That file does not look like Math Quest progress.');
    }
    // A restored backup replaces the progress on every synced device (like "start over" + restore).
    const now = Date.now();
    const d = normalize(s);
    d.stamps = { player: now, set: {}, games: {} };
    for (const k of Object.keys(d.settings)) d.stamps.set[k] = now;
    for (const id of Object.keys(d.games)) d.stamps.games[id] = now;
    d.starsBy = { [syncState().device]: Number(d.stars) || 0 };
    d.secondsBy = { [syncState().device]: Number(d.playSeconds) || 0 };
    d.resetAt = now - 1;
    writeJSON(KEY, d);
    snapshot = sections(d);
    base = { stars: Number(d.stars) || 0, seconds: Number(d.playSeconds) || 0 };
    live = null;
    Sync.dirty = true;
    Sync.now();
  }

  function reset() {
    const fresh = { ...defaults(), resetAt: Date.now(), stamps: { player: 0, set: {}, games: {} }, starsBy: {}, secondsBy: {} };
    writeJSON(KEY, fresh);
    snapshot = sections(fresh);
    base = { stars: 0, seconds: 0 };
    live = null;
    Sync.dirty = true;
    Sync.now();
  }

  // Talks to the family's copy in the cloud (a small Cloudflare Worker + KV store).
  // To stay well inside the free plan's daily write limit, meaningful changes (a finished round,
  // a level/setting/hero change) are sent within a few seconds; play time alone at most every
  // 5 minutes; and whatever is pending is sent when the app goes to the background.
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const TIME_ONLY_EVERY = 5 * 60 * 1000;

  function pushSig(d) {
    if (!d) return '';
    const s = sections(d);
    return JSON.stringify([s.player, s.settings, s.games, d.starsBy, d.resetAt]);
  }

  const Sync = {
    timer: null,
    busy: null,
    listeners: [],
    dirty: false,
    lastRemote: undefined,
    lastSig: null,
    lastPushAt: 0,
    get code() { return syncState().code || null; },
    get lastSync() { return syncState().lastSync || 0; },
    get lastError() { return syncState().lastError || ''; },
    get pausedUntil() { return syncState().pausedUntil || 0; },
    pretty(code) { return (code || '').replace(/(.{4})(?=.)/g, '$1-'); },
    newCode() {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    },
    clean(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); },
    setState(patch) { writeJSON(SYNC_KEY, { ...syncState(), ...patch }); },
    onChange(fn) { this.listeners.push(fn); },
    emit(info) { this.listeners.forEach((fn) => { try { fn(info); } catch (e) { /* ignore */ } }); },
    usable() {
      return !!this.code && /^https?:$/.test(location.protocol) && navigator.onLine !== false && Date.now() >= this.pausedUntil;
    },
    async request(method, body, { keepalive = false, timeout = 8000 } = {}) {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
      try {
        const res = await fetch(`${CLOUD}/sync/${this.code}`, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body,
          keepalive: keepalive && (!body || body.length < 60000),
          cache: 'no-store',
          signal: ctl ? ctl.signal : undefined,
        });
        if (!res.ok) {
          const err = new Error(`sync ${method} ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return res.json();
      } finally {
        if (t) clearTimeout(t);
      }
    },
    // Pull the cloud copy, merge it with this device, save both ways.
    async now({ background = false } = {}) {
      if (!this.usable()) return null;
      if (this.busy) return this.busy;
      clearTimeout(this.timer);
      this.timer = null;
      this.busy = (async () => {
        try {
          const remote = await this.request('GET', undefined, { timeout: background ? 4000 : 8000 });
          // The family's cloud copy was erased from another device: stop syncing here too
          // (instead of quietly re-creating it).
          if (remote === null && this.lastSync > 0) {
            this.setState({ code: null, lastSync: 0, pausedUntil: 0, lastError: 'erased' });
            this.emit({ changed: false });
            return null;
          }
          this.lastRemote = remote;
          const local = ensureCounters(readJSON(KEY) || defaults());
          const merged = merge(remote, local);
          const before = JSON.stringify(sections(normalize(local)));
          writeJSON(KEY, merged);
          if (JSON.stringify(merged) !== JSON.stringify(remote)) {
            const body = JSON.stringify(merged);
            await this.request('PUT', body, { keepalive: document.hidden });
            this.lastRemote = merged;
          }
          this.dirty = false;
          this.lastSig = pushSig(merged);
          this.lastPushAt = Date.now();
          this.setState({ lastSync: Date.now(), lastError: '' });
          const changed = JSON.stringify(sections(normalize(merged))) !== before;
          if (changed) applyToLive(merged);
          this.emit({ changed });
          return { changed };
        } catch (e) {
          // A daily limit on the free plan: stop trying until tomorrow (UTC) instead of hammering.
          if (e && (e.status === 429 || e.status === 503)) {
            const tomorrow = new Date();
            tomorrow.setUTCHours(24, 5, 0, 0);
            this.setState({ lastError: 'quota', pausedUntil: tomorrow.getTime() });
          } else {
            this.setState({ lastError: String((e && e.message) || e) });
          }
          this.emit({ error: true });
          return null;
        } finally {
          this.busy = null;
        }
      })();
      return this.busy;
    },
    schedule() {
      if (!this.code) return;
      this.dirty = true;
      const local = readJSON(KEY);
      const important = pushSig(local) !== this.lastSig;
      if (!important && Date.now() - this.lastPushAt < TIME_ONLY_EVERY) return; // time-only: later
      if (document.hidden) { this.now({ background: true }); return; }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; this.now(); }, 2500);
    },
    // Last chance when the page is going away: send the merged copy without waiting for an answer.
    flush() {
      if (!this.code || !this.dirty || this.busy || !this.usable()) return;
      try {
        const local = ensureCounters(readJSON(KEY) || defaults());
        const body = JSON.stringify(this.lastRemote ? merge(this.lastRemote, local) : local);
        if (body.length >= 60000) return;
        this.request('PUT', body, { keepalive: true }).then(() => { this.dirty = false; }).catch(() => {});
      } catch (e) { /* ignore */ }
    },
    async start() {
      const code = this.newCode();
      this.setState({ code, pausedUntil: 0, lastError: '' });
      this.dirty = true;
      await this.now();
      return code;
    },
    async join(code) {
      const c = this.clean(code);
      if (c.length < 12) throw new Error('That code looks too short.');
      const prev = this.code;
      this.setState({ code: c, pausedUntil: 0, lastError: '' });
      let res;
      try { res = await this.request('GET'); } catch (e) { res = undefined; }
      if (res === undefined) { this.setState({ code: prev }); throw new Error('Could not reach the sync service. Check the internet connection.'); }
      if (res === null) { this.setState({ code: prev }); throw new Error('No saved progress found for that code. Check for typos.'); }
      const family = sane(res);
      const local = ensureCounters(normalize(readJSON(KEY) || defaults()));
      // Adopt the family's "start over" point, so neither side wipes the other just for joining.
      local.resetAt = family.resetAt || 0;
      if (!local.resetAt) delete local.resetAt;
      // Adopt the family's name, hero and settings; this device's game progress still merges in.
      local.stamps = { ...(local.stamps || {}), player: -1, settings: -1, set: {} };
      // If this device's progress was copied from the family (a backup file), don't count those
      // stars twice: credit this device only with rounds the family doesn't already have.
      const familyRounds = new Set();
      for (const g of Object.values(family.games || {})) for (const h of (g && g.history) || []) familyRounds.add(histKey(h));
      let shared = 0;
      let extraStars = 0;
      let extraSeconds = 0;
      for (const g of Object.values(local.games || {})) {
        for (const h of (g && g.history) || []) {
          if (familyRounds.has(histKey(h))) shared++;
          else { extraStars += Number(h.stars) || 0; extraSeconds += Number(h.seconds) || 0; }
        }
      }
      if (shared > 0) {
        const dev = syncState().device;
        local.starsBy = { [dev]: extraStars };
        local.secondsBy = { [dev]: extraSeconds };
      }
      writeJSON(KEY, local);
      this.dirty = true;
      live = null;
      await this.now();
      return c;
    },
    stop() { this.setState({ code: null, lastSync: 0, pausedUntil: 0, lastError: '' }); },
    // Delete the family's copy in the cloud and stop syncing (progress stays on each device).
    async erase() {
      if (!this.code) return;
      await this.request('DELETE');
      this.stop();
    },
  };

  // Sync when a page opens and whenever the app comes back to the front. If newer progress
  // arrives before the child has touched anything, reload so the game starts from it; otherwise
  // it has already been merged into the page's data in place.
  function autoSync() {
    Sync.now({ background: true }).then((r) => {
      if (!r || !r.changed || Sync.listeners.length) return;
      const touched = (navigator.userActivation && navigator.userActivation.hasBeenActive) || savedSinceLoad;
      if (touched) return;
      const last = Number(sessionStorage.getItem('mq.syncReload') || 0);
      if (Date.now() - last < 15000) return;
      sessionStorage.setItem('mq.syncReload', String(Date.now()));
      location.reload();
    });
  }
  setTimeout(autoSync, 50);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (Sync.dirty) Sync.now({ background: true }); }
    else autoSync();
  });
  window.addEventListener('online', () => autoSync());
  window.addEventListener('pagehide', () => Sync.flush());

  function unlockedHeroes(stars) {
    return HEROES.filter((h) => stars >= h.stars);
  }

  // ---------- Audio: soft synthesized instruments + classical background music ----------
  // Everything is generated with the Web Audio API — no audio files. Instruments are gentle
  // (harp, music box, soft bass, timpani) and run through a small reverb so it all feels calm.
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const Audio = {
    ctx: null,
    unlocked: false,
    init() {
      if (this.ctx) return this.ctx;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 3;
        comp.connect(ctx.destination);
        this.master = ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(comp);

        // Reverb from a generated, softly decaying noise impulse.
        const len = Math.floor(ctx.sampleRate * 2.4);
        const ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
          const d = ir.getChannelData(ch);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
        }
        this.reverb = ctx.createConvolver();
        this.reverb.buffer = ir;
        const wet = ctx.createGain();
        wet.gain.value = 0.45;
        this.reverb.connect(wet).connect(this.master);

        this.sfx = ctx.createGain();
        this.sfx.gain.value = 0.8;
        this.sfx.connect(this.master);
        const sfxSend = ctx.createGain();
        sfxSend.gain.value = 0.25;
        this.sfx.connect(sfxSend).connect(this.reverb);

        this.music = ctx.createGain();
        this.music.gain.value = 0;
        this.music.connect(this.master);
        const musicSend = ctx.createGain();
        musicSend.gain.value = 0.6;
        this.music.connect(musicSend).connect(this.reverb);

        const nb = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
        const nd = nb.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        this.noise = nb;
        this.ctx = ctx;
      } catch (e) {
        this.ctx = null;
      }
      return this.ctx;
    },
    unlock() {
      const ctx = this.init();
      if (!ctx) return;
      if (ctx.state !== 'running' && ctx.state !== 'closed') { try { ctx.resume(); } catch (e) { /* ignore */ } }
      if (!this.unlocked) {
        this.unlocked = true;
        // iOS Safari only fully unlocks audio after something is played inside a touch/click.
        try {
          const src = ctx.createBufferSource();
          src.buffer = ctx.createBuffer(1, 1, 22050);
          src.connect(ctx.destination);
          src.start(0);
        } catch (e) { /* ignore */ }
        Music._startIfWanted();
      }
    },
  };

  // Instruments. Each schedules one note at time t on the given bus.
  const Inst = {
    // Plucked harp: triangle + soft octave, darkening as it rings.
    harp(bus, midi, t, dur, vel) {
      const ctx = Audio.ctx;
      const f = midiHz(midi);
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(6000, f * 6), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vel, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const o1 = ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2;
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      o1.connect(lp);
      o2.connect(g2).connect(lp);
      lp.connect(g).connect(bus);
      o1.start(t); o2.start(t);
      o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    },
    // Music box / celesta: pure tone with a quick bright shimmer on top.
    bell(bus, midi, t, dur, vel) {
      const ctx = Audio.ctx;
      const f = midiHz(midi);
      [[1, 1, dur], [2, 0.18, dur * 0.5], [3, 0.08, dur * 0.25], [4.2, 0.05, dur * 0.15]].forEach(([mult, amp, d]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vel * amp, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + d + 0.05);
      });
    },
    // Warm, quiet bass note.
    bass(bus, midi, t, dur, vel) {
      const ctx = Audio.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      o.type = 'triangle';
      o.frequency.value = midiHz(midi);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vel, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp).connect(g).connect(bus);
      o.start(t);
      o.stop(t + dur + 0.05);
    },
    // Soft orchestral timpani.
    timpani(bus, midi, t, dur, vel) {
      const ctx = Audio.ctx;
      const f = midiHz(midi);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.6, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vel, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + dur + 0.05);
      const n = ctx.createBufferSource();
      n.buffer = Audio.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'lowpass';
      bp.frequency.value = 400;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(vel * 0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      n.connect(bp).connect(ng).connect(bus);
      n.start(t);
      n.stop(t + 0.2);
    },
    // Tiny wooden tick for menus.
    wood(bus, midi, t, dur, vel) {
      const ctx = Audio.ctx;
      const n = ctx.createBufferSource();
      n.buffer = Audio.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = midiHz(midi);
      bp.Q.value = 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(bp).connect(g).connect(bus);
      n.start(t);
      n.stop(t + dur + 0.02);
    },
  };

  // ---------- Sound effects ----------
  // Notes stay inside C major so effects blend with the background music.
  const PENTA = [0, 2, 4, 7, 9]; // C D E G A
  const Sound = {
    enabled: true,
    ensure() { Audio.unlock(); return Audio.ctx; },
    play(fn) {
      if (!this.enabled) return;
      const ctx = this.ensure();
      if (!ctx) return;
      try { fn(ctx.currentTime + 0.01, Audio.sfx); } catch (e) { /* ignore */ }
    },
    // Hopping walks up a pentatonic scale: the higher up the board, the higher the note.
    hop(height = 0, sideways = false) {
      const note = 60 + PENTA[height % 5] + 12 * Math.floor(height / 5);
      this.play((t, b) => Inst.harp(b, note, t, 0.35, sideways ? 0.09 : 0.14));
    },
    // Coin chime: bigger coins ring higher, with a sparkle a fifth above.
    coin(value = 1) {
      const base = { 1: 76, 5: 79, 10: 81, 25: 84, 100: 88, 500: 91 }[value] || 79;
      this.play((t, b) => {
        Inst.bell(b, base, t, 1.2, 0.22);
        Inst.bell(b, base + 7, t + 0.09, 1.0, 0.14);
      });
    },
    putBack() {
      this.play((t, b) => [79, 76, 72].forEach((m, i) => Inst.harp(b, m, t + i * 0.07, 0.5, 0.12)));
    },
    // Gentle "hmm" — two low harp notes stepping down.
    nope() {
      this.play((t, b) => { Inst.harp(b, 55, t, 0.6, 0.16); Inst.harp(b, 54, t + 0.16, 0.8, 0.14); });
    },
    bonk() {
      this.play((t, b) => { Inst.timpani(b, 43, t, 0.9, 0.35); Inst.harp(b, 48, t + 0.05, 0.6, 0.1); });
    },
    // Gate opens: a rising harp glissando over two octaves of C major.
    open() {
      const notes = [60, 64, 67, 72, 76, 79, 84, 88];
      this.play((t, b) => notes.forEach((m, i) => Inst.harp(b, m, t + i * 0.055, 1.4, 0.13)));
    },
    // Level complete: the "Ode to Joy" theme (Beethoven) on music box, with harp chords.
    win() {
      const tune = [76, 76, 77, 79, 79, 77, 76, 74, 72, 72, 74, 76, 74, 72, 72];
      const lens = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2];
      const beat = 0.26;
      Music.duck(tune.length * beat + 2.5);
      this.play((t, b) => {
        let at = t;
        tune.forEach((m, i) => { Inst.bell(b, m, at, 1.0, 0.2); at += lens[i] * beat; });
        [[48, 0], [43, 4], [48, 8], [43, 12], [48, 14.5]].forEach(([m, beatAt]) => {
          Inst.bass(b, m, t + beatAt * beat, 1.2, 0.18);
          Inst.harp(b, m + 16, t + beatAt * beat, 1.0, 0.07);
        });
      });
    },
    click() { this.play((t, b) => Inst.wood(b, 84, t, 0.05, 0.35)); },
    // Play any single note: MQ.Sound.note(72, 'bell', { delay: 0.1, dur: 1, vel: 0.15 }).
    // Instruments: 'harp', 'bell', 'bass', 'timpani', 'wood'. MIDI 60 = middle C.
    note(midi, inst = 'harp', { delay = 0, dur = 0.8, vel = 0.12 } = {}) {
      this.play((t, b) => (Inst[inst] || Inst.harp)(b, midi, t + delay, dur, vel));
    },
    star() { this.play((t, b) => { Inst.bell(b, 84, t, 1.2, 0.18); Inst.bell(b, 91, t + 0.1, 1.2, 0.12); Inst.bell(b, 96, t + 0.2, 1.4, 0.1); }); },
    // Quiz answers: a V–I cadence for right, a soft unresolved sigh for wrong.
    correct() {
      this.play((t, b) => {
        [67, 71, 74].forEach((m) => Inst.harp(b, m, t, 0.8, 0.09));
        [72, 76, 79, 84].forEach((m) => Inst.harp(b, m, t + 0.28, 1.6, 0.1));
        Inst.bell(b, 88, t + 0.3, 1.4, 0.14);
      });
    },
    wrong() {
      this.play((t, b) => { Inst.harp(b, 64, t, 0.8, 0.12); Inst.harp(b, 62, t + 0.22, 1.2, 0.1); });
    },
  };

  // ---------- Background music (public-domain classical pieces, arranged for soft harp) ----------
  function buildPrelude() {
    // J.S. Bach — Prelude in C major, BWV 846 (first 24 bars; bar 24's G7 leads back to bar 1).
    const bars = [
      [60, 64, 67, 72, 76], [60, 62, 69, 74, 77], [59, 62, 67, 74, 77], [60, 64, 67, 72, 76],
      [60, 64, 69, 76, 81], [60, 62, 66, 69, 74], [59, 62, 67, 74, 79], [59, 60, 64, 67, 72],
      [57, 60, 64, 67, 72], [50, 57, 62, 66, 72], [55, 59, 62, 67, 71], [55, 58, 64, 67, 73],
      [53, 57, 62, 69, 74], [53, 56, 62, 65, 71], [52, 55, 60, 67, 72], [52, 53, 57, 60, 65],
      [50, 53, 57, 60, 65], [43, 50, 55, 59, 65], [48, 52, 55, 60, 64], [48, 55, 58, 60, 64],
      [41, 53, 57, 60, 64], [42, 48, 57, 60, 63], [44, 53, 59, 60, 62], [43, 53, 55, 59, 62],
    ];
    const step = 0.21; // one sixteenth note — slow and calm
    const ev = [];
    bars.forEach((n, bi) => {
      for (let half = 0; half < 2; half++) {
        const t0 = (bi * 16 + half * 8) * step;
        ev.push({ t: t0, m: n[0], d: step * 8, v: 0.13, i: 'bass' });
        ev.push({ t: t0 + step, m: n[1], d: step * 7, v: 0.07, i: 'harp' });
        [n[2], n[3], n[4], n[2], n[3], n[4]].forEach((m, k) => ev.push({ t: t0 + (k + 2) * step, m, d: 1.6, v: 0.085, i: 'harp' }));
      }
    });
    return { events: ev, length: bars.length * 16 * step };
  }

  function buildTwinkle() {
    // W.A. Mozart — theme of "Ah vous dirai-je, Maman" (K. 265), music box over an Alberti bass.
    const q = 0.5;
    const melody = [
      72, 72, 79, 79, 81, 81, 79, null, 77, 77, 76, 76, 74, 74, 72, null,
      79, 79, 77, 77, 76, 76, 74, null, 79, 79, 77, 77, 76, 76, 74, null,
      72, 72, 79, 79, 81, 81, 79, null, 77, 77, 76, 76, 74, 74, 72, null,
    ];
    const C = [48, 55, 52, 55], F = [53, 60, 57, 60], G = [55, 62, 59, 62], G7 = [43, 53, 50, 53];
    const halves = [C, C, F, C, F, C, G, C, C, G7, C, G, C, G7, C, G, C, C, F, C, F, C, G, C];
    const ev = [];
    melody.forEach((m, i) => {
      if (m === null) return;
      const held = melody[i + 1] === null;
      ev.push({ t: i * q, m, d: held ? 1.8 : 1.1, v: 0.12, i: 'bell' });
    });
    halves.forEach((ch, h) => ch.forEach((m, k) => ev.push({ t: h * 2 * q + k * (q / 2), m, d: 0.7, v: 0.06, i: 'harp' })));
    return { events: ev, length: melody.length * q + q * 2 };
  }

  function buildCanon() {
    // Johann Pachelbel — Canon in D: the ground bass with harp arpeggios, then the famous upper line.
    const e = 0.32; // eighth note
    const chords = [
      [50, [62, 66, 69]], [45, [61, 64, 69]], [47, [62, 66, 71]], [42, [61, 66, 69]],
      [43, [62, 67, 71]], [38, [62, 66, 69]], [43, [62, 67, 71]], [45, [61, 64, 69]],
    ];
    const upper = [78, 76, 74, 73, 71, 69, 71, 73];
    const ev = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      chords.forEach(([root, tri], ci) => {
        const t0 = (cycle * 8 + ci) * 4 * e;
        ev.push({ t: t0, m: root, d: 4 * e + 0.3, v: 0.13, i: 'bass' });
        [tri[0], tri[1], tri[2], tri[1]].forEach((m, k) => ev.push({ t: t0 + k * e, m, d: 1.4, v: 0.07, i: 'harp' }));
        if (cycle >= 1) ev.push({ t: t0, m: upper[ci], d: 2.2, v: 0.1, i: 'bell' });
        if (cycle === 2) ev.push({ t: t0 + 2 * e, m: upper[ci] - 3 - (ci % 2), d: 1.4, v: 0.06, i: 'bell' });
      });
    }
    return { events: ev, length: 3 * 8 * 4 * e };
  }

  function buildMinuet() {
    // Minuet in G (from the Notebook for Anna Magdalena Bach), music box over a soft bass.
    const q = 0.52;
    const A = [
      [[74, 1], [67, 0.5], [69, 0.5], [71, 0.5], [72, 0.5]], [[74, 1], [67, 1], [67, 1]],
      [[76, 1], [72, 0.5], [74, 0.5], [76, 0.5], [78, 0.5]], [[79, 1], [67, 1], [67, 1]],
      [[72, 1], [74, 0.5], [72, 0.5], [71, 0.5], [69, 0.5]], [[71, 1], [72, 0.5], [71, 0.5], [69, 0.5], [67, 0.5]],
    ];
    const bars = [...A, [[66, 1], [67, 0.5], [69, 0.5], [71, 0.5], [67, 0.5]], [[69, 3]],
      ...A, [[69, 1], [71, 0.5], [69, 0.5], [67, 0.5], [66, 0.5]], [[67, 3]]];
    const bass = [55, 59, 60, 59, 57, 55, 50, 50, 55, 59, 60, 59, 57, 55, 50, 43];
    const ev = [];
    bars.forEach((bar, bi) => {
      let beat = bi * 3;
      ev.push({ t: beat * q, m: bass[bi], d: 3 * q, v: 0.12, i: 'bass' });
      ev.push({ t: (beat + 1) * q, m: bass[bi] + 7, d: 1.2, v: 0.045, i: 'harp' });
      ev.push({ t: (beat + 2) * q, m: bass[bi] + 12, d: 1.2, v: 0.045, i: 'harp' });
      bar.forEach(([m, len]) => { ev.push({ t: beat * q, m, d: Math.max(0.9, len * q * 1.6), v: 0.11, i: 'bell' }); beat += len; });
    });
    return { events: ev, length: bars.length * 3 * q + q };
  }

  function buildElise() {
    // Ludwig van Beethoven — "Für Elise" (opening theme), gently on harp.
    const s = 0.23; // sixteenth note
    const ev = [];
    let at = 0;
    const run = (notes, v = 0.1) => notes.forEach((m) => { ev.push({ t: at * s, m, d: 1.3, v, i: 'harp' }); at++; });
    const bar = (top, lh, rh) => {
      ev.push({ t: at * s, m: top, d: 1.6, v: 0.1, i: 'harp' });
      lh.forEach((m, k) => ev.push({ t: (at + k) * s, m, d: 1.2, v: 0.06, i: k === 0 ? 'bass' : 'harp' }));
      at += 3;
      run(rh);
    };
    const AM = [45, 52, 57], EM = [40, 52, 56];
    run([76, 75]);
    const phrase = (end) => {
      run([76, 75, 76, 71, 74, 72]);
      bar(69, AM, [60, 64, 69]);
      bar(71, EM, [64, 68, 71]);
      bar(72, AM, [64, 76, 75]);
      run([76, 75, 76, 71, 74, 72]);
      bar(69, AM, [60, 64, 69]);
      bar(71, EM, end);
    };
    phrase([64, 72, 71]);
    ev.push({ t: at * s, m: 69, d: 2.2, v: 0.1, i: 'harp' });
    AM.forEach((m, k) => ev.push({ t: (at + k) * s, m, d: 1.6, v: 0.06, i: k === 0 ? 'bass' : 'harp' }));
    at += 8;
    return { events: ev, length: at * s };
  }

  const SONGS = { prelude: buildPrelude, twinkle: buildTwinkle, canon: buildCanon, minuet: buildMinuet, elise: buildElise };

  const Music = {
    enabled: true,
    level: 0.65,
    wanted: null,
    song: null,
    timer: null,
    play(name) {
      this.wanted = name;
      if (this.song && this.song.name === name) return;
      this._stopNow();
      this._startIfWanted();
    },
    stop() { this.wanted = null; this._stopNow(); },
    setEnabled(on) {
      this.enabled = on;
      if (!on) this._stopNow();
      else this._startIfWanted();
    },
    duck(seconds, amount = 0.25) {
      if (!Audio.ctx || !this.song) return;
      const g = Audio.music.gain;
      const t = Audio.ctx.currentTime;
      // Overlapping ducks (e.g. a spoken sentence during the win tune) combine: deepest and longest wins.
      if (this.duckEnd > t) { amount = Math.min(amount, this.duckAmt); seconds = Math.max(seconds, this.duckEnd - t); }
      this.duckEnd = t + seconds;
      this.duckAmt = amount;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(this.level * amount, t + 0.3);
      g.setValueAtTime(this.level * amount, t + seconds);
      g.linearRampToValueAtTime(this.level, t + seconds + 1.5);
    },
    _startIfWanted() {
      if (!this.enabled || !this.wanted || this.song || !Audio.unlocked || !Audio.ctx) return;
      const built = SONGS[this.wanted]();
      const ctx = Audio.ctx;
      this.song = { name: this.wanted, ...built, idx: 0, start: ctx.currentTime + 0.3 };
      const g = Audio.music.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(0, ctx.currentTime);
      g.linearRampToValueAtTime(this.level, ctx.currentTime + 3);
      this.timer = setInterval(() => this._schedule(), 60);
      this._schedule();
    },
    _schedule() {
      const s = this.song;
      const ctx = Audio.ctx;
      if (!s || !ctx || ctx.state !== 'running') return;
      const horizon = ctx.currentTime + 0.35;
      let guard = 0;
      while (guard++ < 200) {
        const e = s.events[s.idx];
        const at = s.start + e.t;
        if (at > horizon) break;
        if (at >= ctx.currentTime - 0.05) Inst[e.i](Audio.music, e.m, at, e.d, e.v);
        s.idx++;
        if (s.idx >= s.events.length) { s.idx = 0; s.start += s.length; }
      }
    },
    _stopNow() {
      clearInterval(this.timer);
      this.timer = null;
      this.duckEnd = 0;
      if (this.song && Audio.ctx) {
        const g = Audio.music.gain;
        const t = Audio.ctx.currentTime;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(0, t + 0.4);
      }
      this.song = null;
    },
  };

  // Browsers only allow sound after the first key press or click.
  ['keydown', 'pointerdown', 'touchend', 'click'].forEach((type) => window.addEventListener(type, () => {
    Audio.unlock();
    if (type !== 'pointerdown') Voice.prime();
  }, { capture: true }));

  // ---------- Device: phones/tablets get touch controls; laptops keep the keyboard ----------
  const isTouch = (() => {
    try {
      return window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches);
    } catch (e) {
      return false;
    }
  })();
  document.documentElement.classList.add(isTouch ? 'touch' : 'no-touch');
  const isStandalone = !!(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
  if (isStandalone) document.documentElement.classList.add('standalone');

  // Offline support + "Add to Home Screen" app: a network-first service worker at the site root.
  try {
    const here = document.currentScript && document.currentScript.src;
    if (here && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      const swUrl = new URL('../sw.js', here);
      window.addEventListener('load', () => navigator.serviceWorker.register(swUrl.href, { scope: new URL('../', here).pathname }).catch(() => {}));
    }
  } catch (e) { /* ignore */ }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Voice.stop();
    if (!Audio.ctx) return;
    if (document.hidden) Audio.ctx.suspend();
    else Audio.ctx.resume();
  });

  // ---------- Read aloud (helps early readers) ----------
  // First choice: a natural neural voice from the family's Cloudflare Worker (Deepgram Aura-2 for
  // English, MeloTTS for Chinese), played through Web Audio. Each phrase is fetched once and reused.
  // Fallback (offline, slow network, or turned off): the best voice installed on the device —
  // Premium / Enhanced voices first, never the novelty or robotic ones.
  const NATURAL_VOICES = [
    { id: 'luna', label: 'Luna (warm, friendly)' },
    { id: 'thalia', label: 'Thalia (bright, cheerful)' },
    { id: 'athena', label: 'Athena (calm, clear)' },
    { id: 'helena', label: 'Helena (gentle)' },
    { id: 'aurora', label: 'Aurora (soft)' },
    { id: 'apollo', label: 'Apollo (friendly man)' },
    { id: 'orion', label: 'Orion (calm man)' },
  ];
  const ROBOT_VOICES = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Ralph|Kathy|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley|Deranged|Hysterical/i;
  const CLOUD_WAIT_MS = 5000; // how long to wait for the natural voice before using the device voice

  function voiceScore(v, lang) {
    const want = lang.toLowerCase();
    const have = (v.lang || '').toLowerCase().replace('_', '-');
    if (!have.startsWith(want.slice(0, 2))) return -1;
    if (ROBOT_VOICES.test(v.name)) return -1;
    let score = 0;
    if (have === want) score += 20;
    if (want === 'zh-cn' && /hk|mo|yue/.test(have)) return -1; // Cantonese voices can't read Mandarin text
    if (want === 'zh-cn' && /tw/.test(have)) score -= 15;
    if (/Premium/i.test(v.name)) score += 100;
    if (/Enhanced|Neural|Natural/i.test(v.name)) score += 80;
    if (/Ava|Zoe|Allison|Susan|Evan|Nathan|Joelle|Noelle|Samantha|Lili|Tingting|Yu-shu|Li-mu/i.test(v.name)) score += 15;
    if (/Google/i.test(v.name)) score += 25;
    if (v.localService) score += 3;
    return score;
  }

  const Voice = {
    enabled: true,
    natural: true,
    speaker: 'luna',
    voices: NATURAL_VOICES,
    queue: [],
    busy: false,
    gen: 0,
    source: null,
    cancelWait: null,
    sysDone: null,
    primed: false,
    cloudDownUntil: 0,
    cloudNote: '',
    cache: new Map(),

    // iOS only lets speech start inside a tap/click/key press: speak a silent phrase on the first one.
    prime() {
      if (this.primed || !('speechSynthesis' in window)) return;
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
        this.primed = true;
      } catch (e) { /* ignore */ }
    },

    voiceFor(lang) {
      try {
        let best = null;
        let bestScore = -1;
        for (const v of speechSynthesis.getVoices()) {
          const sc = voiceScore(v, lang);
          if (sc > bestScore) { best = v; bestScore = sc; }
        }
        return best;
      } catch (e) {
        return null;
      }
    },

    // Name of the voice that will be used, for the grown-ups corner.
    describe(lang = 'en-US') {
      if (this.natural && this.cloudNote && !this.cloudOk()) {
        const v = this.voiceFor(lang);
        return `${v ? v.name : 'device voice'} (${this.cloudNote})`;
      }
      if (this.cloudOk()) {
        if (lang.toLowerCase().startsWith('zh')) return 'Natural Chinese voice (MeloTTS)';
        const v = NATURAL_VOICES.find((x) => x.id === this.speaker);
        return `Natural voice: ${v ? v.label : this.speaker}`;
      }
      const v = this.voiceFor(lang);
      return v ? v.name : 'default voice';
    },

    cloudOk() {
      return this.natural && /^https?:$/.test(location.protocol) && navigator.onLine !== false && Date.now() >= this.cloudDownUntil;
    },

    // After a failure, use the device voice for a while instead of making every sentence wait.
    cloudTrouble(kind) {
      if (kind === 'busy') {
        // Too many new phrases in a minute (e.g. fast dragging): wait a little, not until tomorrow.
        this.cloudDownUntil = Math.max(this.cloudDownUntil, Date.now() + 20000);
        this.cloudNote = '';
      } else if (kind === 'quota') {
        const tomorrow = new Date();
        tomorrow.setUTCHours(24, 5, 0, 0);
        this.cloudDownUntil = tomorrow.getTime();
        this.cloudNote = "today's natural-voice allowance is used up";
      } else {
        this.cloudDownUntil = Date.now() + 60000;
        this.cloudNote = '';
      }
    },

    clean(text) {
      return String(text || '')
        .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
        .replace(/[⬆⬇⬅➡↩↔⟲⟳✔✅]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    },

    say(text, lang = 'en-US', { interrupt = false } = {}) {
      text = this.clean(text);
      if (!this.enabled || !text) return;
      if (interrupt) this.stop();
      const item = { text, lang, gen: this.gen };
      if (this.cloudOk()) {
        if (this.cache.has(this.cacheKey(text, lang))) item.audio = this.fetchAudio(text, lang);
        else {
          // A brand-new phrase: wait a moment before asking the server, so a phrase that is
          // replaced straight away (fast dragging, quick taps) never uses up the voice allowance.
          item.audio = new Promise((resolve) => setTimeout(() => {
            resolve(item.gen === this.gen ? this.fetchAudio(text, lang) : null);
          }, interrupt ? 180 : 0));
        }
      }
      this.queue.push(item);
      this.pump();
    },

    cacheKey(text, lang) {
      const zh = lang.toLowerCase().startsWith('zh');
      return `${zh ? 'zh' : 'en'}|${zh ? '' : this.speaker}|${text}`;
    },

    fetchAudio(text, lang) {
      const zh = lang.toLowerCase().startsWith('zh');
      const key = this.cacheKey(text, lang);
      if (this.cache.has(key)) return this.cache.get(key);
      const url = `${CLOUD}/tts?lang=${zh ? 'zh' : 'en'}&voice=${encodeURIComponent(this.speaker)}&text=${encodeURIComponent(text)}`;
      const p = fetch(url)
        .then(async (r) => {
          if (!r.ok) {
            const body = await r.text().catch(() => '');
            // 429 = "slow down" (too many new phrases this minute); 503 ai-quota = today's allowance is used up.
            const kind = r.status === 429 ? 'busy' : (r.status === 503 || /allocation|quota|4006/i.test(body)) ? 'quota' : 'error';
            this.cloudTrouble(kind);
            throw new Error('tts ' + r.status);
          }
          return r.arrayBuffer();
        })
        .then((buf) => {
          const ctx = Audio.init();
          if (!ctx) throw new Error('no audio');
          return new Promise((resolve, reject) => {
            const r = ctx.decodeAudioData(buf, resolve, reject);
            if (r && r.catch) r.catch(() => {}); // newer browsers also return a promise
          });
        })
        .catch(() => { this.cache.delete(key); if (Date.now() >= this.cloudDownUntil) this.cloudTrouble('error'); return null; });
      this.cache.set(key, p);
      if (this.cache.size > 150) this.cache.delete(this.cache.keys().next().value);
      return p;
    },

    async pump() {
      if (this.busy) return;
      const item = this.queue.shift();
      if (!item) return;
      this.busy = true;
      try {
        let buffer = null;
        if (item.audio && item.gen === this.gen) {
          const cancelled = new Promise((resolve) => { this.cancelWait = resolve; });
          // The wait starts when this phrase's turn comes, so a queue of phrases doesn't time out.
          const wait = CLOUD_WAIT_MS;
          let timedOut = false;
          buffer = await Promise.race([item.audio, cancelled, new Promise((r) => setTimeout(() => { timedOut = true; r(null); }, wait))]);
          this.cancelWait = null;
          if (timedOut && !buffer) this.cloudTrouble('error');
        }
        if (item.gen === this.gen && !document.hidden) {
          const ctx = Audio.ctx;
          if (buffer && ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
            try { await ctx.resume(); } catch (e) { /* ignore */ }
          }
          if (item.gen !== this.gen) { /* interrupted while waiting — say nothing */ }
          else if (buffer && ctx && ctx.state === 'running') await this.playBuffer(buffer);
          else await this.systemSay(item.text, item.lang);
        }
      } catch (e) { /* ignore */ }
      this.busy = false;
      this.pump();
    },

    playBuffer(buffer) {
      return new Promise((resolve) => {
        const ctx = Audio.ctx;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(Audio.master);
        let finished = false;
        const done = () => { if (finished) return; finished = true; clearTimeout(guard); if (this.source === src) this.source = null; resolve(); };
        const guard = setTimeout(() => { try { src.stop(); } catch (e) { /* ignore */ } done(); }, buffer.duration * 1000 + 1500);
        src.onended = done;
        this.source = src;
        this.sourceDone = done;
        Music.duck(buffer.duration + 0.2, 0.4);
        src.start();
      });
    },

    systemSay(text, lang) {
      return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) { resolve(); return; }
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = lang;
          u.rate = lang.startsWith('zh') ? 0.9 : 1.0;
          u.pitch = 1.05;
          const v = this.voiceFor(lang);
          if (v) u.voice = v;
          const done = () => { clearTimeout(t); if (this.sysDone === done) this.sysDone = null; resolve(); };
          const t = setTimeout(done, 1500 + text.length * 120);
          this.sysDone = done;
          u.onend = done;
          u.onerror = done;
          speechSynthesis.speak(u);
        } catch (e) { resolve(); }
      });
    },

    stop() {
      this.gen++;
      this.queue = [];
      if (this.cancelWait) { this.cancelWait(null); this.cancelWait = null; }
      if (this.source) {
        const done = this.sourceDone;
        try { this.source.stop(); } catch (e) { /* ignore */ }
        this.source = null;
        if (done) done();
      }
      try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      if (this.sysDone) { const d = this.sysDone; this.sysDone = null; d(); }
    },
  };
  try {
    speechSynthesis.getVoices();
    if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', () => speechSynthesis.getVoices());
  } catch (e) { /* warm up voice list */ }

  function applySettings(settings) {
    Sound.enabled = !!settings.sound;
    Voice.enabled = !!settings.voice;
    Voice.natural = settings.naturalVoice !== false;
    if (NATURAL_VOICES.some((v) => v.id === settings.voiceName)) Voice.speaker = settings.voiceName;
    Music.setEnabled(settings.music !== false);
  }

  // ---------- Money formatting ----------
  function cents(c) { return `${c}¢`; }
  function dollars(c) { return `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`; }
  function money(c, format) { return format === 'dollars' ? dollars(c) : cents(c); }

  function moneyWords(c) {
    const d = Math.floor(c / 100);
    const r = c % 100;
    const parts = [];
    if (d) parts.push(`${d} ${d === 1 ? 'dollar' : 'dollars'}`);
    if (r || !d) parts.push(`${r} ${r === 1 ? 'cent' : 'cents'}`);
    return parts.join(' and ');
  }

  // ---------- Chinese numbers (for the Mandarin immersion connection) ----------
  const DIGITS = '零一二三四五六七八九';

  function zhUnder10000(n, leading) {
    const units = ['千', '百', '十', ''];
    const ds = [Math.floor(n / 1000) % 10, Math.floor(n / 100) % 10, Math.floor(n / 10) % 10, n % 10];
    let s = '';
    let started = false;
    let pendingZero = false;
    for (let i = 0; i < 4; i++) {
      const dg = ds[i];
      if (dg === 0) {
        if (started) pendingZero = true;
        continue;
      }
      if (pendingZero) { s += '零'; pendingZero = false; }
      // 10–19 are read 十, 十一 … not 一十一 when they lead the number.
      if (!(i === 2 && dg === 1 && !started && leading)) s += DIGITS[dg];
      s += units[i];
      started = true;
    }
    return s;
  }

  function zhNumber(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return '零';
    if (n >= 10000) {
      const hi = Math.floor(n / 10000);
      const lo = n % 10000;
      return zhNumber(hi) + '万' + (lo === 0 ? '' : (lo < 1000 ? '零' : '') + zhUnder10000(lo, false));
    }
    return zhUnder10000(n, true);
  }

  // Cents as spoken in Chinese: under a dollar → 四十七分; a dollar or more → 一元三角五分 (角 = dime).
  function zhMoney(c) {
    if (c < 100) return zhNumber(c) + '分';
    const y = Math.floor(c / 100);
    const j = Math.floor((c % 100) / 10);
    const f = c % 10;
    let s = zhNumber(y) + '元';
    if (j) s += DIGITS[j] + '角';
    else if (f) s += '零';
    if (f) s += DIGITS[f] + '分';
    return s;
  }

  const PRAISE = [
    { zh: '太棒了!', py: 'tài bàng le', en: 'Awesome!' },
    { zh: '真厉害!', py: 'zhēn lìhai', en: 'So good!' },
    { zh: '好极了!', py: 'hǎo jí le', en: 'Excellent!' },
    { zh: '你真棒!', py: 'nǐ zhēn bàng', en: "You're great!" },
  ];
  const CHEER = { zh: '加油!', py: 'jiāyóu', en: 'You can do it!' };

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  window.MQ = {
    HEROES, heroId, heroInfo, load, save, exportFile, importText, reset, unlockedHeroes,
    Audio, Sound, Music, Voice, Sync, applySettings,
    cents, dollars, money, moneyWords, zhNumber, zhMoney,
    PRAISE, CHEER, pick, escapeHtml, isTouch, isStandalone,
    get _live() { return live; }, // for automated tests
  };
})();
