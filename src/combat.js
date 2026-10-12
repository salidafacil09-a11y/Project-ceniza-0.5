(function (G) {
  'use strict';

  // Combate cuerpo a cuerpo al estilo del original:
  // - Apuntar (clic derecho / LT) te deja quieto y encarado; atacar sin apuntar también vale.
  // - Cada arma tiene alcance, daño, velocidad, críticos, golpes múltiples y probabilidad de derribo.
  // - Empujón (Espacio): aparta y puede tirar al suelo; contra un zombi caído es un pisotón.
  // - Golpear a un zombi caído es un ataque al suelo (más daño, a la cabeza).
  // - Los cuchillos pueden rematar de un golpe por la espalda o en el suelo.
  // - El arma se desgasta y se rompe. La resistencia baja con cada golpe.
  // - Los zombis agarran: rasguños, laceraciones y mordiscos (los mordiscos infectan).

  const U = G.Util;
  const IMPACT = 0.45;
  const ANIM = 0.9;          // ritmo general de los ataques (menor = más rápidos)

  const Combat = {
    dragT: 0,
    onMessage: null,
    onHit: null,

    msg(text, kind) { if (this.onMessage) this.onMessage(text, kind); },

    // Animación según el arma y cómo la agarras
    animFor(w, two) {
      if (w.cat === 'sblade') return 'stab';
      if (w.cat === 'spear') return 'thrust';
      if (w.cat === 'lblunt') return two ? 'swing2' : 'swing1';
      if (w.cat === 'axe' || w.cat === 'lblade') return w.hands === 2 && two ? 'swing2' : 'swing1';
      return 'swing1';
    },

    // Zombis delante del jugador dentro de un alcance y un ángulo
    inFront(player, zombies, range, arc, filter) {
      const out = [];
      for (const z of zombies) {
        if (!z.alive || !filter(z)) continue;
        const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > range) continue;
        const a = Math.abs(U.angleDiff(Math.atan2(dx, dz), player.facing));
        if (a > arc && d > 0.45) continue;
        if (!G.World.hasLOS(player.pos.x, player.pos.z, z.pos.x, z.pos.z)) continue;
        out.push({ z, d, a });
      }
      out.sort((p, q) => p.d - q.d);
      return out;
    },

    // Zombi al que apuntas: el más centrado delante de la cámara y a tu alcance
    pickTarget(player, zombies, camYaw, extra) {
      const range = player.weapon.range + (extra != null ? extra : 0.8);
      let best = null, bestA = 0.62;
      for (const z of zombies) {
        if (!z.alive) continue;
        const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > range) continue;
        const a = Math.abs(U.angleDiff(Math.atan2(dx, dz), camYaw));
        if (a < bestA && G.World.hasLOS(player.pos.x, player.pos.z, z.pos.x, z.pos.z)) { bestA = a; best = z; }
      }
      return best;
    },

    // Dirección de ataque con un poco de ayuda para apuntar
    aimYaw(player, zombies, camYaw) {
      const z = this.pickTarget(player, zombies, camYaw);
      return z ? Math.atan2(z.pos.x - player.pos.x, z.pos.z - player.pos.z) : camYaw;
    },

    // ---------- Entrada del jugador ----------
    handleInput(player, input, zombies, camYaw) {
      if (player.dead || player.busy()) return;
      const w = player.weapon;
      if (input.attack && w.cat !== 'none') this.startAttack(player, zombies, camYaw);
      else if (input.shove || (input.attack && w.cat === 'none')) this.startShove(player, zombies, camYaw);
    },

    startAttack(player, zombies, camYaw) {
      const w = player.weapon;
      const face = this.aimYaw(player, zombies, camYaw);
      player.facing = U.turnToward(player.facing, face, 0.9);
      const tired = player.stamina < 0.25;
      // ¿hay alguien de pie delante? si no, y hay uno caído, golpe al suelo
      const tmp = { pos: player.pos, facing: face };
      const standing = this.inFront(tmp, zombies, w.range + 0.3, 0.9, (z) => z.standing);
      const down = this.inFront(tmp, zombies, w.range + 0.35, 1.0, (z) => z.downed);
      const floor = !standing.length && down.length > 0;
      const two = player.twoHanded;
      const g = G.Weapons.grip(w, two);
      player.action = {
        kind: floor ? 'floor' : this.animFor(w, two), t: 0, dur: w.speed * g.speed * ANIM * (tired ? 1.35 : 1),
        face, floor, done: false, weapon: w, two, g
      };
      player.stamina = Math.max(0, player.stamina - w.stam);
    },

    startShove(player, zombies, camYaw) {
      const face = this.aimYaw(player, zombies, camYaw);
      const tmp = { pos: player.pos, facing: face };
      const standing = this.inFront(tmp, zombies, 1.0, 0.9, (z) => z.standing);
      const down = this.inFront(tmp, zombies, 1.4, 1.0, (z) => z.downed);
      const stomp = !standing.length && down.length > 0;
      player.action = { kind: stomp ? 'stomp' : 'shove', t: 0, dur: stomp ? 0.68 : 0.5, face, done: false };
      player.stamina = Math.max(0, player.stamina - (stomp ? 0.04 : 0.035));
    },

    // ---------- Resolución ----------
    update(dt, player, zombies) {
      const a = player.action;
      if (a) {
        a.t += dt / a.dur;
        if (!a.done && a.t >= IMPACT) {
          a.done = true;
          if (a.kind === 'shove') this.resolveShove(player, zombies);
          else if (a.kind === 'stomp') this.resolveStomp(player, zombies);
          else this.resolveSwing(player, zombies, a);
        }
        if (a.t >= 1) player.action = null;
      }

      // Agarrado por varios a la vez: te derriban
      if (!player.dead) {
        let n = 0;
        for (const z of zombies) {
          if ((z.state === 'attack' || z.state === 'recover') && Math.hypot(z.pos.x - player.pos.x, z.pos.z - player.pos.z) < 1.15) n++;
        }
        if (n >= 4) this.dragT += dt; else this.dragT = Math.max(0, this.dragT - dt * 2);
        if (this.dragT > 2.2) player.die('Te rodearon y te derribaron.');
      } else this.dragT = 0;
    },

    behind(player, z) {
      // el jugador está detrás del zombi si el zombi mira hacia el otro lado
      const toPlayer = Math.atan2(player.pos.x - z.pos.x, player.pos.z - z.pos.z);
      return Math.abs(U.angleDiff(toPlayer, z.facing)) > 2.0;
    },

    resolveSwing(player, zombies, a) {
      const w = a.weapon;
      const tired = player.stamina < 0.25;
      const targets = a.floor
        ? this.inFront(player, zombies, w.range + 0.35, 1.0, (z) => z.downed)
        : this.inFront(player, zombies, w.range + 0.25, a.two ? 1.05 : 0.8, (z) => z.standing || z.state === 'rise');
      if (!targets.length) { G.World.emit(player.pos.x, player.pos.z, 2.5 * player.noiseMul); return; }
      const base = { sblade: 0.92, sblunt: 0.88, lblunt: 0.85, axe: 0.85, lblade: 0.88, spear: 0.88 }[w.cat] || 0.85;
      let landed = 0;
      // un arma de dos manos usada con una sola solo alcanza a un zombi
      const n = a.floor ? 1 : Math.min(a.two ? w.hits : 1, targets.length);
      for (let i = 0; i < n; i++) {
        const { z } = targets[i];
        let chance = base + a.g.acc - (tired ? 0.15 : 0) - (player.moveAmt > 0.3 ? 0.08 : 0) - i * 0.1;
        if (a.floor) chance += 0.08;
        if (Math.random() > chance) continue;
        landed++;
        const behind = this.behind(player, z);
        let dmg = U.lerp(w.dmg[0], w.dmg[1], Math.random()) * a.g.dmg * (i > 0 ? 0.6 : 1) * (tired ? 0.75 : 1);
        let crit = Math.random() < w.crit[0] + (behind ? 0.1 : 0);
        if (crit) dmg *= w.crit[1];
        if (a.floor) dmg *= 2;
        // los cuchillos rematan por la espalda o en el suelo
        if (w.cat === 'sblade' && (a.floor || behind) && Math.random() < 0.4) { dmg = 99; crit = true; }
        const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z;
        const res = z.takeHit(dmg, Math.max(0, w.knock + a.g.knock) + (crit ? 0.25 : 0), dx, dz, behind);
        if (this.onHit) this.onHit(res, crit);
      }
      if (landed) {
        G.World.emit(player.pos.x, player.pos.z, 6 * player.noiseMul);
        this.wear(player, w);
      } else G.World.emit(player.pos.x, player.pos.z, 2.5 * player.noiseMul);
    },

    wear(player, w) {
      const slot = player.slot;
      if (!slot) return;
      if (Math.random() < 1 / w.lower) {
        slot.cond -= 1 / w.cond;
        if (slot.cond <= 0.001) {
          this.msg('Se rompió: ' + w.name, 'bad');
          player.breakCurrent();
        }
      }
    },

    resolveShove(player, zombies) {
      const targets = this.inFront(player, zombies, 1.05, 0.9, (z) => z.standing);
      for (let i = 0; i < Math.min(2, targets.length); i++) {
        const { z } = targets[i];
        const behind = this.behind(player, z);
        const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z;
        if (Math.random() < (behind ? 0.75 : 0.35)) z.knockDown(behind ? 1 : -1, dx, dz);
        else z.doStagger(dx, dz, 2.6);
        if (this.onHit) this.onHit('shove', false);
      }
      G.World.emit(player.pos.x, player.pos.z, 2 * player.noiseMul);
    },

    resolveStomp(player, zombies) {
      const targets = this.inFront(player, zombies, 1.4, 1.0, (z) => z.downed);
      if (!targets.length) return;
      const { z } = targets[0];
      let dmg = U.lerp(0.45, 0.95, Math.random());
      const crit = Math.random() < 0.18;
      if (crit) dmg *= 3;
      const res = z.takeHit(dmg, 0, 0, 0, false);
      if (this.onHit) this.onHit(res, crit);
      G.World.emit(player.pos.x, player.pos.z, 3 * player.noiseMul);
    },

    // Un zombi termina su intento de agarrar al jugador
    zombieStrike(z, player, dist) {
      if (player.dead || dist > 1.2 || player.climb) return false;
      if (!G.World.hasLOS(z.pos.x, z.pos.z, player.pos.x, player.pos.z)) return false;
      let n = 0;
      for (const o of G.Population.list) {
        if ((o.state === 'attack' || o.state === 'recover') && Math.hypot(o.pos.x - player.pos.x, o.pos.z - player.pos.z) < 1.2) n++;
      }
      const toZ = Math.atan2(z.pos.x - player.pos.x, z.pos.z - player.pos.z);
      const behind = Math.abs(U.angleDiff(toZ, player.facing)) > 1.9;
      const chance = 0.5 + (behind ? 0.3 : 0) + 0.08 * Math.max(0, n - 1);
      if (Math.random() > chance) return false;
      const bite = Math.min(0.45, 0.12 + 0.08 * Math.max(0, n - 1) + (behind ? 0.08 : 0));
      const r = Math.random();
      const type = r < bite ? 'mordisco' : (r < bite + 0.3 ? 'laceración' : 'rasguño');
      player.wound(type);
      this.msg(type === 'mordisco' ? '¡Te mordió!' : (type === 'laceración' ? 'Te hizo una laceración' : 'Te arañó'), type === 'rasguño' ? 'warn' : 'bad');
      return true;
    }
  };

  G.Combat = Combat;
})(window.Game = window.Game || {});
