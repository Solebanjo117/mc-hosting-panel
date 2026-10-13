import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Importar primero en las pruebas unitarias que cargan módulos del panel:
 * así config.js y db.js usan una carpeta de datos temporal y no tocan data/ del proyecto.
 */
if (!process.env.MCP_DATA_DIR || !process.env.MCP_DATA_DIR.includes('mcp-unit-')) {
  process.env.MCP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-unit-'));
  process.on('exit', () => {
    try {
      fs.rmSync(process.env.MCP_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* nada */
    }
  });
}
export const DATA_DIR = process.env.MCP_DATA_DIR;
