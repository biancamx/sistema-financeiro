import { Clock3, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';

export default function AccountStatusPage() {
  const { user, logout } = useAuth();
  const blocked = user?.status === 'blocked';
  const Icon = blocked ? ShieldAlert : Clock3;

  return (
    <main className="account-status-page">
      <section className="account-status-card" aria-live="polite">
        <div className={`account-status-icon ${blocked ? 'is-blocked' : ''}`}>
          <Icon aria-hidden="true" />
        </div>
        <p className="account-status-eyebrow">Caderno de Contas</p>
        <h1>{blocked ? 'Acesso bloqueado' : 'Aguardando aprovação do administrador'}</h1>
        <p>
          {blocked
            ? 'Esta conta está bloqueada. Entre em contato com o administrador do sistema para mais informações.'
            : 'Seu cadastro foi recebido. Assim que o administrador liberar o acesso, você poderá usar as ferramentas do sistema.'}
        </p>
        <div className="account-status-user">{user?.email}</div>
        <button className="btn btn-default" type="button" onClick={logout}>Sair da conta</button>
      </section>
    </main>
  );
}
