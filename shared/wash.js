/* Math Quest — wash-to-reveal (load after core.js, fx.js and town-data.js).
   Each round hides the next piece for his town under mud. Every right answer sprays a patch clean
   (a small picture in the game's top bar). On the result card he power-washes the rest himself:
   mouse / finger to aim, or arrow keys; it sprays wherever he points. When it's clean the piece is
   his (pieces come from finished rounds, see MQ.TOWN.earnedFor). */
(function () {
  'use strict';
  const MQ = window.MQ;
  const here = (document.currentScript && document.currentScript.src) || location.href;
  const ART = new URL('art/town/', here).href;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Soft hiss for the water (filtered noise), and a sparkle when it's clean.
  let hiss = null;
  function startHiss() {
    const ctx = MQ.Audio && MQ.Audio.init && MQ.Audio.init();
    if (!ctx || hiss || !MQ.Sound.enabled) return;
    const len = ctx.sampleRate * 1;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(MQ.Audio.master || ctx.destination);
    src.start();
    hiss = { src, g, ctx };
  }
  function setHiss(on) {
    if (!hiss) { if (on) startHiss(); if (!hiss) return; }
    hiss.g.gain.setTargetAtTime(on ? 0.05 : 0, hiss.ctx.currentTime, 0.05);
  }
  function stopHiss() { if (hiss) { try { hiss.src.stop(); } catch (e) { /* ignore */ } hiss = null; } }

  // Mud: brown blobs drawn over the picture on a separate canvas; washing erases it.
  function paintMud(ctx, w, h, seed) {
    let s = seed || 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(0, 0, w, h);
    const shades = ['#5a3d22', '#7a5533', '#8a6440', '#4f351d', '#6f4d2e'];
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = shades[i % shades.length];
      ctx.globalAlpha = 0.5 + rnd() * 0.5;
      ctx.beginPath();
      ctx.ellipse(rnd() * w, rnd() * h, 6 + rnd() * w * 0.16, 5 + rnd() * h * 0.12, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // splatter dots
    for (let i = 0; i < 60; i++) { ctx.fillStyle = shades[(i * 3) % shades.length]; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 1 + rnd() * 4, 0, Math.PI * 2); ctx.fill(); }
  }
  function mudLeft(ctx, w, h) {
    const px = ctx.getImageData(0, 0, w, h).data;
    let n = 0, t = 0;
    for (let i = 3; i < px.length; i += 16) { t++; if (px[i] > 40) n++; }
    return n / t;
  }
  function wipe(ctx, x, y, r) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.6, 'rgba(0,0,0,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  const Wash = {
    // Which piece this round is washing (the next one in the town list).
    pieceFor(data) { return MQ.TOWN.next(data); },
    src(piece) { return ART + piece.id + '.webp'; },

    /* A small muddy picture for the top bar. badge.step() after each right answer.
       steps = how many right answers a round has (leaves ~25% of the mud for the finale). */
    badge(container, { data, steps = 8, size = 64 }) {
      const piece = this.pieceFor(data);
      const box = document.createElement('div');
      box.className = 'mq-wash-badge';
      box.title = 'Wash it clean!';
      box.innerHTML = `<img alt="" draggable="false" src="${this.src(piece)}"><canvas></canvas><span class="mq-wash-q">?</span>`;
      container.appendChild(box);
      const cv = box.querySelector('canvas');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = cv.height = Math.round(size * dpr);
      box.style.width = box.style.height = size + 'px';
      const ctx = cv.getContext('2d');
      paintMud(ctx, cv.width, cv.height, (MQ.TOWN.roundsDone(data) + 3) * 97);
      let done = 0;
      const spots = [];
      // Patches cover the whole picture (a jittered grid in a shuffled order), so by the end
      // of the round about three quarters is clean and the rest is his to wash.
      const N = Math.max(steps, Math.round(steps / 0.72)); // about 3 in 4 cells get washed
      const cols = Math.ceil(Math.sqrt(N)), rows = Math.ceil(N / cols);
      const cells = [];
      for (let yy = 0; yy < rows; yy++) for (let xx = 0; xx < cols; xx++) cells.push({ x: (xx + 0.3 + Math.random() * 0.4) / cols * cv.width, y: (yy + 0.3 + Math.random() * 0.4) / rows * cv.height });
      for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
      spots.push(...cells.slice(0, steps));
      const patch = Math.max(cv.width / cols, cv.height / rows) * 0.66;
      return {
        piece,
        el: box,
        step() {
          if (done >= steps) return;
          const sp = spots[done++];
          const r = patch * (0.95 + 0.15 * Math.random());
          if (reduce()) { wipe(ctx, sp.x, sp.y, r); return; }
          // a quick spray animation: several wipes along a short stroke
          const n = 8; let k = 0;
          const a = Math.random() * Math.PI;
          const tick = () => {
            const t = k / n;
            wipe(ctx, sp.x + Math.cos(a) * (t - 0.5) * r, sp.y + Math.sin(a) * (t - 0.5) * r, r * 0.85);
            if (++k <= n) requestAnimationFrame(tick);
          };
          tick();
          box.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
        },
        canvas: cv,
      };
    },

    /* The finale on the result card: a big muddy picture he washes himself.
       Returns a promise that resolves when it is clean (or he skips with return after it's mostly clean).
       opts.badge: the round's badge (so the finale starts from the same mud). */
    finale(host, { data, badge, size = 260, onClean } = {}) {
      const piece = badge ? badge.piece : this.pieceFor(data);
      const wrap = document.createElement('div');
      wrap.className = 'mq-wash';
      wrap.innerHTML = `<div class="mq-wash-pic" style="width:${size}px;height:${size}px"><img alt="${MQ.escapeHtml(piece.name)}" draggable="false" src="${this.src(piece)}"><canvas></canvas><div class="mq-wash-nozzle"></div></div>
        <div class="mq-wash-say"><b>Wash it!</b> <span class="keys-only"><span class="key">←</span><span class="key">→</span><span class="key">↑</span><span class="key">↓</span></span></div>`;
      host.appendChild(wrap);
      const pic = wrap.querySelector('.mq-wash-pic');
      const cv = wrap.querySelector('canvas');
      const nozzle = wrap.querySelector('.mq-wash-nozzle');
      const sayEl = wrap.querySelector('.mq-wash-say');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = cv.height = Math.round(size * dpr);
      const ctx = cv.getContext('2d');
      if (badge) ctx.drawImage(badge.canvas, 0, 0, cv.width, cv.height);
      else paintMud(ctx, cv.width, cv.height, 11);
      const drops = document.createElement('canvas');
      drops.className = 'mq-wash-drops';
      drops.width = drops.height = cv.width;
      pic.appendChild(drops);
      const dctx = drops.getContext('2d');
      const particles = [];
      let sprayTime = 0, aim = { x: cv.width * 0.5, y: cv.height * 0.5 }, spraying = false, lastMove = 0, cleanDone = false, keys = new Set();
      MQ.Voice.say(`Wash it clean! What's under the mud?`, 'en-US');

      const toLocal = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * cv.width, y: (e.clientY - r.top) / r.height * cv.height }; };
      const onMove = (e) => { aim = toLocal(e); spraying = true; lastMove = performance.now(); };
      pic.addEventListener('pointermove', onMove);
      pic.addEventListener('pointerdown', (e) => { onMove(e); try { pic.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
      const onKey = (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        if (e.type === 'keydown') keys.add(e.key); else keys.delete(e.key);
      };
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('keyup', onKey, true);

      let resolveFn;
      const done = new Promise((r) => { resolveFn = r; });
      let last = performance.now(), checkT = 0;
      function frame(now) {
        if (!wrap.isConnected) { cleanup(); return; }
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        // keyboard aiming: the nozzle sweeps while arrows are held
        if (keys.size) {
          const sp = cv.width * 0.9 * dt;
          if (keys.has('ArrowLeft')) aim.x -= sp; if (keys.has('ArrowRight')) aim.x += sp;
          if (keys.has('ArrowUp')) aim.y -= sp; if (keys.has('ArrowDown')) aim.y += sp;
          aim.x = Math.max(0, Math.min(cv.width, aim.x)); aim.y = Math.max(0, Math.min(cv.height, aim.y));
          spraying = true; lastMove = now;
        }
        if (now - lastMove > 250) spraying = false;
        nozzle.style.transform = `translate(${aim.x / dpr - 14}px, ${aim.y / dpr - 14}px)`;
        nozzle.classList.toggle('on', spraying);
        setHiss(spraying && !cleanDone);
        if (spraying && !cleanDone) {
          wipe(ctx, aim.x, aim.y, cv.width * 0.12);
          sprayTime += dt;
          for (let i = 0; i < 3; i++) particles.push({ x: aim.x, y: aim.y, vx: (Math.random() - 0.5) * 260 * dpr, vy: (-Math.random() * 220 - 40) * dpr, life: 0.5, age: 0, mud: Math.random() < 0.35 });
          checkT += dt;
          if (checkT > 0.25) {
            checkT = 0;
            const left = mudLeft(ctx, cv.width, cv.height);
            // Mostly clean, or he has washed for a while: a big final rinse does the rest.
            if (left < 0.14 || sprayTime > 12) finish();
          }
        }
        // water drops and flying mud
        dctx.clearRect(0, 0, drops.width, drops.height);
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i]; p.age += dt; p.vy += 900 * dpr * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          dctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
          dctx.fillStyle = p.mud ? '#6b4a2b' : '#bfe8ff';
          dctx.beginPath(); dctx.arc(p.x, p.y, (p.mud ? 3.5 : 2.5) * dpr, 0, Math.PI * 2); dctx.fill();
          if (p.age >= p.life) particles.splice(i, 1);
        }
        dctx.globalAlpha = 1;
        requestAnimationFrame(frame);
      }
      function finish() {
        if (cleanDone) return;
        cleanDone = true;
        setHiss(false);
        ctx.clearRect(0, 0, cv.width, cv.height);
        pic.classList.add('clean');
        sayEl.innerHTML = `<b>${MQ.escapeHtml(piece.name)}!</b> <span class="mq-wash-zh">${MQ.escapeHtml(piece.zh)}</span> 🏡`;
        MQ.Sound.star && MQ.Sound.star();
        MQ.Voice.say(`A ${piece.name.toLowerCase()} for your town!`, 'en-US', { interrupt: true });
        if (!reduce()) pic.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12) rotate(-2deg)' }, { transform: 'scale(1)' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
        if (onClean) onClean(piece);
        resolveFn(piece);
      }
      function cleanup() {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKey, true);
        stopHiss();
      }
      requestAnimationFrame(frame);
      return { piece, done, el: wrap, finish, cleanup, get clean() { return cleanDone; } };
    },
  };
  MQ.Wash = Wash;
})();
