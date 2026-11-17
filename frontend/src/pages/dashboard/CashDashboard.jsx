import { useMemo, useState } from 'react';
import {
  Bar as RBar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Link, useNavigate } from 'react-router-dom';
import { useFetch } from '../../hooks/useFetch.js';
import { useFinanceRefresh } from '../../hooks/useFinanceRefresh.js';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { cashLedgerApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Money, Select, Spinner } from '../../components/ui/ui.jsx';
import { money } from '../../lib/format.js';
import { PATHS } from '../../app/paths.js';

const STORAGE_KEY = 'financeiro:painel-avulsos-period';
const CHART_COLORS = ['var(--primary)', 'var(--pos)', 'var(--warn)', 'var(--chart-dim)', '#8b5cf6', '#ec4899'];
const METHODS = ['Dinheiro', 'Pix', 'Débito', 'Transferência', 'Não informado'];
const monthNow = () => {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
};
function initialMode() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (['month', 'last3', 'year', 'all'].includes(value?.mode)) return value.mode;
  } catch { /* use default period */ }
  return 'month';
}
const fromCents = (value) => money((value || 0) / 100);
const dateLabel = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR') : 'Sem vencimento';
const rangeLabel = ({ mode, month, year }) => {
  if (mode === 'all') return 'Todo o período';
  if (mode === 'last3') return `Últimos 3 meses até ${new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`;
  if (mode === 'year') return String(year);
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};
const navUrl = (params = {}) => {
  const query = new URLSearchParams(params);
  return `${PATHS.cashLedger}${query.size ? `?${query}` : ''}`;
};

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="cash-chart-tooltip"><strong>{label}</strong>{payload.map((item) => (
    <div key={item.dataKey} style={{ color: item.color }}>
      <span>{item.name}: </span>{money((item.value || 0) / 100)}
      {Number.isFinite(item.payload?.percentage) && ` · ${item.payload.percentage.toFixed(1).replace('.', ',')}%`}
    </div>
  ))}</div>;
}

function MetricCard({ title, cents, tone, aside, href, emptyMessage, isEmpty }) {
  const content = (
    <Card className={`cash-dashboard-metric ${href ? 'cash-dashboard-clickable' : ''}`}>
      <span className="muted">{title}</span>
      <strong><Money value={(cents || 0) / 100} tone={tone} /></strong>
      {aside && <small className="muted">{aside}</small>}
      {isEmpty && <small className="muted">{emptyMessage}</small>}
    </Card>
  );
  return href ? <Link className="cash-dashboard-link" to={href}>{content}</Link> : content;
}

