import '../helpers/unit-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, estimate } from '../../server/services/pregen.js';

describe('Chunky: lectura del avance', () => {
  it('lee el avance como lo imprime Chunky', () => {
    assert.deepEqual(parseLine('[12:00:00 INFO]: [Chunky] Task running for minecraft:overworld. Processed: 6656 chunks (16.25%), ETA: 0:00:37, Rate: 289.7 cps, Current: -19, 26'), {
      world: 'minecraft:overworld',
      state: 'running',
      processed: 6656,
      percent: 16.25,
      eta: '0:00:37',
      rate: 289.7,
    });
  });

  it('acepta coma decimal (Java en español)', () => {
    const p = parseLine('[Chunky] Task running for world. Processed: 10 chunks (0,25%), ETA: 1:02:03, Rate: 12,5 cps, Current: 0, 0');
    assert.equal(p.percent, 0.25);
    assert.equal(p.rate, 12.5);
  });

  it('reconoce el final, la pausa y la cancelación', () => {
    assert.deepEqual(parseLine('[Chunky] Task finished for world_nether. Processed: 3969 chunks (100.00%), Total time: 0:02:19'), {
      world: 'world_nether',
      state: 'done',
      processed: 3969,
      percent: 100,
      eta: null,
      totalTime: '0:02:19',
    });
    assert.deepEqual(parseLine('[Chunky] Task paused for world.'), { world: 'world', state: 'paused' });
    assert.deepEqual(parseLine('[Chunky] Task cancelled for minecraft:the_end.'), { world: 'minecraft:the_end', state: 'cancelled' });
    assert.equal(parseLine('[Chunky] Radius changed to 500.'), null);
  });

  it('estima chunks y disco', () => {
    assert.deepEqual(estimate(1000), { chunks: 125 * 125, diskMb: 61 });
    assert.equal(estimate(1000, 'circle').chunks, Math.round((Math.PI * 1000 * 1000) / 256));
    assert.ok(estimate(1000, 'square', 'end').diskMb < estimate(1000).diskMb);
  });
});
