import { Bar as RBar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Bar, Button, Card, EmptyState, Money } from '../../components/ui/ui.jsx';
import { MONTHS_SHORT, money } from '../../lib/format.js';
import { GROUP_TONE, showDate, showKm } from './vehicles.js';

function Kpi({ label, children, hint }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{children}</strong>
      {hint && <span className="small">{hint}</span>}
    </div>
  );
}

/** Painel do veículo selecionado ou da frota inteira. */
export default function SummaryTab({ summary, vehicle, onPickVehicle, onOpenExpenses, onOpenMaintenance, onRegisterExpense, year, period }) {
  const s = summary;
  if (!s.count) {
    return (
      <>
        <EmptyState title="Nenhum gasto neste recorte">
          <p>{year === 'all' || period === 'all' ? 'Registre o primeiro gasto na aba Lançamentos.' : 'Tente outro ano ou registre um gasto na aba Lançamentos.'}</p>
          <Button variant="primary" onClick={onRegisterExpense}>+ Registrar gasto</Button>
        </EmptyState>
        {s.reminders?.length > 0 && (
          <Card title="Próximos vencimentos" aside={<Button variant="ghost" size="sm" onClick={onOpenMaintenance}>Ver manutenção</Button>}>
            <div className="veh-summary-list">
              {s.reminders.map((reminder) => (
                <div className="veh-summary-row" key={reminder.id}>
                  <div><strong>{reminder.title}</strong><span className="muted small">{reminder.description}</span></div>
                  <span className={`pill ${reminder.status === 'overdue' ? 'pill-danger' : 'pill-warn'}`}>{reminder.statusLabel}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </>
    );
  }

  const chart = s.byMonth.map((month) => ({
    name: MONTHS_SHORT[month.month - 1],
    total: month.total,
    current: month.current,
  }));
  const maxCat = Math.max(...s.byCategory.map((c) => c.total), 1);
  const maxVeh = Math.max(...s.byVehicle.map((v) => v.total), 1);

  return (
    <>
      <div className="year-kpis">
        <Kpi label="Total gasto no período">{money(s.total)}</Kpi>
        {s.comparison && (
          <Kpi label="Comparação com período anterior" hint={`${money(s.comparison.total)} no período anterior`}>
            <span className={s.comparison.percentChange > 0 ? 'veh-cost-up' : 'veh-cost-down'}>
              {s.comparison.percentChange > 0 ? '+' : ''}{s.comparison.percentChange}%
            </span>
          </Kpi>
        )}
        {s.averageMonthly != null && <Kpi label="Média mensal">{money(s.averageMonthly)}</Kpi>}
        {vehicle && <Kpi label="KM atual">{showKm(s.currentKm)}</Kpi>}
        {vehicle && s.costPerKm != null && <Kpi label="Custo por km rodado" hint={`histórico ÷ ${showKm(s.kmSpan)} registrados`}>{money(s.costPerKm)}</Kpi>}
        {vehicle && s.consumptionKmPerLiter != null && <Kpi label="Consumo médio">{s.consumptionKmPerLiter} km/l</Kpi>}
        {s.possessionCostPercent != null && <Kpi label="Custo de posse no ano">{s.possessionCostPercent}%</Kpi>}
      </div>

      <div className="grid-2 first">
        <Card title={`Gastos por mês em ${s.chartYear}`}>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={chart} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} formatter={(v) => money(v)} contentStyle={{ borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)' }} />
              <RBar dataKey="total" name="Gasto" isAnimationActive={false} radius={[4, 4, 0, 0]}>
                {chart.map((month) => (
                  <Cell
                    key={month.name}
                    fill={month.current ? 'var(--warn)' : month.total === 0 ? 'var(--chart-dim)' : 'var(--primary)'}
                  />
                ))}
              </RBar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Gastos por categoria">
          <ul className="rank">
            {s.byCategory.map((c) => (
              <li key={c.key}>
                <div className="rank-row"><span>{c.label} <span className="muted small">· {((c.total / s.total) * 100).toFixed(1)}%</span></span><Money value={c.total} /></div>
                <Bar value={c.total} max={maxCat} tone={GROUP_TONE[c.group]} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Últimos gastos" aside={<Button variant="ghost" size="sm" onClick={onOpenExpenses}>Ver lançamentos</Button>}>
          <div className="veh-summary-list">
            {s.recentExpenses.map((expense) => (
              <div className="veh-summary-row" key={expense.id}>
                <div>
                  <strong>{expense.description || expense.categoryLabel}</strong>
                  {!vehicle && <span className="muted small">{expense.vehicleModel}</span>}
                  <span className="muted small">{showDate(expense.date)} · {expense.categoryLabel}{expense.shared ? ' · Compartilhada' : ''}</span>
                </div>
                <Money value={expense.amount} strong />
              </div>
            ))}
            {!s.recentExpenses.length && <p className="muted small">Nenhum gasto neste período.</p>}
          </div>
        </Card>
        {!vehicle && s.byVehicle.length > 0 && (
          <Card title="Gastos por veículo">
            <ul className="rank">
              {s.byVehicle.map((v) => (
                <li key={v.vehicleId}>
                  <div className="rank-row"><button className="link-btn" onClick={() => onPickVehicle(v.vehicleId)}>{v.label}</button><Money value={v.total} strong /></div>
                  <Bar value={v.total} max={maxVeh} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        {s.reminders?.length > 0 && (
          <Card title="Próximos vencimentos" aside={<Button variant="ghost" size="sm" onClick={onOpenMaintenance}>Ver manutenção</Button>}>
            <div className="veh-summary-list">
              {s.reminders.slice(0, 3).map((reminder) => (
                <div className="veh-summary-row" key={reminder.id}>
                  <div><strong>{reminder.title}</strong><span className="muted small">{reminder.description}</span></div>
                  <span className={`pill ${reminder.status === 'overdue' ? 'pill-danger' : 'pill-warn'}`}>{reminder.statusLabel}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
        <div className="stack">
          <Card title="Acerto entre pessoas" aside={<span className="muted small">quem pagou × quanto assume</span>}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Pessoa</th><th className="num">Pagou</th><th className="num">Assume</th><th className="num">Saldo</th></tr></thead>
                <tbody>
                  {s.people.map((p) => (
                    <tr key={p.personId}>
                      <td>{p.name}</td>
                      <td className="num">{money(p.paid)}</td>
                      <td className="num">{money(p.owes)}</td>
                      <td className="num">
                        {p.balance === 0 ? <span className="muted">quite</span> : <><Money value={p.balance} tone={p.balance > 0 ? 'pos' : undefined} strong /> <span className="muted small">{p.balance > 0 ? 'a receber' : 'a pagar'}</span></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="field-hint" style={{ marginTop: 8 }}>Saldo = quanto a pessoa pagou − quanto ela assume. Positivo: os outros devem a ela. Negativo: ela deve aos outros.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
