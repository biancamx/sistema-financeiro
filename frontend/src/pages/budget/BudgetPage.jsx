import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useFinanceRefresh, notifyFinanceChanged } from '../../hooks/useFinanceRefresh.js';
import { budgetApi, peopleApi, purchasesApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Modal, Money, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { MONTHS, MONTHS_SHORT, moneyPlain, yearsAround } from '../../lib/format.js';
import MoneyCell from '../../components/MoneyCell.jsx';
import { PATHS } from '../../app/paths.js';

export default function BudgetPage() {
  const nav = useNavigate();
  const toast = useToast();
  const params = useParams();
  const people = useFetch(() => peopleApi.list(), []);
  const thisYear = new Date().getFullYear();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [showFullYearMobile, setShowFullYearMobile] = useState(false);
  const personId = params.personId || people.data?.[0]?.id;
  const year = Number(params.year) || thisYear;

  useEffect(() => {
    if (!params.personId && personId) nav(`${PATHS.budget}/${personId}/${year}`, { replace: true });
  }, [params.personId, personId, year, nav]);

  const sheet = useFetch(() => budgetApi.get({ personId, year, month: selectedMonth }), [personId, year, selectedMonth], { enabled: Boolean(personId) });
  useFinanceRefresh(sheet.reload);
  const [lastEdit, setLastEdit] = useState({}); // rowId -> { month, value } para "repetir até dezembro"
  const [adding, setAdding] = useState(null); // { section, label }
  const [monthlySummaryOpen, setMonthlySummaryOpen] = useState(false);

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
  const togglePurchasePaid = async (purchase) => {
    const paid = !purchase.paid;
    sheet.setData((current) => ({
      ...current,
      monthly: {
        ...current.monthly,
        purchases: current.monthly.purchases.map((item) => item.installmentId === purchase.installmentId
          ? { ...item, paid, paidAmount: paid ? item.amount : 0, outstanding: paid ? 0 : item.amount }
          : item),
        paid: Math.round((current.monthly.paid + (paid ? purchase.outstanding : -purchase.paidAmount)) * 100) / 100,
        outstanding: Math.round((current.monthly.outstanding + (paid ? -purchase.outstanding : purchase.paidAmount)) * 100) / 100,
      },
    }));
    try {
      await purchasesApi.setPaid(purchase.installmentId, paid);
      notifyFinanceChanged();
    } catch (error) {
      toast.error(error);
      sheet.reload();
    }
  };
  const saveObservation = async (purchase, observation) => {
    if (observation === purchase.observation) return;
    try {
      await purchasesApi.updateObservation(purchase.purchaseId, observation);
      sheet.setData((current) => ({
        ...current,
        monthly: {
          ...current.monthly,
          purchases: current.monthly.purchases.map((item) => item.purchaseId === purchase.purchaseId ? { ...item, observation } : item),
        },
      }));
      notifyFinanceChanged();
      toast.success('Observação salva');
    } catch (error) {
      toast.error(error);
      sheet.reload();
    }
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
          <Button variant="primary" onClick={() => setMonthlySummaryOpen(true)} disabled={!d}>Resumo do mês</Button>
        </>}
      />
      {sheet.error && <ErrorState error={sheet.error} onRetry={sheet.reload} />}
      {!d && !sheet.error && <Spinner />}
      {d && (
        <>
          <Modal
            open={monthlySummaryOpen}
            title={`Resumo de ${MONTHS[selectedMonth - 1]} · ${personName} · ${year}`}
            wide
            className="monthly-summary-modal"
            footer={<Button variant="ghost" onClick={() => setMonthlySummaryOpen(false)}>Fechar</Button>}
          >
          <section className="monthly-dashboard" aria-label={`Resumo de ${MONTHS[selectedMonth - 1]} de ${year}`}>
            <header className="monthly-dashboard-head">
              <div>
                <p className="muted">Compras e parcelas desta pessoa. Os totais mantêm o critério atual da planilha; o pagamento acompanha cada parcela.</p>
              </div>
              <Select value={selectedMonth} onChange={(v) => setSelectedMonth(Number(v))} options={MONTHS.map((label, index) => ({ value: index + 1, label }))} aria-label="Mês do resumo" />
            </header>
            <div className="monthly-dashboard-kpis">
              <Card><span className="muted">Gasto em cartões</span><strong><Money value={d.monthly.total} /></strong></Card>
              <Card><span className="muted">Pago</span><strong><Money value={d.monthly.paid} tone="pos" /></strong></Card>
              <Card><span className="muted">Em aberto</span><strong><Money value={d.monthly.outstanding} tone={d.monthly.outstanding > 0 ? 'neg' : 'pos'} /></strong></Card>
              <Card><span className="muted">Gastos avulsos</span><strong><Money value={d.monthly.cash.expense} /></strong></Card>
              <Card><span className="muted">Recebimentos avulsos</span><strong><Money value={d.monthly.cash.receipts} tone="pos" /></strong></Card>
            </div>
            <div className="monthly-dashboard-breakdowns">
              <Card title="Gasto por cartão">
                {d.monthly.cards.length ? (
                  <ul className="monthly-bars">
                    {d.monthly.cards.map((card) => (
                      <li key={card.id}>
                        <div><span>{card.name}</span><Money value={card.total} /></div>
                        <span className="monthly-bar-track"><span style={{ width: `${Math.max(2, (card.total / Math.max(...d.monthly.cards.map((item) => item.total), 1)) * 100)}%` }} /></span>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState title="Sem compras no cartão neste mês" />}
              </Card>
              <Card title="Gasto por categoria">
                {d.monthly.categories.length ? (
                  <ul className="monthly-bars">
                    {d.monthly.categories.map((category) => (
                      <li key={category.name}>
                        <div><span>{category.name}</span><Money value={category.total} /></div>
                        <span className="monthly-bar-track"><span style={{ width: `${Math.max(2, (category.total / Math.max(...d.monthly.categories.map((item) => item.total), 1)) * 100)}%` }} /></span>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState title="Sem categorias neste mês" />}
              </Card>
            </div>
            <Card title={`Compras e parcelas · ${MONTHS[selectedMonth - 1]}`}>
              {d.monthly.purchases.length ? (
                <div className="table-responsive">
                  <table className="table monthly-purchases">
                    <thead><tr><th>Pago</th><th>Compra</th><th>Categoria</th><th>Cartão</th><th>Parcela</th><th className="num">Valor</th><th className="num">Em aberto</th><th>Observação da compra</th></tr></thead>
                    <tbody>
                      {d.monthly.purchases.map((purchase) => (
                        <tr key={purchase.installmentId} className={purchase.paid ? 'row-dim' : ''}>
                          <td><input type="checkbox" checked={purchase.paid} onChange={() => togglePurchasePaid(purchase)} aria-label={`Marcar parcela ${purchase.number} de ${purchase.description} como paga`} /></td>
                          <td>{purchase.description}{purchase.sharedGroup && <span className="tag">Compartilhada</span>}</td>
                          <td>{purchase.category || 'Sem categoria'}</td>
                          <td>{purchase.card}</td>
                          <td>{purchase.number}/{purchase.count}</td>
                          <td className="num"><Money value={purchase.amount} /></td>
                          <td className="num"><Money value={purchase.outstanding} /></td>
                          <td><input className="input monthly-observation" maxLength={1000} defaultValue={purchase.observation} key={`${purchase.purchaseId}-${purchase.observation}`} placeholder="Adicionar observação" aria-label={`Observação de ${purchase.description}`} onBlur={(event) => saveObservation(purchase, event.target.value)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState title="Nenhuma compra neste mês">Cadastre uma compra em Lançamentos ou escolha outro mês.</EmptyState>}
            </Card>
          </section>
            </Modal>

            <section className="year-kpis" aria-label={`Resumo de ${personName} em ${year}`}>
            <div><span>Receita do ano</span><strong><Money value={d.summary.yearRevenue} /></strong></div>
            <div><span>Gasto do ano</span><strong><Money value={d.summary.yearSpent} /></strong></div>
            <div><span>Saldo do ano</span><strong><Money value={d.summary.yearBalance} tone={d.summary.yearBalance < 0 ? 'neg' : 'pos'} /></strong></div>
          </section>

          <Card className="sheet-card">
            <div className="budget-month-controls">
              <div className="budget-month-controls-heading">
                <span>VISUALIZAÇÃO MENSAL</span>
                <strong>{year}</strong>
              </div>
              <div className="budget-month-picker" role="group" aria-label="Mês da planilha">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setSelectedMonth((month) => Math.max(1, month - 1))}
                  disabled={selectedMonth <= 1}
                  aria-label="Mês anterior"
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <Select
                  value={selectedMonth}
                  onChange={(month) => setSelectedMonth(Number(month))}
                  options={MONTHS.map((label, index) => ({ value: index + 1, label }))}
                  aria-label="Selecionar mês da planilha"
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setSelectedMonth((month) => Math.min(12, month + 1))}
                  disabled={selectedMonth >= 12}
                  aria-label="Próximo mês"
                >
                  <span aria-hidden="true">›</span>
                </button>
              </div>
              <button
                type="button"
                className="btn btn-ghost budget-full-year-toggle"
                aria-expanded={showFullYearMobile}
                onClick={() => setShowFullYearMobile((shown) => !shown)}
              >
                {showFullYearMobile ? 'Voltar à visualização mensal' : '📊 Ver todos os 12 meses lado a lado'}
              </button>
            </div>

            <div className={`budget-month-table${showFullYearMobile ? ' is-hidden' : ''}`}>
              <table className="sheet budget-month-view">
                <thead>
                  <tr><th>Categoria</th><th className="num">{MONTHS_SHORT[selectedMonth - 1]}</th></tr>
                </thead>
                {d.sections.map((sec) => (
                  <tbody key={sec.key}>
                    <tr className="sec-head"><th colSpan={2}>{sec.label}{sec.computed && <span className="pill">automático</span>}</th></tr>
                    {sec.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="budget-month-label">
                          {sec.computed
                            ? r.label
                            : <input className="cell cell-label" defaultValue={r.label} title={r.label} onBlur={(e) => rename(r, e.target.value)} aria-label="Nome da linha" />}
                          {!sec.computed && (
                            <span className="budget-month-row-actions">
                              <button className="icon-btn" disabled={!lastEdit[r.id]} onClick={() => fill(r)} title="Repetir o último valor digitado até dezembro" aria-label="Repetir até dezembro">⇥</button>
                              <button className="icon-btn" onClick={() => removeRow(r)} title="Remover linha" aria-label="Remover linha">×</button>
                            </span>
                          )}
                        </td>
                        <td className={`num ${r.values[selectedMonth - 1] < 0 ? 'neg' : ''}`}>
                          {sec.computed
                            ? (r.values[selectedMonth - 1] ? moneyPlain(r.values[selectedMonth - 1]) : '')
                            : <MoneyCell value={r.values[selectedMonth - 1]} onSave={(value) => saveCell(r, selectedMonth, value)} />}
                        </td>
                      </tr>
                    ))}
                    <tr className="sec-total">
                      <td className="budget-month-label">
                        {!sec.computed && (adding?.section === sec.key ? (
                          <form onSubmit={addRow} className="add-row"><input className="cell cell-label" autoFocus placeholder="Nome da linha" value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} onBlur={() => !adding.label && setAdding(null)} /></form>
                        ) : (
                          <button className="link-btn" onClick={() => setAdding({ section: sec.key, label: '' })}>+ linha</button>
                        ))}
                        {sec.computed && 'Total'}
                      </td>
                      <td className="num total">{moneyPlain(sec.totals[selectedMonth - 1])}</td>
                    </tr>
                  </tbody>
                ))}
                <tbody className="summary">
                  <tr className="sec-head"><th colSpan={2}>Resumo geral</th></tr>
                  {d.summary.lines.map((line) => (
                    <tr key={line.key} className={['spent', 'balance'].includes(line.key) ? `strong line-${line.key}` : ''}>
                      <td>{line.key === 'balance' ? 'Saldo final' : line.key === 'spent' ? 'Gasto final' : line.label}</td>
                      <td className={`num ${line.key === 'balance' && line.values[selectedMonth - 1] < 0 ? 'neg' : ''} ${line.key === 'balance' && line.values[selectedMonth - 1] > 0 ? 'pos' : ''}`}>
                        {moneyPlain(line.values[selectedMonth - 1])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className={`sheet-scroll-hint budget-full-year-hint${showFullYearMobile ? ' is-visible' : ''}`}>Deslize a planilha para os lados para ver todos os meses e valores.</p>
            <div className={`table-wrap sheet-scroll budget-full-year-table${showFullYearMobile ? ' is-visible' : ''}`}>
              <table className="sheet sheet-fluid">
                <colgroup>
                  <col className="sheet-label-column" />
                  {MONTHS_SHORT.map((month) => <col key={month} className="sheet-month-column" />)}
                  <col className="sheet-total-column" />
                  <col className="sheet-total-column" />
                  <col className="sheet-total-column" />
                  <col className="sheet-actions-column" />
                </colgroup>
                <thead>
                  <tr><th className="sticky-col">Categoria</th>{MONTHS_SHORT.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Total</th><th className="num">Mín.</th><th className="num">Máx.</th><th /></tr>
                </thead>
                {d.sections.map((sec) => (
                  <tbody key={sec.key}>
                    <tr className="sec-head"><th colSpan={17} className="sticky-col">{sec.label}{sec.computed && <span className="pill">automático</span>}</th></tr>
                    {sec.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="sticky-col">
                          {sec.computed ? r.label : <input className="cell cell-label" defaultValue={r.label} title={r.label} onBlur={(e) => rename(r, e.target.value)} aria-label="Nome da linha" />}
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
