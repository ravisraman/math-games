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
  const CX = 530;            // big clock centre
  const CY = 456;
  const R = 216;             // clock face radius (brass bezel sits outside this)
  const COL = { x: 818, w: 206 };             // right-hand column: choices / controls
  const BANNER = { x: 252, y: 12, w: 776, h: 128 };
  const T_CX = 126;          // tower centre line
  const T_LEFT = 40;
  const T_RIGHT = 212;
  const T_TOP = 206;         // top of the tower body (belfry sits above)
  const GROUND = 726;
  const HOUR_COLOR = '#e0473c';
  const MIN_COLOR = '#2f6fd6';

  const SKILLS = {
    set: 'Setting the clock',
    read: 'Reading the clock',
    words: 'Quarter past / to',
    elapsed: 'Elapsed time',
    ampm: 'a.m. / p.m.',
  };
  const SKILL_TAG = {
    set: '⏰ Set the clock',
    read: '👀 Read the clock',
    words: '💬 Clock words',
    elapsed: '⏳ How much time?',
    ampm: '🌗 a.m. or p.m.?',
  };

  // ---------- Save data ----------
  const data = MQ.load();
  MQ.applySettings(data.settings);
  const g = (data.games[GAME_ID] = Object.assign(
    { level: 1, maxLevel: 1, played: 0, seconds: 0, history: [], skills: {} },
    data.games[GAME_ID] || {}
  ));
  g.lowRounds = g.lowRounds || 0;
  const hero = data.player.hero || '🐥';
  function persist() { MQ.save(data); }

  // ---------- DOM ----------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
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
      });
    } else if (L === 2) {
      Object.assign(c, {
        minutes: [0, 15, 30, 45, 15, 45], words: ['half', 'qpast', 'qto', 'qpast', 'qto'], mix: { set: 3, read: 3, words: 3 },
        title: 'Quarter past & quarter to', desc: 'Quarter past = :15. Quarter to = :45.',
      });
    } else if (L === 3) {
      Object.assign(c, {
        minutes: EVERY5, words: ['half', 'qpast', 'qto'], mix: { set: 3, read: 3, words: 1 },
        title: 'Every 5 minutes', desc: 'Any time on a 5-minute mark. Count by 5s!',
      });
    } else if (L === 4) {
      Object.assign(c, {
        minutes: EVERY5, labels: 0.6, elapsed: 'hours', words: ['half', 'qpast', 'qto'],
        mix: { set: 2, read: 2, words: 1, elapsed: 3, ampm: 1 },
        title: 'How much later? (hours)', desc: 'Add whole hours and half hours. Morning (a.m.) or night (p.m.)?',
      });
    } else if (L === 5) {
      Object.assign(c, {
        minutes: EVERY5, labels: 0.4, elapsed: 'steps', words: ['qpast', 'qto', 'npast', 'nto'],
        mix: { set: 2, read: 2, words: 1, elapsed: 3, ampm: 1 },
        title: 'Later by 5s & 15s', desc: 'Add minutes — even past the next hour, like 2:45 + 30 minutes.',
      });
    } else if (L === 6) {
      Object.assign(c, {
        minutes: EVERY1, step: 1, labels: 0.2, elapsed: 'steps', words: ['qpast', 'qto', 'npast', 'nto'],
        mix: { set: 3, read: 3, words: 1, elapsed: 2, ampm: 1 },
        title: 'To the exact minute', desc: 'Read and set times like 3:37. Count the little ticks!',
      });
    } else {
      Object.assign(c, {
        minutes: EVERY1, step: 1, labels: 0, elapsed: 'hard', words: ['qpast', 'qto', 'npast', 'nto'], oddStart: L >= 8,
        mix: { set: 2, read: 2, words: 1, elapsed: 3, ampm: 1 },
        title: 'Clock master', desc: 'Everything mixed, with trickier elapsed time — even past 12!',
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
        if (Math.abs(shortest(s1, target)) >= 20) return s1;
        continue;
      }
      const s = c.L <= 2 ? T(rand(1, 12), pick([0, 0, 30])) : T(rand(1, 12), rand(0, 11) * 5);
      if (Math.abs(shortest(s, target)) >= 20 && minOf(s) !== minOf(target)) return s;
    }
    return norm(target + 200);
  }

  // Three distinct choices: the answer, then classic mistakes, then fallbacks.
  function buildOptions(correct, cands, fallback) {
    const out = [correct];
    for (const x of [...cands, ...fallback]) {
      if (out.length >= 3) break;
      if (x && !out.includes(x)) out.push(x);
    }
    shuffle(out);
    return { options: out, answerIdx: out.indexOf(correct), answer: correct };
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
    if (m >= 30) first.push(fmt(t + 60)); // the hour hand is close to the next number
    if (m % 5 === 0) rest.push(`${m === 0 ? 12 : m / 5}:${pad((h % 12) * 5)}`); // hands swapped
    if (m % 5 === 0 && m > 0 && m / 5 < 10) rest.push(`${h}:0${m / 5}`); // read the number, not the minutes
    if (m % 5 !== 0) rest.push(fmt(t + 5), fmt(t - 5)); // counted ticks from the wrong number
    if (m > 0 && m < 30) rest.push(fmt(t - 60));
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
      ...buildOptions(fmt(t), readMistakes(t), [t + 60, t - 60, t + 30, t - 30, t + 15, t + 5].map(fmt)),
      answerText: fmt(t), answerSpeak: speakTime(t),
      explain: explainTime(t),
    };
  }

  function wordsTime(kind) {
    const m = { oclock: 0, half: 30, qpast: 15, qto: 45, npast: pick([5, 10, 20, 25]), nto: pick([35, 40, 50, 55]) }[kind];
    return T(rand(1, 12), m);
  }
  function wordsDigitalMistakes(t) {
    const h = hourOf(t);
    const m = minOf(t);
    if (m === 45) return [t + 60, t + 30, t - 30];          // "quarter to 9": 9:45, 9:15, 8:15
    if (m === 15) return [t + 30, T(h, 25), t - 30];        // "quarter past 4": 4:45, 4:25 (a quarter is 25¢!), 3:45
    if (m === 30) return [t - 60, t + 60, t - 30];
    if (m === 0) return [t + 30, t + 60, t - 60];
    if (m < 30) return [T(h, 60 - m), t + 60, t - 60];     // past ↔ to mix-up
    return [T(h + 1, 60 - m), t + 60, T(h, 60 - m)];
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
        ...buildOptions(fmt(t), wordsDigitalMistakes(t).map(fmt), [t + 60, t - 60, t + 30, t + 5].map(fmt)),
        answerText: fmt(t), answerSpeak: speakTime(t), explain,
      };
    }
    const cands = [...shuffle([t + 30, t - 30]), t + 60, t - 60].map(wordsFor);
    return {
      type: 'words', mode: 'choice', variant: 'toWords', show: t, reveal: t,
      lines: ['What do we call this time?'], zh: '现在几点?', zhAfter: zhTime(t),
      speak: 'Which words match the clock?',
      ...buildOptions(words, cands, []),
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
    return out.filter((x) => norm(x) !== norm(a)).map(fmt);
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
        ...buildOptions(fmt(B), laterMistakes(A, d), [B + 30, B - 15, B + 15, B - 5, B + 5, B + 10].filter((x) => norm(x) !== norm(A)).map(fmt)),
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
        ...buildOptions(durText(dd), cands.filter((x) => x > 0 && x !== dd).map(durText), []),
        answerText: durText(dd), answerSpeak: durWords(dd),
        explain: [explainForward(A, dd).replace(/\.$/, '') + ` → ${durWords(dd)}`],
        wedge: { from: A, delta: dd },
      };
    }
    // earlier: "The party starts at 3:10. The walk takes 30 minutes. When should we leave?"
    const [emoji, l1, l2] = pick(EARLIER);
    const vals = { B: fmt(B), D: durWords(d) };
    const cands = [A + 60, B + d, A - 60, A + 30].filter((x) => norm(x) !== norm(B)).map(fmt);
    return {
      type: 'elapsed', mode: 'choice', variant: 'earlier', show: B, start: B, d,
      lines: [`${emoji} ${fill(l1, vals)}`, fill(l2, vals)],
      speak: plain(`${l1.replace('{B}', speakTime(B))} ${l2.replace('{D}', durWords(d))}`),
      zh: `${zhTime(B)} − ${zhDur(d)}`, zhAfter: zhTime(A),
      ...buildOptions(fmt(A), cands, [A - 15, A + 15, A - 5].map(fmt)),
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
  let sel = 0;
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

  // Clock hands: `clockT` is the logical time (an unbounded number of minutes so hands can
  // spin past 12 smoothly); `disp` is what's drawn and glides toward it.
  let clockT = 0;
  let disp = 0;
  let anim = null;
  let drag = null;

  const heroAnim = { from: 0, to: 0, t: 1 };

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
    sel = q.options ? (q.options.length === 3 ? 1 : 0) : 0;
    if (q.mode === 'set') {
      clockT = nearest(q.start);
      moveClock(clockT, 0.7);
      q.wedgeFrom = q.wedge ? clockT : null;
    } else if (q.show != null) {
      clockT = nearest(q.show);
      moveClock(clockT, 0.7);
      q.wedgeFrom = q.wedge ? clockT : null;
    }
    updateHud();
    MQ.Voice.say(q.speak, 'en-US', { interrupt: true });
    if (data.settings.chinese && q.mode === 'set' && q.type === 'set') MQ.Voice.say(q.zh, 'zh-CN');
    if (q.mode === 'set') {
      say(stats.asked <= 1 && g.played < 3
        ? 'Press → and ← to move the long blue hand. ↑ and ↓ move the short red hand. Then press return!'
        : `${plain(q.lines.join(' '))} Press return when it's ready.`);
    } else {
      say(`${plain(q.lines.join(' '))} Pick with ← → and press return.`);
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

  function submit() {
    if (state !== 'play' || phase !== 'ask' || !q) return;
    let right;
    if (q.mode === 'set') {
      q.theirs = clockT;
      right = norm(clockT) === norm(q.target);
    } else {
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
    if (!floorMissed) { firstTry++; starWindows.push(floor + 1); }
    floor++;
    floorMissed = false;
    climbTo(floor);
    const praise = MQ.pick(MQ.PRAISE);
    fbLines = [`✔ ${praise.en}  {${q.answerText}}`];
    if (q.type === 'elapsed') fbLines.push(q.explain[0]);
    const zhPart = q.zhAfter || (q.mode === 'set' ? q.zh : '');
    fbZh = data.settings.chinese ? `${praise.zh} ${zhPart}` : '';
    revealClock(false);
    const p = heroPos(floor);
    burst(p.x, p.y, '#ffd23f', 18);
    floaters.push({ x: p.x + 30, y: p.y - 20, text: floor >= FLOORS ? 'Top!' : `+1 🪟`, life: 1.2 });
    burst(CX, CY - R * 0.3, '#ffe27a', 14);
    say(`${praise.zh} ${praise.en} ${floor >= FLOORS ? 'You reached the top!' : `Floor ${floor}!`}`);
    if (data.settings.chinese) MQ.Voice.say(`${praise.zh} ${zhPart}`, 'zh-CN', { interrupt: true });
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
    const cheer = wrongStreak >= 2 ? ` ${MQ.CHEER.zh} (${MQ.CHEER.py})` : '';
    say(`Look at the clock: this is ${q.answerText}.${cheer} We'll try one like this again soon. Press return to go on.`);
    MQ.Voice.say(`${opener} The answer is ${q.answerSpeak || speakTime(q.target)}.`, 'en-US', { interrupt: true });
  }

  function advance() {
    if (state !== 'play' || phase !== 'feedback' || time - answeredAt < 0.35) return;
    autoNextAt = 0;
    if (floor >= FLOORS) finishRound();
    else nextQuestion();
  }

  function hint() {
    if (phase !== 'ask' || !q) return;
    stats.hints++;
    MQ.Sound.note(88, 'bell', { dur: 0.8, vel: 0.1 });
    labelFlashUntil = time + 4;
    let text;
    if (q.type === 'set') {
      hintUntil = time + 3;
      const m = minOf(q.target);
      text = `Look for the glowing hands! The long hand goes to ${m === 0 ? 12 : m % 5 === 0 ? m / 5 : `${Math.floor(m / 5) || 12} and ${m % 5} ticks`}.`;
    } else if (q.type === 'read') {
      text = 'First look at the short red hand: which number did it pass? Then count the long blue hand by 5s.';
    } else if (q.type === 'words') {
      text = "Quarter = 15 minutes. Half = 30 minutes. 'Past' means after the hour, 'to' means before the next hour.";
    } else if (q.type === 'elapsed') {
      text = q.variant === 'earlier'
        ? 'Count backward! Each number on the clock is 5 minutes. 60 minutes = 1 hour.'
        : 'Count on from the start time. Each number on the clock is 5 minutes. 60 minutes = 1 hour.';
    } else {
      text = 'a.m. = morning, before lunch ☀️. p.m. = afternoon and night 🌙.';
    }
    say(`💡 ${text}`, { speak: true });
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
    say('🔔 You made it to the top! Ding, dong!');
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        MQ.Sound.note(48, 'bell', { dur: 3, vel: 0.25 });
        MQ.Sound.note(60, 'bell', { dur: 2.2, vel: 0.08 });
        bellAmp = 1;
        burst(T_CX, 160, '#ffe27a', 16);
      }, 700 + i * 950);
    }
    setTimeout(() => {
      MQ.Sound.win();
      for (let i = 0; i < 6; i++) setTimeout(() => confetti(rand(300, 1000), rand(160, 420)), i * 140);
      const praise = MQ.pick(MQ.PRAISE);
      if (data.settings.chinese) MQ.Voice.say(praise.zh, 'zh-CN', { interrupt: true });
      else MQ.Voice.say(praise.en, 'en-US', { interrupt: true });
      setTimeout(() => showResult(praise), 1500);
    }, 700 + 3 * 950);
  }

  function starsFor(n) {
    if (n >= 7) return 3;
    if (n >= 5) return 2;
    return 1;
  }

  function adapt() {
    const before = g.level;
    g.played++;
    if (firstTry >= 7) {
      g.level = Math.min(MAX_LEVEL, g.level + 1);
      g.lowRounds = 0;
    } else if (firstTry <= 4) {
      g.lowRounds++;
      if (g.lowRounds >= 2 && g.level > 1) { g.level--; g.lowRounds = 0; }
    } else {
      g.lowRounds = 0;
    }
    g.maxLevel = Math.max(g.maxLevel, g.level);
    if (g.level > before) return '⬆ Level up! The next climb is a little harder.';
    if (g.level < before) return "Let's practice an easier climb, then come back up!";
    return "Let's climb this level again for more stars!";
  }

  function showResult(praise) {
    const stars = starsFor(firstTry);
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

    state = 'result';
    const starHtml = [1, 2, 3].map((i) => `<span class="${i <= stars ? '' : 'off'}">⭐</span>`).join('');
    const mins = Math.max(1, Math.round(stats.seconds / 60));
    showOverlay(`
      <div class="card">
        <h2>🔔 Level ${level} climb complete!</h2>
        <div class="stars-row">${starHtml}</div>
        <div class="praise"><span class="zh">${praise.zh}</span><small>${praise.py} · ${praise.en}</small></div>
        <div class="stats">
          <span>🪟 ${firstTry}/${FLOORS} right on the first try</span>
          <span>⏱ ${mins} min</span>
          ${stats.hints ? `<span>💡 ${stats.hints} hint${stats.hints === 1 ? '' : 's'}</span>` : ''}
        </div>
        <div class="next">${move}</div>
        ${newHero ? `<div class="next">🎉 New hero unlocked: ${newHero.emoji} ${newHero.name}! Pick it in the portal.</div>` : ''}
        <button class="btn start" id="again">Climb again ▶</button>
        <div class="press">Press <span class="key">return</span> to climb again</div>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') nextRound(); }
    );
    el('again').addEventListener('click', nextRound);
  }

  function nextRound() {
    newRound();
    showIntro();
  }

  // ---------- HUD ----------
  function updateHud() {
    el('level').textContent = g.level;
    el('stars').textContent = data.stars;
    el('windows').innerHTML = Array.from({ length: FLOORS }, (_, i) => {
      const k = i + 1;
      const cls = k <= floor ? 'win lit' : k === floor + 1 && state === 'play' ? 'win next' : 'win';
      return `<span class="${cls}">${starWindows.includes(k) ? '⭐' : ''}</span>`;
    }).join('');
    el('floor').textContent = floor >= FLOORS ? 'Top of the tower! 🔔' : `Floor ${floor} of ${FLOORS}`;
    el('skill').textContent = state === 'celebrate' || state === 'result' ? '🔔 Ring the bell!' : q ? SKILL_TAG[q.type] : '🕰️ Clock Tower';
    el('level-title').textContent = `Level ${g.level}: ${cfgFor(g.level).title}`;
  }

  function say(text, { speak = false } = {}) {
    el('message').textContent = text;
    const b = el('bubble');
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    if (speak) MQ.Voice.say(text.replace(/\p{Extended_Pictographic}/gu, ''), 'en-US', { interrupt: true });
  }

  // ---------- Input ----------
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k.startsWith('Arrow') || k === ' ' || k === 'Enter' || k === 'Escape') e.preventDefault();
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
    if (k === 'ArrowLeft' || k === 'ArrowUp') { sel = Math.max(0, sel - 1); MQ.Sound.click(); }
    else if (k === 'ArrowRight' || k === 'ArrowDown') { sel = Math.min(n - 1, sel + 1); MQ.Sound.click(); }
    else if (k === 'Enter' || k === ' ') submit();
  }

  function toggleMusic() {
    data.settings.music = data.settings.music === false;
    MQ.applySettings(data.settings);
    persist();
    say(data.settings.music ? '🎵 Music on' : '🔇 Music off');
  }

  // Mouse / trackpad: click choices and buttons, drag the clock hands.
  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

  canvas.addEventListener('pointerdown', (e) => {
    MQ.Sound.ensure();
    if (state !== 'play') return;
    const p = toBoard(e);
    const hit = hits.find((h) => inside(p, h));
    if (hit) { hit.fn(); return; }
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
  canvas.addEventListener('pointermove', (e) => {
    const p = toBoard(e);
    if (drag) { dragTo(p); return; }
    const overHit = hits.some((h) => inside(p, h));
    const overClock = state === 'play' && phase === 'ask' && q && q.mode === 'set' && Math.hypot(p.x - CX, p.y - CY) < R + 30;
    canvas.style.cursor = overHit ? 'pointer' : overClock ? 'grab' : 'default';
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function dragTo(p) {
    if (state !== 'play' || phase !== 'ask' || !q || q.mode !== 'set') { drag = null; return; }
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
  }
  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
    overlayKeys = null;
  }

  function showIntro() {
    state = 'intro';
    const first = g.played === 0;
    const how = `
      <div class="how">
        <div>🕰️ <span class="hand blue">Long blue hand</span> = minutes: <span class="key">←</span> <span class="key">→</span></div>
        <div>🕰️ <span class="hand red">Short red hand</span> = hour: <span class="key">↑</span> <span class="key">↓</span></div>
        <div>✅ Press <span class="key">return</span> to check · <span class="key">H</span> for a hint</div>
      </div>`;
    showOverlay(`
      <div class="card">
        <h1>${hero} Clock Tower</h1>
        <p>You are the village clock keeper!</p>
        <div class="goal">Level ${g.level}: ${MQ.escapeHtml(cfg.title)}</div>
        <p class="hint">${MQ.escapeHtml(cfg.desc)}</p>
        <p>Every right answer lights a window 🪟.<br>Climb 8 floors and ring the big bell 🔔!</p>
        ${first ? how : ''}
        <button class="btn start" id="go">Start climbing ▶</button>
        <div class="press">Press <span class="key">return</span> to start</div>
      </div>`,
      (k) => { if (k === 'Enter' || k === ' ') startPlay(); }
    );
    el('go').addEventListener('click', startPlay);
    MQ.Voice.say(`Clock Tower. Level ${g.level}. ${cfg.title.replace('&', 'and')}.`, 'en-US', { interrupt: true });
    say(`Level ${g.level}: ${cfg.title}. Press return to start!`);
    updateHud();
  }

  function startPlay() {
    hideOverlay();
    state = 'play';
    MQ.Sound.click();
    nextQuestion();
  }

  function showPause() {
    state = 'pause';
    MQ.Voice.stop();
    let sel2 = 0;
    const items = [['▶ Keep playing', () => { hideOverlay(); state = 'play'; }], ['🏠 Back to the portal', () => { persist(); location.href = '../../index.html'; }]];
    const render = () => {
      showOverlay(`
        <div class="card">
          <h2>⏸ Paused</h2>
          <div class="menu">${items.map((it, i) => `<button class="btn ${i === 0 ? '' : 'secondary'} ${i === sel2 ? 'sel' : ''}" data-i="${i}">${it[0]}</button>`).join('')}</div>
          <div class="press">Use <span class="key">↑</span> <span class="key">↓</span> and <span class="key">return</span></div>
        </div>`,
        (k) => {
          if (k === 'ArrowUp' || k === 'ArrowDown') { sel2 = 1 - sel2; render(); }
          else if (k === 'Enter' || k === ' ') items[sel2][1]();
          else if (k === 'Escape') items[0][1]();
        });
      overlay.querySelectorAll('.menu .btn').forEach((b) => b.addEventListener('click', () => items[Number(b.dataset.i)][1]()));
    };
    render();
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
  ];

  function mixColor(a, b, t) {
    const pa = a.match(/\w\w/g).map((x) => parseInt(x, 16));
    const pb = b.match(/\w\w/g).map((x) => parseInt(x, 16));
    return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], t))).join(',')})`;
  }

  function drawSky() {
    // Morning blue slowly warms to golden hour as he climbs.
    const k = skyProgress;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, mixColor('#7cc4ff', '#8f9be8', k));
    sky.addColorStop(0.55, mixColor('#cdeaff', '#ffc98f', k));
    sky.addColorStop(1, mixColor('#fff3dc', '#ffe0a8', k));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sun: rises a little higher and turns golden.
    const sx = 960;
    const sy = lerp(250, 300, k);
    const sun = ctx.createRadialGradient(sx, sy, 10, sx, sy, 110);
    sun.addColorStop(0, `rgba(255,${Math.round(lerp(246, 214, k))},${Math.round(lerp(190, 120, k))},0.95)`);
    sun.addColorStop(0.35, 'rgba(255,220,140,0.35)');
    sun.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(sx - 120, sy - 120, 240, 240);

    // Clouds
    for (const c of clouds) {
      ctx.fillStyle = `rgba(255,255,255,${lerp(0.9, 0.75, k)})`;
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

    // Rolling hills and a little village
    ctx.fillStyle = mixColor('#a8dc8c', '#b9c77a', k);
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, 690);
    ctx.quadraticCurveTo(300, 640, 560, 684);
    ctx.quadraticCurveTo(820, 720, 1040, 660);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    for (const h of HOUSES) {
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
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = mixColor('#6fb851', '#8ea84c', k);
    for (let x = 6; x < W; x += 18) ctx.fillRect(x, GROUND, 8, 4);
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
  function heroPos(f) {
    if (f <= 0) return { x: T_CX, y: GROUND - 30 };
    if (f > FLOORS) return { x: T_CX - 58, y: 178 };
    const w = windowPos(f);
    return { x: w.x, y: w.y + 2 };
  }

  // Stable pseudo-random stone shades.
  const stoneShade = (i) => {
    const v = Math.sin(i * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  };

  function drawTower() {
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

  function drawHero() {
    const e = ease(Math.min(1, heroAnim.t));
    const a = heroPos(Math.round(heroAnim.from));
    const b = heroPos(heroAnim.to);
    const x = lerp(a.x, b.x, e);
    const y = lerp(a.y, b.y, e) - Math.sin(Math.PI * Math.min(1, heroAnim.t)) * 34;
    const bob = heroAnim.t >= 1 ? Math.sin(time * 3) * 1.5 : 0;
    ctx.font = `38px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hero, x, y + bob);
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

    // Elapsed-time wedge
    if (q && q.wedge && q.wedgeFrom != null && (phase === 'feedback' || (phase === 'ask' && q.mode === 'set'))) drawWedge();

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
  function drawHandKeys(x, w, top) {
    button(x, top, w, 178, { fill: 'rgba(255,255,255,0.94)', edge: '#e2d8c6', shadow: 'rgba(0,0,0,0.08)' });
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
      lines = ['🕰️ Welcome, clock keeper!']; zhLine = data.settings.chinese ? '钟楼' : '';
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
    const main = lines.length === 1 && !zhLine ? 38 : lines.length === 1 ? 36 : n >= 4 ? 22 : n === 3 ? 27 : 32;
    const zhSize = Math.min(28, main * 0.85);
    const lh = main * 1.22;
    const total = lines.length * lh + (zhLine ? zhSize * 1.35 : 0);
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
      if (phase === 'ask') hits.push({ x, y: by, w, h: bh, fn: () => { sel = i; submit(); } });
    });
    if (phase === 'ask') {
      const y = top + n * (bh + gap) + 2;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      roundRect(x, y, w, 44, 14);
      ctx.fill();
      keycap(x + 24, y + 21, '←');
      keycap(x + 60, y + 21, '→');
      ctx.fillStyle = '#4a4458';
      ctx.font = `800 16px ${UI_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('pick', x + 82, y + 21);
      keycap(x + 164, y + 21, 'return', 64);
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

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawTower();
    drawHero();
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
    const skyGoal = Math.min(1, floor / FLOORS);
    skyProgress += (skyGoal - skyProgress) * Math.min(1, dt * 1.5);

    for (const c of clouds) { c.x += c.v * dt; if (c.x > W + 80) { c.x = 180; c.y = 150 + Math.random() * 120; } }
    for (const b of birds) { b.x += b.v * dt; if (b.x > W + 20) { b.x = -20; b.y = 170 + Math.random() * 90; } }

    if (state === 'play') {
      stats.seconds += dt;
      g.seconds += dt;
      data.playSeconds += dt;
      if (time - lastSaveAt > 15) { lastSaveAt = time; persist(); }
      if (phase === 'feedback' && autoNextAt && time >= autoNextAt) advance();
    }

    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floaters) { f.y -= 40 * dt; f.life -= dt; }
    floaters = floaters.filter((f) => f.life > 0);
  }

  // ---------- Sizing (crisp on Retina screens) ----------
  let pixelScale = 1;
  function resize() {
    const narrow = window.innerWidth <= 860;
    const availW = narrow ? window.innerWidth - 24 : window.innerWidth - 300 - 20 - 36;
    const availH = narrow ? window.innerHeight * 0.7 : window.innerHeight - 24;
    const scale = Math.max(0.4, Math.min(availW / W, availH / H, 1.5));
    const dpr = window.devicePixelRatio || 1;
    stage.style.width = `${Math.round(W * scale)}px`;
    stage.style.height = `${Math.round(H * scale)}px`;
    canvas.style.width = `${Math.round(W * scale)}px`;
    canvas.style.height = `${Math.round(H * scale)}px`;
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    pixelScale = scale * dpr;
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  }
  window.addEventListener('resize', resize);

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
    ask(type, variant) { forcedNext = { type, variant }; if (state === 'play' && phase === 'ask') nextQuestion(); },
    setLevel(n) { g.level = n; cfg = cfgFor(n); updateHud(); },
    logic: { norm, T, fmt, hourAngle, minuteAngle, zhTime, zhDur, durText, wordsFor, cfgFor, makeQuestion, explainForward, explainBackward, shortest },
  };

  resize();
  MQ.Music.play('minuet');
  newRound();
  showIntro();
  requestAnimationFrame(frame);
})();
