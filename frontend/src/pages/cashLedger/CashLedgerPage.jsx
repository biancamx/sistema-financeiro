import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, Download, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useFinanceRefresh, notifyFinanceChanged } from '../../hooks/useFinanceRefresh.js';
import { useLookups } from '../../hooks/useLookups.js';
import { cashLedgerApi, vehiclesApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Field, Modal, Money, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { dateTimeLabel, money, parseMoney } from '../../lib/format.js';
import CashEntryForm, { cashEntryToForm, emptyCashEntry } from './CashEntryForm.jsx';

const kindLabels = { expense: 'Compra avulsa', sale: 'Venda', loan: 'Empréstimo', refund: 'Reembolso' };
const statusLabels = { pending: 'Pendente', partial: 'Parcial', received: 'Recebida', overdue: 'Atrasada', denied: 'Recusado', expense: 'Saída' };
const refundLabels = { requested: 'Solicitado', in_review: 'Em análise', received: 'Recebido', denied: 'Recusado' };
const methodLabels = { cash: 'Dinheiro', pix: 'Pix', debit: 'Débito', transfer: 'Transferência' };
const dateLabel = (date) => date ? new Date(`${date}T00:00:00`).toLocaleDateString('pt-BR') : 'Sem prazo';
const today = () => new Date().toISOString().slice(0, 10);

export default function CashLedgerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = usePeriod();
  const toast = useToast();
  const lookups = useLookups();
  const vehicles = useFetch(() => vehiclesApi.list(), []);
  const [tab, setTab] = useState(() => searchParams.size ? 'all' : 'month');
  const [extraFiltersOpen, setExtraFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(() => ({
    search: searchParams.get('search') || '',
    personId: searchParams.get('personId') || '',
    kind: searchParams.get('kind') || '',
    status: searchParams.get('status') || '',
    paymentMethod: '',
    categoryId: '',
  }));
  const [form, setForm] = useState(null);
  const [details, setDetails] = useState(null);
  const [receiveItem, setReceiveItem] = useState(null);
  const [receiveAmount, setReceiveAmount] = useState('');
  const [receiveDate, setReceiveDate] = useState(today());
  const [receiveMethod, setReceiveMethod] = useState('pix');
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const [personId, setPersonId] = useState(() => searchParams.get('personId') || null);
  const appliedDashboardQuery = useRef(false);

  const list = useFetch(() => cashLedgerApi.list({
    month: period.month,
    year: period.year,
    all: tab === 'all',
    search: filters.search || undefined,
    personId: filters.personId || undefined,
    kind: filters.kind || undefined,
    status: filters.status || undefined,
    paymentMethod: filters.paymentMethod || undefined,
    categoryId: filters.categoryId || undefined,
  }), [period.month, period.year, tab, filters.search, filters.personId, filters.kind, filters.status, filters.paymentMethod, filters.categoryId]);
  const summary = useFetch(() => cashLedgerApi.summary({ month: period.month, year: period.year }), [period.month, period.year]);
  const personSummary = useFetch(() => cashLedgerApi.personSummary(personId), [personId], { enabled: Boolean(personId) });
  useFinanceRefresh(() => {
    list.reload();
    summary.reload();
    if (personId) personSummary.reload();
  });

  useEffect(() => {
    const visible = new Set(list.data?.data.map((row) => row.installmentId).filter(Boolean) ?? []);
    setSelected((current) => current.filter((id) => visible.has(id)));
  }, [list.data]);

  const mutate = async (action, successText) => {
    setSaving(true);
    try {
      await action();
      notifyFinanceChanged();
      toast.success(successText);
      list.reload();
      summary.reload();
      if (personId) personSummary.reload();
      setDetails((current) => current ? null : current);
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveEntry = async (body) => {
    const editing = Boolean(form.id);
    const success = await mutate(
      () => editing ? cashLedgerApi.update(form.id, body) : cashLedgerApi.create(body),
      editing ? 'Registro atualizado' : 'Registro criado',
    );
    if (success) setForm(null);
  };

  const openDetails = async (entryId) => {
    try {
      setDetails(await cashLedgerApi.get(entryId));
    } catch (error) {
      toast.error(error);
    }
  };

  useEffect(() => {
    if (appliedDashboardQuery.current || !searchParams.size) return;
    appliedDashboardQuery.current = true;
    if (searchParams.get('new') === '1') setForm(emptyCashEntry());
    const entryId = searchParams.get('entryId');
    if (entryId) openDetails(entryId);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const openEdit = async (entryId) => {
    try {
      const result = await cashLedgerApi.get(entryId);
      setForm(cashEntryToForm(result.entry));
      setDetails(null);
    } catch (error) {
      toast.error(error);
    }
  };

  const removeEntry = async (row) => {
    try {
      const record = await cashLedgerApi.get(row.id);
      const hasReceipts = record.receipts.length > 0;
      const message = hasReceipts
        ? `Este registro tem ${record.receipts.length} recebimento(s). Excluir o registro e todo o histórico?`
        : `Excluir "${row.description}"?`;
      if (!window.confirm(message)) return;
      const success = await mutate(() => cashLedgerApi.remove(row.id, hasReceipts), 'Registro excluído');
      if (success) setDetails(null);
    } catch (error) {
      toast.error(error);
    }
  };

  const openReceive = (row) => {
    setReceiveItem(row);
    setReceiveAmount(String(row.outstanding).replace('.', ','));
    setReceiveDate(today());
    setReceiveMethod('pix');
  };

  const receive = async () => {
    const amountValue = parseMoney(receiveAmount);
    const ok = await mutate(
      () => cashLedgerApi.receive(receiveItem.installmentId, { amount: amountValue, receivedOn: receiveDate, paymentMethod: receiveMethod }),
      'Recebimento registrado',
    );
    if (ok) setReceiveItem(null);
  };

  const receiveSelected = async () => {
    if (!selected.length || saving) return;
    const rows = list.data?.data.filter((row) => selected.includes(row.installmentId) && row.outstanding > 0) ?? [];
    if (!rows.length) return;
    if (!window.confirm(`Registrar o recebimento integral de ${rows.length} parcela(s) selecionada(s)?`)) return;
    const result = await mutate(
      async () => {
        await cashLedgerApi.receiveMany(rows.map((row) => row.installmentId), { receivedOn: today(), paymentMethod: 'pix' });
        setSelected([]);
      },
      'Parcelas recebidas',
    );
    return result;
  };

  const undoReceipt = async (receipt) => {
    if (!window.confirm(`Desfazer o recebimento de ${money(receipt.amount)} registrado em ${dateLabel(receipt.receivedOn)}?`)) return;
    const ok = await mutate(() => cashLedgerApi.undoReceipt(receipt.id), 'Recebimento desfeito');
    if (ok && details?.entry) openDetails(details.entry.id);
  };

  const changeRefundStatus = async (entryId, status) => {
    const ok = await mutate(() => cashLedgerApi.setRefundStatus(entryId, status), 'Status do reembolso atualizado');
    if (ok) openDetails(entryId);
  };

  const setFilter = (key) => (value) => setFilters((current) => ({ ...current, [key]: value }));
  const rows = list.data?.data ?? [];
  const overdueCount = summary.data?.overdueCount ?? 0;
  const selectedRows = rows.filter((row) => selected.includes(row.installmentId));
  const allSelectable = rows.filter((row) => row.installmentId && row.outstanding > 0);
  const allSelected = allSelectable.length > 0 && allSelectable.every((row) => selected.includes(row.installmentId));
  const extraFilterCount = [filters.status, filters.paymentMethod, filters.categoryId].filter(Boolean).length;

  const toggleAll = () => setSelected((current) => {
    if (allSelected) return current.filter((id) => !allSelectable.some((row) => row.installmentId === id));
    return [...new Set([...current, ...allSelectable.map((row) => row.installmentId)])];
  });
  const toggleOne = (id) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  if (lookups.error) return <ErrorState error={lookups.error} onRetry={lookups.reload} />;

  return (
    <div className="cash-page">
      <PageHeader
        title="Avulsos"
        subtitle={<span className="cash-page-subtitle">Entradas e saídas fora dos cartões de crédito</span>}
        actions={<>
          <a className="btn btn-ghost cash-export" href={cashLedgerApi.exportUrl()} aria-label="Exportar CSV">
            <Download size={16} aria-hidden="true" /><span>Exportar CSV</span>
          </a>
          <Button className="cash-new" variant="primary" onClick={() => setForm(emptyCashEntry())}>
            <Plus size={17} aria-hidden="true" /> Novo registro
          </Button>
        </>}
      />

      <section className="cash-kpis" aria-label={`Resumo de ${period.month}/${period.year}`}>
        <Card><span className="muted">Gastei no mês</span><strong><Money value={summary.data?.spent ?? 0} /></strong></Card>
        <Card><span className="muted">A receber no mês</span><strong><Money value={summary.data?.receivable ?? 0} tone="warn" /></strong></Card>
        <Card><span className="muted">Recebido no mês</span><strong><Money value={summary.data?.received ?? 0} tone="pos" /></strong></Card>
        <Card><span className="muted">Total a receber</span><strong><Money value={summary.data?.totalReceivable ?? 0} tone="warn" /></strong></Card>
        <Card><span className="muted">Em atraso · {overdueCount} parcela(s)</span><strong><Money value={summary.data?.overdue ?? 0} tone="neg" /></strong></Card>
      </section>

      <div className="toolbar cash-toolbar">
        <div className="tabs" role="tablist" aria-label="Período dos registros">
          <button role="tab" aria-selected={tab === 'month'} className={tab === 'month' ? 'on' : ''} onClick={() => setTab('month')}>Do mês</button>
          <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>Todos os registros</button>
        </div>
        <div className="cash-period">
          <button className="icon-btn" onClick={() => period.shift(-1)} aria-label="Mês anterior">‹</button>
          <strong>{new Date(period.year, period.month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong>
          <button className="icon-btn" onClick={() => period.shift(1)} aria-label="Próximo mês">›</button>
        </div>
        <div className="filters cash-filters">
          <input className="input" type="search" placeholder="Buscar descrição ou pessoa…" value={filters.search} onChange={(event) => setFilter('search')(event.target.value)} aria-label="Buscar" />
          <Select value={filters.personId} onChange={setFilter('personId')} placeholder="Todas as pessoas" options={lookups.people.map((person) => ({ value: person.id, label: person.name }))} aria-label="Pessoa" />
          <Select value={filters.kind} onChange={setFilter('kind')} placeholder="Todos os tipos" options={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))} aria-label="Tipo" />
          <button
            type="button"
            className="cash-filter-toggle"
            aria-expanded={extraFiltersOpen}
            aria-controls="cash-extra-filters"
            onClick={() => setExtraFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span>Mais filtros{extraFilterCount ? ` (${extraFilterCount})` : ''}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <div id="cash-extra-filters" className={`cash-extra-filters${extraFiltersOpen ? ' is-open' : ''}`}>
            <Select value={filters.status} onChange={setFilter('status')} placeholder="Todos os status" options={[
              { value: 'pendente', label: 'Pendente / parcial' }, { value: 'atrasada', label: 'Atrasada' }, { value: 'recebida', label: 'Recebida' }, { value: 'quitado', label: 'Quitado' },
            ]} aria-label="Status" />
            <Select value={filters.paymentMethod} onChange={setFilter('paymentMethod')} placeholder="Todas as formas" options={Object.entries(methodLabels).map(([value, label]) => ({ value, label }))} aria-label="Forma de pagamento" />
            <Select value={filters.categoryId} onChange={setFilter('categoryId')} placeholder="Todas as categorias" options={lookups.categories.map((category) => ({ value: category.id, label: category.name }))} aria-label="Categoria" />
          </div>
        </div>
      </div>

      {personSummary.data && (
        <Card className="cash-person-summary" title={`Valores de ${personSummary.data.person.name} a receber`}>
          <div className="cash-person-totals">
            <span>Total previsto <Money value={personSummary.data.total} /></span>
            <span>Já recebeu <Money value={personSummary.data.received} tone="pos" /></span>
            <span>Falta receber <Money value={personSummary.data.outstanding} tone="warn" /></span>
          </div>
          <p className="muted">{personSummary.data.upcoming.length} próxima(s) · {personSummary.data.overdue.length} atrasada(s)</p>
          <Button size="sm" variant="ghost" onClick={() => { setPersonId(null); setFilters((current) => ({ ...current, personId: '' })); }}>Limpar visão por pessoa</Button>
        </Card>
      )}

      {selectedRows.length > 0 && (
        <div className="cash-bulk-actions">
          <span>{selectedRows.length} parcela(s) selecionada(s)</span>
          <Button variant="primary" onClick={receiveSelected} disabled={saving}>Receber selecionadas (Pix)</Button>
        </div>
      )}

      <Card className="cash-table-card">
        {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
        {!list.data && !list.error && <Spinner />}
        {list.data && rows.length === 0 && <EmptyState title="Nenhum registro neste período">Cadastre uma compra avulsa, venda, empréstimo ou reembolso.</EmptyState>}
        {rows.length > 0 && (
          <>
          <div className="table-responsive responsive-desktop-table">
            <table className="table cash-table">
              <thead><tr>
                <th><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar parcelas recebíveis" /></th>
                <th>Tipo</th><th>Descrição</th><th>Pessoa</th><th>Data</th><th>Vencimento</th><th>Parcela</th>
                <th className="num">Valor</th><th>Status</th><th>Ações</th>
              </tr></thead>
              <tbody>
                {rows.map((row, index) => {
                  const selectable = Boolean(row.installmentId && row.outstanding > 0);
                  const person = row.person || row.counterparty;
                  return (
                    <tr key={`${row.id}-${row.installmentId ?? 'expense'}-${index}`} className={`cash-row cash-row-${row.status}`}>
                      <td>{selectable && <input type="checkbox" checked={selected.includes(row.installmentId)} onChange={() => toggleOne(row.installmentId)} aria-label={`Selecionar ${row.description} ${row.number}/${row.count}`} />}</td>
                      <td>{kindLabels[row.kind]}</td>
                      <td><button className="link-btn cash-description" onClick={() => openDetails(row.id)}>{row.description}</button>{row.category && <small className="muted cash-subline">{row.category}</small>}<small className="muted cash-subline">Registrado: {dateTimeLabel(row.createdAt)}</small></td>
                      <td>{row.personId ? <button className="link-btn" onClick={() => { setPersonId(row.personId); setFilters((current) => ({ ...current, personId: String(row.personId) })); }}>{person}</button> : person || '—'}</td>
                      <td>{dateLabel(row.entryDate)}</td><td>{dateLabel(row.dueDate)}</td>
                      <td>{row.number ? `${row.number}/${row.count}` : '—'}</td>
                      <td className="num"><Money value={row.amount} /></td>
                      <td><span className={`cash-status cash-status-${row.status}`}>{row.kind === 'refund' ? refundLabels[row.refundStatus] || statusLabels[row.status] : statusLabels[row.status]}</span></td>
                      <td className="cash-row-actions">
                        <div className="cash-action-group">
                          <Button className="cash-icon-action" variant="ghost" title="Editar" aria-label={`Editar ${row.description}`} onClick={() => openEdit(row.id)}>
                            <Pencil size={16} aria-hidden="true" />
                          </Button>
                          <Button className="cash-icon-action is-destructive" variant="ghost" title="Excluir" aria-label={`Excluir ${row.description}`} onClick={() => removeEntry(row)}>
                            <Trash2 size={16} aria-hidden="true" />
                          </Button>
                        </div>
                        {selectable && <Button size="sm" variant="primary" onClick={() => openReceive(row)}>Receber</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mobile-card-list">
            {rows.map((row, index) => {
              const selectable = Boolean(row.installmentId && row.outstanding > 0);
              const person = row.person || row.counterparty;
              const status = row.kind === 'refund' ? refundLabels[row.refundStatus] || statusLabels[row.status] : statusLabels[row.status];
              const incoming = row.kind !== 'expense';
              return (
                <article key={`${row.id}-${row.installmentId ?? 'expense'}-${index}`} className={`mobile-record-card cash-mobile-card cash-mobile-card-${row.status}`}>
                  <div className="mobile-record-heading">
                    <div className="mobile-record-title">
                      <span className={`cash-kind-badge cash-kind-${row.kind}`}>{kindLabels[row.kind]}</span>
                      <span className="cash-kind-badge">{methodLabels[row.paymentMethod] || 'Forma não informada'}</span>
                    </div>
                    <span className={`cash-status cash-status-${row.status}`}>{status}</span>
                  </div>
                  <button className="link-btn cash-description" onClick={() => openDetails(row.id)}>{row.description}</button>
                  {row.category && <span className="tag tag-flush">{row.category}</span>}
                  <p className="muted small">
                    Data: {dateLabel(row.entryDate)}
                    {row.dueDate && row.dueDate !== row.entryDate && <> · Vencimento: {dateLabel(row.dueDate)}</>}
                    {row.number && <> · Parcela {row.number}/{row.count}</>}
                  </p>
                  <div className="cash-mobile-summary">
                    <strong className={incoming ? 'cash-mobile-amount-incoming' : 'cash-mobile-amount-outgoing'}><Money value={row.amount} /></strong>
                    <span>{person || 'Pessoa não informada'}</span>
                  </div>
                  <div className="mobile-record-actions">
                    {selectable && (
                      <label className="mobile-record-check">
                        <input type="checkbox" checked={selected.includes(row.installmentId)} onChange={() => toggleOne(row.installmentId)} aria-label={`Selecionar ${row.description} ${row.number}/${row.count}`} />
                        Selecionar
                      </label>
                    )}
                    {selectable && <Button size="sm" variant="primary" onClick={() => openReceive(row)}>Receber</Button>}
                    <div className="cash-action-group">
                      <Button className="cash-icon-action" variant="ghost" title="Editar" aria-label={`Editar ${row.description}`} onClick={() => openEdit(row.id)}>
                        <Pencil size={16} aria-hidden="true" />
                      </Button>
                      <Button className="cash-icon-action is-destructive" variant="ghost" title="Excluir" aria-label={`Excluir ${row.description}`} onClick={() => removeEntry(row)}>
                        <Trash2 size={16} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          </>
        )}
      </Card>

      {form && <CashEntryForm value={form} onClose={() => setForm(null)} onSubmit={saveEntry} lookups={{ ...lookups, vehicles: vehicles.data ?? [] }} />}

      {receiveItem && (
        <Modal open title={`Receber · ${receiveItem.description}`}
          footer={<><Button variant="ghost" onClick={() => setReceiveItem(null)}>Cancelar</Button><Button variant="primary" disabled={saving} onClick={receive}>Confirmar recebimento</Button></>}>
          <div className="form-grid">
            <Field label={`Valor (saldo: ${money(receiveItem.outstanding)})`}>{(id) => <input id={id} className="input" inputMode="decimal" value={receiveAmount} onChange={(event) => setReceiveAmount(event.target.value)} />}</Field>
            <Field label="Data do recebimento">{(id) => <input id={id} className="input" type="date" value={receiveDate} onChange={(event) => setReceiveDate(event.target.value)} />}</Field>
            <Field label="Forma de recebimento">{(id) => <Select id={id} value={receiveMethod} onChange={setReceiveMethod} options={Object.entries(methodLabels).map(([value, label]) => ({ value, label }))} />}</Field>
          </div>
        </Modal>
      )}

      {details && (
        <Modal open title={details.entry?.description ?? 'Detalhe do registro'} wide
          footer={<><Button variant="ghost" onClick={() => setDetails(null)}>Fechar</Button><Button onClick={() => openEdit(details.entry.id)}>Editar registro</Button></>}>
          {details.entry && <>
            <div className="cash-detail-grid">
              <div><span className="muted">Tipo</span><strong>{kindLabels[details.entry.kind]}</strong></div>
              <div><span className="muted">Valor</span><strong><Money value={details.entry.total} /></strong></div>
              {details.entry.kind !== 'expense' && <>
                <div><span className="muted">Total previsto</span><strong><Money value={details.entry.totalScheduled} /></strong></div>
                <div><span className="muted">Saldo a receber</span><strong><Money value={details.entry.balance} tone={details.entry.balance ? 'warn' : 'pos'} /></strong></div>
                <div><span className="muted">Status do registro</span><strong>{statusLabels[details.entry.entryStatus] === 'Recebida' ? 'Quitado' : statusLabels[details.entry.entryStatus]}</strong></div>
              </>}
              <div><span className="muted">Pessoa / empresa</span><strong>{details.entry.person || details.entry.counterparty || '—'}</strong></div>
              <div><span className="muted">Data</span><strong>{dateLabel(details.entry.entryDate)}</strong></div>
              <div><span className="muted">Registrado em</span><strong>{dateTimeLabel(details.entry.createdAt)}</strong></div>
              <div><span className="muted">Última atualização</span><strong>{dateTimeLabel(details.entry.updatedAt)}</strong></div>
              {details.entry.category && <div><span className="muted">Categoria</span><strong>{details.entry.category}</strong></div>}
              {details.entry.paymentMethod && <div><span className="muted">Forma</span><strong>{methodLabels[details.entry.paymentMethod]}</strong></div>}
              {details.entry.expectedReturnDate && <div><span className="muted">Previsão de devolução</span><strong>{dateLabel(details.entry.expectedReturnDate)}</strong></div>}
              {details.entry.vehicleName && <div><span className="muted">Veículo vendido</span><strong>{details.entry.vehicleName}</strong></div>}
              {details.entry.interestRate > 0 && <div><span className="muted">Juros simples</span><strong>{details.entry.interestRate}% ao mês</strong></div>}
              {details.entry.kind === 'refund' && <Field label="Status do reembolso">{(id) => <Select id={id} value={details.entry.refundStatus} onChange={(status) => changeRefundStatus(details.entry.id, status)} options={Object.entries(refundLabels).map(([value, label]) => ({ value, label }))} />}</Field>}
              {details.entry.protocol && <div><span className="muted">Protocolo</span><strong>{details.entry.protocol}</strong></div>}
              {details.entry.notes && <div className="cash-detail-notes"><span className="muted">Observação</span><p>{details.entry.notes}</p></div>}
            </div>
            <h3>Parcelas</h3>
            {details.installments.length === 0 ? <p className="muted">Esta saída foi registrada à vista e não possui parcelas a receber.</p> : (
              <div className="table-responsive"><table className="table">
                <thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Recebido</th><th>Saldo</th><th>Status</th><th /></tr></thead>
                <tbody>{details.installments.map((item) => <tr key={item.installmentId}>
                  <td>{item.number}/{item.count}</td><td>{dateLabel(item.dueDate)}</td><td><Money value={item.amount} /></td><td><Money value={item.received} tone="pos" /></td><td><Money value={item.outstanding} tone={item.outstanding ? 'warn' : 'pos'} /></td>
                  <td><span className={`cash-status cash-status-${item.status}`}>{statusLabels[item.status]}</span></td>
                  <td>{item.outstanding > 0 && <Button size="sm" variant="primary" onClick={() => { setDetails(null); openReceive(item); }}>Receber</Button>}</td>
                </tr>)}</tbody>
              </table></div>
            )}
            <h3>Histórico de recebimentos</h3>
            {details.receipts.length === 0 ? <p className="muted">Nenhum recebimento registrado.</p> : (
              <ul className="cash-receipt-history">{details.receipts.map((receipt) => <li key={receipt.id}>
                <span>{dateLabel(receipt.receivedOn)} · parcela {details.installments.find((item) => item.installmentId === receipt.installmentId)?.number ?? '—'} · {methodLabels[receipt.paymentMethod]}<small className="muted cash-subline">Registrado: {dateTimeLabel(receipt.createdAt)}</small></span>
                <Money value={receipt.amount} tone="pos" />
                <Button size="sm" variant="ghost" onClick={() => undoReceipt(receipt)}>Desfazer</Button>
              </li>)}</ul>
            )}
          </>}
        </Modal>
      )}
    </div>
  );
}
