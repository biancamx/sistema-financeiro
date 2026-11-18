import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Bell } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { cashLedgerApi, peopleApi, remindersApi } from '../../services/api.js';
import { Card, EmptyState, ErrorState, Money, Spinner } from '../../components/ui/ui.jsx';

export default function AttentionPanel() {
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
    return { id: alert.id, title: alert.title, description: alert.description, amount: alert.amount, to, severity: alert.severity };
  });
  for (const [personId, item] of receivables) {
    if (!item.person) continue;
    attention.push({
      id: `receivable-${personId}`,
      title: `${item.person.name} tem valores a receber`,
      description: 'Consulte o histórico e registre pagamentos recebidos.',
      amount: item.amount,
      to: `/lancamentos/dinheiro?personId=${personId}&status=pending`,
      severity: 'info',
    });
  }

  return (
    <Card title="O que precisa de atenção" className="attention-panel" aside={<Bell aria-hidden="true" />}>
      {attention.length === 0 ? <EmptyState title="Tudo em dia">Não há vencimentos ou valores a receber que precisem de atenção agora.</EmptyState> : (
        <div className="attention-list">
          {attention.slice(0, 8).map((item) => (
            <Link to={item.to} className={`attention-item attention-${item.severity}`} key={item.id}>
              <span className="attention-icon">{item.severity === 'danger' ? <AlertTriangle aria-hidden="true" /> : <Bell aria-hidden="true" />}</span>
              <span className="attention-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
              <Money value={item.amount} />
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
