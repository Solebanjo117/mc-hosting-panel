import { createContext, useContext } from 'react';

/**
 * La cuenta con la que se entró: { username, role, servers }.
 *  - owner (dueño): todo.
 *  - moderator (moderador): en sus servidores, consola, jugadores, chat, respaldos, encender y apagar.
 *  - viewer (observador): en sus servidores, solo mirar.
 * La interfaz esconde lo que la cuenta no puede hacer; el servidor lo rechaza de todas formas.
 */
const AuthContext = createContext({ username: null, role: 'owner', servers: '*' });

export const AuthProvider = AuthContext.Provider;

export function useAuth() {
  const a = useContext(AuthContext);
  const role = a.role || 'owner';
  return {
    ...a,
    role,
    isOwner: role === 'owner',
    /** Puede encender, apagar, mandar comandos y administrar jugadores. */
    canOperate: role === 'owner' || role === 'moderator',
    /** Solo mira. */
    readOnly: role === 'viewer',
  };
}

export const ROLE_LABEL = { owner: 'Dueño', moderator: 'Moderador', viewer: 'Observador' };

/** Pestañas de un servidor que ve cada rol (el dueño las ve todas). */
export const TABS_BY_ROLE = {
  moderator: new Set(['', 'jugadores', 'chat', 'actividad', 'respaldos', 'seguridad', 'rendimiento', 'logs']),
  viewer: new Set(['', 'jugadores', 'chat', 'actividad', 'rendimiento', 'logs']),
};
