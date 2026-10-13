import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMc, parseConsole, plainMc, segStyle } from '../../client/src/mcText.js';

/** Caso de uso: ver el MOTD con colores y la consola con los colores del servidor. */
describe('Colores de Minecraft', () => {
  it('separa tramos por color y formato; un color nuevo quita la negrita', () => {
    const s = parseMc('§6Hola §lmundo§a!');
    assert.deepEqual(s.map((x) => x.text), ['Hola ', 'mundo', '!']);
    assert.equal(s[0].color, '#FFAA00');
    assert.equal(s[1].bold, true);
    assert.equal(s[2].bold, undefined);
  });

  it('§r vuelve al formato base y los códigos desconocidos se dejan como texto', () => {
    const s = parseMc('§c§nrojo§rnormal §zx', { color: '#AAAAAA' });
    assert.equal(s[0].underline, true);
    assert.deepEqual(s[1], { text: 'normal §zx', color: '#AAAAAA' });
  });

  it('cuenta solo las letras visibles', () => {
    assert.equal(plainMc('§6§lHola§r ñ'), 'Hola ñ');
  });

  it('entiende colores ANSI de la consola, incluidos los de 24 bits', () => {
    const s = parseConsole('\x1b[33mAviso\x1b[0m normal \x1b[38;2;10;20;30mrgb\x1b[m');
    assert.deepEqual(s.map((x) => x.text), ['Aviso', ' normal ', 'rgb']);
    assert.equal(s[0].color, '#FFFF55');
    assert.equal(s[1].color, undefined);
    assert.equal(s[2].color, 'rgb(10,20,30)');
  });

  it('estilos para la página', () => {
    assert.deepEqual(segStyle({ bold: true, underline: true, strike: true, color: 'red' }), { color: 'red', fontWeight: 700, fontStyle: undefined, textDecoration: 'underline line-through' });
  });
});
