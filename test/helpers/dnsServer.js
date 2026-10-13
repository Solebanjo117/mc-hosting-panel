import dgram from 'node:dgram';

/**
 * Servidor DNS mínimo para las pruebas (solo A y SRV, por UDP).
 * `records` es un Map: "A nombre" -> ['1.2.3.4'], "SRV nombre" -> [{ port, target }].
 * Así el panel puede resolver las direcciones de playit sin salir a internet.
 */
export async function startDnsServer(records) {
  const sock = dgram.createSocket('udp4');
  const TYPES = { 1: 'A', 33: 'SRV' };

  const readName = (buf, offset) => {
    const labels = [];
    let p = offset;
    while (buf[p] !== 0) {
      labels.push(buf.subarray(p + 1, p + 1 + buf[p]).toString('ascii'));
      p += buf[p] + 1;
    }
    return { name: labels.join('.').toLowerCase(), end: p + 1 };
  };
  const encodeName = (name) => Buffer.concat([...name.replace(/\.$/, '').split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, 'ascii')])), Buffer.from([0])]);

  sock.on('message', (msg, rinfo) => {
    try {
      const id = msg.readUInt16BE(0);
      const { name, end } = readName(msg, 12);
      const qtype = msg.readUInt16BE(end);
      const question = msg.subarray(12, end + 4);
      const answers = (records.get(`${TYPES[qtype]} ${name}`) || []).map((r) => {
        let rdata;
        if (qtype === 1) rdata = Buffer.from(r.split('.').map(Number));
        else {
          const head = Buffer.alloc(6);
          head.writeUInt16BE(0, 0);
          head.writeUInt16BE(5, 2);
          head.writeUInt16BE(r.port, 4);
          rdata = Buffer.concat([head, encodeName(r.target)]);
        }
        const rr = Buffer.alloc(12);
        rr.writeUInt16BE(0xc00c, 0); // puntero al nombre de la pregunta
        rr.writeUInt16BE(qtype, 2);
        rr.writeUInt16BE(1, 4);
        rr.writeUInt32BE(60, 6);
        rr.writeUInt16BE(rdata.length, 10);
        return Buffer.concat([rr, rdata]);
      });
      const header = Buffer.alloc(12);
      header.writeUInt16BE(id, 0);
      header.writeUInt16BE(answers.length ? 0x8180 : 0x8183, 2); // respuesta; 3 = el nombre no existe
      header.writeUInt16BE(1, 4);
      header.writeUInt16BE(answers.length, 6);
      sock.send(Buffer.concat([header, question, ...answers]), rinfo.port, rinfo.address);
    } catch {
      /* consulta rara: se ignora */
    }
  });
  await new Promise((r) => sock.bind(0, '127.0.0.1', r));
  return { address: `127.0.0.1:${sock.address().port}`, close: () => new Promise((r) => sock.close(r)) };
}
