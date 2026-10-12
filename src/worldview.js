(function (G) {
  'use strict';

  // Construye y actualiza los modelos 3D de cada chunk:
  // suelo con textura, paredes, techos, puertas, ventanas, árboles, farolas,
  // vallas, luces de las habitaciones y armas en el suelo.

  const W = () => G.World;
  const U = G.Util;
  let scene = null;
  let R = null;
  const lightPool = [];
  let lightTimer = 0;
  const animDoors = [];

  // ---------- Texturas procedurales (sin imágenes externas) ----------
  function dataTex(size, fn) {
    const d = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = U.clamp(Math.round(fn(x, y) * 255), 0, 255);
        const i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }

  function makeTextures() {
    const rnd = U.mulberry32(42);
    const n = new Float32Array(128 * 128).map(() => rnd());
    const smoothN = (x, y, s) => {
      // ruido suave periódico
      const fx = x / s, fy = y / s;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const m = 128 / s;
      const g = (a, b) => n[((((b % m) + m) % m) * 128 + (((a % m) + m) % m)) % n.length];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
      return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    };
    return {
      grass: dataTex(128, (x, y) => 0.78 + smoothN(x, y, 16) * 0.12 + smoothN(x, y, 4) * 0.08 + rnd() * 0.07),
      asphalt: dataTex(128, (x, y) => 0.82 + smoothN(x, y, 32) * 0.08 + rnd() * 0.12),
      concrete: dataTex(128, (x, y) => {
        const seam = (x % 64 < 1 || y % 64 < 1) ? -0.18 : 0;
        return 0.84 + smoothN(x, y, 16) * 0.08 + rnd() * 0.06 + seam;
      }),
      wood: dataTex(128, (x, y) => {
        const plank = Math.floor(y / 16);
        const off = (plank * 37) % 128;
        const seam = (y % 16 === 0 || ((x + off) % 128) === 0) ? -0.28 : 0;
        const grain = Math.sin((x + plank * 13) * 0.35 + smoothN(x, y, 8) * 6) * 0.05;
        return 0.82 + grain + (plank % 3) * 0.04 + seam + rnd() * 0.03;
      }),
      tile: dataTex(128, (x, y) => ((x % 32) < 2 || (y % 32) < 2) ? 0.62 : 0.95 + rnd() * 0.04),
      carpet: dataTex(128, (x, y) => 0.86 + smoothN(x, y, 4) * 0.08 + rnd() * 0.08),
      lino: dataTex(128, (x, y) => ((x % 64) < 1 || (y % 64) < 1) ? 0.75 : 0.9 + smoothN(x, y, 32) * 0.06 + rnd() * 0.03)
    };
  }

  // ---------- Recursos compartidos ----------
  function init(sceneRef) {
    scene = sceneRef;
    const tex = makeTextures();
    const lam = (o) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true }, o || {}));
    R = {
      tex,
      ground: {
        grass: lam({ map: tex.grass }), asphalt: lam({ map: tex.asphalt }),
        concrete: lam({ map: tex.concrete }), wood: lam({ map: tex.wood }),
        tile: lam({ map: tex.tile }), carpet: lam({ map: tex.carpet }), lino: lam({ map: tex.lino })
      },
      static: lam(),
      roof: lam({ side: THREE.DoubleSide }),
      glass: new THREE.MeshLambertMaterial({ color: 0xa8c4d0, transparent: true, opacity: 0.3, depthWrite: false }),
      fixture: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      tree: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
      trunk: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      item: lam(),
      itemRing: new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.22, depthWrite: false }),
      doorGeo: makeDoorGeo(),
      glassGeo: new THREE.BoxGeometry(0.86, W().WIN_HI - W().WIN_LO, 0.02),
      fixtureGeo: new THREE.SphereGeometry(0.22, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      lampHeadGeo: new THREE.BoxGeometry(0.5, 0.12, 0.24),
      trunkGeo: (() => { const g = new THREE.CylinderGeometry(0.7, 1, 1, 7); g.translate(0, 0.5, 0); return g; })(),
      crownGeo: makeCrown(),
      pineGeo: makePine(),
      ringGeo: (() => { const g = new THREE.RingGeometry(0.34, 0.42, 24); g.rotateX(-Math.PI / 2); return g; })()
    };
    R.fixture.toneMapped = false;

    // Luces de las habitaciones: un número fijo, se asignan a las más cercanas
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffd8a0, 0, 9, 1.6);
      l.position.set(0, -50, 0);
      scene.add(l);
      lightPool.push(l);
    }
  }

  function makeDoorGeo() {
    const m = new G.Mesher();
    const col = 0x7a5534;
    m.box(0.43, 1.02, 0, 0.86, 2.04, 0.045, col);
    // paneles en relieve
    m.box(0.43, 1.45, 0, 0.62, 0.7, 0.06, U.shade(col, 0.9));
    m.box(0.43, 0.55, 0, 0.62, 0.7, 0.06, U.shade(col, 0.9));
    m.sphere(0.76, 1.0, 0.04, 0.035, 0.035, 0.035, 0xc9b27a, 1);
    m.sphere(0.76, 1.0, -0.04, 0.035, 0.035, 0.035, 0xc9b27a, 1);
    return m.build();
  }

  function makeCrown() {
    const m = new G.Mesher();
    const blobs = [[0, 0, 0, 1.6, 1.25, 1.6, 0x4f7a3a], [0.9, 0.35, 0.4, 1.1, 0.95, 1.1, 0x5a8640],
                   [-0.8, 0.45, -0.5, 1.15, 1.0, 1.15, 0x466f34], [0.15, 1.0, -0.1, 1.05, 0.9, 1.05, 0x5f8c45],
                   [-0.3, 0.2, 0.9, 0.95, 0.8, 0.95, 0x4b7537]];
    for (const b of blobs) m.sphere(b[0], b[1], b[2], b[3], b[4], b[5], b[6], 1);
    return m.build();
  }

  function makePine() {
    const m = new G.Mesher();
    const layers = [[0, 2.2, 1.9, 0x2f5233], [1.7, 2.0, 1.55, 0x355b38], [3.2, 1.8, 1.15, 0x3a633d], [4.5, 1.6, 0.7, 0x406a40]];
    for (const l of layers) m.cone(0, l[0] + l[1] / 2, 0, l[2], l[1], l[3], 9);
    return m.build();
  }

  // ---------- Colores ----------
  const GROUND = {};
  function groundStyle(g) {
    const F = W().F;
    if (GROUND[g]) return GROUND[g];
    const s = {
      [F.GRASS]: { mat: 'grass', base: 0x5d7d43, alt: 0x6f8a4a, scale: 0.25 },
      [F.ROAD]: { mat: 'asphalt', base: 0x47484b, alt: 0x4f4f50, scale: 0.2 },
      [F.SIDEWALK]: { mat: 'concrete', base: 0xa6a298, alt: 0xb0aca2, scale: 0.5 },
      [F.DIRT]: { mat: 'grass', base: 0x6e5a42, alt: 0x7a664c, scale: 0.25 },
      [F.WOOD]: { mat: 'wood', base: 0x9a6f48, alt: 0x936a44, scale: 0.5 },
      [F.TILE]: { mat: 'tile', base: 0xd9d6cb, alt: 0xd2cfc4, scale: 1 },
      [F.CONCRETE]: { mat: 'concrete', base: 0x8d8c86, alt: 0x96958e, scale: 0.25 },
      [F.LINO]: { mat: 'lino', base: 0xbfc4b9, alt: 0xb9beb3, scale: 0.5 },
      [F.CARPET]: { mat: 'carpet', base: 0x8b7b6a, alt: 0x857565, scale: 0.5 }
    }[g] || { mat: 'grass', base: 0x5d7d43, alt: 0x6f8a4a, scale: 0.25 };
    s.c0 = new THREE.Color(s.base).convertSRGBToLinear();
    s.c1 = new THREE.Color(s.alt).convertSRGBToLinear();
    GROUND[g] = s;
    return s;
  }

  // ---------- Suelo ----------
  function buildGround(c, group) {
    const Wd = W();
    const F = Wd.F;
    const CS = Wd.CS;
    const ox = c.cx * CS, oz = c.cz * CS;
    const parts = {};
    const get = (mat) => parts[mat] || (parts[mat] = { p: [], n: [], col: [], uv: [], idx: [] });
    const tmp = new THREE.Color();

    const vert = (P, x, y, z, s, nx, ny, nz) => {
      const v = Wd.vnoise(x / 5, z / 5, 21) * 0.7 + Wd.hash(Math.round(x * 2), Math.round(z * 2), 22) * 0.3;
      tmp.copy(s.c0).lerp(s.c1, v);
      P.p.push(x, y, z);
      P.n.push(nx, ny, nz);
      P.col.push(tmp.r, tmp.g, tmp.b);
      P.uv.push(x * s.scale, z * s.scale);
    };
    const quad = (P, a, b, cc, d, s, nrm) => {
      const base = P.p.length / 3;
      vert(P, a[0], a[1], a[2], s, nrm[0], nrm[1], nrm[2]);
      vert(P, b[0], b[1], b[2], s, nrm[0], nrm[1], nrm[2]);
      vert(P, cc[0], cc[1], cc[2], s, nrm[0], nrm[1], nrm[2]);
      vert(P, d[0], d[1], d[2], s, nrm[0], nrm[1], nrm[2]);
      // orienta el triángulo según la normal pedida
      const ux = cc[0] - a[0], uy = cc[1] - a[1], uz = cc[2] - a[2];
      const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * nrm[0] + ny * nrm[1] + nz * nrm[2] >= 0) P.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else P.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const g = c.ground[z * CS + x];
        const s = groundStyle(g);
        const P = get(s.mat);
        const X = ox + x, Z = oz + z;
        const y = g === F.SIDEWALK ? 0.1 : (g >= 10 ? 0.04 : 0);
        quad(P, [X, y, Z], [X + 1, y, Z], [X + 1, y, Z + 1], [X, y, Z + 1], s, [0, 1, 0]);
        if (g === F.SIDEWALK) {
          // bordillos
          const cs = groundStyle(F.SIDEWALK);
          const nb = (dx, dz) => {
            const xx = x + dx, zz = z + dz;
            if (xx < 0 || zz < 0 || xx >= CS || zz >= CS) return Wd.ground(X + dx, Z + dz);
            return c.ground[zz * CS + xx];
          };
          if (nb(0, -1) !== F.SIDEWALK) quad(P, [X + 1, 0, Z], [X, 0, Z], [X, 0.1, Z], [X + 1, 0.1, Z], cs, [0, 0, -1]);
          if (nb(0, 1) !== F.SIDEWALK) quad(P, [X, 0, Z + 1], [X + 1, 0, Z + 1], [X + 1, 0.1, Z + 1], [X, 0.1, Z + 1], cs, [0, 0, 1]);
          if (nb(-1, 0) !== F.SIDEWALK) quad(P, [X, 0, Z], [X, 0, Z + 1], [X, 0.1, Z + 1], [X, 0.1, Z], cs, [-1, 0, 0]);
          if (nb(1, 0) !== F.SIDEWALK) quad(P, [X + 1, 0, Z + 1], [X + 1, 0, Z], [X + 1, 0.1, Z], [X + 1, 0.1, Z + 1], cs, [1, 0, 0]);
        }
      }
    }

    for (const k in parts) {
      const P = parts[k];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(P.n, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(P.col, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(P.uv, 2));
      geo.setIndex(P.idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, R.ground[k]);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ---------- Paredes ----------
  function sideColor(tx, tz, ownerB) {
    const room = W().roomAt(tx, tz);
    if (room) return { hex: room.wall, ext: false };
    return { hex: ownerB ? ownerB.siding : 0xcccccc, ext: true };
  }

  // Trozo de pared entre y0 e y1 en la arista (o, x, z); a lo largo de [s0, s1] de la arista
  function wallPiece(m, o, x, z, y0, y1, A, Bc, s0, s1) {
    const Wd = W();
    const T = Wd.WALL_T, HT = T / 2;
    const len = (s1 - s0) + 0.008, mid = (s0 + s1) / 2;   // leve solape para que no se vean rendijas
    const parts = [[A, -1], [Bc, 1]];
    for (const [side, sg] of parts) {
      const hex = side.hex;
      const pieces = [];
      if (side.ext && y0 < 0.3) {
        pieces.push([y0, Math.min(y1, 0.3), U.shade(hex, 0.62)]);
        if (y1 > 0.3) pieces.push([0.3, y1, hex]);
      } else pieces.push([y0, y1, hex]);
      for (const [a, b, h] of pieces) {
        if (o === 'N') m.box(x + mid, (a + b) / 2, z + sg * HT / 2, len, b - a, HT, h);
        else m.box(x + sg * HT / 2, (a + b) / 2, z + mid, HT, b - a, len, h);
      }
    }
  }

  function trim(m, o, x, z, s, y0, y1, w, d, hex) {
    if (o === 'N') m.box(x + s, (y0 + y1) / 2, z, w, y1 - y0, d, hex);
    else m.box(x, (y0 + y1) / 2, z + s, d, y1 - y0, w, hex);
  }

  function buildEdges(c, m, view) {
    const Wd = W();
    const E = Wd.E, CS = Wd.CS;
    const T = Wd.WALL_T, H = Wd.WALL_H;
    const ox = c.cx * CS, oz = c.cz * CS;
    const TRIM = 0xe9e5da;
    for (const o of ['N', 'W']) {
      const arr = o === 'N' ? c.eN : c.eW;
      for (let z = 0; z < CS; z++) {
        for (let x = 0; x < CS; x++) {
          const e = arr[z * CS + x];
          if (!e) continue;
          const X = ox + x, Z = oz + z;
          // casillas a cada lado (A = norte/oeste, B = sur/este)
          const ax = o === 'N' ? X : X - 1, az = o === 'N' ? Z - 1 : Z;
          if (e === E.FENCE) { buildFence(m, o, X, Z, c); continue; }
          const owner = Wd.bldAt(X, Z) || Wd.bldAt(ax, az);
          const A = sideColor(ax, az, owner), Bc = sideColor(X, Z, owner);
          const ext = A.ext || Bc.ext;
          // Solo las paredes horizontales se alargan en las esquinas (evita parpadeos)
          let s0 = 0, s1 = 1;
          if (o === 'N') {
            const vert = (vx, vz) => { const q = Wd.eW(vx, vz); return q && q !== E.FENCE; };
            if (vert(X, Z - 1) || vert(X, Z)) s0 = -T / 2;
            if (vert(X + 1, Z - 1) || vert(X + 1, Z)) s1 = 1 + T / 2;
          }
          if (e === E.WALL) {
            wallPiece(m, o, X, Z, 0, H, A, Bc, s0, s1);
          } else if (e === E.DOOR || e === E.DOOR_OPEN || e === E.DOOR_BROKEN || e === E.ARCH) {
            const top = e === E.ARCH ? 2.2 : Wd.DOOR_H;
            wallPiece(m, o, X, Z, top, H, A, Bc, s0, s1);
            wallPiece(m, o, X, Z, 0, top, A, Bc, s0, 0.07);
            wallPiece(m, o, X, Z, 0, top, A, Bc, 0.93, s1);
            trim(m, o, X, Z, 0.5, top, top + 0.07, 0.94, T + 0.03, TRIM);
            trim(m, o, X, Z, 0.055, 0, top, 0.05, T + 0.03, TRIM);
            trim(m, o, X, Z, 0.945, 0, top, 0.05, T + 0.03, TRIM);
            if (e !== E.ARCH) view.doors.push(makeDoor(o, X, Z, e));
            if (ext && e !== E.ARCH) {
              // escalón de entrada
              const outA = A.ext;
              const s = outA ? -1 : 1;
              if (o === 'N') m.box(X + 0.5, 0.05, Z + s * 0.35, 1.2, 0.1, 0.55, 0x9d998f);
              else m.box(X + s * 0.35, 0.05, Z + 0.5, 0.55, 0.1, 1.2, 0x9d998f);
            }
          } else if (e === E.WIN || e === E.WIN_OPEN || e === E.WIN_BROKEN) {
            wallPiece(m, o, X, Z, 0, Wd.WIN_LO, A, Bc, s0, s1);
            wallPiece(m, o, X, Z, Wd.WIN_HI, H, A, Bc, s0, s1);
            wallPiece(m, o, X, Z, Wd.WIN_LO, Wd.WIN_HI, A, Bc, s0, 0.07);
            wallPiece(m, o, X, Z, Wd.WIN_LO, Wd.WIN_HI, A, Bc, 0.93, s1);
            trim(m, o, X, Z, 0.5, Wd.WIN_LO - 0.05, Wd.WIN_LO, 1.0, T + 0.12, TRIM);
            trim(m, o, X, Z, 0.5, Wd.WIN_HI, Wd.WIN_HI + 0.06, 0.96, T + 0.04, TRIM);
            trim(m, o, X, Z, 0.055, Wd.WIN_LO, Wd.WIN_HI, 0.05, T + 0.04, TRIM);
            trim(m, o, X, Z, 0.945, Wd.WIN_LO, Wd.WIN_HI, 0.05, T + 0.04, TRIM);
            view.windows.push({ o, x: X, z: Z });
          }
        }
      }
    }
  }

  function buildFence(m, o, X, Z, c) {
    const Wd = W();
    const hx = Wd.hash(c.cx, c.cz, 77) < 0.5 ? 0xe2ddd0 : 0x8a6c4c;
    const along = (s, y, w, h, d) => {
      if (o === 'N') m.box(X + s, y, Z, w, h, d, hx);
      else m.box(X, y, Z + s, d, h, w, hx);
    };
    along(0, 0.6, 0.1, 1.2, 0.1);                 // poste
    along(0.5, 0.35, 1.0, 0.07, 0.04);            // travesaños
    along(0.5, 0.85, 1.0, 0.07, 0.04);
    for (const s of [0.2, 0.4, 0.6, 0.8]) along(s, 0.55, 0.09, 1.05, 0.025);
  }

  function makeDoor(o, X, Z, e) {
    const Wd = W();
    // abre hacia dentro de la casa (o hacia B si ambos lados son interiores)
    const ax = o === 'N' ? X : X - 1, az = o === 'N' ? Z - 1 : Z;
    const inA = Wd.isIndoor(ax, az), inB = Wd.isIndoor(X, Z);
    const swing = (inA && !inB) ? -1 : 1;
    const E = Wd.E;
    const open = e === E.DOOR_OPEN ? 1 : 0;
    return { o, x: X, z: Z, swing, open, target: open, broken: e === E.DOOR_BROKEN };
  }

  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _y = new THREE.Vector3(0, 1, 0);

  function doorMatrix(d) {
    if (d.broken) return _m4.makeScale(0, 0, 0);
    let ang;
    if (d.o === 'N') { _p.set(d.x + 0.07, 0.04, d.z); ang = -Math.PI / 2 * d.open * d.swing; }
    else { _p.set(d.x, 0.04, d.z + 0.07); ang = -Math.PI / 2 + Math.PI / 2 * d.open * d.swing; }
    _q.setFromAxisAngle(_y, ang);
    _s.set(1, 1, 1);
    return _m4.compose(_p, _q, _s);
  }

  function windowMatrix(w, e) {
    const Wd = W(), E = Wd.E;
    if (e === E.WIN_BROKEN) return _m4.makeScale(0, 0, 0);
    const hh = Wd.WIN_HI - Wd.WIN_LO;
    const open = e === E.WIN_OPEN;
    const yc = open ? Wd.WIN_HI - hh * 0.25 : (Wd.WIN_LO + Wd.WIN_HI) / 2;
    _s.set(1, open ? 0.5 : 1, 1);
    if (w.o === 'N') { _p.set(w.x + 0.5, yc, w.z); _q.identity(); }
    else { _p.set(w.x, yc, w.z + 0.5); _q.setFromAxisAngle(_y, Math.PI / 2); }
    return _m4.compose(_p, _q, _s);
  }

  // ---------- Techos ----------
  function buildRoofs(c, m, roofM) {
    const Wd = W();
    const H = Wd.WALL_H;
    for (const b of c.buildings) {
      const x0 = b.x0, z0 = b.z0, x1 = b.x0 + b.w, z1 = b.z0 + b.h;
      // losa del techo (también es el cielorraso por dentro)
      m.box((x0 + x1) / 2, H + 0.07, (z0 + z1) / 2, b.w + 0.14, 0.14, b.h + 0.14, 0xe8e3d6);
      const base = H + 0.14;
      if (b.roof === 'flat') {
        roofM.box((x0 + x1) / 2, base + 0.02, (z0 + z1) / 2, b.w + 0.1, 0.04, b.h + 0.1, b.roofColor);
        const pc = U.shade(b.siding, 0.9);
        m.box((x0 + x1) / 2, base + 0.25, z0, b.w + 0.2, 0.5, 0.2, pc);
        m.box((x0 + x1) / 2, base + 0.25, z1, b.w + 0.2, 0.5, 0.2, pc);
        m.box(x0, base + 0.25, (z0 + z1) / 2, 0.2, 0.5, b.h, pc);
        m.box(x1, base + 0.25, (z0 + z1) / 2, 0.2, 0.5, b.h, pc);
        // cartel de color según el edificio
        const sign = { bomberos: 0xb23a2e, policia: 0x2f4f86, hospital: 0x2f8a5a }[b.kind];
        if (sign) {
          const f = b.bp.front, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
          // cartel con un símbolo sencillo: cruz (hospital), estrella (policía), franjas (bomberos)
          const panel = (px, pz, alongX) => {
            const W2 = (w, h, dx, dy, col, out) => {
              if (alongX) m.box(px + dx, H + 0.45 + dy, pz + out, w, h, 0.06, col);
              else m.box(px + out, H + 0.45 + dy, pz + dx, 0.06, h, w, col);
            };
            W2(2.4, 0.5, 0, 0, sign, 0);
            const o = (f === 'S' || f === 'E') ? 0.035 : -0.035;
            if (b.kind === 'hospital') { W2(0.34, 0.1, 0, 0, 0xf4f4f0, o); W2(0.1, 0.34, 0, 0, 0xf4f4f0, o); }
            else if (b.kind === 'policia') { W2(0.22, 0.22, 0, 0, 0xe8c45a, o); W2(1.6, 0.05, 0, -0.17, 0xe8e6de, o); }
            else { W2(2.2, 0.06, 0, 0.12, 0xf0e6d0, o); W2(2.2, 0.06, 0, -0.12, 0xf0e6d0, o); }
          };
          if (f === 'S') panel(xc, z1 + 0.1, true);
          else if (f === 'N') panel(xc, z0 - 0.1, true);
          else if (f === 'E') panel(x1 + 0.1, zc, false);
          else panel(x0 - 0.1, zc, false);
        }
        continue;
      }
      const ov = 0.4;
      const alongX = b.w >= b.h;
      const span = alongX ? b.h : b.w;
      const rh = span * 0.28 + 0.4;
      const col = b.roofColor;
      if (alongX) {
        const zc = (z0 + z1) / 2;
        const A = [x0 - ov, base - 0.15, z0 - ov], Bq = [x1 + ov, base - 0.15, z0 - ov];
        const C = [x1 + ov, base + rh, zc], D = [x0 - ov, base + rh, zc];
        roofM.quad(A, D, C, Bq, col);
        const A2 = [x0 - ov, base - 0.15, z1 + ov], B2 = [x1 + ov, base - 0.15, z1 + ov];
        roofM.quad(A2, B2, C, D, U.shade(col, 0.92));
        m.tri([x0, base, z0], [x0, base, z1], [x0, base + rh - 0.05, zc], b.siding);
        m.tri([x1, base, z1], [x1, base, z0], [x1, base + rh - 0.05, zc], b.siding);
      } else {
        const xc = (x0 + x1) / 2;
        const A = [x0 - ov, base - 0.15, z0 - ov], Bq = [x0 - ov, base - 0.15, z1 + ov];
        const C = [xc, base + rh, z1 + ov], D = [xc, base + rh, z0 - ov];
        roofM.quad(A, Bq, C, D, col);
        const A2 = [x1 + ov, base - 0.15, z0 - ov], B2 = [x1 + ov, base - 0.15, z1 + ov];
        roofM.quad(A2, D, C, B2, U.shade(col, 0.92));
        m.tri([x0, base, z1], [x1, base, z1], [xc, base + rh - 0.05, z1], b.siding);
        m.tri([x1, base, z0], [x0, base, z0], [xc, base + rh - 0.05, z0], b.siding);
      }
      // chimenea en algunas casas
      if (b.kind === 'casa' && Wd.hash(b.x0, b.z0, 5) < 0.5) {
        const cxp = x0 + b.w * 0.25, czp = z0 + b.h * 0.3;
        m.box(cxp, base + rh * 0.6, czp, 0.6, rh * 1.3 + 0.6, 0.6, 0x7d4b3a);
      }
    }
  }

  // ---------- Construcción de un chunk ----------
  function build(c) {
    const Wd = W();
    const O = Wd.O, CS = Wd.CS;
    const group = new THREE.Group();
    const view = { group, doors: [], windows: [], doorMesh: null, glassMesh: null, fixtures: null, fixtureRooms: [], items: new Map() };
    c.view = view;

    buildGround(c, group);

    const m = new G.Mesher();
    const roofM = new G.Mesher();
    buildEdges(c, m, view);
    buildRoofs(c, m, roofM);

    // Interruptores
    for (const b of c.buildings) {
      for (const r of b.rooms) {
        if (!r.sw) continue;
        const p = switchPoint(r);
        if (p.o === 'N') m.box(p.x, 1.25, p.z, 0.09, 0.13, 0.025, 0xf2efe6);
        else m.box(p.x, 1.25, p.z, 0.025, 0.13, 0.09, 0xf2efe6);
      }
    }

    // Farolas, arbustos y árboles
    const ox = c.cx * CS, oz = c.cz * CS;
    const trees = [], pines = [], heads = [];
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const o = c.obj[z * CS + x];
        if (!o) continue;
        const X = ox + x + 0.5, Z = oz + z + 0.5;
        if (o === O.LAMP) {
          let dx = 0, dz = 0;
          if (Wd.ground(ox + x, oz + z + 1) === Wd.F.ROAD) dz = 1;
          else if (Wd.ground(ox + x, oz + z - 1) === Wd.F.ROAD) dz = -1;
          else if (Wd.ground(ox + x + 1, oz + z) === Wd.F.ROAD) dx = 1;
          else dx = -1;
          m.cyl(X, 2.3, Z, 0.08, 0.05, 4.6, 0x3e4245, 7);
          m.box(X + dx * 0.45, 4.55, Z + dz * 0.45, dx ? 0.9 : 0.06, 0.06, dz ? 0.9 : 0.06, 0x3e4245);
          heads.push([X + dx * 0.85, 4.5, Z + dz * 0.85, dx !== 0]);
        } else if (o === O.BUSH) {
          const h = Wd.hash(ox + x, oz + z, 31);
          const s = 0.45 + h * 0.3;
          m.sphere(X, s * 0.8, Z, s, s * 0.85, s, 0x4d7536, 1);
          m.sphere(X + 0.3, s * 0.6, Z + 0.15, s * 0.7, s * 0.65, s * 0.7, 0x567f3c, 1);
        } else if (o === O.TREE) trees.push([X, Z]);
        else if (o === O.PINE) pines.push([X, Z]);
      }
    }

    const staticMesh = new THREE.Mesh(m.build(), R.static);
    staticMesh.castShadow = true;
    staticMesh.receiveShadow = true;
    group.add(staticMesh);
    if (roofM.count) {
      const roofMesh = new THREE.Mesh(roofM.build(), R.roof);
      roofMesh.castShadow = true;
      roofMesh.receiveShadow = true;
      group.add(roofMesh);
    }

    // Árboles instanciados
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const all = trees.concat(pines);
    if (all.length) {
      const trunks = new THREE.InstancedMesh(R.trunkGeo, R.trunk, all.length);
      trunks.castShadow = true; trunks.receiveShadow = true;
      let ti = 0;
      const crowns = trees.length ? new THREE.InstancedMesh(R.crownGeo, R.tree, trees.length) : null;
      const pineM = pines.length ? new THREE.InstancedMesh(R.pineGeo, R.tree, pines.length) : null;
      trees.forEach(([X, Z], i) => {
        const h1 = Wd.hash(Math.floor(X), Math.floor(Z), 41), h2 = Wd.hash(Math.floor(X), Math.floor(Z), 42);
        const th = 3.0 + h1 * 1.4, tr = 0.2 + h2 * 0.08, s = 1.15 + h2 * 0.5;
        dummy.position.set(X, 0, Z); dummy.rotation.set(0, h1 * 6.28, 0); dummy.scale.set(tr, th + 0.8, tr);
        dummy.updateMatrix(); trunks.setMatrixAt(ti, dummy.matrix);
        trunks.setColorAt(ti++, color.setHex(0x5b4532).convertSRGBToLinear());
        dummy.position.set(X, th + 0.9 * s, Z); dummy.scale.set(s, s, s);
        dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
        const g = 0.85 + h1 * 0.3;
        crowns.setColorAt(i, color.setRGB(g, g, 0.9 + h2 * 0.2));
      });
      pines.forEach(([X, Z], i) => {
        const h1 = Wd.hash(Math.floor(X), Math.floor(Z), 43), h2 = Wd.hash(Math.floor(X), Math.floor(Z), 44);
        const s = 1.1 + h1 * 0.5;
        dummy.position.set(X, 0, Z); dummy.rotation.set(0, h2 * 6.28, 0); dummy.scale.set(0.18 * s, 2.0 * s, 0.18 * s);
        dummy.updateMatrix(); trunks.setMatrixAt(ti, dummy.matrix);
        trunks.setColorAt(ti++, color.setHex(0x4a3828).convertSRGBToLinear());
        dummy.position.set(X, 1.3 * s, Z); dummy.scale.set(s, s * (1.1 + h2 * 0.3), s);
        dummy.updateMatrix(); pineM.setMatrixAt(i, dummy.matrix);
        const g = 0.85 + h1 * 0.3;
        pineM.setColorAt(i, color.setRGB(g, g, g));
      });
      for (const im of [trunks, crowns, pineM]) {
        if (!im) continue;
        im.castShadow = true; im.receiveShadow = true;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.frustumCulled = false;
        group.add(im);
      }
    }

    // Cabezas de farola (siempre algo encendidas)
    if (heads.length) {
      const hm = new THREE.InstancedMesh(R.lampHeadGeo, R.fixture, heads.length);
      heads.forEach((h, i) => {
        dummy.position.set(h[0], h[1], h[2]); dummy.rotation.set(0, h[3] ? 0 : Math.PI / 2, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); hm.setMatrixAt(i, dummy.matrix);
        hm.setColorAt(i, color.setHex(0xffe2a8));
      });
      hm.frustumCulled = false;
      group.add(hm);
    }

    // Puertas
    if (view.doors.length) {
      const dm = new THREE.InstancedMesh(R.doorGeo, R.static, view.doors.length);
      view.doors.forEach((d, i) => dm.setMatrixAt(i, doorMatrix(d)));
      dm.castShadow = true; dm.receiveShadow = true; dm.frustumCulled = false;
      view.doorMesh = dm;
      group.add(dm);
    }
    // Vidrios
    if (view.windows.length) {
      const gm = new THREE.InstancedMesh(R.glassGeo, R.glass, view.windows.length);
      view.windows.forEach((w, i) => gm.setMatrixAt(i, windowMatrix(w, Wd.edgeGet(w))));
      gm.frustumCulled = false;
      gm.renderOrder = 2;
      view.glassMesh = gm;
      group.add(gm);
    }
    // Lámparas del techo
    const rooms = [];
    for (const b of c.buildings) for (const r of b.rooms) rooms.push(r);
    if (rooms.length) {
      const fm = new THREE.InstancedMesh(R.fixtureGeo, R.fixture, rooms.length);
      rooms.forEach((r, i) => {
        dummy.position.set(r.light.x, Wd.WALL_H - 0.005, r.light.z);
        dummy.rotation.set(Math.PI, 0, 0); dummy.scale.set(1, 0.45, 1);
        dummy.updateMatrix(); fm.setMatrixAt(i, dummy.matrix);
        fm.setColorAt(i, fixtureColor(r));
      });
      fm.frustumCulled = false;
      view.fixtures = fm;
      view.fixtureRooms = rooms;
      group.add(fm);
    }

    // Armas en el suelo
    for (const it of c.items) itemAdded(c, it);

    scene.add(group);
  }

  function fixtureColor(r) {
    return new THREE.Color(r.on ? 0xfff3d6 : 0x77746c);
  }

  function dispose(c) {
    const v = c.view;
    if (!v) return;
    scene.remove(v.group);
    v.group.traverse((o) => {
      if (o.isInstancedMesh) { o.dispose && o.dispose(); return; }
      if (o.isMesh && o.geometry && !o.userData.shared) o.geometry.dispose();
    });
    c.view = null;
  }

  // ---------- Cambios ----------
  function edgeChanged(c, ref, old, v) {
    const view = c.view;
    const E = W().E;
    const d = view.doors.find((q) => q.o === ref.o && q.x === ref.x && q.z === ref.z);
    if (d) {
      d.broken = v === E.DOOR_BROKEN;
      d.target = v === E.DOOR_OPEN ? 1 : 0;
      if (d.broken) d.open = 0;
      if (animDoors.indexOf(d) < 0) { d.chunk = c; animDoors.push(d); }
      view.doorMesh.setMatrixAt(view.doors.indexOf(d), doorMatrix(d));
      view.doorMesh.instanceMatrix.needsUpdate = true;
    }
    const wi = view.windows.findIndex((q) => q.o === ref.o && q.x === ref.x && q.z === ref.z);
    if (wi >= 0) {
      view.glassMesh.setMatrixAt(wi, windowMatrix(view.windows[wi], v));
      view.glassMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function lightChanged(c, room) {
    const v = c.view;
    const i = v.fixtureRooms.indexOf(room);
    if (i >= 0) {
      v.fixtures.setColorAt(i, fixtureColor(room));
      v.fixtures.instanceColor.needsUpdate = true;
    }
    lightTimer = 0;
  }

  function itemAdded(c, it) {
    const v = c.view;
    if (!v) return;
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(G.Models.weaponGeometry(it.id), R.item);
    mesh.userData.shared = true;
    mesh.rotation.set(Math.PI / 2, 0, 0);
    mesh.castShadow = true;
    g.add(mesh);
    const ring = new THREE.Mesh(R.ringGeo, R.itemRing);
    ring.userData.shared = true;
    ring.position.set(0, 0.012, 0);
    g.add(ring);
    g.position.set(it.x, W().groundY(it.x, it.z) + 0.035, it.z);
    g.rotation.y = it.rot;
    // centrar el arma sobre el anillo
    const len = G.Weapons.get(it.id).len || 0.8;
    mesh.position.set(0, 0.02, -len / 2);
    v.group.add(g);
    v.items.set(it, g);
  }

  function itemRemoved(c, it) {
    const v = c.view;
    const g = v && v.items.get(it);
    if (!g) return;
    v.group.remove(g);
    v.items.delete(it);
  }

  // Punto donde está el interruptor de una habitación
  function switchPoint(r) {
    const s = r.sw;
    const off = W().WALL_T / 2 + 0.013;
    if (s.dir === 'N') return { o: 'N', x: s.x + 0.5, z: s.z + off, nx: 0, nz: 1 };
    if (s.dir === 'S') return { o: 'N', x: s.x + 0.5, z: s.z + 1 - off, nx: 0, nz: -1 };
    if (s.dir === 'W') return { o: 'W', x: s.x + off, z: s.z + 0.5, nx: 1, nz: 0 };
    return { o: 'W', x: s.x + 1 - off, z: s.z + 0.5, nx: -1, nz: 0 };
  }

  // ---------- Actualización por fotograma ----------
  const cand = [];
  function update(dt, px, pz, chunks) {
    // Animación de puertas
    for (let i = animDoors.length - 1; i >= 0; i--) {
      const d = animDoors[i];
      const v = d.chunk.view;
      if (!v) { animDoors.splice(i, 1); continue; }
      const step = dt * 4;
      if (Math.abs(d.open - d.target) <= step) { d.open = d.target; animDoors.splice(i, 1); }
      else d.open += Math.sign(d.target - d.open) * step;
      v.doorMesh.setMatrixAt(v.doors.indexOf(d), doorMatrix(d));
      v.doorMesh.instanceMatrix.needsUpdate = true;
    }
    // Luces: las 4 habitaciones encendidas más cercanas
    lightTimer -= dt;
    if (lightTimer > 0) return;
    lightTimer = 0.25;
    cand.length = 0;
    chunks.forEach((c) => {
      if (!c.view) return;
      for (const b of c.buildings) {
        for (const r of b.rooms) {
          if (!r.on) continue;
          const d = Math.hypot(r.light.x - px, r.light.z - pz);
          if (d < 26) cand.push([d, r]);
        }
      }
    });
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < lightPool.length; i++) {
      const l = lightPool[i];
      const cnd = cand[i];
      if (cnd) {
        l.position.set(cnd[1].light.x, cnd[1].light.y - 0.3, cnd[1].light.z);
        l.intensity = 1.5;
      } else {
        l.intensity = 0;
        l.position.set(px, -50, pz);
      }
    }
  }

  G.WorldView = { init, build, dispose, update, edgeChanged, lightChanged, itemAdded, itemRemoved, switchPoint };
})(window.Game = window.Game || {});
