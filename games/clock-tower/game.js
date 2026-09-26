/* Clock Tower — the child is the village clock keeper. Each round is a climb of 8 floors:
   set the clock, read it, match "quarter past / quarter to" words, and work out elapsed time.
   Every right answer lights the next window; reaching the top rings the big bell.
   Times are kept as minutes on a 12-hour dial: 0 = 12:00, 90 = 1:30, 719 = 12:59. */
(function () {
  'use strict';

  // ---------- Board geometry (sized for a 13" laptop window) ----------
  const W = 1040;
  const H = 760;
  const GAME_ID = 'clockTower';
  const FLOORS = 8;
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const ZH_FONT = '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Heiti SC",sans-serif';
  // The laptop board is 760 tall and as wide as the window allows (at least 1040): the extra width
  // is shared out as room around the tower, the clock and the answer column (see deskLayout).
  let CX = 530;              // big clock centre
  const CY = 456;
  const R = 216;             // clock face radius (brass bezel sits outside this)
  const COL = { x: 818, w: 206 };             // right-hand column: choices / controls
  const BANNER = { x: 252, y: 12, w: 776, h: 128 };
  let TX = 0;                // laptop: the tower (and hero) are drawn shifted right by this much
  const T_CX = 126;          // tower centre line
  const T_LEFT = 40;
  const T_RIGHT = 212;
  const T_TOP = 206;         // top of the tower body (belfry sits above)
  const GROUND = 726;
  const HOUR_COLOR = '#e0473c';
  const MIN_COLOR = '#2f6fd6';

  // ---------- Phone layouts ----------
  // 'desk' is the original 1040×760 board. On phones the same canvas is drawn in CSS pixels with
  // its own composition ('portrait' or 'landscape'): the clock, tower and banner are the same
  // drawings placed with transforms, plus big touch buttons under / beside the clock.
  let mode = 'desk';
  let LW = W;                // canvas size in drawing units (board units on desk, CSS px on phones)
  let LH = H;
  let PL = null;             // phone layout geometry (see computeLayout)
  const HUD_H = 52;          // room for the HTML HUD strip on phones
  const CLOCK_OUT = R + 64;  // clock radius including the ":05" labels, in board units
  const isPhone = () => mode !== 'desk';

  const SKILLS = {
    set: 'Setting the clock',
    read: 'Reading the clock',
    words: 'Quarter past / to',
    elapsed: 'Elapsed time',
    ampm: 'a.m. / p.m.',
  };

  // ---------- Save data ----------
  const data = MQ.load();
  MQ.applySettings(data.settings);
  const g = (data.games[GAME_ID] = Object.assign(
    { level: 1, maxLevel: 1, played: 0, seconds: 0, history: [], skills: {} },
    data.games[GAME_ID] || {}
  ));
  g.lowRounds = g.lowRounds || 0;
  const heroId = MQ.heroId(data.player.hero);
  MQ.Art.preload(heroId);
  function persist() { MQ.save(data); }

  // ---------- DOM ----------
  const canvas = document.getElementById('board');
  let ctx = canvas.getContext('2d'); // swapped briefly while a cached layer is painted
  const stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
  const el = (id) => document.getElementById(id);
  const UI_FONT = getComputedStyle(document.body).fontFamily;

  // ---------- Helpers ----------
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const pad = (n) => String(n).padStart(2, '0');

  // ---------- Time logic ----------
  const norm = (t) => ((Math.round(t) % 720) + 720) % 720;
  const T = (h, m) => norm((h % 12) * 60 + m);
  const hourOf = (t) => Math.floor(norm(t) / 60) || 12;
  const minOf = (t) => norm(t) % 60;
  const fmt = (t) => `${hourOf(t)}:${pad(minOf(t))}`;
  // Hand angles in degrees, clockwise from 12. The hour hand moves smoothly with the minutes.
  const hourAngle = (t) => ((((t % 720) + 720) % 720) / 720) * 360;
  const minuteAngle = (t) => ((((t % 60) + 60) % 60) / 60) * 360;
  // Signed shortest move on the dial from a to b, in (-360, 360].
  function shortest(a, b) {
    let d = norm(b - a);
    if (d > 360) d -= 720;
    return d;
  }

  function speakTime(t) {
    const h = hourOf(t);
    const m = minOf(t);
    if (m === 0) return `${h} o'clock`;
    if (m < 10) return `${h} oh ${m}`;
    return `${h} ${m}`;
  }

  // 3:30 → 三点半, 3:15 → 三点一刻, 3:45 → 三点四十五分, 2:00 → 两点, 3:05 → 三点零五分
  function zhHour(h) { return h === 2 ? '两' : MQ.zhNumber(h); }
  function zhTime(t) {
    const h = hourOf(t);
    const m = minOf(t);
    const base = `${zhHour(h)}点`;
    if (m === 0) return base;
    if (m === 30) return base + '半';
    if (m === 15) return base + '一刻';
    if (m < 10) return `${base}零${MQ.zhNumber(m)}分`;
    return `${base}${MQ.zhNumber(m)}分`;
  }
  function zhDur(d) {
    const h = Math.floor(d / 60);
    const m = d % 60;
    let s = '';
    if (h) s += `${zhHour(h)}个小时`;
    if (m) s += `${MQ.zhNumber(m)}分钟`;
    return s;
  }

  function durText(d) {
    const h = Math.floor(d / 60);
    const m = d % 60;
    if (!h) return `${m} min`;
    if (!m) return `${h} hour${h > 1 ? 's' : ''}`;
    return `${h} hr ${m} min`;
  }
  function durWords(d) {
    const h = Math.floor(d / 60);
    const m = d % 60;
    const parts = [];
    if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
    if (m) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
    return parts.join(' and ');
  }

  // Clock words: "quarter past 4", "half past 7", "quarter to 9", "10 past 3", "20 to 5".
  function wordsFor(t) {
    const h = hourOf(t);
    const m = minOf(t);
    const nx = hourOf(t + 60);
    if (m === 0) return `${h} o'clock`;
    if (m === 30) return `half past ${h}`;
    if (m === 15) return `quarter past ${h}`;
    if (m === 45) return `quarter to ${nx}`;
    if (m < 30) return `${m} past ${h}`;
    return `${60 - m} to ${nx}`;
  }

  // ---------- Level design ----------
  const EVERY5 = Array.from({ length: 12 }, (_, i) => i * 5);
  const EVERY1 = Array.from({ length: 60 }, (_, i) => i);
  const MAX_LEVEL = 12;

  function cfgFor(level) {
    const L = Math.max(1, Math.min(MAX_LEVEL, level | 0));
    const c = { L, step: 5, labels: 1, elapsed: null, oddStart: false };
    if (L === 1) {
      Object.assign(c, {
        minutes: [0, 30], words: ['oclock', 'half', 'half'], mix: { set: 3, read: 3, words: 2 },
        title: "O'clock & half past", desc: 'Set and read times like 3:00 and 3:30.',
        pic: ['🕒 3:00', '🕞 3:30'], speak: "Set and read times like 3 o'clock and half past 3.",
      });
    } else if (L === 2) {
      Object.assign(c, {
        minutes: [0, 15, 30, 45, 15, 45], words: ['half', 'qpast', 'qto', 'qpast', 'qto'], mix: { set: 3, read: 3, words: 3 },
        title: 'Quarter past & quarter to', desc: 'Quarter past = :15. Quarter to = :45.',
        pic: ['🕒 3:15', '🕞 3:45'], speak: 'Quarter past is 15 minutes. Quarter to is 45 minutes.',
      });
    } else if (L === 3) {
      Object.assign(c, {
        minutes: EVERY5, words: ['half', 'qpast', 'qto'], mix: { set: 3, read: 3, words: 1 },
        title: 'Every 5 minutes', desc: 'Any time on a 5-minute mark. Count by 5s!',
        pic: ['🕒 3:05', '3:10', '3:25'], speak: 'Any time on a 5 minute mark. Count by fives!',
      });
    } else if (L === 4) {
      Object.assign(c, {
        minutes: EVERY5, labels: 0.6, elapsed: 'hours', words: ['half', 'qpast', 'qto'],
        mix: { set: 2, read: 2, words: 1, elapsed: 3, ampm: 1 },
        title: 'How much later? (hours)', desc: 'Add whole hours and half hours. Morning (a.m.) or night (p.m.)?',
        pic: ['🕒 3:00 + 2 h', '☀️ / 🌙'], speak: 'How much later? Add hours and half hours. Is it morning or night?',
      });
    } else if (L === 5) {
      Object.assign(c, {
        minutes: EVERY5, labels: 0.4, elapsed: 'steps', words: ['qpast', 'qto', 'npast', 'nto'],
        mix: { set: 2, read: 2, words: 1, elapsed: 3, ampm: 1 },
        title: 'Later by 5s & 15s', desc: 'Add minutes — even past the next hour, like 2:45 + 30 minutes.',
        pic: ['🕒 2:45 + 30 min'], speak: 'Add minutes, even past the next hour, like 2 45 plus 30 minutes.',
      });
    } else if (L === 6) {
      Object.assign(c, {
        minutes: EVERY1, step: 1, labels: 0.2, elapsed: 'steps', words: ['qpast', 'qto', 'npast', 'nto'],
        mix: { set: 3, read: 3, words: 1, elapsed: 2, ampm: 1 },
        title: 'To the exact minute', desc: 'Read and set times like 3:37. Count the little ticks!',
        pic: ['🕒 3:37'], speak: 'Read and set times to the exact minute, like 3 37. Count the little ticks!',
      });
    } else {
      Object.assign(c, {
        minutes: EVERY1, step: 1, labels: 0, elapsed: 'hard', words: ['qpast', 'qto', 'npast', 'nto'], oddStart: L >= 8,
        mix: { set: 2, read: 2, words: 1, elapsed: 3, ampm: 1 },
        title: 'Clock master', desc: 'Everything mixed, with trickier elapsed time — even past 12!',
        pic: ['🕒 3:37', '11:40 + 50 min'], speak: 'Clock master! Everything mixed, even past 12 o\'clock!',
      });
    }
    return c;
  }

  function randTime(c) {
    let m = pick(c.minutes);
    // At the 1-minute levels most times should really need tick counting.
    if (c.step === 1 && Math.random() < 0.75) m = rand(0, 11) * 5 + rand(1, 4);
    return T(rand(1, 12), m);
  }

  // Where the hands start for a set-the-clock question: on the step grid, away from the answer.
  function startFor(target, c) {
    for (let i = 0; i < 80; i++) {
      // At 1-minute steps keep the long hand within a few numbers of the answer (less key-holding).
      if (c.step === 1) {
        const s1 = T(rand(1, 12), minOf(target) + pick([-1, 1]) * rand(4, 20));
        if (Math.abs(shortest(s1, target)) >= 20 && hourOf(s1) !== hourOf(target)) return s1;
        continue;
      }
      const s = c.L <= 2 ? T(rand(1, 12), pick([0, 0, 30])) : T(rand(1, 12), rand(0, 11) * 5);
      if (Math.abs(shortest(s, target)) >= 20 && minOf(s) !== minOf(target) && hourOf(s) !== hourOf(target)) return s;
    }
    return norm(target + 200);
  }

  // Three choices where the answer's place in size order (smallest / middle / biggest) is random,
  // so "always pick the middle one" or "always pick the earliest" can't win. `cands` are classic
  // mistakes (tried first), `fallback` near misses; all are numbers (minutes), shown with `show`.
  // `key` is how big the choice *looks* (12:30 looks bigger than 1:30).
  const looksClock = (t) => hourOf(t) * 60 + minOf(t);
  function buildRanked(correct, cands, fallback, show, key) {
    const ct = show(correct);
    const ck = key(correct);
    const seen = new Set([ct]);
    const pool = [];
    for (const x of [...cands, ...fallback]) {
      const tx = show(x);
      if (seen.has(tx) || key(x) === ck) continue;
      seen.add(tx);
      pool.push(x);
    }
    const lo = pool.filter((x) => key(x) < ck);
    const hi = pool.filter((x) => key(x) > ck);
    const ranks = [0, 1, 2].filter((r) => lo.length >= r && hi.length >= 2 - r);
    const r = ranks.length ? pick(ranks) : Math.min(lo.length, 2);
    // Keep the first classic mistake in when that rank allows it.
    const take = (arr, n) => (n <= 0 ? [] : arr.slice(0, n));
    const picks = [...take(lo, r), ...take(hi, 2 - r)];
    for (const x of pool) { if (picks.length >= 2) break; if (!picks.includes(x)) picks.push(x); }
    const out = shuffle([ct, ...picks.slice(0, 2).map(show)]);
    return { options: out, answerIdx: out.indexOf(ct), answer: ct };
  }

  // Three options built from two features (e.g. hour and minutes) as a "corner":
  // {(a1,b1), (a1,b2), (a2,b2)}. Every option has a different majority/minority pattern, and the
  // answer takes a random corner, so "pick the odd one out" or "pick the one most like the others"
  // is a coin toss. `roles` limits which corners the answer may take.
  function cornerTriple(ans, a2, b2, roles = [0, 1, 2]) {
    const [a, b] = ans;
    const role = pick(roles);
    if (role === 0) return [[a, b], [a, b2], [a2, b2]];   // answer = (a1,b1)
    if (role === 1) return [[a, b], [a, b2], [a2, b]];    // answer = (a1,b2): others (a1,b1'),(a2',b2)
    return [[a, b], [a2, b2], [a2, b]];                    // answer = (a2,b2): others (a1',b1'),(a1',b2)
  }

  // ---------- Explanations (short, friendly, one idea per line) ----------
  function explainTime(t) {
    const h = hourOf(t);
    const m = minOf(t);
    const nx = hourOf(t + 60);
    const lines = [];
    if (m === 0) lines.push(`The short red hand points at ${h}.`);
    else lines.push(`The short red hand is past ${h}, not at ${nx} yet → ${h}.`);
    const n = Math.floor(m / 5);
    const extra = m % 5;
    if (m === 0) lines.push(`The long blue hand is on 12 → ${h} o'clock.`);
    else if (!extra) lines.push(`The long blue hand is on ${n} → count by 5s: ${m} minutes.`);
    else if (!n) lines.push(`The long blue hand is ${m} tick${m > 1 ? 's' : ''} past 12 → ${m} minutes.`);
    else lines.push(`The long blue hand is ${extra} tick${extra > 1 ? 's' : ''} past ${n} → ${n * 5} + ${extra} = ${m} minutes.`);
    return lines;
  }

  function explainWords(t) {
    const h = hourOf(t);
    const m = minOf(t);
    const nx = hourOf(t + 60);
    const f = fmt(t);
    if (m === 0) return [`${h} o'clock: the long hand is on 12 → ${f}.`];
    if (m === 30) return [`Half past ${h} = 30 minutes after ${h} → ${f}.`, 'The long hand points at 6.'];
    if (m === 15) return [`Quarter past ${h} = 15 minutes after ${h} → ${f}.`, 'The long hand points at 3.'];
    if (m === 45) return [`Quarter to ${nx} = 15 minutes before ${nx} → ${f}.`, 'The long hand points at 9.'];
    if (m < 30) return [`${m} past ${h} = ${m} minutes after ${h} → ${f}.`];
    return [`${60 - m} to ${nx} = ${60 - m} minutes before ${nx} → ${f}.`];
  }

  // Counting on: "2:45 + 15 min → 3:00, then + 15 min → 3:15".
  function explainForward(a, d) {
    const parts = [];
    let cur = a;
    let rem = d;
    const hrs = Math.floor(rem / 60);
    if (hrs) {
      parts.push(`${fmt(cur)} + ${hrs} hour${hrs > 1 ? 's' : ''} → ${fmt(cur + hrs * 60)}`);
      cur += hrs * 60;
      rem -= hrs * 60;
    }
    if (rem) {
      const toHour = 60 - minOf(cur);
      if (minOf(cur) && rem > toHour) {
        parts.push(`${parts.length ? '' : fmt(cur) + ' '}+ ${toHour} min → ${fmt(cur + toHour)}`);
        parts.push(`+ ${rem - toHour} min → ${fmt(cur + rem)}`);
      } else {
        parts.push(`${parts.length ? '' : fmt(cur) + ' '}+ ${rem} min → ${fmt(cur + rem)}`);
      }
    }
    return parts.join(', then ').replace(/\s+/g, ' ').trim();
  }
  function explainBackward(b, d) {
    const parts = [];
    let cur = b;
    let rem = d;
    const hrs = Math.floor(rem / 60);
    if (hrs) {
      parts.push(`${fmt(cur)} − ${hrs} hour${hrs > 1 ? 's' : ''} → ${fmt(cur - hrs * 60)}`);
      cur -= hrs * 60;
      rem -= hrs * 60;
    }
    if (rem) {
      const back = minOf(cur);
      if (back && rem > back) {
        parts.push(`${parts.length ? '' : fmt(cur) + ' '}− ${back} min → ${fmt(cur - back)}`);
        parts.push(`− ${rem - back} min → ${fmt(cur - rem)}`);
      } else {
        parts.push(`${parts.length ? '' : fmt(cur) + ' '}− ${rem} min → ${fmt(cur - rem)}`);
      }
    }
    return parts.join(', then ').replace(/\s+/g, ' ').trim();
  }

  // ---------- Question makers ----------
  function readMistakes(t) {
    const h = hourOf(t);
    const m = minOf(t);
    const first = [];
    const rest = [];
    if (m >= 30) first.push(t + 60); // the hour hand is close to the next number
    if (m % 5 === 0) rest.push(T(m === 0 ? 12 : m / 5, (h % 12) * 5)); // hands swapped
    if (m % 5 === 0 && m > 0 && m / 5 < 10) rest.push(T(h, m / 5)); // read the number, not the minutes
    if (m % 5 !== 0) rest.push(t + 5, t - 5); // counted ticks from the wrong number
    if (m > 0 && m < 30) rest.push(t - 60);
    return [...first, ...shuffle(rest)];
  }

  function makeSet(c) {
    const target = randTime(c);
    return {
      type: 'set', mode: 'set', variant: 'set', target, start: startFor(target, c),
      lines: [`Set the clock to {${fmt(target)}}`],
      zh: zhTime(target),
      speak: `Set the clock to ${speakTime(target)}.`,
      answerText: fmt(target),
      explain: explainTime(target),
      ghost: true,
    };
  }

  function makeRead(c) {
    const t = randTime(c);
    return {
      type: 'read', mode: 'choice', variant: 'read', show: t, reveal: t,
      lines: ['What time does the clock show?'],
      zh: '现在几点?', zhAfter: zhTime(t),
      speak: 'What time does the clock show?',
      ...buildRanked(t, readMistakes(t), [t + 60, t - 60, t + 30, t - 30, t + 15, t - 15, t + 5, t - 5], fmt, looksClock),
      answerText: fmt(t), answerSpeak: speakTime(t),
      explain: explainTime(t),
    };
  }

  function wordsTime(kind) {
    const m = { oclock: 0, half: 30, qpast: 15, qto: 45, npast: pick([5, 10, 20, 25]), nto: pick([35, 40, 50, 55]) }[kind];
    return T(rand(1, 12), m);
  }

  // Clock words from a kind and the number that is said: ('qto', 9) → "quarter to 9".
  function wordsKN(kind, n, x) {
    if (kind === 'oclock') return `${n} o'clock`;
    if (kind === 'half') return `half past ${n}`;
    if (kind === 'qpast') return `quarter past ${n}`;
    if (kind === 'qto') return `quarter to ${n}`;
    if (kind === 'npast') return `${x} past ${n}`;
    return `${x} to ${n}`;
  }
  function wordsKind(t) {
    const m = minOf(t);
    if (m === 0) return { kind: 'oclock', n: hourOf(t), x: 0 };
    if (m === 30) return { kind: 'half', n: hourOf(t), x: 30 };
    if (m === 15) return { kind: 'qpast', n: hourOf(t), x: 15 };
    if (m === 45) return { kind: 'qto', n: hourOf(t + 60), x: 15 };
    if (m < 30) return { kind: 'npast', n: hourOf(t), x: m };
    return { kind: 'nto', n: hourOf(t + 60), x: 60 - m };
  }
  const wrap12 = (n) => ((((n - 1) % 12) + 12) % 12) + 1;

  // "What do we call this time?" — the answer must not be the odd one out (or the most typical):
  // same-kind and other-kind options, same-number and other-number options, answer in a random corner.
  function wordsChoices(t, c) {
    const { kind, n, x } = wordsKind(t);
    const allowed = new Set([...(c.words || []), 'oclock', 'half']);
    const related = {
      oclock: ['half'], half: ['oclock', 'qpast', 'qto'], qpast: ['qto', 'half'], qto: ['qpast', 'half'],
      npast: ['nto'], nto: ['npast'],
    }[kind].filter((k) => allowed.has(k) || k === 'nto' || k === 'npast');
    const k2 = pick(related.length ? related : ['oclock']);
    const n2 = wrap12(n + pick([-1, 1]));
    const words = (f) => wordsKN(f[0], f[1], f[0] === 'npast' || f[0] === 'nto' ? x : 0);
    const trip = cornerTriple([kind, n], k2, n2).map(words);
    const out = shuffle(trip.slice());
    return { options: out, answerIdx: out.indexOf(trip[0]), answer: trip[0] };
  }

  // "Which time is half past 8?" — the said number (8) must not single out the answer.
  function digitalChoices(t) {
    const h = hourOf(t);
    const m = minOf(t);
    const isTo = m > 30;
    const nx = hourOf(t + 60);
    // Other minutes = classic mix-ups: past ↔ to, "a quarter is 25", or the number the long hand is on.
    const m2s = { 0: [30, 12], 30: [0, 6, 45], 15: [45, 25, 3], 45: [15, 9] }[m] || (m % 5 === 0 ? [60 - m, m / 5] : [60 - m]);
    // "Past" times: the said number is the answer's hour, so keep that hour on two options.
    // "To" times: the said number is the next hour — the classic trap — so it is usually in.
    const roles = isTo ? [0, 1, 2] : [0, 1];
    const hours = isTo ? [nx, nx, wrap12(h - 1)] : [wrap12(h - 1), wrap12(h + 1)];
    const configs = [];
    for (const role of roles) {
      for (const h2 of hours) for (const m2 of m2s) {
        const trip = cornerTriple([h, m], h2, m2, [role]).map(([x, y]) => T(x, y));
        const rank = trip.filter((x) => looksClock(x) < looksClock(trip[0])).length;
        configs.push({ trip, rank });
      }
    }
    // Even out where the answer sits in size order (smallest / middle / biggest).
    const rank = pick([...new Set(configs.map((c) => c.rank))]);
    const trip = pick(configs.filter((c) => c.rank === rank)).trip.map(fmt);
    const out = shuffle(trip.slice());
    return { options: out, answerIdx: out.indexOf(trip[0]), answer: trip[0] };
  }

  function makeWords(c, variant) {
    const t = wordsTime(pick(c.words));
    const words = wordsFor(t);
    const explain = explainWords(t);
    const v = variant || pick(['set', 'toDigital', 'toDigital', 'toWords', 'toWords']);
    if (v === 'set') {
      return {
        type: 'words', mode: 'set', variant: 'set', target: t, start: startFor(t, c),
        lines: [`Set the clock to {${words}}`], zh: zhTime(t),
        speak: `Set the clock to ${words}.`, answerText: fmt(t), explain, ghost: false,
      };
    }
    if (v === 'toDigital') {
      return {
        type: 'words', mode: 'choice', variant: 'toDigital', show: null, reveal: t,
        lines: [`Which time is {${words}}?`], zh: '', zhAfter: zhTime(t),
        speak: `Which time is ${words}?`,
        ...digitalChoices(t),
        answerText: fmt(t), answerSpeak: speakTime(t), explain,
      };
    }
    return {
      type: 'words', mode: 'choice', variant: 'toWords', show: t, reveal: t,
      lines: ['What do we call this time?'], zh: '现在几点?', zhAfter: zhTime(t),
      speak: 'Which words match the clock?',
      ...wordsChoices(t, c),
      answerText: words, answerSpeak: words, explain,
    };
  }

  // [picture, start, how long, question, what to set]
  const LATER = [
    ['🍪', 'Cookies go in the oven at {A}.', 'They bake for {D}.', 'When are they done?', 'the cookies are done'],
    ['🚌', 'The bus leaves at {A}.', 'The ride takes {D}.', 'When does it get there?', 'the bus gets there'],
    ['⚽', 'Soccer starts at {A}.', 'It lasts {D}.', 'When does it end?', 'soccer ends'],
    ['🎹', 'Piano practice starts at {A}.', 'It lasts {D}.', 'When does it end?', 'practice ends'],
    ['🥟', 'Dumplings go in the steamer at {A}.', 'They need {D}.', 'When are they ready?', 'the dumplings are ready'],
    ['🔔', 'The school bell rings at {A}.', 'Lunch is {D} later.', 'What time is lunch?', 'lunch starts'],
    ['🎬', 'The movie starts at {A}.', 'It is {D} long.', 'When does it end?', 'the movie ends'],
    ['🚂', 'The train leaves at {A}.', 'The trip takes {D}.', 'When does it arrive?', 'the train arrives'],
  ];
  const HOWLONG = [
    ['🧸', 'Recess starts at {A} and ends at {B}.', 'How long is recess?'],
    ['📚', 'Reading time is from {A} to {B}.', 'How long is reading time?'],
    ['🎨', 'Art class is from {A} to {B}.', 'How long is art class?'],
    ['🏊', 'Swimming starts at {A} and ends at {B}.', 'How long is swimming?'],
    ['🚗', 'We leave home at {A} and get to Grandma’s at {B}.', 'How long is the drive?'],
  ];
  const EARLIER = [
    ['🎂', 'The party starts at {B}.', 'The walk there takes {D}. When should we leave?'],
    ['🏫', 'School starts at {B}.', 'The bus ride takes {D}. When does the bus leave?'],
    ['🎻', 'The concert starts at {B}.', 'We need {D} to get ready. When do we start?'],
  ];
  const fill = (s, v) => s.replace('{A}', `{${v.A}}`).replace('{B}', `{${v.B}}`).replace('{D}', `{${v.D}}`);
  const plain = (s) => s.replace(/[{}]/g, '');

  function elapsedParts(c) {
    let am;
    let d;
    let hour = rand(1, 12);
    if (c.elapsed === 'hours') {
      am = pick([0, 30]);
      d = pick([30, 60, 60, 90, 120, 180]);
    } else if (c.elapsed === 'steps') {
      d = pick([15, 30, 45, 10, 20, 40, 25, 50, 35]);
      const cross = Math.random() < 0.6;
      const pool = (c.L === 5 && Math.random() < 0.5 ? [0, 15, 30, 45] : EVERY5).filter((x) => (cross ? x > 0 && x + d > 60 : x + d < 60));
      am = pool.length ? pick(pool) : 55;
    } else {
      d = pick([25, 35, 45, 50, 55, 65, 75, 80, 90, 105, 110, 135]);
      am = c.oddStart ? rand(0, 59) : pick(EVERY5);
      if (Math.random() < 0.3) hour = pick([11, 12]); // wrap past 12
    }
    return { A: T(hour, am), d };
  }

  function laterMistakes(a, d) {
    const b = a + d;
    const carry = minOf(a) + (d % 60) >= 60;
    const out = [];
    if (carry) out.push(b - 60);            // forgot to move the hour on
    if (d >= 60 && d % 60) out.push(a + (d % 60)); // forgot the hours
    out.push(b + 60);
    return out.filter((x) => norm(x) !== norm(a));
  }

  function makeElapsed(c, variant) {
    const { A, d } = elapsedParts(c);
    const kinds = c.elapsed === 'hard' ? ['later', 'later', 'set', 'howlong', 'earlier'] : ['later', 'later', 'set', 'howlong'];
    const v = variant || pick(kinds);
    const B = A + d;
    if (v === 'later' || v === 'set') {
      const [emoji, l1, l2, ask, when] = pick(LATER);
      const vals = { A: fmt(A), D: durWords(d) };
      const lines = [`${emoji} ${fill(l1, vals)}`, `${fill(l2, vals)} ${ask}`];
      const speak = plain(`${l1.replace('{A}', speakTime(A))} ${l2.replace('{D}', durWords(d))} ${ask}`);
      const base = {
        type: 'elapsed', start: A, d, zh: `${zhTime(A)} + ${zhDur(d)}`, zhAfter: zhTime(B),
        answerText: fmt(B), answerSpeak: speakTime(B),
        explain: [explainForward(A, d)], wedge: { from: A, delta: d },
      };
      if (v === 'set') {
        return {
          ...base, mode: 'set', variant: 'set', target: norm(B),
          lines: [lines[0], `${fill(l2, vals)} ⏰ Set the clock to when ${when}!`],
          speak: plain(`${l1.replace('{A}', speakTime(A))} ${l2.replace('{D}', durWords(d))} Set the clock to when ${when}.`),
        };
      }
      return {
        ...base, mode: 'choice', variant: 'later', show: A, lines, speak,
        ...buildRanked(B, laterMistakes(A, d), [B + 30, B - 15, B + 15, B - 30, B - 5, B + 5, B + 10, B - 10].filter((x) => norm(x) !== norm(A)), fmt, looksClock),
      };
    }
    if (v === 'howlong') {
      // "How long from 3:15 to 4:00?" — keep these within a comfortable range.
      let dd = d;
      if (c.elapsed === 'steps' && dd > 60) dd = 45;
      const b2 = A + dd;
      const [emoji, l1, l2] = pick(HOWLONG);
      const vals = { A: fmt(A), B: fmt(b2) };
      const hourSteps = Math.floor((minOf(A) + dd) / 60);
      const cands = [];
      if (dd < 60) cands.push(60 - dd);
      if (hourSteps && hourSteps * 60 !== dd) cands.push(hourSteps * 60);
      cands.push(dd + 60, dd - 60, dd + 15, dd - 15, dd + 30, dd - 30, dd + 5, dd - 5);
      return {
        type: 'elapsed', mode: 'choice', variant: 'howlong', show: A, start: A, d: dd,
        lines: [`${emoji} ${fill(l1, vals)}`, l2],
        speak: plain(`${l1.replace('{A}', speakTime(A)).replace('{B}', speakTime(b2))} ${l2}`),
        zh: `${zhTime(A)} → ${zhTime(b2)}`, zhAfter: zhDur(dd),
        ...buildRanked(dd, cands.filter((x) => x > 0 && x !== dd), [dd + 10, dd - 10, dd + 20, dd - 20].filter((x) => x > 0), durText, (x) => x),
        answerText: durText(dd), answerSpeak: durWords(dd),
        explain: [explainForward(A, dd).replace(/\.$/, '') + ` → ${durWords(dd)}`],
        wedge: { from: A, delta: dd },
      };
    }
    // earlier: "The party starts at 3:10. The walk takes 30 minutes. When should we leave?"
    const [emoji, l1, l2] = pick(EARLIER);
    const vals = { B: fmt(B), D: durWords(d) };
    const cands = shuffle([A + 60, B + d, A - 60, A + 30]).filter((x) => norm(x) !== norm(B));
    return {
      type: 'elapsed', mode: 'choice', variant: 'earlier', show: B, start: B, d,
      lines: [`${emoji} ${fill(l1, vals)}`, fill(l2, vals)],
      speak: plain(`${l1.replace('{B}', speakTime(B))} ${l2.replace('{D}', durWords(d))}`),
      zh: `${zhTime(B)} − ${zhDur(d)}`, zhAfter: zhTime(A),
      ...buildRanked(A, cands, [A - 15, A + 15, A - 5, A + 5, A - 30].filter((x) => norm(x) !== norm(B)), fmt, looksClock),
      answerText: fmt(A), answerSpeak: speakTime(A),
      explain: [explainBackward(B, d)], wedge: { from: B, delta: -d },
    };
  }

  const AMPM = [
    ['🌅', 'Breakfast', 7, 0, 'am', '早上'],
    ['⏰', 'Wake up', 6, 30, 'am', '早上'],
    ['🏫', 'School starts', 8, 0, 'am', '上午'],
    ['🐓', 'The rooster crows', 5, 30, 'am', '早上'],
    ['🥞', 'Saturday pancakes', 9, 0, 'am', '上午'],
    ['🍜', 'Dinner', 6, 0, 'pm', '晚上'],
    ['🌙', 'Bedtime', 8, 0, 'pm', '晚上'],
    ['🛁', 'Bath time', 7, 30, 'pm', '晚上'],
    ['🎒', 'School ends', 3, 0, 'pm', '下午'],
    ['⚽', 'Soccer after school', 4, 0, 'pm', '下午'],
    ['🌠', 'Looking at the stars', 9, 0, 'pm', '晚上'],
    ['🍎', 'Afternoon snack', 3, 30, 'pm', '下午'],
  ];

  function makeAmpm() {
    const [emoji, what, h, m, ap, zhPre] = pick(AMPM);
    const t = T(h, m);
    const answer = ap === 'am' ? 'a.m.' : 'p.m.';
    return {
      type: 'ampm', mode: 'choice', variant: 'ampm', show: t, reveal: t, picture: emoji,
      lines: [`${emoji} ${what} at {${fmt(t)}}.`, 'Is it {a.m.} or {p.m.}?'],
      speak: `${what} at ${speakTime(t)}. Is it A M, in the morning, or P M, in the afternoon or night?`,
      zh: zhTime(t), zhAfter: zhPre + zhTime(t),
      options: ['a.m.', 'p.m.'], answerIdx: ap === 'am' ? 0 : 1, answer,
      subs: ['☀️ morning', '🌙 afternoon & night'],
      answerText: answer, answerSpeak: ap === 'am' ? 'A M' : 'P M',
      explain: ap === 'am'
        ? [`${what} happens in the morning.`, 'Morning times (before noon) are a.m.']
        : [`${what} happens in the ${zhPre === '下午' ? 'afternoon' : 'evening'}.`, 'Afternoon and night times are p.m.'],
    };
  }

  const MAKERS = { set: makeSet, read: makeRead, words: makeWords, elapsed: makeElapsed, ampm: makeAmpm };
  function makeQuestion(type, level, variant) {
    const c = cfgFor(level);
    return MAKERS[type](c, variant);
  }

  // ---------- Round state ----------
  let cfg = cfgFor(g.level);
  let state = 'intro'; // intro | play | pause | celebrate | result
  let phase = 'ask';   // ask | feedback
  let q = null;
  let qid = 0;
  let sel = -1; // -1 = nothing picked yet (no answer is highlighted until he chooses)
  let floor = 0;
  let floorMissed = false;
  let firstTry = 0;
  let starWindows = [];
  let retry = [];
  let recentTypes = [];
  let usedAnswers = [];
  let forcedNext = null; // test hook: ask a particular kind of question next
  let stats = null;
  let lastRight = false;
  let fbLines = [];
  let fbZh = '';
  let answeredAt = 0;
  let autoNextAt = 0;
  let wrongStreak = 0;
  let time = 0;
  let lastSaveAt = 0;
  let hintUntil = 0;
  let labelFlashUntil = 0;
  let particles = [];
  let floaters = [];
  let hits = [];
  let bellAmp = 0;
  let skyProgress = 0; // 0 = morning, 1 = golden hour (follows the climb)
  let towerK = 0;      // phones: 0 = playing (clock centre stage), 1 = celebration (tower centre stage)
  let toastText = '';  // phones: a hint / message shown in the banner for a few seconds
  let toastUntil = 0;
  let bannerPulseAt = -9;
  let pressedId = null; // phones: which on-canvas button is being pressed (drawn pushed in)
  let pressUntil = 0;
  let hold = null;      // press-and-hold auto-repeat on the hand buttons
  let usedKeys = false; // show the keyboard selection highlight only after an arrow key
  const coachSeen = { set: false, choice: false }; // 👆 finger coach, once per session each

  // Clock hands: `clockT` is the logical time (an unbounded number of minutes so hands can
  // spin past 12 smoothly); `disp` is what's drawn and glides toward it.
  let clockT = 0;
  let disp = 0;
  let anim = null;
  let drag = null;

  const heroAnim = { from: 0, to: 0, t: 1 };
  const heroMood = { pose: 'idle', until: 0 }; // 'happy' after a right answer, 'oops' after a wrong one
  let wobbleAt = -9;    // a small wobble of the hero after a wrong answer
  let pendingStar = 0;  // the window whose ⭐ is still flying to the top bar
  const blocks = MQ.FX.blocks();

  // ---------- Wash-to-reveal: this round's town piece hides under mud ----------
  // A small muddy picture (laptop: top bar next to ⭐ · phone portrait: HUD strip · phone landscape:
  // top-right corner of the clock box). Each floor done right sprays a patch clean; he washes the
  // rest on the result card.
  let washBadge = null;
  let washFin = null;
  let resultAt = 0;
  const RESULT_GUARD = 1500; // ms: continue on the result card is ignored this long (double presses)
  function placeWash() {
    if (!washBadge) return;
    const b = washBadge.el;
    const s = mode === 'desk' ? 52 : 40;
    b.style.width = b.style.height = `${s}px`;
    b.classList.toggle('ct-wash-float', mode === 'landscape');
    if (mode === 'desk') {
      el('topbar').insertBefore(b, el('starpill'));
      b.style.left = b.style.top = '';
    } else if (mode === 'portrait') {
      el('phud').insertBefore(b, el('ppause'));
      b.style.left = b.style.top = '';
    } else {
      stage.insertBefore(b, overlay);
      b.style.left = `${Math.round(Math.min(LW - s - 6, PL.cx + PL.box / 2 - s - 2))}px`;
      b.style.top = `${Math.round(PL.cy - PL.box / 2 + 2)}px`;
    }
  }
  function startWash() {
    endWash();
    washBadge = MQ.Wash.badge(el('phud'), { data, steps: FLOORS, size: 52 });
    washBadge.el.classList.add('ct-wash');
    placeWash();
  }
  function endWash() {
    if (washFin) { washFin.cleanup(); washFin = null; }
    if (washBadge) { washBadge.el.remove(); washBadge = null; }
  }

  function newRound() {
    cfg = cfgFor(g.level);
    floor = 0;
    floorMissed = false;
    firstTry = 0;
    starWindows = [];
    retry = [];
    recentTypes = [];
    usedAnswers = [];
    wrongStreak = 0;
    stats = { seconds: 0, hints: 0, wrong: 0, asked: 0 };
    heroAnim.from = heroAnim.to = 0;
    heroAnim.t = 1;
    q = null;
    phase = 'ask';
    clockT = disp = T(12, 0);
    anim = null;
    updateHud();
  }

  function chooseType() {
    for (const r of retry) r.due--;
    const due = retry.findIndex((r) => r.due <= 0);
    if (due >= 0) return retry.splice(due, 1)[0].type;
    const types = Object.keys(cfg.mix);
    const weights = types.map((k) => {
      const s = g.skills[k] || { right: 0, tries: 0 };
      const acc = (s.right + 1) / (s.tries + 2);
      let w = cfg.mix[k] * (0.6 + 2 * (1 - acc));
      const n = recentTypes.length;
      if (n >= 2 && recentTypes[n - 1] === k && recentTypes[n - 2] === k) w = 0;
      return w;
    });
    // The very first question of a round is a gentle "set the clock" warm-up.
    if (stats.asked === 0 && cfg.mix.set) return 'set';
    let x = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < types.length; i++) { x -= weights[i]; if (x <= 0) return types[i]; }
    return types[0];
  }

  function nearest(t) { return clockT + shortest(clockT, t); }

  function moveClock(to, dur) {
    anim = { from: disp, to, t: 0, dur: Math.max(0.01, dur) };
  }

  function nextQuestion() {
    const type = forcedNext ? forcedNext.type : chooseType();
    recentTypes.push(type);
    // Fresh times each question: re-roll if this answer already came up this round.
    for (let i = 0; i < 12; i++) {
      q = MAKERS[type](cfg, forcedNext ? forcedNext.variant : undefined);
      if (!usedAnswers.includes(q.answerText)) break;
    }
    forcedNext = null;
    usedAnswers.push(q.answerText);
    q.id = ++qid;
    stats.asked++;
    phase = 'ask';
    hintUntil = 0;
    labelFlashUntil = 0;
    sel = -1; // never pre-select an answer — don't lead the witness
    if (q.mode === 'set') {
      clockT = nearest(q.start);
      moveClock(clockT, 0.7);
      q.wedgeFrom = q.wedge ? clockT : null;
      q.startClock = clockT;
    } else if (q.show != null) {
      clockT = nearest(q.show);
      moveClock(clockT, 0.7);
      q.wedgeFrom = q.wedge ? clockT : null;
    }
    q.shownAt = time; // answers in the first moments after a question appears are ignored (double taps)
    q.hints = 0;
    updateHud();
    MQ.Voice.say(q.speak, 'en-US', { interrupt: true });
    if (data.settings.chinese && q.mode === 'set' && q.type === 'set') MQ.Voice.say(q.zh, 'zh-CN');
    // Short caption on screen; the "how" is spoken in his first climbs.
    if (q.mode === 'set') {
      say('⏰ Move the hands!');
      if (stats.asked <= 1 && g.played < 2) {
        MQ.Voice.say(MQ.isTouch
          ? 'Drag the long blue hand and the short red hand with your finger. Then tap Check!'
          : 'The left and right arrows move the long blue hand. Up and down move the short red hand. Then press return!', 'en-US');
      }
    } else {
      say(MQ.isTouch ? '👆 Tap an answer!' : '👆 Pick one!');
      if (stats.asked <= 2 && g.played < 2 && !MQ.isTouch) MQ.Voice.say('Pick with the arrows and press return.', 'en-US');
    }
  }

  // Move the hands (keys or dragging). Soft tick per step, a little chime when an hour passes.
  function setClock(to, dur = 0.14) {
    if (to === clockT) return;
    const hourBefore = Math.floor(clockT / 60);
    const hourAfter = Math.floor(to / 60);
    clockT = to;
    moveClock(to, dur);
    MQ.Sound.note(84, 'wood', { dur: 0.05, vel: 0.3 });
    if (hourBefore !== hourAfter && Math.abs(to - disp) < 70) MQ.Sound.note(hourAfter > hourBefore ? 79 : 72, 'bell', { dur: 0.9, vel: 0.07 });
  }

  function record(type, right) {
    const s = (g.skills[type] = g.skills[type] || { label: SKILLS[type], right: 0, tries: 0 });
    s.label = SKILLS[type];
    s.tries++;
    if (right) s.right++;
  }

  // A double tap on Next ▶ or a double return lands on the next question before he has seen it.
  const SETTLE = 0.6;
  const tooSoon = () => !q || time - q.shownAt < SETTLE;

  // Tapping an answer button: pick it and check it (but not a tap left over from a double tap).
  function choose(i) {
    if (state !== 'play' || phase !== 'ask' || !q || tooSoon()) return;
    sel = i;
    submit();
  }

  function submit() {
    if (state !== 'play' || phase !== 'ask' || !q) return;
    if (tooSoon()) return;
    let right;
    if (q.mode === 'set') {
      // Hands still where they started: he hasn't tried yet — don't grade it, just nudge.
      if (norm(clockT) === norm(q.startClock)) { nudgeMove(); return; }
      q.theirs = clockT;
      right = norm(clockT) === norm(q.target);
    } else {
      if (sel < 0) { nudgePick(); return; }
      q.picked = sel;
      right = sel === q.answerIdx;
    }
    answeredAt = time;
    record(q.type, right);
    phase = 'feedback';
    lastRight = right;
    hintUntil = 0;
    if (right) onRight(); else onWrong();
    updateHud();
    persist();
  }

  function revealClock(slow) {
    if (q.wedge) {
      // Elapsed time: sweep the hands from the start time so he sees the time pass.
      clockT = q.wedgeFrom + q.wedge.delta;
      if (q.mode === 'set') moveClock(clockT, 1.3);
      else { disp = q.wedgeFrom; moveClock(clockT, 1.8); }
    } else if (q.mode === 'set') {
      clockT = nearest(q.target);
      moveClock(clockT, slow ? 1.2 : 0.3);
    } else if (q.reveal != null) {
      if (q.show == null) { clockT = nearest(q.reveal); moveClock(clockT, 1.0); }
    }
  }

  function onRight() {
    MQ.Sound.correct();
    wrongStreak = 0;
    const floorMissedBefore = floorMissed;
    if (!floorMissed) { firstTry++; starWindows.push(floor + 1); pendingStar = floor + 1; }
    floor++;
    if (washBadge) washBadge.step(); // a floor done right (first try or not) sprays a patch clean
    floorMissed = false;
    climbTo(floor);
    const praise = MQ.pick(MQ.PRAISE);
    fbLines = [`✔ ${praise.en}  {${q.answerText}}`];
    if (q.type === 'elapsed') fbLines.push(q.explain[0]);
    const zhPart = q.zhAfter || (q.mode === 'set' ? q.zh : '');
    fbZh = data.settings.chinese ? `${praise.zh} ${zhPart}` : '';
    revealClock(false);
    heroMood.pose = 'happy';
    heroMood.until = time + 1.6;
    // Block burst where the hero lands, a sparkle on the clock, and (first try) a ⭐ that flies to its window.
    const p = heroScreen(floor);
    const up = heroHalf();
    blocks.burst(p.x, p.y - up, ['#ffd23f', '#f6b93b', '#4cd137', '#48b0f7', '#ff7f50'], isPhone() ? 12 : 18, isPhone() ? 0.55 : 0.8);
    floaters.push({ x: p.x + (mode === 'portrait' ? 0 : 34), y: p.y - up * 2 - 6, text: floor >= FLOORS ? 'Top!' : `+1 🪟`, life: 1.2 });
    const c = clockToScreen(CX, CY - R * 0.3);
    burst(c.x, c.y, '#ffe27a', 14);
    if (!floorMissedBefore) flyStarTo(p.x, p.y - up, floor);
    say(floor >= FLOORS ? '🔔 The top!' : `✔ Floor ${floor}!`);
    // Two short phrases: the praise is the same every time, so it is ready instantly after the first time.
    if (data.settings.chinese) { MQ.Voice.say(praise.zh, 'zh-CN', { interrupt: true }); MQ.Voice.say(zhPart, 'zh-CN'); }
    else MQ.Voice.say(praise.en, 'en-US', { interrupt: true });
    autoNextAt = time + (q.wedge ? 2.6 : 1.8);
  }

  function onWrong() {
    MQ.Sound.wrong();
    stats.wrong++;
    wrongStreak++;
    floorMissed = true;
    retry.push({ type: q.type, due: 2 }); // this kind of question comes back soon
    autoNextAt = 0;
    const opener = pick(['Good try!', 'Almost!', 'Nice try!']);
    fbLines = [`${opener} The answer is {${q.answerText}}.`, ...q.explain];
    fbZh = data.settings.chinese ? (q.zhAfter || (q.mode === 'set' ? q.zh : '')) : '';
    if (q.mode === 'set') {
      q.ghostTheirs = norm(q.theirs);
      const yours = fmt(q.theirs);
      fbLines = [`${opener} You made ${yours}. This is {${q.answerText}}:`, ...q.explain];
    }
    revealClock(true);
    heroMood.pose = 'oops';
    heroMood.until = time + 1.1;
    wobbleAt = time;
    say(wrongStreak >= 2 ? `💪 ${MQ.CHEER.zh}! Look at the clock` : '👀 Look at the clock!');
    MQ.Voice.say(`${opener} The answer is ${q.answerSpeak || speakTime(q.target)}.`, 'en-US', { interrupt: true });
    if (g.played < 2) MQ.Voice.say(MQ.isTouch ? 'Tap Next to go on.' : 'Press return to go on.', 'en-US');
  }

  function advance(minWait = 0.35) {
    if (state !== 'play' || phase !== 'feedback' || time - answeredAt < minWait) return;
    autoNextAt = 0;
    if (floor >= FLOORS) finishRound();
    else nextQuestion();
  }

  function hint() {
    if (phase !== 'ask' || !q) return;
    stats.hints++;
    q.hints = (q.hints || 0) + 1;
    MQ.Sound.note(88, 'bell', { dur: 0.8, vel: 0.1 });
    labelFlashUntil = time + 4;
    let text;
    let cap;
    if (q.type === 'set') {
      const m = minOf(q.target);
      const ticks = m % 5;
      const spot = m === 0 ? '12' : !ticks ? `${m / 5}` : `${Math.floor(m / 5) || 12} and ${ticks} more tick${ticks > 1 ? 's' : ''}`;
      if (q.hints >= 2 || floorMissed) {
        // The glowing answer hands — this floor won't earn a ⭐ window now.
        hintUntil = time + 3;
        if (!floorMissed) { floorMissed = true; updateHud(); }
        text = `Look for the glowing hands! The long hand goes to ${spot}. This floor won't get a star.`;
        cap = '💡 Look for the glowing hands!';
      } else {
        // First hint: words and the glowing minute numbers only.
        text = `Count by 5s on the yellow numbers. The long hand goes to ${spot}. Need more help? Hint again.`;
        cap = '💡 Count by 5s!';
      }
    } else if (q.type === 'read') {
      text = 'First look at the short red hand: which number did it pass? Then count the long blue hand by 5s.';
      cap = '💡 Short red hand first!';
    } else if (q.type === 'words') {
      text = "Quarter = 15 minutes. Half = 30 minutes. 'Past' means after the hour, 'to' means before the next hour.";
      cap = '💡 Quarter = 15 · half = 30';
    } else if (q.type === 'elapsed') {
      text = q.variant === 'earlier'
        ? 'Count backward! Each number on the clock is 5 minutes. 60 minutes = 1 hour.'
        : 'Count on from the start time. Each number on the clock is 5 minutes. 60 minutes = 1 hour.';
      cap = q.variant === 'earlier' ? '💡 Count back by 5s!' : '💡 Count on by 5s!';
    } else {
      text = 'a.m. = morning, before lunch ☀️. p.m. = afternoon and night 🌙.';
      cap = '💡 a.m. ☀️ · p.m. 🌙';
    }
    say(cap, text);
    if (isPhone()) toast(`💡 ${text}`, 7);
  }

  // Phones: show a short message in the question banner for a few seconds.
  function toast(text, secs = 4) {
    toastText = text;
    toastUntil = time + secs;
  }

  // ---------- Tower climb + end of round ----------
  function climbTo(f) {
    heroAnim.from = lerp(heroAnim.from, heroAnim.to, ease(Math.min(1, heroAnim.t)));
    heroAnim.to = f;
    heroAnim.t = 0;
    MQ.Sound.hop(Math.min(f, 9));
  }

  function finishRound() {
    state = 'celebrate';
    phase = 'done';
    climbTo(FLOORS + 1);
    fbLines = ['🔔 You reached the top of the tower!', 'Ring the big bell!'];
    fbZh = data.settings.chinese ? '敲钟啦!' : '';
    updateHud();
    say('🔔 Ding, dong!');
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        MQ.Sound.note(48, 'bell', { dur: 3, vel: 0.25 });
        MQ.Sound.note(60, 'bell', { dur: 2.2, vel: 0.08 });
        bellAmp = 1;
        const b = towerToScreen(T_CX, 160);
        burst(b.x, b.y, '#ffe27a', 16);
        if (i === 0) { heroMood.pose = 'happy'; heroMood.until = time + 99; }
      }, 700 + i * 950);
    }
    setTimeout(() => {
      MQ.Sound.win();
      for (let i = 0; i < 6; i++) {
        setTimeout(() => (isPhone()
          ? confetti(rand(Math.round(LW * 0.1), Math.round(LW * 0.9)), rand(Math.round(LH * 0.2), Math.round(LH * 0.55)))
          : confetti(rand(Math.round(LW * 0.28), Math.round(LW * 0.95)), rand(160, 420))), i * 140);
      }
      const praise = MQ.pick(MQ.PRAISE);
      if (data.settings.chinese) MQ.Voice.say(praise.zh, 'zh-CN', { interrupt: true });
      else MQ.Voice.say(praise.en, 'en-US', { interrupt: true });
      setTimeout(() => showResult(praise), 1500);
    }, 700 + 3 * 950);
  }

  // Every wrong try counts, not just the floors that missed: 5 wrong on one floor is not "7/8".
  function starsFor(n, wrong) {
    if (n >= 7 && wrong <= 1) return 3;
    if (n >= 5 && wrong <= 3) return 2;
    return 1;
  }

  function adapt() {
    const before = g.level;
    g.played++;
    if (starsFor(firstTry, stats.wrong) === 3) {
      g.level = Math.min(MAX_LEVEL, g.level + 1);
      g.lowRounds = 0;
    } else if (firstTry <= 4 || stats.wrong >= 6) {
      g.lowRounds++;
      if (g.lowRounds >= 2 && g.level > 1) { g.level--; g.lowRounds = 0; }
    } else {
      g.lowRounds = 0;
    }
    g.maxLevel = Math.max(g.maxLevel, g.level);
    // speak: the full friendly sentence (spoken) · pic: a short icon line for the card.
    if (g.level > before) return { speak: 'Level up! The next climb is a little harder.', pic: `⬆ Level ${g.level}!` };
    if (g.level < before) return { speak: "Let's practice an easier climb, then come back up!", pic: `⬇ Level ${g.level} 💪` };
    if (firstTry >= 7) return { speak: 'Every wrong try counts. With fewer wrong tries you get 3 stars and a level up!', pic: '🔁 Fewer ✗ → ⭐⭐⭐' };
    return { speak: "Let's climb this level again for more stars!", pic: '🔁 Again for ⭐⭐⭐' };
  }

  function showResult(praise) {
    const stars = starsFor(firstTry, stats.wrong);
    const level = g.level;
    const summary = `${firstTry}/${FLOORS} first try`;
    g.history.push({
      level, stars, seconds: Math.round(stats.seconds), date: new Date().toISOString(), summary,
      firstTry, questions: stats.asked, hints: stats.hints,
    });
    if (g.history.length > 200) g.history.splice(0, g.history.length - 200);
    const heroesBefore = MQ.unlockedHeroes(data.stars).length;
    data.stars += stars;
    const newHero = MQ.unlockedHeroes(data.stars).slice(heroesBefore)[0];
    const move = adapt();
    persist();
    updateHud();
    MQ.Voice.say(`${stars} star${stars > 1 ? 's' : ''}! ${move.speak}${newHero ? ` New hero unlocked: ${newHero.name}! Pick it in the portal.` : ''}`, 'en-US');

    state = 'result';
    const starHtml = [1, 2, 3].map((i) => `<span class="${i <= stars ? '' : 'off'}">⭐</span>`).join('');
    const mins = Math.max(1, Math.round(stats.seconds / 60));
    showOverlay(`
      <div class="card">
        <h2>${MQ.Art.img(heroId, 64, 'card-hero')} 🔔 Level ${level}</h2>
        <div class="wash-host" id="washhost"></div>
        <div class="stars-row">${starHtml}</div>
        <div class="praise"><span class="zh">${praise.zh}</span><small>${praise.py} · ${praise.en}</small></div>
        <div class="stats">
          <span>🪟 ${firstTry}/${FLOORS}</span>
          ${stats.wrong ? `<span>✗ ${stats.wrong}</span>` : ''}
          <span>⏱ ${mins} min</span>
          ${stats.hints ? `<span>💡 ${stats.hints}</span>` : ''}
        </div>
        <div class="next">${move.pic}</div>
        ${newHero ? `<div class="next new-hero">🎉 ${MQ.Art.img(newHero.id, 60)} ${MQ.escapeHtml(newHero.name)}</div>` : ''}
        <div class="btn-row">
          <button class="btn start" id="again">Again ▶</button>
          <a class="btn secondary town-link" href="../../town/index.html">🏡 My Town</a>
          <a class="btn secondary home-link phone-only" href="../../index.html">🏠 Portal</a>
        </div>
        <div class="press keys-only">Press <span class="key">return</span></div>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') resultContinue(); else if (k === 'Escape') goHome(); }
    );
    el('again').addEventListener('click', resultContinue);
    resultAt = performance.now();
    // The finale: he power-washes the rest of the mud off this round's town piece.
    const washSize = mode === 'desk' ? 240 : mode === 'portrait' ? 180 : Math.max(120, Math.min(200, Math.round(LH * 0.5)));
    if (washBadge) {
      washFin = MQ.Wash.finale(el('washhost'), { data, badge: washBadge, size: washSize });
      overlay.querySelector('.card').classList.add('has-wash'); // landscape phones: the picture sits beside the rest
    }
  }

  // Result card: return / space / Again. Ignored for a moment (double presses); if the picture is
  // still muddy the first press rinses it clean with a splash, the next one goes on.
  function resultContinue() {
    if (state !== 'result' || performance.now() - resultAt < RESULT_GUARD) return;
    if (washFin && !washFin.clean) { washFin.finish(); return; }
    nextRound();
  }

  function nextRound() {
    endWash();
    newRound();
    showIntro();
  }

  // ---------- HUD ----------
  // Only touches the DOM when something changed (called on events, never per frame).
  let hudSig = '';
  function setText(id, v) { const e = el(id); if (e.textContent !== String(v)) e.textContent = v; }
  function updateHud() {
    setText('level', g.level);
    setText('stars', data.stars);
    setText('plevel', g.level);
    setText('pstars', data.stars);
    const wins = Array.from({ length: FLOORS }, (_, i) => {
      const k = i + 1;
      const lit = k <= floor || state === 'celebrate' || state === 'result';
      const cls = lit ? 'win lit' : k === floor + 1 && state === 'play' ? 'win next' : 'win';
      const star = starWindows.includes(k) && k !== pendingStar ? '<span class="st">⭐</span>' : '';
      return `<span class="${cls}">${star}</span>`;
    }).join('') + '<span class="bell">🔔</span>';
    if (wins !== hudSig) { el('windows').innerHTML = wins; hudSig = wins; }
    const musicOn = data.settings.music !== false;
    for (const id of ['pmusic', 'tmusic']) {
      setText(id, musicOn ? '🎵' : '🔇');
      el(id).classList.toggle('off', !musicOn);
    }
  }

  // The laptop caption: a few big words. `speak` (optional) is the full sentence, read aloud.
  function say(cap, speak) {
    const b = el('caption');
    b.textContent = cap;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    if (speak) MQ.Voice.say(speak.replace(/\p{Extended_Pictographic}/gu, ''), 'en-US', { interrupt: true });
  }

  // A ⭐ flies from the hero (board point) to that window in the top bar (phones: to the ⭐ counter).
  function flyStarTo(x, y, k) {
    const r = canvas.getBoundingClientRect();
    const px = r.left + (x / LW) * r.width;
    const py = r.top + (y / LH) * r.height;
    const target = isPhone() ? el('pstars').parentElement : el('windows').children[k - 1];
    MQ.FX.flyStar(px, py, target, { delay: 150 });
    setTimeout(() => { if (pendingStar === k) { pendingStar = 0; updateHud(); } }, 950);
  }
  // Half the hero's height on screen (for effects that start at his middle).
  function heroHalf() {
    if (mode === 'portrait') return 16;
    if (mode === 'landscape') return 30 * towerXform().s;
    return 30;
  }

  // ---------- Input ----------
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k.startsWith('Arrow') || k === ' ' || k === 'Enter' || k === 'Escape') e.preventDefault();
    if (k.startsWith('Arrow')) usedKeys = true;
    MQ.Sound.ensure();
    if ((k === 'm' || k === 'M') && !e.repeat) { toggleMusic(); return; }
    if (state === 'play') { playKey(k, e); return; }
    if (overlayKeys && !e.repeat) overlayKeys(k, e);
  });

  function playKey(k, e) {
    if (k === 'Escape') { showPause(); return; }
    if (phase === 'feedback') {
      if ((k === 'Enter' || k === ' ') && !e.repeat) advance();
      return;
    }
    if (phase !== 'ask' || !q) return;
    if ((k === 'h' || k === 'H') && !e.repeat) { hint(); return; }
    if (q.mode === 'set') {
      if (k === 'ArrowRight') setClock(clockT + cfg.step);
      else if (k === 'ArrowLeft') setClock(clockT - cfg.step);
      else if (k === 'ArrowUp' && !e.repeat) setClock(clockT + 60, 0.3);
      else if (k === 'ArrowDown' && !e.repeat) setClock(clockT - 60, 0.3);
      else if ((k === 'Enter' || k === ' ') && !e.repeat) submit();
      return;
    }
    if (e.repeat) return;
    const n = q.options.length;
    const mid = (n - 1) / 2; // nothing picked yet: the first press steps out of the middle toward that side
    if (k === 'ArrowLeft' || k === 'ArrowUp') { sel = sel < 0 ? Math.ceil(mid) - 1 : Math.max(0, sel - 1); MQ.Sound.click(); }
    else if (k === 'ArrowRight' || k === 'ArrowDown') { sel = sel < 0 ? Math.floor(mid) + 1 : Math.min(n - 1, sel + 1); MQ.Sound.click(); }
    else if (k === 'Enter' || k === ' ') submit();
  }

  // Return pressed before any answer was chosen: a friendly nudge, nothing else.
  function nudgePick() {
    MQ.Sound.click();
    const text = MQ.isTouch ? '👆 Tap an answer first!' : 'Pick an answer first — use ← →';
    say(MQ.isTouch ? '👆 Tap an answer first!' : '👆 Pick an answer first!');
    MQ.Voice.say(MQ.isTouch ? 'Tap an answer first!' : 'Pick an answer first!', 'en-US', { interrupt: true });
    if (isPhone()) toast(text, 2.5);
  }

  // Check pressed with the hands still where they started: not graded, just a nudge.
  function nudgeMove() {
    MQ.Sound.click();
    const text = MQ.isTouch ? '👆 Drag the hands first!' : 'Move the hands first! ← → ↑ ↓';
    say(MQ.isTouch ? '👆 Drag the hands first!' : 'Move the hands first!');
    MQ.Voice.say(MQ.isTouch ? 'Drag the hands first!' : 'Move the hands first!', 'en-US', { interrupt: true });
    if (isPhone()) toast(text, 2.5);
    bannerPulseAt = time;
  }

  // All the answer buttons bob together (same height, same time) until one is picked.
  const waitBob = () => (phase === 'ask' && sel < 0 ? 2 + 2 * Math.sin(time * 3.2) : 0);

  function toggleMusic() {
    data.settings.music = data.settings.music === false;
    MQ.applySettings(data.settings);
    persist();
    say(data.settings.music ? '🎵 Music on' : '🔇 Music off');
    if (isPhone() && state === 'play') toast(data.settings.music ? '🎵 Music on' : '🔇 Music off', 1.6);
    updateHud();
  }

  // On-screen pause + music buttons (phone HUD, and the top bar on touch tablets).
  for (const id of ['ppause', 'tpause']) {
    el(id).addEventListener('click', () => { MQ.Sound.click(); if (state === 'play') showPause(); });
  }
  for (const id of ['pmusic', 'tmusic']) {
    el(id).addEventListener('click', () => { MQ.Sound.click(); toggleMusic(); });
  }

  // Mouse / trackpad / finger: tap choices and buttons, drag the clock hands.
  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * LW, y: ((e.clientY - r.top) / r.height) * LH };
  }
  const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  // Phones: screen point → the clock's own board coordinates (so dragTo works unchanged).
  function toClock(p) {
    if (!isPhone()) return p;
    const s = PL.s * PL.clockZoom;
    return { x: CX + (p.x - PL.cx) / s, y: CY + (p.y - PL.cy) / s };
  }

  function pressHit(hit, e) {
    pressedId = hit.id || null;
    pressUntil = time + 0.16;
    hit.fn();
    if (hit.repeat) {
      stopHold();
      const tick = () => {
        if (!hold || state !== 'play' || phase !== 'ask') { stopHold(); return; }
        hit.fn();
        pressUntil = time + 0.16;
        hold.timer = setTimeout(tick, 110);
      };
      hold = { rect: hit, pointerId: e.pointerId, timer: setTimeout(tick, 430) };
    }
  }
  function stopHold() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
    pressedId = null;
  }

  // Which hand did the finger grab? The one it's closest to (measured along each hand);
  // far from both, the outer ring means the long hand and the middle means the short hand.
  function pickHand(c) {
    const dx = c.x - CX;
    const dy = c.y - CY;
    const segDist = (ang, len) => {
      const a = (ang * Math.PI) / 180;
      const ux = Math.sin(a);
      const uy = -Math.cos(a);
      const t = Math.max(0, Math.min(len, dx * ux + dy * uy));
      return Math.hypot(dx - ux * t, dy - uy * t);
    };
    const dm = segDist(minuteAngle(disp), R * 0.88);
    const dh = segDist(hourAngle(disp), R * 0.54);
    const near = 46 / (PL.s * PL.clockZoom); // ~46 screen px either side of a hand
    if (Math.min(dm, dh) < near) return { hand: dm <= dh ? 'minute' : 'hour', grabbed: true };
    return { hand: Math.hypot(dx, dy) > R * 0.62 ? 'minute' : 'hour', grabbed: false };
  }

  canvas.addEventListener('pointerdown', (e) => {
    MQ.Sound.ensure();
    if (state !== 'play') return;
    const p = toBoard(e);
    const hit = hits.find((h) => inside(p, h));
    if (hit) { pressHit(hit, e); return; }
    if (isPhone()) { phoneDown(p, e); return; }
    if (q && phase === 'ask' && inside(p, BANNER)) { MQ.Voice.say(q.speak, 'en-US', { interrupt: true }); return; }
    if (phase === 'feedback') { advance(); return; }
    if (phase === 'ask' && q && q.mode === 'set') {
      const dist = Math.hypot(p.x - CX, p.y - CY);
      if (dist < R + 30) {
        drag = dist < R * 0.5 ? 'hour' : 'minute';
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        dragTo(p);
      }
    }
  });

  function phoneDown(p, e) {
    if (q && inside(p, PL.banner)) {
      // Tap the banner: hear the question again.
      toastUntil = 0;
      bannerPulseAt = time;
      MQ.Sound.click();
      if (phase === 'ask') MQ.Voice.say(q.speak, 'en-US', { interrupt: true });
      return;
    }
    if (phase === 'ask' && q && q.mode === 'set') {
      const c = toClock(p);
      if (Math.hypot(c.x - CX, c.y - CY) < R + 64) {
        const pick2 = pickHand(c);
        drag = pick2.hand;
        coachSeen.set = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        MQ.Sound.note(drag === 'minute' ? 79 : 72, 'wood', { dur: 0.05, vel: 0.35 });
        // Grabbing a hand never makes it jump; tapping empty face moves that hand there.
        if (!pick2.grabbed) dragTo(c);
      }
    }
  }

  canvas.addEventListener('pointermove', (e) => {
    const p = toBoard(e);
    if (drag) { dragTo(toClock(p)); return; }
    if (hold && !inside(p, hold.rect)) stopHold();
    if (isPhone()) return;
    const overHit = hits.some((h) => inside(p, h));
    const overClock = state === 'play' && phase === 'ask' && q && q.mode === 'set' && Math.hypot(p.x - CX, p.y - CY) < R + 30;
    canvas.style.cursor = overHit ? 'pointer' : overClock ? 'grab' : 'default';
  });
  const endDrag = () => { drag = null; stopHold(); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  window.addEventListener('pointerup', () => stopHold());

  function dragTo(p) {
    if (state !== 'play' || phase !== 'ask' || !q || q.mode !== 'set') { drag = null; return; }
    // Right at the centre the angle is jumpy under a finger — wait until it moves out a little.
    if (isPhone() && Math.hypot(p.x - CX, p.y - CY) < R * 0.2) return;
    let a = (Math.atan2(p.x - CX, -(p.y - CY)) * 180) / Math.PI;
    if (a < 0) a += 360;
    const step = cfg.step;
    if (drag === 'minute') {
      const m = (Math.round(a / 6 / step) * step) % 60;
      let delta = m - minOf(clockT);
      if (delta > 30) delta -= 60;
      if (delta <= -30) delta += 60;
      if (delta) setClock(clockT + delta, 0.06);
    } else {
      const tt = (Math.round((a * 2) / step) * step) % 720;
      const delta = shortest(clockT, tt);
      if (delta) setClock(clockT + delta, 0.06);
    }
  }

  // ---------- Overlays ----------
  let overlayKeys = null;
  function showOverlay(html, keys) {
    overlay.innerHTML = html;
    overlay.hidden = false;
    overlayKeys = keys;
    MQ.FX.popIn(overlay.querySelector('.card'));
  }
  function goHome() { persist(); location.href = '../../index.html'; }
  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
    overlayKeys = null;
  }

  // A small drawn clock hand (centre dot + hand) for the intro card's picture row.
  function handSvg(color, len, width) {
    return `<svg class="hand-pic" viewBox="0 0 ${len + 18} 24" style="width:${len + 18}px" aria-hidden="true">
      <line x1="10" y1="12" x2="${10 + len}" y2="12" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>
      <circle cx="10" cy="12" r="6" fill="#3a2a1a"/></svg>`;
  }

  function showIntro() {
    state = 'intro';
    const first = g.played === 0;
    const goal = (cfg.pic || []).map((t) => `<span>${MQ.escapeHtml(t)}</span>`).join('<i>·</i>');
    // First climb only: which hand is which, as a picture (spoken below too).
    const hands = `
      <div class="hands-row">
        <span class="hand-item">${handSvg(MIN_COLOR, 54, 6)}<b class="blue">min</b></span>
        <span class="hand-item">${handSvg(HOUR_COLOR, 32, 10)}<b class="red">hour</b></span>
      </div>`;
    showOverlay(`
      <div class="card intro-card">
        <h1>${MQ.Art.img(heroId, 76, 'card-hero')} Level ${g.level}</h1>
        <div class="goal-pic">${goal}</div>
        ${first ? hands : ''}
        <button class="btn start" id="go">Start ▶</button>
        <div class="press keys-only">Press <span class="key">return</span></div>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') startPlay(); else if (k === 'Escape') goHome(); }
    );
    el('go').addEventListener('click', startPlay);
    let talk = `Level ${g.level}. ${cfg.speak || cfg.title.replace('&', 'and')}`;
    if (first) talk += ' The long blue hand shows the minutes. The short red hand shows the hour. Every right answer lights a window. Climb to the top and ring the bell!';
    MQ.Voice.say(talk, 'en-US', { interrupt: true });
    say(`Level ${g.level}`);
    updateHud();
  }

  function startPlay() {
    hideOverlay();
    startWash();
    state = 'play';
    MQ.Sound.click();
    nextQuestion();
  }

  function showPause() {
    state = 'pause';
    drag = null;
    stopHold();
    MQ.Voice.stop();
    // Two big buttons, each with its key: return = keep playing, esc = home (so esc, esc = home).
    let sel2 = 0;
    const items = [
      ['▶ Play', 'return', () => { hideOverlay(); state = 'play'; MQ.Sound.click(); }],
      ['🏠 Home', 'esc', goHome],
    ];
    showOverlay(`
      <div class="card pause-card">
        <h2>⏸ Paused</h2>
        <div class="menu">${items.map((it, i) => `<button class="btn big ${i === 0 ? '' : 'secondary'} ${i === sel2 ? 'sel' : ''}" data-i="${i}"><span>${it[0]}</span><span class="key keys-only">${it[1]}</span></button>`).join('')}</div>
      </div>`,
      (k) => {
        if (k.startsWith('Arrow')) {
          sel2 = 1 - sel2;
          MQ.Sound.click();
          overlay.querySelectorAll('.menu .btn').forEach((b, i) => b.classList.toggle('sel', i === sel2));
        } else if (k === 'Enter' || k === ' ') items[sel2][2]();
        else if (k === 'Escape') goHome();
      });
    overlay.querySelectorAll('.menu .btn').forEach((b) => b.addEventListener('click', () => items[Number(b.dataset.i)][2]()));
  }

  // ---------- Effects ----------
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 180;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.8 + Math.random() * 0.5, color, size: 3 + Math.random() * 4, spin: 0 });
    }
  }
  const CONFETTI = ['#ff5a5f', '#ffb400', '#3db2ff', '#8f6bff', '#ff7ac6', '#2ec4a6'];
  function confetti(x, y) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 220;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 160, life: 1.4 + Math.random() * 0.8, color: pick(CONFETTI), size: 5 + Math.random() * 5, spin: Math.random() * 6 });
    }
  }

  // ---------- Scenery ----------
  const clouds = Array.from({ length: 5 }, (_, i) => ({ x: 260 + i * 190 + Math.random() * 80, y: 160 + Math.random() * 110, s: 0.7 + Math.random() * 0.6, v: 6 + Math.random() * 8 }));
  const birds = Array.from({ length: 3 }, (_, i) => ({ x: Math.random() * W, y: 175 + i * 28 + Math.random() * 20, v: 26 + Math.random() * 16, ph: Math.random() * 6 }));
  const HOUSES = [
    { x: 262, w: 58, h: 40, wall: '#f6d7b0', roof: '#d9534f' },
    { x: 330, w: 44, h: 52, wall: '#fbe7c6', roof: '#7a3fb0' },
    { x: 700, w: 52, h: 38, wall: '#f4dcc0', roof: '#2f6fd6' },
    { x: 762, w: 40, h: 50, wall: '#fbe7c6', roof: '#d9534f' },
    { x: 850, w: 56, h: 34, wall: '#f6d7b0', roof: '#2e9e5b' },
    { x: 930, w: 44, h: 38, wall: '#fbe7c6', roof: '#e08a3c' },
    { x: 986, w: 50, h: 32, wall: '#f4dcc0', roof: '#7a3fb0' },
    // Only seen on wide laptop screens:
    { x: 1062, w: 46, h: 44, wall: '#fbe7c6', roof: '#2e9e5b' },
    { x: 1128, w: 58, h: 36, wall: '#f6d7b0', roof: '#d9534f' },
    { x: 1204, w: 42, h: 50, wall: '#f4dcc0', roof: '#2f6fd6' },
    { x: 1268, w: 54, h: 34, wall: '#fbe7c6', roof: '#e08a3c' },
    { x: 1340, w: 46, h: 46, wall: '#f6d7b0', roof: '#7a3fb0' },
    { x: 1410, w: 56, h: 36, wall: '#fbe7c6', roof: '#d9534f' },
    { x: 1484, w: 44, h: 42, wall: '#f4dcc0', roof: '#2e9e5b' },
    { x: 1550, w: 54, h: 34, wall: '#f6d7b0', roof: '#2f6fd6' },
  ];

  function mixColor(a, b, t) {
    const pa = a.match(/\w\w/g).map((x) => parseInt(x, 16));
    const pb = b.match(/\w\w/g).map((x) => parseInt(x, 16));
    return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], t))).join(',')})`;
  }

  // Laptop: the parts of the picture that don't move are painted once into cached layers.
  function renderLayer(c, ox, oy, w, h, fn) {
    c = c || document.createElement('canvas');
    const pw = Math.ceil(w * pixelScale);
    const ph = Math.ceil(h * pixelScale);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const saved = ctx;
    ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(pixelScale, 0, 0, pixelScale, -ox * pixelScale, -oy * pixelScale);
    try { fn(); } finally { ctx = saved; }
    c.ox = ox;
    c.oy = oy;
    return c;
  }
  function blit(c) {
    const m = ctx.getTransform();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(c, Math.round(m.a * c.ox + m.e), Math.round(m.d * c.oy + m.f));
    ctx.restore();
  }
  const cache = { sky: null, skyK: -1, tower: null, face: null, dial: null };
  function dropCaches() { cache.sky = cache.tower = cache.face = cache.dial = null; cache.skyK = -1; }
  const useCache = () => !isPhone() && ctx.canvas === canvas;

  function drawSky() {
    const k = skyProgress;
    if (useCache()) {
      const kq = Math.round(k * 40) / 40;
      if (!cache.sky || cache.skyK !== kq) {
        cache.sky = renderLayer(cache.sky, 0, 0, LW, H, () => drawSkyStatic(kq, LW));
        cache.skyK = kq;
      }
      blit(cache.sky);
    } else {
      drawSkyStatic(k, W);
    }
    drawSkyLive(k);
  }

  // Sky gradient, sun, hills, village and grass (SW = scene width).
  function drawSkyStatic(k, SW) {
    // Morning blue slowly warms to golden hour as he climbs.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, mixColor('#7cc4ff', '#8f9be8', k));
    sky.addColorStop(0.55, mixColor('#cdeaff', '#ffc98f', k));
    sky.addColorStop(1, mixColor('#fff3dc', '#ffe0a8', k));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, SW, H);

    // Sun: rises a little higher and turns golden.
    const sx = SW - 80;
    const sy = lerp(250, 300, k);
    const sun = ctx.createRadialGradient(sx, sy, 10, sx, sy, 110);
    sun.addColorStop(0, `rgba(255,${Math.round(lerp(246, 214, k))},${Math.round(lerp(190, 120, k))},0.95)`);
    sun.addColorStop(0.35, 'rgba(255,220,140,0.35)');
    sun.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(sx - 120, sy - 120, 240, 240);

    // Rolling hills and a little village
    ctx.fillStyle = mixColor('#a8dc8c', '#b9c77a', k);
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, 690);
    ctx.quadraticCurveTo(300, 640, 560, 684);
    ctx.quadraticCurveTo(820, 720, 1040, 660);
    if (SW > W) ctx.quadraticCurveTo(1040 + (SW - W) * 0.5, 630, SW, 676);
    ctx.lineTo(SW, H);
    ctx.closePath();
    ctx.fill();
    for (const h of HOUSES) {
      if (h.x > SW) continue;
      const y = GROUND + 4 - h.h;
      ctx.fillStyle = h.wall;
      ctx.fillRect(h.x, y, h.w, h.h);
      ctx.fillStyle = h.roof;
      ctx.beginPath();
      ctx.moveTo(h.x - 6, y + 2);
      ctx.lineTo(h.x + h.w / 2, y - 22);
      ctx.lineTo(h.x + h.w + 6, y + 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = k > 0.5 ? '#ffd766' : '#8fc3ea';
      ctx.fillRect(h.x + 8, y + 10, 12, 12);
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(h.x + h.w - 20, y + h.h - 22, 12, 22);
    }
    ctx.fillStyle = mixColor('#7fc860', '#9fb858', k);
    ctx.fillRect(0, GROUND, SW, H - GROUND);
    ctx.fillStyle = mixColor('#6fb851', '#8ea84c', k);
    for (let x = 6; x < SW; x += 18) ctx.fillRect(x, GROUND, 8, 4);
  }

  // Clouds drift and birds flap (drawn every frame).
  function drawSkyLive(k) {
    ctx.fillStyle = `rgba(255,255,255,${lerp(0.9, 0.75, k)})`;
    for (const c of clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 46 * c.s, 18 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - 26 * c.s, c.y + 4 * c.s, 26 * c.s, 14 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 18 * c.s, c.y - 12 * c.s, 26 * c.s, 18 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Birds: little "v" shapes flapping.
    ctx.strokeStyle = 'rgba(60,50,80,0.55)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const b of birds) {
      const f = Math.sin(time * 8 + b.ph) * 4;
      ctx.beginPath();
      ctx.moveTo(b.x - 8, b.y - f);
      ctx.quadraticCurveTo(b.x - 3, b.y - 2, b.x, b.y + 1);
      ctx.quadraticCurveTo(b.x + 3, b.y - 2, b.x + 8, b.y - f);
      ctx.stroke();
    }
  }

  // ---------- Drawing helpers ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function segs(line) {
    const out = [];
    line.split(/(\{[^}]*\})/).forEach((p) => {
      if (!p) return;
      if (p[0] === '{') out.push({ t: p.slice(1, -1), hi: true });
      else out.push({ t: p, hi: false });
    });
    return out;
  }
  function richWidth(line) { return segs(line).reduce((w, s) => w + ctx.measureText(s.t).width, 0); }
  function drawRich(line, cx, y, color, hiColor) {
    const w = richWidth(line);
    let at = cx - w / 2;
    ctx.textAlign = 'left';
    for (const s of segs(line)) {
      ctx.fillStyle = s.hi ? hiColor : color;
      ctx.fillText(s.t, at, y);
      at += ctx.measureText(s.t).width;
    }
  }

  function windowPos(k) { return { x: T_CX + (k % 2 ? -38 : 38), y: GROUND - 98 - (k - 1) * 56 }; }
  // Where the hero's feet are: at the door, on a window sill, or up in the belfry.
  function heroPos(f) {
    if (f <= 0) return { x: T_CX, y: GROUND - 2 };
    if (f > FLOORS) return { x: T_CX - 58, y: 198 };
    const w = windowPos(f);
    return { x: w.x, y: w.y + 24 };
  }

  // Stable pseudo-random stone shades.
  const stoneShade = (i) => {
    const v = Math.sin(i * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  };

  function drawTower() {
    if (useCache()) {
      if (!cache.tower) cache.tower = renderLayer(null, T_LEFT - 60, T_TOP - 4, T_RIGHT - T_LEFT + 140, GROUND - T_TOP + 24, drawTowerBody);
      blit(cache.tower);
    } else {
      drawTowerBody();
    }
    drawTowerParts();
  }
  // The stone body (never changes).
  function drawTowerBody() {
    const w = T_RIGHT - T_LEFT;
    const bodyH = GROUND - T_TOP;
    // Soft shadow on the ground
    ctx.fillStyle = 'rgba(40,60,30,0.25)';
    ctx.beginPath(); ctx.ellipse(T_CX + 10, GROUND + 4, w * 0.62, 10, 0, 0, Math.PI * 2); ctx.fill();

    // Stone body, painted with slightly varied blocks
    ctx.save();
    roundRect(T_LEFT, T_TOP, w, bodyH + 2, 6);
    ctx.clip();
    ctx.fillStyle = '#cdb08a';
    ctx.fillRect(T_LEFT, T_TOP, w, bodyH);
    const rowH = 22;
    let i = 0;
    for (let row = 0, y = T_TOP; y < GROUND; row++, y += rowH) {
      for (let x = T_LEFT - (row % 2) * 22; x < T_RIGHT; x += 44) {
        const s = stoneShade(i++);
        ctx.fillStyle = `hsl(${32 + s * 8}, ${28 + s * 12}%, ${70 + s * 8}%)`;
        roundRect(x + 2, y + 2, 40, rowH - 4, 5);
        ctx.fill();
      }
    }
    // Side shading gives it roundness
    const shade = ctx.createLinearGradient(T_LEFT, 0, T_RIGHT, 0);
    shade.addColorStop(0, 'rgba(255,255,255,0.18)');
    shade.addColorStop(0.35, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(80,50,20,0.28)');
    ctx.fillStyle = shade;
    ctx.fillRect(T_LEFT, T_TOP, w, bodyH);
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#8f6f4a';
    roundRect(T_LEFT, T_TOP, w, bodyH + 2, 6);
    ctx.stroke();
  }
  // Windows, door and belfry.
  function drawTowerParts() {
    // Windows (arched), lit ones glow warmly
    for (let k = 1; k <= FLOORS; k++) drawWindow(k);

    // Door
    const dw = 50;
    const dh = 58;
    ctx.fillStyle = '#7a4a26';
    ctx.beginPath();
    ctx.moveTo(T_CX - dw / 2, GROUND);
    ctx.lineTo(T_CX - dw / 2, GROUND - dh + dw / 2);
    ctx.arc(T_CX, GROUND - dh + dw / 2, dw / 2, Math.PI, 0);
    ctx.lineTo(T_CX + dw / 2, GROUND);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#5a3418';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(T_CX, GROUND - dh); ctx.lineTo(T_CX, GROUND); ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(T_CX + 12, GROUND - 26, 3, 0, Math.PI * 2); ctx.fill();

    drawBelfry();
  }

  function drawWindow(k) {
    const { x, y } = windowPos(k);
    const ww = 46;
    const wh = 46;
    const lit = k <= floor || state === 'celebrate' || (state === 'result');
    const isNext = k === floor + 1 && state === 'play';
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(x - ww / 2, y + wh / 2);
      ctx.lineTo(x - ww / 2, y - wh / 2 + ww / 2);
      ctx.arc(x, y - wh / 2 + ww / 2, ww / 2, Math.PI, 0);
      ctx.lineTo(x + ww / 2, y + wh / 2);
      ctx.closePath();
    };
    if (lit) {
      const glow = ctx.createRadialGradient(x, y, 4, x, y, 60);
      glow.addColorStop(0, 'rgba(255,214,90,0.55)');
      glow.addColorStop(1, 'rgba(255,214,90,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 60, y - 60, 120, 120);
    }
    // Stone frame
    ctx.save();
    ctx.translate(0, 0);
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#a88c66';
    path();
    ctx.stroke();
    ctx.restore();
    path();
    if (lit) {
      const g2 = ctx.createRadialGradient(x, y + 6, 3, x, y, 34);
      g2.addColorStop(0, '#fff8d0');
      g2.addColorStop(0.6, '#ffd35a');
      g2.addColorStop(1, '#f5a623');
      ctx.fillStyle = g2;
    } else {
      const g2 = ctx.createLinearGradient(0, y - wh / 2, 0, y + wh / 2);
      g2.addColorStop(0, '#3b4a7e');
      g2.addColorStop(1, '#27305a');
      ctx.fillStyle = g2;
    }
    ctx.fill();
    if (isNext) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(255,170,50,${0.5 + 0.5 * Math.sin(time * 5)})`;
      path();
      ctx.stroke();
    }
    // Window bars
    ctx.strokeStyle = lit ? 'rgba(150,90,20,0.55)' : 'rgba(20,20,50,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - wh / 2 + 2); ctx.lineTo(x, y + wh / 2);
    ctx.moveTo(x - ww / 2, y + 4); ctx.lineTo(x + ww / 2, y + 4);
    ctx.stroke();
    // Sill
    ctx.fillStyle = '#9b7f5a';
    roundRect(x - ww / 2 - 6, y + wh / 2 - 1, ww + 12, 7, 3);
    ctx.fill();
    // A little star for windows lit on the first try
    if (starWindows.includes(k)) {
      ctx.font = `16px ${EMOJI_FONT}`;
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐', x + (k % 2 ? -34 : 34), y - 14);
    }
  }

  function drawBelfry() {
    const top = 124;
    // Belfry walls
    ctx.fillStyle = '#c29c6e';
    roundRect(T_LEFT - 6, top, T_RIGHT - T_LEFT + 12, T_TOP - top + 4, 4);
    ctx.fill();
    // Arched opening
    const ow = 112;
    const ox = T_CX - ow / 2;
    const oTop = top + 10;
    const oBot = T_TOP - 6;
    ctx.beginPath();
    ctx.moveTo(ox, oBot);
    ctx.lineTo(ox, oTop + ow / 2);
    ctx.arc(T_CX, oTop + ow / 2, ow / 2, Math.PI, 0);
    ctx.lineTo(ox + ow, oBot);
    ctx.closePath();
    const inner = ctx.createLinearGradient(0, oTop, 0, oBot);
    inner.addColorStop(0, '#3a2c52');
    inner.addColorStop(1, '#5a4470');
    ctx.fillStyle = state === 'celebrate' || state === 'result' ? '#6a4f86' : inner;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#8f6f4a';
    ctx.stroke();

    // The big bell, swinging when rung
    const swing = bellAmp * Math.sin(time * 7) * 0.35;
    ctx.save();
    ctx.translate(T_CX, oTop + 8);
    ctx.rotate(swing);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(-3, -6, 6, 12);
    const bw = 64;
    const bh = 50;
    const bg = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
    bg.addColorStop(0, '#b8862b');
    bg.addColorStop(0.35, '#ffe39a');
    bg.addColorStop(0.7, '#e2ad3f');
    bg.addColorStop(1, '#9c6d1e');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(-10, 4);
    ctx.quadraticCurveTo(-bw * 0.36, 8, -bw * 0.38, bh * 0.6);
    ctx.quadraticCurveTo(-bw * 0.42, bh * 0.9, -bw / 2, bh);
    ctx.lineTo(bw / 2, bh);
    ctx.quadraticCurveTo(bw * 0.42, bh * 0.9, bw * 0.38, bh * 0.6);
    ctx.quadraticCurveTo(bw * 0.36, 8, 10, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#8a5d16';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#8a5d16';
    ctx.beginPath(); ctx.arc(Math.sin(time * 7 + 1) * bellAmp * 8, bh + 4, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Ringing lines
    if (bellAmp > 0.15) {
      ctx.strokeStyle = `rgba(255,220,120,${bellAmp})`;
      ctx.lineWidth = 3;
      for (const s of [-1, 1]) {
        for (let r = 0; r < 2; r++) {
          ctx.beginPath();
          ctx.arc(T_CX, oTop + 40, 58 + r * 14 + (time * 30) % 14, s < 0 ? Math.PI * 0.8 : -Math.PI * 0.2, s < 0 ? Math.PI * 1.2 : Math.PI * 0.2);
          ctx.stroke();
        }
      }
    }

    // Cornice
    ctx.fillStyle = '#a88460';
    roundRect(T_LEFT - 12, T_TOP - 8, T_RIGHT - T_LEFT + 24, 12, 4);
    ctx.fill();
    roundRect(T_LEFT - 12, top - 6, T_RIGHT - T_LEFT + 24, 12, 4);
    ctx.fill();

    // Pointy slate roof with shingles
    const rl = T_LEFT - 26;
    const rr = T_RIGHT + 26;
    const apex = 34;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(rl, top - 4);
    ctx.quadraticCurveTo(T_CX - 30, top - 30, T_CX, apex);
    ctx.quadraticCurveTo(T_CX + 30, top - 30, rr, top - 4);
    ctx.closePath();
    const rg = ctx.createLinearGradient(rl, 0, rr, 0);
    rg.addColorStop(0, '#6c7fd8');
    rg.addColorStop(0.5, '#4c5fc0');
    rg.addColorStop(1, '#34449a');
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    for (let y = apex + 12; y < top; y += 12) {
      ctx.beginPath(); ctx.moveTo(rl, y); ctx.lineTo(rr, y); ctx.stroke();
    }
    ctx.restore();
    // Flag
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(T_CX, apex + 2); ctx.lineTo(T_CX, 4); ctx.stroke();
    const wave = Math.sin(time * 4) * 3;
    ctx.fillStyle = '#ffcf33';
    ctx.beginPath();
    ctx.moveTo(T_CX + 2, 5);
    ctx.quadraticCurveTo(T_CX + 16, 8 + wave, T_CX + 30, 11 + wave);
    ctx.quadraticCurveTo(T_CX + 16, 16 - wave, T_CX + 2, 19);
    ctx.closePath();
    ctx.fill();
  }

  // The block-animal hero: idle / happy / oops poses, squash-and-stretch hops, a small wobble when wrong.
  function heroPose() {
    if (time < heroMood.until) return heroMood.pose;
    return 'idle';
  }
  function drawHeroAt(x, y, size, hopH) {
    const hop = heroAnim.t < 1 ? MQ.FX.hopShape(heroAnim.t) : { sx: 1, sy: 1, lift: 0 };
    const w = time - wobbleAt;
    const tilt = w < 0.7 ? Math.sin(w * 22) * 0.13 * (1 - w / 0.7) : 0;
    MQ.Art.drawHero(ctx, heroId, x, y, size, { pose: heroPose(), t: time, sx: hop.sx, sy: hop.sy, lift: hop.lift * hopH, tilt });
  }
  function drawHero() {
    const e = MQ.FX.ease.inOut(Math.min(1, heroAnim.t));
    const a = heroPos(Math.round(heroAnim.from));
    const b = heroPos(heroAnim.to);
    drawHeroAt(lerp(a.x, b.x, e), lerp(a.y, b.y, e), 64, 38);
  }

  // ---------- The big clock ----------
  function drawHand(angle, len, width, color, alpha, shadow = true) {
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.globalAlpha = alpha;
    // Tapered shaft with a slim pointed tip, so the numbers stay readable underneath.
    const shape = () => {
      ctx.beginPath();
      ctx.moveTo(-width * 0.55, 20);
      ctx.quadraticCurveTo(0, 28, width * 0.55, 20);
      ctx.lineTo(width * 0.5, -len * 0.45);
      ctx.lineTo(width * 0.28, -len * 0.9);
      ctx.lineTo(0, -len);
      ctx.lineTo(-width * 0.28, -len * 0.9);
      ctx.lineTo(-width * 0.5, -len * 0.45);
      ctx.closePath();
    };
    if (shadow) {
      ctx.save();
      ctx.translate(4, 5);
      ctx.fillStyle = 'rgba(40,30,60,0.22)';
      shape();
      ctx.fill();
      ctx.restore();
    }
    shape();
    const hg = ctx.createLinearGradient(-width, 0, width, 0);
    hg.addColorStop(0, color);
    hg.addColorStop(0.5, color);
    hg.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = hg;
    ctx.globalAlpha = alpha * 0.35;
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(30,20,40,0.45)';
    ctx.stroke();
    ctx.restore();
  }

  function labelsAlpha() {
    let a = q && q.type === 'read' && cfg.L >= 4 ? cfg.labels * 0.6 : cfg.labels;
    if (time < labelFlashUntil) a = Math.max(a, 0.6 + 0.4 * Math.sin(time * 6));
    return Math.max(0, Math.min(1, a));
  }

  function drawClock() {
    const ox = CX - R - 40;
    const oy = CY - R - 40;
    const size = 2 * R + 80;
    if (useCache()) {
      if (!cache.face) cache.face = renderLayer(null, ox, oy, size, size, drawClockFace);
      blit(cache.face);
    } else {
      drawClockFace();
    }

    // Elapsed-time wedge
    if (q && q.wedge && q.wedgeFrom != null && (phase === 'feedback' || (phase === 'ask' && q.mode === 'set'))) drawWedge();

    if (useCache()) {
      if (!cache.dial) cache.dial = renderLayer(null, ox, oy, size, size, drawClockDial);
      blit(cache.dial);
    } else {
      drawClockDial();
    }
    drawClockTop();
  }
  // Shadow, brass bezel and face.
  function drawClockFace() {
    // Shadow + brass bezel
    ctx.fillStyle = 'rgba(50,40,80,0.22)';
    ctx.beginPath(); ctx.arc(CX + 6, CY + 10, R + 20, 0, Math.PI * 2); ctx.fill();
    const bez = ctx.createLinearGradient(CX - R, CY - R, CX + R, CY + R);
    bez.addColorStop(0, '#fff0b8');
    bez.addColorStop(0.3, '#e7b64c');
    bez.addColorStop(0.65, '#b9822a');
    bez.addColorStop(1, '#f3cf73');
    ctx.fillStyle = bez;
    ctx.beginPath(); ctx.arc(CX, CY, R + 18, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#8a5d16';
    ctx.stroke();
    ctx.beginPath(); ctx.arc(CX, CY, R + 4, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,80,20,0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Face
    const face = ctx.createRadialGradient(CX - R * 0.25, CY - R * 0.3, 10, CX, CY, R);
    face.addColorStop(0, '#fffefa');
    face.addColorStop(0.75, '#fff7e4');
    face.addColorStop(1, '#f6e4bf');
    ctx.fillStyle = face;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.fill();
  }
  // Minute ticks and the numbers 1–12.
  function drawClockDial() {
    // Minute ticks
    for (let i = 0; i < 60; i++) {
      const a = (i * 6 * Math.PI) / 180;
      const big = i % 5 === 0;
      const r1 = R - 8;
      const r2 = big ? R - 26 : R - 16;
      ctx.strokeStyle = big ? '#3a3350' : '#8a8298';
      ctx.lineWidth = big ? 5 : 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(CX + Math.sin(a) * r1, CY - Math.cos(a) * r1);
      ctx.lineTo(CX + Math.sin(a) * r2, CY - Math.cos(a) * r2);
      ctx.stroke();
    }

    // Numerals 1–12
    ctx.fillStyle = '#2d2a3e';
    ctx.font = `900 46px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let n = 1; n <= 12; n++) {
      const a = (n * 30 * Math.PI) / 180;
      ctx.fillText(String(n), CX + Math.sin(a) * (R - 58), CY - Math.cos(a) * (R - 58) + 2);
    }
  }
  // Labels, hands, counters and the centre cap (change every frame).
  function drawClockTop() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 5-minute labels outside the face (fade out at higher levels)
    const la = labelsAlpha();
    if (la > 0.01) {
      ctx.globalAlpha = la;
      ctx.font = `800 16px ${UI_FONT}`;
      for (let n = 1; n <= 12; n++) {
        const a = (n * 30 * Math.PI) / 180;
        const rr = R + 42;
        const x = CX + Math.sin(a) * rr;
        const y = CY - Math.cos(a) * rr;
        ctx.fillStyle = '#eaf4ff';
        roundRect(x - 22, y - 13, 44, 26, 13);
        ctx.fill();
        ctx.strokeStyle = '#9cc8f0';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = MIN_COLOR;
        ctx.fillText(`:${pad((n * 5) % 60)}`, x, y + 1);
      }
      ctx.globalAlpha = 1;
    }

    const handsHidden = q && q.mode === 'choice' && q.show == null && phase === 'ask';

    // Ghost of the player's wrong answer, so he can compare
    if (phase === 'feedback' && q && q.ghostTheirs != null) {
      drawHand(hourAngle(q.ghostTheirs), R * 0.54, 22, '#9a93a8', 0.35, false);
      drawHand(minuteAngle(q.ghostTheirs), R * 0.88, 14, '#9a93a8', 0.35, false);
    }
    // Hint: glowing target hands
    if (time < hintUntil && q && q.mode === 'set') {
      const a = 0.35 + 0.25 * Math.sin(time * 8);
      drawHand(minuteAngle(q.target), R * 0.88, 18, '#2ec46a', a, false);
      drawHand(hourAngle(q.target), R * 0.54, 24, '#2ec46a', a * 0.8, false);
    }

    // Phones: the hand under the finger glows so he can see what he grabbed.
    if (drag && isPhone() && !handsHidden) {
      const a = 0.45 + 0.15 * Math.sin(time * 10);
      if (drag === 'minute') drawHand(minuteAngle(disp), R * 0.88 + 10, 34, '#ffd54a', a, false);
      else drawHand(hourAngle(disp), R * 0.54 + 10, 42, '#ffd54a', a, false);
    }

    if (handsHidden) {
      ctx.fillStyle = 'rgba(122,63,176,0.18)';
      ctx.font = `900 150px ${UI_FONT}`;
      ctx.fillText('?', CX, CY + 8);
    } else {
      drawHand(hourAngle(disp), R * 0.54, 24, HOUR_COLOR, 1);
      drawHand(minuteAngle(disp), R * 0.88, 16, MIN_COLOR, 1);
    }

    if (q && q.wedge && q.wedgeFrom != null && Math.abs(disp - q.wedgeFrom) >= 0.5) drawWedgeCounter();

    // Centre cap
    const cap = ctx.createRadialGradient(CX - 4, CY - 4, 1, CX, CY, 16);
    cap.addColorStop(0, '#fff3c4');
    cap.addColorStop(1, '#c08a2a');
    ctx.fillStyle = cap;
    ctx.beginPath(); ctx.arc(CX, CY, 15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a5d16';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#6b4a2b';
    ctx.beginPath(); ctx.arc(CX, CY, 4, 0, Math.PI * 2); ctx.fill();

  }

  function drawWedge() {
    const from = q.wedgeFrom;
    const span = disp - from;
    if (Math.abs(span) < 0.5) return;
    const a0 = ((minuteAngle(from) - 90) * Math.PI) / 180;
    const rad = R - 30;
    ctx.save();
    if (Math.abs(span) >= 60) {
      ctx.fillStyle = 'rgba(255,184,60,0.16)';
      ctx.beginPath(); ctx.arc(CX, CY, rad, 0, Math.PI * 2); ctx.fill();
    }
    const part = span % 60;
    if (Math.abs(part) > 0.2) {
      ctx.fillStyle = 'rgba(255,184,60,0.32)';
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.arc(CX, CY, rad, a0, a0 + (part * 6 * Math.PI) / 180, part < 0);
      ctx.closePath();
      ctx.fill();
    }
    // Start mark
    ctx.strokeStyle = 'rgba(224,120,20,0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.lineTo(CX + Math.cos(a0) * rad, CY + Math.sin(a0) * rad);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawWedgeCounter() {
    const span = disp - q.wedgeFrom;
    // Live counter while the time passes (drawn above the hands)
    if (phase === 'feedback') {
      const mins = Math.round(Math.abs(span));
      const text = `${span < 0 ? '−' : '+'} ${durText(mins)}`;
      ctx.font = `900 26px ${UI_FONT}`;
      const tw = ctx.measureText(text).width + 28;
      ctx.fillStyle = '#fff4d6';
      roundRect(CX - tw / 2, CY + R * 0.34 - 20, tw, 40, 20);
      ctx.fill();
      ctx.strokeStyle = '#e08a3c';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#c2410c';
      ctx.textAlign = 'center';
      ctx.fillText(text, CX, CY + R * 0.34 + 1);
    }
  }

  // Keycap hints right next to the clock: which key moves which hand.
  function keycap(x, y, label, w = 34) {
    roundRect(x - w / 2, y - 15, w, 30, 7);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#cbbfa9';
    ctx.stroke();
    ctx.fillStyle = '#cbbfa9';
    ctx.fillRect(x - w / 2 + 3, y + 12, w - 6, 3);
    ctx.fillStyle = '#2d2a32';
    ctx.font = `900 ${label.length > 2 ? 15 : 17}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }
  // Which key moves which hand, drawn beside the clock with a tiny picture of each hand.
  function drawHandKeys(x0, w, top) {
    button(x0, top, w, 178, { fill: 'rgba(255,255,255,0.94)', edge: '#e2d8c6', shadow: 'rgba(0,0,0,0.08)' });
    const x = x0 + Math.max(0, (w - 206) / 2); // content is 206 wide: centre it in a wider column
    const rows = [
      { y: top + 16, keys: ['←', '→'], color: MIN_COLOR, len: 92, width: 12, text: 'long hand' },
      { y: top + 100, keys: ['↑', '↓'], color: HOUR_COLOR, len: 60, width: 18, text: 'short hand' },
    ];
    for (const r of rows) {
      keycap(x + 30, r.y + 20, r.keys[0]);
      keycap(x + 68, r.y + 20, r.keys[1]);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = r.color;
      ctx.font = `900 18px ${UI_FONT}`;
      ctx.fillText(r.text, x + 92, r.y + 20);
      // a little picture of that hand
      ctx.save();
      ctx.translate(x + 26, r.y + 54);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.moveTo(-r.width / 2, 0);
      ctx.lineTo(-r.width / 2, -r.len * 0.6);
      ctx.lineTo(-r.width * 0.28, -r.len * 0.9);
      ctx.lineTo(0, -r.len);
      ctx.lineTo(r.width * 0.28, -r.len * 0.9);
      ctx.lineTo(r.width / 2, -r.len * 0.6);
      ctx.lineTo(r.width / 2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#6b6475';
      ctx.font = `800 15px ${UI_FONT}`;
      ctx.fillText(r.text === 'long hand' ? 'minutes' : 'hour', x + 26 + r.len + 12, r.y + 55);
    }
  }

  // ---------- Banner (the question) ----------
  function drawBanner() {
    const b = BANNER;
    let lines;
    let zhLine;
    let bg = '#fff6df';
    let edge = '#c49a5a';
    if (state === 'celebrate' || state === 'result') {
      lines = fbLines; zhLine = fbZh; bg = '#fff3c4'; edge = '#e2ad3f';
    } else if (!q) {
      lines = ['🪟 × 8  ➜  🔔']; zhLine = data.settings.chinese ? '钟楼' : '';
    } else if (phase === 'feedback') {
      lines = fbLines; zhLine = fbZh;
      if (lastRight) { bg = '#e9f8ee'; edge = '#2e9e5b'; } else { bg = '#fff0e3'; edge = '#e08a3c'; }
    } else {
      lines = q.lines; zhLine = data.settings.chinese ? q.zh : '';
    }
    ctx.fillStyle = 'rgba(60,40,20,0.18)';
    roundRect(b.x + 3, b.y + 5, b.w, b.h, 20);
    ctx.fill();
    ctx.fillStyle = bg;
    roundRect(b.x, b.y, b.w, b.h, 20);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = edge;
    ctx.stroke();

    const n = lines.length + (zhLine ? 1 : 0);
    let main = lines.length === 1 && !zhLine ? 38 : lines.length === 1 ? 36 : n >= 4 ? 22 : n === 3 ? 27 : 32;
    const heightFor = (m) => lines.length * m * 1.22 + (zhLine ? Math.min(28, m * 0.85) * 1.35 : 0);
    while (heightFor(main) > b.h - 10 && main > 15) main -= 1;
    const zhSize = Math.min(28, main * 0.85);
    const lh = main * 1.22;
    const total = heightFor(main);
    let y = b.y + (b.h - total) / 2 + lh / 2;
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
      let size = i === 0 ? main : main * 0.9;
      ctx.font = `${i === 0 ? 900 : 800} ${size}px ${UI_FONT}`;
      while (richWidth(line) > b.w - 40 && size > 14) {
        size -= 1;
        ctx.font = `${i === 0 ? 900 : 800} ${size}px ${UI_FONT}`;
      }
      drawRich(line, b.x + b.w / 2, y, '#2d2a32', '#c2410c');
      y += lh;
    });
    if (q && phase === 'ask' && state === 'play' && data.settings.voice) {
      ctx.font = `22px ${EMOJI_FONT}`;
      ctx.fillStyle = '#000';
      ctx.globalAlpha = 0.55;
      ctx.textAlign = 'center';
      ctx.fillText('🔊', b.x + b.w - 26, b.y + 26);
      ctx.globalAlpha = 1;
    }
    if (zhLine) {
      ctx.font = `700 ${zhSize}px ${ZH_FONT}`;
      ctx.fillStyle = '#7a3fb0';
      ctx.textAlign = 'center';
      ctx.fillText(zhLine, b.x + b.w / 2, y - lh / 2 + zhSize * 0.75);
    }
  }

  // ---------- Right column: answer choices, or the check button ----------
  function fitText(text, maxW, size, weight = 900) {
    let s = size;
    ctx.font = `${weight} ${s}px ${UI_FONT}`;
    while (ctx.measureText(text).width > maxW && s > 18) { s -= 1; ctx.font = `${weight} ${s}px ${UI_FONT}`; }
    if (ctx.measureText(text).width <= maxW) return [text];
    // two lines
    const words = text.split(' ');
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
  }

  function button(x, y, w, h, opts) {
    const { fill = '#fff', edge = '#e2d8c6', lift = 0, shadow = '#d7ccb8' } = opts;
    ctx.fillStyle = shadow;
    roundRect(x, y + 6 - lift, w, h, 18);
    ctx.fill();
    ctx.fillStyle = fill;
    roundRect(x, y - lift, w, h, 18);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = edge;
    ctx.stroke();
  }

  function drawColumn() {
    hits = [];
    if (!q || state !== 'play') return;
    const x = COL.x;
    const w = COL.w;
    if (q.mode === 'set') {
      if (phase === 'ask') {
        drawHandKeys(x, w, CY - 236);
        // Check button
        const by = CY - 20;
        button(x, by, w, 88, { fill: '#ff7a3d', edge: '#e0642a', shadow: '#c9541f' });
        ctx.fillStyle = '#fff';
        ctx.font = `900 32px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✔ Check', x + w / 2, by + 44);
        hits.push({ x, y: by, w, h: 88, fn: submit });
        ctx.fillStyle = '#4a4458';
        ctx.font = `800 17px ${UI_FONT}`;
        ctx.fillText('press return', x + w / 2, by + 114);
        // Hint button
        const hy = by + 150;
        button(x + 38, hy, w - 76, 50, { fill: '#fffbe6', edge: '#ffe08a', shadow: '#e8d489' });
        ctx.fillStyle = '#7a5a00';
        ctx.font = `900 20px ${UI_FONT}`;
        ctx.fillText('💡 Hint (H)', x + w / 2, hy + 25);
        hits.push({ x: x + 38, y: hy, w: w - 76, h: 50, fn: hint });
      } else {
        drawNext(x, w);
      }
      return;
    }

    const n = q.options.length;
    const bh = 86;
    const gap = 14;
    const top = CY - (n * bh + (n - 1) * gap) / 2 - 40;
    q.options.forEach((opt, i) => {
      const by = top + i * (bh + gap);
      let fill = '#fff';
      let edge = '#e2d8c6';
      let lift = 0;
      let ink = '#2d2a32';
      if (phase === 'feedback') {
        if (i === q.answerIdx) { fill = '#e6f7ec'; edge = '#2e9e5b'; ink = '#1f7a45'; }
        else if (i === q.picked) { fill = '#fdecec'; edge = '#d9534f'; ink = '#b23b37'; }
        else { ink = '#9a93a8'; }
      } else if (i === sel) {
        fill = '#eaf5ff'; edge = '#4aa8ff'; lift = 4;
      } else {
        lift = waitBob();
      }
      button(x, by, w, bh, { fill, edge, lift });
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const sub = q.subs ? q.subs[i] : null;
      const textLines = fitText(opt, w - 24, 38);
      const cy = by - lift + bh / 2 - (sub ? 12 : 0);
      if (textLines.length === 1) ctx.fillText(textLines[0], x + w / 2, cy);
      else {
        ctx.font = `900 24px ${UI_FONT}`;
        ctx.fillText(textLines[0], x + w / 2, cy - 14);
        ctx.fillText(textLines[1], x + w / 2, cy + 14);
      }
      if (sub) {
        ctx.font = `800 16px ${UI_FONT}`;
        ctx.fillStyle = '#6b6475';
        ctx.fillText(sub, x + w / 2, cy + 30);
      }
      if (phase === 'feedback' && (i === q.answerIdx || i === q.picked)) {
        ctx.font = `22px ${EMOJI_FONT}`;
        ctx.fillStyle = '#000';
        ctx.fillText(i === q.answerIdx ? '✅' : '❌', x + w - 14, by + 12);
      }
      if (phase === 'ask') hits.push({ x, y: by, w, h: bh, fn: () => choose(i) });
    });
    if (phase === 'ask') {
      const y = top + n * (bh + gap) + 2;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      roundRect(x, y, w, 44, 14);
      ctx.fill();
      const kx = x + Math.max(0, (w - 206) / 2);
      keycap(kx + 24, y + 21, '←');
      keycap(kx + 60, y + 21, '→');
      ctx.fillStyle = '#4a4458';
      ctx.font = `800 16px ${UI_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('pick', kx + 82, y + 21);
      keycap(kx + 164, y + 21, 'return', 64);
      const hy = y + 56;
      button(x + 38, hy, w - 76, 46, { fill: '#fffbe6', edge: '#ffe08a', shadow: '#e8d489' });
      ctx.fillStyle = '#7a5a00';
      ctx.font = `900 19px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('💡 Hint (H)', x + w / 2, hy + 23);
      hits.push({ x: x + 38, y: hy, w: w - 76, h: 46, fn: hint });
    } else {
      drawNext(x, w, top + n * (bh + gap) + 6);
    }
  }

  function drawNext(x, w, y) {
    if (lastRight) return; // right answers move on by themselves
    const by = y != null ? y : CY - 40;
    const pulse = Math.sin(time * 4) * 2;
    button(x, by, w, 70, { fill: '#2e9e5b', edge: '#23804a', shadow: '#1d6b3d', lift: pulse });
    ctx.fillStyle = '#fff';
    ctx.font = `900 26px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Next ▶', x + w / 2, by + 35 - pulse);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    roundRect(x + 40, by + 82, w - 80, 30, 15);
    ctx.fill();
    ctx.fillStyle = '#4a4458';
    ctx.font = `800 16px ${UI_FONT}`;
    ctx.fillText('press return', x + w / 2, by + 97);
    hits.push({ x, y: by, w, h: 70, fn: advance });
  }

  function drawEffects() {
    blocks.draw(ctx);
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      if (p.spin) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(time * p.spin);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 24px ${UI_FONT}`;
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color || '#e07b00';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // =====================================================================
  // ---------- Phone layouts: geometry ----------
  // Portrait:  HUD strip · question banner · tower strip (8 windows + bell) · big clock · touch buttons.
  // Landscape: storybook tower on the left · big clock · right column (HUD, banner, buttons).
  // The clock and tower are the original board drawings placed with a transform.
  function computeLayout() {
    if (!isPhone()) { PL = null; return; }
    const L = { clockZoom: 1 };
    if (mode === 'portrait') {
      const pad = 8;
      const gap = 6;
      const stripH = 42;
      let bannerH = 110;
      let ctrlH = 132;
      const fixed = HUD_H + bannerH + stripH + gap * 3 + ctrlH + pad;
      const spare = LH - fixed - Math.min(LW - 4, LH - fixed);
      if (spare > 0) { bannerH += Math.min(34, spare * 0.45); ctrlH += Math.min(26, spare * 0.35); }
      L.banner = { x: pad, y: HUD_H, w: LW - pad * 2, h: bannerH };
      L.strip = { x: pad + 2, y: HUD_H + bannerH + gap, w: LW - pad * 2 - 4, h: stripH };
      L.ctrl = { x: pad, y: LH - pad - ctrlH, w: LW - pad * 2, h: ctrlH };
      const top = L.strip.y + stripH + gap;
      const bot = L.ctrl.y - gap;
      L.box = Math.max(120, Math.min(LW - 4, bot - top));
      L.cx = LW / 2;
      L.cy = (top + bot) / 2;
      const ts = Math.max(0.2, (L.ctrl.y + ctrlH - L.strip.y) / 745);
      L.towerPlay = L.towerWin = { s: ts, ox: LW / 2 - 126 * ts, oy: L.strip.y };
      L.hud = { left: 8, width: LW - 16 };
    } else {
      const pad = 6;
      const ts = Math.max(0.2, (LH - pad * 2) / 745);
      const towerW = 240 * ts + pad;
      L.box = Math.max(120, Math.min(LH - pad * 2, LW - towerW - 272 - pad * 2));
      L.cx = towerW + pad + L.box / 2;
      L.cy = LH / 2;
      const colX = L.cx + L.box / 2 + pad;
      const colW = LW - colX - pad;
      const ctrlH = Math.min(178, (LH - HUD_H - pad * 2) * 0.55);
      L.ctrl = { x: colX, y: LH - pad - ctrlH, w: colW, h: ctrlH };
      L.banner = { x: colX, y: HUD_H, w: colW, h: L.ctrl.y - 6 - HUD_H };
      L.towerPlay = { s: ts, ox: pad - 12 * ts, oy: pad };
      L.towerWin = { s: ts, ox: colX / 2 - 126 * ts, oy: pad };
      L.hud = { left: colX, width: colW };
    }
    L.s = L.box / (2 * CLOCK_OUT);
    const hr = 27;
    L.hint = { x: Math.min(LW - hr - 4, L.cx + L.box / 2 - hr + 2), y: L.cy + L.box / 2 - hr + 2, r: hr };
    PL = L;
  }

  function towerXform() {
    const k = easeInOut(Math.min(1, towerK));
    const a = PL.towerPlay;
    const b = PL.towerWin;
    return { s: lerp(a.s, b.s, k), ox: lerp(a.ox, b.ox, k), oy: lerp(a.oy, b.oy, k) };
  }
  function towerToScreen(x, y) {
    if (!isPhone()) return { x: x + TX, y };
    const t = towerXform();
    return { x: t.ox + x * t.s, y: t.oy + y * t.s };
  }
  function clockToScreen(x, y) {
    if (!isPhone()) return { x, y };
    const s = PL.s * PL.clockZoom;
    return { x: PL.cx + (x - CX) * s, y: PL.cy + (y - CY) * s };
  }
  function heroScreen(f) {
    if (!isPhone()) { const p = heroPos(f); return { x: p.x + TX, y: p.y }; }
    if (mode === 'portrait' && towerK < 0.5) return stripPos(f);
    const p = heroPos(f);
    return towerToScreen(p.x, p.y);
  }

  // ---------- Phones: the tower strip (portrait) ----------
  function stripSlots() {
    const b = PL.strip;
    const x0 = b.x + 38;
    const x1 = b.x + b.w - 40;
    return { b, x0, step: (x1 - x0) / FLOORS };
  }
  function stripPos(f) {
    const { b, x0, step } = stripSlots();
    const y = b.y + b.h - 3; // the hero's feet
    if (f <= 0) return { x: b.x + 19, y };
    if (f > FLOORS) return { x: b.x + b.w - 20, y };
    return { x: x0 + step * (f - 0.5), y };
  }
  function drawStrip(alpha) {
    const { b, x0, step } = stripSlots();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(60,40,20,0.2)';
    roundRect(b.x + 2, b.y + 4, b.w, b.h, 12);
    ctx.fill();
    const sg = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    sg.addColorStop(0, '#dcc39d');
    sg.addColorStop(1, '#bf9f74');
    ctx.fillStyle = sg;
    roundRect(b.x, b.y, b.w, b.h, 12);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#8f6f4a';
    ctx.stroke();
    // Door on the left (the start), bell on the right (the top).
    const dx = b.x + 19;
    const dw = 20;
    const base = b.y + b.h - 4;
    const dTop = b.y + 8;
    ctx.fillStyle = '#7a4a26';
    ctx.beginPath();
    ctx.moveTo(dx - dw / 2, base);
    ctx.lineTo(dx - dw / 2, dTop + dw / 2);
    ctx.arc(dx, dTop + dw / 2, dw / 2, Math.PI, 0);
    ctx.lineTo(dx + dw / 2, base);
    ctx.closePath();
    ctx.fill();
    const ww = Math.min(26, step - 9);
    const wy = b.y + 7;
    const wh = b.h - 14;
    for (let k = 1; k <= FLOORS; k++) {
      const x = x0 + step * (k - 0.5);
      const lit = k <= floor || state === 'celebrate' || state === 'result';
      const isNext = k === floor + 1 && state === 'play';
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(x - ww / 2, wy + wh);
        ctx.lineTo(x - ww / 2, wy + ww / 2);
        ctx.arc(x, wy + ww / 2, ww / 2, Math.PI, 0);
        ctx.lineTo(x + ww / 2, wy + wh);
        ctx.closePath();
      };
      if (lit) {
        const glow = ctx.createRadialGradient(x, wy + wh / 2, 2, x, wy + wh / 2, 26);
        glow.addColorStop(0, 'rgba(255,214,90,0.6)');
        glow.addColorStop(1, 'rgba(255,214,90,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - 26, wy - 8, 52, wh + 16);
      }
      path();
      if (lit) {
        const g2 = ctx.createRadialGradient(x, wy + wh * 0.6, 2, x, wy + wh / 2, 20);
        g2.addColorStop(0, '#fff8d0');
        g2.addColorStop(0.6, '#ffd35a');
        g2.addColorStop(1, '#f5a623');
        ctx.fillStyle = g2;
      } else {
        const g2 = ctx.createLinearGradient(0, wy, 0, wy + wh);
        g2.addColorStop(0, '#3b4a7e');
        g2.addColorStop(1, '#27305a');
        ctx.fillStyle = g2;
      }
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = isNext ? `rgba(255,150,30,${0.55 + 0.45 * Math.sin(time * 5)})` : '#a88c66';
      path();
      ctx.stroke();
      if (starWindows.includes(k)) {
        ctx.font = `12px ${EMOJI_FONT}`;
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', x + ww / 2 - 1, wy + 1);
      }
    }
    // Little bell, swinging when rung
    ctx.save();
    ctx.translate(b.x + b.w - 20, b.y + 8);
    ctx.rotate(bellAmp * Math.sin(time * 7) * 0.4);
    ctx.font = `24px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    ctx.fillText('🔔', 0, 0);
    ctx.restore();
    // The hero hops from window to window
    const e = MQ.FX.ease.inOut(Math.min(1, heroAnim.t));
    const a = stripPos(Math.round(heroAnim.from));
    const c = stripPos(heroAnim.to);
    drawHeroAt(lerp(a.x, c.x, e), lerp(a.y, c.y, e), 40, 18);
    ctx.restore();
  }

  // ---------- Phones: wrapped, auto-sized text ----------
  function wrapRich(line, maxW) {
    const words = line.match(/(?:\{[^}]*\}|[^\s{])+/g) || [''];
    const out = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (cur && richWidth(t) > maxW) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  }
  // Largest font size (maxSize → minSize) at which all lines (wrapped) fit the box.
  function fitLines(lines, zhLine, maxW, maxH, maxSize, minSize, uniform = false) {
    let best = null;
    for (let size = maxSize; size >= minSize; size--) {
      const rows = [];
      lines.forEach((line, i) => {
        const sz = i === 0 || uniform ? size : Math.max(minSize, Math.round(size * 0.9));
        const wt = i === 0 && !uniform ? 900 : 800;
        ctx.font = `${wt} ${sz}px ${UI_FONT}`;
        for (const l of wrapRich(line, maxW)) rows.push({ l, sz, wt });
      });
      const zhSize = zhLine ? Math.min(24, Math.max(15, Math.round(size * 0.82))) : 0;
      const hTot = rows.reduce((acc, r) => acc + r.sz * 1.2, 0) + (zhLine ? zhSize * 1.3 : 0);
      best = { rows, zhSize, hTot };
      const fitsW = rows.every((r) => { ctx.font = `${r.wt} ${r.sz}px ${UI_FONT}`; return richWidth(r.l) <= maxW; });
      if (hTot <= maxH && fitsW) return best;
    }
    return best;
  }
  function drawTextBlock(fit, cx, top, h, color, hi, zhLine) {
    let y = top + (h - fit.hTot) / 2;
    ctx.textBaseline = 'middle';
    for (const r of fit.rows) {
      ctx.font = `${r.wt} ${r.sz}px ${UI_FONT}`;
      drawRich(r.l, cx, y + r.sz * 0.6, color, hi);
      y += r.sz * 1.2;
    }
    if (zhLine) {
      ctx.font = `700 ${fit.zhSize}px ${ZH_FONT}`;
      ctx.fillStyle = '#7a3fb0';
      ctx.textAlign = 'center';
      ctx.fillText(zhLine, cx, y + fit.zhSize * 0.65);
    }
  }

  // ---------- Phones: the question banner ----------
  function drawPhoneBanner() {
    const b = PL.banner;
    let lines;
    let zhLine;
    let bg = '#fff6df';
    let edge = '#c49a5a';
    const toastOn = toastText && time < toastUntil && state === 'play';
    if (state === 'celebrate' || state === 'result') {
      lines = fbLines; zhLine = fbZh; bg = '#fff3c4'; edge = '#e2ad3f';
    } else if (!q) {
      lines = ['🪟 × 8  ➜  🔔']; zhLine = data.settings.chinese ? '钟楼' : '';
    } else if (toastOn) {
      lines = [toastText]; zhLine = ''; bg = '#fffbe6'; edge = '#f5c542';
    } else if (phase === 'feedback') {
      // Wrong answers: the "how" goes under the clock, next to the Next button.
      lines = lastRight ? fbLines : fbLines.slice(0, 1); zhLine = fbZh;
      if (lastRight) { bg = '#e9f8ee'; edge = '#2e9e5b'; } else { bg = '#fff0e3'; edge = '#e08a3c'; }
    } else {
      lines = q.lines; zhLine = data.settings.chinese ? q.zh : '';
    }
    const pulse = Math.max(0, 1 - (time - bannerPulseAt) / 0.3);
    ctx.save();
    if (pulse > 0) {
      const k = 1 - 0.03 * pulse;
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      ctx.scale(k, k);
      ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    }
    ctx.fillStyle = 'rgba(60,40,20,0.18)';
    roundRect(b.x + 2, b.y + 4, b.w, b.h, 18);
    ctx.fill();
    ctx.fillStyle = bg;
    roundRect(b.x, b.y, b.w, b.h, 18);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = edge;
    ctx.stroke();
    const speaker = q && phase === 'ask' && state === 'play' && data.settings.voice && !toastOn;
    const maxW = b.w - (speaker ? 60 : 24);
    const fit = fitLines(lines, zhLine, maxW, b.h - 14, mode === 'portrait' ? 30 : 28, 15);
    drawTextBlock(fit, b.x + b.w / 2, b.y + 7, b.h - 14, '#2d2a32', '#c2410c', zhLine);
    if (speaker) {
      ctx.font = `20px ${EMOJI_FONT}`;
      ctx.fillStyle = '#000';
      ctx.globalAlpha = 0.6;
      ctx.textAlign = 'center';
      ctx.fillText('🔊', b.x + b.w - 19, b.y + 20);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ---------- Phones: touch buttons ----------
  const isDown = (id) => pressedId === id && (hold || time < pressUntil);

  function circArrow(x, y, r, dir, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const a0 = -Math.PI / 2 - dir * 0.9;
    const a1 = a0 + dir * Math.PI * 1.35;
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a1, dir < 0);
    ctx.stroke();
    const tx = -Math.sin(a1) * dir;
    const ty = Math.cos(a1) * dir;
    const hx = x + Math.cos(a1) * r;
    const hy = y + Math.sin(a1) * r;
    ctx.beginPath();
    ctx.moveTo(hx + tx * 6, hy + ty * 6);
    ctx.lineTo(hx - tx * 2 + Math.cos(a1) * 5, hy - ty * 2 + Math.sin(a1) * 5);
    ctx.lineTo(hx - tx * 2 - Math.cos(a1) * 5, hy - ty * 2 - Math.sin(a1) * 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // A tiny clock hand lying on its side, pivot on the left.
  function tinyHand(x, y, len, width, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -width / 2);
    ctx.lineTo(len * 0.6, -width / 2);
    ctx.lineTo(len * 0.9, -width * 0.28);
    ctx.lineTo(len, 0);
    ctx.lineTo(len * 0.9, width * 0.28);
    ctx.lineTo(len * 0.6, width / 2);
    ctx.lineTo(0, width / 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, width * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = '#c08a2a';
    ctx.fill();
    ctx.restore();
  }

  function handButton(id, x, y, w, h, hand, dir, label, fn, repeat) {
    const blue = hand === 'minute';
    const color = blue ? MIN_COLOR : HOUR_COLOR;
    const down = isDown(id);
    button(x, y, w, h, {
      fill: down ? (blue ? '#dcecff' : '#ffe3df') : '#fff',
      edge: blue ? '#8fbcf0' : '#f2a59d',
      shadow: blue ? '#a9c6ea' : '#e7b3ad',
      lift: down ? -4 : 0,
    });
    const yy = y + (down ? 4 : 0);
    let len = blue ? Math.min(w * 0.46, 44) : Math.min(w * 0.3, 28);
    const hw = blue ? 8 : 12;
    const r = 9;
    // Tall buttons: picture above the words. Short wide buttons (landscape): side by side.
    const wide = w > h * 2.4;
    let size = Math.min(19, Math.round(h * (wide ? 0.36 : 0.28)));
    ctx.font = `900 ${size}px ${UI_FONT}`;
    let labW = ctx.measureText(label).width;
    if (wide) {
      const minLen = blue ? 26 : 18;
      len = Math.max(minLen, Math.min(len, w - 20 - 10 - r * 2 - 8 - labW));
      while (len + 10 + r * 2 + 8 + labW > w - 16 && size > 13) {
        size--;
        ctx.font = `900 ${size}px ${UI_FONT}`;
        labW = ctx.measureText(label).width;
      }
    }
    const total = len + 10 + r * 2;
    const iconY = wide ? yy + h / 2 : yy + h * 0.36;
    const left = wide ? x + (w - total - 8 - labW) / 2 : x + (w - total) / 2;
    if (dir < 0) {
      circArrow(left + r, iconY, r, -1, color);
      tinyHand(left + r * 2 + 12, iconY, len, hw, color);
    } else {
      tinyHand(left + 2, iconY, len, hw, color);
      circArrow(left + len + 10 + r, iconY, r, 1, color);
    }
    ctx.font = `900 ${size}px ${UI_FONT}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    if (wide) {
      ctx.textAlign = 'left';
      ctx.fillText(label, left + total + 8, iconY + 1);
    } else {
      while (ctx.measureText(label).width > w - 10 && size > 13) { size--; ctx.font = `900 ${size}px ${UI_FONT}`; }
      ctx.textAlign = 'center';
      ctx.fillText(label, x + w / 2, yy + h * 0.74);
    }
    hits.push({ id, x, y, w, h, repeat, fn: () => { coachSeen.set = true; fn(); } });
  }

  function bigButton(id, x, y, w, h, text, colors, fn, size = 30) {
    const down = isDown(id);
    button(x, y, w, h, { fill: colors[0], edge: colors[1], shadow: colors[2], lift: down ? -4 : 0 });
    let s = size;
    ctx.font = `900 ${s}px ${UI_FONT}`;
    while (ctx.measureText(text).width > w - 16 && s > 16) { s--; ctx.font = `900 ${s}px ${UI_FONT}`; }
    ctx.fillStyle = colors[3] || '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + (down ? 4 : 0));
    hits.push({ id, x, y, w, h, fn });
  }

  function drawHintButton() {
    const hb = PL.hint;
    const down = isDown('hint');
    const y = hb.y + (down ? 3 : 0);
    ctx.fillStyle = '#e8d489';
    ctx.beginPath(); ctx.arc(hb.x, hb.y + 4, hb.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = time < labelFlashUntil ? '#fff3b0' : '#fffbe6';
    ctx.beginPath(); ctx.arc(hb.x, y, hb.r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f0cf5a';
    ctx.stroke();
    ctx.font = `26px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💡', hb.x, y + 1);
    const pad = 8;
    hits.push({ id: 'hint', x: hb.x - hb.r - pad, y: hb.y - hb.r - pad, w: (hb.r + pad) * 2, h: (hb.r + pad) * 2, fn: hint });
  }

  function drawWrongArea() {
    const c = PL.ctrl;
    const gap = 8;
    let ex;
    let nx;
    if (mode === 'portrait') {
      const nw = 118;
      ex = { x: c.x, y: c.y, w: c.w - nw - gap, h: c.h };
      nx = { x: c.x + c.w - nw, y: c.y, w: nw, h: c.h };
    } else {
      const nh = Math.min(62, c.h * 0.38);
      ex = { x: c.x, y: c.y, w: c.w, h: c.h - nh - gap };
      nx = { x: c.x, y: c.y + c.h - nh, w: c.w, h: nh };
    }
    ctx.fillStyle = 'rgba(60,40,20,0.15)';
    roundRect(ex.x + 2, ex.y + 4, ex.w, ex.h, 16);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    roundRect(ex.x, ex.y, ex.w, ex.h, 16);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f0c49a';
    ctx.stroke();
    const lines = fbLines.slice(1);
    if (lines.length) {
      const fit = fitLines(lines, '', ex.w - 20, ex.h - 12, 19, 14, true);
      drawTextBlock(fit, ex.x + ex.w / 2, ex.y + 6, ex.h - 12, '#2d2a32', '#c2410c', '');
    }
    const pulse = Math.sin(time * 4) * 2;
    const down = isDown('next');
    button(nx.x, nx.y, nx.w, nx.h, { fill: '#2e9e5b', edge: '#23804a', shadow: '#1d6b3d', lift: down ? -4 : pulse });
    ctx.fillStyle = '#fff';
    ctx.font = `900 26px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Next ▶', nx.x + nx.w / 2, nx.y + nx.h / 2 - (down ? -4 : pulse));
    // A short wait so a quick double tap on Check can't skip the explanation.
    hits.push({ id: 'next', ...nx, fn: () => advance(0.7) });
  }

  function drawPraiseCard() {
    const c = PL.ctrl;
    const h = Math.min(c.h, 84);
    const y = c.y + (c.h - h) / 2;
    button(c.x + 12, y, c.w - 24, h, { fill: '#e9f8ee', edge: '#2e9e5b', shadow: '#bfe3cb' });
    ctx.fillStyle = '#1f7a45';
    ctx.font = `900 34px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`✔ ${q.answerText}`, c.x + c.w / 2, y + h / 2);
  }

  function choiceRects() {
    const c = PL.ctrl;
    const n = q.options.length;
    const gap = 8;
    const out = [];
    for (let i = 0; i < n; i++) {
      if (mode === 'portrait') {
        const bw = (c.w - gap * (n - 1)) / n;
        out.push({ x: c.x + i * (bw + gap), y: c.y, w: bw, h: c.h - 6 });
      } else {
        const bh = (c.h - gap * (n - 1)) / n;
        out.push({ x: c.x, y: c.y + i * (bh + gap), w: c.w, h: bh - 4 });
      }
    }
    return out;
  }

  function drawChoices() {
    const rects = choiceRects();
    q.options.forEach((opt, i) => {
      const r = rects[i];
      const id = `opt${i}`;
      let fill = '#fff';
      let edge = '#e2d8c6';
      let ink = '#2d2a32';
      let lift = 0;
      if (phase === 'feedback') {
        if (i === q.answerIdx) { fill = '#e6f7ec'; edge = '#2e9e5b'; ink = '#1f7a45'; }
        else if (i === q.picked) { fill = '#fdecec'; edge = '#d9534f'; ink = '#b23b37'; }
        else { ink = '#9a93a8'; }
      } else if (isDown(id)) {
        fill = '#eaf5ff'; edge = '#4aa8ff'; lift = -4;
      } else if (usedKeys && i === sel) {
        fill = '#eaf5ff'; edge = '#4aa8ff'; lift = 3;
      } else if (!(usedKeys && sel >= 0)) {
        lift = waitBob();
      }
      button(r.x, r.y, r.w, r.h, { fill, edge, lift });
      const sub = q.subs ? q.subs[i] : null;
      const cy = r.y - lift + r.h / 2 - (sub ? 11 : 0);
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxW = r.w - 14;
      let size = mode === 'portrait' ? 34 : 32;
      ctx.font = `900 ${size}px ${UI_FONT}`;
      while (ctx.measureText(opt).width > maxW && size > 22) { size--; ctx.font = `900 ${size}px ${UI_FONT}`; }
      if (ctx.measureText(opt).width <= maxW) {
        ctx.fillText(opt, r.x + r.w / 2, cy);
      } else {
        let s2 = 22;
        let two;
        do {
          ctx.font = `900 ${s2}px ${UI_FONT}`;
          two = wrapRich(opt, maxW);
          s2--;
        } while (two.length > 2 && s2 > 15);
        const lh = s2 * 1.15;
        two.forEach((l, j) => ctx.fillText(l, r.x + r.w / 2, cy + (j - (two.length - 1) / 2) * lh));
      }
      if (sub) {
        ctx.font = `800 15px ${UI_FONT}`;
        ctx.fillStyle = '#6b6475';
        ctx.fillText(sub, r.x + r.w / 2, cy + 28);
      }
      if (phase === 'feedback' && (i === q.answerIdx || i === q.picked)) {
        ctx.font = `20px ${EMOJI_FONT}`;
        ctx.fillStyle = '#000';
        ctx.fillText(i === q.answerIdx ? '✅' : '❌', r.x + r.w - 14, r.y + 14);
      }
      if (phase === 'ask') hits.push({ id, ...r, fn: () => { if (!tooSoon()) coachSeen.choice = true; choose(i); } });
    });
    return rects;
  }

  function drawPhoneControls() {
    hits = [];
    if (!q || state !== 'play') return;
    const c = PL.ctrl;
    const gap = 8;
    if (q.mode === 'set') {
      if (phase === 'ask') {
        const step = cfg.step;
        const lab = `${step} min`;
        const orange = ['#ff7a3d', '#e0642a', '#c9541f'];
        const btns = [
          ['m-', 'minute', -1, lab, () => setClock(clockT - step), true],
          ['m+', 'minute', 1, lab, () => setClock(clockT + step), true],
          ['h-', 'hour', -1, '− 1 hour', () => setClock(clockT - 60, 0.3), false],
          ['h+', 'hour', 1, '+ 1 hour', () => setClock(clockT + 60, 0.3), false],
        ];
        if (mode === 'portrait') {
          const h1 = Math.round((c.h - gap) * 0.54);
          const mid = 10;
          const bw = (c.w - gap * 3 - mid) / 4;
          const xs = [c.x, c.x + bw + gap, c.x + 2 * (bw + gap) + mid, c.x + 3 * (bw + gap) + mid];
          btns.forEach((b, i) => handButton(b[0], xs[i], c.y, bw, h1, b[1], b[2], b[3], b[4], b[5]));
          bigButton('check', c.x, c.y + h1 + gap, c.w, c.h - h1 - gap - 6, '✔ Check', orange, submit);
        } else {
          const hh = (c.h - gap * 2 - 6) / 3;
          const bw = (c.w - gap) / 2;
          btns.forEach((b, i) => handButton(b[0], c.x + (i % 2) * (bw + gap), c.y + Math.floor(i / 2) * (hh + gap), bw, hh, b[1], b[2], b[3], b[4], b[5]));
          bigButton('check', c.x, c.y + 2 * (hh + gap), c.w, hh, '✔ Check', orange, submit, 28);
        }
        drawHintButton();
      } else if (lastRight) {
        drawPraiseCard();
      } else {
        drawWrongArea();
      }
      drawCoach(null);
      return;
    }
    if (phase === 'feedback' && !lastRight) { drawWrongArea(); return; }
    const rects = drawChoices();
    if (phase === 'ask') drawHintButton();
    drawCoach(rects);
  }

  // 👆 A finger shows what to do the first time (goes away as soon as he touches).
  function drawCoach(rects) {
    if (state !== 'play' || phase !== 'ask' || !q || towerK > 0.01) return;
    let x;
    let y;
    let alpha = 1;
    if (q.mode === 'set') {
      if (coachSeen.set) return;
      const cyc = (time % 2.4) / 2.4;
      const t = easeInOut(Math.min(1, cyc / 0.7));
      alpha = cyc < 0.85 ? 1 : (1 - cyc) / 0.15;
      const ang = ((minuteAngle(disp) + t * 60) * Math.PI) / 180;
      const p = clockToScreen(CX + Math.sin(ang) * R * 0.8, CY - Math.cos(ang) * R * 0.8);
      x = p.x; y = p.y;
      // a dotted trail showing the drag
      ctx.save();
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeStyle = '#ff9d2e';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.setLineDash([2, 10]);
      const a0 = ((minuteAngle(disp) - 90) * Math.PI) / 180;
      const rr = R * 0.8 * PL.s;
      ctx.beginPath();
      ctx.arc(PL.cx, PL.cy, rr, a0, a0 + (t * 60 * Math.PI) / 180);
      ctx.stroke();
      ctx.restore();
    } else {
      if (coachSeen.choice || !rects) return;
      // Glide evenly back and forth over ALL the choices (never resting on one of them).
      const a = rects[0];
      const b = rects[rects.length - 1];
      const u = Math.abs(((time / 3.2) % 2) - 1); // triangle wave 0..1..0
      if (mode === 'portrait') { x = a.x + a.w / 2 + 10 + u * (b.x - a.x); y = a.y + a.h * 0.62; }
      else { x = a.x + a.w - 34; y = a.y + a.h * 0.3 + u * (b.y - a.y); }
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `46px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 6;
    ctx.fillText('👆', x + 4, y - 6);
    ctx.restore();
  }

  function drawPhone() {
    const k = easeInOut(Math.min(1, towerK));
    PL.clockZoom = Math.max(0.001, 1 - k);
    ctx.clearRect(0, 0, LW, LH);
    // The storybook sky + village, scaled to cover the screen (ground at the bottom).
    const sc = Math.max(LW / W, LH / H);
    ctx.save();
    ctx.translate((LW - W * sc) / 2, LH - H * sc);
    ctx.scale(sc, sc);
    drawSky();
    ctx.restore();
    if (mode === 'landscape' || k > 0.01) {
      const t = towerXform();
      ctx.save();
      if (mode === 'portrait') ctx.globalAlpha = k;
      ctx.translate(t.ox, t.oy);
      ctx.scale(t.s, t.s);
      drawTower();
      drawHero();
      ctx.restore();
    }
    if (k < 0.99) {
      const s = PL.s * PL.clockZoom;
      ctx.save();
      ctx.translate(PL.cx, PL.cy);
      ctx.scale(s, s);
      ctx.translate(-CX, -CY);
      drawClock();
      ctx.restore();
    }
    drawPhoneBanner();
    if (mode === 'portrait' && k < 0.99) drawStrip(1 - k);
    drawPhoneControls();
    drawEffects();
  }

  function draw() {
    if (isPhone()) { drawPhone(); return; }
    drawSky();
    ctx.save();
    ctx.translate(TX, 0);
    drawTower();
    drawHero();
    ctx.restore();
    drawBanner();
    drawClock();
    drawColumn();
    drawEffects();
  }

  // ---------- Update loop ----------
  function update(dt) {
    time += dt;
    if (anim) {
      anim.t += dt / anim.dur;
      const e = anim.t >= 1 ? 1 : easeInOut(anim.t);
      disp = lerp(anim.from, anim.to, e);
      if (anim.t >= 1) { disp = anim.to; anim = null; }
    }
    if (heroAnim.t < 1) heroAnim.t = Math.min(1, heroAnim.t + dt / 0.6);
    if (heroAnim.t >= 1) heroAnim.from = heroAnim.to;
    bellAmp = Math.max(0, bellAmp - dt * 0.45);
    const towerGoal = state === 'celebrate' || state === 'result' ? 1 : 0;
    towerK = towerGoal > towerK ? Math.min(1, towerK + dt / 0.9) : Math.max(0, towerK - dt / 0.5);
    const skyGoal = Math.min(1, floor / FLOORS);
    skyProgress += (skyGoal - skyProgress) * Math.min(1, dt * 1.5);

    const SW = isPhone() ? W : LW;
    for (const c of clouds) { c.x += c.v * dt; if (c.x > SW + 80) { c.x = 180; c.y = 150 + Math.random() * 120; } }
    for (const b of birds) { b.x += b.v * dt; if (b.x > SW + 20) { b.x = -20; b.y = 170 + Math.random() * 90; } }

    if (state === 'play') {
      stats.seconds += dt;
      g.seconds += dt;
      data.playSeconds += dt;
      if (time - lastSaveAt > 15) { lastSaveAt = time; persist(); }
      if (phase === 'feedback' && autoNextAt && time >= autoNextAt) advance();
    }

    blocks.update(dt);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floaters) { f.y -= 40 * dt; f.life -= dt; }
    floaters = floaters.filter((f) => f.life > 0);
  }

  // ---------- Sizing (crisp on Retina screens) ----------
  // Laptop-sized windows get the board filling the window (760 tall, as wide as it fits) with a slim
  // top bar over the sky. Anything smaller (phones, small tablets) gets a phone layout: portrait or
  // landscape, filling the screen inside the safe areas.
  function pickMode() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const deskScale = Math.min((w - 356) / W, (h - 24) / H);
    if (deskScale >= 0.7) return 'desk';
    return h >= w ? 'portrait' : 'landscape';
  }

  // Laptop: share the extra width out (a little margin left of the tower, room either side of the
  // clock, a wider answer column, more village on the right) and make room for the top bar.
  function deskLayout(scale) {
    const extra = LW - W;
    TX = Math.round(extra * 0.15);
    CX = 530 + TX + Math.round(extra * 0.25);
    COL.w = 206 + Math.round(extra * 0.15);
    COL.x = 818 + TX + Math.round(extra * 0.45);
    BANNER.x = T_RIGHT + 40 + TX;
    BANNER.w = COL.x + COL.w - BANNER.x;
    const barBottom = (6 + 54 + 6) / scale; // the top bar is 54 CSS px tall, 6 px from the top
    BANNER.y = Math.round(barBottom);
    BANNER.h = Math.min(128, Math.round(CY - R - 55 - 4 - BANNER.y)); // stop above the ":00" label
    const bar = el('topbar');
    bar.style.left = `${Math.round(BANNER.x * scale)}px`;
    bar.style.width = `${Math.round(BANNER.w * scale)}px`;
    bar.classList.toggle('tight', BANNER.w * scale < 760);
  }

  let pixelScale = 1;
  function resize() {
    mode = pickMode();
    document.documentElement.dataset.layout = mode;
    const dpr = window.devicePixelRatio || 1;
    const hud = el('phud');
    dropCaches();
    if (mode === 'desk') {
      PL = null;
      const availW = window.innerWidth - 16;
      const availH = window.innerHeight - 16;
      const scale = Math.max(0.4, Math.min(availW / W, availH / H, 1.6));
      // Wider windows get a wider scene (more village), never a stretched one.
      LW = Math.max(W, Math.min(Math.floor(availW / scale), Math.round(W * 1.6)));
      LH = H;
      const cw = Math.round(LW * scale);
      const ch = Math.round(H * scale);
      stage.style.width = `${cw}px`;
      stage.style.height = `${ch}px`;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      pixelScale = (cw * dpr) / LW;
      ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
      deskLayout(cw / LW);
      placeWash();
      return;
    }
    // Phones: the original board geometry, placed with transforms (see computeLayout).
    TX = 0;
    CX = 530;
    Object.assign(COL, { x: 818, w: 206 });
    Object.assign(BANNER, { x: 252, y: 12, w: 776, h: 128 });
    stage.style.width = '';
    stage.style.height = '';
    LW = Math.max(240, stage.clientWidth);
    LH = Math.max(240, stage.clientHeight);
    canvas.style.width = `${LW}px`;
    canvas.style.height = `${LH}px`;
    canvas.width = Math.round(LW * dpr);
    canvas.height = Math.round(LH * dpr);
    pixelScale = dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
    hud.style.left = `${PL.hud.left}px`;
    hud.style.width = `${PL.hud.width}px`;
    hud.style.right = 'auto';
    placeWash();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => { resize(); setTimeout(resize, 250); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { persist(); if (state === 'play') showPause(); }
  });

  // Hook for automated tests.
  window.__game = {
    get state() { return state; },
    get phase() { return phase; },
    get level() { return g.level; },
    get floor() { return floor; },
    get firstTry() { return firstTry; },
    get question() {
      if (!q) return null;
      return {
        id: q.id, type: q.type, mode: q.mode, variant: q.variant,
        target: q.target != null ? norm(q.target) : null,
        targetText: q.target != null ? fmt(q.target) : null,
        answer: q.answer != null ? q.answer : q.answerText,
        answerIdx: q.answerIdx, options: q.options ? [...q.options] : null,
        lines: q.lines, zh: q.zh, sel, clock: norm(clockT), step: cfg.step,
      };
    },
    get disp() { return disp; },
    get mode() { return mode; },
    get layout() { return PL; },
    get hits() { return hits.map((h) => ({ id: h.id, x: h.x, y: h.y, w: h.w, h: h.h })); },
    clockToScreen,
    ask(type, variant) { forcedNext = { type, variant }; if (state === 'play' && phase === 'ask') nextQuestion(); },
    setLevel(n) { g.level = n; cfg = cfgFor(n); updateHud(); },
    logic: { norm, T, fmt, hourAngle, minuteAngle, zhTime, zhDur, durText, wordsFor, cfgFor, makeQuestion, explainForward, explainBackward, shortest },
  };

  // Keyboard players: after a few quiet seconds the keys for *this* moment float up (plus "esc 🏠").
  MQ.Idle.attach(stage, {
    delay: g.played < 2 ? 2500 : 4000,
    active: () => state === 'play' && !!q && (phase === 'ask' || (phase === 'feedback' && !lastRight)),
    keys: () => {
      if (phase === 'feedback') return [['return'], 'next'];
      if (q.mode === 'set') return [[['←', '→'], 'long hand'], [['↑', '↓'], 'short hand'], [['return'], 'check']];
      return [[['←', '→'], 'pick'], [['return'], 'go']];
    },
  });

  resize();
  MQ.Music.play('minuet');
  newRound();
  showIntro();
  requestAnimationFrame(frame);
})();
