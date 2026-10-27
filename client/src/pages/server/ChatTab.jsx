import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useLive } from '../../live.jsx';
import { PlayerHead, useToast } from '../../ui.jsx';

/**
 * Chat del servidor dentro del panel: lo que dicen los jugadores, entradas y salidas, y una
 * caja para hablarles como "Servidor" sin abrir el juego. Las menciones (@nombre) se resaltan.
 */
const plain = (line) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/§[0-9a-fk-or]/gi, '');

function parseChat(line) {
  const p = plain(line);
  const time = p.match(/^\[(\d\d:\d\d:\d\d)\]/)?.[1] || '';
  let m = p.match(/(?:\[Not Secure\] )?<([A-Za-z0-9_.]{2,17})> (.*)$/);
  if (m) return { kind: 'chat', time, who: m[1], text: m[2] };
  m = p.match(/\[Server\] (.*)$/);
  if (m) return { kind: 'server', time, who: 'Servidor', text: m[1] };
  m = p.match(/: \* ([A-Za-z0-9_.]{2,17}) (.*)$/);
  if (m) return { kind: 'me', time, who: m[1], text: m[2] };
  m = p.match(/: ([A-Za-z0-9_.]{2,17}) (joined|left) the game/);
  if (m) return { kind: 'presence', time, who: m[1], text: m[2] === 'joined' ? 'entró' : 'salió' };
  m = p.match(/: ([A-Za-z0-9_.]{2,17}) (was|died|drowned|blew up|fell|burned|starved|withered|hit the ground|went up in flames|tried to swim|experienced|walked into|discovered|froze|was squashed|suffocated)(.*)$/);
  if (m) return { kind: 'death', time, who: m[1], text: `${m[2]}${m[3]}` };
  return null;
}

export default function ChatTab({ server, runtime, state }) {
  const { subscribeConsole } = useLive();
  const toast = useToast();
  const [lines, setLines] = useState([]);
  const [text, setText] = useState('');
  const outRef = useRef(null);
  useEffect(() => subscribeConsole(server.id, (l) => setLines(l)), [server.id, subscribeConsole]);
  const messages = useMemo(() => lines.map((l) => ({ n: l.n, ...parseChat(l.text) })).filter((m) => m.kind), [lines]);
  useLayoutEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  const running = state === 'running';
  const players = runtime?.players || [];

  async function send(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    try {
      await api(`/servers/${server.id}/command`, { method: 'POST', body: { command: `say ${t}` } });
      setText('');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const renderText = (t) =>
    t.split(/(@[A-Za-z0-9_.]{2,17})/).map((part, i) => (part.startsWith('@') ? <mark key={i} className="mention">{part}</mark> : <span key={i}>{part}</span>));

  return (
    <div className="chat-layout">
      <section className="terminal chat" aria-label="Chat del servidor">
        <div className="terminal-out chat-out" ref={outRef} role="log" aria-label="Mensajes">
          {messages.length === 0 && <span className="faint">{running ? 'Todavía no hay mensajes. Lo que escriban los jugadores aparece aquí.' : 'Enciende el servidor para ver el chat.'}</span>}
          {messages.map((m) => (
            <div key={m.n} className={`chat-line chat-${m.kind}`}>
              <span className="chat-time">{m.time}</span>
              {m.kind === 'server' ? (
                <span className="chat-who server">Servidor</span>
              ) : (
                <span className="chat-who">
                  <PlayerHead name={m.who} size={18} /> {m.who}
                </span>
              )}
              <span className="chat-text">{m.kind === 'presence' || m.kind === 'death' ? <em>{m.text}</em> : renderText(m.text)}</span>
            </div>
          ))}
        </div>
        <form className="terminal-in" onSubmit={send}>
          <span aria-hidden="true">💬</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={running ? 'Escribe como "Servidor"… (puedes mencionar con @nombre)' : 'Enciende el servidor para escribir'} disabled={!running} aria-label="Mensaje al chat" maxLength={256} />
        </form>
      </section>
      <aside className="stack" style={{ alignContent: 'start' }}>
        <h3>Conectados ({players.length})</h3>
        {players.length === 0 ? (
          <p className="faint small">Nadie conectado.</p>
        ) : (
          <ul className="top-list">
            {players.map((p) => (
              <li key={p}>
                <PlayerHead name={p} size={22} />
                <button type="button" className="link-btn" onClick={() => setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${p} `)}>
                  {p}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="faint small">Avisos útiles: “reinicio en 5 min”, “respaldo en marcha”. Lo que escribes sale como [Servidor] en el juego.</p>
      </aside>
    </div>
  );
}
