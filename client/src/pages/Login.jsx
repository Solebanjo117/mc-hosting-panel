import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ setup, onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (setup && password !== confirm) return setError('Las contraseñas no coinciden');
    setBusy(true);
    try {
      await api(setup ? '/auth/setup' : '/auth/login', { method: 'POST', body: { username, password } });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card panel" onSubmit={submit}>
        <div className="stack" style={{ gap: '0.4rem' }}>
          <h1>{setup ? 'Bienvenido' : 'MC Hosting Panel'}</h1>
          <p className="muted">
            {setup
              ? 'Crea la cuenta de administrador. Solo tú podrás entrar al panel con ella.'
              : 'Entra para administrar tus servidores.'}
          </p>
        </div>
        <label className="field">
          <span>Usuario</span>
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input
            type="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={setup ? 8 : undefined}
          />
          {setup && <span>Mínimo 8 caracteres.</span>}
        </label>
        {setup && (
          <label className="field">
            <span>Repite la contraseña</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
        )}
        {error && <div className="error-box">{error}</div>}
        <button className="btn-go" disabled={busy} style={{ minHeight: 40 }}>
          {setup ? 'Crear cuenta y entrar' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
