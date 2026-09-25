/* Math Quest portal: pick a game, pick a hero, and a grown-ups corner for settings and progress. */
(function () {
  'use strict';

  let data = MQ.load();
  MQ.applySettings(data.settings);

  const GAMES = [
    {
      id: 'coinCrossing', name: 'Coin Crossing', zh: '过马路', href: 'games/coin-crossing/index.html',
      art: ['🏰', '🪙', '🚗'], theme: 'coins', skill: 'Money',
      what: 'Hop across the roads and collect exactly the right amount of money.',
      levels: 'Levels 1–2 pennies & nickels · 3–4 dimes · 5–7 quarters · 8–9 dollars · 10+ mixed cents/dollars · 14+ $5 bills.',
    },
    {
      id: 'numberFlow', name: 'Number Flow', zh: '数字连线', href: 'games/number-flow/index.html',
      art: ['🔵', '➕', '🟢'], theme: 'flow', skill: 'Adding',
      what: 'Draw paths through numbers that add up to the target — like Flow Free.',
      levels: 'Boards grow from 4×4 with 2 pairs to 7×7 with 5 pairs; numbers from 1–5 up to 10s and 20s; targets from 5 up to ~60.',
    },
    {
      id: 'clockTower', name: 'Clock Tower', zh: '钟楼', href: 'games/clock-tower/index.html',
      art: ['🕰️', '🔔', '⭐'], theme: 'clock', skill: 'Time',
      what: 'Be the clock keeper: read and set the clock, and figure out elapsed time.',
      levels: 'L1 o\'clock & half past · L2 quarter past/to · L3 5-minute times · L4 elapsed hours + a.m./p.m. · L5 elapsed minutes · L6 1-minute times · 7+ mixed.',
    },
    {
      id: 'castleClimb', name: 'Castle Climb', zh: '爬城堡', href: 'games/castle-climb/index.html',
      art: ['🏯', '🏮', '🎆'], theme: 'climb', skill: 'Math facts',
      what: 'Jump to the right answer to climb the tower. Adding and subtracting facts.',
      levels: 'L1 +10 · L2 −10 · L3 +20 make-ten · L4 ±20 · L5 tens · L6 2-digit±1-digit · L7–8 2-digit±2-digit · L9 three numbers · L10 missing numbers · 11+ review to 100.',
    },
  ];

  const $ = (id) => document.getElementById(id);

  function progressText(game) {
    const g = data.games[game.id];
    if (!g || !g.played) return '▶ New game!';
    return `▶ Level ${g.level}`;
  }

  function render() {
    const name = data.player.name;
    $('hello').textContent = name ? `Hi ${name}! Ready to play?` : 'Welcome!';
    $('hero-now').textContent = data.player.hero;
    $('star-count').textContent = data.stars;

    $('games').innerHTML = GAMES.map((g) => `
      <button class="tile nav play theme-${g.theme}" data-game="${g.id}">
        <span class="art" aria-hidden="true">
          <span class="a1">${g.art[0]}</span><span class="a2">${g.art[1]}</span><span class="a3">${g.art[2]}</span>
        </span>
        <span class="body">
          <span class="tag">${g.skill}</span>
          <span class="name">${g.name} <span class="zh">${g.zh}</span></span>
          <span class="what">${g.what}</span>
          <span class="progress">${progressText(g)}</span>
        </span>
      </button>`).join('');

    $('heroes').innerHTML = MQ.HEROES.map((h) => {
      const locked = data.stars < h.stars;
      const on = data.player.hero === h.emoji;
      return `<button class="hero nav ${locked ? 'locked' : ''} ${on ? 'on' : ''}" data-hero="${h.emoji}" aria-label="${h.name}${locked ? ', locked' : ''}">
        <span class="e">${h.emoji}</span>
        <span class="n">${locked ? `⭐ ${h.stars}` : h.name}</span>
      </button>`;
    }).join('');
  }

  document.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-game]');
    if (tile) {
      const game = GAMES.find((g) => g.id === tile.dataset.game);
      MQ.Sound.click();
      location.href = game.href;
      return;
    }
    const heroBtn = e.target.closest('[data-hero]');
    if (heroBtn) {
      const h = MQ.HEROES.find((x) => x.emoji === heroBtn.dataset.hero);
      if (data.stars < h.stars) {
        MQ.Sound.nope();
        MQ.Voice.say(`Earn ${h.stars} stars to unlock the ${h.name}!`, 'en-US', { interrupt: true });
        return;
      }
      data.player.hero = h.emoji;
      MQ.save(data);
      MQ.Sound.star();
      render();
      document.querySelector(`[data-hero="${h.emoji}"]`).focus();
    }
  });

  // ---------- Arrow-key navigation between buttons ----------
  function move(dx, dy) {
    const items = [...document.querySelectorAll('.nav')];
    const cur = document.activeElement && document.activeElement.classList.contains('nav') ? document.activeElement : null;
    if (!cur) { items[0] && items[0].focus(); return; }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      const along = dx ? (bx - ax) * dx : (by - ay) * dy;
      const across = dx ? Math.abs(by - ay) : Math.abs(bx - ax);
      if (along <= 4) continue;
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); MQ.Sound.click(); }
  }

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[e.key]) { e.preventDefault(); move(...dirs[e.key]); }
    if ((e.key === 'm' || e.key === 'M') && !e.repeat) {
      data.settings.music = data.settings.music === false;
      MQ.applySettings(data.settings);
      MQ.save(data);
    }
  });

  // ---------- First visit: ask for a name ----------
  function askName() {
    const dlg = $('name-dialog');
    $('name-input').value = data.player.name || '';
    dlg.showModal();
    $('name-input').focus();
    dlg.addEventListener('close', () => {
      data.player.name = $('name-input').value.trim();
      MQ.save(data);
      render();
      focusFirst();
    }, { once: true });
  }

  function focusFirst() {
    if (MQ.isTouch) return; // keyboard focus rings only make sense on the laptop
    const first = document.querySelector('.tile.play');
    if (first) first.focus();
  }

  // ---------- Grown-ups corner ----------
  const COIN_QUIZ_LABELS = {
    add: 'Adding', count: 'Counting coins', sub: 'Subtracting', change: 'Making change',
    c2d: 'Cents → dollars', d2c: 'Dollars → cents',
  };

  function minutes(sec) {
    const m = Math.round((sec || 0) / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  // Coin Crossing predates the shared history/skills format, so adapt it here.
  function skillsFor(id, g) {
    if (id === 'coinCrossing') {
      return Object.keys(COIN_QUIZ_LABELS).map((k) => ({ label: COIN_QUIZ_LABELS[k], ...((g.quiz || {})[k] || { right: 0, tries: 0 }) }));
    }
    return Object.values(g.skills || {});
  }

  function summaryFor(id, h) {
    if (h.summary) return h.summary;
    if (id === 'coinCrossing') return `${h.target < 100 ? MQ.cents(h.target) : MQ.dollars(h.target)} · ${h.overshoots} too-much · ${h.bonks} bumps`;
    return '';
  }

  function gameCard(game) {
    const g = data.games[game.id] || { level: 1, played: 0, history: [] };
    const hist = (g.history || []).slice(-6).reverse();
    const recent = (g.history || []).slice(-10);
    const avgStars = recent.length ? (recent.reduce((s, h) => s + h.stars, 0) / recent.length).toFixed(1) : '—';
    const skills = skillsFor(game.id, g).map((s) => {
      if (!s.tries) return `<div class="skill"><span>${MQ.escapeHtml(s.label)}</span><div class="bar"><i style="width:0"></i></div><span class="muted">not yet</span></div>`;
      const pct = Math.round((100 * s.right) / s.tries);
      return `<div class="skill"><span>${MQ.escapeHtml(s.label)}</span><div class="bar"><i style="width:${pct}%"></i></div><span>${s.right}/${s.tries}</span></div>`;
    }).join('');
    return `
      <div class="gp-card">
        <h3>${game.art[0]} ${game.name}</h3>
        <div class="gp-level">Level
          <button class="btn secondary small" data-level="${game.id}" data-delta="-1" aria-label="Level down">−</button>
          <span id="gp-level-${game.id}">${g.level || 1}</span>
          <button class="btn secondary small" data-level="${game.id}" data-delta="1" aria-label="Level up">+</button>
        </div>
        <p>Played <b>${g.played || 0}</b> · Highest level <b>${g.maxLevel || 1}</b> · Avg ⭐ <b>${avgStars}</b> · ${minutes(g.seconds)}</p>
        ${game.levels ? `<p class="muted">${game.levels}</p>` : ''}
        ${skills ? `<div class="skills">${skills}</div>` : ''}
        ${hist.length ? `<table class="hist"><tr><th>Level</th><th>Stars</th><th>Details</th></tr>
          ${hist.map((h) => `<tr><td>${h.level}</td><td>${'⭐'.repeat(h.stars)}</td><td>${MQ.escapeHtml(summaryFor(game.id, h))}</td></tr>`).join('')}
        </table>` : '<p class="muted">Not played yet.</p>'}
      </div>`;
  }

  // ---------- Sync between the laptop and the iPhone ----------
  function ago(t) {
    if (!t) return 'not yet';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return new Date(t).toLocaleString();
  }

  function syncCard() {
    const S = MQ.Sync;
    if (!S.code) {
      return `
        <h3>🔄 Sync laptop ⇄ iPhone</h3>
        <p>Keep stars, levels and heroes the same on every device, automatically.</p>
        <div class="row" style="justify-content:flex-start">
          <button class="btn small" id="sync-start">Turn on sync</button>
        </div>
        <p class="muted" style="margin-top:12px">Already turned it on on another device? Type its sync code here:</p>
        <div class="row sync-join" style="justify-content:flex-start">
          <input type="text" id="sync-code" placeholder="XXXX-XXXX-XXXX" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false">
          <button class="btn secondary small" id="sync-join">Join</button>
        </div>
        <p class="sync-msg" id="sync-msg"></p>`;
    }
    return `
      <h3>🔄 Sync laptop ⇄ iPhone <span class="sync-on">ON</span></h3>
      <p>Family sync code:</p>
      <div class="sync-code">${S.pretty(S.code)}</div>
      <p class="muted">On the other device, open Math Quest → ⚙️ Grown-ups → type this code under <b>Sync</b> → Join. On iPhone, do this inside the Home Screen app.</p>
      <p class="muted">Last synced: <b id="sync-when">${ago(S.lastSync)}</b>${S.lastError ? ` · <span class="sync-err">offline — will retry</span>` : ''}</p>
      <div class="row" style="justify-content:flex-start">
        <button class="btn secondary small" id="sync-now">Sync now</button>
        <button class="btn secondary small" id="sync-copy">Copy code</button>
        <button class="btn secondary small" id="sync-stop">Stop syncing here</button>
      </div>
      <p class="sync-msg" id="sync-msg"></p>`;
  }

  function wireSync() {
    const box = $('gp-sync');
    const msg = (t, bad) => { const m = $('sync-msg'); if (m) { m.textContent = t; m.classList.toggle('bad', !!bad); } };
    const redraw = () => { box.innerHTML = syncCard(); wireSync(); };
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('sync-start', async () => {
      msg('Turning on…');
      await MQ.Sync.start();
      data = MQ.load();
      redraw();
      render();
    });
    on('sync-join', async () => {
      msg('Joining…');
      try {
        await MQ.Sync.join($('sync-code').value);
        data = MQ.load();
        MQ.applySettings(data.settings);
        redraw();
        render();
        msg('Joined! Progress from the other device is here now.');
      } catch (e) {
        msg(e.message || 'Could not join.', true);
      }
    });
    on('sync-now', async () => {
      msg('Syncing…');
      const r = await MQ.Sync.now();
      data = MQ.load();
      render();
      redraw();
      msg(r ? 'All synced ✓' : 'Could not reach the sync service — it will retry automatically.', !r);
    });
    on('sync-copy', async () => {
      try { await navigator.clipboard.writeText(MQ.Sync.pretty(MQ.Sync.code)); msg('Code copied.'); } catch (e) { msg('Select and copy the code above.'); }
    });
    on('sync-stop', () => {
      if (!confirm('Stop syncing on this device? Progress stays here, but it will no longer update from the other device.')) return;
      MQ.Sync.stop();
      redraw();
    });
  }

  function renderGrownups() {
    $('gp-body').innerHTML = `
      <div class="gp-grid">
        <div class="gp-card">
          <h3>Player & settings</h3>
          <label>Name <input type="text" id="gp-name" maxlength="20" value="${MQ.escapeHtml(data.player.name || '')}"></label>
          <label><input type="checkbox" id="gp-sound" ${data.settings.sound ? 'checked' : ''}> Sound effects</label>
          <label><input type="checkbox" id="gp-music" ${data.settings.music !== false ? 'checked' : ''}> Background music (Bach, Mozart, Pachelbel, Beethoven)</label>
          <label><input type="checkbox" id="gp-voice" ${data.settings.voice ? 'checked' : ''}> Read questions aloud</label>
          <label><input type="checkbox" id="gp-chinese" ${data.settings.chinese ? 'checked' : ''}> Show numbers in Chinese too (四十七分, 三点半)</label>
          <p class="muted">Total play time: ${minutes(data.playSeconds)} · Stars: ${data.stars}</p>
          ${MQ.isTouch && !MQ.isStandalone ? `<div class="install-tip">📱 <b>Make it an app:</b> in Safari tap the Share button (the square with an arrow ⬆), then <b>Add to Home Screen</b>. It opens full-screen and works offline.</div>` : ''}
          <p class="muted">Each game adapts on its own: it moves up after a great round and down after two hard ones. Use −/+ if a game feels too easy or too hard.</p>
        </div>
        <div class="gp-card sync-card" id="gp-sync">${syncCard()}</div>
        <div class="gp-card">
          <h3>🔊 Read-aloud voice</h3>
          <p>This device is using: <b>${MQ.escapeHtml(MQ.Voice.describe('en-US'))}</b> (English) · <b>${MQ.escapeHtml(MQ.Voice.describe('zh-CN'))}</b> (Chinese)</p>
          <div class="row" style="justify-content:flex-start"><button class="btn secondary small" id="gp-voice-test">▶ Test voice</button></div>
          <p class="muted">For a much more natural voice, download a free <b>Premium</b> voice once on each device — the games pick it automatically:<br>
          <b>iPhone:</b> Settings → Accessibility → Spoken Content → Voices → English → <b>Ava (Premium)</b> or <b>Zoe (Premium)</b>; and Chinese (China mainland) → <b>Lili (Premium)</b>.<br>
          <b>Mac:</b> System Settings → Accessibility → Spoken Content → System voice → Manage Voices… → the same voices.</p>
        </div>
        <div class="gp-card">
          <h3>Save & backup</h3>
          <p class="muted">Progress saves automatically. With sync on, the laptop and iPhone share it; a backup file is an extra safety copy.</p>
          <div class="row" style="justify-content:flex-start">
            <button class="btn secondary small" id="gp-export">⬇ Download backup</button>
            <label class="btn secondary small" style="margin:0">⬆ Restore backup <input type="file" id="gp-import" accept="application/json,.json" hidden></label>
            <button class="btn secondary small" id="gp-reset">Start over…</button>
          </div>
        </div>
        ${GAMES.map(gameCard).join('')}
      </div>`;

    const setting = (id, key) => $(id).addEventListener('change', (e) => {
      data.settings[key] = e.target.checked;
      MQ.applySettings(data.settings);
      MQ.save(data);
    });
    setting('gp-sound', 'sound');
    setting('gp-music', 'music');
    setting('gp-voice', 'voice');
    setting('gp-chinese', 'chinese');
    $('gp-voice-test').addEventListener('click', () => {
      MQ.Voice.say(`Hi ${data.player.name || 'there'}! Let's collect exactly forty-seven cents.`, 'en-US', { interrupt: true });
      MQ.Voice.say('太棒了！四十七分。', 'zh-CN');
    });
    wireSync();
    $('gp-name').addEventListener('input', (e) => { data.player.name = e.target.value.trim(); MQ.save(data); render(); });

    $('gp-body').querySelectorAll('[data-level]').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.dataset.level;
      const g = (data.games[id] = data.games[id] || { level: 1, maxLevel: 1, played: 0, history: [] });
      g.level = Math.max(1, Math.min(30, (g.level || 1) + Number(btn.dataset.delta)));
      g.maxLevel = Math.max(g.maxLevel || 1, g.level);
      g.struggles = 0;
      g.goodStreak = 0;
      MQ.save(data);
      $(`gp-level-${id}`).textContent = g.level;
      render();
    }));

    $('gp-export').addEventListener('click', () => MQ.exportFile(data));
    $('gp-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        MQ.importText(await file.text());
        data = MQ.load();
        MQ.applySettings(data.settings);
        render();
        renderGrownups();
        alert('Progress restored!');
      } catch (err) {
        alert(err.message || 'Could not read that file.');
      }
    });
    $('gp-reset').addEventListener('click', () => {
      if (!confirm('Erase all progress, stars and heroes? (Tip: download a backup first.)')) return;
      MQ.reset();
      data = MQ.load();
      render();
      renderGrownups();
    });
  }

  $('gear-btn').addEventListener('click', () => { renderGrownups(); $('grownups').showModal(); });
  $('grownups-btn').addEventListener('click', () => {
    renderGrownups();
    $('grownups').showModal();
  });
  $('gp-close').addEventListener('click', () => $('grownups').close());
  $('grownups').addEventListener('close', () => { data = MQ.load(); render(); focusFirst(); });

  // When newer progress arrives from the other device, refresh what's on screen.
  MQ.Sync.onChange((info) => {
    if (!info.changed) return;
    data = MQ.load();
    MQ.applySettings(data.settings);
    render();
    const when = $('sync-when');
    if (when) when.textContent = 'just now';
  });

  MQ.Music.play('twinkle');
  render();
  if (!data.player.name) askName();
  else focusFirst();
})();
