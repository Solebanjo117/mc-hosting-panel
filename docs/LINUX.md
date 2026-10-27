# MC Hosting Panel en Linux y en la nube

Guía para instalar el panel en un servidor Linux: una VPS, una instancia de Oracle Cloud (también las gratuitas con procesador ARM Ampere), una PC con Ubuntu o una Raspberry Pi 5. Los ejemplos usan **Ubuntu 22.04 o 24.04**; donde cambia algo para **Oracle Linux** se indica.

## Índice

- [Qué cambia respecto a Windows](#qué-cambia-respecto-a-windows)
- [1. Requisitos](#1-requisitos)
- [2. Instalar el panel](#2-instalar-el-panel)
- [3. Que arranque solo (systemd)](#3-que-arranque-solo-systemd)
- [4. Entrar al panel desde tu PC](#4-entrar-al-panel-desde-tu-pc)
- [5. Abrir los puertos de Minecraft](#5-abrir-los-puertos-de-minecraft)
- [6. Actualizar](#6-actualizar)
- [7. Si olvidaste la contraseña](#7-si-olvidaste-la-contraseña)
- [8. Problemas comunes](#8-problemas-comunes)

## Qué cambia respecto a Windows

Todo lo del panel funciona igual: crear servidores, Java automático, mods, mapa, respaldos, playit.gg, dominios. Lo que cambia es cómo se instala y se mantiene encendido:

| En Windows | En Linux |
|---|---|
| Instalador `.exe` o `iniciar.bat` | `npm ci`, `npm run build` y `npm start` |
| "Iniciar con Windows" en Ajustes | Un servicio de **systemd** (paso 3) |
| `actualizar.bat` | **Ajustes del panel → Actualizar el panel** (funciona igual) o `git pull` |
| `restablecer-contrasena.bat` | `node scripts/restablecer-contrasena.mjs` |
| Firewall de Windows | iptables, ufw o firewalld, y el firewall de tu nube |

La **Revisión** de cada servidor no comprueba el firewall en Linux (usa una herramienta que solo existe en Windows): ese punto simplemente no aparece.

## 1. Requisitos

- **Node.js 20 o más reciente** y **git**. Java no hace falta: el panel descarga el que necesita cada versión de Minecraft.
- **RAM:** 2–4 GB por servidor sin mods, 6 GB o más con modpacks, y deja 1 GB para el sistema. La instancia gratuita de Oracle (Ampere A1, hasta 4 núcleos y 24 GB) da para varios servidores.
- **Disco:** unos 2 GB por servidor más los respaldos.

Ubuntu o Debian:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # debe decir v20 o más
```

Oracle Linux, Rocky o Fedora:

```bash
sudo dnf install -y git
sudo dnf module install -y nodejs:22   # o: curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs
node --version
```

## 2. Instalar el panel

Se instala en la carpeta de tu usuario (no hace falta ser root para usarlo). Cambia `ubuntu` por tu usuario si es otro; en Oracle Linux suele ser `opc`.

```bash
cd ~
git clone https://github.com/Solebanjo117/mc-hosting-panel.git
cd mc-hosting-panel
npm ci
npm run build
npm start
```

Debe aparecer:

```
  MC Hosting Panel v0.x.y
  En esta PC:      http://localhost:8080
```

Déjalo así un momento y sigue al [paso 4](#4-entrar-al-panel-desde-tu-pc) para abrirlo desde tu PC y crear tu cuenta. Cuando funcione, ciérralo con **Ctrl+C** (apaga los servidores con cuidado) y configúralo como servicio en el paso 3.

Tus servidores, mundos y ajustes quedan en `~/mc-hosting-panel/data`. Para mover el panel a otra máquina copia esa carpeta.

## 3. Que arranque solo (systemd)

Así el panel sigue encendido aunque cierres SSH, arranca al reiniciar la máquina y se vuelve a abrir solo después de actualizarse desde Ajustes.

El proyecto trae el servicio listo en `scripts/mc-hosting-panel.service`. Revisa las líneas `User`, `WorkingDirectory` y la ruta de `node` (sale con `which node`) y cópialo:

```bash
which node                       # normalmente /usr/bin/node
nano scripts/mc-hosting-panel.service
sudo cp scripts/mc-hosting-panel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mc-hosting-panel
systemctl status mc-hosting-panel
```

Lo que hace el servicio:

- `Restart=always` y `MCP_SUPERVISED=1`: si el panel se cierra para actualizarse (o por un error), systemd lo vuelve a abrir.
- `KillMode=mixed` y `TimeoutStopSec=90`: al detenerlo, el panel apaga los servidores de Minecraft con `stop` y guarda los mundos antes de salir.

Comandos útiles:

```bash
sudo systemctl restart mc-hosting-panel    # reiniciar el panel
sudo systemctl stop mc-hosting-panel       # apagarlo (y los servidores)
journalctl -u mc-hosting-panel -f          # ver lo que escribe, en vivo
```

Para que cada servidor de Minecraft se encienda al arrancar, marca **Encender automáticamente** en su pestaña Ajustes.

## 4. Entrar al panel desde tu PC

Por seguridad, el panel **rechaza las conexiones que llegan de internet**: solo acepta la propia máquina, redes privadas y Tailscale. Si abres el puerto 8080 en la nube y entras con la IP pública, verás "Acceso bloqueado". Además el panel usa HTTP sin cifrar, así que **no abras el 8080 al público**. Usa una de estas dos opciones.

### Opción A: túnel SSH (sin instalar nada)

En tu PC (Windows 10/11, macOS o Linux traen `ssh`):

```bash
ssh -i ruta/a/tu-llave.key -L 8080:localhost:8080 ubuntu@IP_PUBLICA
```

Con esa ventana abierta, entra en tu navegador a **http://localhost:8080**. Para el panel es como si estuvieras sentado en el servidor. Al cerrar la ventana de SSH se corta el túnel; el panel sigue corriendo.

En Windows con PuTTY: *Connection → SSH → Tunnels*, Source port `8080`, Destination `localhost:8080`, **Add**, y conéctate normalmente.

### Opción B: Tailscale (cómodo, también desde el celular)

Tailscale crea una red privada entre tus dispositivos. En el servidor:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # abre el enlace que muestra e inicia sesión
tailscale ip -4              # te da una IP 100.x.y.z
```

Instala Tailscale en tu PC o celular con la misma cuenta y entra a **http://100.x.y.z:8080**. No hace falta abrir ningún puerto para esto. Con Tailscale también funcionan las notificaciones del navegador si usas `sudo tailscale serve --bg 8080` (te da una dirección `https://`).

### Si de verdad quieres el panel abierto en internet

En **Ajustes del panel → Quién puede abrir el panel** puedes elegir *Cualquiera en internet* y abrir el 8080/TCP como en el paso 5. Hazlo solo detrás de algo que ponga **HTTPS** (Caddy, Nginx con Let's Encrypt o Cloudflare Tunnel) y con una contraseña larga.

## 5. Abrir los puertos de Minecraft

Los puertos de **Minecraft** sí deben estar abiertos al público. En la nube hay **dos firewalls**: el de la red del proveedor y el del sistema operativo. Hay que abrir los dos.

| Puerto | Protocolo | Para qué |
|---|---|---|
| 25565 (y 25566, 25567… uno por servidor) | TCP | Minecraft Java |
| 19132 (y siguientes) | UDP | Bedrock (celular y consolas), solo si activas el crossplay |

El puerto de cada servidor sale en su encabezado y en la pestaña **Conexión**.

### 5.1 Oracle Cloud: Security List

1. En la consola de Oracle: **Networking → Virtual cloud networks →** tu VCN.
2. **Subnets →** la subred de tu instancia **→ Security Lists →** *Default Security List*.
3. **Add Ingress Rules**, una por puerto:
   - *Source CIDR*: `0.0.0.0/0`
   - *IP Protocol*: TCP (o UDP para Bedrock)
   - *Destination Port Range*: `25565`
4. Guarda.

Si tu instancia usa un **Network Security Group** (lo ves en los detalles de la instancia, *Attached VNICs*), agrega las mismas reglas también ahí.

En otras nubes es lo mismo con otro nombre: *Security Group* en AWS, *Firewall rules* en Google Cloud, *Firewall* en Hetzner, DigitalOcean o Contabo.

### 5.2 El firewall del sistema

**Ubuntu en Oracle Cloud** trae iptables con una regla final que rechaza todo. Las reglas nuevas tienen que ir **antes** de ella:

```bash
sudo iptables -L INPUT --line-numbers     # mira el número de la línea "REJECT all"
# Si REJECT está en la línea 6, inserta en la 6 (queda antes):
sudo iptables -I INPUT 6 -p tcp --dport 25565 -m state --state NEW -j ACCEPT
sudo iptables -I INPUT 6 -p udp --dport 19132 -j ACCEPT
sudo netfilter-persistent save            # para que sobreviva al reinicio
```

**Ubuntu con ufw** (VPS de otros proveedores):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 25565/tcp
sudo ufw allow 19132/udp
sudo ufw enable
```

**Oracle Linux, Rocky o Fedora** (firewalld):

```bash
sudo firewall-cmd --permanent --add-port=25565/tcp --add-port=19132/udp
sudo firewall-cmd --reload
```

### 5.3 Comprobarlo

Enciende el servidor desde el panel y usa la **prueba desde internet** de la pestaña Conexión. También puedes revisar tu IP en [mcsrvstat.us](https://mcsrvstat.us). Tus amigos entran con `IP_PUBLICA:25565`; si quieres un nombre fácil, configura un dominio en **Ajustes del panel → Dominio para tus servidores** (deSEC, DuckDNS o Cloudflare).

En la nube **no necesitas playit.gg**: la instancia ya tiene IP pública y no hay CGNAT.

## 6. Actualizar

Desde el panel: **Ajustes del panel → Actualizar el panel**. Hace `git pull`, instala dependencias, recompila si hace falta y se cierra para que systemd lo vuelva a abrir. Los servidores que estaban encendidos vuelven a encender.

A mano:

```bash
cd ~/mc-hosting-panel
git pull
npm ci
npm run build
sudo systemctl restart mc-hosting-panel
```

## 7. Si olvidaste la contraseña

En el servidor, por SSH:

```bash
cd ~/mc-hosting-panel
node scripts/restablecer-contrasena.mjs
```

Te muestra tu usuario y te pide una contraseña nueva. Se aplica al momento si el panel está encendido y cierra las sesiones abiertas.

## 8. Problemas comunes

**"Acceso bloqueado" al abrir el panel.** Estás entrando por la IP pública. Usa el túnel SSH o Tailscale ([paso 4](#4-entrar-al-panel-desde-tu-pc)).

**Mis amigos no pueden entrar.** Casi siempre falta uno de los dos firewalls: revisa la regla en la consola de la nube **y** la del sistema ([paso 5](#5-abrir-los-puertos-de-minecraft)). En Oracle con Ubuntu, la regla de iptables tiene que quedar antes del `REJECT`.

**El servidor se cierra solo con mods pesados.** Probablemente falta memoria. Mira `free -h`; si la máquina tiene poca RAM, baja la memoria del servidor en sus Ajustes o crea un archivo swap:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**`npm ci` falla en una máquina pequeña.** Con menos de 1 GB de RAM la compilación se puede quedar sin memoria: crea el swap de arriba y repite.

**El puerto 8080 ya está en uso.** Cambia el puerto en **Ajustes del panel → Puerto del panel**, o arráncalo con otro: agrega `Environment=PORT=8090` al servicio y usa ese número en el túnel SSH.

**Ver qué pasó.** `journalctl -u mc-hosting-panel -n 200` muestra lo último que escribió el panel; la consola de cada servidor está en su pestaña Consola y los logs completos en **Estado → Logs**.
