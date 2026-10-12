# Ceniza

Juego de supervivencia zombi para navegador con cámara en tercera persona sobre el hombro. Mundo infinito generado por chunks, casas con interiores y combate cuerpo a cuerpo inspirado en los clásicos del género. Funciona en PC, en móvil y con mando.

> "Ceniza" es un nombre provisional. Es un proyecto inspirado en el género de supervivencia; todo el arte, el código y los nombres son propios.

## Estado

**Bloque 1: base y zombis lentos**
- Zombis lentos que caminan al azar; te persiguen si te ven de frente o si corres cerca

**Bloque 2: mundo infinito**
- Chunks de 32x32 que se generan al acercarte; lo que dejas atrás se conserva
- Los zombis lejanos se duermen y despiertan donde los dejaste

**Bloque 3: tercera persona, casas y combate**
- Cámara sobre el hombro que se acerca al apuntar y no atraviesa paredes, techos ni puertas
- Gráficos más suaves: personajes redondeados con esqueleto, sombras, niebla, texturas de suelo, techos a dos aguas
- Paredes finas entre casillas, como en el original
- 5 tipos de vivienda (4 casas y una cabaña) con varias habitaciones, girados hacia la calle
- 3 edificios raros: estación de bomberos, comisaría y hospital (en torno al 1,5 % de los edificios)
- Puertas que se abren y cierran, ventanas que se abren y por las que se puede saltar, vallas que se saltan
- Interruptor de luz en cada habitación y lámparas de techo que iluminan de verdad
- Farolas, aceras con bordillo, árboles y pinos grandes, arbustos
- 23 armas cuerpo a cuerpo repartidas por las casas según la habitación
- Combate: apuntar, golpes múltiples, críticos, derribos, empujón, pisotón, ataque al suelo, remate con cuchillo, desgaste y rotura de armas, resistencia
- Zombis que agarran, arañan, hacen laceraciones y muerden; los mordiscos infectan. Si te rodean cuatro, te derriban
- Los zombis golpean puertas hasta romperlas, rompen ventanas y trepan por ventanas y vallas

**Bloque 3.1: sigilo y objetivo**
- Agacharse: andas más despacio, no haces ruido al caminar y tus golpes y puertas suenan a la mitad
- De pie te ven a 14 m al instante; agachado solo a 6 m y tardan cerca de un segundo en notarte (de muy cerca, al momento)
- Caminando de pie te oyen solo a 2 m (a tu espalda); agachado, nada. Correr te levanta y se oye a 7 m
- Si un zombi ya te persigue, agacharte no lo despista: primero rompe su línea de visión
- Contorno amarillo en el zombi al que apuntas (en móvil, en el que tienes a tu alcance delante)

**Bloque 3.2: animaciones y armas**
- Animaciones más fluidas y rápidas: transiciones suaves entre poses, golpes que aceleran hasta el impacto, cadera y hombros que se balancean, respiración en reposo, cabeza que compensa el giro
- Agarre a una o dos manos: un arma corta a dos manos hace un 15 % más de daño; una larga con una mano hace un 25 % menos, es más lenta y solo golpea a un zombi
- Armas largas: máximo 2, una en las manos y otra a la espalda (se ve en el personaje). Armas cortas: en los bolsillos, sin límite
- Soltar el arma de las manos

## Controles

| Acción | Teclado y ratón | Móvil | Mando |
|---|---|---|---|
| Mover | WASD | Pulgar izquierdo | Stick izquierdo |
| Mirar | Ratón (clic para capturarlo) | Arrastrar a la derecha | Stick derecho |
| Correr | Shift | Botón Correr (activa y desactiva) | B o L3 |
| Agacharse | C | Agachar | R3 |
| Apuntar | Mantener clic derecho | Automático al atacar | LT |
| Atacar | Clic izquierdo | Atacar | RT |
| Empujar / pisotear | Espacio | Empujar | X o RB |
| Usar | E | Usar | A |
| Cambiar arma | Q o rueda | Arma | Y |
| Una o dos manos | V | 1/2 manos (arriba a la derecha) | LB |
| Soltar arma | G | Soltar (arriba a la derecha) | Select |
| Pausa | Esc o P | II | Start |

## Armas

