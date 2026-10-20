import { Bar as RBar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Bar, Card, EmptyState, Money } from '../../components/ui/ui.jsx';
import { MONTHS_SHORT, money } from '../../lib/format.js';
import { GROUP_TONE, showKm } from './vehicles.js';

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
export default function SummaryTab({ summary, vehicle, onPickVehicle, year }) {
  const s = summary;
  if (!s.count) return <EmptyState title="Nenhum gasto neste recorte">{year === 'all' ? 'Registre o primeiro gasto na aba Lançamentos.' : 'Tente outro ano ou registre um gasto na aba Lançamentos.'}</EmptyState>;

  const chart = s.byMonth.slice(-24).map((m) => ({ name: year === 'all' ? `${MONTHS_SHORT[m.month - 1]}/${String(m.year).slice(2)}` : MONTHS_SHORT[m.month - 1], total: m.total }));
  const maxCat = Math.max(...s.byCategory.map((c) => c.total), 1);
  const maxVeh = Math.max(...s.byVehicle.map((v) => v.total), 1);
  const monthsWithSpend = s.byMonth.filter((m) => m.total > 0).length || 1;
  const acquisition = vehicle?.purchaseValue > 0 ? vehicle.purchaseValue : 0;

  return (
    <>
      <div className="year-kpis">
        <Kpi label="Total gasto">{money(s.total)}</Kpi>
        <Kpi label="Lançamentos">{s.count}</Kpi>
        <Kpi label="Média por mês com gasto">{money(s.total / monthsWithSpend)}</Kpi>
        {vehicle && <Kpi label="KM atual">{showKm(s.currentKm)}</Kpi>}
        {vehicle && s.costPerKm != null && <Kpi label="Custo por km rodado" hint={`histórico ÷ ${showKm(s.kmSpan)} registrados`}>{money(s.costPerKm)}</Kpi>}
        {acquisition > 0 && <Kpi label="Gasto × valor de compra" hint={`compra: ${money(acquisition)}`}>{Math.round((vehicle.totalSpent / acquisition) * 100)}%</Kpi>}
      </div>

      <div className="grid-2 first">
        <Card title="Por grupo">
          <ul className="rank">
            {s.byGroup.map((g) => (
              <li key={g.key}>
                <div className="rank-row"><span>{g.label} <span className="muted small">· {g.count}</span></span><Money value={g.total} strong /></div>
                <Bar value={g.total} max={s.total} tone={GROUP_TONE[g.key]} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title={year === 'all' ? 'Gastos por mês' : `Gastos por mês em ${year}`}>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={chart} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} formatter={(v) => money(v)} contentStyle={{ borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)' }} />
              <RBar dataKey="total" name="Gasto" fill="var(--primary)" isAnimationActive={false} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Por categoria">
          <ul className="rank">
            {s.byCategory.map((c) => (
              <li key={c.key}>
                <div className="rank-row"><span>{c.label} <span className="muted small">· {c.count}</span></span><Money value={c.total} /></div>
                <Bar value={c.total} max={maxCat} tone={GROUP_TONE[c.group]} />
              </li>
            ))}
          </ul>
        </Card>

        <div className="stack">
          {!vehicle && s.byVehicle.length > 0 && (
            <Card title="Por veículo">
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
