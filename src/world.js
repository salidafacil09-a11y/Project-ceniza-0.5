(function (G) {
  'use strict';

  // Mundo infinito por chunks de 32x32 casillas (1 casilla = 1 metro).
  //
  // Las paredes son FINAS y van en las aristas entre casillas (como en el original):
  //   eN[casilla] = arista norte de la casilla, eW[casilla] = arista oeste.
  // Los datos de cada chunk se generan una vez y se conservan siempre (también los
  // cambios: puertas abiertas o rotas, luces, objetos recogidos). Los modelos 3D
  // solo existen cerca del jugador.

  const B = G.Buildings;
  const E = B.E, F = B.F;
  const U = G.Util;

  const CS = 32, SHIFT = 5, MASK = 31;
  const WALL_H = 2.7, DOOR_H = 2.1, WIN_LO = 0.9, WIN_HI = 2.05;
  const WALL_T = 0.12, HT = WALL_T / 2;
  const FENCE_H = 1.15;
  const O = { NONE: 0, TREE: 1, PINE: 2, LAMP: 3, BUSH: 4 };

  const DATA_RADIUS = 2;
  const MESH_RADIUS = 1;
  const KEEP_RADIUS = 2;

  let SEED = 1337;
  let scene = null;
  let R = null;              // recursos compartidos (materiales, geometrías)
  const chunks = new Map();
  const buildQueue = [];
  let lastCX = NaN, lastCZ = NaN, lastChunk = null;
  let lastPCX = NaN, lastPCZ = NaN;
  const animDoors = [];
  let spawnPoint = { x: 16.5, z: 16.5 };
  const listeners = [];      // avisos de ruido al romper puertas o ventanas

  // ---------- Aleatoriedad determinista ----------
  function hash(a, b, salt) {
    let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) +
            Math.imul(salt | 0, 1442695041) + Math.imul(SEED | 0, 1103515245);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }

  function vnoise(x, z, salt) {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = hash(x0, z0, salt), b = hash(x0 + 1, z0, salt);
    const c = hash(x0, z0 + 1, salt), d = hash(x0 + 1, z0 + 1, salt);
    const top = a + (b - a) * sx, bot = c + (d - c) * sx;
    return top + (bot - top) * sz;
  }

  function chunkSeed(cx, cz) {
    return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ Math.imul(SEED | 0, 83492791)) >>> 0;
  }

  function isTown(cx, cz) {
    if (cx === 0 && cz === 0) return true;
    return vnoise(cx / 2.2 + 0.5, cz / 2.2 + 0.5, 3) > 0.6;
  }
  function hEdge(cx, cz) { return isTown(cx, cz) || isTown(cx + 1, cz) || hash(cx, cz, 11) < 0.3; }
  function vEdge(cx, cz) { return isTown(cx, cz) || isTown(cx, cz + 1) || hash(cx, cz, 12) < 0.3; }

  // ---------- Generación ----------
  function generateChunk(cx, cz) {
    const N = CS * CS;
    const c = {
      cx, cz,
      ground: new Uint8Array(N), obj: new Uint8Array(N),
      eN: new Uint8Array(N), eW: new Uint8Array(N),
      bld: new Uint8Array(N), rm: new Uint8Array(N),
      buildings: [], items: [], spawns: [],
      sleepers: [], corpses: [], populated: false,
      group: null, queued: false, view: null,
      edgeHP: new Map(), town: isTown(cx, cz)
    };
    const rng = U.mulberry32(chunkSeed(cx, cz));
    const roads = {
      e: hEdge(cx, cz), w: hEdge(cx - 1, cz),
      s: vEdge(cx, cz), n: vEdge(cx, cz - 1)
    };
    roads.any = roads.e || roads.w || roads.s || roads.n;
    c.roads = roads;
    const idx = (x, z) => z * CS + x;
    const inb = (x, z) => x >= 0 && z >= 0 && x < CS && z < CS;

    // Carreteras
    if (roads.any) {
      for (let r = 15; r <= 16; r++) {
        c.ground[idx(15, r)] = F.ROAD; c.ground[idx(16, r)] = F.ROAD;
        for (let i = 0; i < CS; i++) {
          if (roads.w && i <= 14) c.ground[idx(i, r)] = F.ROAD;
          if (roads.e && i >= 17) c.ground[idx(i, r)] = F.ROAD;
          if (roads.n && i <= 14) c.ground[idx(r, i)] = F.ROAD;
          if (roads.s && i >= 17) c.ground[idx(r, i)] = F.ROAD;
        }
      }
    }
    // Aceras en pueblos
    if (c.town) {
      for (let z = 0; z < CS; z++) {
        for (let x = 0; x < CS; x++) {
          if (c.ground[idx(x, z)] !== F.GRASS) continue;
          let near = false;
          for (let dz = -1; dz <= 1 && !near; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (inb(x + dx, z + dz) && c.ground[idx(x + dx, z + dz)] === F.ROAD) { near = true; break; }
            }
          }
          if (near) c.ground[idx(x, z)] = F.SIDEWALK;
        }
      }
    }

    // ----- Edificios -----
    const lots = [];
    // Lotes de 13x13 en cada cuadrante, con la calle en dos lados
    for (const qx of [0, 1]) {
      for (const qz of [0, 1]) {
        const fronts = [];
        if (qz === 0 && (qx === 0 ? roads.w : roads.e)) fronts.push('S');
        if (qz === 1 && (qx === 0 ? roads.w : roads.e)) fronts.push('N');
        if (qx === 0 && (qz === 0 ? roads.n : roads.s)) fronts.push('E');
        if (qx === 1 && (qz === 0 ? roads.n : roads.s)) fronts.push('W');
        lots.push({ x0: qx ? 18 : 1, z0: qz ? 18 : 1, qx, qz, fronts });
      }
    }

    const placeBuilding = (lot, id, front, opts) => {
      const bp = B.make(id, rng, front);
      const yard = 1 + Math.floor(rng() * 2);
      const free = (span, size) => Math.max(0, span - size);
      let ox, oz;
      const W = bp.w, H = bp.h;
      // El frente queda a "yard" casillas del borde del lote que da a la calle
      if (front === 'S') { oz = lot.z0 + 13 - yard - H; ox = lot.x0 + Math.floor(rng() * (free(13, W) + 1)); }
      else if (front === 'N') { oz = lot.z0 + yard; ox = lot.x0 + Math.floor(rng() * (free(13, W) + 1)); }
      else if (front === 'E') { ox = lot.x0 + 13 - yard - W; oz = lot.z0 + Math.floor(rng() * (free(13, H) + 1)); }
      else { ox = lot.x0 + yard; oz = lot.z0 + Math.floor(rng() * (free(13, H) + 1)); }
      ox = U.clamp(ox, lot.x0, lot.x0 + 13 - W);
      oz = U.clamp(oz, lot.z0, lot.z0 + 13 - H);
      if (opts && opts.center) {
        // fuera del pueblo: posición libre en el lote
        ox = lot.x0 + Math.floor(rng() * (free(13, W) + 1));
        oz = lot.z0 + Math.floor(rng() * (free(13, H) + 1));
      }
      const bi = c.buildings.length;
      const b = {
        id, kind: bp.def.kind, bp, ox, oz,
        x0: cx * CS + ox, z0: cz * CS + oz, w: W, h: H,
        roof: bp.def.roof, siding: bp.siding, roofColor: bp.roofColor,
        rooms: []
      };
      c.buildings.push(b);
      for (let z = 0; z < H; z++) {
        for (let x = 0; x < W; x++) {
          const r = bp.tiles[z * W + x];
          if (r < 0) continue;
          const i = idx(ox + x, oz + z);
          c.ground[i] = bp.rooms[r].floor;
          c.bld[i] = bi + 1;
          c.rm[i] = r + 1;
        }
      }
      for (let z = 0; z <= H; z++) {
        for (let x = 0; x < W; x++) {
          const v = bp.hE[z * W + x];
          if (v && inb(ox + x, oz + z)) c.eN[idx(ox + x, oz + z)] = v;
        }
      }
      for (let z = 0; z < H; z++) {
        for (let x = 0; x <= W; x++) {
          const v = bp.vE[z * (W + 1) + x];
          if (v && inb(ox + x, oz + z)) c.eW[idx(ox + x, oz + z)] = v;
        }
      }
      for (const r of bp.rooms) {
        b.rooms.push({
          type: r.type, name: r.name, wall: r.wall, b,
          light: { x: cx * CS + ox + r.cx, y: WALL_H - 0.12, z: cz * CS + oz + r.cz },
          on: rng() < 0.4,
          sw: r.sw ? { x: cx * CS + ox + r.sw.x, z: cz * CS + oz + r.sw.z, dir: r.sw.dir } : null
        });
      }
      lot.used = { ox, oz, W, H, b };
      return b;
    };

    if (c.town) {
      const specialQ = rng() < 0.07 ? Math.floor(rng() * 4) : -1;
      const specialId = U.pick(rng, B.RARE);
      lots.forEach((lot, qi) => {
        if (!lot.fronts.length) return;
        const spawnLot = cx === 0 && cz === 0 && qi === 0;
        if (!spawnLot && rng() > 0.88) return;
        const front = spawnLot ? 'S' : U.pick(rng, lot.fronts);
        const id = spawnLot ? 'casa1' : (qi === specialQ ? specialId : U.pick(rng, B.COMMON));
        placeBuilding(lot, id, front);
      });
    } else if (roads.any && rng() < 0.25) {
      const cand = lots.filter((l) => l.fronts.length);
      const lot = U.pick(rng, cand);
      placeBuilding(lot, rng() < 0.6 ? 'cabana' : 'casa4', U.pick(rng, lot.fronts));
    } else if (!roads.any && rng() < 0.12) {
      const lot = U.pick(rng, lots);
      placeBuilding(lot, 'cabana', U.pick(rng, ['N', 'S', 'E', 'W']), { center: true });
    }

    // ----- Vallas alrededor de los patios (no en el frente) -----
    if (c.town) {
      for (const lot of lots) {
        if (!lot.used || lot.used.b.kind !== 'casa' || rng() > 0.55) continue;
        const front = lot.used.b.bp.front;
        const x0 = lot.x0, z0 = lot.z0, x1 = lot.x0 + 13, z1 = lot.z0 + 13;
        const gate = Math.floor(rng() * 13);
        const fence = (o, x, z) => {
          const i = idx(x, z);
          const arr = o === 'N' ? c.eN : c.eW;
          if (arr[i] === E.NONE && c.bld[i] === 0) arr[i] = E.FENCE;
        };
        for (let k = 0; k < 13; k++) {
          if (front !== 'N' && k !== gate) fence('N', x0 + k, z0);
          if (front !== 'S' && k !== gate) fence('N', x0 + k, z1);
          if (front !== 'W' && k !== gate) fence('W', x0, z0 + k);
          if (front !== 'E' && k !== gate) fence('W', x1, z0 + k);
        }
      }
    }

    // ----- Farolas -----
    if (roads.any) {
      const lamp = (x, z) => {
        if (!inb(x, z)) return;
        const i = idx(x, z);
        const g = c.ground[i];
        if (c.bld[i] || g === F.ROAD) return;
        c.obj[i] = O.LAMP;
      };
      if (c.town) {
        for (const k of [4, 11, 20, 27]) {
          if ((k < 15 ? roads.w : roads.e)) lamp(k, (k % 2) ? 14 : 17);
          if ((k < 15 ? roads.n : roads.s)) lamp((k % 2) ? 17 : 14, k);
        }
      } else if (rng() < 0.35) {
        if (roads.w || roads.e) lamp(roads.w ? 6 : 25, 14);
        else lamp(14, roads.n ? 6 : 25);
      }
    }

    // ----- Árboles y arbustos -----
    const nearBuildingOrRoad = (x, z, rb, rr) => {
      const r = Math.max(rb, rr);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, zz = z + dz;
          if (!inb(xx, zz)) continue;
          const i = idx(xx, zz);
          const d = Math.max(Math.abs(dx), Math.abs(dz));
          if (c.bld[i] && d <= rb) return true;
          const g = c.ground[i];
          if ((g === F.ROAD || g === F.SIDEWALK) && d <= rr) return true;
          if (c.obj[i] === O.LAMP && d <= 1) return true;
          if (d <= 1 && (c.eN[i] || c.eW[i])) return true;
        }
      }
      return false;
    };
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const i = idx(x, z);
        if (c.ground[i] !== F.GRASS || c.obj[i]) continue;
        let p;
        const n = vnoise((cx * CS + x) / 18, (cz * CS + z) / 18, 5);
        if (c.town) p = 0.012;
        else p = n < 0.42 ? 0.01 : Math.min(0.17, 0.02 + (n - 0.42) * 0.55);
        const r = rng();
        if (r < p) {
          if (nearBuildingOrRoad(x, z, 3, 1)) continue;
          // no dos árboles pegados
          let crowd = false;
          for (let dz = -1; dz <= 0 && !crowd; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (inb(x + dx, z + dz) && (c.obj[idx(x + dx, z + dz)] === O.TREE || c.obj[idx(x + dx, z + dz)] === O.PINE)) { crowd = true; break; }
            }
          }
          if (crowd) continue;
          const pineBias = vnoise((cx * CS + x) / 40, (cz * CS + z) / 40, 9);
          c.obj[i] = rng() < pineBias ? O.PINE : O.TREE;
        } else if (r < p + (c.town ? 0.02 : 0.03)) {
          if (!nearBuildingOrRoad(x, z, 0, 0)) c.obj[i] = O.BUSH;
        }
      }
    }

    // ----- Armas en los edificios -----
    for (let bi = 0; bi < c.buildings.length; bi++) {
      const b = c.buildings[bi];
      b.rooms.forEach((room, ri) => {
        const loot = G.Weapons.lootFor(room.type, b.kind, rng);
        if (!loot.length) return;
        const tiles = [];
        for (let z = 0; z < b.h; z++) {
          for (let x = 0; x < b.w; x++) {
            if (b.bp.tiles[z * b.w + x] === ri) tiles.push([b.ox + x, b.oz + z]);
          }
        }
        for (const id of loot) {
          const t = U.pick(rng, tiles);
          c.items.push({
            x: cx * CS + t[0] + 0.25 + rng() * 0.5,
            z: cz * CS + t[1] + 0.25 + rng() * 0.5,
            rot: rng() * Math.PI * 2, id, cond: 0.5 + rng() * 0.5
          });
        }
      });
    }

    // ----- Punto de inicio: dentro de la casa del chunk (0, 0) -----
    if (cx === 0 && cz === 0 && c.buildings.length) {
      const b = c.buildings[0];
      const ri = b.rooms.findIndex((r) => r.type === 'sala');
      const r = b.rooms[ri >= 0 ? ri : 0];
      spawnPoint = { x: r.light.x, z: r.light.z };
      r.on = true;
      // un arma garantizada cerca para empezar
      c.items.push({ x: r.light.x + 0.9, z: r.light.z - 0.6, rot: 0.6, id: 'palanca', cond: 0.8 });
      if (location.search.indexOf('armas') !== -1) {
        // modo de prueba: todas las armas alrededor del inicio
        G.Weapons.LIST.forEach((w, k) => {
          const a = (k / G.Weapons.LIST.length) * Math.PI * 2;
          c.items.push({ x: 16 + Math.cos(a) * 2.2, z: 18.6 + Math.sin(a) * 0.8 + (k % 2) * 0.5, rot: a, id: w.id, cond: 1 });
        });
      }
    }

    // ----- Zombis -----
    const addSpawn = (x, z) => {
      const i = idx(Math.floor(x - cx * CS), Math.floor(z - cz * CS));
      if (c.obj[i] === O.TREE || c.obj[i] === O.PINE || c.obj[i] === O.LAMP) return;
      c.spawns.push({ x, z });
    };
    const outdoor = c.town ? 3 + Math.floor(rng() * 3) : (rng() < 0.5 ? 1 : 0);
    for (let k = 0; k < outdoor; k++) {
      for (let t = 0; t < 20; t++) {
        const x = 1 + Math.floor(rng() * (CS - 2)), z = 1 + Math.floor(rng() * (CS - 2));
        const i = idx(x, z);
        if (c.bld[i] || c.obj[i]) continue;
        addSpawn(cx * CS + x + 0.5, cz * CS + z + 0.5);
        break;
      }
    }
    for (const b of c.buildings) {
      const n = b.kind === 'casa' ? (rng() < 0.45 ? 1 : 0) : (b.kind === 'cabana' ? 0 : 3 + Math.floor(rng() * 3));
      for (let k = 0; k < n; k++) {
        const r = U.pick(rng, b.rooms);
        addSpawn(r.light.x + (rng() - 0.5) * 0.6, r.light.z + (rng() - 0.5) * 0.6);
      }
    }

    return c;
  }

  // ---------- Acceso ----------
  function chunkAt(cx, cz) {
    if (cx === lastCX && cz === lastCZ) return lastChunk;
    const key = ((cx & 0xffff) << 16) | (cz & 0xffff);
    let c = chunks.get(key);
    if (!c) { c = generateChunk(cx, cz); chunks.set(key, c); }
    lastCX = cx; lastCZ = cz; lastChunk = c;
    return c;
  }
  const li = (x, z) => ((z & MASK) << SHIFT) | (x & MASK);
  const ch = (x, z) => chunkAt(x >> SHIFT, z >> SHIFT);

  function ground(x, z) { return ch(x, z).ground[li(x, z)]; }
  function obj(x, z) { return ch(x, z).obj[li(x, z)]; }
  function eN(x, z) { return ch(x, z).eN[li(x, z)]; }
  function eW(x, z) { return ch(x, z).eW[li(x, z)]; }
  function bldAt(x, z) {
    const c = ch(x, z);
    const b = c.bld[li(x, z)];
    return b ? c.buildings[b - 1] : null;
  }
  function roomAt(x, z) {
    const c = ch(x, z);
    const i = li(x, z);
    return c.bld[i] ? c.buildings[c.bld[i] - 1].rooms[c.rm[i] - 1] : null;
  }
  function isIndoor(x, z) { return ch(x, z).bld[li(x, z)] !== 0; }
  function solidObj(o) { return o === O.TREE || o === O.PINE || o === O.LAMP; }

  // Altura del suelo (aceras y suelos interiores un poco más altos)
  function groundY(x, z) {
    const g = ground(Math.floor(x), Math.floor(z));
    if (g === F.SIDEWALK) return 0.1;
    if (g >= 10) return 0.04;
    return 0;
  }

  // Arista entre dos casillas vecinas (ortogonales)
  function edgeBetween(x0, z0, x1, z1) {
    if (x1 === x0 + 1) return eW(x1, z0);
    if (x1 === x0 - 1) return eW(x0, z0);
    if (z1 === z0 + 1) return eN(x0, z1);
    return eN(x0, z0);
  }
  function edgeRefBetween(x0, z0, x1, z1) {
    if (x1 === x0 + 1) return { o: 'W', x: x1, z: z0 };
    if (x1 === x0 - 1) return { o: 'W', x: x0, z: z0 };
    if (z1 === z0 + 1) return { o: 'N', x: x0, z: z1 };
    return { o: 'N', x: x0, z: z0 };
  }
  function edgeGet(ref) { return ref.o === 'N' ? eN(ref.x, ref.z) : eW(ref.x, ref.z); }

  // ---------- Colisiones ----------
  function circleBlocked(x, z, r) {
    // Objetos sólidos (troncos, farolas)
    const x0 = Math.floor(x - r - 0.5), x1 = Math.floor(x + r + 0.5);
    const z0 = Math.floor(z - r - 0.5), z1 = Math.floor(z + r + 0.5);
    for (let tz = z0; tz <= z1; tz++) {
      for (let tx = x0; tx <= x1; tx++) {
        const o = obj(tx, tz);
        if (!solidObj(o)) continue;
        const rr = o === O.LAMP ? 0.12 : 0.3;
        const dx = tx + 0.5 - x, dz = tz + 0.5 - z;
        if (dx * dx + dz * dz < (r + rr) * (r + rr)) return true;
      }
    }
    const rr = (r + HT) * (r + HT);
    // Aristas horizontales (líneas z = L)
    const lz0 = Math.ceil(z - r - HT), lz1 = Math.floor(z + r + HT);
    const tx0 = Math.floor(x - r - HT), tx1 = Math.floor(x + r + HT);
    for (let L = lz0; L <= lz1; L++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!B.blocksWalk(eN(tx, L))) continue;
        const px = U.clamp(x, tx - HT, tx + 1 + HT) - x, pz = L - z;
        if (px * px + pz * pz < rr) return true;
      }
    }
    // Aristas verticales (líneas x = L)
    const lx0 = Math.ceil(x - r - HT), lx1 = Math.floor(x + r + HT);
    const tz0 = Math.floor(z - r - HT), tz1 = Math.floor(z + r + HT);
    for (let L = lx0; L <= lx1; L++) {
      for (let tz = tz0; tz <= tz1; tz++) {
        if (!B.blocksWalk(eW(L, tz))) continue;
        const px = L - x, pz = U.clamp(z, tz - HT, tz + 1 + HT) - z;
        if (px * px + pz * pz < rr) return true;
      }
    }
    return false;
  }

  function move(pos, dx, dz, r) {
    if (!circleBlocked(pos.x + dx, pos.z + dz, r)) { pos.x += dx; pos.z += dz; return; }
    if (!circleBlocked(pos.x + dx, pos.z, r)) pos.x += dx;
    if (!circleBlocked(pos.x, pos.z + dz, r)) pos.z += dz;
  }

  // Recorre las aristas que cruza un segmento; test(arista) == true detiene
  function lineBlocked(x0, z0, x1, z1, test) {
    let tx = Math.floor(x0), tz = Math.floor(z0);
    const ex = Math.floor(x1), ez = Math.floor(z1);
    const dx = x1 - x0, dz = z1 - z0;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    let tMaxX = adx > 1e-9 ? (sx > 0 ? tx + 1 - x0 : x0 - tx) / adx : Infinity;
    let tMaxZ = adz > 1e-9 ? (sz > 0 ? tz + 1 - z0 : z0 - tz) / adz : Infinity;
    const tdx = adx > 1e-9 ? 1 / adx : Infinity, tdz = adz > 1e-9 ? 1 / adz : Infinity;
    let steps = Math.abs(ex - tx) + Math.abs(ez - tz) + 2;
    while (steps-- > 0) {
      if (tx === ex && tz === ez) return false;
      if (tMaxX < tMaxZ) {
        if (tMaxX > 1) return false;
        if (test(eW(sx > 0 ? tx + 1 : tx, tz))) return true;
        tx += sx; tMaxX += tdx;
      } else {
        if (tMaxZ > 1) return false;
        if (test(eN(tx, sz > 0 ? tz + 1 : tz))) return true;
        tz += sz; tMaxZ += tdz;
      }
    }
    return false;
  }

  function hasLOS(x0, z0, x1, z1) {
    return !lineBlocked(x0, z0, x1, z1, B.blocksSight);
  }

  function hasClearLine(x0, z0, x1, z1) {
    if (lineBlocked(x0, z0, x1, z1, B.blocksWalk)) return false;
    const dx = x1 - x0, dz = z1 - z0;
    const n = Math.ceil(Math.hypot(dx, dz) / 0.3);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (circleBlocked(x0 + dx * t, z0 + dz * t, 0.26)) return false;
    }
    return true;
  }

  // ---------- A* local (ventana 48x48) ----------
  const PW = 48, PH = 24;
  const gScore = new Float32Array(PW * PW);
  const cameFrom = new Int32Array(PW * PW);
  const closed = new Uint8Array(PW * PW);
  const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  // Coste extra de cruzar una arista para un zombi (Infinity = imposible)
  function crossCost(e) {
    if (e === E.NONE || e === E.DOOR_OPEN || e === E.DOOR_BROKEN || e === E.ARCH) return 0;
    if (e === E.WALL) return Infinity;
    if (e === E.DOOR) return 7;
    if (e === E.WIN) return 9;
    return 4;   // ventana abierta o rota, valla: trepar
  }

  function findPath(sx, sz, tx, tz, maxNodes) {
    maxNodes = maxNodes || 900;
    const sX = Math.floor(sx), sZ = Math.floor(sz);
    const tX = Math.floor(tx), tZ = Math.floor(tz);
    const ox = sX - PH, oz = sZ - PH;
    const ltx = tX - ox, ltz = tZ - oz;
    if (ltx < 0 || ltz < 0 || ltx >= PW || ltz >= PW) return null;
    if (solidObj(obj(tX, tZ))) return null;
    if (sX === tX && sZ === tZ) return [];
    gScore.fill(Infinity);
    cameFrom.fill(-1);
    closed.fill(0);
    const heap = [];
    const push = (f, i) => {
      heap.push([f, i]);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
        const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
      }
      return top;
    };
    const h = (x, z) => {
      const dx = Math.abs(x - ltx), dz = Math.abs(z - ltz);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    const si = PH * PW + PH;
    gScore[si] = 0;
    push(h(PH, PH), si);
    let expanded = 0;
    while (heap.length) {
      const ci = pop()[1];
      if (closed[ci]) continue;
      closed[ci] = 1;
      const cx = ci % PW, cz = (ci / PW) | 0;
      if (cx === ltx && cz === ltz) {
        const out = [];
        let i = ci;
        while (i !== si) {
          out.push({ x: ox + (i % PW) + 0.5, z: oz + ((i / PW) | 0) + 0.5 });
          i = cameFrom[i];
        }
        out.reverse();
        return out;
      }
      if (++expanded > maxNodes) return null;
      const wx = ox + cx, wz = oz + cz;
      for (const d of ORTHO) {
        const nx = cx + d[0], nz = cz + d[1];
        if (nx < 0 || nz < 0 || nx >= PW || nz >= PW) continue;
        if (solidObj(obj(wx + d[0], wz + d[1]))) continue;
        const cc = crossCost(edgeBetween(wx, wz, wx + d[0], wz + d[1]));
        if (cc === Infinity) continue;
        const ni = nz * PW + nx;
        if (closed[ni]) continue;
        const ng = gScore[ci] + 1 + cc;
        if (ng < gScore[ni]) { gScore[ni] = ng; cameFrom[ni] = ci; push(ng + h(nx, nz), ni); }
      }
      for (const d of DIAG) {
        const nx = cx + d[0], nz = cz + d[1];
        if (nx < 0 || nz < 0 || nx >= PW || nz >= PW) continue;
        const ax = wx + d[0], az = wz + d[1];
        if (solidObj(obj(ax, az)) || solidObj(obj(ax, wz)) || solidObj(obj(wx, az))) continue;
        if (crossCost(edgeBetween(wx, wz, ax, wz)) !== 0 || crossCost(edgeBetween(ax, wz, ax, az)) !== 0 ||
            crossCost(edgeBetween(wx, wz, wx, az)) !== 0 || crossCost(edgeBetween(wx, az, ax, az)) !== 0) continue;
        const ni = nz * PW + nx;
        if (closed[ni]) continue;
        const ng = gScore[ci] + 1.414;
        if (ng < gScore[ni]) { gScore[ni] = ng; cameFrom[ni] = ci; push(ng + h(nx, nz), ni); }
      }
    }
    return null;
  }

  // ---------- Cambios en puertas y ventanas ----------
  function setEdge(ref, v) {
    const c = ch(ref.x, ref.z);
    const arr = ref.o === 'N' ? c.eN : c.eW;
    const i = li(ref.x, ref.z);
    const old = arr[i];
    arr[i] = v;
    if (c.view) G.WorldView.edgeChanged(c, ref, old, v);
  }

  function edgeKey(ref) { return ref.o + ref.x + ',' + ref.z; }

  // Hoja de una puerta abierta como segmento [x0, z0, x1, z1] (o null si no está abierta)
  function doorLeaf(o, x, z) {
    const e = o === 'N' ? eN(x, z) : eW(x, z);
    if (e !== E.DOOR_OPEN) return null;
    const ax = o === 'N' ? x : x - 1, az = o === 'N' ? z - 1 : z;
    const swing = (isIndoor(ax, az) && !isIndoor(x, z)) ? -1 : 1;
    if (o === 'N') return [x + 0.07, z, x + 0.07, z + swing * 0.86];
    return [x, z + 0.07, x + swing * 0.86, z + 0.07];
  }

  function nearDoorLeaf(px, pz, r) {
    const tx0 = Math.floor(px) - 1, tz0 = Math.floor(pz) - 1;
    for (let tz = tz0; tz <= tz0 + 2; tz++) {
      for (let tx = tx0; tx <= tx0 + 2; tx++) {
        for (const o of ['N', 'W']) {
          const L = doorLeaf(o, tx, tz);
          if (!L) continue;
          const vx = L[2] - L[0], vz = L[3] - L[1];
          const t = U.clamp(((px - L[0]) * vx + (pz - L[1]) * vz) / (vx * vx + vz * vz), 0, 1);
          if (Math.hypot(L[0] + vx * t - px, L[1] + vz * t - pz) < r) return true;
        }
      }
    }
    return false;
  }

  // Daño de un zombi a una puerta o ventana. Devuelve true si se rompe.
  function damageEdge(ref, amount) {
    const c = ch(ref.x, ref.z);
    const k = edgeKey(ref);
    const e = edgeGet(ref);
    const max = e === E.DOOR ? 12 : 3;
    const hp = (c.edgeHP.has(k) ? c.edgeHP.get(k) : max) - amount;
    c.edgeHP.set(k, hp);
    if (hp > 0) return false;
    setEdge(ref, e === E.DOOR ? E.DOOR_BROKEN : E.WIN_BROKEN);
    emit(ref.o === 'N' ? ref.x + 0.5 : ref.x, ref.o === 'N' ? ref.z : ref.z + 0.5, e === E.DOOR ? 10 : 14);
    return true;
  }

  function emit(x, z, radius) {
    for (let i = 0; i < listeners.length; i++) listeners[i](x, z, radius);
  }

  function toggleLight(room) {
    room.on = !room.on;
    const c = ch(Math.floor(room.light.x), Math.floor(room.light.z));
    if (c.view) G.WorldView.lightChanged(c, room);
  }

  // ---------- Objetos en el suelo ----------
  function itemsNear(x, z, r) {
    const out = [];
    const cx0 = Math.floor((x - r) / CS), cx1 = Math.floor((x + r) / CS);
    const cz0 = Math.floor((z - r) / CS), cz1 = Math.floor((z + r) / CS);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = chunkAt(cx, cz);
        for (const it of c.items) {
          if (Math.hypot(it.x - x, it.z - z) <= r) out.push({ c, it });
        }
      }
    }
    return out;
  }

  function removeItem(c, it) {
    const i = c.items.indexOf(it);
    if (i >= 0) c.items.splice(i, 1);
    if (c.view) G.WorldView.itemRemoved(c, it);
  }

  function dropItem(x, z, id, cond) {
    const c = ch(Math.floor(x), Math.floor(z));
    const it = { x, z, rot: Math.random() * 6.28, id, cond };
    c.items.push(it);
    if (c.view) G.WorldView.itemAdded(c, it);
    return it;
  }

  // ---------- Gestión de chunks ----------
  function init(sceneRef, seed) {
    scene = sceneRef;
    if (seed != null) SEED = seed | 0;
    G.WorldView.init(scene);
  }

  function reset(seed) {
    chunks.forEach((c) => { if (c.view) G.WorldView.dispose(c); });
    chunks.clear();
    buildQueue.length = 0;
    lastCX = lastCZ = NaN; lastChunk = null;
    lastPCX = lastPCZ = NaN;
    SEED = seed | 0;
    chunkAt(0, 0);   // fija el punto de inicio
  }

  function update(px, pz, immediate, dt) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    if (pcx !== lastPCX || pcz !== lastPCZ) {
      lastPCX = pcx; lastPCZ = pcz;
      for (let dz = -DATA_RADIUS; dz <= DATA_RADIUS; dz++) {
        for (let dx = -DATA_RADIUS; dx <= DATA_RADIUS; dx++) chunkAt(pcx + dx, pcz + dz);
      }
      if (scene) {
        for (let dz = -MESH_RADIUS; dz <= MESH_RADIUS; dz++) {
          for (let dx = -MESH_RADIUS; dx <= MESH_RADIUS; dx++) {
            const c = chunkAt(pcx + dx, pcz + dz);
            if (!c.view && !c.queued) { c.queued = true; buildQueue.push(c); }
          }
        }
        chunks.forEach((c) => {
          if (c.view && (Math.abs(c.cx - pcx) > KEEP_RADIUS || Math.abs(c.cz - pcz) > KEEP_RADIUS)) {
            G.WorldView.dispose(c);
          }
        });
      }
    }
    if (!scene) return;
    let budget = immediate ? 999 : 1;
    while (budget-- > 0 && buildQueue.length) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < buildQueue.length; i++) {
        const c = buildQueue[i];
        const d = Math.abs(c.cx - pcx) + Math.abs(c.cz - pcz);
        if (d < bd) { bd = d; bi = i; }
      }
      const c = buildQueue.splice(bi, 1)[0];
      c.queued = false;
      if (!c.view && Math.abs(c.cx - pcx) <= KEEP_RADIUS && Math.abs(c.cz - pcz) <= KEEP_RADIUS) {
        G.WorldView.build(c);
      }
    }
    G.WorldView.update(dt || 0, px, pz, chunks);
  }

  G.World = {
    CS, E, F, O, WALL_H, DOOR_H, WIN_LO, WIN_HI, WALL_T, FENCE_H,
    get SPAWN() { return spawnPoint; },
    init, reset, update, chunkAt, hash, vnoise,
    ground, obj, eN, eW, bldAt, roomAt, isIndoor, groundY, solidObj,
    edgeBetween, edgeRefBetween, edgeGet, setEdge, damageEdge, edgeKey,
    circleBlocked, move, lineBlocked, hasLOS, hasClearLine, findPath, crossCost,
    blocksWalkEdge: B.blocksWalk, climbableEdge: B.climbable, blocksSightEdge: B.blocksSight,
    toggleLight, itemsNear, removeItem, dropItem, doorLeaf, nearDoorLeaf,
    onNoise(fn) { listeners.push(fn); },
    emit,
    forEachChunk(fn) { chunks.forEach(fn); },
    stats() {
      let built = 0;
      chunks.forEach((c) => { if (c.view) built++; });
      return { generated: chunks.size, built, seed: SEED };
    }
  };
})(window.Game = window.Game || {});
