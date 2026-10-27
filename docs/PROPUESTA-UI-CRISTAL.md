# Propuesta: diseño y facilidad de uso del panel (tema Cristal 2, Liquid Glass)

Revisión del panel tal como se ve hoy (v0.20.1, tema Cristal con fondo Aurora, Atardecer y en móvil) y propuesta de mejoras. Las capturas que la motivan se tomaron con el panel real corriendo contra los servicios simulados de las pruebas; los mockups de la propuesta están en el lienzo de diseño que acompaña a este documento (tablero, vista de servidor y móvil).

Referencias usadas: la guía de materiales de Apple para Liquid Glass (WWDC25 y la actualización de septiembre de 2025 de la HIG) y la galería de [liquidglassdesign.com](https://liquidglassdesign.com/ui) (tab bars, sidebars, tarjetas, modales, switches, steppers, botones iOS 26 en claro y oscuro, widgets y dashboards). La galería no se pudo abrir desde este entorno; se usó la descripción de sus categorías y las guías de Apple en las que se basa.

## Qué está bien hoy

- El material ya es Liquid Glass de verdad: lavado especular, borde con luz en esquinas opuestas, filo interior, lente SVG por desplazamiento en Chromium, cápsulas, `prefers-reduced-transparency` y `prefers-reduced-motion` respetados.
- Los fondos con luz (Aurora, Atardecer, Fin, Nether…) y las paletas por bioma dan identidad y hacen que el vidrio tenga algo que refractar.
- Accesibilidad de base sólida: axe en cada cambio, foco visible, roles ARIA, diálogos que devuelven el foco.

## Los problemas que se ven en las capturas

1. **Vidrio sobre vidrio.** Medido en el panel real: 22 elementos con `backdrop-filter` en la consola, 32 en Plugins y 43 en Perfil y apariencia (paneles, tarjetas, botones, chips, pestañas, consola). Todo flota, así que nada flota: se pierde la jerarquía y la GPU trabaja de más (en móvil se nota). Es exactamente lo que Apple pide evitar: Liquid Glass es la capa de navegación y controles; el contenido no debe ser vidrio.
2. **Legibilidad de la consola.** Con Atardecer, el naranja del fondo atraviesa la consola y el texto del log queda sobre un degradado. En móvil es peor. Los logs, además, se leen con Pixelify Sans, que a 12–13 px cansa en párrafos largos y en rutas de archivo.
3. **Dos cápsulas de pestañas compitiendo.** Secciones y subsecciones son dos cápsulas iguales en la misma fila; en móvil la cápsula se corta sin pista de que hay más pestañas a la derecha (solo se ven Consola, Jugadores, Plugins, Mundo).
4. **Tarjetas de servidor planas y vacías.** Una fila ancha por servidor con tres mini-gráficas que muestran «–» cuando no hay datos, mucho espacio vacío y dos botones iguales («Apagar» y «Abrir»). El borde eléctrico, aunque vistoso, tapa el canto del vidrio y compite con la lente.
5. **Inconsistencias de radio y estado.** La vista previa del MOTD es un rectángulo con borde duro dentro de un panel de 22 px de radio; inputs a 12 px, paneles a 22 px, botones en cápsula; el botón «Guardar mensaje» deshabilitado parece «verde sucio»; «Apagar» en rojo tiene texto rosa de poco contraste.
6. **Barra lateral poco aprovechada.** Cinco enlaces de texto al pie (guías, ajustes, apariencia, widget, cerrar sesión) con el mismo peso que la lista de servidores; sin iconos ni agrupación.
7. **Avisos permanentes.** La nota de puertos del tablero no se puede cerrar y ocupa el mismo lugar para siempre.

## Propuesta

### 1. Dos capas: navegación en vidrio, contenido en superficie

Definir tres materiales y usarlos de forma semántica:

| Material | Para qué | Valores propuestos |
| --- | --- | --- |
| `glass-nav` | barra lateral, cápsula de pestañas, cabecera del servidor, barra móvil, grupo de acciones | tinte `rgba(14,18,26,.42)`, `blur(24px) saturate(180%)`, borde-luz 0.55 → 0.1 → 0.42, filo interior 0.28, sombra `0 24px 48px -24px rgba(0,0,0,.8)`, radio 24 px (barra) / 999 (cápsulas) |
| `glass-overlay` | modales, menús de jugador, avisos (toast), tooltips | tinte 0.55, `blur(30px)`, sombra `0 50px 100px -30px rgba(0,0,0,.9)`, radio 20–26 px |
| `surface` | paneles, tarjetas, consola, formularios, tablas | `rgba(13,17,24,.78)` sin `backdrop-filter` (o `blur(8px)` como máximo), borde `rgba(255,255,255,.08)`, filo `inset 0 1px 0 rgba(255,255,255,.06)`, radio 20 px |

Regla práctica: como máximo 6 elementos con `backdrop-filter` por pantalla, y la lente SVG solo en `glass-nav` y `glass-overlay` (ya es así), apagada por completo en pantallas de menos de 860 px.

En CSS, los selectores ya existen: `.panel`, `.mcard`, `.rack-slot`, `.terminal`, `.chart`, `.result`… pasan a `surface`; `.sidebar`, `.tabs`, `.server-head`, `.modal`, `.toast`, `.player-menu` se quedan en vidrio. Los botones dejan de llevar `backdrop-filter` propio salvo los que están sobre el fondo (cabecera del tablero).

### 2. Luz detrás, no debajo

Para que el vidrio se note hace falta luz detrás de la navegación. Subir la intensidad de las manchas de color del fondo (Aurora: pasto 0.32, prismarina 0.30, amatista 0.34 en vez de los valores actuales, que sobre `#0a0d13` casi no se distinguen de un panel opaco) y, a la vez, hacer sólido el contenido para que esa luz nunca cruce el texto. Así Atardecer sigue siendo precioso en la barra lateral y en las pestañas sin romper la consola.

### 3. Tipografía mixta por defecto

- Nueva opción de letra **Mixta** (y por defecto): Pixelify Sans en marca, títulos, nombres de servidor y de jugador; letra del sistema en cuerpo, formularios y etiquetas; monoespaciada real (JetBrains Mono / Cascadia Mono / Consolas) en consola, logs, rutas y direcciones.
- Las opciones «Pixelada» (todo pixel, como hoy) y «Clásica» se conservan.
- Contraste: `--sand-faint` (#979eac) sobre `surface` pasa de 7:1; sobre vidrio al 0.38 con zonas claras del fondo (Atardecer, Nevada) puede bajar de 4.5:1. Las etiquetas pequeñas sobre vidrio usan `--sand-dim` (#b9bfcb) como mínimo.

### 4. Una sola cápsula de pestañas, con iconos

- La cápsula principal lleva icono + texto; el indicador de la pestaña activa es un elemento que se desliza (`transform` en 200 ms con una curva tipo resorte), no un cambio de color por pestaña.
- Las subsecciones (General / Tareas, Explorar / Instalados, Internet / Bedrock…) dejan de ser una segunda cápsula y pasan a una fila de texto discreta con subrayado dentro del contenido.
- Al hacer scroll, la cabecera del servidor se compacta (icono pequeño + nombre + estado) y la cápsula queda `position: sticky` con un «scroll edge»: un degradado de 24 px que separa la barra del contenido que pasa por debajo.
- En pantallas estrechas, la cápsula muestra un degradado al borde derecho cuando hay más pestañas y se puede arrastrar con el dedo.

### 5. Tarjetas de servidor con jerarquía

- Rejilla de 2 columnas a partir de 1100 px (una fila por servidor por debajo).
- Cabecera: icono, nombre en pixel, línea de meta (tipo, versión, puerto, RAM) y **estado como cápsula de color** con tiempo encendido («Encendido · 2 h 14 min», «Se cayó hace 4 min», «Apagado»).
- Métricas en tres losas (Jugando con caras, RAM con barra, TPS con mini-gráfica). Si el servidor está apagado o no hay datos, las tres losas se sustituyen por una sola línea («Sin actividad en la última hora») en lugar de tres «–».
- Si se cayó, la tarjeta muestra la causa que ya detecta el analizador de crashes («Falta un mod: sodium necesita fabric-api») con enlace al crash report.
- Una sola acción principal (Encender / Apagar); «Abrir» pasa a enlace fantasma con flecha y toda la tarjeta es clicable.
- Estado en el canto: un anillo de 1 px del color del estado con halo suave (`0 0 0 1px rgba(63,207,99,.35), 0 0 24px -6px rgba(63,207,99,.35)`). El **borde eléctrico** se mantiene como opción en Apariencia, pero apagado por defecto: en vidrio tapa el canto y compite con la lente.
- Última tarjeta: «Nuevo servidor» con borde discontinuo (sustituye al botón secundario del encabezado cuando hay servidores).
- El resumen (encendidos, jugando, RAM, núcleos) pasa a una sola línea bajo el título; el detalle de RAM va dentro de las tarjetas.

### 6. Barra lateral

- Servidores con punto de estado y, si hay jugadores, una cápsula con la cuenta; si se cayó, la palabra «Caído» en rojo.
- El pie se reduce a tres filas: Guías, Ajustes del panel (con icono) y una **tarjeta de usuario** (avatar de la skin, nombre) que abre un menú con Perfil y apariencia, Widget flotante y Cerrar sesión.
- La barra es `glass-nav` con esquinas de 24 px y margen de 16 px respecto a la ventana, como una lámina que flota sobre el fondo (hoy va pegada al borde).

### 7. La consola

- `surface` casi opaca (`rgba(5,7,11,.72)` sobre la superficie) con «scroll edge» arriba para separar los filtros del texto.
- Filtros como chips sin vidrio; buscador con atajo `/` visible como `kbd`.
- Entrada de comando con pista «↑ ↓ historial»; en móvil, botón Enviar de 44 px.
- Columna derecha en una sola superficie: cuatro cifras grandes (jugadores, TPS, CPU, encendido), barra de memoria, dirección copiable y comandos rápidos como píldoras que se envuelven.

### 8. Móvil

- Barra inferior flotante de vidrio con Consola, Jugadores, Plugins, Mundo y «Más» (abre una hoja con el resto). Hoy las pestañas de arriba se cortan sin aviso.
- Cabecera compacta con botón de volver, icono, nombre y estado; «Apagar» a la derecha.
- Objetivos táctiles de 44 px en botones, chips y filas de lista.
- Lente SVG apagada y `blur` a 20 px; el fondo animado se apaga por defecto en móvil (ahorra batería).

### 9. Consistencia de formas y estados

- Escala de radios concéntricos: contenedor 24 → panel 20 → losa interior 12 → input 12 → chip/botón 999. Regla: radio del hijo = radio del padre − padding.
- La vista previa del MOTD y el editor de icono adoptan el radio de losa interior (12 px) y el borde `rgba(255,255,255,.1)`.
- Botones deshabilitados: opacidad 0.45 y sin brillo especular (hoy el verde deshabilitado se ve «sucio»).
- `btn-stop`: texto `#ffd6cf` sobre tinte rojo 0.22 (contraste > 4.5:1).

### 10. Microinteracciones «líquidas» (opcionales, fase 3)

- Indicador de pestaña y de segmentos que se desliza y se estira ligeramente al moverse (`scaleX(1.08)` 120 ms y vuelta).
- Avisos que entran con resorte desde arriba y se apilan con desplazamiento de 8 px.
- Botón principal con brillo que sigue al cursor (`--mx`/`--my` desde `pointermove`, un `radial-gradient` de 120 px al 0.18 de blanco).
- Cambio de tema y de fondo con `view-transition` (crossfade de 300 ms) en vez de salto.

### 11. Accesibilidad y adaptación

- Añadir `prefers-contrast: more`: tinte de vidrio 0.9, bordes `rgba(255,255,255,.35)`, sin lente.
- Ajuste **Transparencia del vidrio** en Apariencia con tres presets (Transparente / Equilibrado / Sólido) además de los deslizadores actuales.
- Anillo de foco de 2 px prismarina con `outline-offset: 3px` sobre vidrio (el actual de 4 px a 0.2 de opacidad se pierde sobre fondos claros).
- `role="tablist"` / `aria-selected` en las cápsulas de pestañas si aún no lo llevan todas.

## Orden sugerido

| Fase | Qué | Alcance |
| --- | --- | --- |
| 1 | Materiales (`glass-nav`, `glass-overlay`, `surface`), fondo con más luz, letra Mixta por defecto, consola sólida, radios y estados | solo `styles.css`, `appearance.js` (opción de letra) y `index.html`; un PR |
| 2 | Tarjetas de servidor nuevas, barra lateral con tarjeta de usuario, cápsula de pestañas única con subsecciones en texto, barra inferior móvil | `Home.jsx`, `App.jsx`, `ServerView.jsx` y CSS |
| 3 | Microinteracciones, `prefers-contrast`, presets de transparencia, `view-transition` | CSS y `Appearance.jsx` |

Cada fase se revisa con las pruebas e2e existentes (axe y Playwright) y con capturas en Aurora, Atardecer y móvil, que son los tres casos donde hoy se ven los problemas.
