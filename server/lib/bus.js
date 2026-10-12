import { EventEmitter } from 'node:events';

/**
 * Bus de eventos interno. El hub de WebSocket lo escucha y reenvía al navegador.
 * Eventos: 'console' (id, line), 'status' (id, payload), 'install' (id, payload), 'servers' ().
 */
export const bus = new EventEmitter();
bus.setMaxListeners(100);
