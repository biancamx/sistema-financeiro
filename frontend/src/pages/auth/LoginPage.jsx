import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { authApi } from '../../services/api.js';
import { Field, Spinner } from '../../components/ui/ui.jsx';
import { PATHS } from '../../app/paths.js';
import GoogleButton from './GoogleButton.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { safeAuthReturnTo } from '../../app/authReturnTo.js';

export default function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { login, register } = useAuth();
  const toast = useToast();
  const { data: cfg, loading, error } = useFetch(() => authApi.config(), []);
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [reauthRequired, setReauthRequired] = useState(false);

  useEffect(() => {
    const from = location.state?.from;
    if (from) {
      window.sessionStorage.setItem('auth:returnTo', `${from.pathname}${from.search || ''}${from.hash || ''}`);
    }
    setReauthRequired(window.sessionStorage.getItem('auth:reauthRequired') === '1');
  }, [location.state]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('google_error') !== 'failed') return;

    setErr(new Error('Não foi possível concluir o login com Google. Tente novamente ou entre com e-mail e senha.'));
    params.delete('google_error');
    const search = params.toString();
    nav({
      pathname: location.pathname,
      search: search ? `?${search}` : '',
      hash: location.hash,
    }, { replace: true, state: location.state });
  }, [location.hash, location.pathname, location.search, location.state, nav]);

  const run = async (fn, registration = false) => {
    setBusy(true);
    setErr(null);
    try {
      const user = await fn();
      if (registration) {
        toast.success(user?.status === 'active'
          ? 'Cadastro concluído. Sua conta já está liberada.'
          : 'Cadastro enviado. O administrador precisa liberar seu acesso antes do primeiro login.');
      }
      const returnTo = window.sessionStorage.getItem('auth:returnTo');
      const destination = safeAuthReturnTo(returnTo || location.state?.from?.pathname || PATHS.dashboard);
      window.sessionStorage.removeItem('auth:returnTo');
      window.sessionStorage.removeItem('auth:reauthRequired');
      nav(destination, { replace: true });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fieldErr = (name) => err?.details?.find?.((d) => d.field === name)?.message;

  return (
    <div className="login">
      <section className="login-intro">
        <div className="login-brand-inner">
          <div className="login-brand">
            <span className="login-brand-icon" aria-hidden="true">
              <svg viewBox="0 0 14 14">
                <rect x="1" y="7" width="3" height="6" rx=".6" />
                <rect x="5.5" y="4" width="3" height="9" rx=".6" />
                <rect x="10" y="1" width="3" height="12" rx=".6" />
              </svg>
            </span>
            Caderno de Contas
          </div>
          <h1>Suas faturas, parcelas e saldos em um só lugar.</h1>
          <p>Seu dinheiro em ordem. Suas contas sob controle.</p>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <h2>{mode === 'login' ? 'Entre na sua conta' : 'Solicite seu cadastro'}</h2>
          {reauthRequired && (
            <p className="field-hint" role="status">
              Entre novamente para confirmar sua identidade. Depois, repita a operação.
            </p>
          )}
          {loading && <Spinner />}
          {error && <div className="state state-error" role="alert"><strong>API indisponível</strong><p>{error.message}</p></div>}

          {cfg && (
            <>
              {cfg.google.enabled ? (
                <GoogleButton clientId={cfg.google.clientId} onError={setErr} />
              ) : (
                <>
                  <button type="button" className="login-google-button" disabled aria-describedby="g-hint">
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
                    Fazer login com o Google
                  </button>
                  <p id="g-hint" className="field-hint login-google-hint">Login com Google indisponível no momento.</p>
                </>
              )}
              <div className="login-divider" role="separator"><span>ou entre com e-mail</span></div>

              <form
                className="login-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const registration = mode === 'register';
                  run(
                    () => (registration ? register(form) : login({ email: form.email, password: form.password })),
                    registration,
                  );
                }}
              >
                {mode === 'register' && (
                  <>
                    <Field label="Nome" error={fieldErr('name')}>{(id) => <input id={id} className="input login-input" value={form.name} onChange={set('name')} autoComplete="name" minLength={2} maxLength={80} required />}</Field>
                    <p className="field-hint">O acesso ficará aguardando aprovação do administrador na aba Acessos.</p>
                  </>
                )}
                <Field label="E-mail" error={fieldErr('email')}>{(id) => <input id={id} className="input login-input" type="email" inputMode="email" value={form.email} onChange={set('email')} autoComplete="email" required />}</Field>
                <Field label="Senha" hint={mode === 'register' ? 'Mínimo de 8 caracteres' : undefined} error={fieldErr('password')}>
                  {(id) => <input id={id} className="input login-input" type="password" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : undefined} required />}
                </Field>
                {err && !err.details && <p className="field-error" role="alert">{err.message}</p>}
                <button type="submit" className="login-primary-button" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar com e-mail' : 'Enviar cadastro para aprovação'}</button>
                <button type="button" className="login-mode-toggle" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(null); }}>
                  {mode === 'login' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entre com e-mail'}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
