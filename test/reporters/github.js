import path from 'node:path';

/**
 * En GitHub Actions, cada prueba que falla aparece como anotación (con archivo y línea)
 * en el resumen de la ejecución, sin tener que abrir el log completo.
 */
const clean = (s) => String(s).replace(/%/g, '%25').replace(/\r?\n/g, '%0A').slice(0, 1800);

export default async function* githubReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const { name, file, line, details } = event.data;
    if (details?.type === 'suite') continue; // el error ya se reporta en la prueba
    const err = details?.error?.cause || details?.error || {};
    const where = file ? `file=${path.relative(process.cwd(), file).replace(/\\/g, '/')},line=${line || 1}` : '';
    yield `::error ${where}::${clean(`${name}: ${err.message || err}`)}\n`;
  }
}
