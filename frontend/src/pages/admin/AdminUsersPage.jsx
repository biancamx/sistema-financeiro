import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, ShieldBan } from 'lucide-react';
import { adminApi } from '../../services/api.js';
import { Button, Card, ErrorState, PageHeader, Spinner } from '../../components/ui/ui.jsx';

const STATUS_LABELS = {
  active: 'Ativo',
  pending: 'Aguardando aprovação',
  blocked: 'Bloqueado',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await adminApi.users());
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const updateStatus = async (user, status) => {
    setUpdatingId(user.id);
    setError(null);
    try {
      const updated = await adminApi.updateUserStatus(user.id, status);
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (updateError) {
      setError(updateError);
    } finally {
      setUpdatingId(null);
    }
  };

  const pendingCount = users.filter((user) => user.status === 'pending').length;

  return (
    <>
      <PageHeader
        title="Gerenciar acessos"
        subtitle="Aprove, acompanhe ou bloqueie as contas cadastradas no sistema."
        actions={<Button variant="ghost" onClick={loadUsers}><RefreshCw size={16} aria-hidden="true" /> Atualizar</Button>}
      />
      <Card>
        <div className="admin-users-summary">
          <strong>{users.length} conta(s)</strong>
          <span className="pill pill-warn">{pendingCount} aguardando aprovação</span>
        </div>
        {error && <ErrorState error={error} onRetry={loadUsers} />}
        {loading ? <Spinner label="Carregando usuários…" /> : users.length === 0 ? (
          <p className="muted admin-users-empty">Ainda não há contas cadastradas.</p>
        ) : (
          <div className="table-responsive">
            <table className="table admin-users-table">
              <thead>
                <tr><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>{user.role === 'admin' ? 'Administrador' : 'Usuário'}</td>
                    <td><span className={`pill access-status access-status-${user.status}`}>{STATUS_LABELS[user.status] || user.status}</span></td>
                    <td>
                      {user.role === 'admin' ? <span className="muted small">Protegido</span> : (
                        <div className="admin-user-actions">
                          {user.status !== 'active' && (
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={Boolean(updatingId)}
                              onClick={() => updateStatus(user, 'active')}
                            >
                              <Check size={15} aria-hidden="true" /> Liberar Acesso
                            </Button>
                          )}
                          {user.status !== 'blocked' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={Boolean(updatingId)}
                              onClick={() => updateStatus(user, 'blocked')}
                            >
                              <ShieldBan size={15} aria-hidden="true" /> Bloquear
                            </Button>
                          )}
                          {updatingId === user.id && <span className="muted small">Salvando…</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
