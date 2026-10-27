# MC Hosting Panel

Panel web propio para crear y administrar servidores de **Minecraft Java** en tu PC con Windows, y que tus amigos se conecten desde su casa.

- Crea servidores **Paper, Fabric, Forge, NeoForge o Vanilla** eligiendo tipo y versión; el panel descarga el servidor y el **Java correcto** (Eclipse Temurin) sin que instales nada.
- **Tablero de inicio** con una tarjeta por servidor: su ícono, las caras de los jugadores conectados, mini gráficas de la última hora (jugadores, RAM, TPS) y un indicador de salud.
- **Consola en vivo** con los colores reales de Minecraft, filtros (chat, avisos y errores, comandos), búsqueda, nombres de jugador que se tocan para darles objetos, cambiar su modo, curarlos, hacerlos operador o expulsarlos, historial de comandos, jugadores conectados, CPU, RAM y tiempo encendido, y **comandos rápidos configurables**: agrega, quita y ordena botones; con huecos como `{jugador}` u `{objeto}` el panel te pregunta el dato con la lista de jugadores conectados o un buscador de objetos, efectos, encantamientos y criaturas con su nombre en español.
- **Marketplace** de mods, plugins y datapacks desde **Modrinth**, **Hangar** (PaperMC) y **CurseForge** (con tu clave gratis) en tarjetas con imagen, descargas y fecha, y una ficha con galería y descripción completa; filtrado por la versión del servidor, con dependencias automáticas, activar/desactivar y búsqueda de actualizaciones.
- Gestión completa: `server.properties` con formulario, jugadores (lista blanca, operadores, baneos, expulsar), **gestor de archivos** (selección múltiple, copiar, mover, comprimir, descargar varios en .zip, búsqueda por nombre, subir archivos y carpetas completas con barra de progreso, editor de texto, extraer .zip, y protección del mundo mientras el servidor está encendido), **editor NBT** para `level.dat`, datos de jugadores (inventario, posición, vida, experiencia) y estructuras, con copia `.panel-bak` antes de guardar, **respaldos** manuales y automáticos con restauración, cambio de versión, reinicio automático si el servidor se cae.
- **Crossplay con Bedrock** (celular, Windows, consolas) con un clic: instala Geyser, Floodgate (sin cuenta de Java) y ViaVersion cuando hace falta, y configura el puerto de cada servidor (en TCP y UDP, como pide NetherNet). Funciona en Paper (casi cualquier versión), y en Fabric/NeoForge en la versión más reciente.
- **Túneles de playit.gg integrados** para cuando tu internet tiene CGNAT: vinculas tu cuenta una vez y cada servidor obtiene su dirección pública (Java y Bedrock) con un clic. También puedes vincular túneles que creaste tú en playit.gg y **usar un agente que ya tienes** (el del programa oficial, que el panel detecta solo, o pegando su clave) en vez de crear uno nuevo.
- **Dominio para cada servidor** con **deSEC**, **DuckDNS** o **Cloudflare**: apunta a la IP de tu casa o al túnel de playit, y el panel crea y actualiza los registros (A y SRV). Con deSEC o Cloudflare tus amigos de Java entran solo con el nombre, sin puerto, aunque uses playit.
- **Datapacks en cualquier servidor** (Vanilla, Paper, Fabric, Forge, NeoForge): búscalos en Modrinth o CurseForge, aplícalos sin reiniciar (`minecraft:reload`), el panel avisa cuáles cambian la generación del mundo y al crear un mundo nuevo puedes copiarle los datapacks.
- **Modpacks de Modrinth y CurseForge:** búscalo o sube el `.mrpack` / `.zip` y el panel crea el servidor con el loader, la versión, los mods y la configuración. Los mods que solo sirven en el juego se omiten en el servidor (en CurseForge se revisa cada jar).
- **Actualizar el modpack** a otra versión en el mismo servidor, con respaldo antes; el mundo y tus mods se quedan.
- **Modpack para los jugadores:** un archivo con el modpack completo, los mods que agregaste y tu servidor ya puesto en Multijugador, para importarlo en Modrinth App, CurseForge App o Prism Launcher. Los mods del pack que quitaste o desactivaste en el servidor no se incluyen.
- **Consolas con MCXboxBroadcast:** el servidor aparece en la pestaña Amigos de Xbox, PlayStation y Switch; el panel muestra el código para iniciar sesión con Xbox.
- **Tareas programadas:** reinicios diarios con avisos en el chat y respaldo previo, mensajes automáticos, respaldos y comandos a horas fijas o cada cierto tiempo.
- **Rendimiento:** gráficas de TPS, jugadores, memoria y CPU de la última hora a los últimos 7 días.
- **Inventario visual** de cada jugador como en el juego (armadura, mano secundaria, inventario, barra rápida y cofre de Ender): arrastra objetos, cambia cantidades o pon objetos nuevos con el buscador.
- **Mapa del mundo en 3D** con BlueMap dentro del panel, con los jugadores en vivo (Paper, Fabric, Forge y NeoForge). Eliges la **velocidad de dibujo** (Normal, Rápida o Máxima según los núcleos de tu PC) y si se **pausa mientras hay jugadores**.
- **Pregenerar el mundo** con Chunky desde Mundos: radio con atajos, dimensión, forma, centro y borde del mundo opcional; ves el avance, la velocidad y cuánto falta, y puedes pausar, continuar o cancelar.
- **Actualizar Paper, Fabric, Forge, NeoForge o Minecraft con un clic:** respaldo completo antes, apagado y encendido automáticos, aviso de qué plugins o mods tienen versión para la nueva y actualización de esos; con **Deshacer** si algo sale mal.
- **Actividad:** ranking de jugadores (tiempo jugado, bloques minados, distancia, mobs, muertes…), mapa de calor de cuándo se juega y línea de tiempo de entradas, salidas, caídas y respaldos.
- **Cómo se ve en la lista de servidores:** editor del mensaje (MOTD) con colores y formato, y del ícono: subes cualquier foto, eliges la parte con zoom y arrastre, y queda en 64×64. Vista previa idéntica a la de Minecraft.
- **Optimización de un clic:** parámetros de Java de Aikar, distancias y guardado de chunks, ajustes de Paper y mods de rendimiento (Lithium, FerriteCore, ModernFix) en Fabric, Forge y NeoForge. Se puede deshacer.
- **Revisión general** de cada servidor en una lista con palomitas: Java, puerto, firewall, túnel, dominio, respaldos, disco, memoria y seguridad.
- **Notificaciones del navegador** cuando alguien entra o un servidor se cae, y el panel se puede **instalar como app**.
- **Mundos:** varios mundos por servidor, crear con semilla y tipo, importar desde .zip, descargar y cambiar entre ellos.
- **Logs y diagnóstico:** búsqueda en todos los logs (también los antiguos .gz), lectura de crash reports y explicación en español de las causas comunes (falta de memoria, mods que faltan o chocan, Java incorrecto, puerto ocupado…).
- **Seguridad:** revisión por servidor con arreglos de un clic, protección contra oleadas de bots (bloqueo temporal de IP y lista blanca de emergencia), panel limitado a tu red, historial de inicios de sesión, y una guía sobre DDoS (qué se puede y qué no se puede hacer desde casa).
- **Clonar servidores** para probar mods o versiones sin arriesgar el original.
- **Página pública e invitación** (`/estado/<servidor>`): un enlace sin sesión con el estado, el MOTD como en el juego, quién juega, la dirección correcta y cómo entrar en Java y Bedrock. Se activa por servidor en Conexión y eliges qué mostrar.
- **Horario de energía**: pinta en una cuadrícula semanal las horas en que el servidor debe estar encendido; se enciende y se apaga solo (esperando a que salga el último jugador si quieres).
- **Modo mantenimiento**: MOTD con el aviso, lista blanca temporal con quienes ayudan y expulsión de los demás; al terminar, todo vuelve como estaba.
- **Simulacro de caída**: cierra el proceso a propósito y comprueba en vivo que el reinicio automático y las notificaciones funcionan.
- **Copia de respaldos en la nube**: cada respaldo se copia a la carpeta de OneDrive, Google Drive, Dropbox o iCloud (el panel las detecta), y la Revisión avisa si la copia se queda atrás.
- **Logros del servidor** ("Cien horas", "Fiesta", "Roca sólida"…) con avance, cartel de logro al conseguirlos y registro en la actividad.
- **Chat en el panel**: lo que dicen los jugadores, entradas, salidas y muertes; escribe como Servidor y menciona con @nombre.
- **Tarjeta de jugador** descargable como imagen, con su cara y sus estadísticas.
- **Qué cambió**: el changelog de cada versión de un plugin o mod (Modrinth y Hangar) y los cambios de cada build de Paper, con las frases de riesgo resaltadas, antes de actualizar.
- **Zonas con alerta**: rectángulos del mundo con nombre; cuando alguien entra, el panel avisa y lo registra. La lista de jugadores muestra dónde está cada uno.
- **Cómo creció el mundo**: tamaño en disco y regiones por día.
- **Widget flotante**: una ventana pequeña siempre encima (Chrome y Edge) con la lámpara, los jugadores y el botón de encender.
- **Fondos vivos**: el mapa de BlueMap de tu mundo o la skin de un jugador girando en 3D, además de paletas por bioma (jungla, desierto, taiga, cerezo, pantano, champiñón) y sonidos del juego sintetizados (ding al entrar, cofre al respaldar, fanfarria de logro).
- **El panel se actualiza solo** desde Ajustes (con git o con el instalador) y puede **abrirse al iniciar Windows**.
- **Perfil y apariencia**, a tu gusto y guardado en el panel (se ve igual desde cualquier equipo): tu **propia foto de fondo** (súbela o arrástrala; ajuste, posición, oscurecer, desenfoque y pixelado), **color de acento** (pasto, esmeralda, prismarina, diamante, amatista, oro, cobre o redstone), letra pixelada o clásica en tres tamaños, opacidad y desenfoque del cristal, y el borde eléctrico o la lámpara de redstone.
- **Dos apariencias**: **Cristal**, un vidrio líquido al estilo de las apps de Apple que dobla la luz en los bordes (lente SVG en Chrome y Edge), con brillos especulares, cápsulas y un fondo con luz de pasto, prismarina y amatista; y **Bloques**, la interfaz del juego con acabado premium. Todo el panel, consola incluida, se escribe con la **letra pixelada del juego** (Pixelify Sans). En **Perfil y apariencia** (menú lateral) eliges el tema y, con Cristal, el **fondo** con vista previa: Aurora, Cueva (menas que laten), Atardecer (nubes sobre el panorama de la portada), Fin (estrellas que titilan), Nether (brasas que suben), Océano (luz que ondula) o Nevada (nieve cayendo); cada uno tiene una capa animada ligera que puedes apagar y que se detiene sola si tu sistema pide reducir el movimiento. En el tablero y en la barra lateral, cada servidor lleva un **borde eléctrico** animado cuyo color dice su estado: verde encendido, ámbar arrancando o apagando, rojo caído, azul instalando. Un bloque de pasto isométrico dibujado en CSS como marca, botones y losas con el bisel duro de las pantallas de Minecraft, grano de píxel sin archivos externos, barra de progreso como barra de experiencia, pestañas como las del inventario, avisos como el cartel de un logro, el menú de jugador como el tooltip de un objeto y una pantalla de acceso que recuerda a la pantalla de título. El nombre de cada servidor se escribe como en la lista del juego y su estado es una lámpara de redstone que se enciende, parpadea al arrancar y se pone roja si se cae.
- **Accesible:** se revisa con axe (WCAG 2.1 AA) en cada cambio; se usa con teclado y lector de pantalla.
- Pestaña **Conexión** con tus IP, el comando del firewall y una prueba real desde internet (Java y Bedrock).
- **Manual completo para abrir puertos**: firewall, router (con secciones para Totalplay, Telmex e Izzi), CGNAT, dominio gratis (DuckDNS / No-IP / SRV) y alternativas como playit.gg. Está en [`docs/ABRIR-PUERTOS.md`](docs/ABRIR-PUERTOS.md) y dentro del panel.

