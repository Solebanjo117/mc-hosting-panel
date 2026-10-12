import fs from 'node:fs';
import path from 'node:path';

/**
 * Almacén JSON en disco. Sin dependencias nativas para que funcione en
 * cualquier Windows sin herramientas de compilación.
 */
export class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.timer = null;
    let data = {};
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
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
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
