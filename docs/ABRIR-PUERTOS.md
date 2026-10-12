# Abrir puertos para jugar con tus amigos por internet

Manual de **MC Hosting Panel** para que tus servidores de Minecraft Java, que corren en tu PC con Windows 10/11, sean accesibles desde fuera de tu casa.

> **Lee esto primero**
>
> - Los servidores son de **Minecraft Java Edition** (puertos **TCP**). Si activas **Bedrock** en un servidor (pestaña **Bedrock**, con Geyser), además se abre un puerto **UDP**; lee la [sección 12](#12-jugadores-de-bedrock-geyser).
> - El panel web usa el puerto **8080**. **No lo abras a internet.** Más adelante se explica cómo administrarlo a distancia de forma segura con Tailscale.
> - Los menús de los routers cambian según el modelo, la versión de firmware y la compañía. Donde no pudimos confirmar el nombre exacto de una opción, lo indicamos con **(no verificado)** y te explicamos cómo reconocerla.

---

## Índice

0. [Resumen rápido (checklist)](#0-resumen-rápido-checklist)
1. [Cómo funciona](#1-cómo-funciona)
2. [Paso 1: IP local fija en Windows](#2-paso-1-ip-local-fija-en-windows)
3. [Paso 2: Firewall de Windows](#3-paso-2-firewall-de-windows)
4. [Paso 3: Reenvío de puertos en el router](#4-paso-3-reenvío-de-puertos-en-el-router)
5. [Paso 4: Detectar CGNAT](#5-paso-4-detectar-cgnat)
6. [Paso 5: Convertir la IP en una dirección fácil (dominio)](#6-paso-5-convertir-la-ip-en-una-dirección-fácil-dominio)
7. [Paso 6: Verificar que funciona](#7-paso-6-verificar-que-funciona)
8. [Alternativas si no puedes abrir puertos](#8-alternativas-si-no-puedes-abrir-puertos)
9. [Cómo se conectan tus amigos](#9-cómo-se-conectan-tus-amigos)
10. [Seguridad](#10-seguridad)
11. [Solución de problemas](#11-solución-de-problemas)
12. [Jugadores de Bedrock (Geyser)](#12-jugadores-de-bedrock-geyser)
13. [Seguridad y ataques DDoS](#13-seguridad-y-ataques-ddos)

---

## 0. Resumen rápido (checklist)

Si ya sabes algo de redes, esta es la lista corta:

- [ ] La PC tiene una **IP local fija** (reserva DHCP en el router o IP manual en Windows).
- [ ] El **Firewall de Windows** permite entrada **TCP** en el puerto del servidor (25565, 25566, ...).
- [ ] El **router** reenvía ese puerto TCP hacia la IP local de la PC.
- [ ] **No hay CGNAT** (la IP WAN del router es igual a tu IP pública).
- [ ] El botón **"Probar desde internet"** de la pestaña **Conexión** del panel dice que el servidor responde.
- [ ] (Opcional) Tienes un dominio o subdominio gratuito para no dictar números.

Si tienes CGNAT y no puedes conseguir IP pública, sáltate al [punto 8](#8-alternativas-si-no-puedes-abrir-puertos).

---

## 1. Cómo funciona

### IP local vs. IP pública

| Concepto | Qué es | Ejemplo | Dónde la ves |
|---|---|---|---|
| **IP local (privada)** | La dirección de tu PC **dentro** de tu casa. Solo sirve en tu red. | `192.168.1.50` | Pestaña **Conexión** del panel, o `ipconfig` |
| **IP pública** | La dirección con la que **todo tu hogar** sale a internet. La comparten todos tus dispositivos. | `187.190.xx.xx` | Pestaña **Conexión** del panel, o sitios como whatismyip.com |
| **Puerta de enlace (gateway)** | La IP del router/módem dentro de tu casa. | `192.168.1.254`, `192.168.100.1` | `ipconfig` |
| **Puerto** | Un "número de puerta" dentro de una IP. Cada servidor de Minecraft usa uno. | `25565` | Pestaña **Conexión** del panel |

### El router y el NAT

Tu router hace **NAT** (traducción de direcciones): deja que muchos dispositivos compartan una sola IP pública. Cuando tú abres una página web, el router recuerda quién la pidió y le devuelve la respuesta. Pero cuando **alguien de fuera** intenta entrar a tu servidor, el router **no sabe a qué dispositivo mandarlo** y descarta la conexión.

El **reenvío de puertos** (*port forwarding*) es una regla que le dice al router: *"todo lo que llegue al puerto 25565 por TCP, mándalo a la PC 192.168.1.50"*.

### Diagrama

```
   Tu amigo (en su casa)
          |
          |  se conecta a  187.190.xx.xx:25565   (tu IP pública)
          v
  =====================  INTERNET  =====================
          |
          v
 +-----------------------------+
 |  Router / módem de tu casa  |   Regla de reenvío:
 |  IP pública: 187.190.xx.xx  |   TCP 25565  -->  192.168.1.50:25565
 |  IP local:   192.168.1.254  |
 +-----------------------------+
          |
          |  red de tu casa (192.168.1.x)
          v
 +-----------------------------+
 |  Tu PC con Windows          |   Firewall de Windows: permitir TCP 25565
 |  IP local: 192.168.1.50     |
 |  MC Hosting Panel  :8080    |   <-- NO se reenvía (solo uso local / Tailscale)
 |  Servidor Survival :25565   |
 |  Servidor Creativo :25566   |
 +-----------------------------+
```

Hay **tres "puertas"** que deben estar abiertas en orden, y si falla cualquiera no funciona:

1. La compañía de internet debe darte una **IP pública real** (sin CGNAT).
2. El **router** debe reenviar el puerto a tu PC.
3. El **Firewall de Windows** debe dejar pasar la conexión.

### Puertos que usa el panel

| Qué | Puerto | Protocolo | ¿Abrir a internet? |
|---|---|---|---|
| Panel web (MC Hosting Panel) | 8080 | TCP | **NO** |
| Primer servidor de Minecraft | 25565 | TCP | Sí |
| Segundo servidor | 25566 | TCP | Sí, si quieres que sea público |
| Tercer servidor | 25567 | TCP | Sí, si quieres que sea público |
| ... y así sucesivamente | +1 por servidor | TCP | Uno por servidor |
| Bedrock del primer servidor con Geyser | 19132 | **UDP** | Sí, si activaste Bedrock |
| Bedrock de otros servidores | 19133, 19134... | **UDP** | Uno por servidor con Bedrock |

El puerto exacto de cada servidor aparece en su pestaña **Conexión** del panel. Cada servidor necesita su propia regla en el firewall y en el router.

---

## 2. Paso 1: IP local fija en Windows

La regla del router apunta a una IP local concreta. Si tu PC cambia de IP (por ejemplo, después de reiniciar el módem), la regla apunta a la nada y el servidor deja de funcionar. Por eso hay que fijarla.

### 2.1 Averigua tus datos actuales con `ipconfig`

1. Presiona **Windows + R**, escribe `cmd` y presiona **Enter**.
2. Escribe:

   ```bat
   ipconfig /all
   ```

3. Busca el adaptador que usas (**Ethernet** si vas por cable, **Wi-Fi / LAN inalámbrica** si vas por WiFi) y anota:

| Dato en `ipconfig /all` (Windows en español) | Para qué sirve | Ejemplo |
|---|---|---|
| **Dirección IPv4** | IP local actual de la PC | `192.168.1.50` |
| **Máscara de subred** | Tamaño de tu red | `255.255.255.0` |
| **Puerta de enlace predeterminada** | IP del router (para entrar a su configuración) | `192.168.1.254` |
| **Servidores DNS** | Quién traduce nombres a IPs | `192.168.1.254` o `8.8.8.8` |
| **Dirección física** | MAC del adaptador (para la reserva DHCP) | `A4-BB-6D-12-34-56` |

> Consejo: para un servidor, usa **cable de red** si puedes. Es más estable que el WiFi y la PC no cambia de adaptador.

### 2.2 Opción A (recomendada): Reserva DHCP en el router

El router siempre le dará la misma IP a tu PC, sin tocar nada en Windows. Si algún día cambias de router, no hay que deshacer nada en la PC.

1. Entra al router (ver [4.1](#41-pasos-generales-cualquier-router)).
2. Busca una sección de **LAN** o **DHCP**. La opción suele llamarse:
   - *Reserva DHCP*, *DHCP Reservation*, *Address Reservation*
   - *DHCP estático*, *Static DHCP*, *DHCP Binding*
   - *Asignación de IP*, *IP fija para dispositivos*
3. Elige tu PC de la lista de dispositivos conectados, o escribe su **dirección MAC** (la "Dirección física" de `ipconfig /all`).
4. Asígnale una IP, por ejemplo la que ya tiene (`192.168.1.50`).
5. Guarda y reinicia la conexión de red de la PC (o la PC).

Si tu router no tiene esta opción (algunos módems de compañía la ocultan), usa la opción B.

### 2.3 Opción B: IP estática en el adaptador de Windows

**Elige una IP que no choque con otros equipos.** Lo más seguro es usar un número alto, fuera del rango que reparte el router (por ejemplo `.200`). Si puedes ver el rango DHCP en el router, elige una IP fuera de él.

**Windows 11:**

1. **Configuración** > **Red e Internet** > **Ethernet** (o **Wi-Fi** > *nombre de tu red* > *Propiedades*).
2. En **Asignación de IP**, haz clic en **Editar** y elige **Manual**.
3. Activa **IPv4** y llena:
   - **Dirección IP:** `192.168.1.200`
   - **Máscara de subred:** `255.255.255.0` (si te pide "longitud del prefijo", pon `24`)
   - **Puerta de enlace:** la de `ipconfig` (ej. `192.168.1.254`)
   - **DNS preferido:** la misma puerta de enlace, o `1.1.1.1` / `8.8.8.8`
   - **DNS alternativo:** `8.8.8.8` o `1.0.0.1`
4. **Guardar**.

**Windows 10 (o cualquier versión, método clásico):**

1. **Windows + R**, escribe `ncpa.cpl`, **Enter**.
2. Clic derecho en tu adaptador > **Propiedades**.
3. Selecciona **Protocolo de Internet versión 4 (TCP/IPv4)** > **Propiedades**.
4. Marca **Usar la siguiente dirección IP** y llena los mismos datos de arriba.
5. Marca **Usar las siguientes direcciones de servidor DNS** y llénalas.
6. **Aceptar** > **Cerrar**.

Comprueba con `ipconfig` que la nueva IP aparece y que sigues teniendo internet. Si te quedas sin internet, regresa a **Obtener una dirección IP automáticamente** y revisa los datos.

> Después de este paso, la pestaña **Conexión** del panel debe mostrar la nueva IP local.

---

## 3. Paso 2: Firewall de Windows

Windows bloquea por defecto las conexiones que llegan desde fuera. Hay que crear una regla de **entrada** para el puerto **TCP** de cada servidor.

### 3.0 Pon tu red como "Privada"

Si Windows marcó tu red como **Pública**, es más estricto.

- **Windows 11:** Configuración > Red e Internet > Ethernet/Wi-Fi > tu red > **Tipo de perfil de red: Red privada**.
- **Windows 10:** Configuración > Red e Internet > Estado > **Propiedades** > **Privado**.

### 3.1 La ventana de Java ("Permitir acceso")

La primera vez que el panel inicia un servidor, Windows puede mostrar una ventana como **"El Firewall de Windows Defender bloqueó algunas características de esta aplicación"**, mencionando **Java(TM) Platform SE binary**, **OpenJDK Platform binary** o similar.

- Marca **Redes privadas** (y **Redes públicas** solo si tu red quedó marcada como pública y no puedes cambiarla).
- Haz clic en **Permitir acceso**.

Si le diste **Cancelar** por error, Windows crea una regla de **bloqueo** para Java. Revísalo en la consola avanzada (3.3) y borra o desactiva las reglas de bloqueo de Java. Aun así, **crea también la regla por puerto** (3.2 o 3.3): es más confiable que la regla por programa, sobre todo si actualizas Java.

### 3.2 Método fácil: el script `scripts\abrir-firewall.bat`

El repositorio incluye `scripts\abrir-firewall.bat`, que crea la regla por ti.

1. Abre la carpeta del panel y entra a `scripts`.
2. Haz **doble clic** en `abrir-firewall.bat` (o **clic derecho > Ejecutar como administrador**).
3. Si aparece **Control de cuentas de usuario**, haz clic en **Sí**. El script se eleva solo a administrador.
4. Te pedirá el puerto. Presiona **Enter** para usar `25565`, o escribe otro (por ejemplo `25566`) y presiona **Enter**.
5. Repite para cada servidor que quieras abrir.

### 3.3 Método manual: consola gráfica

1. **Windows + R**, escribe `wf.msc`, **Enter**. Se abre **Firewall de Windows Defender con seguridad avanzada**.
2. A la izquierda, clic en **Reglas de entrada**.
3. A la derecha, clic en **Nueva regla...**
4. **Tipo de regla:** **Puerto** > Siguiente.
5. **Protocolo y puertos:** **TCP** y **Puertos locales específicos:** `25565` (puedes poner varios: `25565,25566,25567` o un rango `25565-25570`) > Siguiente.
6. **Acción:** **Permitir la conexión** > Siguiente.
7. **Perfil:** marca **Dominio**, **Privado** y **Público** (o al menos **Privado**) > Siguiente.
8. **Nombre:** `Minecraft 25565` > **Finalizar**.

### 3.4 Método manual: comandos

Abre **Símbolo del sistema** o **PowerShell como administrador** (busca "cmd" o "PowerShell" en Inicio > clic derecho > **Ejecutar como administrador**).

**Con `netsh` (CMD o PowerShell):**

```bat
:: Crear la regla
netsh advfirewall firewall add rule name="Minecraft 25565" dir=in action=allow protocol=TCP localport=25565

:: Ver si existe
netsh advfirewall firewall show rule name="Minecraft 25565"

:: Borrarla
netsh advfirewall firewall delete rule name="Minecraft 25565"
```

**Con PowerShell (`New-NetFirewallRule`):**

```powershell
# Crear la regla
New-NetFirewallRule -DisplayName "Minecraft 25565" -Direction Inbound -Protocol TCP -LocalPort 25565 -Action Allow -Profile Any

# Varios puertos a la vez
New-NetFirewallRule -DisplayName "Minecraft 25565-25567" -Direction Inbound -Protocol TCP -LocalPort 25565-25567 -Action Allow -Profile Any

# Ver / borrar
Get-NetFirewallRule -DisplayName "Minecraft*"
Remove-NetFirewallRule -DisplayName "Minecraft 25565"
```

> **No crees reglas para el puerto 8080** salvo que sepas exactamente por qué. El panel no necesita estar abierto a internet.

### 3.5 Comprobar que el servidor escucha

Con el servidor **encendido** desde el panel:

```bat
netstat -ano | findstr :25565
```

Debe aparecer una línea con `LISTENING`. Si no aparece nada, el servidor no está corriendo o usa otro puerto (revisa la pestaña **Conexión**).

Desde **otra PC de tu casa** puedes probar el firewall con PowerShell:

```powershell
Test-NetConnection 192.168.1.50 -Port 25565
```

Si dice `TcpTestSucceeded : True`, el firewall ya está bien.

### 3.6 Otros antivirus

Si usas otro antivirus con firewall propio (Avast, ESET, Kaspersky, Norton, etc.), ese reemplaza o se suma al de Windows. Tendrás que crear la regla también ahí; busca algo como *Firewall > Reglas > Puertos* en su configuración.

---

## 4. Paso 3: Reenvío de puertos en el router

### 4.1 Pasos generales (cualquier router)

1. **Encuentra la IP del router:** es la **Puerta de enlace predeterminada** de `ipconfig`. Las más comunes son `192.168.1.1`, `192.168.1.254`, `192.168.0.1`, `192.168.100.1` y `10.0.0.1`.
2. **Abre el navegador** en la PC (conectada a esa red) y escribe la IP en la barra de direcciones, por ejemplo `http://192.168.1.254`. Si el navegador avisa que la conexión "no es segura", es normal en routers caseros; continúa.
3. **Inicia sesión.** El usuario y la contraseña de administración casi siempre están en la **etiqueta del módem** (abajo o atrás). No confundas la contraseña del WiFi con la de administración, aunque en algunos módems es la misma.
4. **Busca la opción de reenvío.** Según la marca, puede estar bajo:

   | Nombre posible | Suele estar dentro de |
   |---|---|
   | Port Forwarding / Reenvío de puertos | Advanced, Avanzado, NAT, Internet > Security |
   | Virtual Server / Servidor virtual | Firewall, NAT, Advanced |
   | Port Mapping / Mapeo de puertos | Forward Rules, Network Application |
   | NAT / NAPT | Advanced, Network |
   | Aplicaciones / Applications / Juegos | Application, Seguridad |

   Cuidado con **Port Triggering / Activación de puertos**: es otra cosa (abre el puerto solo después de que la PC sale primero) y **no sirve** para un servidor.

5. **Crea la regla** con estos datos (los nombres de los campos varían):

   | Campo | Valor |
   |---|---|
   | Nombre / Descripción / Servicio | `Minecraft 25565` |
   | Protocolo | **TCP** (o TCP/UDP si no hay solo TCP) |
   | Puerto externo / WAN / Público (inicio y fin) | `25565` y `25565` |
   | Puerto interno / LAN / Privado (inicio y fin) | `25565` y `25565` |
   | IP del servidor / LAN Host / IP interna | La IP fija de tu PC, ej. `192.168.1.50` |
   | IP remota / origen / WAN Host | Vacío, `0.0.0.0` o "Cualquiera" |
   | Interfaz WAN / Conexión WAN | La conexión de internet (suele llamarse INTERNET, PPPoE o similar) |
   | Habilitar / Enable | Activado |

6. **Guarda / Aplicar.** Algunos routers piden reiniciar.
7. Repite para `25566`, `25567`, etc., según los servidores que quieras publicar.

**Sobre el DMZ:** algunos tutoriales dicen "pon tu PC en DMZ". Eso expone **todos** los puertos de la PC a internet (incluido el panel en 8080). **No lo recomendamos.** Úsalo solo para una prueba de diagnóstico breve y desactívalo después.

**Sobre UPnP:** el panel no depende de UPnP. Puedes dejarlo como esté, pero las reglas manuales son más predecibles.

### 4.2 Totalplay con módem ZTE F670L

> **Aviso:** Totalplay no publica una guía oficial de reenvío de puertos para el ZTE F670L que hayamos podido encontrar. Lo siguiente combina documentación de ZTE para modelos hermanos (F670/F680/F689) y guías de otras compañías que usan los mismos equipos. **Los menús y credenciales exactos de tu equipo pueden ser distintos.**

**Dirección de acceso (no verificado):**

- Los ZTE de esta familia suelen usar `http://192.168.1.1`.
- Los módems Huawei de Totalplay usan `http://192.168.100.1`.
- Lo más confiable: mira la **Puerta de enlace predeterminada** en `ipconfig`. Esa es la dirección correcta para **tu** módem.

**Usuario y contraseña:**

- Revisa la **etiqueta** del módem. Busca algo como *Usuario/User*, *Contraseña/Password*, *Web login* o *Acceso a la configuración*.
- En equipos de compañía (no solo Totalplay) es común que la cuenta de la etiqueta sea una **cuenta de usuario limitada**: deja cambiar el WiFi, pero **oculta** las opciones de reenvío de puertos y DMZ. La cuenta de administrador completa la controla la compañía.
- En internet circulan contraseñas de "superusuario" para módems de Totalplay. **No las recomendamos:** no son oficiales, cambian con el firmware, y el contrato del módem es en comodato (el equipo es de Totalplay).

**Ruta del menú (no verificado para el firmware de Totalplay):**

Según la versión de la interfaz, la opción suele estar en uno de estos lugares:

- **Interfaz nueva (pestañas arriba):** `Internet` > `Security` (Seguridad) > `Port Forwarding` (Reenvío de puertos). Así aparece en ZTE F680/F689 de otras compañías.
- **Interfaz clásica (menú a la izquierda):** `Application` (Aplicación) > `Port Forwarding`. Así aparece en guías del ZTE F670.

Cómo se ve el formulario (los campos típicos de ZTE):

| Campo ZTE (inglés) | Qué poner |
|---|---|
| Enable | Marcado |
| Name | `Minecraft25565` (a veces no admite espacios) |
| Protocol | `TCP` |
| WAN Host Start/End IP Address | Vacío |
| WAN Connection | La conexión de internet (la que diga INTERNET, PPPoE o similar; no la de VoIP o TR069) |
| WAN Start Port / WAN End Port | `25565` / `25565` |
| Enable MAC Mapping | Desmarcado |
| LAN Host IP Address | La IP fija de tu PC |
| LAN Host Start Port / End Port | `25565` / `25565` |

Luego **Add** / **Apply** (o *Agregar* / *Aplicar*).

**Si no ves la opción de puertos o DMZ:**

1. Tu cuenta es limitada. Llama a **soporte técnico de Totalplay** (o usa el chat de la app/sitio) y pide literalmente: *"Necesito que abran el puerto 25565 TCP hacia la IP 192.168.1.50 de mi red, para un servidor de juegos"*.
2. Pregunta en la misma llamada si tu línea tiene **IP pública o CGNAT** (ver [5](#5-paso-4-detectar-cgnat)). Si tienes CGNAT, abrir el puerto en el módem **no sirve de nada**.
3. Algunas guías dicen que en ciertos módems Huawei de Totalplay se pueden administrar puertos desde la **app de Totalplay**. **No pudimos confirmar** que esto aplique al ZTE F670L; revisa la app por si ves una sección de módem o puertos.

### 4.3 Telmex / Infinitum

> Los módems de Telmex varían mucho (Huawei, ZTE, Sagemcom, Technicolor, Arcadyan, etc.). **No verificamos** una ruta única.

- **IP de acceso más común:** `http://192.168.1.254` (confírmalo con la puerta de enlace de `ipconfig`).
- **Credenciales:** en la etiqueta. En varios modelos el usuario es `TELMEX` y la contraseña es la **clave WPA/WiFi** impresa en la etiqueta; en otros es diferente (**no verificado para todos los modelos**).
- **Dónde buscar:** secciones llamadas *NAT*, *Servidor virtual*, *Reenvío de puertos* o *Port Mapping*, a veces dentro de *Avanzado*, *Seguridad* o *Aplicaciones*.
- Si tu módem no muestra la opción, Telmex puede ayudarte por soporte técnico.
- Telmex también usa CGNAT en algunas líneas. Hay reportes de que su paquete **Infinitum Gamer** incluye IP pública; **confirma precio y disponibilidad** con Telmex.

### 4.4 Izzi

Izzi tiene una **página de ayuda oficial** ("Abre los puertos de tu módem") con instrucciones por modelo. Busca en el sitio de ayuda de Izzi el modelo exacto de tu módem (viene en la etiqueta). Ejemplos de esa página (pueden cambiar con el tiempo):

| Módem Izzi | IP | Dónde está la opción |
|---|---|---|
| Arris TG3442 | `192.168.0.1` | Advanced > Port Forwarding |
| Arris TG2482 / TG1652 / TG862 | `192.168.1.1` o `192.168.0.1` | Firewall > Virtual Servers |
| ZTE F680 / F689 (fibra) | `192.168.1.1` | Internet > Security > Port Forwarding |
| Technicolor TC8305C | `10.0.0.1` | Advanced > Port Forwarding |

Notas:

- Varias de las opciones que la página de Izzi lista para algunos módems son **Port Trigger / Activación de puertos**, que **no sirve** para servidores. Busca reenvío o servidor virtual.
- Hay reportes de usuarios de que la cuenta básica de algunos ZTE de Izzi no permite reenvío de puertos y que hay que pedirlo a soporte.
- Izzi también puede usar CGNAT en algunas zonas; haz la prueba del [punto 5](#5-paso-4-detectar-cgnat).

---

## 5. Paso 4: Detectar CGNAT

### Qué es

Con **CGNAT** (*Carrier-Grade NAT*), la compañía de internet pone **otro NAT por encima de tu router** y comparte una misma IP pública entre muchos clientes. Tú puedes abrir puertos en tu módem todo lo que quieras, pero el NAT de la compañía bloquea las conexiones antes de que lleguen a tu casa. **Con CGNAT, el reenvío de puertos no funciona.**

### Método 1: comparar la IP WAN del router con tu IP pública

1. Entra al router y busca la **IP WAN**. Suele estar en *Estado*, *Status*, *Información del dispositivo*, *Internet* o *WAN*. Puede llamarse *IP WAN*, *IP de Internet*, *IPv4 Address* o *Dirección IP externa*.
2. Abre la pestaña **Conexión** del panel y mira la **IP pública** (o entra a un sitio como whatismyip.com o ifconfig.me desde la misma PC, **sin VPN**).
3. Compara:

| La IP WAN del router es... | Significa |
|---|---|
| **Igual** a la IP pública | **Sin CGNAT.** Puedes abrir puertos. |
| Del rango **`100.64.0.0` a `100.127.255.255`** (`100.64.0.0/10`) | **CGNAT seguro.** Ese rango está reservado justamente para eso. |
| Del rango `10.x.x.x`, `172.16.x.x`–`172.31.x.x` o `192.168.x.x` | Hay **otro NAT** arriba: CGNAT, o tienes **dos routers en cadena** (ver nota). |
| Diferente a la pública, sin ser de los rangos anteriores | Muy probablemente CGNAT. |

> **Doble NAT en casa:** si tienes un router propio conectado al módem de la compañía, la IP WAN de tu router será privada (ej. `192.168.1.x`). Eso **no** es CGNAT: revisa la IP WAN **del módem de la compañía**. En ese caso tienes que reenviar el puerto **en los dos equipos**, o poner tu router en el DMZ del módem, o poner el módem en modo puente (*bridge*).

### Método 2: `tracert`

1. Abre `cmd`.
2. Ejecuta, usando **tu IP pública** (la del panel):

   ```bat
   tracert -d 187.190.xx.xx
   ```

3. Interpreta:
   - Si llega en **1 salto** (solo tu router), **no** hay CGNAT.
   - Si pasa por **varios saltos** antes de llegar, y alguno es `100.64.x.x`–`100.127.x.x` o `10.x.x.x`, **hay CGNAT**.

Este método no es 100% concluyente con todos los equipos; el método 1 es el más claro.

### Cómo pedir IP pública

Llama o escribe a soporte de tu compañía y pide una **"IP pública"** (o "salir de CGNAT", "IP homologada"). Explica que es "para un servidor de juegos / acceso remoto". Pregunta:

- ¿Mi línea está detrás de CGNAT?
- ¿Pueden asignarme una **IP pública dinámica**? ¿Tiene costo?
- ¿Ofrecen **IP fija** y cuánto cuesta? (Casi siempre tiene costo mensual y a veces solo existe en planes de negocio.)

**Totalplay:** hay reportes de usuarios de que Totalplay usa CGNAT en muchas líneas residenciales. Sobre la IP pública, los reportes son **contradictorios**: algunos dicen que la consiguieron pagando un extra (se mencionan cifras de unos ~100 MXN al mes por IP dinámica y ~800 MXN por fija, **sin confirmar y quizá desactualizadas**), otros dicen que ya no se ofrece a clientes residenciales. **No pudimos verificar** la política ni los precios actuales; pregúntalo directamente a Totalplay.

**Telmex:** ver [4.3](#43-telmex--infinitum).

**Izzi:** **no pudimos verificar** si ofrecen IP pública a clientes residenciales ni su costo.

Si no te dan IP pública, usa una de las [alternativas](#8-alternativas-si-no-puedes-abrir-puertos).

---

## 6. Paso 5: Convertir la IP en una dirección fácil (dominio)

Problemas de dar la IP a tus amigos: es difícil de recordar y, en la mayoría de los planes caseros, **cambia** cada cierto tiempo (al reiniciar el módem, por ejemplo). La solución es un nombre que siempre apunte a tu IP actual: **DNS dinámico** (DDNS).

> **El panel ya lo hace por ti, con la IP de tu casa o con playit:** en **Ajustes del panel > Dominio para tus servidores** eliges **deSEC**, **DuckDNS** o **Cloudflare** y pegas tu token. Luego, en la pestaña **Conexión** de cada servidor, le pones un nombre y eliges a dónde apunta: **IP de mi casa**, **Túnel de playit** o **Automático** (playit si el servidor tiene túnel). El panel crea los registros y los mantiene al día cada 5 minutos. Ver [6.5](#65-dominio-con-el-túnel-de-playit).

### 6.1 DuckDNS (gratis, sin caducidad mensual)

> **El panel ya lo hace por ti:** en **Ajustes del panel > Dominio para tus servidores** eliges DuckDNS y pegas tu token; el subdominio se escribe en la pestaña **Conexión** de cada servidor. El panel actualiza la IP cada 5 minutos. No necesitas instalar el actualizador de DuckDNS que se describe abajo; esos pasos quedan como referencia.


1. Entra a **duckdns.org** e inicia sesión con una de las cuentas que ofrece (Google, GitHub, etc.).
2. Escribe un subdominio, por ejemplo `miservermc`, y haz clic en **add domain**. Tu dirección será `miservermc.duckdns.org`.
3. Copia tu **token** (aparece arriba en la página). **Es secreto:** quien lo tenga puede cambiar tu dominio.
4. Configura la actualización automática en Windows. DuckDNS lista varios clientes en su página *install* (sección Windows). Una opción sin instalar nada:

   a. Crea la carpeta `C:\duckdns` y dentro un archivo `duckdns.bat` con este contenido (cambia `miservermc` y `TU_TOKEN`):

   ```bat
   @echo off
   curl -s "https://www.duckdns.org/update?domains=miservermc&token=TU_TOKEN&ip=" -o C:\duckdns\ultimo.txt
   ```

   b. Haz doble clic para probarlo. Abre `C:\duckdns\ultimo.txt`: debe decir `OK`.

   c. Programa que se ejecute cada 5 minutos. En `cmd` **como administrador**:

   ```bat
   schtasks /create /tn "DuckDNS" /tr "C:\duckdns\duckdns.bat" /sc minute /mo 5 /ru SYSTEM
   ```

   (Para borrarla: `schtasks /delete /tn "DuckDNS" /f`.)

   `curl` viene incluido en Windows 10 (versiones recientes) y Windows 11. Si dejas `ip=` vacío, DuckDNS detecta tu IP pública solo.

### 6.2 No-IP (gratis, con confirmación mensual)

1. Crea una cuenta gratuita en **noip.com**.
2. En **Dynamic DNS > No-IP Hostnames**, crea un hostname (ej. `miservermc.ddns.net`).
3. Descarga e instala el **Dynamic Update Client (DUC)** para Windows desde su sitio, inicia sesión y marca tu hostname. El DUC actualiza la IP en segundo plano.
4. **Importante:** en el plan gratuito, No-IP pide **confirmar el hostname cada 30 días** (te llega un correo con un enlace). Si no confirmas, el nombre caduca y deja de funcionar. Pon un recordatorio.

### 6.3 Dominio propio (ej. `tudominio.com`)

Si compraste un dominio, puedes usar un subdominio como `mc.tudominio.com`.

**Registro A** (apunta el nombre a tu IP):

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | `mc` | Tu IP pública (ej. `187.190.xx.xx`) | 5 min / Auto |

Si tu IP cambia, en lugar del registro A puedes usar un **CNAME** que apunte a tu DuckDNS/No-IP (`mc` → `miservermc.duckdns.org`), así el DDNS hace el trabajo de actualizar.

**Registro SRV** (para que nadie tenga que escribir el puerto):

Minecraft Java busca un registro `_minecraft._tcp` al conectarse. Con él, tus amigos escriben solo `survival.tudominio.com` y el juego descubre el puerto solo. Es muy útil cuando tienes varios servidores (25565, 25566...).

Ejemplo: dos servidores en la misma PC.

| Tipo | Nombre | Prioridad | Peso | Puerto | Destino |
|---|---|---|---|---|---|
| A | `mc` | – | – | – | `187.190.xx.xx` |
| SRV | `_minecraft._tcp.survival` | 0 | 5 | `25565` | `mc.tudominio.com` |
| SRV | `_minecraft._tcp.creativo` | 0 | 5 | `25566` | `mc.tudominio.com` |

Resultado:

- `survival.tudominio.com` → entra al servidor del puerto 25565.
- `creativo.tudominio.com` → entra al servidor del puerto 25566.

Notas:

- Algunos paneles de DNS piden los campos por separado: **Servicio** `_minecraft`, **Protocolo** `TCP`, **Nombre** `survival`.
- El **destino** del SRV debe ser un nombre (no una IP). Puede ser `mc.tudominio.com` o directamente tu `miservermc.duckdns.org`.
- Los cambios de DNS pueden tardar desde minutos hasta unas horas en propagarse.

### 6.4 Si usas Cloudflare

En Cloudflare, cada registro A/CNAME tiene una nube:

- **Nube naranja (Proxied):** el tráfico pasa por Cloudflare. Esto **solo funciona para sitios web** (HTTP/HTTPS). Cloudflare **no** transporta conexiones TCP de Minecraft en su proxy normal; tus amigos no podrán entrar.
- **Nube gris (DNS only / Solo DNS):** Cloudflare solo responde la IP. **Así debe estar** el registro de Minecraft.

Los registros SRV no tienen nube, pero el registro A o CNAME al que apuntan **sí debe estar en gris**.

---

### 6.5 Dominio con el túnel de playit

Si tienes CGNAT (por ejemplo, abriste el puerto en el módem y en el firewall y aun así no conecta), el túnel de playit es el camino. Su dirección es larga (`algo.gl.joinmc.link` o `147.185.221.20:41234`), pero puedes poner tu propio nombre encima:

- Cada túnel de playit tiene una **IP y un puerto** fijos. Un registro **A** con tu nombre apunta a esa IP.
- Minecraft Java busca un registro **SRV** (`_minecraft._tcp.tunombre`) con el puerto. Si el servicio de DNS permite SRV, tus amigos escriben solo el nombre.
- Bedrock **no usa SRV**: siempre se escribe la dirección y el puerto en campos separados.

| Servicio | Gratis | Java con playit | Bedrock con playit |
|---|---|---|---|
| **deSEC** (con tu dominio o `.dedyn.io` cuando esté abierto) | Sí | `smp.tunombre.dpdns.org`, sin puerto | dirección + puerto |
| **DuckDNS** | Sí | `tunombre.duckdns.org:41234`, con puerto (no tiene SRV) | dirección + puerto |
| **Cloudflare** con tu dominio | Sí (dominio gratis de DigitalPlat o uno comprado) | `mc.tudominio.com`, sin puerto | dirección + puerto |

**Si no tienes dominio:** el registro gratis de `.dedyn.io` en deSEC a veces está suspendido. Una alternativa gratis es **DigitalPlat** (`domain.digitalplat.org`), que da dominios como `tunombre.dpdns.org` o `tunombre.us.kg` (uno por cuenta):

1. Pide tu dominio en DigitalPlat.
2. Agrégalo en **Cloudflare** (plan Free) y copia los dos nameservers que te da; o agrégalo en **deSEC** y usa `ns1.desec.io` y `ns2.desec.org`.
3. Pon esos nameservers en tu dominio dentro de DigitalPlat y espera a que se active (minutos a horas).
4. Crea el token (Cloudflare: plantilla **Edit zone DNS**; deSEC: **Token Management**) y pégalo en el panel.

No edites a mano los registros **NS** del dominio dentro de deSEC o Cloudflare: si se borran, el dominio deja de funcionar.

**Para quitarlo:** en **Ajustes del panel > Dominio para tus servidores** pulsa **Desvincular dominio**. El panel borra los registros que creó (en DuckDNS no se pueden borrar y se quedan con la última IP), quita el dominio de los servidores y olvida el token. Para quitarlo de un solo servidor, usa **Quitar dominio de este servidor** en su pestaña **Conexión**.

Si playit le da a Bedrock una IP distinta que a Java, el panel crea un nombre aparte para Bedrock (`be.smp.tunombre.dedyn.io`). En DuckDNS tienes que crear un segundo subdominio para eso; el panel te avisa.

Los cambios de DNS pueden tardar unos minutos en verse. Si un amigo ya intentó entrar antes, que cierre y vuelva a abrir Minecraft.

## 7. Paso 6: Verificar que funciona

Prueba en este orden, con el servidor **encendido**:

1. **Desde la misma PC:** en Minecraft, conéctate a `localhost:25565`. Si falla, el problema es el servidor, no la red.
2. **Desde otro equipo en tu casa:** conéctate a `IP-local:puerto` (ej. `192.168.1.50:25565`). Si falla, revisa el **Firewall de Windows** (paso 2).
3. **Botón "Probar desde internet"** en la pestaña **Conexión** del panel. Usa el servicio mcsrvstat.us para intentar conectarse desde fuera a tu IP pública y puerto.
   - Si dice que responde: ¡listo!
   - Si no: revisa reenvío de puertos (paso 3) y CGNAT (paso 4).
   - mcsrvstat.us guarda resultados en caché unos minutos; si acabas de corregir algo, espera un poco y vuelve a probar.
4. **Manual en mcsrvstat.us:** entra a `https://mcsrvstat.us/server/TU-IP:25565` (o tu dominio). Debe mostrar el MOTD y jugadores.
5. **canyouseeme.org:** escribe el puerto y haz clic en *Check Port*. Debe decir *Success*. (Solo funciona con el servidor encendido; con el servidor apagado siempre saldrá cerrado.)
6. **Desde el celular con datos móviles** (WiFi apagado): si tienes Minecraft en otro dispositivo fuera de tu red, o le pides a un amigo que pruebe.

### Ojo: "NAT loopback"

Muchos módems caseros **no permiten** conectarte a tu propia IP pública (o a tu dominio) desde **dentro** de tu casa. A esto se le llama *NAT loopback* o *hairpinning*. Resultado: tú no puedes entrar con el dominio, pero tus amigos sí.

- **Dentro de tu casa:** usa siempre la **IP local** (`192.168.1.50:25565`).
- **Para probar desde fuera:** usa el botón del panel, mcsrvstat.us o un amigo.

---

## 8. Alternativas si no puedes abrir puertos

Si tienes CGNAT, tu módem está bloqueado o no quieres abrir puertos, estas opciones funcionan **sin reenvío de puertos**.

### 8.1 playit.gg (túnel gratuito)

> **El panel ya lo hace por ti:** en **Ajustes del panel > Túneles de playit.gg** pulsa "Vincular con mi cuenta de playit.gg" y acepta en el sitio. Luego, en la pestaña **Conexión** de cada servidor, pulsa "Crear túnel": el panel descarga el agente oficial, lo mantiene encendido y te muestra la dirección para tus amigos (Java y, si activaste Bedrock, también Bedrock). Los pasos manuales de abajo solo hacen falta si prefieres instalar playit por tu cuenta.
>
> **Si "Crear túnel" falla o prefieres crearlo tú:** en playit.gg ve a **Setup > New Tunnel**. Ponle nombre, elige **Minecraft Java** como tipo, deja el **Public Endpoint** gratuito y en **Assign to Agent** elige el agente del panel con Local Address `127.0.0.1` y el puerto del servidor (por ejemplo `25565`). Luego, en la pestaña **Conexión**, pulsa **"Usar un túnel que ya creé"** y elígelo. Además, "Crear túnel" usa solo cualquier túnel libre que ya apunte al puerto del servidor en vez de crear otro. Al quitar un túnel que vinculaste tú, el panel solo lo desvincula y no lo borra de tu cuenta.


playit.gg crea un túnel desde tu PC hacia sus servidores y te da una dirección pública. Tus amigos se conectan a esa dirección y el tráfico llega a tu PC.

**Instalación en Windows:**

1. Entra a **playit.gg** y crea una cuenta (verifica tu correo).
2. Ve a la sección de **descargas** y baja el programa (agente) para **Windows**. Instálalo; ponlo en su propia carpeta, no dentro de la carpeta del servidor.
3. Ábrelo. La primera vez te muestra un **enlace o código para "reclamar" (claim)** el agente. Ábrelo en el navegador con tu sesión iniciada y **acepta** vincular el agente a tu cuenta.
4. En el sitio de playit.gg, ve a **Tunnels** > **Add Tunnel** (agregar túnel).
5. Elige el tipo **Minecraft Java** y créalo.
6. En la configuración del túnel, revisa la **dirección local** y el **puerto local**:
   - Dirección local: `127.0.0.1` o la IP local de la PC (escríbela a mano, no la pegues).
   - Puerto local: el del servidor según la pestaña **Conexión** del panel (25565, 25566...).
7. Copia la **dirección del túnel** que muestra playit (una dirección con dominio de playit, a veces con puerto incluido). **Esa es la que das a tus amigos.**
8. Para cada servidor adicional, crea otro túnel apuntando a su puerto.
9. Deja el agente de playit **corriendo** mientras el servidor esté encendido. Puedes configurarlo para que arranque con Windows.

**Verificación:** el botón **"Probar desde internet"** del panel prueba tu **IP pública** si dejas el campo vacío. Para probar el túnel, escribe la dirección de playit tal como te la da (con `:puerto` si trae uno) en el campo de la prueba, o pégala en `mcsrvstat.us`.

**Detalles a considerar:** el plan gratuito tiene límites y algunas funciones (dominios personalizados, regiones) son de pago; revisa las condiciones actuales en su sitio. La latencia depende de qué tan cerca esté el servidor de playit que te asignen.

### 8.2 VPN privada: Tailscale, ZeroTier, Radmin VPN

Crean una "red local virtual" entre tus amigos y tú. **Cada amigo** tiene que instalar el programa y unirse a tu red. Ideal para grupos pequeños y de confianza.

- **Tailscale:** instala Tailscale en tu PC y en el equipo de cada amigo; inicia sesión, e invítalos o comparte tu máquina con ellos desde el panel de Tailscale. Se conectan a la IP de Tailscale de tu PC (empieza con `100.`) más el puerto, ej. `100.101.102.103:25565`. Revisa en su sitio el límite de usuarios del plan gratuito.
- **ZeroTier:** creas una red en su sitio, cada amigo se une con el **ID de red** y tú lo autorizas. Se conectan a la IP de ZeroTier de tu PC.
- **Radmin VPN:** gratis, solo Windows. Creas una red con nombre y contraseña; tus amigos se unen y se conectan a la IP que muestra Radmin junto a tu PC.

En los tres casos, el **Firewall de Windows** sigue necesitando la regla del paso 2.

### 8.3 IP pública de pago

Pedir a tu compañía que te quite el CGNAT (ver [5](#5-paso-4-detectar-cgnat)). Después sigues los pasos 1 a 6 normalmente.

### 8.4 Comparación

| Opción | Costo | ¿Tus amigos instalan algo? | Ventajas | Desventajas |
|---|---|---|---|---|
| Abrir puertos (IP pública) | Gratis si ya la tienes | No | Menor latencia, control total, sin intermediarios | No funciona con CGNAT; requiere acceso al módem |
| IP pública de pago | Mensualidad (variable) | No | Igual que arriba | Costo; no todas las compañías la ofrecen a hogares |
| playit.gg | Gratis (con extras de pago) | No | Funciona con CGNAT, fácil de configurar | Depende de un tercero; puede sumar latencia; el agente debe estar abierto |
| Tailscale | Gratis para uso personal (con límites) | Sí | Muy seguro, cifrado, nada expuesto a internet | Cada jugador instala y se une; límite de usuarios |
| ZeroTier | Gratis (con límites) | Sí | Similar a Tailscale | Igual: todos instalan; configuración un poco más técnica |
| Radmin VPN | Gratis | Sí | Muy fácil, popular para jugar | Solo Windows; menos control de seguridad |

---

## 9. Cómo se conectan tus amigos

1. Abren **Minecraft Java Edition** con la **misma versión** que el servidor (la ves en el panel).
2. **Multijugador** > **Agregar servidor**.
3. **Nombre del servidor:** el que quieran (ej. "Server de Juan").
4. **Dirección del servidor:** depende de tu configuración:

| Tu configuración | Lo que escriben | Ejemplo |
|---|---|---|
| IP pública, puerto 25565 | Solo la IP | `187.190.xx.xx` |
| IP pública, otro puerto | IP**:**puerto | `187.190.xx.xx:25566` |
| DuckDNS / No-IP, puerto 25565 | Solo el dominio | `miservermc.duckdns.org` |
| DuckDNS / No-IP, otro puerto | dominio**:**puerto | `miservermc.duckdns.org:25566` |
| Dominio propio con SRV | Solo el subdominio | `creativo.tudominio.com` |
| playit.gg | La dirección del túnel tal cual | (la que muestra playit) |
| Tailscale / ZeroTier / Radmin | IP de la VPN (y puerto si no es 25565) | `100.101.102.103:25566` |
| **Tú mismo, dentro de tu casa** | IP local**:**puerto | `192.168.1.50:25565` |

5. **Listo** y luego doble clic en el servidor.

El puerto **25565** es el predeterminado de Minecraft, por eso no hace falta escribirlo. Cualquier otro puerto **sí** debe escribirse después de dos puntos (`:`), salvo que uses SRV.

---

## 10. Seguridad

Abrir un puerto hace que **cualquiera en internet** pueda intentar conectarse. Hay bots que escanean constantemente buscando servidores de Minecraft. Protégete:

### En el servidor de Minecraft

- **`online-mode=true`** en `server.properties` (es el valor por defecto). Así solo entran cuentas originales de Minecraft verificadas por Mojang/Microsoft. Con `false`, cualquiera puede entrar con el nombre de otra persona (incluido el tuyo, con permisos de operador).
- **Lista blanca (whitelist):** solo entran las personas que tú agregues.
  - En `server.properties`: `white-list=true` y `enforce-whitelist=true`.
  - En la consola del servidor: `whitelist add NombreDelJugador`, `whitelist remove NombreDelJugador`, `whitelist list`.
- **Operadores (`op`):** dáselo solo a gente de mucha confianza.
- Cuidado con plugins y mods: descárgalos solo de sitios confiables (Modrinth, CurseForge, Hangar, SpigotMC).

### El panel

- **Nunca reenvíes el puerto 8080** en el router ni lo pongas en DMZ.
- Si quieres administrar el panel desde fuera de casa, usa **Tailscale**:
  1. Instala Tailscale en la PC del panel y en tu celular/laptop, con la **misma cuenta**.
  2. Desde fuera, abre `http://IP-de-Tailscale-de-tu-PC:8080` (la IP `100.x.x.x` que muestra Tailscale) o el nombre de la máquina si tienes MagicDNS activado.
  3. Solo tus dispositivos pueden entrar; nada queda expuesto a internet.
- Usa una contraseña fuerte en el panel si tiene login.

### La PC

- Mantén **Windows Update** al día y el **antivirus** activo.
- Mantén actualizado **Java** y la versión del servidor (las actualizaciones corrigen fallas de seguridad).
- No abras más puertos de los necesarios. Si un servidor ya no lo usas, **borra su regla** en el router y en el firewall.
- **No uses DMZ** de forma permanente.

### Respaldos

- Haz **copias de seguridad** de los mundos con regularidad (la carpeta del mundo dentro de la carpeta de cada servidor), sobre todo antes de actualizar versiones o instalar plugins.
- Guarda al menos una copia **fuera de la PC** (disco externo o nube).

---

## 11. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| **"Connection timed out"** desde fuera | El paquete no llega: falta reenvío en el router, CGNAT, o el firewall lo descarta | Revisa en orden: firewall (3.5 con `Test-NetConnection` desde otra PC), regla del router (IP local y puerto correctos, protocolo TCP), CGNAT (paso 4) |
| **"Connection refused"** | Llegó a la PC pero nada escucha en ese puerto | El servidor está apagado, o la regla apunta a otro puerto. Revisa el puerto en la pestaña **Conexión** y `netstat -ano \| findstr :25565` |
| Funciona en la PC y en casa, pero **no desde fuera** | Falta reenvío, CGNAT, o la regla apunta a una IP local vieja | Verifica que la IP local de la regla sea la actual; haz la prueba de CGNAT; prueba con el botón del panel |
| Funciona desde fuera, pero **yo no puedo entrar con el dominio estando en casa** | El módem no soporta NAT loopback | Normal. En casa usa la IP local `192.168.1.x:puerto` |
| Funcionaba y **dejó de funcionar** después de un reinicio | Cambió la IP local de la PC o la IP pública | Fija la IP local (paso 1); usa DDNS (paso 5) y revisa que el actualizador esté corriendo |
| El dominio **apunta a una IP vieja** | El cliente DDNS no está actualizando, o la caché DNS | Ejecuta el actualizador a mano; revisa `ultimo.txt` (DuckDNS); en No-IP revisa que el hostname no haya caducado (confirmación de 30 días); `ipconfig /flushdns` |
| Dominio de **Cloudflare** no conecta | Registro con nube naranja (proxy) | Ponlo en **DNS only** (nube gris) |
| **Servidor 2 (25566) no conecta**, el 1 sí | Falta regla para 25566, o el amigo no escribe el puerto | Crea la regla en firewall y router para 25566; escribe `dirección:25566` o usa SRV |
| "**Unknown host**" | Error al escribir el dominio, o DNS aún no propaga | Revisa ortografía; espera unos minutos; prueba con la IP directamente |
| La IP WAN del router empieza con **100.64–100.127** o es **privada** | CGNAT o doble NAT | Pide IP pública a tu compañía, o usa playit.gg / Tailscale (punto 8). Si es doble NAT, reenvía en ambos equipos |
| **No encuentro la opción de puertos** en el módem | Cuenta de usuario limitada de la compañía | Pide a soporte que abran el puerto o te den acceso; o usa playit.gg |
| El botón **"Probar desde internet"** dice que no responde, pero un amigo sí entra | Caché de mcsrvstat.us, o un fallo temporal del servicio | Espera unos minutos y vuelve a probar; prueba también con canyouseeme.org |
| Con **playit.gg** no conecta | Agente cerrado, o el túnel apunta a otro puerto | Abre el agente; revisa dirección y puerto local del túnel; prueba la dirección de playit en mcsrvstat.us |
| "**Outdated client / server**" | Versiones distintas de Minecraft | Usa la misma versión que el servidor |
| "**You are not white-listed**" | Whitelist activa y el jugador no está | `whitelist add NombreDelJugador` en la consola |
| "**Failed to verify username**" | Problema de sesión de la cuenta del jugador | El jugador reinicia el launcher y vuelve a iniciar sesión |
| La ventana de Java nunca apareció y **no conecta desde otra PC de casa** | Windows creó una regla de bloqueo para Java o la red está como "Pública" | Revisa `wf.msc` > Reglas de entrada, borra bloqueos de Java; pon la red como Privada; crea la regla por puerto |

### Si nada funciona

1. Desactiva **temporalmente** el Firewall de Windows y prueba desde otra PC de tu casa. Si funciona, el problema es la regla del firewall (o el de tu antivirus). **Vuelve a activarlo** de inmediato.
2. Revisa que el reenvío apunte a la IP que realmente tiene tu PC **ahora** (`ipconfig`).
3. Confirma si hay CGNAT. Si lo hay, ningún ajuste en tu casa lo resuelve: necesitas IP pública o una alternativa del punto 8.

---

## 12. Jugadores de Bedrock (Geyser)

En la pestaña **Bedrock** de un servidor puedes activar **Geyser**. Con eso, los jugadores de Minecraft Bedrock (Android, iPhone, Windows 10/11, Xbox, PlayStation y Switch) entran al mismo mundo que los de Java.

### Qué servidores lo admiten

| Tipo de servidor | ¿Bedrock? | Notas |
|---|---|---|
| **Paper** | Sí, casi cualquier versión | Si el servidor no está en la versión más reciente de Minecraft, el panel instala también **ViaVersion**. |
| **Fabric** | Solo en la versión más reciente | El panel instala también **Fabric API**. |
| **NeoForge** | Solo en la versión más reciente | |
| **Forge** | No | Geyser no tiene versión para Forge. |
| **Vanilla** | No | No admite plugins. Crea un servidor **Paper**, que se juega igual. |

Ten en cuenta que Geyser traduce entre las dos ediciones: la mayoría de las cosas funcionan, pero algunos mods o mecánicas muy específicas de Java pueden verse o comportarse distinto en Bedrock.

### Floodgate: jugar sin cuenta de Java

Al activar Bedrock, la opción **"Permitir jugadores sin cuenta de Java"** instala **Floodgate**. Sin Floodgate, cada jugador de Bedrock tendría que iniciar sesión además con una cuenta de Minecraft **Java**.

Con Floodgate, los jugadores de Bedrock aparecen con un **punto antes del nombre** (por ejemplo `.Steve`). Así se distinguen de los jugadores de Java.

- **Para agregarlos a la lista blanca:** en la pestaña **Jugadores** escribe el gamertag con el punto (`.Steve`) con el servidor **encendido**. El panel usa el comando `fwhitelist add Steve` de Floodgate.
- **Para hacerlos operador:** usa el nombre con punto: `op .Steve`.

### Abrir el puerto Bedrock

Es igual que el de Java (pasos 1 a 6), con una diferencia: el protocolo es **UDP**.

1. **Firewall de Windows:** ejecuta `scripts\abrir-firewall.bat`, elige **UDP** y escribe el puerto Bedrock (19132 si es el primero). O, en una terminal como administrador:

   ```bat
   netsh advfirewall firewall add rule name="Minecraft Bedrock 19132" dir=in action=allow protocol=UDP localport=19132
   ```

2. **Router:** crea **otra** regla de reenvío con protocolo **UDP**, puerto externo e interno 19132, hacia la IP local de tu PC. Si el router tiene la opción **TCP/UDP** o **Ambos**, también sirve.
3. **Prueba:** en la pestaña **Conexión**, elige **Bedrock** y pulsa **"Probar desde internet"**.

El CGNAT afecta igual a UDP: si tu compañía usa CGNAT (paso 4), el puerto Bedrock tampoco funcionará.

### Cómo se conectan

**Celular, tablet y Windows:**

1. Minecraft > **Jugar** > pestaña **Servidores**.
2. Baja hasta **Agregar servidor**.
3. **Nombre:** el que quieran. **Dirección:** tu IP pública o tu dominio (sin puerto). **Puerto:** el puerto Bedrock (19132, 19133...).

En Bedrock la dirección y el puerto van en **campos separados**. Los registros SRV no funcionan en Bedrock, así que siempre hay que escribir el puerto si no es 19132.

**Xbox, PlayStation y Switch:**

Las consolas **no permiten agregar servidores propios**; solo muestran los servidores destacados. Hay dos formas comunes de rodear esto. Las dos son de terceros (no oficiales), así que úsalas bajo tu propio criterio:

- **MCXboxBroadcast:** una extensión de Geyser que publica tu servidor en la pestaña **Amigos** usando una cuenta de Xbox. Tus amigos agregan esa cuenta como amigo y el servidor aparece para unirse.
- **BedrockConnect:** la consola cambia su DNS a uno de BedrockConnect; al entrar a un servidor destacado aparece una lista donde se escribe la dirección de cualquier servidor.

### Si no puedes abrir puertos

- **playit.gg** tiene túneles para **Minecraft Bedrock** (UDP). Crea un túnel de ese tipo apuntando al puerto Bedrock del servidor, además del túnel de Java.
- **Tailscale** funciona en celulares (Android e iPhone), pero **no en consolas**.

### Problemas comunes con Bedrock

| Síntoma | Causa probable | Solución |
|---|---|---|
| Java entra pero Bedrock no, desde fuera | La regla del firewall o del router es TCP | Crea las reglas como **UDP** |
| Bedrock no conecta ni dentro de casa | Geyser no se cargó o usa otro puerto | Revisa la consola: debe aparecer Geyser iniciando en el puerto correcto. Reinicia el servidor después de activar Bedrock |
| "Outdated client" o "Outdated server" en Bedrock | La versión de Bedrock del jugador es más nueva o más vieja de lo que soporta Geyser | Actualiza Minecraft en el dispositivo, y pulsa **Actualizar Geyser** en la pestaña Bedrock |
| Pide iniciar sesión con una cuenta de Java | Floodgate no está activado | Activa "Permitir jugadores sin cuenta de Java" y reinicia |
| "You are not white-listed" para un jugador de Bedrock | Falta agregarlo con el punto | Agrega `.Gamertag` en la pestaña Jugadores con el servidor encendido |

---

## 13. Seguridad y ataques DDoS

### Qué es un DDoS y qué se puede hacer desde casa

Un **DDoS** es cuando muchas máquinas mandan tráfico basura a tu IP al mismo tiempo. Si el tráfico es mayor que tu velocidad de internet, la conexión se satura: nadie puede jugar y en casa tampoco funciona internet. Ese tráfico llena el cable **antes** de llegar a tu PC, así que **ningún programa en tu PC (ni este panel, ni un firewall) puede detenerlo**.

Lo que sí funciona:

| Riesgo | Qué tan común es en servidores pequeños | Qué lo detiene |
|---|---|---|
| Bots que entran en masa o ensucian el chat | Común | Lista blanca, `online-mode=true`, protección contra oleadas del panel |
| Escáneres que buscan servidores abiertos para destruir construcciones | Muy común | Lista blanca, ocultar jugadores, respaldos |
| Alguien intentando entrar al panel | Raro si no abriste el 8080 | Panel limitado a tu red, contraseña fuerte |
| DDoS contra tu IP | Raro, pero pasa (sobre todo tras discusiones con alguien) | Ocultar tu IP (playit.gg u otro proxy), cambiar de IP |

### Lo que hace el panel

- **Pestaña Seguridad** de cada servidor: revisa la configuración y arregla con un clic lo más importante (verificación de cuentas, lista blanca, RCON, query, ocultar jugadores, límite de reconexión, respaldos).
- **Protección contra oleadas de bots:** si una IP se conecta demasiadas veces por minuto, se bloquea por un rato. Si llegan muchas conexiones de muchas IP, el panel activa la **lista blanca de emergencia** y la quita sola cuando pasa el ataque. Tus IP de casa, Tailscale y el túnel de playit nunca se bloquean.
- **El panel web** solo acepta conexiones de tu PC, tu red y Tailscale (se puede cambiar en Ajustes del panel). Si alguien abre por error el puerto 8080, los de internet ven "Acceso bloqueado". Además bloquea formularios enviados desde otras páginas, limita los intentos de contraseña y guarda un historial de inicios de sesión.

### Esconder tu IP

Quien no conoce tu IP no puede atacar tu internet.

- **playit.gg:** tus amigos se conectan a la dirección de playit, no a tu casa, así que tu IP no aparece. Es lo más sencillo porque ya viene en el panel. Revisa en su sitio qué protección ofrece cada plan.
- **TCPShield:** proxy con protección DDoS para Minecraft Java. Según su documentación tiene un plan gratuito para Java (Bedrock solo en planes de pago). Pide un dominio propio y un plugin en el servidor, y necesita que el servidor se pueda alcanzar desde internet: **no sirve con CGNAT**. Revisa sus requisitos actuales antes de configurarlo.
- **No publiques tu IP** en Discord, redes sociales ni listas públicas de servidores. Si quieres un servidor abierto al público, usa un proxy o un hosting con protección DDoS.

### Si te atacan

1. **Pide ayuda a tu compañía** o **cambia de IP**. Muchas líneas de casa (como Totalplay) tienen IP dinámica: apagar el módem un rato, o pedírselo a soporte, puede darte una IP nueva. Si usas DuckDNS, el panel actualiza tu dominio solo y tus amigos no notan el cambio.
2. Mientras tanto, usa un túnel de playit.gg para que la IP nueva no quede expuesta.
3. Revisa la pestaña **Seguridad** (actividad reciente) y **Logs** para ver qué pasó.

### Lista corta

- [ ] `online-mode=true` y lista blanca si el servidor es para amigos.
- [ ] Protección contra oleadas activada.
- [ ] Respaldos automáticos.
- [ ] El puerto 8080 **nunca** abierto en el router.
- [ ] Contraseña larga en el panel; revisa el historial de inicios de sesión de vez en cuando.
- [ ] Tu IP no publicada; si puedes, usa playit.gg.
- [ ] Plugins y mods solo de Modrinth, Hangar o sitios conocidos.

