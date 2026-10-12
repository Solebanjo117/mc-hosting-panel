import zlib from 'node:zlib';

/**
 * NBT (Named Binary Tag): el formato binario de Minecraft Java para level.dat,
 * datos de jugadores (playerdata/*.dat) y estructuras (.nbt).
 * Big-endian, cadenas en "UTF-8 modificado" de Java. Puede venir con gzip, zlib o sin comprimir.
 *
 * Representación en JSON para el editor:
 *   { type: 'compound', value: [{ name, type, value }, ...] }
 *   { type: 'list', listType: 'int', value: [{ type: 'int', value: 5 }, ...] }
 *   long y long_array usan cadenas para no perder precisión.
 */

export const TYPES = ['end', 'byte', 'short', 'int', 'long', 'float', 'double', 'byte_array', 'string', 'list', 'compound', 'int_array', 'long_array'];
const ID = Object.fromEntries(TYPES.map((t, i) => [t, i]));

// --- UTF-8 modificado de Java ---------------------------------------------------

function decodeMutf8(buf) {
  let out = '';
  for (let i = 0; i < buf.length; ) {
    const a = buf[i++];
    if (a < 0x80) out += String.fromCharCode(a);
    else if ((a & 0xe0) === 0xc0) out += String.fromCharCode(((a & 0x1f) << 6) | (buf[i++] & 0x3f));
    else {
      const b = buf[i++];
      const c = buf[i++];
      out += String.fromCharCode(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f));
    }
  }
  return out;
}

function encodeMutf8(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i); // unidades UTF-16, como Java
    if (c !== 0 && c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Buffer.from(bytes);
}

