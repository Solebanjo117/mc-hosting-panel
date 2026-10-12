# MC Hosting Panel

Panel web propio para crear y administrar servidores de **Minecraft Java** en tu PC con Windows, y que tus amigos se conecten desde su casa.

- Crea servidores **Paper, Fabric, Forge, NeoForge o Vanilla** eligiendo tipo y versión; el panel descarga el servidor y el **Java correcto** (Eclipse Temurin) sin que instales nada.
- **Consola en vivo** con historial de comandos, jugadores conectados, CPU, RAM y tiempo encendido.
- **Marketplace** de mods, plugins y datapacks desde **Modrinth** y **Hangar** (PaperMC), filtrado por la versión del servidor, con dependencias automáticas, activar/desactivar y búsqueda de actualizaciones.
- Gestión completa: `server.properties` con formulario, jugadores (lista blanca, operadores, baneos, expulsar), administrador de archivos con editor, subida y extracción de .zip, **respaldos** manuales y automáticos con restauración, cambio de versión, reinicio automático si el servidor se cae.
- **Crossplay con Bedrock** (celular, Windows, consolas) con un clic: instala Geyser, Floodgate (sin cuenta de Java) y ViaVersion cuando hace falta, y configura el puerto UDP de cada servidor. Funciona en Paper (casi cualquier versión), y en Fabric/NeoForge en la versión más reciente.
- Pestaña **Conexión** con tus IP, el comando del firewall y una prueba real desde internet (Java y Bedrock).
- **Manual completo para abrir puertos**: firewall, router (con secciones para Totalplay, Telmex e Izzi), CGNAT, dominio gratis (DuckDNS / No-IP / SRV) y alternativas como playit.gg. Está en [`docs/ABRIR-PUERTOS.md`](docs/ABRIR-PUERTOS.md) y dentro del panel.

## Requisitos

- Windows 10 u 11 (también funciona en Linux para desarrollo).
- [Node.js 20 o más reciente](https://nodejs.org/es) (versión LTS).
- Internet para descargar servidores, Java y mods.
- RAM: unos 2–4 GB por servidor sin mods, 6 GB o más con modpacks.

## Instalación

1. Descarga el proyecto (`git clone https://github.com/Solebanjo117/mc-hosting-panel.git` o el ZIP desde GitHub).
2. Abre **`iniciar.bat`**. La primera vez instala dependencias y compila la interfaz; después se abre el navegador en `http://localhost:8080`.
3. Crea tu cuenta de administrador y tu primer servidor.
4. Para que entren tus amigos por internet sigue la **Guía para abrir puertos** del menú lateral.

La ventana negra es el panel: si la cierras, se apagan los servidores (de forma ordenada). Para que arranque solo al iniciar Windows ejecuta `scripts\inicio-automatico.bat` y marca **Encender automáticamente** en los servidores que quieras.

### Scripts incluidos

| Archivo | Para qué sirve |
|---|---|
| `iniciar.bat` | Prepara (la primera vez) y abre el panel |
| `actualizar.bat` | Baja la última versión con `git pull` y recompila; no toca tus servidores |
| `scripts\abrir-firewall.bat` | Crea la regla del Firewall de Windows para el puerto de un servidor (TCP para Java, UDP para Bedrock) |
| `scripts\inicio-automatico.bat` | Activa o quita el arranque del panel con Windows |

## Dónde se guardan las cosas

Todo vive en la carpeta `data/` (no se sube a Git):

```
data/
  db.json          cuenta, ajustes y lista de servidores
  servers/<id>/    cada servidor: mundos, mods, plugins, configuración
  backups/<id>/    respaldos .zip
  java/<versión>/  Java descargado automáticamente
```

Para mover el panel a otra PC copia la carpeta completa, incluida `data/`.

## Seguridad

- **No abras el puerto 8080 (el panel) en tu router.** Solo se abren los puertos de los servidores de Minecraft. Para administrar desde fuera de casa usa Tailscale (explicado en la guía).
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
    bedrock.js          crossplay: instala Geyser/Floodgate/ViaVersion y reserva puertos UDP
    geyserConfig.js     ajusta el puerto y la autenticación en el config.yml de Geyser
client/                 React + Vite
docs/ABRIR-PUERTOS.md   manual de red (también se ve dentro del panel)
```

## Limitaciones conocidas

- Los servidores son de Java Edition; Bedrock entra a través de Geyser, que no existe para Forge ni puede ir en Vanilla. En Fabric y NeoForge, Geyser solo sigue la versión más reciente de Minecraft.
- Las consolas (Xbox, PlayStation, Switch) no permiten agregar servidores propios; la guía explica las alternativas.
- CurseForge no está integrado porque su API exige una clave privada; los mods de CurseForge se pueden subir a mano desde **Archivos** (carpeta `mods`).
- Algunos plugins de Hangar se publican solo como enlace externo; el panel te muestra el enlace en lugar de instalarlos.
- Forge para versiones anteriores a 1.17 se instala, pero conviene probar cada modpack antiguo.
