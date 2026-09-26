/* Coin Crossing in 3D (Crossy Road style), drawn with three.js from the game's own state.
   game.js keeps all the rules; every frame it hands this module a read-only "view" of the board:
     { cols, rows, lanes, coins, player, hopTime, gateLift, heroId, target, state, time, layout }
   and this module draws it. It never changes game state. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODELS = new URL('../../shared/models/', import.meta.url).href;
const CAR_MODELS = ['sedan', 'taxi', 'police', 'van', 'suv', 'hatchback-sports', 'sedan-sports', 'ambulance', 'delivery'];
const BUS_MODELS = ['truck', 'firetruck', 'garbage-truck'];
const DECOR = ['tree_default', 'tree_oak', 'tree_fat', 'tree_pineRoundA', 'tree_blocks', 'tree_simple', 'plant_bush', 'rock_smallA', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'mushroom_red', 'stump_round'];
const COIN_LOOK = {
  1: { face: '#c9824a', rim: '#8a4f1f', text: '#2a1200' },
  5: { face: '#d5d9de', rim: '#8a9098', text: '#15181c' },
  10: { face: '#e6e9ec', rim: '#98a0a8', text: '#15181c' },
  25: { face: '#d0d5da', rim: '#7b8188', text: '#15181c' },
};
const COIN_R = { 1: 0.4, 5: 0.42, 10: 0.39, 25: 0.45 };

const loader = new GLTFLoader();
const gltfCache = new Map();
function loadGLB(path) {
  if (!gltfCache.has(path)) gltfCache.set(path, loader.loadAsync(MODELS + path).catch(() => null));
  return gltfCache.get(path);
}
// Scale a model so its longest ground dimension is `len` cells, feet on y=0, centred.
function fit(obj, len, axis = 'x') {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = len / (axis === 'x' ? size.x : Math.max(size.x, size.z));
  obj.scale.setScalar(s);
  const b2 = new THREE.Box3().setFromObject(obj);
  const c = b2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b2.min.y;
  const g = new THREE.Group(); g.add(obj);
  return g;
}
function shadows(obj) { obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return obj; }

function label(text, { w = 256, h = 256, bg = null, color = '#15181c', font = 900, size = 120, stroke = 'rgba(255,255,255,.95)' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.font = `${font} ${size}px "Baloo 2", "Arial Rounded MT Bold", system-ui, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round'; x.lineWidth = size * 0.16; x.strokeStyle = stroke; x.strokeText(text, w / 2, h / 2 + size * 0.04);
  x.fillStyle = color; x.fillText(text, w / 2, h / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function create(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'world3d';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9ed8ff');
  scene.fog = new THREE.Fog('#9ed8ff', 26, 60);
  scene.add(new THREE.HemisphereLight('#ffffff', '#6f8a5a', 1.35));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);

  const world = new THREE.Group(); scene.add(world);
  const boardGroup = new THREE.Group(); world.add(boardGroup);
  const carGroup = new THREE.Group(); world.add(carGroup);
  const coinGroup = new THREE.Group(); world.add(coinGroup);
  const fxGroup = new THREE.Group(); world.add(fxGroup);

  let built = null; // signature of the board we built (cols, rows, road rows)
  let dims = { cols: 13, rows: 10 };
  const X = (c) => c + 0.5 - dims.cols / 2; // column -> x
  const Z = (r) => r - (dims.rows - 1); // row -> z (start row at 0, castle row far away)

  // ---------- Board ----------
  const mats = {
    grassA: new THREE.MeshLambertMaterial({ color: '#8fd35c' }),
    grassB: new THREE.MeshLambertMaterial({ color: '#86ca53' }),
    grassSide: new THREE.MeshLambertMaterial({ color: '#6aa63e' }),
    road: new THREE.MeshLambertMaterial({ color: '#555d69' }),
    stripe: new THREE.MeshLambertMaterial({ color: '#f1f3f5' }),
    curb: new THREE.MeshLambertMaterial({ color: '#c9ccd1' }),
    stone: new THREE.MeshLambertMaterial({ color: '#d9cdb8' }),
    stoneB: new THREE.MeshLambertMaterial({ color: '#cfc2ab' }),
    start: new THREE.MeshLambertMaterial({ color: '#a6e07a' }),
    edge: new THREE.MeshLambertMaterial({ color: '#79b84a' }),
    edgeB: new THREE.MeshLambertMaterial({ color: '#72ae45' }),
  };
  const tile = new THREE.BoxGeometry(1, 0.3, 1);

  async function buildBoard(v) {
    boardGroup.clear();
    const roadRows = new Set(v.lanes.map((l) => l.row));
    const pad = 4; // decorated columns beyond the board on each side (fills wide screens)
    for (let r = 0; r < v.rows; r++) {
      for (let c = -pad; c < v.cols + pad; c++) {
        const inside = c >= 0 && c < v.cols;
        let m;
        if (r === 0) m = (c + r) % 2 ? mats.stone : mats.stoneB;
        else if (roadRows.has(r)) m = mats.road;
        else if (r === v.rows - 1) m = inside ? mats.start : mats.edge;
        else m = inside ? ((c + r) % 2 ? mats.grassA : mats.grassB) : ((c + r) % 2 ? mats.edge : mats.edgeB);
        const t = new THREE.Mesh(tile, m);
        t.position.set(X(c), roadRows.has(r) ? -0.19 : -0.15, Z(r));
        t.receiveShadow = true;
        boardGroup.add(t);
      }
      if (roadRows.has(r)) {
        // dashed centre line and curbs
        for (let c = -pad; c < v.cols + pad; c += 1) {
          const s = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.07), mats.stripe);
          s.position.set(X(c), -0.03, Z(r)); boardGroup.add(s);
        }
        for (const dz of [-0.5, 0.5]) {
          if (roadRows.has(r + (dz > 0 ? 1 : -1))) continue;
          const k = new THREE.Mesh(new THREE.BoxGeometry(v.cols + pad * 2, 0.06, 0.08), mats.curb);
          k.position.set(0, -0.02, Z(r) + dz); boardGroup.add(k);
        }
      }
    }
    // Rows beyond the start (towards the camera) so the board never ends in the air.
    for (let r = v.rows; r < v.rows + 3; r++) for (let c = -pad; c < v.cols + pad; c++) {
      const t = new THREE.Mesh(tile, (c + r) % 2 ? mats.edge : mats.edgeB); t.position.set(X(c), -0.15, Z(r)); t.receiveShadow = true; boardGroup.add(t);
    }
    await buildCastle(v, pad);
    // Decorations on the side columns only (never on a playable cell), deterministic per board.
    let seed = v.cols * 31 + v.rows * 7 + [...roadRows].reduce((s, r) => s * 3 + r, 1);
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let r = 1; r < v.rows + 2; r++) {
      if (roadRows.has(r)) continue;
      for (const side of [-1, 1]) for (let k = 0; k < pad; k++) {
        if (rnd() < 0.25) continue;
        const c = side < 0 ? -1 - k : v.cols + k;
        const name = DECOR[Math.floor(rnd() * DECOR.length)];
        const g = await loadGLB(`nature/${name}.glb`);
        if (!g) continue;
        const o = shadows(g.scene.clone());
        const big = name.startsWith('tree');
        const d = fit(o, big ? 0.9 + rnd() * 0.3 : 0.5 + rnd() * 0.2, 'xz');
        d.position.set(X(c) + (rnd() - 0.5) * 0.3, 0, Z(r) + (rnd() - 0.5) * 0.3);
        d.rotation.y = rnd() * Math.PI * 2;
        boardGroup.add(d);
      }
    }
  }

  let gate = null;
  async function buildCastle(v, pad) {
    const zWall = Z(0) - 0.9;
    const [wall, tower, towerTop, gateM, flag] = await Promise.all(['castle/wall.glb', 'castle/tower-square.glb', 'castle/tower-square-top-roof.glb', 'castle/metal-gate.glb', 'castle/flag.glb'].map(loadGLB));
    const width = v.cols + pad * 2;
    if (wall) for (let c = -pad; c < v.cols + pad; c++) {
      if (c === Math.floor(v.cols / 2)) continue; // the gate goes here
      const w = shadows(wall.scene.clone()); const g = fit(w, 1, 'x'); g.position.set(X(c), 0, zWall); boardGroup.add(g);
    }
    const towerAt = (c) => {
      if (!tower) return;
      const t = shadows(tower.scene.clone()); const g = fit(t, 1.3, 'xz'); g.position.set(X(c), 0, zWall); g.scale.y *= 1.6; boardGroup.add(g);
      if (towerTop) { const tt = shadows(towerTop.scene.clone()); const g2 = fit(tt, 1.45, 'xz'); const h = new THREE.Box3().setFromObject(g).max.y; g2.position.set(X(c), h, zWall); boardGroup.add(g2); }
      if (flag) { const f = shadows(flag.scene.clone()); const g3 = fit(f, 0.6, 'xz'); const h = new THREE.Box3().setFromObject(g).max.y; g3.position.set(X(c), h + 0.9, zWall); boardGroup.add(g3); }
    };
    const mid = Math.floor(v.cols / 2);
    towerAt(mid - 1.5); towerAt(mid + 1.5); towerAt(-pad + 0.5); towerAt(v.cols + pad - 1.5);
    // The gate: a portcullis that rises when the castle accepts him.
    gate = new THREE.Group();
    const bars = new THREE.MeshLambertMaterial({ color: '#4a4f57' });
    for (let i = -2; i <= 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), bars); b.position.set(i * 0.18, 0.55, 0); gate.add(b); }
    for (const y of [0.3, 0.7]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.06), bars); b.position.set(0, y, 0); gate.add(b); }
    shadows(gate);
    gate.position.set(X(mid), 0, zWall + 0.15);
    boardGroup.add(gate);
    const arch = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.28, 0.5), new THREE.MeshLambertMaterial({ color: '#b9ad99' }));
    arch.position.set(X(mid), 1.28, zWall); arch.castShadow = true; boardGroup.add(arch);
    // Sign on the wall with the target: big and readable.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.8), new THREE.MeshBasicMaterial({ map: label(v.targetText || '', { w: 512, h: 186, bg: '#fff8e6', color: '#b8420f', size: 118, stroke: '#fff8e6' }) }));
    sign.position.set(X(mid) - 2.6, 1.05, zWall + 0.62); sign.rotation.x = -0.35; boardGroup.add(sign);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), new THREE.MeshLambertMaterial({ color: '#8a5a2b' }));
    post.position.set(X(mid) - 2.6, 0.35, zWall + 0.62); post.castShadow = true; boardGroup.add(post);
    signTex = sign;
  }
  let signTex = null;

  // ---------- Cars ----------
  const carObjs = new Map(); // car object -> three group
  async function carModel(car, lane) {
    const list = car.len > 1 ? BUS_MODELS : CAR_MODELS;
    const name = list[Math.abs(Math.round(car.seed || (car.x * 997))) % list.length];
    const g = await loadGLB(`cars/${name}.glb`);
    const holder = new THREE.Group();
    if (g) {
      const o = shadows(g.scene.clone());
      // Kenney cars face +z; turn them to drive along x.
      const inner = new THREE.Group(); inner.add(o); inner.rotation.y = lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      const f = fit(inner, car.len * 0.92, 'x');
      holder.add(f);
    }
    return holder;
  }
  function syncCars(v) {
    const seen = new Set();
    for (const lane of v.lanes) for (const car of lane.cars) {
      seen.add(car);
      let o = carObjs.get(car);
      if (!o) {
        car.seed = car.seed || Math.floor(Math.random() * 1000);
        o = new THREE.Group(); carObjs.set(car, o); carGroup.add(o);
        carModel(car, lane).then((m) => o.add(m));
      }
      o.position.set(X(car.x) - 0.5 + car.len / 2, 0, Z(lane.row));
      o.position.y = Math.abs(Math.sin(v.time * 9 + car.seed)) * 0.02; // a little engine bounce
    }
    for (const [car, o] of carObjs) if (!seen.has(car)) { carGroup.remove(o); carObjs.delete(car); }
  }

  // ---------- Coins ----------
  const coinObjs = new Map();
  function coinMesh(value) {
    const g = new THREE.Group();
    if (value >= 100) {
      const tex = label(value >= 500 ? '$5' : '$1', { w: 256, h: 128, bg: value >= 500 ? '#c9c3e8' : '#a8d8a0', color: value >= 500 ? '#2f2766' : '#1f4d1f', size: 96, stroke: 'rgba(255,255,255,.7)' });
      const bill = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.43, 0.03), [
        new THREE.MeshLambertMaterial({ color: '#7fb877' }), new THREE.MeshLambertMaterial({ color: '#7fb877' }),
        new THREE.MeshLambertMaterial({ color: '#7fb877' }), new THREE.MeshLambertMaterial({ color: '#7fb877' }),
        new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshBasicMaterial({ map: tex })]);
      bill.position.y = 0.45; bill.castShadow = true; g.add(bill);
      g.userData.spinner = bill;
      return g;
    }
    const look = COIN_LOOK[value] || COIN_LOOK[1];
    const r = COIN_R[value] || 0.38;
    const tex = label(`${value}¢`, { w: 256, h: 256, bg: look.face, color: look.text, size: value >= 10 ? 104 : 118, stroke: 'rgba(255,255,255,.55)' });
    tex.center.set(0.5, 0.5); tex.rotation = -Math.PI / 2; // the cylinder cap's texture runs sideways
    const face = new THREE.MeshBasicMaterial({ map: tex });
    const rim = new THREE.MeshLambertMaterial({ color: look.rim });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.09, 40), [rim, face, face]);
    disc.rotation.x = Math.PI / 2; // stand the coin up; the holder then leans it back towards the camera
    disc.rotation.y = Math.PI; // the face with the number looks towards +z (the camera side)
    const holder = new THREE.Group(); holder.add(disc); holder.position.y = r + 0.1;
    holder.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(holder); g.userData.spinner = holder;
    return g;
  }
  function syncCoins(v) {
    const seen = new Set();
    for (const coin of v.coins) {
      seen.add(coin);
      let o = coinObjs.get(coin);
      if (!o) { o = coinMesh(coin.v); coinObjs.set(coin, o); coinGroup.add(o); o.userData.was = coin.taken; }
      if (coin.taken && !o.userData.was) pop(o.position.clone(), coin.v >= 100 ? '#8fd18a' : (COIN_LOOK[coin.v] || COIN_LOOK[1]).face);
      o.userData.was = coin.taken;
      o.visible = !coin.taken;
      o.position.set(X(coin.c), 0, Z(coin.r));
      const s = o.userData.spinner;
      if (s) { s.rotation.y = Math.sin(v.time * 1.6 + (coin.bob || 0)) * 0.22; s.rotation.x = -lean; }
      o.position.y = Math.sin(v.time * 2.2 + (coin.bob || 0)) * 0.05 + 0.03;
    }
    for (const [coin, o] of coinObjs) if (!seen.has(coin)) { coinGroup.remove(o); coinObjs.delete(coin); }
  }

  // ---------- Effects: block bursts ----------
  const bits = [];
  const bitGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  function pop(pos, color, n = 14) {
    const m = new THREE.MeshLambertMaterial({ color });
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(bitGeo, m);
      b.position.copy(pos); b.position.y += 0.4;
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 2;
      b.userData = { v: new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 2.5, Math.sin(a) * s), life: 0.9 + Math.random() * 0.4, age: 0, spin: Math.random() * 10 };
      fxGroup.add(b); bits.push(b);
    }
  }
  function stepBits(dt) {
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i], u = b.userData;
      u.age += dt; u.v.y -= 12 * dt; b.position.addScaledVector(u.v, dt);
      b.rotation.x += u.spin * dt; b.rotation.z += u.spin * dt;
      if (b.position.y < 0.06) { b.position.y = 0.06; u.v.y *= -0.35; u.v.x *= 0.7; u.v.z *= 0.7; }
      const k = Math.max(0, 1 - Math.max(0, u.age - u.life * 0.6) / (u.life * 0.4));
      b.scale.setScalar(k);
      if (u.age >= u.life) { fxGroup.remove(b); bits.splice(i, 1); }
    }
  }

  // ---------- Hero ----------
  let heroId = null, heroRoot = new THREE.Group(), heroModel = null, mixer = null, actions = {}, curAction = null, facing = Math.PI;
  world.add(heroRoot);
  const heroShadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.18 }));
  heroShadow.rotation.x = -Math.PI / 2; heroShadow.position.y = 0.01; world.add(heroShadow);
  async function loadHero(id) {
    heroId = id;
    const g = await loadGLB(`pets/animal-${id}.glb`);
    if (!g || heroId !== id) return;
    if (heroModel) heroRoot.remove(heroModel);
    const o = shadows(g.scene); // one hero at a time: use the scene itself so the mixer drives it
    heroModel = fit(o, 0.78, 'xz');
    heroRoot.add(heroModel);
    mixer = new THREE.AnimationMixer(o);
    actions = {};
    for (const clip of g.animations) actions[clip.name] = mixer.clipAction(clip);
    play('idle');
  }
  function play(name) {
    const a = actions[name];
    if (!a || curAction === a) return;
    a.reset().fadeIn(0.15).play();
    if (curAction) curAction.fadeOut(0.15);
    curAction = a;
  }
  let lastInv = 0, oopsT = 0, happyT = 0, stillT = 0;
  function syncHero(v, dt) {
    if (v.heroId !== heroId) loadHero(v.heroId);
    const p = v.player;
    const t = Math.min(1, p.t);
    const e = 1 - Math.pow(1 - t, 3);
    const x = X(p.fromC + (p.c - p.fromC) * e), z = Z(p.fromR + (p.r - p.fromR) * e);
    const hop = Math.sin(Math.PI * t) * 0.45;
    heroRoot.position.set(x, hop, z);
    // Face the way he's hopping.
    if (t < 1 && (p.c !== p.fromC || p.r !== p.fromR)) { facing = Math.atan2(p.c - p.fromC, p.r - p.fromR); stillT = 0; }
    stillT += dt;
    if (stillT > 0.9) facing = 0.25; // standing still: turn to face the camera (and him)
    heroRoot.rotation.y += ((facing - heroRoot.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 18);
    // Squash and stretch.
    let sx = 1, sy = 1;
    if (t < 1) { sx = 0.9; sy = 1.14; } else if (p.land > 0) { const q = p.land / 0.16; sx = 1 + 0.18 * q; sy = 1 - 0.18 * q; }
    heroRoot.scale.set(sx, sy, sx);
    heroShadow.position.set(x, 0.01, z); heroShadow.scale.setScalar(1 - hop * 0.6);
    // Got hit: 'oops' for a moment, blinking while he can't be hit again.
    if (p.inv > lastInv + 0.5) oopsT = 1.1;
    lastInv = p.inv;
    oopsT = Math.max(0, oopsT - dt); happyT = Math.max(0, happyT - dt);
    heroRoot.visible = !(p.inv > 0 && oopsT <= 0 && Math.floor(p.inv * 10) % 2 === 0);
    if (v.state === 'won' || v.state === 'result' || happyT > 0) play('dance');
    else if (oopsT > 0) play('gesture-negative');
    else if (t < 1) play('walk');
    else play('idle');
    if (mixer) mixer.update(dt);
  }

  // ---------- Camera ----------
  let camFocus = new THREE.Vector3();
  let lean = 0.6; // how far coins and signs lean back so their faces point at the camera
  function frameCamera(v, w, h) {
    const aspect = w / h;
    camera.aspect = aspect;
    const portrait = aspect < 0.9;
    camera.fov = portrait ? 44 : 30;
    const tilt = portrait ? 1.24 : 0.95; // radians below the horizon
    const side = portrait ? 0 : 0.14; // a little from the side, like Crossy Road
    lean = tilt * 0.8; // coins and signs lean back so their faces point at the camera
    camera.updateProjectionMatrix();
    // Points that must be on screen: the board's corners and the tops of the castle towers.
    const pts = [];
    const x0 = X(0) - 0.5, x1 = X(v.cols - 1) + 0.5, zNear = Z(v.rows - 1) + 0.6, zFar = Z(0) - 0.9;
    for (const x of [x0, x1]) { pts.push(new THREE.Vector3(x, 0, zNear), new THREE.Vector3(x, 0, zFar), new THREE.Vector3(x * 0.4, 3.6, zFar)); }
    const dir = new THREE.Vector3(Math.sin(side) * Math.cos(tilt), Math.sin(tilt), Math.cos(side) * Math.cos(tilt));
    const target = new THREE.Vector3(0, 0, (zNear + zFar) / 2);
    let dist = 20;
    for (let i = 0; i < 30; i++) {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      let minX = 1, maxX = -1, minY = 1, maxY = -1;
      for (const p of pts) { const q = p.clone().project(camera); minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
      const ext = Math.max((maxX - minX) / 2, (maxY - minY) / 2) / 0.96;
      dist *= 0.5 + 0.5 * ext; // move closer or further until the board just fits
      // re-centre: shift the target by the screen offset of the board's middle
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * dist;
      target.addScaledVector(right, cx * halfH * aspect * 0.8).addScaledVector(up, cy * halfH * 0.8);
      target.y = 0;
    }
    camFocus.copy(target);
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    sun.position.set(camFocus.x - 6, 14, camFocus.z + 6);
    sun.target.position.copy(camFocus);
    const S = Math.max(v.cols, v.rows) * 0.75 + 4;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 50 });
    sun.shadow.camera.updateProjectionMatrix();
  }

  // ---------- Public ----------
  let size = { w: 0, h: 0 }, framedFor = '';
  const api = {
    canvas: renderer.domElement,
    resize(w, h) {
      size = { w, h };
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px';
      renderer.domElement.style.height = h + 'px';
      framedFor = '';
    },
    cheer() { happyT = 1.6; },
    // Screen position (CSS px, relative to the canvas) of a board cell, for DOM effects.
    cellToScreen(r, c) {
      const p = new THREE.Vector3(X(c), 0.4, Z(r)).project(camera);
      return { x: (p.x + 1) / 2 * size.w, y: (1 - p.y) / 2 * size.h };
    },
    render(v, dt) {
      dims = { cols: v.cols, rows: v.rows };
      const sig = `${v.cols}x${v.rows}:${v.lanes.map((l) => l.row).join(',')}:${v.targetText}`;
      if (sig !== built) {
        built = sig;
        carObjs.clear(); carGroup.clear(); coinObjs.clear(); coinGroup.clear();
        buildBoard(v);
        framedFor = '';
      }
      const fk = `${sig}:${size.w}x${size.h}`;
      if (fk !== framedFor && size.w) { frameCamera(v, size.w, size.h); framedFor = fk; }
      syncCars(v); syncCoins(v); syncHero(v, dt); stepBits(dt);
      if (gate) gate.position.y = Math.max(0, Math.min(1, v.gateLift || 0)) * 1.05;
      renderer.render(scene, camera);
    },
    dispose() { renderer.dispose(); renderer.domElement.remove(); },
  };
  return api;
}

// Does this device run WebGL well enough?
export function supported() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}
