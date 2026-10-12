(function (G) {
  'use strict';

  // Cámara en tercera persona sobre el hombro. Se acerca al apuntar y se
  // pega al personaje cuando hay paredes, techos o árboles detrás.

  const U = G.Util;
  const HEAD = 1.55;
  const DIST = 3.1, DIST_AIM = 1.8;
  const SHOULDER = 0.45, SHOULDER_AIM = 0.55;
  const PITCH_MIN = -0.45, PITCH_MAX = 1.05;

  const Cam = {
    yaw: Math.PI,      // mirando hacia -Z al empezar (hacia la puerta de la casa inicial)
    pitch: 0.28,
    dist: DIST,
    shoulder: SHOULDER,
    camera: null,
    near: false,        // la cámara quedó muy cerca del personaje
    dir: new THREE.Vector3(),
    pos: new THREE.Vector3(),

    init(camera) { this.camera = camera; },

    forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; },
    right() { return { x: -Math.cos(this.yaw), z: Math.sin(this.yaw) }; },

    update(dt, player, input, sens) {
      sens = sens || 1;
      this.yaw -= input.look.x * sens;
      this.pitch = U.clamp(this.pitch + input.look.y * sens, PITCH_MIN, PITCH_MAX);
      const aiming = player.aiming;
      const wantD = aiming ? DIST_AIM : DIST;
      const wantS = aiming ? SHOULDER_AIM : SHOULDER;
      this.shoulder += (wantS - this.shoulder) * Math.min(1, dt * 8);

      const f = this.forward(), r = this.right();
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      // dirección de la mirada (adelante y un poco hacia abajo)
      this.dir.set(f.x * cp, -sp, f.z * cp);
      const hx = player.pos.x, hy = player.y + HEAD - 0.42 * (player.crouchAmt || 0), hz = player.pos.z;
      // posición deseada
      const tx = hx + r.x * this.shoulder - this.dir.x * wantD;
      const ty = hy - this.dir.y * wantD + 0.15;
      const tz = hz + r.z * this.shoulder - this.dir.z * wantD;
      const free = sweep(hx, hy, hz, tx, ty, tz);
      const d = Math.max(0.05, free * wantD);
      if (d < this.dist) this.dist = d;                       // acercarse rápido
      else this.dist += (d - this.dist) * Math.min(1, dt * 5); // alejarse suave
      const k = this.dist / wantD;
      this.pos.set(hx + (tx - hx) * k, hy + (ty - hy) * k, hz + (tz - hz) * k);
      this.camera.position.copy(this.pos);
      this.camera.lookAt(this.pos.x + this.dir.x, this.pos.y + this.dir.y, this.pos.z + this.dir.z);
      this.near = this.dist < 0.55;
    }
  };

  // Devuelve la fracción libre (0 a 1) del recorrido cabeza -> cámara
  function sweep(x0, y0, z0, x1, y1, z1) {
    const W = G.World, E = W.E;
    const steps = 32;
    let px = x0, pz = z0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
      const tx = Math.floor(x), tz = Math.floor(z);
      const ptx = Math.floor(px), ptz = Math.floor(pz);
      let hit = false;
      // aristas cruzadas en este paso
      const test = (e) => {
        if (e === E.NONE) return false;
        if (e === E.FENCE) return y < W.FENCE_H + 0.1;
        if (e === E.DOOR_OPEN || e === E.DOOR_BROKEN || e === E.ARCH) return y > W.DOOR_H - 0.15;
        return true;
      };
      if (tx !== ptx || tz !== ptz) hit = W.lineBlocked(px, pz, x, z, test);
      // techo
      if (!hit && W.isIndoor(tx, tz) && y > W.WALL_H - 0.18) hit = true;
      if (!hit && W.isIndoor(ptx, ptz) && !W.isIndoor(tx, tz) && y > W.DOOR_H) hit = true;
      // distancia mínima a paredes y troncos
      if (!hit && y < W.WALL_H + 0.2 && W.circleBlocked(x, z, 0.16)) hit = true;
      if (!hit && y < W.DOOR_H + 0.05 && W.nearDoorLeaf(x, z, 0.14)) hit = true;
      if (hit) return Math.max(0, (i - 1.6) / steps);
      px = x; pz = z;
    }
    return 1;
  }

  G.Camera = Cam;
})(window.Game = window.Game || {});
