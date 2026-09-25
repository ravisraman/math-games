/* Math Quest — shared helpers used by the portal and every game:
   save data (localStorage), sound effects, read-aloud, money + Chinese number formatting. */
(function () {
  'use strict';

  const KEY = 'mathQuest.save.v1';

  // Heroes unlock as the player earns stars across all games.
  const HEROES = [
    { emoji: '🐥', name: 'Chick', stars: 0 },
    { emoji: '🐸', name: 'Frog', stars: 10 },
    { emoji: '🐼', name: 'Panda', stars: 25 },
    { emoji: '🐯', name: 'Tiger', stars: 45 },
    { emoji: '🐲', name: 'Dragon', stars: 70 },
    { emoji: '🦄', name: 'Unicorn', stars: 100 },
    { emoji: '🤖', name: 'Robot', stars: 140 },
    { emoji: '🦖', name: 'T-Rex', stars: 200 },
  ];

  function defaults() {
    return {
      version: 1,
      player: { name: '', hero: '🐥' },
      settings: { sound: true, voice: true, chinese: true },
      stars: 0,
      playSeconds: 0,
      games: {},
    };
  }

  function load() {
    const d = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return d;
      const s = JSON.parse(raw);
      return {
        ...d,
        ...s,
        player: { ...d.player, ...(s.player || {}) },
        settings: { ...d.settings, ...(s.settings || {}) },
        games: s.games || {},
      };
    } catch (e) {
      return d;
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function exportFile(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
    localStorage.setItem(KEY, JSON.stringify(s));
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function unlockedHeroes(stars) {
    return HEROES.filter((h) => stars >= h.stars);
  }

  // ---------- Sound effects (synthesized, no audio files needed) ----------
  const Sound = {
    enabled: true,
    ctx: null,
    ensure() {
      if (!this.enabled) return null;
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) {
        return null;
      }
      return this.ctx;
    },
    tone(freq, dur, type = 'sine', vol = 0.12, when = 0) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + when;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    },
    hop() { this.tone(520, 0.06, 'triangle', 0.05); },
    coin() { this.tone(988, 0.08, 'square', 0.05); this.tone(1319, 0.18, 'square', 0.05, 0.07); },
    putBack() { this.tone(660, 0.08, 'triangle', 0.08); this.tone(440, 0.12, 'triangle', 0.08, 0.07); },
    nope() { this.tone(220, 0.12, 'triangle', 0.1); this.tone(196, 0.18, 'triangle', 0.1, 0.12); },
    bonk() { this.tone(150, 0.25, 'sawtooth', 0.08); this.tone(110, 0.3, 'sine', 0.12, 0.05); },
    open() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.1, i * 0.09)); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.1, i * 0.1)); },
    click() { this.tone(880, 0.04, 'triangle', 0.05); },
    star() { this.tone(1568, 0.12, 'sine', 0.08); this.tone(2093, 0.2, 'sine', 0.06, 0.08); },
  };

  // ---------- Read aloud (helps early readers) ----------
  const Voice = {
    enabled: true,
    voiceFor(lang) {
      try {
        const voices = speechSynthesis.getVoices();
        const prefix = lang.slice(0, 2);
        return (
          voices.find((v) => v.lang === lang && /Samantha|Tingting|Ting-Ting|Meijia|Google/.test(v.name)) ||
          voices.find((v) => v.lang === lang) ||
          voices.find((v) => v.lang && v.lang.startsWith(prefix)) ||
          null
        );
      } catch (e) {
        return null;
      }
    },
    say(text, lang = 'en-US', { interrupt = false } = {}) {
      if (!this.enabled || !text || !('speechSynthesis' in window)) return;
      try {
        if (interrupt) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        u.rate = lang.startsWith('zh') ? 0.85 : 0.95;
        const v = this.voiceFor(lang);
        if (v) u.voice = v;
        speechSynthesis.speak(u);
      } catch (e) { /* ignore */ }
    },
    stop() {
      try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    },
  };
  try { speechSynthesis.getVoices(); } catch (e) { /* warm up voice list */ }

  function applySettings(settings) {
    Sound.enabled = !!settings.sound;
    Voice.enabled = !!settings.voice;
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
    HEROES, load, save, exportFile, importText, reset, unlockedHeroes,
    Sound, Voice, applySettings,
    cents, dollars, money, moneyWords, zhNumber, zhMoney,
    PRAISE, CHEER, pick, escapeHtml,
  };
})();
