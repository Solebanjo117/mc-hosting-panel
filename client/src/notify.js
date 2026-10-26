/**
 * Notificaciones del navegador (cuando alguien entra o un servidor se cae).
 * Las preferencias son de este navegador. Requieren "contexto seguro":
 * funcionan en http://localhost y por HTTPS (por ejemplo con Tailscale), no por la IP de la red local.
 */

const KEY = 'mcp-notify';
const DEFAULTS = { enabled: false, joins: true, crash: true, zones: true };

export function notifyPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setNotifyPrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* sin almacenamiento */
  }
}

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;

export async function askPermission() {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

export async function notify(kind, title, body, url = '/') {
  const prefs = notifyPrefs();
  if (!prefs.enabled || !prefs[kind] || !notifySupported() || Notification.permission !== 'granted') return;
  // Si estás viendo el panel, no hace falta avisar.
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  const options = { body, tag: `${kind}-${title}`, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, options);
    new Notification(title, options); // eslint-disable-line no-new
  } catch {
    /* el navegador no dejó mostrarla */
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// El navegador avisa una vez que el panel se puede instalar; se guarda para el botón de Ajustes.
let installPrompt = null;
const installListeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    installListeners.forEach((fn) => fn(true));
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installListeners.forEach((fn) => fn(false));
  });
}
export const canInstall = () => Boolean(installPrompt);
export function onInstallChange(fn) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}
export async function promptInstall() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  return outcome === 'accepted';
}
