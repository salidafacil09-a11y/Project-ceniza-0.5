(function (G) {
  'use strict';

  const DEBUG = location.search.indexOf('debug') !== -1;
  const LOW = G.Input.isTouch;            // móviles: sombras y resolución más bajas
  const NO_SHADOWS = location.search.indexOf('calidad=baja') !== -1;  // para móviles muy justos
  const FOG = 0xaeb7b8;

  let renderer, scene, camera, player, sun, hemi;
  let state = 'menu';                     // menu | playing | paused | dead
  let last = 0, fpsAcc = 0, fpsN = 0;
  let target = null;
  let aimed = null;          // zombi resaltado con el contorno amarillo
  let kills = 0, survived = 0, deadT = 0;
  const el = (id) => document.getElementById(id);

  function fatal(msg) {
    el('start-msg').textContent = msg;
    el('btn-start').disabled = true;
  }

  function init() {
    if (typeof THREE === 'undefined') { fatal('No se pudo cargar Three.js. Revisa tu conexión y recarga la página.'); return; }
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance' });
    } catch (e) { fatal('Tu navegador no admite WebGL, necesario para jugar.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, NO_SHADOWS ? 1 : (LOW ? 1.25 : 2)));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !NO_SHADOWS;
    renderer.shadowMap.type = LOW ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    el('game').appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(FOG).convertSRGBToLinear();
    scene.fog = new THREE.Fog(scene.background.getHex(), 16, 58);

    hemi = new THREE.HemisphereLight(0xd6e0e4, 0x4f4a3c, 0.62);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1dc, 1.25);
    sun.castShadow = true;
    const S = LOW ? 16 : 22;
    sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
    sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
    sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);
    scene.add(sun.target);

    camera = new THREE.PerspectiveCamera(62, 1, 0.05, 95);
    G.Camera.init(camera);

    G.Input.init(renderer.domElement);
    G.World.init(scene, newSeed());
    G.World.reset(currentSeed);
    G.Population.init(scene);
    player = new G.Player(scene);
    refreshWorld(true, 0);

    G.Combat.onMessage = toast;
    G.Combat.onHit = (res, crit) => {
      if (res === 'kill') kills++;
      const h = el('hitmark');
      h.className = 'on' + (crit ? ' crit' : '');
      clearTimeout(h._t);
      h._t = setTimeout(() => { h.className = ''; }, 140);
    };

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    resize();

    el('btn-start').addEventListener('click', start);
    el('btn-retry').addEventListener('click', retry);
    el('btn-resume').addEventListener('click', resume);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') {
        if (state === 'menu') start();
        else if (state === 'dead') retry();
        else if (state === 'paused') resume();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (!G.Input.isTouch && state === 'playing' && !G.Input.pointerLocked) pause();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });

    el('controls-pc').classList.toggle('hidden', G.Input.isTouch);
    el('controls-touch').classList.toggle('hidden', !G.Input.isTouch);
    if (DEBUG) el('debug').classList.remove('hidden');
    requestAnimationFrame(loop);
  }

  let currentSeed = 0;
  function newSeed() {
    const m = /[?&]seed=(-?\d+)/.exec(location.search);
    currentSeed = m ? parseInt(m[1], 10) : Math.floor(Math.random() * 1000000);
    return currentSeed;
  }

  function refreshWorld(immediate, dt) {
    G.World.update(player.pos.x, player.pos.z, immediate, dt);
    G.Population.update(player.pos.x, player.pos.z, dt);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < h ? 75 : 62;
    camera.updateProjectionMatrix();
  }

  function tryFullscreen() {
    if (!G.Input.isTouch) return;
    const d = document.documentElement;
    const req = d.requestFullscreen || d.webkitRequestFullscreen;
    try {
      if (req) { const p = req.call(d); if (p && p.catch) p.catch(() => {}); }
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    } catch (e) { /* no pasa nada */ }
  }

  function start() {
    if (state !== 'menu') return;
    tryFullscreen();
    el('start').classList.add('hidden');
    G.Input.enabled = true;
    G.Input.requestLock();
    state = 'playing';
    toast(G.Input.isTouch ? 'Busca un arma. Usa el botón Usar para cogerla.' : 'Busca un arma: acércate y pulsa E para cogerla.');
  }

  function pause() {
    state = 'paused';
    G.Input.enabled = false;
    el('paused').classList.remove('hidden');
  }

  function resume() {
    if (state !== 'paused') return;
    el('paused').classList.add('hidden');
    G.Input.enabled = true;
    G.Input.clear();
    G.Input.requestLock();
    state = 'playing';
  }

  function retry() {
    aimed = null;
    G.Population.reset();
    G.World.reset(newSeed());
    player.reset();
    G.Combat.dragT = 0;
    kills = 0; survived = 0; deadT = 0;
    G.Camera.yaw = Math.PI; G.Camera.pitch = 0.28;
    refreshWorld(true, 0);
    el('dead').classList.add('hidden');
    G.Input.enabled = true;
    G.Input.clear();
    G.Input.requestLock();
    state = 'playing';
  }

  // ---------- HUD ----------
  const NOISE_TEXT = ['Sigilo', 'Caminando', 'Corriendo: te oyen', 'Agachado'];
  let toastN = 0;
  function toast(text, kind) {
    const box = el('toasts');
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = text;
    box.appendChild(d);
    toastN++;
    setTimeout(() => { d.classList.add('out'); }, 2600);
    setTimeout(() => { d.remove(); }, 3100);
    while (box.children.length > 3) box.firstChild.remove();
  }

  function updateHud() {
    el('hp-fill').style.width = Math.max(0, player.health) + '%';
    el('hp-fill').classList.toggle('low', player.health < 35);
    el('st-fill').style.width = Math.round(player.stamina * 100) + '%';
    el('st-fill').classList.toggle('low', player.stamina < 0.25);
    const n = el('noise');
    n.textContent = NOISE_TEXT[player.noiseLevel];
    n.className = 'n' + player.noiseLevel;
    const st = [];
    if (player.bleed > 0) st.push('Sangrando');
    if (player.sick) st.push('Fiebre');
    if (player.stamina < 0.25) st.push('Agotado');
    el('status').textContent = st.join(' · ');
    el('damage').style.opacity = Math.min(1, player.hurt * 2.2);

    const w = player.weapon, slot = player.slot;
    el('w-name').textContent = w.name;
    el('w-cond').style.width = slot ? Math.round(slot.cond * 100) + '%' : '0%';
    el('w-condbar').classList.toggle('hidden', !slot);
    el('w-grip').textContent = slot ? (slot.two ? 'A dos manos' : 'A una mano') : '';
    const back = player.backSlot, pk = player.pockets;
    el('w-carry').textContent = (back ? 'Espalda: ' + G.Weapons.get(back.id).name : 'Espalda libre') + ' · Bolsillos: ' + pk;

    const p = el('prompt');
    if (target && state === 'playing') {
      p.innerHTML = '<b>' + (G.Input.isTouch ? 'Usar' : 'E') + '</b>' + target.label;
      p.classList.remove('hidden');
    } else p.classList.add('hidden');
    el('btn-use') && el('btn-use').classList.toggle('ready', !!target);
    el('crosshair').classList.toggle('aim', player.aiming);

    let chasing = 0;
    for (const z of G.Population.list) if (z.alive && (z.state === 'chase' || z.state === 'attack' || z.state === 'bang')) chasing++;
    el('chasers').textContent = chasing ? (chasing === 1 ? 'Te persigue 1 zombi' : 'Te persiguen ' + chasing + ' zombis') : '';
  }

  // ---------- Bucle ----------
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;

    if (state === 'playing') {
      survived += dt;
      G.Input.update(dt);
      if (G.Input.pause) { pause(); }
      const zombies = G.Population.list;
      const camYaw = Math.atan2(G.Camera.forward().x, G.Camera.forward().z);
      if (!player.dead) {
        G.Combat.handleInput(player, G.Input, zombies, camYaw);
        if (G.Input.cycle) { const m = player.cycleWeapon(); if (m) toast(m); }
        if (G.Input.grip) { const m = player.toggleGrip(); if (m) toast(m); }
        if (G.Input.drop) {
          const s = player.dropCurrent();
          if (s) { G.World.dropItem(player.pos.x + Math.sin(player.facing) * 0.5, player.pos.z + Math.cos(player.facing) * 0.5, s.id, s.cond); toast('Soltaste: ' + G.Weapons.get(s.id).name); }
        }
        target = G.Interact.find(player, G.Camera.forward());
        if (G.Input.use && target) { const m = G.Interact.use(target, player); if (m) toast(m); target = null; }
      } else target = null;
      player.update(dt, G.Input, G.Camera);
      // contorno amarillo: al apuntar (en móvil, cuando hay un zombi a tu alcance delante)
      let tgt = null;
      if (!player.dead && (player.aiming || G.Input.isTouch)) {
        tgt = G.Combat.pickTarget(player, zombies, camYaw, player.aiming ? 1.2 : 0.4);
      }
      if (tgt !== aimed) {
        if (aimed) G.Models.setOutline(aimed.model, false);
        if (tgt) G.Models.setOutline(tgt.model, true);
        aimed = tgt;
      }
      G.Combat.update(dt, player, zombies);
      for (let i = 0; i < zombies.length; i++) zombies[i].update(dt, player, zombies, G.Combat);
      refreshWorld(false, dt);
      if (player.dead) {
        deadT += dt;
        if (deadT > 2.2) die();
      }
    } else if (state === 'menu' || state === 'dead' || state === 'paused') {
      if (G.Input.padConfirm()) { if (state === 'menu') start(); else if (state === 'dead') retry(); else resume(); }
      if (state === 'menu') {
        // la cámara gira lentamente alrededor de la casa en el menú
        G.Camera.yaw += dt * 0.08;
      }
    }

    player.apply(dt);
    G.Camera.update(dt, player, state === 'playing' ? G.Input : { look: { x: 0, y: 0 } });
    player.model.root.visible = !G.Camera.near || player.dead;

    // el sol sigue al jugador (en pasos para que la sombra no tiemble)
    const sx = Math.round(player.pos.x), sz = Math.round(player.pos.z);
    sun.position.set(sx - 16, 32, sz + 11);
    sun.target.position.set(sx, 0, sz);

    updateHud();
    renderer.render(scene, camera);

    if (DEBUG && dt > 0) {
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 0.5) {
        const st = G.World.stats();
        el('debug').textContent = Math.round(fpsN / fpsAcc) + ' fps · ' + renderer.info.render.calls + ' draws · ' +
          Math.round(renderer.info.render.triangles / 1000) + 'k tris · ' + st.generated + ' chunks · ' +
          G.Population.alive() + ' zombis · semilla ' + st.seed;
        fpsAcc = 0; fpsN = 0;
      }
    }
  }

  function die() {
    state = 'dead';
    G.Input.enabled = false;
    if (document.exitPointerLock) document.exitPointerLock();
    const m = Math.floor(survived / 60), s = Math.floor(survived % 60);
    el('dead-cause').textContent = player.deathCause;
    el('dead-stats').textContent = 'Sobreviviste ' + m + ' min ' + s + ' s · Zombis eliminados: ' + kills;
    el('dead').classList.remove('hidden');
  }

  // Para pruebas automáticas
  G.debug = {
    get player() { return player; }, get camera() { return camera; }, get renderer() { return renderer; },
    get scene() { return scene; }, get state() { return state; },
    start, retry, toast, refresh: () => refreshWorld(true, 0),
    // congela al jugador en un momento de una animación (para revisar poses)
    freeze(kind, t, weapon) {
      if (weapon) { player.weapons = []; player.pickUp(weapon, 1); }
      player.action = kind ? { kind, t, dur: 1, done: true, weapon: player.weapon } : null;
      state = 'frozen';
    },
    tp(x, z, yaw, pitch) {
      player.pos.x = x; player.pos.z = z; player.y = G.World.groundY(x, z);
      if (yaw != null) G.Camera.yaw = yaw;
      if (pitch != null) G.Camera.pitch = pitch;
      G.Camera.dist = 0.1;
      refreshWorld(true, 0);
    }
  };

  window.addEventListener('DOMContentLoaded', init);
})(window.Game = window.Game || {});
