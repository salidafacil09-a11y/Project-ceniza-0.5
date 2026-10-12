(function (G) {
  'use strict';

  // Entrada unificada. El juego solo lee:
  //   Input.move {x, y}   movimiento (-1 a 1; y negativo = adelante)
  //   Input.look {x, y}   giro de cámara de este fotograma (radianes)
  //   Input.run, Input.aim            botones mantenidos
  //   Input.attack, shove, use, cycle botones pulsados en este fotograma
  //
  // PC: WASD, ratón (clic en la pantalla para capturarlo), clic izq. atacar,
  //     clic der. apuntar, Espacio empujar/pisotear, E usar, Q o rueda cambiar arma.
  // Móvil: joystick a la izquierda, arrastrar a la derecha para mirar, botones.
  // Mando: sticks, RT atacar, LT apuntar, A usar, X empujar, Y cambiar, B correr.

  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const keys = {};
  const touch = { id: null, ox: 0, oy: 0, x: 0, y: 0, lookId: null, lx: 0, ly: 0, run: false };
  const JOY_RADIUS = 52;
  const MOUSE_SENS = 0.0026;
  const TOUCH_SENS = 0.0065;
  const PAD_LOOK = 2.6;            // rad/s con el stick al máximo
  let mouseDX = 0, mouseDY = 0;
  let mouseAim = false;
  const queued = { attack: false, shove: false, use: false, cycle: false, pause: false, crouch: false, grip: false, drop: false };
  const prevPad = [];
  let canvas = null;

  const Input = {
    isTouch,
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    run: false, aim: false,
    attack: false, shove: false, use: false, cycle: false, pause: false, crouch: false, grip: false, drop: false,
    pointerLocked: false,
    enabled: false,

    init(canvasEl) {
      canvas = canvasEl;
      window.addEventListener('keydown', (e) => {
        if (keys[e.code]) return;
        keys[e.code] = true;
        if (!Input.enabled) return;
        if (e.code === 'Space') { queued.shove = true; e.preventDefault(); }
        if (e.code === 'KeyE' || e.code === 'KeyF') queued.use = true;
        if (e.code === 'KeyQ' || e.code === 'Tab') { queued.cycle = true; e.preventDefault(); }
        if (e.code === 'KeyP') queued.pause = true;
        if (e.code === 'KeyC') queued.crouch = true;
        if (e.code === 'KeyV') queued.grip = true;
        if (e.code === 'KeyG') queued.drop = true;
        if (e.code.startsWith('Arrow')) e.preventDefault();
      });
      window.addEventListener('keyup', (e) => { keys[e.code] = false; });
      window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseAim = false; });

      if (!isTouch) {
        canvas.addEventListener('mousedown', (e) => {
          if (!Input.enabled) return;
          if (!Input.pointerLocked) { Input.requestLock(); return; }
          if (e.button === 0) queued.attack = true;
          if (e.button === 2) mouseAim = true;
        });
        window.addEventListener('mouseup', (e) => { if (e.button === 2) mouseAim = false; });
        window.addEventListener('mousemove', (e) => {
          // sin ratón capturado (por ejemplo dentro de un iframe) se puede mirar arrastrando
          if (!Input.pointerLocked && !(Input.enabled && e.buttons)) return;
          mouseDX += e.movementX || 0;
          mouseDY += e.movementY || 0;
        });
        window.addEventListener('wheel', (e) => {
          if (Input.enabled && Input.pointerLocked && Math.abs(e.deltaY) > 2) queued.cycle = true;
        }, { passive: true });
        document.addEventListener('pointerlockchange', () => {
          Input.pointerLocked = document.pointerLockElement === canvas;
          if (!Input.pointerLocked) mouseAim = false;
        });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      } else {
        setupTouch();
      }
    },

    requestLock() {
      if (isTouch || !canvas || !canvas.requestPointerLock) return;
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* sin bloqueo de puntero */ }
    },

    update(dt) {
      let x = 0, y = 0;
      if (keys.KeyA || keys.ArrowLeft) x -= 1;
      if (keys.KeyD || keys.ArrowRight) x += 1;
      if (keys.KeyW || keys.ArrowUp) y -= 1;
      if (keys.KeyS || keys.ArrowDown) y += 1;
      if (Math.hypot(touch.x, touch.y) > 0.15) { x += touch.x; y += touch.y; }

      let lx = mouseDX * MOUSE_SENS + touch.lx * TOUCH_SENS;
      let ly = mouseDY * MOUSE_SENS + touch.ly * TOUCH_SENS;
      mouseDX = mouseDY = 0;
      touch.lx = touch.ly = 0;

      const pad = readPad();
      x += pad.x; y += pad.y;
      lx += pad.lx * PAD_LOOK * dt;
      ly += pad.ly * PAD_LOOK * dt * 0.8;

      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      this.move.x = x; this.move.y = y;
      this.look.x = lx; this.look.y = ly;
      this.run = !!(keys.ShiftLeft || keys.ShiftRight || touch.run || pad.run);
      this.aim = !!(mouseAim || keys.ControlLeft || pad.aim);
      this.attack = queued.attack || pad.attack;
      this.shove = queued.shove || pad.shove;
      this.use = queued.use || pad.use;
      this.cycle = queued.cycle || pad.cycle;
      this.pause = queued.pause || pad.pause;
      this.crouch = queued.crouch || pad.crouch;
      this.grip = queued.grip || pad.grip;
      this.drop = queued.drop || pad.drop;
      for (const k in queued) queued[k] = false;
    },

    clear() {
      for (const k in queued) queued[k] = false;
      mouseDX = mouseDY = 0;
    },

    padConfirm() {
      const p = firstPad();
      return !!(p && p.buttons[0] && p.buttons[0].pressed);
    }
  };

  function firstPad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) return pads[i];
    return null;
  }

  function readPad() {
    const out = { x: 0, y: 0, lx: 0, ly: 0, run: false, aim: false, attack: false, shove: false, use: false, cycle: false, pause: false, crouch: false, grip: false, drop: false };
    const p = firstPad();
    if (!p) return out;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    out.x = dz(p.axes[0] || 0); out.y = dz(p.axes[1] || 0);
    out.lx = dz(p.axes[2] || 0); out.ly = dz(p.axes[3] || 0);
    const b = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.4));
    const pressed = (i) => { const now = b(i); const was = prevPad[i]; prevPad[i] = now; return now && !was; };
    if (!out.x && !out.y) {
      if (b(12)) out.y = -1; if (b(13)) out.y = 1;
      if (b(14)) out.x = -1; if (b(15)) out.x = 1;
    }
    out.run = b(1) || b(10);
    out.crouch = pressed(11);
    out.aim = b(6);
    out.attack = pressed(7);
    out.use = pressed(0);
    out.shove = pressed(2) || pressed(5);
    out.cycle = pressed(3);
    out.grip = pressed(4);
    out.drop = pressed(8);
    out.pause = pressed(9);
    return out;
  }

  function setupTouch() {
    const ui = document.getElementById('touch-ui');
    const zone = document.getElementById('joy-zone');
    const lookZone = document.getElementById('look-zone');
    const base = document.getElementById('joy-base');
    const knob = document.getElementById('joy-knob');
    const hint = document.getElementById('joy-hint');
    ui.classList.add('visible');

    zone.addEventListener('pointerdown', (e) => {
      if (touch.id !== null) return;
      touch.id = e.pointerId; touch.ox = e.clientX; touch.oy = e.clientY; touch.x = touch.y = 0;
      zone.setPointerCapture(e.pointerId);
      base.style.left = e.clientX + 'px'; base.style.top = e.clientY + 'px';
      knob.style.transform = 'translate(-50%, -50%)';
      base.classList.add('on'); hint.classList.add('off');
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== touch.id) return;
      let dx = e.clientX - touch.ox, dy = e.clientY - touch.oy;
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) { dx = dx / len * JOY_RADIUS; dy = dy / len * JOY_RADIUS; }
      touch.x = dx / JOY_RADIUS; touch.y = dy / JOY_RADIUS;
      knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
    });
    const endJoy = (e) => {
      if (e.pointerId !== touch.id) return;
      touch.id = null; touch.x = touch.y = 0;
      base.classList.remove('on'); hint.classList.remove('off');
    };
    zone.addEventListener('pointerup', endJoy);
    zone.addEventListener('pointercancel', endJoy);

    // Arrastrar con el pulgar derecho para mover la cámara
    let lastX = 0, lastY = 0;
    lookZone.addEventListener('pointerdown', (e) => {
      if (touch.lookId !== null) return;
      touch.lookId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
      lookZone.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== touch.lookId) return;
      touch.lx += e.clientX - lastX; touch.ly += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
    });
    const endLook = (e) => { if (e.pointerId === touch.lookId) touch.lookId = null; };
    lookZone.addEventListener('pointerup', endLook);
    lookZone.addEventListener('pointercancel', endLook);

    const tap = (id, key) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => {
        if (Input.enabled) queued[key] = true;
        el.classList.add('down');
        e.preventDefault(); e.stopPropagation();
      });
      const up = () => el.classList.remove('down');
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    };
    tap('btn-attack', 'attack');
    tap('btn-shove', 'shove');
    tap('btn-use', 'use');
    tap('btn-cycle', 'cycle');
    tap('btn-pause', 'pause');
    tap('btn-crouch', 'crouch');
    tap('btn-grip', 'grip');
    tap('btn-drop', 'drop');
    document.getElementById('btn-crouch').addEventListener('pointerdown', () => {
      touch.run = false;
      document.getElementById('btn-run').classList.remove('down');
    });

    const runBtn = document.getElementById('btn-run');
    runBtn.addEventListener('pointerdown', (e) => { touch.run = !touch.run; runBtn.classList.toggle('down', touch.run); e.preventDefault(); });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  G.Input = Input;
})(window.Game = window.Game || {});
