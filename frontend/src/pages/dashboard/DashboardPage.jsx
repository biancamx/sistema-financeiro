import { useEffect, useState } from 'react';
import { Bar as RBar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import CashDashboard from './CashDashboard.jsx';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useFinanceRefresh } from '../../hooks/useFinanceRefresh.js';
import { dashboardApi } from '../../services/api.js';
import { Bar, Card, EmptyState, ErrorState, Money, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { MONTHS_SHORT, money, monthLabel } from '../../lib/format.js';

export default function DashboardPage() {
  const { month, year, setMonth } = usePeriod();
  const [personId, setPersonId] = useState('');
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem('financeiro:painel-tab') === 'cash' ? 'cash' : 'cards'; } catch { return 'cards'; }
  });
  const { data, loading, error, reload } = useFetch(() => dashboardApi.summary({ month, year, personId }), [month, year, personId]);
  useFinanceRefresh(reload);

  useEffect(() => {
    try { localStorage.setItem('financeiro:painel-tab', tab); } catch { /* storage is optional */ }
  }, [tab]);

  const tabs = (
    <div className="tabs dashboard-tabs" role="tablist" aria-label="Painel">
      <button role="tab" aria-selected={tab === 'cards'} className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>Cartões</button>
      <button role="tab" aria-selected={tab === 'cash'} className={tab === 'cash' ? 'on' : ''} onClick={() => setTab('cash')}>Avulsos</button>
    </div>
  );

  if (tab === 'cash') return (
    <div>
      <PageHeader title="Painel" subtitle="Resumo de entradas e saídas avulsas" />
      {tabs}
      <CashDashboard />
    </div>
  );
  if (error) return <div><PageHeader title="Painel" subtitle={`Resumo de ${monthLabel(month, year)}`} />{tabs}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div><PageHeader title="Painel" subtitle={`Resumo de ${monthLabel(month, year)}`} />{tabs}<Spinner /></div>;
  const { totals, cardTotals, people, person, series, byCategory } = data;
  const maxCard = Math.max(...cardTotals.map((c) => c.amount), 1);
  const maxCat = Math.max(...byCategory.map((c) => c.amount), 1);
  const chart = series.map((s) => ({ name: MONTHS_SHORT[s.month - 1], month: s.month, amount: s.amount }));

  return (
    <div className={loading ? 'is-loading' : ''}>
      <PageHeader title="Painel" subtitle={`Resumo de ${monthLabel(month, year)}`} />
      {tabs}

      <section className="hero">
        <div className="hero-main">
          <span className="hero-label">Faturas de {monthLabel(month)}</span>
          <strong className="hero-value">{money(totals.month)}</strong>
          <dl className="hero-stats">
            <div><dt>A pagar daqui para frente</dt><dd>{money(totals.owed)}</dd></div>
            <div><dt>Limite disponível</dt><dd><Money value={totals.available} /></dd></div>
          </dl>
        </div>
        <div className="hero-chart" aria-label={`Faturas mês a mês em ${year}`}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chart} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted)' }} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} formatter={(v) => money(v)} labelFormatter={(l) => `${l}/${year}`} contentStyle={{ borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)' }} />
              <RBar dataKey="amount" name="Fatura" isAnimationActive={false} radius={[4, 4, 0, 0]} onClick={(d) => setMonth(d.month)} cursor="pointer">
                {chart.map((c) => <Cell key={c.month} fill={c.month === month ? 'var(--primary)' : 'var(--chart-dim)'} />)}
              </RBar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="cash-kpis dashboard-cash-kpis" aria-label="Resumo de caixa avulso">
        <Card><span className="muted">Gastos avulsos no mês</span><strong><Money value={totals.cash.spent} /></strong></Card>
        <Card><span className="muted">Recebido no mês</span><strong><Money value={totals.cash.received} tone="pos" /></strong></Card>
        <Card><span className="muted">A receber</span><strong><Money value={totals.cash.totalReceivable} tone="warn" /></strong></Card>
        <Card><span className="muted">Em atraso · {totals.cash.overdueCount}</span><strong><Money value={totals.cash.overdue} tone="neg" /></strong></Card>
      </section>

      <div className="grid-2">
        <Card title="Total de cada cartão">
          {cardTotals.length === 0 ? <EmptyState title="Nenhum cartão cadastrado" /> : (
            <div className="table-responsive"><table className="table">
              <thead><tr><th>Cartão</th><th className="num">Fatura do mês</th><th className="num">Limite disponível</th></tr></thead>
              <tbody>
                {cardTotals.map((c) => (
                  <tr key={c.id}>
                    <td><div>{c.name}</div><Bar value={c.amount} max={maxCard} /></td>
                    <td className="num"><Money value={c.amount} /></td>
                    <td className="num">{c.limit > 0 ? <Money value={c.available} tone={c.available < 0 ? 'neg' : undefined} /> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td className="num"><Money value={totals.month} strong /></td><td /></tr></tfoot>
            </table></div>
          )}
        </Card>

        <Card title="Quem deve quanto" aside={<span className="muted">a partir de {monthLabel(month, year)}</span>}>
          {people.length === 0 ? <EmptyState title="Nenhuma pessoa cadastrada" /> : (
            <div className="table-responsive"><table className="table">
              <thead><tr><th>Pessoa</th><th className="num">No mês</th><th className="num">Total devido</th><th>Último pagamento</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="num"><Money value={p.month} /></td>
                    <td className="num"><Money value={p.owed} /></td>
                    <td>{p.lastPayment ? `${monthLabel(p.lastPayment.month)} / ${p.lastPayment.year}` : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card
          title="Fatura por pessoa"
          aside={<Select value={personId || person?.id || ''} onChange={setPersonId} options={people.map((p) => ({ value: p.id, label: p.name }))} aria-label="Pessoa" />}
        >
          {!person ? <EmptyState title="Escolha uma pessoa" /> : (
            <div className="table-responsive"><table className="table">
              <thead><tr><th>Cartão</th><th className="num">Valor devido no mês</th></tr></thead>
              <tbody>
                {person.cards.map((c) => (
                  <tr key={c.id} className={c.amount === 0 ? 'row-dim' : ''}><td>{c.name}</td><td className="num"><Money value={c.amount} /></td></tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total em cartões</td><td className="num"><Money value={person.total} strong /></td></tr></tfoot>
            </table></div>
          )}
        </Card>

        <Card title="Onde o dinheiro foi" aside={<span className="muted">{monthLabel(month)}</span>}>
          {byCategory.length === 0 ? <EmptyState title="Sem lançamentos neste mês" /> : (
            <ul className="rank">
              {byCategory.map((c) => (
                <li key={c.name}>
                  <div className="rank-row"><span>{c.name}</span><Money value={c.amount} /></div>
                  <Bar value={c.amount} max={maxCat} tone="accent" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
