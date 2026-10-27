import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { notify } from './notify.js';
import { useToast } from './ui.jsx';
import { playSound } from './sounds.js';

/**
 * Estado en vivo del panel: lista de servidores, estado de cada proceso,
 * progreso de instalación y consola (vía un único WebSocket).
 */
const LiveContext = createContext(null);

export function LiveProvider({ children }) {
  const toast = useToast();
  const [servers, setServers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [runtime, setRuntime] = useState({});
  const [installs, setInstalls] = useState({});
  const [connected, setConnected] = useState(false);
  const [playit, setPlayit] = useState(null);
  const consoles = useRef(new Map()); // id -> { lines:[{n,text}], pending, listeners:Set, seq, timer }
  const wsRef = useRef(null);
  const subs = useRef(new Map()); // id -> contador de vistas suscritas
  const runtimeRef = useRef({});
  const serversRef = useRef([]);
  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);
  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  const refresh = useCallback(async () => {
    try {
      const list = await api('/servers');
      setServers(list);
      setRuntime((prev) => {
        const next = { ...prev };
        for (const s of list) next[s.id] = s.runtime;
        return next;
      });
    } finally {
      setLoaded(true);
    }
  }, []);

  const consoleOf = (id) => {
    if (!consoles.current.has(id)) consoles.current.set(id, { lines: [], pending: [], listeners: new Set(), seq: 0, timer: null });
    return consoles.current.get(id);
  };

  /*
   * Un servidor arrancando escribe cientos de líneas por segundo. En vez de redibujar la consola
   * por cada una, se juntan y se entregan como mucho 20 veces por segundo. Cada línea lleva un
   * número fijo para que React reutilice lo ya dibujado.
   */
  const flushConsole = (c) => {
    c.timer = null;
    if (c.pending.length) {
      c.lines = c.lines.concat(c.pending);
      c.pending = [];
      if (c.lines.length > 1500) c.lines = c.lines.slice(-1500);
    }
    for (const fn of c.listeners) fn(c.lines);
  };

  useEffect(() => {
    refresh();
    let stopped = false;
    let retry;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        for (const id of subs.current.keys()) ws.send(JSON.stringify({ type: 'subscribe', id }));
        refresh();
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 2000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'status') {
          const { type: _t, id, ...snap } = msg;
          const prev = runtimeRef.current[id];
          const name = serversRef.current.find((s) => s.id === id)?.name || 'el servidor';
          if (prev) {
            const before = new Set(prev.players || []);
            for (const p of snap.players || []) {
              if (before.has(p)) continue;
              notify('joins', `${p} entró`, `Se conectó a ${name}.`, `/servidor/${id}`);
              playSound('join');
            }
            if (snap.status === 'crashed' && prev.status !== 'crashed') {
              notify('crash', `${name} se cayó`, snap.lastCrash?.findings?.[0]?.title || 'Abre el panel para ver la causa.', `/servidor/${id}`);
            }
          }
          runtimeRef.current = { ...runtimeRef.current, [id]: snap };
          setRuntime((p) => ({ ...p, [id]: snap }));
        } else if (msg.type === 'servers') {
          refresh();
        } else if (msg.type === 'achievement') {
          const name = serversRef.current.find((s) => s.id === msg.id)?.name || 'el servidor';
          toast(`★ ¡Logro de ${name}! ${msg.title}: ${msg.desc}`, 'achievement');
          playSound('achievement');
        } else if (msg.type === 'backup') {
          playSound('backup');
        } else if (msg.type === 'zone') {
          const name = serversRef.current.find((s) => s.id === msg.id)?.name || 'el servidor';
          notify('zones', `${msg.player} entró a ${msg.zone}`, `En ${name}.`, `/servidor/${msg.id}/jugadores`);
          toast(`📍 ${msg.player} entró a ${msg.zone} (${name})`);
        } else if (msg.type === 'playit') {
          const { type: _t, ...rest } = msg;
          setPlayit(rest);
        } else if (msg.type === 'install') {
          setInstalls((prev) => ({ ...prev, [msg.id]: msg }));
        } else if (msg.type === 'console-history') {
          const c = consoleOf(msg.id);
          c.lines = msg.lines.map((text) => ({ n: c.seq++, text }));
          c.pending = [];
          clearTimeout(c.timer);
          flushConsole(c);
        } else if (msg.type === 'console') {
          const c = consoleOf(msg.id);
          c.pending.push({ n: c.seq++, text: msg.line });
          if (c.timer == null) c.timer = setTimeout(() => flushConsole(c), 50);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [refresh]);

  const subscribeConsole = useCallback((id, listener) => {
    const c = consoleOf(id);
    c.listeners.add(listener);
    listener(c.lines);
    subs.current.set(id, (subs.current.get(id) || 0) + 1);
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify({ type: 'subscribe', id }));
    return () => {
      c.listeners.delete(listener);
      const n = (subs.current.get(id) || 1) - 1;
      if (n <= 0) {
        subs.current.delete(id);
        if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify({ type: 'unsubscribe', id }));
      } else subs.current.set(id, n);
    };
  }, []);

  return (
    <LiveContext.Provider value={{ servers, loaded, runtime, installs, connected, refresh, subscribeConsole, playit }}>
      {children}
    </LiveContext.Provider>
  );
}

export const useLive = () => useContext(LiveContext);

/** Estado visible combinado: instalación o proceso. */
export function serverState(server, runtime) {
  if (!server) return 'stopped';
  if (server.installState === 'installing' || server.installState === 'pending') return 'installing';
  if (server.installState === 'error') return 'error';
  return runtime?.status || 'stopped';
}
