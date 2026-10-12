(function (G) {
  'use strict';

  // Busca con qué puede interactuar el jugador (puertas, ventanas, vallas,
  // interruptores y armas en el suelo) y ejecuta la acción.

  const U = G.Util;
  const REACH = 1.45;

  function label(t) {
    return t ? t.label : '';
  }

  function find(player, camF) {
    const W = G.World, E = W.E;
    if (player.dead || player.busy()) return null;
    const px = player.pos.x, pz = player.pos.z;
    const look = Math.atan2(camF.x, camF.z);
    let best = null, bestScore = Infinity;
    const consider = (x, z, data, maxD) => {
      const d = Math.hypot(x - px, z - pz);
      if (d > (maxD || REACH)) return;
      const a = Math.abs(U.angleDiff(Math.atan2(x - px, z - pz), look));
      if (a > 1.25 && d > 0.75) return;
      const score = d + a * 0.7;
      if (score < bestScore) { bestScore = score; best = data; best.x = x; best.z = z; }
    };

    // Aristas cercanas
    const tx0 = Math.floor(px) - 2, tz0 = Math.floor(pz) - 2;
    for (let tz = tz0; tz <= tz0 + 4; tz++) {
      for (let tx = tx0; tx <= tx0 + 4; tx++) {
        for (const o of ['N', 'W']) {
          const e = o === 'N' ? W.eN(tx, tz) : W.eW(tx, tz);
          if (!e) continue;
          const ref = { o, x: tx, z: tz };
          const mx = o === 'N' ? tx + 0.5 : tx, mz = o === 'N' ? tz : tz + 0.5;
          let lab = null, kind = null;
          if (e === E.DOOR) { lab = 'Abrir puerta'; kind = 'door'; }
          else if (e === E.DOOR_OPEN) { lab = 'Cerrar puerta'; kind = 'door'; }
          else if (e === E.WIN) { lab = 'Abrir ventana'; kind = 'window'; }
          else if (e === E.WIN_OPEN) { lab = 'Saltar por la ventana'; kind = 'climb'; }
          else if (e === E.WIN_BROKEN) { lab = 'Saltar por la ventana rota'; kind = 'climb'; }
          else if (e === E.FENCE) { lab = 'Saltar la valla'; kind = 'fence'; }
          if (!lab) continue;
          consider(mx, mz, { kind, label: lab, ref, e }, kind === 'door' ? REACH + 0.1 : REACH);
        }
      }
    }

    // Interruptores de la habitación en la que estás (o de la de al lado, si los ves)
    const cx0 = Math.floor((px - 3) / W.CS), cx1 = Math.floor((px + 3) / W.CS);
    const cz0 = Math.floor((pz - 3) / W.CS), cz1 = Math.floor((pz + 3) / W.CS);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = W.chunkAt(cx, cz);
        for (const b of c.buildings) {
          if (px < b.x0 - 2 || pz < b.z0 - 2 || px > b.x0 + b.w + 2 || pz > b.z0 + b.h + 2) continue;
          for (const r of b.rooms) {
            if (!r.sw) continue;
            const p = G.WorldView.switchPoint(r);
            if (Math.hypot(p.x - px, p.z - pz) > REACH) continue;
            // tienes que estar del lado de la habitación
            if (!W.hasLOS(px, pz, p.x + p.nx * 0.05, p.z + p.nz * 0.05)) continue;
            consider(p.x, p.z, { kind: 'switch', label: r.on ? 'Apagar luz' : 'Encender luz', room: r });
          }
        }
      }
    }

    // Armas en el suelo
    for (const { c, it } of W.itemsNear(px, pz, 1.3)) {
      if (!W.hasLOS(px, pz, it.x, it.z)) continue;
      consider(it.x, it.z, { kind: 'item', label: 'Coger ' + G.Weapons.get(it.id).name, c, it }, 1.3);
    }
    return best;
  }

  // Devuelve un mensaje para mostrar (o null)
  function use(t, player) {
    const W = G.World, E = W.E;
    if (!t) return null;
    if (t.kind === 'door') {
      const e = W.edgeGet(t.ref);
      W.setEdge(t.ref, e === E.DOOR ? E.DOOR_OPEN : E.DOOR);
      W.emit(t.x, t.z, 3 * player.noiseMul);
      return null;
    }
    if (t.kind === 'window') {
      W.setEdge(t.ref, E.WIN_OPEN);
      W.emit(t.x, t.z, 2 * player.noiseMul);
      return null;
    }
    if (t.kind === 'climb' || t.kind === 'fence') {
      if (!player.startClimb(t.ref, t.kind === 'fence' ? 'fence' : 'window')) return 'No hay sitio al otro lado';
      W.emit(t.x, t.z, 2.5 * player.noiseMul);
      return null;
    }
    if (t.kind === 'switch') {
      W.toggleLight(t.room);
      return null;
    }
    if (t.kind === 'item') {
      W.removeItem(t.c, t.it);
      const r = player.pickUp(t.it.id, t.it.cond);
      if (r.dropped) W.dropItem(player.pos.x, player.pos.z, r.dropped.id, r.dropped.cond);
      const w = G.Weapons.get(t.it.id);
      let msg = 'Cogiste: ' + w.name;
      if (r.dropped) msg += ' (soltaste ' + G.Weapons.get(r.dropped.id).name + ')';
      else if (!r.equipped) msg += ' · al bolsillo';
      return msg;
    }
    return null;
  }

  G.Interact = { find, use, label };
})(window.Game = window.Game || {});
