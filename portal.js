/* Math Quest portal: pick a game, pick a hero, and a grown-ups corner for settings and progress. */
(function () {
  'use strict';

  let data = MQ.load();
  MQ.applySettings(data.settings);

  const GAMES = [
    {
      id: 'coinCrossing', icon: '🪙', name: 'Coin Crossing', href: 'games/coin-crossing/index.html',
      what: 'Hop across the roads and collect exactly the right amount of money.',
    },
    { id: 'clockTower', icon: '🕰️', name: 'Clock Tower', what: 'Set the clock hands before the bell rings.', soon: true },
    { id: 'numberFlow', icon: '🔗', name: 'Number Flow', what: 'Connect paths of numbers that add up — like Flow Free.', soon: true },
    { id: 'castleClimb', icon: '🏯', name: 'Castle Climb', what: 'Add and subtract to climb the tower.', soon: true },
  ];

  const $ = (id) => document.getElementById(id);

  function progressText(game) {
    if (game.soon) return 'Coming soon';
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
      <button class="tile nav ${g.soon ? 'soon' : 'play'}" data-game="${g.id}">
        <span class="icon">${g.icon}</span>
        <span class="name">${g.name}</span>
        <span class="what">${g.what}</span>
        <span class="progress">${progressText(g)}</span>
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
      if (game.soon) {
        MQ.Voice.say(`${game.name} is coming soon!`, 'en-US', { interrupt: true });
        tile.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 250 });
      } else {
        location.href = game.href;
      }
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
    const first = document.querySelector('.tile.play');
    if (first) first.focus();
  }

  // ---------- Grown-ups corner ----------
  const QUIZ_LABELS = {
    add: 'Adding', count: 'Counting coins', sub: 'Subtracting', change: 'Making change',
    c2d: 'Cents → dollars', d2c: 'Dollars → cents',
  };

  function minutes(sec) {
    const m = Math.round((sec || 0) / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  function renderGrownups() {
    const cc = data.games.coinCrossing || { level: 1, maxLevel: 1, played: 0, history: [], quiz: {} };
    const hist = (cc.history || []).slice(-10).reverse();
    const recent = (cc.history || []).slice(-10);
    const avgStars = recent.length ? (recent.reduce((s, h) => s + h.stars, 0) / recent.length).toFixed(1) : '—';
    const skills = Object.keys(QUIZ_LABELS).map((k) => {
      const s = (cc.quiz || {})[k];
      if (!s || !s.tries) return `<div class="skill"><span>${QUIZ_LABELS[k]}</span><div class="bar"><i style="width:0"></i></div><span class="muted">not yet</span></div>`;
      const pct = Math.round((100 * s.right) / s.tries);
      return `<div class="skill"><span>${QUIZ_LABELS[k]}</span><div class="bar"><i style="width:${pct}%"></i></div><span>${s.right}/${s.tries}</span></div>`;
    }).join('');

    $('gp-body').innerHTML = `
      <div class="gp-grid">
        <div class="gp-card">
          <h3>Player & settings</h3>
          <label>Name <input type="text" id="gp-name" maxlength="20" value="${MQ.escapeHtml(data.player.name || '')}"></label>
          <label><input type="checkbox" id="gp-sound" ${data.settings.sound ? 'checked' : ''}> Sound effects</label>
          <label><input type="checkbox" id="gp-voice" ${data.settings.voice ? 'checked' : ''}> Read questions aloud</label>
          <label><input type="checkbox" id="gp-chinese" ${data.settings.chinese ? 'checked' : ''}> Show amounts in Chinese too (四十七分)</label>
          <p class="muted">Total play time: ${minutes(data.playSeconds)} · Stars: ${data.stars}</p>
        </div>

        <div class="gp-card">
          <h3>🪙 Coin Crossing</h3>
          <div class="gp-level">Level
            <button class="btn secondary small" id="gp-down">−</button>
            <span id="gp-level">${cc.level}</span>
            <button class="btn secondary small" id="gp-up">+</button>
          </div>
          <p class="muted">The game moves up after a 3-star level (or two 2-star levels) and down after two 1-star levels. Use −/+ if it feels too easy or too hard.</p>
          <p>Levels played: <b>${cc.played || 0}</b> · Highest level: <b>${cc.maxLevel || 1}</b> · Avg stars (last 10): <b>${avgStars}</b></p>
          <p class="muted">Levels 1–2 pennies & nickels · 3–4 add dimes · 5–7 add quarters · 8–9 dollars ($1.35) · 10+ mixed cents/dollars (must convert) · 14+ $5 bills.</p>
        </div>

        <div class="gp-card">
          <h3>Bonus question skills</h3>
          ${skills}
          <p class="muted">Weaker skills are asked more often.</p>
        </div>

        <div class="gp-card">
          <h3>Recent levels</h3>
          ${hist.length ? `<table class="hist"><tr><th>Level</th><th>Goal</th><th>Stars</th><th>Too much</th><th>Bonks</th><th>Time</th></tr>
            ${hist.map((h) => `<tr><td>${h.level}</td><td>${MQ.dollars(h.target)}</td><td>${'⭐'.repeat(h.stars)}</td><td>${h.overshoots}</td><td>${h.bonks}</td><td>${h.seconds}s</td></tr>`).join('')}
          </table>` : '<p class="muted">No levels played yet.</p>'}
        </div>
      </div>

      <div class="gp-card" style="margin-top:18px">
        <h3>Save & backup</h3>
        <p class="muted">Progress saves automatically in this browser on this Mac. Use a backup file to move it to another browser or computer.</p>
        <div class="row" style="justify-content:flex-start">
          <button class="btn secondary small" id="gp-export">⬇ Download backup</button>
          <label class="btn secondary small" style="margin:0">⬆ Restore backup <input type="file" id="gp-import" accept="application/json,.json" hidden></label>
          <button class="btn secondary small" id="gp-reset">Start over…</button>
        </div>
      </div>`;

    const setting = (id, key) => $(id).addEventListener('change', (e) => {
      data.settings[key] = e.target.checked;
      MQ.applySettings(data.settings);
      MQ.save(data);
    });
    setting('gp-sound', 'sound');
    setting('gp-voice', 'voice');
    setting('gp-chinese', 'chinese');
    $('gp-name').addEventListener('input', (e) => { data.player.name = e.target.value.trim(); MQ.save(data); render(); });

    const setLevel = (delta) => {
      const g = (data.games.coinCrossing = data.games.coinCrossing || { level: 1, maxLevel: 1, played: 0, history: [], quiz: {} });
      g.level = Math.max(1, Math.min(30, (g.level || 1) + delta));
      g.maxLevel = Math.max(g.maxLevel || 1, g.level);
      g.struggles = 0;
      g.goodStreak = 0;
      MQ.save(data);
      $('gp-level').textContent = g.level;
      render();
    };
    $('gp-down').addEventListener('click', () => setLevel(-1));
    $('gp-up').addEventListener('click', () => setLevel(1));

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

  $('grownups-btn').addEventListener('click', () => {
    renderGrownups();
    $('grownups').showModal();
  });
  $('gp-close').addEventListener('click', () => $('grownups').close());
  $('grownups').addEventListener('close', () => { data = MQ.load(); render(); focusFirst(); });

  render();
  if (!data.player.name) askName();
  else focusFirst();
})();