// --- Lectura ---------------------------------------------------------------------

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  need(n) {
    if (this.pos + n > this.buf.length) throw new Error('El archivo NBT está incompleto o dañado');
  }
  byte() {
    this.need(1);
    return this.buf.readInt8(this.pos++);
  }
  ubyte() {
    this.need(1);
    return this.buf.readUInt8(this.pos++);
  }
  short() {
    this.need(2);
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  ushort() {
    this.need(2);
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  int() {
    this.need(4);
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  long() {
    this.need(8);
    const v = this.buf.readBigInt64BE(this.pos);
    this.pos += 8;
    return v.toString();
  }
  float() {
    this.need(4);
    const v = this.buf.readFloatBE(this.pos);
    this.pos += 4;
    return v;
  }
  double() {
    this.need(8);
    const v = this.buf.readDoubleBE(this.pos);
    this.pos += 8;
    return v;
  }
  string() {
    const len = this.ushort();
    this.need(len);
    const s = decodeMutf8(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  payload(type, depth = 0) {
    if (depth > 512) throw new Error('NBT demasiado anidado');
    switch (type) {
      case 1:
        return this.byte();
      case 2:
        return this.short();
      case 3:
        return this.int();
      case 4:
        return this.long();
      case 5:
        return this.float();
      case 6:
        return this.double();
      case 7: {
        const n = this.int();
        this.need(n);
        const arr = Array.from(this.buf.subarray(this.pos, this.pos + n), (b) => (b << 24) >> 24);
        this.pos += n;
        return arr;
      }
      case 8:
        return this.string();
      case 9: {
        const itemType = this.ubyte();
        const n = this.int();
        const items = [];
        for (let i = 0; i < n; i++) {
          const v = this.payload(itemType, depth + 1);
          // Una lista dentro de una lista guarda su propio tipo de elementos.
          items.push(itemType === 9 ? { type: 'list', listType: v.listType, value: v.value } : { type: TYPES[itemType], value: v });
        }
        return { listType: TYPES[itemType] || 'end', value: items };
      }
      case 10: {
        const entries = [];
        for (;;) {
          const t = this.ubyte();
          if (t === 0) break;
          if (!TYPES[t]) throw new Error(`Tipo de NBT desconocido: ${t}`);
          const name = this.string();
          const value = this.payload(t, depth + 1);
          entries.push(t === 9 ? { name, type: 'list', listType: value.listType, value: value.value } : { name, type: TYPES[t], value });
        }
        return entries;
      }
      case 11: {
        const n = this.int();
        const arr = [];
        for (let i = 0; i < n; i++) arr.push(this.int());
        return arr;
      }
      case 12: {
        const n = this.int();
        const arr = [];
        for (let i = 0; i < n; i++) arr.push(this.long());
        return arr;
      }
      default:
        throw new Error(`Tipo de NBT desconocido: ${type}`);
    }
  }
}

function decompress(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) return { data: zlib.gunzipSync(buf), compression: 'gzip' };
  if (buf[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(buf[1])) {
    try {
      return { data: zlib.inflateSync(buf), compression: 'zlib' };
    } catch {
      /* no era zlib */
    }
  }
  return { data: buf, compression: 'none' };
}

export function parseNbt(buf) {
  const { data, compression } = decompress(buf);
  const r = new Reader(data);
  const type = r.ubyte();
  if (type !== 10) throw new Error('No es un archivo NBT (la raíz debe ser un compuesto)');
  const rootName = r.string();
  const value = r.payload(10);
  return { compression, rootName, root: { type: 'compound', value } };
}

// --- Escritura -------------------------------------------------------------------

const LIMITS = { byte: [-128, 127], short: [-32768, 32767], int: [-2147483648, 2147483647] };

function checkInt(type, v, where) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < LIMITS[type][0] || n > LIMITS[type][1]) {
    throw new Error(`${where}: el valor ${v} no cabe en un ${type} (${LIMITS[type][0]} a ${LIMITS[type][1]})`);
  }
  return n;
}

function checkLong(v, where) {
  let b;
  try {
    b = BigInt(String(v).trim());
  } catch {
    throw new Error(`${where}: "${v}" no es un número entero`);
  }
  if (b < -(2n ** 63n) || b > 2n ** 63n - 1n) throw new Error(`${where}: número demasiado grande para un long`);
  return b;
}

class Writer {
  constructor() {
    this.parts = [];
  }
  push(buf) {
    this.parts.push(buf);
  }
  num(size, fn) {
    const b = Buffer.alloc(size);
    fn(b);
    this.push(b);
  }
  string(s) {
    const enc = encodeMutf8(String(s));
    if (enc.length > 65535) throw new Error('Texto demasiado largo');
    this.num(2, (b) => b.writeUInt16BE(enc.length));
    this.push(enc);
  }
  payload(type, value, where, listType) {
    switch (type) {
      case 'byte':
        return this.num(1, (b) => b.writeInt8(checkInt('byte', value, where)));
      case 'short':
        return this.num(2, (b) => b.writeInt16BE(checkInt('short', value, where)));
      case 'int':
        return this.num(4, (b) => b.writeInt32BE(checkInt('int', value, where)));
      case 'long':
        return this.num(8, (b) => b.writeBigInt64BE(checkLong(value, where)));
      case 'float':
      case 'double': {
        const n = Number(value);
        if (!Number.isFinite(n)) throw new Error(`${where}: "${value}" no es un número`);
        return type === 'float' ? this.num(4, (b) => b.writeFloatBE(n)) : this.num(8, (b) => b.writeDoubleBE(n));
      }
      case 'byte_array':
        this.num(4, (b) => b.writeInt32BE(value.length));
        return this.push(Buffer.from(value.map((v) => checkInt('byte', v, where) & 0xff)));
      case 'string':
        return this.string(value);
      case 'list': {
        const lt = listType || 'end';
        if (!(lt in ID)) throw new Error(`${where}: tipo de lista inválido`);
        this.num(1, (b) => b.writeUInt8(ID[lt]));
        this.num(4, (b) => b.writeInt32BE(value.length));
        value.forEach((item, i) => this.payload(lt, item.value, `${where}[${i}]`, item.listType));
        return undefined;
      }
      case 'compound':
        for (const e of value) {
          if (!(e.type in ID) || e.type === 'end') throw new Error(`${where}.${e.name}: tipo inválido`);
          this.num(1, (b) => b.writeUInt8(ID[e.type]));
          this.string(e.name);
          this.payload(e.type, e.value, where ? `${where}.${e.name}` : e.name, e.listType);
        }
        return this.num(1, (b) => b.writeUInt8(0));
      case 'int_array':
        this.num(4, (b) => b.writeInt32BE(value.length));
        return value.forEach((v) => this.num(4, (b) => b.writeInt32BE(checkInt('int', v, where))));
      case 'long_array':
        this.num(4, (b) => b.writeInt32BE(value.length));
        return value.forEach((v) => this.num(8, (b) => b.writeBigInt64BE(checkLong(v, where))));
      default:
        throw new Error(`${where}: tipo desconocido ${type}`);
    }
  }
}

export function writeNbt({ compression = 'gzip', rootName = '', root }) {
  if (root?.type !== 'compound') throw new Error('La raíz debe ser un compuesto');
  const w = new Writer();
  w.num(1, (b) => b.writeUInt8(10));
  w.string(rootName);
  w.payload('compound', root.value, '');
  const raw = Buffer.concat(w.parts);
  if (compression === 'gzip') return zlib.gzipSync(raw);
  if (compression === 'zlib') return zlib.deflateSync(raw);
  return raw;
}
