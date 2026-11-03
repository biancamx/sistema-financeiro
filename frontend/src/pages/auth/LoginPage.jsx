import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { authApi } from '../../services/api.js';
import { Button, Field, Spinner } from '../../components/ui/ui.jsx';
import { PATHS } from '../../app/paths.js';
import GoogleButton from './GoogleButton.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function LoginPage() {
  const nav = useNavigate();
  const { login, register } = useAuth();
  const toast = useToast();
  const { data: cfg, loading, error } = useFetch(() => authApi.config(), []);
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

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
      nav(PATHS.dashboard, { replace: true });
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
        <div className="brand brand-lg"><span className="brand-mark" aria-hidden="true" />Caderno de Contas</div>
        <h1>Suas faturas, parcelas e saldos em um só lugar.</h1>
        <p>Seu dinheiro em ordem. Suas contas sob controle.</p>
      </section>

      <section className="login-panel">
        {loading && <Spinner />}
        {error && <div className="state state-error"><strong>API indisponível</strong><p>{error.message}</p></div>}

        {cfg && (
          <div className="login-methods">
            <section className="login-method">
              <h2>Entre com sua conta Google</h2>
              {cfg.google.enabled ? (
                <GoogleButton clientId={cfg.google.clientId} onError={setErr} />
              ) : (
                <>
                  <button className="btn btn-google" disabled aria-describedby="g-hint">
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
                    Entrar com Google
                  </button>
                  <p id="g-hint" className="field-hint">Login com Google indisponível no momento.</p>
                </>
              )}
            </section>

            <section className="login-method">
              <h2>{mode === 'login' ? 'Entre com e-mail' : 'Solicite seu cadastro'}</h2>
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
                    <Field label="Nome" error={fieldErr('name')}>{(id) => <input id={id} className="input" value={form.name} onChange={set('name')} autoComplete="name" minLength={2} maxLength={80} required />}</Field>
                    <p className="field-hint">O acesso ficará aguardando aprovação do administrador na aba Acessos.</p>
                  </>
                )}
                <Field label="E-mail" error={fieldErr('email')}>{(id) => <input id={id} className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />}</Field>
                <Field label="Senha" hint={mode === 'register' ? 'Mínimo de 8 caracteres' : undefined} error={fieldErr('password')}>
                  {(id) => <input id={id} className="input" type="password" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : undefined} required />}
                </Field>
                {err && !err.details && <p className="field-error" role="alert">{err.message}</p>}
                <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar com e-mail' : 'Enviar cadastro para aprovação'}</Button>
                <button type="button" className="login-mode-toggle" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(null); }}>
                  {mode === 'login' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entre com e-mail'}
                </button>
              </form>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
