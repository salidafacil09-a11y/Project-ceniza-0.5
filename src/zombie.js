(function (G) {
  'use strict';

  const U = G.Util;

  // Zombis lentos. Ajusta estos valores para cambiar la dificultad.
  const SIGHT_RANGE = 14;
  const CROUCH_SIGHT = 6;        // a un jugador agachado solo lo ven hasta esta distancia
  const NOTICE_TIME = 1.0;       // segundos que tienen que mirarte para notarte agachado
  const FOV_HALF = 0.8;          // solo ven de frente (~92°)
  const WANDER_SPEED = 0.42;
  const INVESTIGATE_SPEED = 0.62;
  const CHASE_SPEED = 0.95;      // más lentos que el jugador caminando
  const REACH = 0.95;            // distancia a la que intentan agarrarte
  const WINDUP = 0.75;           // segundos de preparación del ataque
  const RADIUS = 0.28;
  const HP_MIN = 2.4, HP_MAX = 3.4;   // vida de cada zombi

  const SKINS = [0x8e9a7c, 0x9aa385, 0x7f8c72, 0xa3a68e, 0x8d8a74, 0x76806a];
  const SHIRTS = [0x5a4a3a, 0x6b5d4f, 0x4a5560, 0x6e4b4b, 0x55603f, 0x7a7a72, 0x3f4a5a, 0x8a7a5a, 0x5e3f3f, 0x9a9488];
  const PANTS = [0x2f3340, 0x3b3a33, 0x4a4036, 0x28303a, 0x3d4a5a, 0x5a5448];
  const HAIR = [0x2a2018, 0x3a2a1c, 0x5a4630, 0x1a1a1a, 0x7a6a5a, null, null];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  // estados en los que un ruido no le hace cambiar de idea
  const BUSY = { dead: 1, down: 1, rise: 1, stagger: 1, attack: 1, recover: 1, climb: 1, chase: 1, bang: 1 };

  function randomLook() {
    return {
      skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR),
      longHair: Math.random() < 0.3, longSleeves: Math.random() < 0.4,
      shoes: pick([0x2a2622, 0x3b3029, 0x4a4a4a, 0x5a4636]),
      seed: Math.floor(Math.random() * 1e9), drag: Math.random() < 0.3,
      armsUp: Math.random() < 0.35 ? 0.6 : 0
    };
  }

  class Zombie {
    constructor(scene, x, z, look, facing, extra) {
      this.scene = scene;
      this.pos = { x, z };
      this.y = G.World.groundY(x, z);
      this.facing = facing != null ? facing : Math.random() * Math.PI * 2;
      this.look = look || randomLook();
      this.model = G.Models.createHumanoid(Object.assign({ zombie: true, blood: U.mulberry32(this.look.seed) }, this.look));
      scene.add(this.model.root);
      this.hp = extra && extra.hp != null ? extra.hp : HP_MIN + Math.random() * (HP_MAX - HP_MIN);
      this.state = 'idle';
      this.timer = 1 + Math.random() * 3;
      this.target = null;
      this.lastSeen = 0;
      this.hearTimer = 0;
      this.path = null; this.pathTimer = 0; this.clear = true; this.clearTimer = 0;
      this.stuck = 0;
      this.phase = Math.random() * 10;
      this.speedNow = 0;
      this.reach = 0;
      this.notice = 0;
      this.stagger = 0;
      this.kb = { x: 0, z: 0 };
      this.fall = 0;          // 0 de pie, 1 en el suelo
      this.fallDir = -1;
      this.edge = null;
      this.climbing = null;
      this.bangT = 0;
      this.resume = 'chase';
      this.tilt = (Math.random() - 0.5) * 1.6;
      this.lean = (Math.random() - 0.5) * 0.12;
      if (extra && extra.dead) { this.state = 'dead'; this.fall = 1; this.fallDir = extra.fallDir || -1; }
      this.apply(0);
    }

    get alive() { return this.state !== 'dead'; }
    get downed() { return this.state === 'down' || (this.state === 'rise' && this.timer > 0.6); }
    get standing() { return this.alive && !this.downed && this.state !== 'rise'; }

    dispose() {
      this.scene.remove(this.model.root);
      G.Models.disposeHumanoid(this.model);
    }

    enter(state, timer) {
      this.state = state;
      this.timer = timer || 0;
      this.pathTimer = 0;
      this.clearTimer = 0;
      this.stuck = 0;
    }

    aware() {
      return this.state === 'chase' || this.state === 'attack' || this.state === 'recover';
    }

    // Un ruido en (x, z) con alcance r
    hear(x, z, r) {
      if (BUSY[this.state]) return;
      const d = Math.hypot(x - this.pos.x, z - this.pos.z);
      if (d > r) return;
      if (d > r * 0.6 && !G.World.hasLOS(this.pos.x, this.pos.z, x, z)) return;
      this.target = { x: x + (Math.random() - 0.5) * 2, z: z + (Math.random() - 0.5) * 2 };
      this.enter('investigate', 14);
    }

    // ---------- Golpes recibidos ----------
    // dx, dz: dirección del golpe (desde el atacante hacia el zombi)
    takeHit(dmg, knock, dx, dz, behind) {
      if (!this.alive) return 'none';
      this.hp -= dmg;
      // caer hacia donde lo empujan: de espaldas si le pegan de frente, boca abajo si es por detrás
      const dir = behind ? 1 : -1;
      if (this.hp <= 0) { this.die(dir); return 'kill'; }
      if (this.downed) return 'hit';
      if (Math.random() < knock + (behind ? 0.25 : 0)) { this.knockDown(dir, dx, dz); return 'down'; }
      this.doStagger(dx, dz, 1.6);
      return 'hit';
    }

    doStagger(dx, dz, force) {
      const l = Math.hypot(dx, dz) || 1;
      this.kb.x = dx / l * force; this.kb.z = dz / l * force;
      this.reach = 0;
      this.edge = null;
      this.enter('stagger', 0.55);
      this.stagger = 0.001;
    }

    knockDown(dir, dx, dz) {
      const l = Math.hypot(dx, dz) || 1;
      this.kb.x = dx / l * 1.2; this.kb.z = dz / l * 1.2;
      this.fallDir = dir;
      this.reach = 0;
      this.edge = null;
      this.enter('down', 2.5 + Math.random() * 2);
    }

    die(dir) {
      this.fallDir = dir;
      this.reach = 0;
      this.edge = null;
      this.state = 'dead';
      this.timer = 0;
    }

    // ---------- IA ----------
    update(dt, player, all, combat) {
      if (this.state === 'dead') {
        this.fall = Math.min(1, this.fall + dt * 2.2);
        this.knockback(dt);
        this.apply(dt);
        return;
      }
      const px = player.pos.x, pz = player.pos.z;
      const dx = px - this.pos.x, dz = pz - this.pos.z;
      const dist = Math.hypot(dx, dz);
      let speed = 0;

      // estados sin control
      if (this.state === 'stagger') {
        this.timer -= dt;
        this.stagger = 1 - this.timer / 0.55;
        this.knockback(dt);
        if (this.timer <= 0) { this.stagger = 0; this.enter(this.target ? 'chase' : 'idle', 0); }
        this.apply(dt);
        return;
      }
      if (this.state === 'down') {
        this.fall = Math.min(1, this.fall + dt * 2.5);
        this.knockback(dt);
        this.timer -= dt;
        if (this.timer <= 0) this.enter('rise', 1.3);
        this.apply(dt);
        return;
      }
      if (this.state === 'rise') {
        this.timer -= dt;
        this.fall = Math.max(0, this.timer / 1.3);
        if (this.timer <= 0) { this.fall = 0; this.enter('chase', 0); this.target = { x: px, z: pz }; }
        this.apply(dt);
        return;
      }
      if (this.state === 'climb') {
        const c = this.climbing;
        c.t += dt / c.dur;
        const t = Math.min(1, c.t);
        this.pos.x = U.lerp(c.x0, c.x1, U.smooth(t));
        this.pos.z = U.lerp(c.z0, c.z1, U.smooth(t));
        this.lift = Math.sin(Math.PI * t) * 0.6;
        if (c.t >= 1) { this.lift = 0; this.climbing = null; this.enter(this.resume, 14); this.path = null; }
        this.phase += dt * 3;
        this.apply(dt);
        return;
      }

      // ---- sentidos ----
      let sees = false;
      // si ya te persigue no te pierde por agacharte; si no, agachado te ve de más cerca y tarda en notarte
      const sneaky = player.crouching && !this.aware();
      const range = sneaky ? CROUCH_SIGHT : SIGHT_RANGE;
      if (dist < range && !player.dead) {
        const diff = Math.abs(U.angleDiff(Math.atan2(dx, dz), this.facing));
        if ((diff < FOV_HALF || (dist < 1.4 && diff < 1.6)) && G.World.hasLOS(this.pos.x, this.pos.z, px, pz)) sees = true;
      }
      if (sees && sneaky && dist > 1.6) {
        this.notice += dt * (1.6 - dist / range) / NOTICE_TIME;
        if (this.notice < 1) sees = false;
      } else if (!sees) this.notice = Math.max(0, this.notice - dt * 0.5);
      let hearsRun = false;
      if (!sees && player.noise > 0 && dist < player.noise) {
        hearsRun = dist < player.noise * 0.6 || G.World.hasLOS(this.pos.x, this.pos.z, px, pz);
      }
      this.hearTimer -= dt;

      if (sees) {
        this.lastSeen = 0;
        this.target = { x: px, z: pz };
        if (this.state !== 'chase' && this.state !== 'attack' && this.state !== 'recover' && this.state !== 'bang') this.enter('chase', 0);
      } else {
        this.lastSeen += dt;
        if (hearsRun && this.hearTimer <= 0 && this.state !== 'attack' && this.state !== 'recover') {
          this.hearTimer = 1;
          this.target = { x: px + (Math.random() - 0.5) * 1.5, z: pz + (Math.random() - 0.5) * 1.5 };
          if (this.state !== 'chase' && this.state !== 'bang') this.enter('investigate', 14);
        }
        if (this.state === 'chase' && this.lastSeen > 1.5) this.enter('investigate', 12);
      }

      this.reach = Math.max(0, this.reach - dt * 3);

      switch (this.state) {
        case 'idle':
          this.timer -= dt;
          if (this.timer <= 0) {
            const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 6;
            const tx = this.pos.x + Math.sin(a) * d, tz = this.pos.z + Math.cos(a) * d;
            if (!G.World.solidObj(G.World.obj(Math.floor(tx), Math.floor(tz)))) { this.target = { x: tx, z: tz }; this.enter('wander', 12); }
            else this.timer = 1;
          }
          break;
        case 'wander':
        case 'investigate': {
          this.timer -= dt;
          const g = this.target;
          if (!g || this.timer <= 0 || Math.hypot(g.x - this.pos.x, g.z - this.pos.z) < 0.7) {
            this.target = null;
            this.enter('idle', 2 + Math.random() * 5);
          } else speed = this.state === 'wander' ? WANDER_SPEED : INVESTIGATE_SPEED;
          break;
        }
        case 'chase':
          if (player.dead) { this.enter('idle', 3); this.target = null; break; }
          if (dist < REACH && sees) {
            this.enter('attack', WINDUP);
          } else speed = CHASE_SPEED;
          break;
        case 'attack':
          this.facing = U.turnToward(this.facing, Math.atan2(dx, dz), 4 * dt);
          this.timer -= dt;
          this.reach = Math.min(1, 1 - this.timer / WINDUP + 0.15);
          if (this.timer <= 0) {
            const hit = combat ? combat.zombieStrike(this, player, dist) : false;
            this.enter('recover', hit ? 0.9 : 0.6);
          }
          break;
        case 'recover':
          this.timer -= dt;
          this.reach = Math.max(this.reach, 0.5);
          this.facing = U.turnToward(this.facing, Math.atan2(dx, dz), 3 * dt);
          if (this.timer <= 0) this.enter('chase', 0);
          break;
        case 'bang':
          this.updateBang(dt, player, dist, sees);
          break;
      }

      let moved = 0;
      if (speed > 0 && this.target) moved = this.stepToward(this.target, speed, dt);
      this.speedNow = moved;

      if (speed > 0 && moved < speed * 0.25 && this.state !== 'bang' && this.state !== 'climb') {
        this.stuck += dt;
        if (this.stuck > 1.2) { this.clear = false; this.clearTimer = 1; this.pathTimer = 0; }
        if (this.stuck > 6) { this.target = null; this.enter('idle', 2); }
      } else this.stuck = Math.max(0, this.stuck - dt);

      // separación entre zombis
      for (let i = 0; i < all.length; i++) {
        const o = all[i];
        if (o === this || !o.alive || o.downed) continue;
        const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
        const d2 = ox * ox + oz * oz;
        if (d2 < 0.3 && d2 > 1e-4) {
          const d = Math.sqrt(d2), push = (0.55 - d) * 0.5;
          G.World.move(this.pos, ox / d * push, oz / d * push, RADIUS);
        }
      }
      // no atravesar al jugador
      if (!player.dead && dist < 0.55 && dist > 1e-3) {
        const push = (0.55 - dist);
        G.World.move(this.pos, -dx / dist * push, -dz / dist * push, RADIUS);
      }

      this.phase += dt * (1.4 + this.speedNow * 5.5);
      this.apply(dt);
    }

    knockback(dt) {
      const k = this.kb;
      if (Math.abs(k.x) + Math.abs(k.z) < 0.01) return;
      G.World.move(this.pos, k.x * dt, k.z * dt, RADIUS);
      const f = Math.max(0, 1 - dt * 5);
      k.x *= f; k.z *= f;
    }

    // ---------- Puertas, ventanas y vallas ----------
    updateBang(dt, player, dist, sees) {
      const W = G.World, E = W.E;
      const ref = this.edge;
      const e = ref ? W.edgeGet(ref) : E.NONE;
      if (!ref || !W.blocksWalkEdge(e)) { this.edge = null; this.enter(this.resume, 12); return; }
      if (W.climbableEdge(e)) { this.startClimb(ref, e); return; }
      const mx = ref.o === 'N' ? ref.x + 0.5 : ref.x, mz = ref.o === 'N' ? ref.z : ref.z + 0.5;
      this.facing = U.turnToward(this.facing, Math.atan2(mx - this.pos.x, mz - this.pos.z), 4 * dt);
      this.bangT += dt;
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 1;
        W.emit(mx, mz, 9);
        if (W.damageEdge(ref, 1)) {
          const after = W.edgeGet(ref);
          if (W.climbableEdge(after)) this.startClimb(ref, after);
          else { this.edge = null; this.enter(this.resume, 12); }
        }
      }
      // si deja de oír o ver al jugador durante mucho rato, se rinde
      if (!sees && this.bangT > 25 && dist > 12) { this.edge = null; this.target = null; this.enter('idle', 3); }
    }

    startClimb(ref, e) {
      const mx = ref.o === 'N' ? ref.x + 0.5 : ref.x, mz = ref.o === 'N' ? ref.z : ref.z + 0.5;
      const nx = ref.o === 'N' ? 0 : 1, nz = ref.o === 'N' ? 1 : 0;
      const side = (this.pos.x - mx) * nx + (this.pos.z - mz) * nz > 0 ? 1 : -1;
      const tx = mx - nx * side * 0.6, tz = mz - nz * side * 0.6;
      if (G.World.circleBlocked(tx, tz, RADIUS)) { this.edge = null; this.enter('idle', 2); return; }
      this.climbing = { x0: this.pos.x, z0: this.pos.z, x1: tx, z1: tz, t: 0, dur: e === G.World.E.FENCE ? 1.4 : 2.0 };
      this.facing = Math.atan2(tx - this.pos.x, tz - this.pos.z);
      this.edge = null;
      this.state = 'climb';
    }

    // Avanza hacia la meta: en línea recta si se puede, si no con A*
    stepToward(goal, speed, dt) {
      const W = G.World;
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) {
        this.clear = W.hasClearLine(this.pos.x, this.pos.z, goal.x, goal.z);
        this.clearTimer = 0.25;
      }
      let gx = goal.x, gz = goal.z;
      if (!this.clear) {
        this.pathTimer -= dt;
        if (this.pathTimer <= 0) {
          this.path = W.findPath(this.pos.x, this.pos.z, goal.x, goal.z);
          this.pathTimer = 1 + Math.random() * 0.6;
        }
        if (this.path) {
          while (this.path.length && Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < 0.35) this.path.shift();
          if (this.path.length) {
            gx = this.path[0].x; gz = this.path[0].z;
            // ¿hay una puerta, ventana o valla entre esta casilla y la siguiente?
            const tx = Math.floor(this.pos.x), tz = Math.floor(this.pos.z);
            const nx = Math.floor(gx), nz = Math.floor(gz);
            if (Math.abs(nx - tx) + Math.abs(nz - tz) === 1) {
              const ref = W.edgeRefBetween(tx, tz, nx, nz);
              const e = W.edgeGet(ref);
              if (W.blocksWalkEdge(e)) {
                const mx = ref.o === 'N' ? ref.x + 0.5 : ref.x, mz = ref.o === 'N' ? ref.z : ref.z + 0.5;
                const dEdge = ref.o === 'N' ? Math.abs(this.pos.z - mz) : Math.abs(this.pos.x - mx);
                if (dEdge < 0.6) {
                  this.resume = this.state === 'chase' ? 'chase' : 'investigate';
                  if (W.climbableEdge(e)) { this.startClimb(ref, e); return 0; }
                  this.edge = ref; this.bangT = 0;
                  this.state = 'bang'; this.timer = 0.6;
                  return 0;
                }
                // ir hacia el centro de la arista
                gx = ref.o === 'N' ? mx : gx; gz = ref.o === 'N' ? gz : mz;
                if (ref.o === 'N') gz = mz + (tz < nz ? -0.3 : 0.3);
                else gx = mx + (tx < nx ? -0.3 : 0.3);
              }
            }
          }
        }
      } else this.path = null;

      const ddx = gx - this.pos.x, ddz = gz - this.pos.z;
      const d = Math.hypot(ddx, ddz);
      if (d < 0.01) return 0;
      this.facing = U.turnToward(this.facing, Math.atan2(ddx, ddz), 3 * dt);
      const step = speed * dt;
      const bx = this.pos.x, bz = this.pos.z;
      W.move(this.pos, ddx / d * step, ddz / d * step, RADIUS);
      return Math.hypot(this.pos.x - bx, this.pos.z - bz) / Math.max(dt, 1e-4);
    }

    // ---------- Modelo ----------
    apply(dt) {
      const m = this.model;
      this.y += (G.World.groundY(this.pos.x, this.pos.z) - this.y) * Math.min(1, (dt || 0.016) * 10);
      m.root.position.set(this.pos.x, this.y + (this.lift || 0), this.pos.z);
      m.root.rotation.y = this.facing;
      G.Models.poseZombie(m, {
        phase: this.phase, amt: Math.min(1, this.speedNow / 0.9) * 0.7,
        chase: this.state === 'chase' || this.state === 'attack' || this.state === 'recover' || this.state === 'bang',
        armsUp: this.look.armsUp || 0,
        reach: this.reach, stagger: this.state === 'stagger' ? this.stagger : 0,
        bang: this.state === 'bang' ? this.bangT : 0,
        drag: this.look.drag, seed: this.look.seed % 7, lean: this.lean, tilt: this.tilt,
        dt: dt || 0.016, time: (this.time = (this.time || 0) + (dt || 0))
      });
      if (this.fall > 0) G.Models.poseFall(m, this.fall, this.fallDir);
      else { m.body.rotation.x = 0; m.body.position.y = 0; }
    }

    // Datos para dormirlo y despertarlo después
    snapshot() {
      return { x: this.pos.x, z: this.pos.z, facing: this.facing, look: this.look, hp: this.hp, dead: !this.alive, fallDir: this.fallDir };
    }
  }

  Zombie.randomLook = randomLook;
  G.Zombie = Zombie;
})(window.Game = window.Game || {});
