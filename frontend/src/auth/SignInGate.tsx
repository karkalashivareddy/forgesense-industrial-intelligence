/**
 * Sign-in gate.
 *
 * The password is held in component state for the duration of the submit
 * request and cleared immediately afterwards. It is never written to
 * localStorage, sessionStorage, a cookie, or a URL.
 */

import { useState, type FormEvent } from 'react';
import { Activity, KeyRound, ShieldAlert } from 'lucide-react';
import { useAuth, toErrorMessage } from './AuthProvider';
import { Button } from '../design-system';

const ROLE_HINTS: Record<string, string> = {
  operator: 'Acknowledge alerts, review the fleet.',
  engineer: 'Investigate, schedule and run maintenance.',
  admin: 'Full control-room access.',
};

export function SignInGate() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError('Enter a role and a password to continue.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
      // The password never outlives the request.
      setPassword('');
    } catch (caught) {
      setError(toErrorMessage(caught, 'Sign-in failed. Check your credentials.'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <form className="gate__card" onSubmit={onSubmit} noValidate>
        <div>
          <div className="gate__brand">
            <Activity size={22} aria-hidden />
            <h1 className="gate__title">ForgeSense</h1>
          </div>
          <p className="gate__subtitle">Industrial Operations Center · Factory Alpha</p>
        </div>

        <div className="gate__field">
          <label className="gate__label" htmlFor="gate-username">
            Role
          </label>
          <select
            id="gate-username"
            className="gate__select"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          >
            <option value="operator">Operator</option>
            <option value="engineer">Engineer</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div className="gate__field">
          <label className="gate__label" htmlFor="gate-password">
            Password
          </label>
          <input
            id="gate-password"
            className="gate__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            spellCheck={false}
            required
            aria-describedby="gate-password-hint"
          />
          <span id="gate-password-hint" className="note">
            {ROLE_HINTS[username] ?? 'Control-room access is role-scoped on the server.'}
          </span>
        </div>

        {error && (
          <div className="gate__error" role="alert">
            <ShieldAlert size={14} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" variant="primary" loading={busy} icon={<KeyRound size={15} />}>
          {busy ? 'Authenticating…' : 'Sign in'}
        </Button>

        <p className="gate__footer">
          ForgeSense renders <strong>synthetic telemetry</strong> from a simulated plant. It is an operational
          visualisation and simulation environment — it does not monitor or control physical machinery. Model
          estimates are not guarantees and remaining-useful-life is expressed in simulator steps, never in hours.
        </p>
      </form>
    </div>
  );
}
