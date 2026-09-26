/* Math Quest — shared look and feel for every game (load after core.js):
   MQ.Art   block-animal hero sprites (Kenney "Cube Pets", rendered by tools/render-art)
   MQ.FX    smooth motion: easing, springs, block-piece bursts, stars that fly to the counter, shake
   MQ.Idle  key reminders that float up when a keyboard player hasn't pressed anything for a while */
(function () {
  'use strict';
  const MQ = window.MQ;
  const here = (document.currentScript && document.currentScript.src) || location.href;
  const ART = new URL('art/heroes/', here).href;

  // ---------------- Hero sprites ----------------
  // Strips are laid out left to right, one square frame each (see tools/render-art/render.js).
  const STRIPS = { idle: { frames: 8, fps: 8 }, happy: { frames: 8, fps: 16 }, oops: { frames: 6, fps: 24 }, walk: { frames: 6, fps: 12 } };
  const cache = new Map();
  function image(src) {
    if (cache.has(src)) return cache.get(src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    cache.set(src, img);
    return img;
  }
  const ready = (img) => img && img.complete && img.naturalWidth > 0;

  const Art = {
    heroId: (v) => MQ.heroId(v),
    src(id, pose) { return ART + MQ.heroId(id) + (pose ? '-' + pose : '') + '.webp'; },
    // Start downloading everything one hero needs, so the first hop is already drawn with it.
    preload(id) {
      image(this.src(id));
      for (const k of Object.keys(STRIPS)) image(this.src(id, k));
    },
    // <img> for cards and menus.
    img(id, size = 48, cls = '') {
      const h = MQ.heroInfo(id);
      return `<img class="hero-img ${cls}" src="${this.src(h.id)}" width="${size}" height="${size}" alt="${MQ.escapeHtml(h.name)}" draggable="false">`;
    },
    /* Draw the hero standing with its feet at (x, y), `size` logical pixels tall.
       opts: pose ('idle' | 'happy' | 'oops' | 'walk' | null for the still), t (seconds, for the frame),
             sx / sy (squash and stretch), tilt (radians), shadow (true), alpha, flip (face left). */
    drawHero(ctx, id, x, y, size, opts = {}) {
      const { pose = 'idle', t = performance.now() / 1000, sx = 1, sy = 1, tilt = 0, shadow = true, alpha = 1, flip = false, lift = 0 } = opts;
      if (shadow) {
        const k = Math.max(0.35, 1 - lift / (size * 1.6));
        ctx.save();
        ctx.globalAlpha = 0.22 * alpha * k;
        ctx.fillStyle = '#1b2430';
        ctx.beginPath();
        ctx.ellipse(x, y - size * 0.03, size * 0.34 * k * sx, size * 0.085 * k, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      const strip = pose && STRIPS[pose] ? image(this.src(id, pose)) : null;
      const still = image(this.src(id));
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.translate(x, y - lift);
      ctx.rotate(tilt);
      ctx.scale(sx * (flip ? -1 : 1), sy);
      if (ready(strip)) {
        const s = STRIPS[pose];
        const f = Math.floor(t * s.fps) % s.frames;
        const fw = strip.naturalWidth / s.frames;
        ctx.drawImage(strip, f * fw, 0, fw, strip.naturalHeight, -size / 2, -size * 0.93, size, size);
      } else if (ready(still)) {
        ctx.drawImage(still, -size / 2, -size * 0.93, size, size);
      } else {
        // Sprites not loaded yet (or offline without a cached copy): the emoji keeps the game playable.
        ctx.font = `${Math.round(size * 0.7)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(MQ.heroInfo(id).emoji, 0, -size * 0.12);
      }
      ctx.restore();
    },
  };

  // ---------------- Motion ----------------
  const FX = {
    ease: {
      out: (t) => 1 - Math.pow(1 - t, 3),
      inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
      back: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
      elastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
    },
    lerp: (a, b, t) => a + (b - a) * t,
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    // A springy value: s = FX.spring(0); s.target = 1; each frame s.step(dt); read s.v.
    spring(v = 0, stiffness = 260, damping = 18) {
      return {
        v, vel: 0, target: v,
        step(dt) {
          const n = Math.max(1, Math.ceil(dt / 0.008));
          const h = dt / n;
          for (let i = 0; i < n; i++) {
            const a = stiffness * (this.target - this.v) - damping * this.vel;
            this.vel += a * h;
            this.v += this.vel * h;
          }
          return this.v;
        },
        kick(velocity) { this.vel += velocity; },
      };
    },
    // Squash and stretch for a hop that lasts `dur` seconds, at progress p (0..1).
    hopShape(p) {
      if (p <= 0 || p >= 1) return { sx: 1, sy: 1, lift: 0 };
      const lift = Math.sin(p * Math.PI);
      if (p < 0.12) { const k = p / 0.12; return { sx: 1 + 0.16 * (1 - k), sy: 1 - 0.16 * (1 - k), lift: lift }; }
      if (p > 0.86) { const k = (p - 0.86) / 0.14; const q = Math.sin(k * Math.PI); return { sx: 1 + 0.18 * q, sy: 1 - 0.18 * q, lift: lift }; }
      return { sx: 0.93, sy: 1.08, lift };
    },
    // Screen shake: shake.add(8); each frame const {x, y} = shake.offset(dt).
    shake() {
      let amt = 0;
      return {
        add(a) { amt = Math.min(24, amt + a); },
        offset(dt) {
          amt = Math.max(0, amt - dt * 60);
          if (!amt) return { x: 0, y: 0 };
          return { x: (Math.random() * 2 - 1) * amt, y: (Math.random() * 2 - 1) * amt * 0.6 };
        },
      };
    },
    // Little 3D blocks that burst out and fall, Minecraft style.
    blocks() {
      const list = [];
      const shade = (hex, f) => {
        const n = parseInt(hex.slice(1), 16);
        const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
        return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
      };
      return {
        burst(x, y, colors = ['#f6b93b', '#4cd137', '#48b0f7', '#ff7f50'], n = 16, power = 1) {
          for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
            const sp = (180 + Math.random() * 260) * power;
            list.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
              size: 7 + Math.random() * 9, life: 0.9 + Math.random() * 0.5, age: 0, color: colors[i % colors.length] });
          }
        },
        update(dt) {
          for (const p of list) { p.age += dt; p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.vx *= 0.99; }
          for (let i = list.length - 1; i >= 0; i--) if (list[i].age >= list[i].life) list.splice(i, 1);
        },
        draw(ctx) {
          for (const p of list) {
            const a = 1 - Math.max(0, (p.age - p.life * 0.6) / (p.life * 0.4));
            const s = p.size;
            ctx.save();
            ctx.globalAlpha = a;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color; ctx.fillRect(-s / 2, -s / 2, s, s);
            ctx.fillStyle = shade(p.color, 1.25); ctx.fillRect(-s / 2, -s / 2, s, s * 0.28);
            ctx.fillStyle = shade(p.color, 0.72); ctx.fillRect(s * 0.22, -s / 2, s * 0.28, s);
            ctx.restore();
          }
        },
        get count() { return list.length; },
      };
    },
    // A star that flies from a point on the page to an element (e.g. the star counter), then pops it.
    flyStar(fromX, fromY, toEl, { delay = 0, glyph = '⭐' } = {}) {
      if (!toEl || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const r = toEl.getBoundingClientRect();
      const s = document.createElement('div');
      s.className = 'mq-fly-star';
      s.textContent = glyph;
      s.style.left = fromX + 'px';
      s.style.top = fromY + 'px';
      document.body.appendChild(s);
      const dx = r.left + r.width / 2 - fromX, dy = r.top + r.height / 2 - fromY;
      const anim = s.animate([
        { transform: 'translate(-50%,-50%) scale(0.4)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 1, offset: 0.2 },
        { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 60}px)) scale(1.1)`, offset: 0.6 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.7)`, opacity: 1 },
      ], { duration: 800, delay, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
      anim.onfinish = () => {
        s.remove();
        toEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      };
    },
    // Pop a card or button in smoothly.
    popIn(el) {
      if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      el.animate([{ transform: 'scale(.86) translateY(14px)', opacity: 0 }, { transform: 'scale(1.02)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1)' });
    },
  };

  // ---------------- Key reminders ----------------
  /* MQ.Idle.attach(stageEl, { delay: 4000, keys: () => [['←','→'], 'move'], active: () => true })
     After `delay` ms with no key press while active() is true, the keys float up at the bottom of the
     stage with a short word, and an "esc 🏠" chip shows in the corner. Any key or tap hides them.
     Keyboard players only (touch devices never see it). */
  const Idle = {
    attach(stage, opts = {}) {
      const delay = opts.delay || 4000;
      const box = document.createElement('div');
      box.className = 'mq-idle keys-only';
      box.setAttribute('aria-hidden', 'true');
      box.innerHTML = '<div class="mq-idle-keys"></div><div class="mq-idle-esc"><span class="key">esc</span> 🏠</div>';
      stage.appendChild(box);
      const keysEl = box.querySelector('.mq-idle-keys');
      let last = performance.now();
      let shown = false;
      let sig = '';
      const hide = () => { last = performance.now(); if (shown) { shown = false; box.classList.remove('on'); } };
      window.addEventListener('keydown', hide, true);
      window.addEventListener('pointerdown', hide, true);
      function tick() {
        const active = !opts.active || opts.active();
        if (!active) { if (shown) { shown = false; box.classList.remove('on'); } last = performance.now(); }
        else if (!shown && performance.now() - last > delay) {
          const spec = (opts.keys && opts.keys()) || [];
          const groups = Array.isArray(spec[0]) ? [spec] : spec; // one [keys, word] pair or a list of them
          const html = groups.map(([keys, word]) => `<span class="mq-idle-group">${keys.map((k) => `<span class="key">${MQ.escapeHtml(k)}</span>`).join('')}${word ? `<span class="mq-idle-word">${MQ.escapeHtml(word)}</span>` : ''}</span>`).join('');
          if (html !== sig) { keysEl.innerHTML = html; sig = html; }
          shown = true;
          box.classList.add('on');
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      return { poke: hide, el: box };
    },
  };

  MQ.Art = Art;
  MQ.FX = FX;
  MQ.Idle = Idle;
})();
