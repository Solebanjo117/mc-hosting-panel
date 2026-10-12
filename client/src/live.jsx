import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Estado en vivo del panel: lista de servidores, estado de cada proceso,
 * progreso de instalación y consola (vía un único WebSocket).
 */
const LiveContext = createContext(null);

export function LiveProvider({ children }) {
  const [servers, setServers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [runtime, setRuntime] = useState({});
  const [installs, setInstalls] = useState({});
  const [connected, setConnected] = useState(false);
  const [playit, setPlayit] = useState(null);
  const consoles = useRef(new Map()); // id -> { lines, listeners:Set }
  const wsRef = useRef(null);
  const subs = useRef(new Map()); // id -> contador de vistas suscritas

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
    if (!consoles.current.has(id)) consoles.current.set(id, { lines: [], listeners: new Set() });
    return consoles.current.get(id);
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
          setRuntime((prev) => ({ ...prev, [id]: snap }));
        } else if (msg.type === 'servers') {
          refresh();
        } else if (msg.type === 'playit') {
          const { type: _t, ...rest } = msg;
          setPlayit(rest);
        } else if (msg.type === 'install') {
          setInstalls((prev) => ({ ...prev, [msg.id]: msg }));
        } else if (msg.type === 'console-history' || msg.type === 'console') {
          const c = consoleOf(msg.id);
          if (msg.type === 'console-history') c.lines = msg.lines;
          else {
            c.lines = [...c.lines, msg.line];
            if (c.lines.length > 1500) c.lines = c.lines.slice(-1500);
          }
          for (const fn of c.listeners) fn(c.lines);
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
