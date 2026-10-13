import '../helpers/unit-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMMANDS, listCommands, placeholders, guessType, saveCommands } from '../../server/services/quickCommands.js';

/** Caso de uso: "Quiero agregar, quitar y personalizar los comandos rápidos, con listas para elegir". */
describe('Comandos rápidos', () => {
  it('trae comandos de fábrica, incluido /give con jugador, objeto y cantidad', () => {
    assert.equal(listCommands(), DEFAULT_COMMANDS);
    const give = DEFAULT_COMMANDS.find((c) => c.template.startsWith('give'));
    assert.deepEqual(give.params.map((p) => p.type), ['player', 'item', 'number']);
  });

  it('encuentra los huecos {…} sin repetir, con acentos y ñ', () => {
    assert.deepEqual(placeholders('tp {jugador} {destino} {jugador} {año}'), ['jugador', 'destino', 'año']);
    assert.deepEqual(placeholders('save-all'), []);
  });

  it('adivina el tipo de lista por el nombre del hueco', () => {
    assert.equal(guessType('jugador'), 'player');
    assert.equal(guessType('Objeto2'), 'item');
    assert.equal(guessType('efecto'), 'effect');
    assert.equal(guessType('encantamiento'), 'enchantment');
    assert.equal(guessType('mob'), 'entity');
    assert.equal(guessType('cantidad'), 'number');
    assert.equal(guessType('motivo'), 'text');
  });

  it('guarda comandos propios: quita la / inicial, arma los parámetros y respeta los tipos elegidos', () => {
    const [c] = saveCommands([
      { label: 'Bloque', template: '/setblock ~ ~ ~ {bloque}', params: [] },
    ]);
    assert.equal(c.template, 'setblock ~ ~ ~ {bloque}');
    assert.deepEqual(c.params, [{ name: 'bloque', type: 'item', default: '', options: [] }]);

    const [d] = saveCommands([{ label: 'Dificultad', template: 'difficulty {nivel}', params: [{ name: 'nivel', type: 'select', options: 'peaceful, easy,hard' }], confirm: 1 }]);
    assert.deepEqual(d.params[0].options, ['peaceful', 'easy', 'hard']);
    assert.equal(d.confirm, true);
    assert.match(d.id, /^[a-z0-9]+$/i);
  });

  it('rechaza comandos inválidos', () => {
    assert.throws(() => saveCommands([{ label: '', template: 'list' }]), /necesita un nombre/);
    assert.throws(() => saveCommands([{ label: 'X', template: '' }]), /no tiene comando/);
    assert.throws(() => saveCommands([{ label: 'X', template: 'say a\nstop' }]), /saltos de línea/);
    assert.throws(() => saveCommands([{ label: 'X', template: 'difficulty {n}', params: [{ name: 'n', type: 'select', options: [] }] }]), /no tiene opciones/);
    assert.throws(() => saveCommands(Array.from({ length: 41 }, (_, i) => ({ label: `c${i}`, template: 'list' }))), /Máximo 40/);
    assert.throws(() => saveCommands('hola'), /Lista inválida/);
  });

  it('no repite ids y se puede volver a los de fábrica', () => {
    const list = saveCommands([
      { id: 'abc', label: 'A', template: 'list' },
      { id: 'abc', label: 'B', template: 'list' },
    ]);
    assert.notEqual(list[0].id, list[1].id);
    assert.equal(saveCommands(null), DEFAULT_COMMANDS);
  });
});
