import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startDnsServer } from './dnsServer.js';

/**
 * Servicios de internet simulados para las pruebas: Mojang, PaperMC, Fabric, Forge, NeoForge,
 * Modrinth, Hangar, CurseForge, playit.gg, DuckDNS, deSEC, Cloudflare, mcmeta, mcsrvstat, ipify…
 *
 * El panel se arranca con MCP_URL_REWRITE apuntando cada dominio real a una ruta de este servidor.
 * `state` guarda lo que recibieron (registros DNS, túneles…) para comprobarlo en las pruebas.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'java');
export const FAKE_SERVER_JAR = fs.readFileSync(path.join(FIXTURES, 'fake-server.jar'));
export const FAKE_INSTALLER_JAR = fs.readFileSync(path.join(FIXTURES, 'fake-installer.jar'));

export const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// Proyectos de Modrinth que conoce el simulador.
const MODRINTH_PROJECTS = {
  luckperms: { title: 'LuckPerms', type: 'plugin', loaders: ['paper', 'spigot', 'bukkit', 'fabric', 'forge', 'neoforge'] },
  worldedit: { title: 'WorldEdit', type: 'plugin', loaders: ['paper', 'fabric'] },
  'fabric-api': { id: 'P7dR8mSH', title: 'Fabric API', type: 'mod', loaders: ['fabric'] },
  P7dR8mSH: { alias: 'fabric-api' },
  'needs-api': { title: 'Mod que necesita Fabric API', type: 'mod', loaders: ['fabric'], deps: ['P7dR8mSH'] },
  sodium: { title: 'Sodium', type: 'mod', loaders: ['fabric'], clientOnly: true },
  lithium: { title: 'Lithium', type: 'mod', loaders: ['fabric'] },
  'ferrite-core': { title: 'FerriteCore', type: 'mod', loaders: ['fabric', 'forge', 'neoforge'] },
  modernfix: { title: 'ModernFix', type: 'mod', loaders: ['fabric', 'forge', 'neoforge'] },
  bluemap: { title: 'BlueMap', type: 'plugin', loaders: ['paper', 'fabric', 'forge', 'neoforge'] },
  chunky: { title: 'Chunky', type: 'plugin', loaders: ['paper', 'fabric', 'forge', 'neoforge'] },
  wKkoqHrH: { title: 'Geyser', type: 'plugin', loaders: ['paper', 'fabric', 'neoforge'] },
  bWrNNfkb: { title: 'Floodgate', type: 'mod', loaders: ['fabric', 'neoforge'] },
  viaversion: { title: 'ViaVersion', type: 'plugin', loaders: ['paper'] },
  'terralith-pack': { title: 'Terralith', type: 'datapack', loaders: ['datapack'], categories: ['worldgen'] },
  'herramientas-pack': { title: 'Herramientas Extra', type: 'datapack', loaders: ['datapack'], categories: ['utility'] },
  'cool-pack': { title: 'Cool Pack', type: 'modpack', loaders: ['fabric'] },
  servercore: { title: 'ServerCore', type: 'mod', loaders: ['fabric'], clientSide: 'unsupported' },
};

const resolveProject = (id) => (MODRINTH_PROJECTS[id]?.alias ? MODRINTH_PROJECTS[id].alias : id);

const MOJANG_VERSIONS = [
  { id: '1.21.4', java: 21 },
  { id: '1.20.1', java: 17 },
  { id: '1.16.5', java: 8 },
];

export async function startMocks() {
  const state = {
    requests: [],
    playit: { tunnels: [], pending: [], createError: null, agentId: 'aaaabbbb-0000-0000-0000-000000000001', claim: {} },
    duckdns: { token: '11111111-2222-3333-4444-555555555555', updates: [] },
    desec: { token: 'desec-token', domain: 'prueba.dedyn.io', records: new Map() },
    cloudflare: { token: 'cf-token', zone: 'midominio.com', records: [], nextId: 1 },
    curseforgeKey: 'cf-key-123',
    modrinthUpdates: {}, // sha1 -> { project, version }
    paperBuild: 120, // build estable más nuevo de Paper
    mcsrvstatOnline: true,
    files: {}, // nombre -> contenido extra para /files/
    cf: { mods: {}, files: {} },
  };
  const cfMod = (id, slug, name, extra = {}) => ({
    id,
    slug,
    name,
    summary: name,
    downloadCount: 100,
    dateModified: new Date().toISOString(),
    authors: [{ name: 'tester' }],
    logo: { thumbnailUrl: null },
    screenshots: [],
    categories: [],
    links: { websiteUrl: `https://www.curseforge.com/minecraft/${extra.classId === 4471 ? 'modpacks' : 'mc-mods'}/${slug}` },
    classId: 6,
    allowModDistribution: true,
    ...extra,
  });
  const cfFile = (id, modId, fileName, extra = {}) => ({
    id,
    modId,
    displayName: fileName,
    fileName,
    releaseType: 1,
    fileDate: new Date(Date.now() - (10000 - id) * 1000).toISOString(),
    downloadCount: 1,
    downloadUrl: `${base}/files/${fileName}`,
    fileLength: 10,
    hashes: [],
    gameVersions: ['1.21.4'],
    dependencies: [],
    isAvailable: true,
    ...extra,
  });
  state.cfMod = cfMod;
  state.cfFile = cfFile;
  Object.assign(state.cf.mods, {
    1001: cfMod(1001, 'jei', 'Just Enough Items', { summary: 'Recetas', authors: [{ name: 'mezz' }], categories: [{ name: 'Utility' }] }),
    1002: cfMod(1002, 'bloqueado', 'Mod Bloqueado', { summary: 'Sin descargas externas', logo: null, allowModDistribution: false }),
  });

  // DNS simulado: las direcciones de playit son nombres (Java usa un registro SRV con el puerto).
  state.dnsRecords = new Map();
  let playitCount = 0;
  /** Crea una dirección como las de playit y sus registros DNS. Devuelve lo que muestra playit. */
  function addPlayitAddress(kind) {
    const n = ++playitCount;
    if (kind === 'java') {
      const slug = `tunel-${n}`;
      state.dnsRecords.set(`SRV _minecraft._tcp.${slug}.gl.joinmc.link`, [{ port: 41000 + n, target: `${slug}.gl.at.ply.gg` }]);
      state.dnsRecords.set(`A ${slug}.gl.at.ply.gg`, [`147.185.221.${10 + n}`]);
      return `${slug}.gl.joinmc.link`;
    }
    state.dnsRecords.set(`A bedrock-${n}.ply.gg`, [`147.185.221.${100 + n}`]);
    return `bedrock-${n}.ply.gg:${45000 + n}`;
  }
  state.addPlayitAddress = addPlayitAddress;
  const dns = await startDnsServer(state.dnsRecords);

  let base = '';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const u = new URL(req.url, 'http://mock');
      state.requests.push({ method: req.method, path: u.pathname, query: u.search, body, headers: req.headers });
      const send = (obj, status = 200) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(obj));
      };
      const text = (t, status = 200, type = 'text/plain') => {
        res.statusCode = status;
        res.setHeader('content-type', type);
        res.end(t);
      };
      const bin = (buf) => {
        res.setHeader('content-type', 'application/java-archive');
        res.setHeader('content-length', buf.length);
        res.end(buf);
      };
      try {
        route(u, req, body, { send, text, bin });
      } catch (err) {
        text(String(err.stack || err), 500);
      }
    });
  });

  const P = (u) => u.pathname;

  function route(u, req, body, { send, text, bin }) {
    const p = P(u);

    // --- Archivos descargables ---------------------------------------------------------
    if (p.startsWith('/files/installer/')) return bin(FAKE_INSTALLER_JAR);
    if (p.startsWith('/files/') || p.startsWith('/cdn/')) {
      const name = decodeURIComponent(p.split('/').pop());
      if (state.files[name] !== undefined) return bin(Buffer.from(state.files[name]));
      // Los jars de servidor deben arrancar; los mods/plugins solo necesitan contenido distinto (cada uno su hash).
      if (/^(vanilla|paper)-/.test(name)) return bin(FAKE_SERVER_JAR);
      return bin(Buffer.from(`contenido de ${name}`));
    }

    // --- Mojang ----------------------------------------------------------------------------
    if (p === '/mojang/mc/game/version_manifest_v2.json') {
      return send({
        latest: { release: '1.21.4', snapshot: '1.21.4' },
        versions: MOJANG_VERSIONS.map((v) => ({ id: v.id, type: 'release', url: `${base}/mojang/v1/${v.id}.json`, releaseTime: '2024-12-03T10:12:57+00:00' })),
      });
    }
    let m = p.match(/^\/mojang\/v1\/(.+)\.json$/);
    if (m) {
      const v = MOJANG_VERSIONS.find((x) => x.id === m[1]);
      if (!v) return send({ error: 'not found' }, 404);
      return send({
        id: v.id,
        javaVersion: { majorVersion: v.java },
        downloads: { server: { url: `${base}/files/vanilla-${v.id}.jar` } },
        assetIndex: { url: `${base}/mojang/assets/${v.id}.json` },
      });
    }
    m = p.match(/^\/mojang-api\/users\/profiles\/minecraft\/([^/]+)$/);
    if (m) {
      const known = { notch: ['Notch', '069a79f444e94726a5befca90e38aaf5'], steve: ['Steve', '8667ba71b85a4004af54457a9734eed7'] };
      const k = known[decodeURIComponent(m[1]).toLowerCase()];
      return k ? send({ name: k[0], id: k[1] }) : text('', 404);
    }
    if (p.startsWith('/mojang/assets/')) return send({ objects: { 'minecraft/lang/es_mx.json': { hash: 'ab0123456789abcdef0123456789abcdef012345' } } });
    if (p.startsWith('/resources/ab/')) {
      return send({ 'item.minecraft.diamond_sword': 'Espada de diamante', 'item.minecraft.diamond': 'Diamante', 'block.minecraft.stone': 'Piedra', 'effect.minecraft.speed': 'Velocidad', 'entity.minecraft.zombie': 'Zombi', 'gui.ok': 'Aceptar' });
    }

    // --- PaperMC (Fill v3) ---------------------------------------------------------------
    if (p === '/paper') return send({ versions: { '1.21': ['1.21.4', '1.21.4-rc1'], '1.20': ['1.20.1'] } });
    m = p.match(/^\/paper\/versions\/([^/]+)\/builds$/);
    if (m) return send([{ id: state.paperBuild, channel: 'STABLE', downloads: { 'server:default': { url: `${base}/files/paper-${m[1]}-${state.paperBuild}.jar` } } }, { id: state.paperBuild + 1, channel: 'BETA', downloads: { 'server:default': { url: `${base}/files/paper-beta.jar` } } }]);

    // --- Fabric ----------------------------------------------------------------------------
    if (p === '/fabric/versions/game') return send([{ version: '1.21.4', stable: true }, { version: '25w01a', stable: false }]);
    if (p === '/fabric/versions/installer') return send([{ version: '1.0.1', stable: true }]);
    m = p.match(/^\/fabric\/versions\/loader\/([^/]+)$/);
    if (m) return send([{ loader: { version: '0.16.10', stable: true } }, { loader: { version: '0.16.9', stable: true } }]);
    if (/^\/fabric\/versions\/loader\/[^/]+\/[^/]+\/[^/]+\/server\/jar$/.test(p)) return bin(FAKE_SERVER_JAR);

    // --- Forge / NeoForge ----------------------------------------------------------------
    if (p === '/forge-files/net/minecraftforge/forge/promotions_slim.json') return send({ promos: { '1.20.1-recommended': '47.3.0', '1.20.1-latest': '47.3.10' } });
    if (p.startsWith('/forge-maven/') && p.endsWith('-installer.jar')) return bin(FAKE_INSTALLER_JAR);
    if (p === '/neo-maven/api/maven/versions/releases/net/neoforged/neoforge') return send({ versions: ['0.20.1.1', '21.1.77', '21.4.10-beta'] });
    if (p.startsWith('/neo-maven/releases/') && p.endsWith('-installer.jar')) return bin(FAKE_INSTALLER_JAR);

    // --- Modrinth ------------------------------------------------------------------------
    if (p === '/modrinth/search') {
      const facets = u.searchParams.get('facets') || '';
      const kind = (facets.match(/project_type:(\w+)/) || [])[1];
      const q = (u.searchParams.get('query') || '').toLowerCase();
      const hits = Object.entries(MODRINTH_PROJECTS)
        .filter(([, d]) => !d.alias && (!kind || d.type === kind) && (!q || d.title.toLowerCase().includes(q)))
        .map(([slug, d], i) => ({
          project_id: d.id || slug,
          slug,
          title: d.title,
          description: `${d.title} para pruebas`,
          author: 'tester',
          icon_url: null,
          downloads: 1000 - i,
          follows: 10,
          date_modified: new Date().toISOString(),
          display_categories: d.categories || ['utility'],
          categories: [...(d.categories || ['utility']), ...d.loaders],
          server_side: d.clientOnly ? 'unsupported' : 'required',
          project_type: d.type,
          featured_gallery: null,
          gallery: [],
          color: 0x4fb3a9,
        }));
      return send({ total_hits: hits.length, hits });
    }
    if (p === '/modrinth/projects') {
      const ids = JSON.parse(u.searchParams.get('ids') || '[]');
      return send(
        ids
          .map((id) => {
            const slug = resolveProject(id);
            const d = MODRINTH_PROJECTS[slug];
            return d && { id: d.id || slug, slug, title: d.title, client_side: d.clientSide || (d.clientOnly ? 'required' : 'optional'), server_side: d.clientOnly ? 'unsupported' : 'required' };
          })
          .filter(Boolean)
      );
    }
    if (p === '/modrinth/versions') {
      const ids = JSON.parse(u.searchParams.get('ids') || '[]');
      return send(
        ids
          .map((id) => id.match(/^v-(.+)-(\d+)$/))
          .filter(Boolean)
          .map(([id, slug, n]) => ({ id, project_id: slug, files: [{ primary: true, url: `${base}/files/${slug}-${n}.0.0.jar`, filename: `${slug}-${n}.0.0.jar` }] }))
      );
    }
    if (p === '/modrinth/version_files/update' && req.method === 'POST') {
      const { hashes } = JSON.parse(body || '{}');
      const out = {};
      for (const h of hashes || []) {
        const up = state.modrinthUpdates[h];
        if (up) out[h] = { id: `v-${up.project}-2`, project_id: up.project, version_number: '2.0.0', files: [{ primary: true, url: `${base}/files/${up.project}-2.0.0.jar`, filename: `${up.project}-2.0.0.jar`, hashes: { sha1: 'nuevo' } }] };
      }
      return send(out);
    }
    m = p.match(/^\/modrinth\/project\/([^/]+)\/version$/);
    if (m) {
      const slug = resolveProject(decodeURIComponent(m[1]));
      const d = MODRINTH_PROJECTS[slug];
      if (!d) return send({ error: 'not_found' }, 404);
      const loaders = JSON.parse(u.searchParams.get('loaders') || '[]');
      if (loaders.length && !loaders.some((l) => d.loaders.includes(l))) return send([]);
      const ext = d.type === 'datapack' ? 'zip' : d.type === 'modpack' ? 'mrpack' : 'jar';
      const newer = Object.values(state.modrinthUpdates).some((x) => x.project === (d.id || slug))
        ? [{ id: `v-${d.id || slug}-2`, name: `${d.title} 2.0.0`, version_number: '2.0.0', version_type: 'release', date_published: new Date().toISOString(), downloads: 1, loaders: d.loaders, game_versions: ['1.21.4'], files: [{ primary: true, url: `${base}/files/${slug}-2.0.0.${ext}`, filename: `${slug}-2.0.0.${ext}`, size: 10, hashes: { sha1: 'nuevo' } }], dependencies: [] }]
        : [];
      return send([
        ...newer,
        {
          id: `v-${slug}-1`,
          name: `${d.title} 1.0.0`,
          version_number: '1.0.0',
          version_type: 'release',
          date_published: new Date().toISOString(),
          downloads: 5,
          loaders: d.loaders,
          game_versions: ['1.21.4'],
          files: [{ primary: true, url: `${base}/files/${slug}-1.0.0.${ext}`, filename: `${slug}-1.0.0.${ext}`, size: 10, hashes: { sha1: 'x' } }],
          dependencies: (d.deps || []).map((dep) => ({ project_id: dep, version_id: null, dependency_type: 'required' })),
        },
      ]);
    }
    m = p.match(/^\/modrinth\/project\/([^/]+)$/);
    if (m) {
      const slug = resolveProject(decodeURIComponent(m[1]));
      const d = MODRINTH_PROJECTS[slug];
      if (!d) return send({ error: 'not_found' }, 404);
      return send({
        id: d.id || slug,
        slug,
        title: d.title,
        description: `${d.title} para pruebas`,
        body: '## Hola\n\n<script>alert(1)</script>Texto **bold**',
        icon_url: null,
        project_type: d.type,
        downloads: 1000,
        followers: 10,
        updated: new Date().toISOString(),
        license: { id: 'MIT', name: 'MIT' },
        gallery: [{ url: `${base}/files/shot.png`, title: 'Captura', featured: true }],
        source_url: 'https://example.com/src',
        server_side: d.clientOnly ? 'unsupported' : 'required',
      });
    }

    // --- Hangar ----------------------------------------------------------------------------
    if (p === '/hangar/projects') {
      return send({
        pagination: { count: 2 },
        result: [
          { name: 'EssentialsX', description: 'Comandos básicos', namespace: { owner: 'Essentials', slug: 'EssentialsX' }, avatarUrl: null, stats: { downloads: 500 }, lastUpdated: new Date().toISOString(), category: 'admin_tools' },
          { name: 'Externo', description: 'Solo enlace externo', namespace: { owner: 'Otro', slug: 'Externo' }, avatarUrl: null, stats: { downloads: 5 }, lastUpdated: new Date().toISOString(), category: 'misc' },
        ],
      });
    }
    m = p.match(/^\/hangar\/projects\/([^/]+)\/versions$/);
    if (m) {
      const external = m[1] === 'Externo';
      return send({
        result: [
          {
            name: '2.21.0',
            channel: { name: 'Release' },
            createdAt: new Date().toISOString(),
            stats: { totalDownloads: 10 },
            downloads: { PAPER: external ? { externalUrl: 'https://example.com/plugin' } : { downloadUrl: `${base}/files/EssentialsX-2.21.0.jar`, fileInfo: { name: 'EssentialsX-2.21.0.jar', sizeBytes: 100 } } },
            platformDependencies: { PAPER: ['1.21.4'] },
          },
        ],
      });
    }
    m = p.match(/^\/hangar\/projects\/([^/]+)$/);
    if (m) return send({ name: m[1], description: 'Plugin', namespace: { owner: 'x', slug: m[1] }, stats: { downloads: 5, stars: 1 }, settings: { links: [] } });
    if (p.startsWith('/hangar/pages/main/')) return text('# Página principal');

    // --- CurseForge ------------------------------------------------------------------------
    // state.cf.mods y state.cf.files se pueden ampliar desde las pruebas (modpacks y sus mods).
    if (p.startsWith('/curseforge/')) {
      if (req.headers['x-api-key'] !== state.curseforgeKey) return text('Forbidden', 403);
      const cf = state.cf;
      const q = p.slice('/curseforge'.length);
      if (q === '/games/432') return send({ data: { id: 432 } });
      if (q === '/mods/search') {
        const classId = Number(u.searchParams.get('classId') || 6);
        const list = Object.values(cf.mods).filter((x) => x.classId === classId);
        return send({ data: list, pagination: { totalCount: list.length } });
      }
      if (q === '/mods/files' && req.method === 'POST') {
        const { fileIds } = JSON.parse(body);
        return send({ data: fileIds.map((id) => cf.files[id]).filter(Boolean) });
      }
      if (q === '/mods' && req.method === 'POST') {
        const { modIds } = JSON.parse(body);
        return send({ data: modIds.map((id) => cf.mods[id]).filter(Boolean) });
      }
      m = q.match(/^\/mods\/(\d+)$/);
      if (m) return cf.mods[m[1]] ? send({ data: cf.mods[m[1]] }) : text('not found', 404);
      m = q.match(/^\/mods\/(\d+)\/description$/);
      if (m) return send({ data: '<p>Descripción</p>' });
      m = q.match(/^\/mods\/(\d+)\/files$/);
      if (m) return send({ data: Object.values(cf.files).filter((f) => String(f.modId) === m[1]) });
      return text('not found', 404);
    }

    // --- playit.gg --------------------------------------------------------------------------
    if (p.startsWith('/playit/')) {
      const q = p.slice('/playit'.length);
      const pl = state.playit;
      if (q === '/claim/setup') return send({ status: 'success', data: pl.claim.rejected ? 'UserRejected' : pl.claim.accepted ? 'UserAccepted' : 'WaitingForUser' });
      if (q === '/claim/exchange') return send({ status: 'success', data: { secret_key: 'abcdef0123456789abcdef0123456789' } });
      if (!/^Agent-Key /.test(req.headers.authorization || '')) return send({ status: 'error', data: { type: 'auth', message: 'AuthRequired' } }, 401);
      // pl.keys (opcional): clave -> id de agente; una clave que no está ahí ya no vale.
      const key = (req.headers.authorization || '').slice('Agent-Key '.length);
      if (pl.keys && !pl.keys[key]) return send({ status: 'error', data: { type: 'auth', message: 'InvalidAgentKey' } }, 401);
      if (q === '/v1/agents/rundata') return send({ status: 'success', data: { agent_id: pl.keys?.[key] || pl.agentId, tunnels: pl.tunnels, pending: pl.pending, notices: [] } });
      if (q === '/v1/tunnels/create') {
        if (pl.createError) return send(pl.createError);
        const b = JSON.parse(body);
        const id = crypto.randomUUID();
        const java = b.ports.details === 'minecraft-java';
        pl.tunnels.push({
          id,
          name: b.name,
          display_address: addPlayitAddress(java ? 'java' : 'bedrock'),
          tunnel_type: b.ports.details,
          port_type: java ? 'tcp' : 'udp',
          agent_config: b.origin.data.config,
        });
        return send({ status: 'success', data: { id } });
      }
      if (q === '/v1/tunnels/config') {
        const b = JSON.parse(body);
        const t = pl.tunnels.find((x) => x.id === b.tunnel_id);
        if (t) t.agent_config = b.new_config;
        return send({ status: 'success', data: null });
      }
      if (q === '/tunnels/delete') {
        const b = JSON.parse(body);
        pl.tunnels = pl.tunnels.filter((x) => x.id !== b.tunnel_id);
        return send({ status: 'success', data: null });
      }
      return send({ status: 'error', data: { type: 'path-not-found', message: { path: q } } }, 404);
    }

    // --- DuckDNS / deSEC / Cloudflare ----------------------------------------------------------
    if (p === '/duckdns/update') {
      const d = state.duckdns;
      if (u.searchParams.get('token') !== d.token) return text('KO');
      d.updates.push({ domains: u.searchParams.get('domains'), ip: u.searchParams.get('ip'), txt: u.searchParams.get('txt') });
      return text(`OK\n${u.searchParams.get('ip') || ''}\n\nUPDATED`);
    }
    if (p.startsWith('/desec/')) {
      const d = state.desec;
      if (req.headers.authorization !== `Token ${d.token}`) return send({ detail: 'Invalid token.' }, 401);
      if (p === `/desec/domains/${d.domain}/` && req.method === 'GET') return send({ name: d.domain, minimum_ttl: 60 });
      if (p === `/desec/domains/${d.domain}/rrsets/` && req.method === 'PATCH') {
        for (const r of JSON.parse(body)) {
          const key = `${r.type} ${r.subname}`;
          if (r.records.length) d.records.set(key, r.records);
          else d.records.delete(key);
        }
        return send([]);
      }
      return send({ detail: 'Not found.' }, 404);
    }
    if (p.startsWith('/cloudflare/')) {
      const c = state.cloudflare;
      if (req.headers.authorization !== `Bearer ${c.token}`) return send({ success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] }, 403);
      const q = p.slice('/cloudflare'.length);
      if (q === '/zones') return send({ success: true, result: u.searchParams.get('name') === c.zone ? [{ id: 'z1', name: c.zone }] : [] });
      if (q === '/zones/z1') return send({ success: true, result: { id: 'z1', name: c.zone } });
      if (q === '/zones/z1/dns_records' && req.method === 'GET') {
        return send({ success: true, result: c.records.filter((r) => r.type === u.searchParams.get('type') && r.name === u.searchParams.get('name')) });
      }
      if (q === '/zones/z1/dns_records' && req.method === 'POST') {
        const r = { id: String(c.nextId++), ...JSON.parse(body) };
        c.records.push(r);
        return send({ success: true, result: r });
      }
      m = q.match(/^\/zones\/z1\/dns_records\/(\d+)$/);
      if (m) {
        const i = c.records.findIndex((r) => r.id === m[1]);
        if (req.method === 'DELETE') c.records.splice(i, 1);
        else c.records[i] = { id: m[1], ...JSON.parse(body) };
        return send({ success: true, result: {} });
      }
      return send({ success: false, errors: [{ message: 'no route' }] }, 404);
    }

    // --- Varios ----------------------------------------------------------------------------
    m = p.match(/^\/mcmeta\/(?:[^/]+-)?registries\/([a-z_]+)\/data\.min\.json$/);
    if (m) {
      const reg = { item: ['air', 'diamond_sword', 'diamond', 'stone', 'torch'], mob_effect: ['speed', 'regeneration'], enchantment: ['sharpness', 'mending'], entity_type: ['zombie', 'pig'] };
      return reg[m[1]] ? send(reg[m[1]]) : text('404', 404);
    }
    if (p.startsWith('/mcsrvstat/')) {
      return send(state.mcsrvstatOnline ? { online: true, ip: '203.0.113.7', port: 25565, players: { online: 0, max: 20 }, version: '1.21.4', motd: { clean: ['Prueba'] } } : { online: false, ip: '203.0.113.7', port: 25565 });
    }
    if (p.startsWith('/ipify')) return send({ ip: '203.0.113.7' });
    if (p.startsWith('/geysermc/')) return bin(FAKE_SERVER_JAR);
    if (p.startsWith('/github/') && p.includes('/releases-assets/')) return bin(Buffer.from('MZ instalador simulado'));
    if (p.startsWith('/github/')) return bin(Buffer.from('#!/bin/sh\nsleep 600\n'));
    // --- GitHub Releases (actualizar el panel instalado con el instalador) ------------------
    if (p === '/ghapi/repos/Solebanjo117/mc-hosting-panel/releases/latest') {
      return state.release ? send(state.release) : send({ message: 'Not Found' }, 404);
    }

    text(`Ruta simulada desconocida: ${req.method} ${p}`, 404);
  }

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(state.cf.files, {
    5001: cfFile(5001, 1001, 'jei-1.0.jar'),
    5002: cfFile(5002, 1002, 'jei-1.0.jar', { downloadUrl: null }),
  });

  const rewrite = {
    'https://piston-meta.mojang.com': `${base}/mojang`,
    'https://api.mojang.com': `${base}/mojang-api`,
    'https://resources.download.minecraft.net': `${base}/resources`,
    'https://fill.papermc.io/v3/projects/paper': `${base}/paper`,
    'https://meta.fabricmc.net/v2': `${base}/fabric`,
    'https://files.minecraftforge.net': `${base}/forge-files`,
    'https://maven.minecraftforge.net': `${base}/forge-maven`,
    'https://maven.neoforged.net': `${base}/neo-maven`,
    'https://api.modrinth.com/v2': `${base}/modrinth`,
    'https://cdn.modrinth.com': `${base}/cdn`,
    'https://hangar.papermc.io/api/v1': `${base}/hangar`,
    'https://api.curseforge.com/v1': `${base}/curseforge`,
    'https://api.playit.gg': `${base}/playit`,
    'https://www.duckdns.org': `${base}/duckdns`,
    'https://desec.io/api/v1': `${base}/desec`,
    'https://api.cloudflare.com/client/v4': `${base}/cloudflare`,
    'https://raw.githubusercontent.com/misode/mcmeta': `${base}/mcmeta`,
    'https://api.mcsrvstat.us': `${base}/mcsrvstat`,
    'https://api.ipify.org': `${base}/ipify`,
    'https://download.geysermc.org': `${base}/geysermc`,
    'https://github.com': `${base}/github`,
    'https://api.github.com': `${base}/ghapi`,
    'https://api.adoptium.net': `${base}/adoptium`,
  };

  return {
    base,
    state,
    rewrite,
    dns: dns.address,
    close: async () => {
      await dns.close();
      await new Promise((r) => server.close(r));
    },
    requests: (prefix) => state.requests.filter((r) => r.path.startsWith(prefix)),
  };
}
