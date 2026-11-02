import fs from 'node:fs';
import path from 'node:path';

/**
 * Almacén JSON en disco. Sin dependencias nativas para que funcione en
 * cualquier Windows sin herramientas de compilación.
 *  - toDisk(data): transforma una copia antes de escribirla (por ejemplo, cifrar tokens).
 *  - fromDisk(data): deshace esa transformación al leer.
 */
export class JsonStore {
  constructor(file, defaults, { toDisk = (d) => d, fromDisk = (d) => d } = {}) {
    this.file = file;
    this.timer = null;
    this.toDisk = toDisk;
    let data = {};
    if (fs.existsSync(file)) {
      try {
        data = fromDisk(JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch (err) {
        const broken = `${file}.corrupt-${Date.now()}`;
        fs.copyFileSync(file, broken);
        console.error(`[db] No se pudo leer ${file}; se respaldó en ${broken}`, err.message);
      }
    }
    this.data = { ...structuredClone(defaults), ...data };
    this.flush();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 100);
  }

  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.toDisk(this.data), null, 2));
    fs.renameSync(tmp, this.file);
  }
}
