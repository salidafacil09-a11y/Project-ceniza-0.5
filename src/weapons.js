(function (G) {
  'use strict';

  // Armas cuerpo a cuerpo. Categorías como en el original:
  //   lblunt  contundente larga (dos manos)    sblunt  contundente corta (una mano)
  //   axe     hacha                            lblade  hoja larga
  //   sblade  hoja corta (cuchillos)           spear   lanza
  //
  // range: alcance en metros · dmg: daño mínimo y máximo (un zombi tiene de 2.4 a 3.4 de vida)
  // speed: segundos por golpe · crit: probabilidad y multiplicador de crítico
  // hits: zombis que puede golpear de una vez · knock: probabilidad de derribar
  // stam: resistencia que gasta cada golpe · cond: golpes que aguanta antes de romperse
  // lower: 1 de cada N golpes gasta durabilidad (más alto = más resistente)

  const LIST = [
    { id: 'bate', name: 'Bate de béisbol', cat: 'lblunt', hands: 2, range: 1.3, dmg: [0.8, 1.3], speed: 0.85, crit: [0.2, 2], hits: 2, knock: 0.35, stam: 0.05, cond: 12, lower: 15, len: 0.86 },
    { id: 'bate_clavos', name: 'Bate con clavos', cat: 'lblunt', hands: 2, range: 1.3, dmg: [1.0, 1.6], speed: 0.9, crit: [0.25, 2], hits: 2, knock: 0.3, stam: 0.055, cond: 10, lower: 14, len: 0.86 },
    { id: 'golf', name: 'Palo de golf', cat: 'lblunt', hands: 2, range: 1.4, dmg: [0.5, 0.9], speed: 0.75, crit: [0.15, 2], hits: 2, knock: 0.2, stam: 0.04, cond: 7, lower: 8, len: 1.0 },
    { id: 'mazo', name: 'Mazo', cat: 'lblunt', hands: 2, range: 1.25, dmg: [2.0, 3.4], speed: 1.6, crit: [0.1, 2], hits: 3, knock: 0.9, stam: 0.12, cond: 18, lower: 40, len: 0.9 },
    { id: 'pala', name: 'Pala', cat: 'lblunt', hands: 2, range: 1.45, dmg: [0.8, 1.4], speed: 1.0, crit: [0.15, 2], hits: 2, knock: 0.4, stam: 0.07, cond: 10, lower: 15, len: 1.15 },
    { id: 'tabla', name: 'Tabla de madera', cat: 'lblunt', hands: 2, range: 1.35, dmg: [0.5, 0.9], speed: 0.8, crit: [0.1, 2], hits: 2, knock: 0.25, stam: 0.05, cond: 5, lower: 6, len: 1.0 },
    { id: 'tabla_clavos', name: 'Tabla con clavos', cat: 'lblunt', hands: 2, range: 1.35, dmg: [0.7, 1.2], speed: 0.85, crit: [0.15, 2], hits: 2, knock: 0.25, stam: 0.05, cond: 6, lower: 7, len: 1.0 },
    { id: 'palanca', name: 'Palanca', cat: 'sblunt', hands: 1, range: 1.1, dmg: [0.7, 1.1], speed: 0.7, crit: [0.2, 2], hits: 1, knock: 0.2, stam: 0.04, cond: 20, lower: 50, len: 0.75 },
    { id: 'martillo', name: 'Martillo', cat: 'sblunt', hands: 1, range: 0.95, dmg: [0.6, 1.0], speed: 0.65, crit: [0.25, 2], hits: 1, knock: 0.15, stam: 0.035, cond: 12, lower: 20, len: 0.35 },
    { id: 'llave', name: 'Llave inglesa', cat: 'sblunt', hands: 1, range: 0.95, dmg: [0.6, 1.0], speed: 0.7, crit: [0.2, 2], hits: 1, knock: 0.15, stam: 0.035, cond: 14, lower: 25, len: 0.36 },
    { id: 'sarten', name: 'Sartén', cat: 'sblunt', hands: 1, range: 0.95, dmg: [0.6, 1.0], speed: 0.8, crit: [0.15, 2], hits: 1, knock: 0.3, stam: 0.045, cond: 12, lower: 20, len: 0.46 },
    { id: 'tubo', name: 'Tubo de plomo', cat: 'sblunt', hands: 1, range: 1.1, dmg: [0.7, 1.2], speed: 0.75, crit: [0.2, 2], hits: 1, knock: 0.2, stam: 0.045, cond: 15, lower: 25, len: 0.62 },
    { id: 'rodillo', name: 'Rodillo de cocina', cat: 'sblunt', hands: 1, range: 0.9, dmg: [0.4, 0.7], speed: 0.6, crit: [0.15, 2], hits: 1, knock: 0.15, stam: 0.03, cond: 6, lower: 10, len: 0.44 },
    { id: 'porra', name: 'Porra policial', cat: 'sblunt', hands: 1, range: 1.05, dmg: [0.6, 1.0], speed: 0.6, crit: [0.2, 2], hits: 1, knock: 0.3, stam: 0.035, cond: 18, lower: 30, len: 0.6 },
    { id: 'hacha_bombero', name: 'Hacha de bombero', cat: 'axe', hands: 2, range: 1.3, dmg: [1.6, 2.4], speed: 1.1, crit: [0.3, 3], hits: 3, knock: 0.5, stam: 0.09, cond: 14, lower: 30, len: 0.92 },
    { id: 'hacha_mano', name: 'Hacha de mano', cat: 'axe', hands: 1, range: 1.0, dmg: [1.0, 1.6], speed: 0.8, crit: [0.25, 2.5], hits: 1, knock: 0.2, stam: 0.05, cond: 12, lower: 20, len: 0.45 },
    { id: 'machete', name: 'Machete', cat: 'lblade', hands: 1, range: 1.2, dmg: [1.0, 1.6], speed: 0.7, crit: [0.3, 2.5], hits: 2, knock: 0.15, stam: 0.045, cond: 10, lower: 15, len: 0.66 },
    { id: 'katana', name: 'Katana', cat: 'lblade', hands: 2, range: 1.35, dmg: [1.6, 2.6], speed: 0.75, crit: [0.35, 3], hits: 2, knock: 0.2, stam: 0.05, cond: 15, lower: 20, len: 1.0 },
    { id: 'cuchillo', name: 'Cuchillo de cocina', cat: 'sblade', hands: 1, range: 0.85, dmg: [0.5, 0.9], speed: 0.5, crit: [0.4, 2.5], hits: 1, knock: 0.05, stam: 0.025, cond: 6, lower: 6, len: 0.3 },
    { id: 'cuchillo_caza', name: 'Cuchillo de caza', cat: 'sblade', hands: 1, range: 0.85, dmg: [0.7, 1.1], speed: 0.5, crit: [0.4, 2.5], hits: 1, knock: 0.05, stam: 0.025, cond: 12, lower: 15, len: 0.32 },
    { id: 'destornillador', name: 'Destornillador', cat: 'sblade', hands: 1, range: 0.8, dmg: [0.4, 0.7], speed: 0.45, crit: [0.4, 2.5], hits: 1, knock: 0.05, stam: 0.02, cond: 8, lower: 8, len: 0.26 },
    { id: 'cuchilla', name: 'Cuchilla de carnicero', cat: 'sblade', hands: 1, range: 0.9, dmg: [0.8, 1.2], speed: 0.6, crit: [0.3, 2.5], hits: 1, knock: 0.1, stam: 0.03, cond: 10, lower: 12, len: 0.32 },
    { id: 'lanza', name: 'Lanza improvisada', cat: 'spear', hands: 2, range: 1.7, dmg: [0.8, 1.4], speed: 0.8, crit: [0.3, 2], hits: 1, knock: 0.25, stam: 0.05, cond: 8, lower: 8, len: 1.7 }
  ];

  const BY_ID = {};
  LIST.forEach((w) => { BY_ID[w.id] = w; });

  // Sin arma: solo empujón (como en el original)
  const FISTS = { id: 'manos', name: 'Manos', cat: 'none', hands: 0, range: 0.9, dmg: [0, 0], speed: 0.7, crit: [0, 1], hits: 1, knock: 0, stam: 0.03, cond: Infinity, lower: Infinity };

  // Qué se puede encontrar en cada tipo de habitación
  const LOOT = {
    cocina: { chance: 0.6, table: { sarten: 4, rodillo: 3, cuchillo: 5, cuchilla: 2 } },
    garaje: { chance: 0.85, table: { martillo: 4, llave: 4, palanca: 3, tubo: 3, mazo: 1, pala: 2, hacha_mano: 2, destornillador: 3, tabla: 2, tabla_clavos: 1 } },
    dormitorio: { chance: 0.3, table: { bate: 4, golf: 3, bate_clavos: 1, cuchillo_caza: 1, katana: 0.15 } },
    sala: { chance: 0.25, table: { golf: 2, bate: 2, tabla: 1, destornillador: 1 } },
    cabana: { chance: 0.9, table: { hacha_mano: 3, pala: 2, lanza: 2, tabla_clavos: 2, machete: 2, cuchillo_caza: 1 } },
    cochera: { chance: 1, table: { hacha_bombero: 6, palanca: 3, mazo: 1 } },
    oficina: { chance: 0.4, table: { porra: 2, destornillador: 1 } },
    archivo: { chance: 0.7, table: { porra: 4, cuchillo_caza: 1, machete: 1 } },
    recepcion: { chance: 0.25, table: { porra: 1, destornillador: 1 } },
    quirofano: { chance: 0.5, table: { cuchillo: 2, destornillador: 1 } },
    habitacion: { chance: 0.15, table: { destornillador: 1, rodillo: 1 } }
  };

  function lootFor(roomType, kind, rng) {
    const l = LOOT[roomType];
    if (!l) return [];
    const out = [];
    if (rng() < l.chance) out.push(G.Util.weighted(rng, l.table));
    if ((kind === 'bomberos' || kind === 'policia') && rng() < 0.4) out.push(G.Util.weighted(rng, l.table));
    return out;
  }

  // Armas largas: van a la espalda (máximo 2: una en las manos y otra a la espalda).
  // Las cortas van a los bolsillos, sin límite por ahora.
  function isLong(w) { return w.hands === 2 || (w.len || 0) >= 0.7; }

  // Efecto de cómo la agarras. A dos manos: un poco más de daño y de derribo.
  // Un arma de dos manos usada con una sola: menos daño, más lenta y menos precisa.
  function grip(w, two) {
    if (w.hands === 2) return two ? { dmg: 1, speed: 1, acc: 0, knock: 0 } : { dmg: 0.75, speed: 1.15, acc: -0.06, knock: -0.1 };
    return two ? { dmg: 1.15, speed: 1, acc: 0.03, knock: 0.05 } : { dmg: 1, speed: 1, acc: 0, knock: 0 };
  }

  G.Weapons = {
    LIST, FISTS, lootFor, isLong, grip,
    get(id) { return BY_ID[id] || FISTS; }
  };
})(window.Game = window.Game || {});
