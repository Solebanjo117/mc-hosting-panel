/**
 * Explica en español las causas más comunes de que un servidor no arranque o se cierre.
 * Recibe el texto de un crash report o las últimas líneas de la consola.
 */

const JAVA_BY_CLASS = { 52: 8, 55: 11, 60: 16, 61: 17, 65: 21, 66: 22, 67: 23, 68: 24, 69: 25 };

const RULES = [
  {
    test: /java\.lang\.OutOfMemoryError|There is insufficient memory for the Java Runtime/,
    get: () => ({
      title: 'Se acabó la memoria',
      detail: 'Java se quedó sin RAM para el servidor.',
      fix: 'Sube la memoria en Ajustes (con mods, 6 GB o más). Si la PC tiene poca RAM, cierra otros programas o baja la distancia de visión.',
    }),
  },
  {
    test: /UnsupportedClassVersionError.*class file version (\d+)/,
    get: (m) => {
      const needed = JAVA_BY_CLASS[Number(m[1])] || `${Number(m[1]) - 44}`;
      return {
        title: `Algo necesita Java ${needed}`,
        detail: `Un archivo (el servidor, un mod o un plugin) fue compilado para Java ${needed} o más nuevo.`,
        fix: 'Si pusiste una ruta de Java propia en Ajustes, bórrala para que el panel use la correcta. Si es un mod o plugin, puede que sea para una versión de Minecraft más nueva que la de tu servidor.',
      };
    },
  },
  {
    test: /FAILED TO BIND TO PORT|Address already in use|BindException/,
    get: () => ({
      title: 'El puerto está ocupado',
      detail: 'Otro programa (u otra copia de este servidor) ya está usando el puerto.',
      fix: 'Cierra el otro servidor o programa, o cambia el puerto en Ajustes. En Windows puedes ver quién lo usa con: netstat -ano | findstr :25565',
    }),
  },
  {
    test: /You need to agree to the EULA/,
    get: () => ({ title: 'Falta aceptar el EULA', detail: 'El archivo eula.txt no dice eula=true.', fix: 'Abre eula.txt en Archivos y cambia la línea a eula=true.' }),
  },
  {
    // Fabric: "Mod 'Geyser' (geyser-fabric) 2.4.0 requires any version of fabric-api, which is missing!"
    test: /Mod '([^']+)' \([^)]*\) \S+ requires (?:any version|version [^,]+) of '?([\w\-.]+)'?(?: \([^)]*\))?, which is missing/g,
    all: true,
    get: (m) => ({
      title: `${m[1]} necesita ${prettyMod(m[2])}`,
      detail: `El mod ${m[1]} depende de ${prettyMod(m[2])}, que no está instalado.`,
      fix: `Busca e instala ${prettyMod(m[2])} en la pestaña Mods.`,
    }),
  },
  {
    // Fabric: "Mod 'X' requires version 1.21 of 'minecraft', but only the wrong version is present: 1.20.4!"
    test: /Mod '([^']+)' \([^)]*\) \S+ requires [^\n]*?of '?(minecraft|fabricloader|java)'?[^\n]*?wrong version is present: ([^\s!]+)/g,
    all: true,
    get: (m) => ({
      title: `${m[1]} no es para esta versión`,
      detail: `${m[1]} pide otra versión de ${m[2] === 'minecraft' ? 'Minecraft' : m[2]} (tienes ${m[3]}).`,
      fix: 'Quita el mod o instala la versión del mod que corresponde a tu servidor.',
    }),
  },
  {
    // Fabric: "Mod 'A' is incompatible with ... 'B'"
    test: /Mod '([^']+)' \([^)]*\) \S+ is incompatible with [^']*'([^']+)'/g,
    all: true,
    get: (m) => ({ title: `${m[1]} choca con ${m[2]}`, detail: 'Los dos mods no pueden estar juntos.', fix: `Desactiva uno de los dos (${m[1]} o ${m[2]}).` }),
  },
  {
    // Forge/NeoForge: "Mod ID: 'architectury', Requested by: 'rei', Expected range: '[9.1,)', Actual version: '[MISSING]'"
    test: /Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '([^']+)'/g,
    all: true,
    get: (m) =>
      m[4] === '[MISSING]'
        ? { title: `${m[2]} necesita ${m[1]}`, detail: `Falta el mod ${m[1]}.`, fix: `Instala ${m[1]} (versión ${m[3]}) en la pestaña Mods.` }
        : {
            title: `${m[2]} necesita otra versión de ${m[1]}`,
            detail: `Pide ${m[3]} y tienes ${m[4]}.`,
            fix: `Actualiza o cambia la versión de ${m[1]}.`,
          },
  },
  {
    test: /Attempted to load class net\/minecraft\/client|Environment type CLIENT|ClassNotFoundException: net\.minecraft\.client/,
    get: () => ({
      title: 'Hay un mod que es solo para el juego (cliente)',
      detail: 'Algunos mods (minimapas, shaders, menús) solo funcionan en el juego, no en el servidor.',
      fix: 'Busca en el reporte el nombre del mod y quítalo de la carpeta mods. Los mods con la etiqueta "Solo funciona en el cliente" en el marketplace no van en el servidor.',
    }),
  },
  {
    test: /Mixin apply (?:for mod (\S+) )?failed|MixinApplyError|InvalidMixinException|from mod (\S+) failed injection check/,
    get: (m) => {
      const mod = m[1] || m[2];
      return {
        title: mod ? `El mod ${mod} no es compatible` : 'Un mod no es compatible',
        detail: 'Un mod intentó modificar el juego y falló. Suele pasar por versiones distintas o mods que chocan entre sí.',
        fix: mod ? `Actualiza o quita ${mod}.` : 'Busca "mixin" en el reporte para ver el nombre del mod, y actualízalo o quítalo.',
      };
    },
  },
  {
    // Paper/Spigot: "Could not load 'plugins/X.jar' in folder 'plugins'" + UnknownDependencyException
    test: /Could not load '?plugins[\\/]([^'\s]+)'?[\s\S]{0,400}?Unknown(?:\/missing)? dependency plugins?: \[([^\]]+)\]/g,
    all: true,
    get: (m) => ({
      title: `${m[1].replace(/\.jar$/, '')} necesita ${m[2]}`,
      detail: `El plugin necesita ${m[2]}, que no está instalado.`,
      fix: `Instala ${m[2]} desde la pestaña Plugins.`,
    }),
  },
  {
    test: /Could not load '?plugins[\\/]([^'\s]+)'?[\s\S]{0,300}?Unsupported API version ([\d.]+)/g,
    all: true,
    get: (m) => ({
      title: `${m[1].replace(/\.jar$/, '')} es para una versión más nueva`,
      detail: `El plugin pide Minecraft ${m[2]} o superior.`,
      fix: 'Actualiza el servidor o instala una versión anterior del plugin.',
    }),
  },
  {
    test: /The server has stopped responding|A single server tick took|Watchdog/,
    get: () => ({
      title: 'El servidor se congeló',
      detail: 'Un tick tardó demasiado y el vigilante (watchdog) cerró el servidor. Suele ser lag extremo: granjas enormes, muchas entidades o un mod con fallas.',
      fix: 'Revisa el reporte para ver qué estaba procesando. Si pasa seguido, sube la RAM, baja la distancia de visión o quita el mod/plugin sospechoso.',
    }),
  },
  {
    test: /Failed to load level|Exception reading .*level\.dat|Corrupted chunk|RegionFile.*(corrupt|Failed)/i,
    get: () => ({
      title: 'El mundo podría estar dañado',
      detail: 'El servidor no pudo leer parte del mundo.',
      fix: 'Restaura un respaldo desde la pestaña Respaldos. Si no tienes, prueba quitar mods que agreguen bloques o dimensiones.',
    }),
  },
  {
    test: /Can't keep up! Is the server overloaded\?/g,
    all: true,
    group: true,
    get: (_m, count) => ({
      title: 'El servidor va con lag',
      detail: `Apareció ${count} ${count === 1 ? 'vez' : 'veces'} el aviso "Can't keep up!": el servidor no alcanza a procesar todo a tiempo.`,
      fix: 'Sube la RAM, baja view-distance y simulation-distance, y revisa granjas o mods pesados. Las gráficas de Rendimiento muestran cuándo pasa.',
    }),
  },
];

function prettyMod(id) {
  const known = { 'fabric-api': 'Fabric API', fabric: 'Fabric API', 'fabric-language-kotlin': 'Fabric Language Kotlin', cloth_config: 'Cloth Config', architectury: 'Architectury API', geckolib: 'GeckoLib' };
  return known[id] || id;
}

export function analyze(text) {
  const findings = [];
  const seen = new Set();
  for (const rule of RULES) {
    if (rule.all) {
      const matches = [...text.matchAll(rule.test)];
      if (!matches.length) continue;
      if (rule.group) {
        findings.push(rule.get(matches[0], matches.length));
        continue;
      }
      for (const m of matches) {
        const f = rule.get(m);
        if (seen.has(f.title)) continue;
        seen.add(f.title);
        findings.push(f);
      }
    } else {
      const m = text.match(rule.test);
      if (m) {
        const f = rule.get(m);
        if (!seen.has(f.title)) {
          seen.add(f.title);
          findings.push(f);
        }
      }
    }
  }
  return findings.slice(0, 8);
}