Contundentes largas: bate, bate con clavos, palo de golf, mazo, pala, tabla, tabla con clavos.
Contundentes cortas: palanca, martillo, llave inglesa, sartén, tubo de plomo, rodillo, porra policial.
Hachas: hacha de bombero, hacha de mano. Hojas largas: machete, katana.
Hojas cortas: cuchillo de cocina, cuchillo de caza, destornillador, cuchilla de carnicero. Lanza improvisada.

Armas largas (bates, palos, mazo, pala, tablas, palanca, hacha de bombero, katana, lanza): máximo 2, una en las manos y otra a la espalda. Si coges una tercera, sueltas la que tengas en las manos. Con dos largas no te quedan manos libres para las cortas: suelta una (G). Armas cortas: en los bolsillos, sin límite. Sin arma solo puedes empujar y pisotear.

## Cómo probarlo

Abre `index.html` en el navegador (necesita conexión para cargar Three.js desde el CDN).

Opciones en la dirección (se pueden combinar con `&`):
- `?debug` muestra fotogramas, llamadas de dibujo, chunks, zombis y la semilla
- `?seed=123` repite el mismo mundo
- `?armas` pone todas las armas en la calle, junto a la casa inicial
- `?calidad=baja` quita las sombras, para móviles muy justos

## Publicar en GitHub Pages

1. Sube todos los archivos a la raíz del repositorio, con la carpeta `src`.
2. En el repositorio: Settings, Pages, Source "Deploy from a branch", rama `main`, carpeta `/ (root)`.
3. En uno o dos minutos estará en `https://TU_USUARIO.github.io/NOMBRE_DEL_REPO/`.

## Estructura

```
index.html        página, HUD y controles táctiles
style.css         estilos
src/
  util.js         ayudas (aleatorio con semilla, ángulos, colores)
  mesher.js       une muchas piezas en una sola malla
  buildings.js    plantillas de edificios por habitaciones
  weapons.js      las 23 armas y qué aparece en cada habitación
  world.js        chunks infinitos, paredes, colisiones, línea de vista, rutas
  worldview.js    modelos 3D del mundo, puertas, ventanas, luces
  models.js       personajes con esqueleto, animaciones y modelos de armas
  input.js        teclado, ratón, táctil y mando
  camera.js       cámara en tercera persona
  player.js       jugador: movimiento, resistencia, heridas, armas
  zombie.js       zombi: sentidos, persecución, puertas, golpes recibidos
  population.js   zombis por chunk: crear, dormir y despertar
  combat.js       combate cuerpo a cuerpo
  interact.js     puertas, ventanas, vallas, interruptores y recoger armas
  main.js         bucle principal, luces, HUD
```

## Ajustes rápidos

- Dificultad de los zombis: constantes al inicio de `src/zombie.js` (vida, velocidad, visión)
- Armas: tabla al inicio de `src/weapons.js` (daño, alcance, velocidad, durabilidad); bonus a dos manos en `grip()`
- Ritmo de los ataques: `ANIM` en `src/combat.js`; suavidad de las animaciones: números de `blend(...)` en `src/models.js`
- Distancia a la que te oyen correr o caminar: `NOISE_RUN` y `NOISE_WALK` en `src/player.js` (pon `NOISE_WALK = 0` para que caminar de pie sea silencioso)
- Sigilo: `CROUCH_SIGHT` y `NOTICE_TIME` en `src/zombie.js`
- Distancia de la cámara: constantes al inicio de `src/camera.js`
- Niebla: `scene.fog` en `src/main.js`
- Probabilidad de edificios raros: `specialQ` en `src/world.js`

## Plan de bloques

1. Base y zombis lentos (hecho)
2. Mundo infinito por chunks (hecho)
3. Tercera persona, casas con interiores y combate (hecho)
4. Casas de dos pisos y con sótano (escaleras)
5. Supervivencia: hambre, sed, cansancio, vendajes y curación
6. Inventario, muebles y saqueo
7. Día y noche, clima
8. Pulido: guardado, sonido, PWA y optimización móvil

## Licencia

Añade una licencia al repositorio (por ejemplo MIT) antes de publicarlo. Three.js se carga desde un CDN y tiene su propia licencia (MIT).
