import { useEffect, useState } from 'react';
import { BellRing, ShieldCheck } from 'lucide-react';
import { Button, Card } from '../../components/ui/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { authApi } from '../../services/api.js';

const alertContent = {
  repeated_login_failures: {
    title: 'Várias tentativas de login',
    description: 'Foram detectadas várias tentativas de login. Verifique a atividade da sua conta.',
  },
  revoked_session_reuse: {
    title: 'Tentativa com sessão encerrada',
    description: 'Uma sessão já encerrada tentou acessar sua conta. Revise as sessões ativas.',
  },
  cross_user_access: {
    title: 'Tentativas de acesso a registros indisponíveis',
    description: 'Houve várias tentativas de acessar registros não disponíveis para esta conta.',
  },
  admin_account_change: {
    title: 'Alteração administrativa na conta',
    description: 'O status ou as permissões da sua conta foram alterados por um administrador.',
  },
};

export default function SecurityAlertsPanel() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function loadAlerts() {
    setLoading(true);
    try {
      setAlerts(await authApi.securityAlerts());
    } catch (error) {
      toast.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts();
  }, []);

  async function markAllRead() {
    setBusy(true);
    try {
      await authApi.markSecurityAlertsRead();
      setAlerts((current) => current.map((alert) => ({ ...alert, readAt: alert.readAt || new Date().toISOString() })));
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  const unreadCount = alerts.filter((alert) => !alert.readAt).length;

  return (
    <Card className="settings-card">
      <header className="settings-card-head">
        <div className="settings-icon"><ShieldCheck aria-hidden="true" /></div>
        <div className="settings-card-copy">
          <h2>Alertas de segurança</h2>
          <p>Alertas sobre tentativas de login, sessões encerradas e alterações na conta. Notificações push não incluem dados financeiros.</p>
        </div>
        {unreadCount > 0 && (
          <Button onClick={markAllRead} disabled={busy}>
            {busy ? 'Atualizando…' : 'Marcar como lidos'}
          </Button>
        )}
      </header>
      {loading ? (
        <p role="status">Carregando alertas…</p>
      ) : alerts.length ? (
        <ul className="settings-security-alerts">
          {alerts.map((alert) => {
            const content = alertContent[alert.alertType];
            if (!content) return null;
            return (
              <li className={alert.readAt ? '' : 'is-unread'} key={alert._id}>
                <BellRing aria-hidden="true" />
                <div>
                  <strong>{content.title}</strong>
                  <p>{content.description}</p>
                  <time dateTime={alert.createdAt}>
                    {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(alert.createdAt))}
                  </time>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Nenhuma atividade de segurança suspeita foi registrada.</p>
      )}
    </Card>
  );
}
