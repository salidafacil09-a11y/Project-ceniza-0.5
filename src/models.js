(function (G) {
  'use strict';

  // Personajes con esqueleto: cuerpo redondeado (esferas y cilindros) unido en
  // una sola malla con huesos, así cada personaje es una sola llamada de dibujo.
  // El modelo mira hacia +Z. Su izquierda es +X.

  const U = G.Util;

  // Huesos: [nombre, padre, posición relativa al padre]
  const BONES = [
    ['hips', -1, [0, 0.95, 0]],
    ['spine', 0, [0, 0.18, 0]],
    ['chest', 1, [0, 0.2, 0]],
    ['neck', 2, [0, 0.2, 0]],
    ['head', 3, [0, 0.08, 0]],
    ['armL', 2, [0.19, 0.11, 0]], ['foreL', 5, [0, -0.28, 0]], ['handL', 6, [0, -0.25, 0]],
    ['armR', 2, [-0.19, 0.11, 0]], ['foreR', 8, [0, -0.28, 0]], ['handR', 9, [0, -0.25, 0]],
    ['legL', 0, [0.1, -0.06, 0]], ['shinL', 11, [0, -0.42, 0]], ['footL', 12, [0, -0.4, 0]],
    ['legR', 0, [-0.1, -0.06, 0]], ['shinR', 14, [0, -0.42, 0]], ['footR', 15, [0, -0.4, 0]]
  ];
  const BI = {};
  BONES.forEach((b, i) => { BI[b[0]] = i; });

  let matPlayer = null, matZombie = null, matWeapon = null;
  function mats() {
    if (!matPlayer) {
      matPlayer = new THREE.MeshLambertMaterial({ vertexColors: true, skinning: true });
      matZombie = new THREE.MeshLambertMaterial({ vertexColors: true, skinning: true });
      matWeapon = new THREE.MeshLambertMaterial({ vertexColors: true });
    }
  }

  // ---------- Geometría del cuerpo ----------
  function bodyGeometry(o) {
    const m = new G.Mesher(true);
    const skin = o.skin, shirt = o.shirt, pants = o.pants, shoes = o.shoes || 0x2a2622;
    const sleeve = o.longSleeves ? shirt : skin;

    // pelvis y torso
    m.sphere(0, 0.93, 0, 0.165, 0.11, 0.115, pants, 1, BI.hips);
    m.cyl(0, 1.08, 0, 0.15, 0.155, 0.22, shirt, 10, BI.spine);
    m.sphere(0, 1.35, 0, 0.19, 0.15, 0.115, shirt, 2, BI.chest);
    m.cyl(0, 1.25, 0, 0.165, 0.185, 0.2, shirt, 12, BI.chest);
    // cuello y cabeza
    m.cyl(0, 1.52, 0, 0.05, 0.045, 0.1, skin, 8, BI.neck);
    m.sphere(0, 1.665, 0.005, 0.1, 0.122, 0.112, skin, 2, BI.head);
    // los detalles pequeños no van en la silueta del contorno
    const detail = !o.outlineOnly;
    if (detail) {
      m.sphere(0, 1.605, 0.02, 0.07, 0.045, 0.07, skin, 1, BI.head);          // mandíbula
      m.sphere(0, 1.66, 0.108, 0.012, 0.018, 0.012, U.shade(skin, 0.92), 1, BI.head); // nariz
      const eye = o.zombie ? 0xd8d4b8 : 0x1a1612;
      m.sphere(0.038, 1.69, 0.098, 0.016, 0.012, 0.01, eye, 1, BI.head);
      m.sphere(-0.038, 1.69, 0.098, 0.016, 0.012, 0.01, eye, 1, BI.head);
      if (o.zombie) m.sphere(0, 1.615, 0.1, 0.03, 0.012, 0.012, 0x3a1612, 1, BI.head);   // boca
    }
    if (o.hair != null) {
      m.sphere(0, 1.71, -0.012, 0.108, 0.1, 0.118, o.hair, 2, BI.head);
      if (o.longHair && detail) m.sphere(0, 1.6, -0.07, 0.1, 0.12, 0.06, o.hair, 1, BI.head);
    }
    // brazos
    for (const s of [1, -1]) {
      const A = s > 0 ? 'L' : 'R';
      const x = 0.19 * s;
      m.sphere(x - 0.01 * s, 1.415, 0, 0.056, 0.058, 0.056, shirt, 1, BI['arm' + A]);
      m.cyl(x + 0.004 * s, 1.29, 0, 0.046, 0.054, 0.26, shirt, 8, BI['arm' + A]);
      m.sphere(x, 1.16, 0, 0.046, 0.046, 0.046, sleeve, 1, BI['fore' + A]);
      m.cyl(x, 1.04, 0, 0.037, 0.045, 0.24, sleeve, 8, BI['fore' + A]);
      m.sphere(x, 0.86, 0.008, 0.036, 0.062, 0.026, skin, 1, BI['hand' + A]);
    }
    // piernas
    for (const s of [1, -1]) {
      const A = s > 0 ? 'L' : 'R';
      const x = 0.1 * s;
      m.cyl(x, 0.69, 0, 0.066, 0.085, 0.44, pants, 9, BI['leg' + A]);
      m.sphere(x, 0.48, 0.005, 0.062, 0.06, 0.062, pants, 1, BI['shin' + A]);
      m.cyl(x, 0.28, 0, 0.046, 0.06, 0.4, pants, 9, BI['shin' + A]);
      m.sphere(x, 0.06, 0.05, 0.055, 0.045, 0.12, shoes, 1, BI['foot' + A]);
    }
    // manchas de sangre en los zombis
    if (o.zombie && o.blood && detail) {
      const r = o.blood;
      for (let i = 0; i < 4; i++) {
        const a = r() * 6.28, y = 1.05 + r() * 0.4;
        m.sphere(Math.sin(a) * 0.17, y, Math.cos(a) * 0.11, 0.06 + r() * 0.05, 0.05 + r() * 0.05, 0.02, 0x5a1a14, 1, y > 1.2 ? BI.chest : BI.spine);
      }
      m.sphere(0.02, 1.6, 0.085, 0.05, 0.03, 0.03, 0x5a1a14, 1, BI.head);
    }
    const g = m.build();
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
    return g;
  }

  // ---------- Personaje ----------
  function createHumanoid(o) {
    mats();
    const root = new THREE.Group();        // posición en el mundo y orientación
    const body = new THREE.Group();        // se inclina al caer
    root.add(body);

    const bones = BONES.map((b) => {
      const bone = new THREE.Bone();
      bone.name = b[0];
      bone.position.fromArray(b[2]);
      return bone;
    });
    BONES.forEach((b, i) => { if (b[1] >= 0) bones[b[1]].add(bones[i]); });

    const mesh = new THREE.SkinnedMesh(bodyGeometry(o), o.zombie ? matZombie : matPlayer);
    mesh.add(bones[0]);
    bones[0].updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);

    const rest = bones.map((b) => b.position.clone());
    const h = {
      root, body, mesh, bones, rest, zombie: !!o.zombie, opts: o,
      weapon: null, weaponId: null
    };
    BONES.forEach((b, i) => { h[b[0]] = bones[i]; });
    return h;
  }

  // Contorno amarillo (como al apuntar en el original): una copia de la malla,
  // un poco inflada y vista por dentro, que comparte el esqueleto
  let outlineMat = null;
  function setOutline(h, on) {
    if (on && !h.outline) {
      if (!outlineMat) {
        outlineMat = new THREE.MeshBasicMaterial({ color: 0xf2c230, side: THREE.BackSide, skinning: true });
        outlineMat.toneMapped = false;
        outlineMat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3( position ) + normal * 0.03;');
        };
      }
      const geo = bodyGeometry(Object.assign({}, h.opts, { outlineOnly: true, blood: null }));
      const o = new THREE.SkinnedMesh(geo, outlineMat);
      o.bind(h.mesh.skeleton, h.mesh.bindMatrix);
      o.frustumCulled = false;
      h.body.add(o);
      h.outline = o;
    }
    if (h.outline) h.outline.visible = !!on;
  }

  function disposeHumanoid(h) {
    h.mesh.geometry.dispose();
    if (h.outline) h.outline.geometry.dispose();
    h.mesh.skeleton.dispose && h.mesh.skeleton.dispose();
  }

  // Coloca un arma en la mano derecha
  function setWeapon(h, id) {
    if (h.weaponId === id) return;
    if (h.weapon) { h.handR.remove(h.weapon); h.weapon = null; }
    h.weaponId = id;
    if (!id || id === 'manos') return;
    mats();
    const w = new THREE.Mesh(weaponGeometry(id), matWeapon);
    w.castShadow = true;
    const cat = G.Weapons.get(id).cat;
    // ángulo en la mano: la lanza apunta hacia abajo en reposo, el resto hacia delante y abajo
    w.rotation.x = cat === 'spear' ? Math.PI - 0.08 : 2.35;
    w.position.set(0, -0.05, 0.015);
    if (cat === 'spear') w.position.y = -0.05 - 0.5;   // se agarra por el medio
    h.handR.add(w);
    h.weapon = w;
  }

  // Arma larga a la espalda, cruzada en diagonal
  function setBackWeapon(h, id) {
    if (h.backId === id) return;
    if (h.back) { h.chest.remove(h.back); h.back = null; }
    h.backId = id;
    if (!id) return;
    mats();
    const w = new THREE.Mesh(weaponGeometry(id), matWeapon);
    w.castShadow = true;
    const len = G.Weapons.get(id).len || 0.9;
    w.rotation.set(0.12, 0, -0.62);
    w.position.set(-0.18 - 0.12 * (len - 0.9), -0.32 - 0.25 * (len - 0.9), -0.16);
    h.chest.add(w);
    h.back = w;
  }

  // ---------- Poses y animación ----------
  function reset(h) {
    for (let i = 0; i < h.bones.length; i++) {
      h.bones[i].rotation.set(0, 0, 0);
      h.bones[i].position.copy(h.rest[i]);
    }
  }

  const sin = Math.sin, cos = Math.cos, max = Math.max, abs = Math.abs;
  const c01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const easeOut = (t) => { t = c01(t); return 1 - (1 - t) * (1 - t) * (1 - t); };
  const easeIn = (t) => { t = c01(t); return t * t; };

  // Suaviza el paso de una pose a otra: cada hueso persigue su pose objetivo
  // con una inercia corta, así no hay saltos bruscos entre animaciones.
  function blend(h, dt, rate) {
    const n = h.bones.length;
    if (!h.prev) { h.prev = new Float32Array(n * 3 + 1); h.prevOk = false; }
    const k = (h.prevOk && dt != null) ? 1 - Math.exp(-dt * rate) : 1;
    const p = h.prev;
    for (let i = 0; i < n; i++) {
      const r = h.bones[i].rotation, j = i * 3;
      r.x = p[j] + (r.x - p[j]) * k; p[j] = r.x;
      r.y = p[j + 1] + (r.y - p[j + 1]) * k; p[j + 1] = r.y;
      r.z = p[j + 2] + (r.z - p[j + 2]) * k; p[j + 2] = r.z;
    }
    const hp = h.hips.position;
    hp.y = p[n * 3] + (hp.y - p[n * 3]) * (h.prevOk ? k : 1); p[n * 3] = hp.y;
    h.prevOk = true;
  }

  // Ciclo de piernas. p = fase, a = intensidad (0 a 1)
  function legs(h, p, a, run, drag) {
    const amp = (run ? 0.92 : 0.58) * a;
    const ampL = drag ? amp * 0.55 : amp;
    const knee = run ? 1.55 : 0.9;
    h.legL.rotation.x = -sin(p) * ampL;
    h.legR.rotation.x = sin(p) * amp;
    // la rodilla se dobla mientras la pierna avanza
    const fl = max(0, cos(p)), fr = max(0, -cos(p));
    h.shinL.rotation.x = a * (0.08 + knee * fl * fl * (drag ? 0.45 : 1));
    h.shinR.rotation.x = a * (0.08 + knee * fr * fr);
    // el pie se levanta al apoyar el talón y se estira al despegar
    h.footL.rotation.x = a * (-0.25 * max(0, -sin(p)) + 0.3 * fl * 0.5);
    h.footR.rotation.x = a * (-0.25 * max(0, sin(p)) + 0.3 * fr * 0.5);
    // cadera: sube al pasar la pierna, baja al apoyar, y se balancea
    h.hips.position.y = 0.95 - 0.02 * a + (run ? 0.035 : 0.018) * a * cos(2 * p);
    h.hips.rotation.y = sin(p) * 0.11 * a;
    h.hips.rotation.z = sin(p) * 0.045 * a;
    h.spine.rotation.z = -sin(p) * 0.03 * a;
    h.chest.rotation.y = -sin(p) * 0.15 * a;
  }

  // Brazos al caminar, con el codo un poco retrasado
  function armSwing(h, p, a, run, side) {
    const A = side === 'L' ? 'L' : 'R';
    const sg = side === 'L' ? 1 : -1;
    const sw = sin(p) * sg;
    h['arm' + A].rotation.x = sw * (run ? 0.75 : 0.42) * a;
    h['arm' + A].rotation.z = sg * (0.07 + (run ? 0.1 : 0) * a);
    const lag = max(0, -sin(p - 0.45) * sg);
    h['fore' + A].rotation.x = run ? -1.25 - 0.25 * lag * a : -0.18 - 0.38 * lag * a;
  }

  // Pose del jugador
  function posePlayer(h, s) {
    reset(h);
    const a = s.amt, p = s.phase, t = s.time || 0;
    legs(h, p, a, s.run, false);
    const two = !!s.two;
    const armed = s.cat && s.cat !== 'none';
    armSwing(h, p, a, s.run, 'L');
    armSwing(h, p, a, s.run, 'R');
    if (s.run) { h.spine.rotation.x = 0.2; h.neck.rotation.x = -0.12; }
    // respiración y pequeño balanceo de peso en reposo
    const idle = 1 - a;
    h.chest.rotation.x += sin(t * 1.7) * 0.022 * idle;
    h.hips.rotation.z += sin(t * 0.55) * 0.02 * idle;
    h.armL.rotation.z += sin(t * 1.7) * 0.012 * idle;
    h.armR.rotation.z -= sin(t * 1.7) * 0.012 * idle;

    if (armed) {
      if (s.aim) {
        // en guardia
        h.armR.rotation.x = -0.95; h.armR.rotation.z = -0.18;
        h.foreR.rotation.x = -1.15 + sin(t * 2) * 0.03;
        if (two) { h.armL.rotation.x = -0.95; h.armL.rotation.z = -0.52; h.foreL.rotation.x = -1.15; }
        else { h.armL.rotation.x = -0.25; h.foreL.rotation.x = -0.5; }
        h.spine.rotation.x = 0.12; h.chest.rotation.y = -0.18;
      } else if (two) {
        // a dos manos, el arma cruzada por delante
        h.armR.rotation.x = -0.35 + sin(p) * 0.06 * a; h.armR.rotation.z = -0.1;
        h.foreR.rotation.x = -0.9;
        h.armL.rotation.x = -0.45 + sin(p) * 0.06 * a; h.armL.rotation.z = -0.45;
        h.foreL.rotation.x = -1.0;
      } else {
        // a una mano, relajada al costado
        h.armR.rotation.x = -0.1 - sin(p) * (s.run ? 0.35 : 0.18) * a;
        h.foreR.rotation.x = -0.18 - (s.run ? 0.6 : 0.08) * a;
      }
    } else if (s.aim) {
      h.armL.rotation.x = -0.95; h.armR.rotation.x = -0.95;
      h.foreL.rotation.x = -1.0; h.foreR.rotation.x = -1.0;
    }

    // agachado: cadera baja, rodillas flexionadas y torso inclinado
    const c = s.crouch || 0;
    if (c > 0.01) {
      h.hips.position.y -= 0.26 * c;
      h.legL.rotation.x -= 1.0 * c; h.legR.rotation.x -= 1.0 * c;
      h.shinL.rotation.x += 1.55 * c; h.shinR.rotation.x += 1.55 * c;
      h.footL.rotation.x -= 0.55 * c; h.footR.rotation.x -= 0.55 * c;
      h.spine.rotation.x += 0.38 * c;
      h.neck.rotation.x -= 0.2 * c; h.head.rotation.x -= 0.15 * c;
    }

    if (s.action) action(h, s.action, s.t, two);
    if (s.climb != null) {
      const k = sin(Math.PI * s.climb);
      h.legL.rotation.x = -1.2 * k; h.shinL.rotation.x = 1.4 * k;
      h.legR.rotation.x = -0.4 * k; h.shinR.rotation.x = 0.8 * k;
      h.spine.rotation.x = 0.5 * k;
      h.armL.rotation.x = -1.0 * k; h.armR.rotation.x = -1.0 * k;
    }
    // la cabeza compensa el giro del cuerpo (mira hacia delante)
    h.head.rotation.y -= (h.hips.rotation.y + h.spine.rotation.y + h.chest.rotation.y) * 0.6;
    blend(h, s.dt, s.action ? 30 : 15);
  }

  // Ataques: t de 0 a 1, el golpe ocurre hacia t = 0.45.
  // Preparación rápida, golpe que acelera hasta el impacto y recuperación suave.
  function action(h, kind, t, two) {
    const wind = easeOut(t / 0.3);
    const hit = easeIn((t - 0.28) / 0.17);
    const back = U.smooth((t - 0.6) / 0.4);
    if (kind === 'swing2') {
      // golpe horizontal: giro de cadera y torso, con paso adelante
      const tw = -1.15 * wind + 2.15 * hit - 1.0 * back;
      h.hips.rotation.y = tw * 0.25;
      h.spine.rotation.y = tw * 0.35;
      h.chest.rotation.y = tw * 0.45;
      h.spine.rotation.x = 0.08 + 0.1 * hit * (1 - back);
      h.armR.rotation.x = -1.2 - 0.15 * wind * (1 - hit); h.armR.rotation.z = -0.3 + 0.25 * hit;
      h.foreR.rotation.x = -0.45 + 0.15 * hit;
      if (two) { h.armL.rotation.x = -1.15; h.armL.rotation.z = -0.6; h.foreL.rotation.x = -0.55; }
      else { h.armL.rotation.x = 0.3 * hit; h.armL.rotation.z = 0.35 * hit; }
      h.legL.rotation.x += -0.3 * hit * (1 - back);
      h.legR.rotation.x += 0.22 * hit * (1 - back);
      h.shinR.rotation.x += 0.2 * hit * (1 - back);
    } else if (kind === 'swing1' || kind === 'floor') {
      // golpe de arriba abajo (o al suelo)
      const low = kind === 'floor';
      const up = -2.6 * wind;
      const down = (low ? 2.2 : 1.6) * hit;
      h.armR.rotation.x = -0.4 + up + down + 0.6 * back;
      h.armR.rotation.z = -0.3 * wind * (1 - hit);
      h.foreR.rotation.x = -0.95 * wind + 0.65 * hit;
      h.handR.rotation.x = 0.85 * hit * (1 - back * 0.6);
      h.spine.rotation.x = (low ? 0.55 : 0.14) * hit * (1 - back * 0.7) - 0.08 * wind * (1 - hit);
      h.chest.rotation.y = -0.4 * wind + 0.65 * hit * (1 - back);
      h.hips.rotation.y = -0.15 * wind + 0.25 * hit * (1 - back);
      if (two) { h.armL.rotation.x = h.armR.rotation.x; h.armL.rotation.z = -0.45; h.foreL.rotation.x = h.foreR.rotation.x - 0.3; }
      else { h.armL.rotation.x = -0.3 * wind + 0.4 * hit; h.armL.rotation.z = 0.2; }
      if (low) { h.legL.rotation.x = -0.5 * hit; h.shinL.rotation.x = 0.6 * hit; h.legR.rotation.x = 0.2 * hit; }
      else { h.legL.rotation.x += -0.2 * hit * (1 - back); }
    } else if (kind === 'stab') {
      h.armR.rotation.x = -0.3 * (1 - hit) - 1.45 * hit * (1 - back) - 0.3 * back;
      h.foreR.rotation.x = -1.7 * wind * (1 - hit) - 0.15 * hit;
      h.handR.rotation.x = 0.75 * hit * (1 - back);
      h.chest.rotation.y = -0.35 * wind + 0.5 * hit * (1 - back);
      h.spine.rotation.x = 0.18 * hit * (1 - back);
      h.legL.rotation.x += -0.25 * hit * (1 - back);
      if (two) { h.armL.rotation.x = h.armR.rotation.x + 0.1; h.armL.rotation.z = -0.4; h.foreL.rotation.x = h.foreR.rotation.x; }
    } else if (kind === 'thrust') {
      const f = hit * (1 - back);
      h.armR.rotation.x = -1.2 - 0.35 * f + 0.2 * wind * (1 - hit); h.armR.rotation.z = -0.1;
      h.foreR.rotation.x = -0.9 * (1 - f) - 0.1;
      h.armL.rotation.x = -1.1 - 0.4 * f; h.armL.rotation.z = -0.45;
      h.foreL.rotation.x = -0.9 * (1 - f) - 0.2;
      h.spine.rotation.x = 0.22 * f - 0.08 * wind * (1 - hit);
      h.legL.rotation.x = -0.55 * f; h.legR.rotation.x = 0.35 * f;
    } else if (kind === 'shove') {
      const f = hit * (1 - back);
      for (const A of ['L', 'R']) {
        h['arm' + A].rotation.x = -0.6 - 0.95 * f;
        h['arm' + A].rotation.z = A === 'L' ? -0.15 : 0.15;
        h['fore' + A].rotation.x = -1.35 * (1 - f) - 0.1;
      }
      h.spine.rotation.x = 0.28 * f - 0.05 * wind * (1 - hit);
      h.legL.rotation.x = -0.5 * f; h.shinL.rotation.x = 0.2 * f;
    } else if (kind === 'stomp') {
      const lift = wind * (1 - hit);
      h.legR.rotation.x = -1.25 * lift - 0.3 * hit * (1 - back);
      h.shinR.rotation.x = 1.35 * lift + 0.1;
      h.footR.rotation.x = 0.3 * lift;
      h.spine.rotation.x = 0.28 * (wind + hit) * (1 - back);
      h.armL.rotation.z = 0.5 * wind * (1 - back); h.armR.rotation.z = -0.5 * wind * (1 - back);
      h.legL.rotation.x = 0.15 * lift; h.shinL.rotation.x = 0.35 * lift;
    }
  }

  // Pose del zombi
  function poseZombie(h, s) {
    reset(h);
    const t = s.time || 0, seed = s.seed || 0;
    legs(h, s.phase, s.amt, false, s.drag);
    // paso torpe: la cadera se tuerce y el torso se balancea
    const sw = sin(s.phase * 0.5 + seed);
    h.hips.rotation.z += sin(s.phase) * 0.08 * s.amt;
    h.spine.rotation.z = sw * 0.07 + s.lean;
    h.spine.rotation.x = 0.14 + 0.05 * sin(s.phase * 2) * s.amt;
    h.neck.rotation.z = 0.25 * s.tilt + sw * 0.05;
    h.neck.rotation.y = sin(t * 0.8 + seed) * 0.18;
    h.head.rotation.x = 0.2 + sin(t * 1.3 + seed * 2) * 0.05;
    // brazos: colgando al vagar, hacia delante al perseguir
    const up = s.chase ? 1 : s.armsUp;
    const lag = sin(s.phase - 0.6);
    h.armL.rotation.x = -0.15 - 1.15 * up + lag * 0.16 + sin(t * 1.1 + seed) * 0.05;
    h.armR.rotation.x = -0.15 - 1.05 * up - lag * 0.16 + sin(t * 1.3 + seed) * 0.05;
    h.armL.rotation.z = 0.12 + 0.05 * sw; h.armR.rotation.z = -0.12 + 0.05 * sw;
    h.foreL.rotation.x = -0.25 - 0.2 * up - 0.1 * max(0, lag);
    h.foreR.rotation.x = -0.3 - 0.2 * up - 0.1 * max(0, -lag);
    if (s.reach > 0) {
      const r = s.reach;
      h.armL.rotation.x = U.lerp(h.armL.rotation.x, -1.55, r);
      h.armR.rotation.x = U.lerp(h.armR.rotation.x, -1.5, r);
      h.armL.rotation.z = -0.15 * r; h.armR.rotation.z = 0.15 * r;
      h.foreL.rotation.x = -0.1; h.foreR.rotation.x = -0.1;
      h.spine.rotation.x = 0.14 + 0.38 * r;
      h.head.rotation.x = 0.35 * r;
    }
    if (s.bang) {
      const b = max(0, sin(s.bang * 9));
      h.armL.rotation.x = -1.4 - 0.4 * b; h.armR.rotation.x = -1.4 - 0.4 * max(0, sin(s.bang * 9 + 1.5));
      h.spine.rotation.x = 0.25 + 0.08 * b;
    }
    if (s.stagger > 0) {
      const k = sin(Math.PI * Math.min(1, s.stagger));
      h.spine.rotation.x = -0.45 * k;
      h.armL.rotation.z = 0.9 * k; h.armR.rotation.z = -0.9 * k;
      h.armL.rotation.x = -0.6 * k; h.armR.rotation.x = -0.6 * k;
      h.head.rotation.x = -0.3 * k;
      h.legL.rotation.x = 0.3 * k; h.shinL.rotation.x = 0.3 * k;
    }
    blend(h, s.dt, (s.stagger > 0 || s.reach > 0.2) ? 22 : 9);
  }

  // Tumbado: f de 0 (de pie) a 1 (en el suelo). dir = -1 de espaldas, 1 boca abajo
  function poseFall(h, f, dir) {
    const a = dir * Math.PI / 2 * U.smooth(f);
    h.body.rotation.x = a;
    h.body.position.y = 0.12 * U.smooth(f);
    h.body.position.z = 0;
    if (f > 0.5) {
      h.armL.rotation.z = 0.6; h.armR.rotation.z = -0.5;
      h.armL.rotation.x = dir > 0 ? -0.2 : 0.3; h.armR.rotation.x = dir > 0 ? -0.3 : 0.2;
      h.legL.rotation.z = 0.12; h.legR.rotation.z = -0.1;
      h.head.rotation.y = 0.4;
    }
  }

  // ---------- Armas (modelos) ----------
  const geoCache = {};
  function weaponGeometry(id) {
    if (geoCache[id]) return geoCache[id];
    const m = new G.Mesher();
    const WOOD = 0x9a7046, DARKW = 0x6e4e30, METAL = 0x9aa0a6, DARKM = 0x55595e, RED = 0xa8322a, BLACK = 0x26262a, RUST = 0x7a5a3e;
    const nails = (y0, y1, r) => { for (let y = y0; y <= y1; y += 0.07) { m.box(0, y, 0, r * 2 + 0.07, 0.008, 0.008, DARKM); m.box(0, y + 0.035, 0, 0.008, 0.008, r * 2 + 0.07, DARKM); } };
    switch (id) {
      case 'bate': case 'bate_clavos':
        m.cyl(0, 0.2, 0, 0.018, 0.022, 0.4, WOOD, 8);
        m.cyl(0, 0.62, 0, 0.022, 0.036, 0.46, WOOD, 8);
        m.sphere(0, 0.85, 0, 0.036, 0.02, 0.036, WOOD, 1);
        m.cyl(0, 0.02, 0, 0.026, 0.026, 0.03, DARKW, 8);
        if (id === 'bate_clavos') nails(0.55, 0.82, 0.032);
        break;
      case 'golf':
        m.cyl(0, 0.12, 0, 0.016, 0.016, 0.24, BLACK, 8);
        m.cyl(0, 0.6, 0, 0.007, 0.01, 0.76, METAL, 6);
        m.box(0, 0.98, 0.04, 0.03, 0.05, 0.11, DARKM);
        break;
      case 'mazo':
        m.cyl(0, 0.38, 0, 0.018, 0.02, 0.76, WOOD, 8);
        m.box(0, 0.8, 0, 0.09, 0.09, 0.24, DARKM);
        break;
      case 'pala':
        m.cyl(0, 0.45, 0, 0.017, 0.017, 0.9, WOOD, 8);
        m.box(0, 0.04, 0, 0.1, 0.03, 0.03, BLACK);
        m.box(0, 1.0, 0, 0.22, 0.26, 0.012, DARKM);
        break;
      case 'tabla': case 'tabla_clavos':
        m.box(0, 0.5, 0, 0.09, 1.0, 0.025, 0xa98a62);
        if (id === 'tabla_clavos') for (let y = 0.65; y < 0.98; y += 0.08) m.box(0, y, 0, 0.12, 0.008, 0.008, DARKM);
        break;
      case 'palanca':
        m.cyl(0, 0.36, 0, 0.012, 0.012, 0.72, 0x3e3e42, 6);
        m.box(0, 0.73, 0.03, 0.02, 0.02, 0.07, 0x3e3e42, 0, 0, 0.5);
        break;
      case 'martillo':
        m.cyl(0, 0.16, 0, 0.014, 0.017, 0.32, WOOD, 8);
        m.box(0, 0.33, 0.01, 0.03, 0.03, 0.13, DARKM);
        break;
      case 'llave':
        m.box(0, 0.16, 0, 0.026, 0.32, 0.012, METAL);
        m.box(0, 0.34, 0, 0.06, 0.04, 0.02, METAL);
        break;
      case 'sarten':
        m.cyl(0, 0.1, 0, 0.012, 0.014, 0.2, BLACK, 8);
        m.cyl(0, 0.33, 0, 0.12, 0.13, 0.025, 0x3a3a3e, 14, 0, Math.PI / 2, 0, 0);
        break;
      case 'tubo':
        m.cyl(0, 0.31, 0, 0.018, 0.018, 0.62, 0x6c7176, 8);
        break;
      case 'rodillo':
        m.cyl(0, 0.04, 0, 0.012, 0.012, 0.08, WOOD, 6);
        m.cyl(0, 0.22, 0, 0.03, 0.03, 0.28, 0xc9a77c, 10);
        m.cyl(0, 0.4, 0, 0.012, 0.012, 0.08, WOOD, 6);
        break;
      case 'porra':
        m.cyl(0, 0.3, 0, 0.016, 0.019, 0.6, BLACK, 8);
        m.cyl(0, 0.14, 0.04, 0.012, 0.012, 0.09, BLACK, 6, 0, Math.PI / 2, 0, 0);
        break;
      case 'hacha_bombero':
        m.cyl(0, 0.44, 0, 0.018, 0.02, 0.88, RED, 8);
        m.box(0, 0.84, 0.07, 0.022, 0.14, 0.13, METAL);
        m.box(0, 0.84, -0.07, 0.02, 0.05, 0.12, DARKM);
        break;
      case 'hacha_mano':
        m.cyl(0, 0.2, 0, 0.015, 0.018, 0.42, WOOD, 8);
        m.box(0, 0.4, 0.05, 0.02, 0.09, 0.1, METAL);
        break;
      case 'machete':
        m.cyl(0, 0.07, 0, 0.016, 0.016, 0.14, BLACK, 8);
        m.box(0, 0.4, 0.008, 0.006, 0.52, 0.05, METAL);
        break;
      case 'katana':
        m.cyl(0, 0.13, 0, 0.016, 0.016, 0.26, BLACK, 8);
        m.cyl(0, 0.27, 0, 0.04, 0.04, 0.012, 0xb59a52, 10);
        m.box(0, 0.64, 0.004, 0.005, 0.72, 0.03, 0xc4c9ce);
        break;
      case 'cuchillo':
        m.box(0, 0.06, 0, 0.022, 0.12, 0.016, BLACK);
        m.box(0, 0.2, 0.006, 0.004, 0.17, 0.035, METAL);
        break;
      case 'cuchillo_caza':
        m.box(0, 0.06, 0, 0.026, 0.12, 0.02, DARKW);
        m.box(0, 0.125, 0, 0.05, 0.012, 0.02, DARKM);
        m.box(0, 0.22, 0.006, 0.005, 0.18, 0.04, METAL);
        break;
      case 'destornillador':
        m.cyl(0, 0.05, 0, 0.016, 0.02, 0.1, 0xd0a42a, 8);
        m.cyl(0, 0.18, 0, 0.004, 0.004, 0.16, METAL, 6);
        break;
      case 'cuchilla':
        m.box(0, 0.06, 0, 0.024, 0.12, 0.018, DARKW);
        m.box(0, 0.22, 0.025, 0.005, 0.2, 0.09, METAL);
        break;
      case 'lanza':
        m.cyl(0, 0.75, 0, 0.016, 0.018, 1.5, WOOD, 8);
        m.box(0, 1.52, 0, 0.026, 0.04, 0.026, 0x6b6b6b);
        m.cone(0, 1.62, 0, 0.022, 0.18, METAL, 4);
        break;
      default:
        m.cyl(0, 0.3, 0, 0.02, 0.02, 0.6, RUST, 6);
    }
    return (geoCache[id] = m.build());
  }

  G.Models = {
    createHumanoid, disposeHumanoid, setWeapon, setBackWeapon, setOutline,
    posePlayer, poseZombie, poseFall, reset,
    weaponGeometry, BI
  };
})(window.Game = window.Game || {});
