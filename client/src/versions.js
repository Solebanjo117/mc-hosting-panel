/**
 * ¿Hay una versión mejor que la instalada? Usa el mismo criterio que el panel al instalar: la
 * recomendada es la primera estable (release) de la lista ya filtrada por versión de Minecraft y
 * loader, o la primera si no hay estables.
 *  - versions: [{ id, number, type, date, file }] (lo que devuelve /content/versions).
 *  - installed: { versionId, versionName, filename } de la lista de instalados.
 * Devuelve null si no hay nada que ofrecer, o { version, reason }:
 *  - 'newer':        la recomendada es más nueva que la instalada.
 *  - 'incompatible': la instalada no está entre las compatibles con este servidor
 *                    (por ejemplo, era para otra versión de Minecraft).
 */
export function pickUpdate(versions, installed) {
  if (!Array.isArray(versions) || !versions.length || !installed) return null;
  const recommended = versions.find((v) => v.type === 'release') || versions[0];
  if (!recommended?.file) return null; // solo se puede ofrecer lo que el panel sabe descargar
  const current = versions.find(
    (v) => (installed.versionId && v.id === installed.versionId) || (installed.versionName && v.number === installed.versionName) || (v.file && v.file.name === installed.filename)
  );
  if (current) {
    if (current.id === recommended.id) return null;
    const newer = Date.parse(recommended.date) > Date.parse(current.date);
    return newer ? { version: recommended, reason: 'newer' } : null; // no proponer bajar de una beta más nueva
  }
  return { version: recommended, reason: 'incompatible' };
}
