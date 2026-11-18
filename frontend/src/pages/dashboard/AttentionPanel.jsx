import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell } from 'lucide-react';
import AlertDetailsModal from '../../components/notifications/AlertDetailsModal.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { cashLedgerApi, peopleApi, remindersApi } from '../../services/api.js';
import { Card, EmptyState, ErrorState, Money, Spinner } from '../../components/ui/ui.jsx';
import { dismissAlert as dismissAlertRequest } from '../../lib/alerts.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function AttentionPanel() {
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [dismissedReceivables, setDismissedReceivables] = useState(() => new Set());
  const toast = useToast();
  const alerts = useFetch(() => remindersApi.getAlerts(), []);
  const cash = useFetch(() => cashLedgerApi.list({ all: true }), []);
  const people = useFetch(() => peopleApi.list(), [], { cacheKey: 'lookup:people', refreshEvent: 'people:refresh' });

  useEffect(() => {
    const refresh = () => {
      alerts.reload();
      cash.reload();
    };
    window.addEventListener('finance:refresh', refresh);
    window.addEventListener('reminders:refresh', refresh);
    return () => {
      window.removeEventListener('finance:refresh', refresh);
      window.removeEventListener('reminders:refresh', refresh);
    };
  }, [alerts.reload, cash.reload]);

  const error = alerts.error || cash.error || people.error;
  if (error) return <Card title="O que precisa de atenção"><ErrorState error={error} onRetry={() => { alerts.reload(); cash.reload(); people.reload(); }} /></Card>;
  if (!alerts.data || !cash.data || !people.data) return <Card title="O que precisa de atenção"><Spinner /></Card>;

  const peopleById = new Map(people.data.map((person) => [person.id, person]));
  const receivables = new Map();
  for (const row of cash.data.data ?? []) {
    if (!row.personId || row.outstanding <= 0 || !['sale', 'loan', 'refund'].includes(row.kind)) continue;
    const item = receivables.get(row.personId) ?? { person: peopleById.get(row.personId), amount: 0 };
    item.amount += row.outstanding;
    receivables.set(row.personId, item);
  }
  const attention = (alerts.data.alerts ?? []).slice(0, 6).map((alert) => {
    const person = people.data.find((item) => item.name === alert.personName);
    const to = alert.type === 'monthly_budget' && person
      ? `/pessoas/${person.id}/planilha/${new Date().getFullYear()}`
      : alert.link || '/lancamentos/dinheiro';
    return { ...alert, to, link: to };
  });
  for (const [personId, item] of receivables) {
    if (!item.person) continue;
    attention.push({
      id: `receivable-${personId}`,
      type: 'receivable',
      title: `${item.person.name} tem valores a receber`,
      description: 'Consulte o histórico e registre pagamentos recebidos.',
      amount: item.amount,
      to: `/lancamentos/dinheiro?personId=${personId}&status=pending`,
      link: `/lancamentos/dinheiro?personId=${personId}&status=pending`,
      severity: 'info',
    });
  }
  const visibleAttention = attention.filter((item) => (
    item.alertKey || !dismissedReceivables.has(`${item.id}:${item.amount}`)
  ));
  const openAlert = (item) => {
    setSelectedAlert(item);
    if (item.alertKey) {
      void dismissAlertRequest(item, toast);
    } else {
      setDismissedReceivables((current) => new Set(current).add(`${item.id}:${item.amount}`));
    }
  };

  return (
    <Card title="O que precisa de atenção" className="attention-panel" aside={<Bell aria-hidden="true" />}>
      {visibleAttention.length === 0 ? <EmptyState title="Tudo em dia">Não há vencimentos ou valores a receber que precisem de atenção agora.</EmptyState> : (
        <div className="attention-list">
          {visibleAttention.slice(0, 8).map((item) => (
            <button type="button" className={`attention-item attention-${item.severity}`} key={item.id} onClick={() => openAlert(item)} aria-haspopup="dialog">
              <span className="attention-icon">{item.severity === 'danger' ? <AlertTriangle aria-hidden="true" /> : <Bell aria-hidden="true" />}</span>
              <span className="attention-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
              <Money value={item.amount} />
              <ArrowRight aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {selectedAlert && <AlertDetailsModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />}
    </Card>
  );
}
