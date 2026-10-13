import '../helpers/unit-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseProperties, serializeProperties } from '../../server/services/properties.js';

/** Caso de uso: cambiar server.properties desde el panel sin perder comentarios ni romper acentos y colores. */
describe('server.properties', () => {
  const text = '#Minecraft server properties\n#Mon Oct 13\nmotd=\\u00a76Hola \\u00f1\\nSegunda\nmax-players=20\n\nlevel-seed=\nkey\\:raro=a\\=b\n';

  it('lee claves, escapes \\uXXXX, saltos de línea y claves con : o =', () => {
    const entries = parseProperties(text);
    const obj = Object.fromEntries(entries.filter((e) => e.key !== undefined).map((e) => [e.key, e.value]));
    assert.equal(obj.motd, '§6Hola ñ\nSegunda');
    assert.equal(obj['max-players'], '20');
    assert.equal(obj['level-seed'], '');
    assert.equal(obj['key:raro'], 'a=b');
  });

  it('conserva comentarios y el orden al volver a escribir', () => {
    const out = serializeProperties(parseProperties(text));
    assert.ok(out.startsWith('#Minecraft server properties\n#Mon Oct 13\n'));
    assert.match(out, /motd=\\u00a76Hola \\u00f1\\nSegunda/);
    assert.deepEqual(parseProperties(out).filter((e) => e.key), parseProperties(text).filter((e) => e.key));
  });

  it('escribe los caracteres especiales como \\uXXXX (Java lee el archivo como ISO-8859-1)', () => {
    const out = serializeProperties([{ key: 'motd', value: '§a¡Hola! 🙂' }]);
    assert.ok(/^[\x00-\x7f]*$/.test(out), 'solo ASCII');
    assert.equal(parseProperties(out)[0].value, '§a¡Hola! 🙂');
  });
});