## Requisitos

- Windows 10 u 11, o **Linux** (Ubuntu, Debian, Oracle Linux…, también en ARM): mira [Linux y la nube](#linux-y-la-nube).
- Con el instalador no necesitas nada más. Con git: [Node.js 20 o más reciente](https://nodejs.org/es) (versión LTS).
- Internet para descargar servidores, Java y mods.
- RAM: unos 2–4 GB por servidor sin mods, 6 GB o más con modpacks.

## Instalación

### Con el instalador (recomendado)

1. Descarga `MC-Hosting-Panel-Setup-x.y.z.exe` de [Releases](https://github.com/Solebanjo117/mc-hosting-panel/releases/latest).
2. Ábrelo. No pide permisos de administrador ni instalar Node: trae lo que necesita. Puedes marcar **Abrir el panel al iniciar sesión en Windows**.
3. Se abre el navegador en `http://localhost:8080`: crea tu cuenta y tu primer servidor.

Para actualizar, entra a **Ajustes del panel → Actualizar el panel**: descarga la versión nueva, la instala encima y el panel se vuelve a abrir solo. Tus servidores, mundos y ajustes (carpeta `data`) nunca se borran, ni al desinstalar.

### Con git

1. Descarga el proyecto (`git clone https://github.com/Solebanjo117/mc-hosting-panel.git` o el ZIP desde GitHub).
2. Abre **`iniciar.bat`**. La primera vez instala dependencias y compila la interfaz; después se abre el navegador en `http://localhost:8080`.
3. Crea tu cuenta de administrador y tu primer servidor.
4. Para que entren tus amigos por internet sigue la **Guía para abrir puertos** del menú lateral.

La ventana negra es el panel: si la cierras, se apagan los servidores (de forma ordenada). Para que arranque solo al iniciar Windows activa **Ajustes del panel → Iniciar con Windows** (o ejecuta `scripts\inicio-automatico.bat`) y marca **Encender automáticamente** en los servidores que quieras.

Para actualizar usa **Ajustes del panel → Actualizar el panel** (hace `git pull`, instala dependencias y recompila solo si hace falta, y se reinicia) o `actualizar.bat`.

### Linux y la nube

El panel funciona igual en un servidor Linux: una VPS, Oracle Cloud (también la instancia gratuita ARM), una PC con Ubuntu o una Raspberry Pi 5. La guía completa está en [`docs/LINUX.md`](docs/LINUX.md) y dentro del panel (**Guía → Linux y la nube**). En resumen:

```bash
git clone https://github.com/Solebanjo117/mc-hosting-panel.git
cd mc-hosting-panel
npm ci && npm run build
npm start
```

- Para que arranque solo y se reabra tras actualizarse, usa el servicio de systemd que trae el proyecto: `scripts/mc-hosting-panel.service`.
- **No abras el puerto del panel (8080) a internet**: el panel rechaza esas conexiones por seguridad. Entra con un túnel SSH (`ssh -L 8080:localhost:8080 usuario@IP` y abre `http://localhost:8080`) o con Tailscale.
- Abre los puertos de **Minecraft** (25565/TCP, y 19132 en TCP y UDP para Bedrock) en los dos firewalls: el de tu nube (en Oracle, la *Security List*) y el del sistema (iptables, ufw o firewalld).

### Scripts incluidos

| Archivo | Para qué sirve |
|---|---|
| `iniciar.bat` | Prepara (la primera vez) y abre el panel; lo vuelve a abrir tras actualizar desde Ajustes |
| `actualizar.bat` | Baja la última versión con `git pull` y recompila; no toca tus servidores |
| `restablecer-contrasena.bat` | Si olvidaste la contraseña: muestra tu usuario y pone una nueva (solo en la PC del panel) |
| `scripts\abrir-firewall.bat` | Crea la regla del Firewall de Windows para el puerto de un servidor (TCP para Java; TCP y UDP para Bedrock) |
| `scripts\inicio-automatico.bat` | Activa o quita el arranque del panel con Windows |
| `scripts/mc-hosting-panel.service` | En Linux: servicio de systemd para que el panel arranque solo y se reabra al actualizarse |
| `scripts/restablecer-contrasena.mjs` | En Linux: `node scripts/restablecer-contrasena.mjs` para poner una contraseña nueva |

## Dónde se guardan las cosas

Todo vive en la carpeta `data/` (no se sube a Git):

```
data/
  db.json          cuenta, ajustes, servidores, tareas programadas
  metrics/         historial de rendimiento (7 días)
  activity/        entradas, salidas y eventos de cada servidor (90 días)
  cache/gamedata/  listas de objetos y nombres en español por versión
  modpacks/        el modpack de cada servidor (.mrpack o .zip de CurseForge)
  playit/          agente de playit.gg y su llave (playit.toml; al desvincular queda en playit.anterior.toml)
  servers/<id>/    cada servidor: mundos, mods, plugins, configuración
  backups/<id>/    respaldos .zip
  java/<versión>/  Java descargado automáticamente
```

Para mover el panel a otra PC copia la carpeta completa, incluida `data/`.

## Si olvidaste la contraseña

En la PC donde corre el panel abre **Restablecer contraseña**: en el menú Inicio (*MC Hosting Panel - Restablecer contraseña*) si lo instalaste con el instalador, o `restablecer-contrasena.bat` en la carpeta del panel si usas git. Te muestra tu usuario, eliges una contraseña nueva (y si quieres otro usuario) y se aplica al momento, o al abrir el panel si estaba cerrado. Se cierran las sesiones abiertas y tus servidores no se tocan. No se puede hacer desde otro dispositivo: solo quien usa esa PC puede restablecerla.

## Seguridad

- El panel solo acepta conexiones de esta PC, tu red y Tailscale (configurable en Ajustes). Si alguien abre el 8080 en el router, los de internet ven "Acceso bloqueado".
- Bloquea peticiones enviadas desde otras páginas (CSRF), manda cabeceras de seguridad y guarda un historial de inicios de sesión.
- **No abras el puerto 8080 (el panel) en tu router.** Solo se abren los puertos de los servidores de Minecraft. Para administrar desde fuera de casa usa Tailscale (explicado en la guía).
- La llave de playit (`data/playit/playit.toml`) y los tokens de DuckDNS, deSEC o Cloudflare se guardan en `data/`; no compartas esa carpeta.
- La contraseña se guarda con bcrypt y la sesión en una cookie `httpOnly`. Tras 8 intentos fallidos el acceso se bloquea 10 minutos.
- Deja `online-mode=true` y usa la lista blanca si tu servidor es solo para amigos.

## Desarrollo

```bash
npm install
npm run dev          # API + WebSocket en http://localhost:8080 (se reinicia al guardar)
npm run dev:client   # interfaz con recarga en http://localhost:5173
npm run build        # compila la interfaz a dist/
```

Variables de entorno: `PORT` (puerto del panel), `MCP_DATA_DIR` (carpeta de datos).

### Estructura

```
server/
  index.js              Express + WebSocket, arranque y apagado ordenado
  auth.js               cuenta única, JWT en cookie
  ws.js                 estado, consola y progreso de instalación en vivo
  routes/               servers, files, backups, content (marketplace), system
  services/
    versions.js         catálogo de versiones (Mojang, PaperMC Fill v3, Fabric, Forge, NeoForge)
    installer.js        descarga e instala cada tipo de servidor
    java.js             Java requerido por versión (manifiesto de Mojang) y descarga de Temurin
    processManager.js   procesos de Java: iniciar, detener, reiniciar, consola, jugadores
    marketplace.js      Modrinth + Hangar: búsqueda, versiones, instalación, actualizaciones
    backups.js          respaldos zip (con save-off/save-all) y programación
    players.js          whitelist, ops y baneos (por comando o editando los JSON)
    properties.js       lectura/escritura de server.properties sin perder comentarios
    network.js          IP local/pública y prueba externa con mcsrvstat.us
    bedrock.js          crossplay: instala Geyser/Floodgate/ViaVersion y reserva puertos Bedrock
    geyserConfig.js     ajusta el puerto y la autenticación en el config.yml de Geyser
    playit.js           agente de playit.gg: vinculación, túneles por servidor (API de playit)
    dns.js              dominio por servidor (DuckDNS, deSEC, Cloudflare) hacia tu IP o el túnel de playit
    modpack.js          modpacks de Modrinth y CurseForge: importar, actualizar y archivo para jugadores
    scheduler.js        tareas programadas con avisos en el chat
    metrics.js          historial de CPU, RAM, TPS y jugadores
    worlds.js           varios mundos por servidor
    quickCommands.js    comandos rápidos de la consola (plantillas con huecos)
    worldMap.js         mapa con BlueMap: instalación, configuración, velocidad de dibujo y proxy dentro del panel
    pregen.js           pregenerar el mundo con Chunky (comandos y lectura del avance en la consola)
    softwareUpdate.js   actualizar Paper/Fabric/Forge/NeoForge/Minecraft con respaldo y Deshacer
    appUpdate.js        actualizar el propio panel (git o GitHub Releases) y reiniciarlo
    startup.js          abrir el panel al iniciar Windows (acceso directo en Inicio)
    activity.js         línea de tiempo, mapa de calor y estadísticas de jugadores
    health.js           revisión general de cada servidor
    optimize.js         optimización de un clic (Aikar, server.properties, Paper, mods de rendimiento)
    curseforge.js       búsqueda e instalación desde CurseForge
    gameData.js         listas de objetos, efectos, encantamientos y entidades por versión, con nombres en español
    logs.js             lectura y búsqueda de logs y crash reports
    crashAnalyzer.js    explica en español las causas de un crash
    clone.js            copia un servidor con otros puertos
    security.js         revisión de seguridad y arreglos de un clic
    floodGuard.js       protección contra oleadas de conexiones
  lib/netguard.js       quién puede abrir el panel, cabeceras y protección CSRF
  lib/nbt.js            lectura y escritura de NBT (gzip, zlib o sin comprimir; UTF-8 modificado de Java)
client/                 React + Vite
test/                   pruebas automáticas (ver abajo)
docs/ABRIR-PUERTOS.md   manual de red (también se ve dentro del panel)
installer/              instalador de Windows (Inno Setup)
scripts/build-installer.mjs  prepara build/app con node.exe para el instalador
```

### Instalador de Windows

`.github/workflows/instalador.yml` lo construye en GitHub Actions: al publicar una etiqueta (`git tag v0.11.0 && git push --tags`) crea la versión en Releases con el `.exe`; también se puede correr a mano desde la pestaña Actions. Antes de publicarlo lo instala en silencio, comprueba que el panel abre y que reinstalar encima conserva `data`.

Para construirlo en tu PC: `npm run build`, `node scripts/build-installer.mjs` y `ISCC /DAppVersion=x.y.z installer\mc-hosting-panel.iss` (Inno Setup 6).

### Pruebas

```bash
npm test             # unitarias + casos de uso (unos 3 minutos)
npm run test:unit    # solo las unitarias (segundos, no necesitan Java)
npm run test:api     # solo los casos de uso
node test/run.js api/files   # un solo archivo
npm run test:e2e     # en el navegador (opcional, ver abajo)
```

Las pruebas de casos de uso arrancan el panel de verdad (`node server/index.js`) con una carpeta de datos temporal
y recorren lo que haría una persona: crear e instalar cada tipo de servidor, encender y apagar, consola,
jugadores, archivos, mundos, respaldos, marketplace, modpacks, Bedrock, playit.gg, dominios, tareas programadas,
seguridad, mapa, optimización, copias, ícono, comandos rápidos, sesión, WebSocket (y sus límites), pregenerar con
Chunky, actualizar el servidor con Deshacer y actualizar el propio panel.

- **Sin internet:** `test/helpers/mocks.js` simula Mojang, PaperMC, Fabric, Forge, NeoForge, Modrinth, Hangar,
  CurseForge, playit.gg, DuckDNS, deSEC, Cloudflare, mcsrvstat, GitHub y un DNS propio. El panel los usa gracias a
  la variable `MCP_URL_REWRITE` (solo para pruebas).
- **Necesitan Java 8 o más nuevo** en el PATH (o `JAVA_HOME`): el "servidor de Minecraft" es un programa pequeño
  (`test/fixtures/java/FakeServer.java`) que imprime lo mismo que uno real y responde a `join`, `leave`, `crash`,
  `flood`, `args`, etc. Si cambias los `.java`, recompila los `.jar`:

  ```bash
  cd test/fixtures/java
  javac --release 8 -d out FakeServer.java FakeInstaller.java
  jar cfe fake-server.jar FakeServer -C out .
  jar cfe fake-installer.jar FakeInstaller -C out .
  ```
- **En el navegador:** `npm run build`, luego `npm i --no-save playwright axe-core` y `npx playwright install chromium`,
  y `npm run test:e2e`. Además de los recorridos, revisa la accesibilidad de todas las pantallas con axe
  (WCAG 2.1 AA). Sin Playwright esas pruebas se omiten.
- GitHub Actions (`.github/workflows/pruebas.yml`) corre todo en Ubuntu y Windows en cada push.

Lo que no cubren: los servicios reales (si Modrinth, playit.gg o DuckDNS cambian su API, las pruebas no lo
notan), Minecraft de verdad con mods reales, y los archivos `.bat` de Windows.

## Limitaciones conocidas

- El inventario y los datos de jugadores se guardan con el servidor apagado (mientras corre, Minecraft reescribe esos archivos).
- BlueMap tarda en dibujar el mapa la primera vez y usa CPU mientras lo hace; solo dibuja lo ya explorado (pregenera el mundo para tenerlo completo). La posición de los jugadores se actualiza cada segundo: es lo que hace BlueMap y no se puede cambiar.
- Actualizar a otra versión de Minecraft convierte el mundo: para volver atrás se usa **Deshacer**, que restaura el respaldo (lo jugado después se pierde).
- Las notificaciones y la app instalable solo funcionan en páginas seguras: `http://localhost` en la PC del servidor, o HTTPS (por ejemplo con `tailscale serve`). Por la IP de la red local (`http://192.168…`) el navegador no las permite.
- Los nombres en español de objetos y criaturas vienen del archivo de idioma oficial de Mojang; los objetos de mods se muestran con su ID.

- Los servidores son de Java Edition; Bedrock entra a través de Geyser, que no existe para Forge ni puede ir en Vanilla. En Fabric y NeoForge, Geyser solo sigue la versión más reciente de Minecraft.
- playit.gg se controla con la API que usa su agente oficial (v1.0.x). Si playit cambia esa API, la creación de túneles podría fallar; en ese caso los túneles se pueden crear a mano en playit.gg.
- MCXboxBroadcast es una herramienta no oficial: usa una cuenta de Microsoft secundaria.
- Las consolas (Xbox, PlayStation, Switch) no permiten agregar servidores propios; la guía explica las alternativas.
- CurseForge necesita una clave de API propia (gratis en console.curseforge.com). Los mods cuyo autor no permite descargas desde otras apps se bajan desde CurseForge y se suben en **Archivos**.
- Algunos plugins de Hangar se publican solo como enlace externo; el panel te muestra el enlace en lugar de instalarlos.
- Forge para versiones anteriores a 1.17 se instala, pero conviene probar cada modpack antiguo.
- Los modpacks de CurseForge no dicen qué mods son solo del juego: el panel revisa cada jar y conoce los más comunes, pero si el servidor se cae al arrancar, la pestaña Logs dice qué mod quitar.
- Algunos modpacks y mods de CurseForge no permiten descargarse desde otras apps; el panel te da el enlace para bajarlos y subirlos a mano.