export default function CashDashboard() {
  const navigate = useNavigate();
  const { month, year, setMonth, setYear, shift: shiftMonth } = usePeriod();
  const [mode, setMode] = useState(initialMode);
  const selected = useMemo(() => ({ mode, month, year }), [mode, month, year]);
  const params = useMemo(() => ({ period: selected.mode, month: selected.month, year: selected.year }), [selected]);
  const { data, loading, error, reload } = useFetch(() => cashLedgerApi.dashboard(params), [params]);
  useFinanceRefresh(reload);
  const setPeriod = ({ mode: nextMode, month: nextMonth, year: nextYear }) => {
    if (nextMode !== undefined) {
      setMode(nextMode);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: nextMode })); } catch { /* storage is optional */ }
    }
    if (nextMonth !== undefined) setMonth(nextMonth);
    if (nextYear !== undefined) setYear(nextYear);
  };
  const shift = (amount) => {
    if (selected.mode === 'year') setYear(year + amount);
    else shiftMonth(amount);
  };
  const rows = data;
  const evolution = useMemo(() => (rows?.evolution || []).map((item) => ({
    ...item,
    spent: item.spentCents,
    received: item.receivedCents,
    balance: item.balanceCents,
  })), [rows?.evolution]);
  const methods = useMemo(() => METHODS.map((name) => ({
    name,
    value: rows?.byPaymentMethod.find((item) => item.label === name)?.amountCents || 0,
  })).filter((item) => item.value > 0), [rows?.byPaymentMethod]);
  const methodTotal = methods.reduce((sum, item) => sum + item.value, 0);
  const methodData = methods.map((item) => ({ ...item, percentage: methodTotal ? item.value / methodTotal * 100 : 0 }));
  const categories = useMemo(() => {
    const total = rows?.totals.spentCents || 0;
    return (rows?.byCategory || []).map((item) => ({
      ...item, percentage: total ? item.amountCents / total * 100 : 0,
    }));
  }, [rows?.byCategory, rows?.totals.spentCents]);
  const spendingTotal = rows?.totals.spentCents || 0;
  const spendingEmpty = spendingTotal === 0;
  const noPeriodMovement = spendingTotal === 0 && (rows?.totals.receivedCents || 0) === 0;
  const changePercent = rows?.totals.variationPercent;
  const variation = changePercent == null
    ? 'Sem comparativo anterior'
    : <span className={changePercent > 0 ? 'cash-trend-neg' : changePercent < 0 ? 'cash-trend-pos' : ''}>
      {changePercent > 0 ? '↑' : changePercent < 0 ? '↓' : '→'} {Math.abs(changePercent).toFixed(1).replace('.', ',')}% vs. período anterior
    </span>;

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!rows) return <Spinner />;

  return (
    <div className={loading ? 'is-loading' : ''}>
      <div className="cash-dashboard-toolbar">
        <div>
          <span className="muted">Período do resumo</span>
          <strong className="cash-dashboard-period-label">{rangeLabel(selected)}</strong>
        </div>
        <div className="cash-dashboard-period-controls">
          <Select
            value={selected.mode}
            onChange={(mode) => setPeriod({ mode })}
            aria-label="Período do painel Avulsos"
            options={[
              { value: 'month', label: 'Mês' },
              { value: 'last3', label: 'Últimos 3 meses' },
              { value: 'year', label: 'Ano' },
              { value: 'all', label: 'Tudo' },
            ]}
          />
          {selected.mode === 'month' && (
            <>
              <Button aria-label="Mês anterior" onClick={() => shift(-1)}>‹</Button>
              <Button aria-label="Próximo mês" onClick={() => shift(1)}>›</Button>
              <Button variant="ghost" onClick={() => setPeriod({ ...monthNow(), mode: 'month' })}>Mês atual</Button>
            </>
          )}
          {selected.mode === 'year' && (
            <div className="cash-dashboard-year-control">
              <Button aria-label="Ano anterior" onClick={() => setPeriod({ year: selected.year - 1 })}>‹</Button>
              <strong>{selected.year}</strong>
              <Button aria-label="Próximo ano" onClick={() => setPeriod({ year: selected.year + 1 })}>›</Button>
            </div>
          )}
        </div>
        <div className="cash-dashboard-shortcuts">
          <Button variant="primary" onClick={() => navigate(navUrl({ new: '1' }))}>Novo registro</Button>
          <Button variant="ghost" onClick={() => navigate(PATHS.cashLedger)}>Ver todos os registros</Button>
        </div>
      </div>

      <section className="cash-dashboard-metrics" aria-label={`Resumo financeiro: ${rangeLabel(selected)}`}>
        <MetricCard title="Gastei no período" cents={rows.totals.spentCents} aside={variation} href={navUrl({ kind: 'expense' })} isEmpty={spendingEmpty} emptyMessage="Nenhum gasto avulso neste período" />
        <MetricCard title="Recebido no período" cents={rows.totals.receivedCents} tone="pos" href={navUrl({ status: 'quitado' })} isEmpty={rows.totals.receivedCents === 0} emptyMessage="Nenhum recebimento neste período" />
        <MetricCard title="A receber no período" cents={rows.totals.receivableCents} tone="warn" href={navUrl({ status: 'pendente' })} isEmpty={rows.totals.receivableCents === 0} emptyMessage="Nenhuma parcela neste período" />
        <MetricCard title="Total geral a receber" cents={rows.totals.totalReceivableCents} tone="warn" href={navUrl({ status: 'pendente' })} isEmpty={rows.totals.totalReceivableCents === 0} emptyMessage="Nenhum valor em aberto" />
        <MetricCard title={`Em atraso · ${rows.totals.overdueCount} parcelas`} cents={rows.totals.overdueCents} tone="neg" href={navUrl({ status: 'atrasada' })} isEmpty={rows.totals.overdueCents === 0} emptyMessage="Nenhuma parcela atrasada" />
        <MetricCard title="Saldo do período" cents={rows.totals.balanceCents} tone={rows.totals.balanceCents >= 0 ? 'pos' : 'neg'} isEmpty={noPeriodMovement} emptyMessage="Sem movimentação neste período" />
      </section>

      <div className="grid-2">
        <Card title="Evolução mensal · últimos 12 meses" aside={<span className="muted">Recebido, gasto e saldo</span>}>
          {evolution.every((item) => item.spent === 0 && item.received === 0) ? <EmptyState title="Sem movimentos para exibir" /> : (
            <div className="cash-dashboard-chart">
              <ResponsiveContainer width="100%" height={290}>
                <ComposedChart data={evolution} margin={{ top: 8, right: 12, left: 0, bottom: 2 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={(value) => `R$${Math.round(value / 100)}`} width={58} />
                  <Tooltip content={<ChartTooltip />} />
                  <RBar dataKey="received" name="Recebido" fill="var(--pos)" radius={[4, 4, 0, 0]} />
                  <RBar dataKey="spent" name="Gastei" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  <Line dataKey="balance" name="Saldo" type="monotone" stroke="var(--warn)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Gastos por categoria" aside={<span className="muted">{rangeLabel(selected)}</span>}>
          {categories.length === 0 ? <EmptyState title="Nenhum gasto avulso neste período" /> : (
            <div className="cash-dashboard-chart">
              <ResponsiveContainer width="100%" height={290}>
                <BarChart data={categories.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={(value) => `R$${Math.round(value / 100)}`} />
                  <YAxis type="category" dataKey="label" width={105} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <RBar dataKey="amountCents" name="Gasto" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <ul className="cash-chart-legend cash-category-legend">{categories.slice(0, 8).map((item, index) => (
                <li key={item.label}><span><i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />{item.label}</span><strong>{fromCents(item.amountCents)} · {item.percentage.toFixed(1).replace('.', ',')}%</strong></li>
              ))}</ul>
              <div className="muted cash-chart-caption">Total no período: {fromCents(spendingTotal)}</div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Gastos por forma de pagamento" aside={<span className="muted">{rangeLabel(selected)}</span>}>
          {methodData.length === 0 ? <EmptyState title="Nenhum gasto avulso neste período" /> : (
            <div className="cash-dashboard-chart cash-payment-chart">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={methodData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={88} paddingAngle={3}>
                    {methodData.map((item, index) => <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="cash-chart-legend">{methodData.map((item, index) => (
                <li key={item.name}><span><i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />{item.name}</span><strong>{fromCents(item.value)} · {item.percentage.toFixed(1).replace('.', ',')}%</strong></li>
              ))}</ul>
            </div>
          )}
        </Card>
        <Card title="A receber nos próximos 6 meses" aside={<span className="muted">Saldo ainda pendente por vencimento</span>}>
          {rows.receivableMonths.every((item) => item.amountCents === 0) ? <EmptyState title="Nenhum recebimento previsto nos próximos meses" /> : (
            <div className="cash-dashboard-chart">
              <ResponsiveContainer width="100%" height={290}>
                <BarChart data={rows.receivableMonths} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={(value) => `R$${Math.round(value / 100)}`} width={58} />
                  <Tooltip content={<ChartTooltip />} />
                  <RBar dataKey="amountCents" name="A receber" fill="var(--warn)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Quem mais deve" aside={<Link className="link-btn" to={PATHS.cashLedger}>Ver pessoas</Link>}>
          {rows.byPerson.length === 0 ? <EmptyState title="Nenhum valor a receber" /> : (
            <ol className="cash-dashboard-ranking">{rows.byPerson.map((person) => {
              const total = person.receivedCents + person.outstandingCents;
              const paidPct = total ? Math.min(100, person.receivedCents / total * 100) : 0;
              return (
                <li key={person.id ?? person.name}>
                  <button className="link-btn" onClick={() => navigate(navUrl(person.id ? { personId: person.id } : { search: person.name }))}>{person.name}</button>
                  <div className="cash-dashboard-ranking-values"><span>Recebeu {fromCents(person.receivedCents)}</span><strong>Falta {fromCents(person.outstandingCents)}</strong></div>
                  <div className="bar"><div className="bar-fill bar-primary" style={{ width: `${paidPct}%` }} /></div>
                </li>
              );
            })}</ol>
          )}
        </Card>
        <Card title="A receber por tipo">
          {rows.byKind.length === 0 ? <EmptyState title="Nenhum valor a receber" /> : (
            <ul className="rank">{rows.byKind.map((item) => (
              <li key={item.kind}>
                <div className="rank-row"><Link className="link-btn" to={navUrl({ kind: item.kind })}>{item.label}</Link><Money value={item.amountCents / 100} /></div>
                <div className="bar"><div className="bar-fill bar-accent" style={{ width: `${Math.min(100, item.amountCents / rows.totals.totalReceivableCents * 100)}%` }} /></div>
              </li>
            ))}</ul>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Atrasados" aside={<Link className="link-btn" to={navUrl({ status: 'atrasada' })}>Ver todos</Link>}>
          {rows.overdue.length === 0 ? <EmptyState title="Nenhuma parcela atrasada" /> : (
            <ul className="cash-dashboard-list">{rows.overdue.map((item) => (
              <li key={item.installmentId}>
                <Link to={navUrl({ entryId: item.entryId })}><strong>{item.person}</strong><small>{item.description} · venc. {dateLabel(item.dueDate)} · {item.daysLate} dia(s) de atraso</small></Link>
                <Money value={item.amountCents / 100} tone="neg" />
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="Próximos vencimentos" aside={<Link className="link-btn" to={navUrl({ status: 'pendente' })}>Ver todos</Link>}>
          {rows.upcoming.length === 0 ? <EmptyState title="Nenhum vencimento próximo" /> : (
            <ul className="cash-dashboard-list">{rows.upcoming.map((item) => (
              <li key={item.installmentId}>
                <Link to={navUrl({ entryId: item.entryId })}><strong>{item.person}</strong><small>{item.description} · {dateLabel(item.dueDate)}</small></Link>
                <Money value={item.amountCents / 100} tone="warn" />
              </li>
            ))}</ul>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Reembolsos pendentes" aside={<Link className="link-btn" to={navUrl({ kind: 'refund', status: 'pendente' })}>Ver todos</Link>}>
          {rows.refunds.length === 0 ? <EmptyState title="Nenhum reembolso pendente" /> : (
            <ul className="cash-dashboard-list">{rows.refunds.slice(0, 10).map((item) => (
              <li key={item.id}>
                <Link to={navUrl({ entryId: item.id })}><strong>{item.description}</strong><small>{item.counterparty || 'Sem identificação'} · Protocolo {item.protocol || '—'} · {item.daysPending} dia(s) pendente</small></Link>
                <span className="cash-status cash-status-pending">{item.refundStatus === 'requested' ? 'Solicitado' : 'Em análise'}</span>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="Últimos movimentos" aside={<Link className="link-btn" to={PATHS.cashLedger}>Ver todos</Link>}>
          {rows.movements.length === 0 ? <EmptyState title="Nenhum movimento registrado" /> : (
            <ul className="cash-dashboard-list">{rows.movements.map((item, index) => (
              <li key={`${item.type}-${item.entryId}-${item.date}-${index}`}>
                <Link to={navUrl({ entryId: item.entryId })}><strong>{item.description}</strong><small>{item.type === 'expense' ? 'Gasto' : 'Recebimento'} · {item.person} · {dateLabel(item.date)}</small></Link>
                <Money value={item.amountCents / 100} tone={item.type === 'receipt' ? 'pos' : undefined} />
              </li>
            ))}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
