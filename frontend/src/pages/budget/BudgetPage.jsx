import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { budgetApi, peopleApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Money, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { MONTHS_SHORT, moneyPlain, yearsAround } from '../../lib/format.js';
import MoneyCell from '../../components/MoneyCell.jsx';
import { PATHS } from '../../app/paths.js';

export default function BudgetPage() {
  const nav = useNavigate();
  const toast = useToast();
  const params = useParams();
  const people = useFetch(() => peopleApi.list(), []);
  const thisYear = new Date().getFullYear();
  const personId = Number(params.personId) || people.data?.[0]?.id;
  const year = Number(params.year) || thisYear;

  useEffect(() => {
    if (!params.personId && personId) nav(`${PATHS.budget}/${personId}/${year}`, { replace: true });
  }, [params.personId, personId, year, nav]);

  const sheet = useFetch(() => budgetApi.get({ personId, year }), [personId, year], { enabled: Boolean(personId) });
  const [lastEdit, setLastEdit] = useState({}); // rowId -> { month, value } para "repetir até dezembro"
  const [adding, setAdding] = useState(null); // { section, label }

  if (people.error) return <ErrorState error={people.error} onRetry={people.reload} />;
  if (!people.data) return <Spinner />;
  if (people.data.length === 0) return <EmptyState title="Cadastre uma pessoa primeiro">A planilha mensal é montada por pessoa e ano.</EmptyState>;

  const go = (p, y) => nav(`${PATHS.budget}/${p}/${y}`);
  const d = sheet.data;

  // Atualiza a célula na tela na hora; o resumo é recarregado em seguida (o servidor é a fonte dos totais).
  const saveCell = async (row, month, value) => {
    sheet.setData((s) => ({ ...s, sections: s.sections.map((sec) => ({ ...sec, rows: sec.rows.map((r) => (r.id === row.id ? { ...r, values: r.values.map((v, i) => (i === month - 1 ? value : v)) } : r)) })) }));
    setLastEdit((l) => ({ ...l, [row.id]: { month, value } }));
    try { await budgetApi.setCell(row.id, month, value); sheet.reload(); } catch (e) { toast.error(e); sheet.reload(); }
  };
  const fill = async (row) => {
    const le = lastEdit[row.id];
    if (!le) return;
    try { await budgetApi.fill(row.id, le.month, le.value); toast.success(`Valor repetido de ${MONTHS_SHORT[le.month - 1]} até Dez`); sheet.reload(); } catch (e) { toast.error(e); }
  };
  const rename = async (row, label) => {
    if (!label.trim() || label === row.label) return;
    try { await budgetApi.updateRow(row.id, { label: label.trim() }); sheet.reload(); } catch (e) { toast.error(e); }
  };
  const removeRow = async (row) => {
    if (!window.confirm(`Remover a linha "${row.label}"?`)) return;
    try { await budgetApi.removeRow(row.id); sheet.reload(); } catch (e) { toast.error(e); }
  };
  const addRow = async (e) => {
    e.preventDefault();
    if (!adding.label.trim()) return;
    try { await budgetApi.addRow(d.sheetId, { section: adding.section, label: adding.label.trim() }); setAdding(null); sheet.reload(); } catch (err) { toast.error(err); }
  };

  const personName = people.data.find((p) => p.id === personId)?.name;
  return (
    <div className="budget-page w-full min-w-0">
      <PageHeader
        title="Planilha mensal"
        subtitle="Receitas, descontos e despesas mês a mês. As linhas de cartão vêm sozinhas dos lançamentos."
        actions={<>
          <Select value={personId || ''} onChange={(v) => go(v, year)} options={people.data.map((p) => ({ value: p.id, label: p.name }))} aria-label="Pessoa" />
          <Select value={year} onChange={(v) => go(personId, v)} options={yearsAround(thisYear).map((y) => ({ value: y, label: y }))} aria-label="Ano" />
        </>}
      />
      {sheet.error && <ErrorState error={sheet.error} onRetry={sheet.reload} />}
      {!d && !sheet.error && <Spinner />}
      {d && (
        <>
          <section className="year-kpis" aria-label={`Resumo de ${personName} em ${year}`}>
            <div><span>Receita do ano</span><strong><Money value={d.summary.yearRevenue} /></strong></div>
            <div><span>Gasto do ano</span><strong><Money value={d.summary.yearSpent} /></strong></div>
            <div><span>Saldo do ano</span><strong><Money value={d.summary.yearBalance} tone={d.summary.yearBalance < 0 ? 'neg' : 'pos'} /></strong></div>
          </section>

          <Card className="sheet-card">
            <div className="table-wrap sheet-scroll">
              <table className="sheet sheet-fluid">
                <thead>
                  <tr><th className="sticky-col">Categoria</th>{MONTHS_SHORT.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Total</th><th className="num">Mín.</th><th className="num">Máx.</th><th /></tr>
                </thead>
                {d.sections.map((sec) => (
                  <tbody key={sec.key}>
                    <tr className="sec-head"><th colSpan={17} className="sticky-col">{sec.label}{sec.computed && <span className="pill">automático</span>}</th></tr>
                    {sec.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="sticky-col">
                          {sec.computed ? r.label : <input className="cell cell-label" defaultValue={r.label} onBlur={(e) => rename(r, e.target.value)} aria-label="Nome da linha" />}
                        </td>
                        {r.values.map((v, i) => (
                          <td key={i} className="num">{sec.computed ? (v ? moneyPlain(v) : '') : <MoneyCell value={v} onSave={(n) => saveCell(r, i + 1, n)} />}</td>
                        ))}
                        <td className="num total">{moneyPlain(r.total)}</td>
                        <td className="num muted">{moneyPlain(r.min)}</td>
                        <td className="num muted">{moneyPlain(r.max)}</td>
                        <td className="row-actions">
                          {!sec.computed && (
                            <>
                              <button className="icon-btn" disabled={!lastEdit[r.id]} onClick={() => fill(r)} title="Repetir o último valor digitado até dezembro" aria-label="Repetir até dezembro">⇥</button>
                              <button className="icon-btn" onClick={() => removeRow(r)} title="Remover linha" aria-label="Remover linha">×</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="sec-total">
                      <td className="sticky-col">
                        {!sec.computed && (adding?.section === sec.key ? (
                          <form onSubmit={addRow} className="add-row"><input className="cell cell-label" autoFocus placeholder="Nome da linha" value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} onBlur={() => !adding.label && setAdding(null)} /></form>
                        ) : (
                          <button className="link-btn" onClick={() => setAdding({ section: sec.key, label: '' })}>+ linha</button>
                        ))}
                        {sec.computed && 'Total'}
                      </td>
                      {sec.totals.map((v, i) => <td key={i} className="num">{v ? moneyPlain(v) : ''}</td>)}
                      <td className="num total">{moneyPlain(sec.totals.reduce((a, b) => a + b, 0))}</td><td /><td /><td />
                    </tr>
                  </tbody>
                ))}
                <tbody className="summary">
                  <tr className="sec-head"><th colSpan={17} className="sticky-col">Resumo geral</th></tr>
                  {d.summary.lines.map((l) => (
                    <tr key={l.key} className={['spent', 'balance'].includes(l.key) ? `strong line-${l.key}` : ''}>
                      <td className="sticky-col">{l.key === 'balance' ? 'Saldo final' : l.key === 'spent' ? 'Gasto final' : l.label}</td>
                      {l.values.map((v, i) => <td key={i} className={`num ${l.key === 'balance' && v < 0 ? 'neg' : ''} ${l.key === 'balance' && v > 0 ? 'pos' : ''}`}>{moneyPlain(v)}</td>)}
                      <td className="num total">{moneyPlain(l.values.reduce((a, b) => a + b, 0))}</td><td /><td /><td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
