import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useFinanceRefresh } from '../../hooks/useFinanceRefresh.js';
import { budgetApi, dashboardApi, peopleApi } from '../../services/api.js';
import { Card, EmptyState, ErrorState, Money, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import MoneyCell from '../../components/MoneyCell.jsx';
import { MONTHS_SHORT, moneyPlain, yearsAround } from '../../lib/format.js';
import { PATHS } from '../../app/paths.js';

export default function OverviewPage() {
  const nav = useNavigate();
  const toast = useToast();
  const params = useParams();
  const people = useFetch(() => peopleApi.list(), []);
  const thisYear = new Date().getFullYear();
  const personId = Number(params.personId) || people.data?.[0]?.id;
  const year = Number(params.year) || thisYear;
  const [newLabel, setNewLabel] = useState(null);

  useEffect(() => {
    if (!params.personId && personId) nav(`${PATHS.overview}/${personId}/${year}`, { replace: true });
  }, [params.personId, personId, year, nav]);

  const ov = useFetch(() => dashboardApi.overview({ personId, year }), [personId, year], { enabled: Boolean(personId) });
  useFinanceRefresh(ov.reload);

  if (people.error) return <ErrorState error={people.error} onRetry={people.reload} />;
  if (!people.data) return <Spinner />;
  if (people.data.length === 0) return <EmptyState title="Nenhuma pessoa cadastrada" />;

  const go = (p, y) => nav(`${PATHS.overview}/${p}/${y}`);
  const d = ov.data;
  const toggle = async (month) => {
    const next = d.status[month - 1] === 'paid' ? 'pending' : 'paid';
    ov.setData((o) => ({ ...o, status: o.status.map((s, i) => (i === month - 1 ? next : s)) }));
    try { await dashboardApi.setStatus({ personId, year, month, status: next }); } catch (e) { toast.error(e); ov.reload(); }
  };
  const saveCell = async (row, month, value) => {
    ov.setData((o) => ({ ...o, fixed: o.fixed.map((r) => (r.id === row.id ? { ...r, values: r.values.map((v, i) => (i === month - 1 ? value : v)) } : r)) }));
    try { await budgetApi.setCell(row.id, month, value); ov.reload(); } catch (e) { toast.error(e); ov.reload(); }
  };
  const addRow = async (e) => {
    e.preventDefault();
    if (!newLabel?.trim()) return setNewLabel(null);
    try { await budgetApi.addRow(d.sheetId, { section: 'fixed', label: newLabel.trim() }); setNewLabel(null); ov.reload(); } catch (err) { toast.error(err); }
  };
  const removeRow = async (r) => {
    if (!window.confirm(`Remover "${r.label}"?`)) return;
    try { await budgetApi.removeRow(r.id); ov.reload(); } catch (e) { toast.error(e); }
  };

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle="Faturas dos cartões + contas fixas (luz, água, internet, veículo…) de cada pessoa, mês a mês"
        actions={<>
          <Select value={personId || ''} onChange={(v) => go(v, year)} options={people.data.map((p) => ({ value: p.id, label: p.name }))} aria-label="Pessoa" />
          <Select value={year} onChange={(v) => go(personId, v)} options={yearsAround(thisYear).map((y) => ({ value: y, label: y }))} aria-label="Ano" />
        </>}
      />
      {ov.error && <ErrorState error={ov.error} onRetry={ov.reload} />}
      {!d && !ov.error && <Spinner />}
      {d && (
        <Card className="sheet-card">
          <div className="table-wrap sheet-scroll">
            <table className="sheet">
              <thead><tr><th className="sticky-col">{d.person.name} · {year}</th>{MONTHS_SHORT.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Ano</th><th /></tr></thead>
              <tbody>
                <tr className="sec-head"><th colSpan={15} className="sticky-col">Cartões de crédito<span className="pill">automático</span></th></tr>
                {d.cards.length === 0 && <tr><td className="sticky-col muted">Sem parcelas neste ano</td><td colSpan={14} /></tr>}
                {d.cards.map((c) => (
                  <tr key={c.id}>
                    <td className="sticky-col">{c.name}</td>
                    {c.values.map((v, i) => <td key={i} className="num">{v ? moneyPlain(v) : ''}</td>)}
                    <td className="num total">{moneyPlain(c.total)}</td><td />
                  </tr>
                ))}
                <tr className="sec-head"><th colSpan={15} className="sticky-col">Contas fixas e veículo</th></tr>
                {d.fixed.map((r) => (
                  <tr key={r.id}>
                    <td className="sticky-col">{r.label}</td>
                    {r.values.map((v, i) => <td key={i} className="num"><MoneyCell value={v} onSave={(n) => saveCell(r, i + 1, n)} /></td>)}
                    <td className="num total">{moneyPlain(r.total)}</td>
                    <td className="row-actions"><button className="icon-btn" onClick={() => removeRow(r)} aria-label={`Remover ${r.label}`}>×</button></td>
                  </tr>
                ))}
                <tr>
                  <td className="sticky-col" colSpan={1}>
                    {newLabel === null ? <button className="link-btn" onClick={() => setNewLabel('')}>+ conta fixa</button>
                      : <form onSubmit={addRow}><input className="cell cell-label" autoFocus placeholder="Ex.: Enel, Cagece…" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onBlur={addRow} /></form>}
                  </td>
                  <td colSpan={14} />
                </tr>
              </tbody>
              <tbody className="summary">
                <tr className="sec-total strong">
                  <td className="sticky-col">Total do mês</td>
                  {d.totals.map((v, i) => <td key={i} className="num">{moneyPlain(v)}</td>)}
                  <td className="num total">{moneyPlain(d.yearTotal)}</td><td />
                </tr>
                <tr>
                  <td className="sticky-col">Status</td>
                  {d.status.map((s, i) => (
                    <td key={i} className="num"><button className={`status status-${s}`} onClick={() => toggle(i + 1)} aria-label={`${MONTHS_SHORT[i]}: ${s === 'paid' ? 'pago' : 'pendente'}`}>{s === 'paid' ? 'Pago' : 'Pendente'}</button></td>
                  ))}
                  <td /><td />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
