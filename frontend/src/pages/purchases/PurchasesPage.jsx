import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, ChevronDown, CreditCard, Download, Info, Pencil, Plus, RotateCcw, SlidersHorizontal, Trash2, Users, Zap } from 'lucide-react';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { notifyFinanceChanged } from '../../hooks/useFinanceRefresh.js';
import { useDebounced } from '../../hooks/useDebounced.js';
import { useLookups } from '../../hooks/useLookups.js';
import { purchasesApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Money, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { dateTimeLabel, MONTHS_SHORT, monthLabel } from '../../lib/format.js';
import PurchaseForm, { emptyPurchase, toForm, toSharedForm } from './PurchaseForm.jsx';

const boundBulkMenus = new WeakSet();

function syncBulkMenuExpanded(event) {
  const menu = event.currentTarget;
  const trigger = menu.parentElement?.querySelector('.purchase-bulk-trigger');
  const isOpen = menu.matches(':popover-open');
  trigger?.setAttribute('aria-expanded', String(isOpen));
  if (!isOpen || !trigger) {
    menu.style.removeProperty('top');
    menu.style.removeProperty('left');
    return;
  }
  const anchor = trigger.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  const below = anchor.bottom + 6;
  const top = below + height <= window.innerHeight - 8 || anchor.top - height - 6 < 8
    ? below
    : anchor.top - bounds.height - 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function bindBulkMenu(menu) {
  if (!menu || boundBulkMenus.has(menu)) return;
  boundBulkMenus.add(menu);
  menu.addEventListener('toggle', syncBulkMenuExpanded);
}

function handleBulkMenuTriggerKeyDown(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const menu = event.currentTarget.parentElement?.querySelector('.purchase-bulk-menu');
  if (!menu) return;
  if (!menu.matches(':popover-open')) menu.showPopover();
  event.currentTarget.setAttribute('aria-expanded', 'true');
  const items = menu.querySelectorAll('[role="menuitem"]:not(:disabled)');
  items[event.key === 'ArrowDown' ? 0 : items.length - 1]?.focus();
}

function handleBulkMenuKeyDown(event) {
  const menu = event.currentTarget;
  const trigger = menu.parentElement?.querySelector('.purchase-bulk-trigger');
  if (event.key === 'Escape') {
    event.preventDefault();
    menu.hidePopover();
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.focus();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
  const items = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
  if (!items.length) return;
  event.preventDefault();
  const currentIndex = items.indexOf(event.target.closest('[role="menuitem"]'));
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? items.length - 1
      : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[nextIndex]?.focus();
}

function closeBulkMenu(event) {
  const menu = event.currentTarget.closest('.purchase-bulk-dropdown')?.querySelector('.purchase-bulk-menu');
  if (menu?.matches(':popover-open')) menu.hidePopover();
}

export default function PurchasesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const newActionHandled = useRef(false);
  const period = usePeriod();
  const toast = useToast();
  const lookups = useLookups();
  const [tab, setTab] = useState('month');
  const [subscriptionStatus, setSubscriptionStatusFilter] = useState('active');
  const [filters, setFilters] = useState({ personId: '', cardId: '', categoryId: '', search: '' });
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(null);
  const [selectedInstallments, setSelectedInstallments] = useState([]);
  const [payingAll, setPayingAll] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false);
  const search = useDebounced(filters.search);
  const q = { personId: filters.personId, cardId: filters.cardId, categoryId: filters.categoryId, search };
  const setF = (k) => (v) => { setFilters((f) => ({ ...f, [k]: v?.target ? v.target.value : v })); setPage(1); };

  const month = useFetch(() => purchasesApi.installments({ ...q, month: period.month, year: period.year, pageSize: 200 }), [tab, period.month, period.year, q.personId, q.cardId, q.categoryId, search], { enabled: tab === 'month' });
  const all = useFetch(() => purchasesApi.list({ ...q, page, pageSize: 30 }), [tab, page, q.personId, q.cardId, q.categoryId, search], { enabled: tab === 'all' });
  const subscriptions = useFetch(
    () => purchasesApi.subscriptions({ ...q, status: subscriptionStatus }),
    [tab, q.personId, q.cardId, q.categoryId, search, subscriptionStatus],
    { enabled: tab === 'subscriptions' },
  );
  const active = tab === 'month' ? month : tab === 'all' ? all : subscriptions;
  const reload = () => active.reload();
  const monthRows = month.data?.data ?? [];
  const unpaidRows = monthRows.filter((row) => !row.paid);
  const paidRows = monthRows.filter((row) => row.paid);
  const selectedUnpaidRows = unpaidRows.filter((row) => selectedInstallments.includes(row.id));
  const selectedPaidRows = paidRows.filter((row) => selectedInstallments.includes(row.id));
  const allUnpaidSelected = unpaidRows.length > 0 && selectedUnpaidRows.length === unpaidRows.length;
  const allPaidSelected = paidRows.length > 0 && selectedPaidRows.length === paidRows.length;

  useEffect(() => {
    const visibleIds = new Set(month.data?.data.map((row) => row.id) ?? []);
    setSelectedInstallments((ids) => ids.filter((id) => visibleIds.has(id)));
  }, [month.data]);

  useEffect(() => {
    if (newActionHandled.current || searchParams.get('new') !== '1' || !lookups.ready) return;
    newActionHandled.current = true;
    setForm(emptyPurchase(period));
    setSearchParams({}, { replace: true });
  }, [lookups.ready, period.month, period.year, searchParams, setSearchParams]);

  // compra compartilhada: edita o grupo inteiro (todos os participantes de uma vez)
  const openEdit = async (purchaseId, group) => {
    try { setForm(group ? toSharedForm(await purchasesApi.getShared(group)) : toForm(await purchasesApi.get(purchaseId))); } catch (e) { toast.error(e); }
  };
  const submit = async (body) => {
    try {
      const editing = Boolean(form.id || form.group);
      const shared = Boolean(form.group || body.participants);
      if (shared) await (form.group ? purchasesApi.updateShared(form.group, body) : purchasesApi.createShared(body));
      else if (form.id) await purchasesApi.update(form.id, body);
      else await purchasesApi.create(body);
      notifyFinanceChanged();
      toast.success(editing ? 'Compra atualizada' : 'Compra registrada');
      setForm(null);
      reload();
    } catch (e) { toast.error(e); }
  };
  const remove = async (p) => {
    const msg = p.sharedGroup
      ? `Excluir a compra compartilhada "${p.description}" e as parcelas de todos os participantes?`
      : `Excluir a compra "${p.description}" e todas as parcelas?`;
    if (!window.confirm(msg)) return;
    try { await (p.sharedGroup ? purchasesApi.removeShared(p.sharedGroup) : purchasesApi.remove(p.id)); notifyFinanceChanged(); toast.success('Compra excluída'); reload(); } catch (e) { toast.error(e); }
  };
  const togglePaid = async (row) => {
    month.setData((d) => ({ ...d, data: d.data.map((r) => (r.id === row.id ? { ...r, paid: !r.paid } : r)) }));
    try { await purchasesApi.setPaid(row.id, !row.paid); notifyFinanceChanged(); } catch (e) { toast.error(e); reload(); }
  };
  const toggleAllUnpaid = () => {
    setSelectedInstallments((ids) => {
      const otherIds = ids.filter((id) => !unpaidRows.some((row) => row.id === id));
      return allUnpaidSelected ? otherIds : [...otherIds, ...unpaidRows.map((row) => row.id)];
    });
  };
  const toggleAllPaid = () => {
    setSelectedInstallments((ids) => {
      const otherIds = ids.filter((id) => !paidRows.some((row) => row.id === id));
      return allPaidSelected ? otherIds : [...otherIds, ...paidRows.map((row) => row.id)];
    });
  };
  const toggleSelected = (id) => {
    setSelectedInstallments((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  };
  const setInstallmentsPaid = async (rows, paid) => {
    if (!rows.length || payingAll) return;
    const ids = rows.map((row) => row.id);
    const action = paid ? 'Marcar como pagas' : 'Desmarcar como pagas';
    const message = `${action} ${ids.length} ${ids.length === 1 ? 'parcela' : 'parcelas'}? O limite dos cartões será atualizado.`;
    if (!window.confirm(message)) return;
    setPayingAll(true);
    try {
      const result = await purchasesApi.setManyPaid(ids, paid);
      notifyFinanceChanged();
      setSelectedInstallments((selected) => selected.filter((id) => !ids.includes(id)));
      toast.success(
        `${result.data.updated} ${result.data.updated === 1 ? 'parcela atualizada' : 'parcelas atualizadas'}. Limites atualizados.`,
      );
      month.reload();
    } catch (error) {
      toast.error(error);
      month.reload();
    } finally {
      setPayingAll(false);
    }
  };
  const setSubscriptionStatus = async (subscription, status) => {
    if (status === 'canceled' && !window.confirm(
      `Cancelar "${subscription.description}"? A cobrança do mês do cancelamento, se prevista, permanece na fatura; as cobranças dos meses seguintes deixam de ser geradas.`,
    )) return;
    try {
      await purchasesApi.setSubscriptionStatus(subscription.id, status);
      notifyFinanceChanged();
      toast.success(status === 'canceled' ? 'Assinatura cancelada.' : 'Assinatura reativada.');
      subscriptions.reload();
    } catch (error) {
      toast.error(error);
    }
  };

  const opt = (l) => l.map((x) => ({ value: x.id, label: x.name }));
  const pages = all.data ? Math.max(1, Math.ceil(all.data.total / all.data.pageSize)) : 1;
  const parseSharedNames = (person, sharedWith) => {
    const names = [...new Set([
      ...(typeof person === 'string' ? person.split(',').map((name) => name.trim()).filter(Boolean) : []),
      ...(typeof sharedWith === 'string' ? sharedWith.split(',').map((name) => name.trim()).filter(Boolean) : []),
    ])];
    return names;
  };
  const SharedPeopleBadge = ({ person, sharedWith }) => {
    const names = parseSharedNames(person, sharedWith);
    const [open, setOpen] = useState(false);
    if (names.length <= 1) return <span>{names[0] || person || '—'}</span>;
    return (
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names[0]}</span>
        <button
          type="button"
          aria-label={`Ver participantes da compra compartilhada: ${names.join(', ')}`}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={() => setOpen((current) => !current)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            minWidth: 28,
            height: 22,
            borderRadius: 999,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-surface-alt, #f6f7fb)',
            color: 'var(--text-primary, #111827)',
            cursor: 'pointer',
            padding: '0 6px',
            flexShrink: 0,
          }}
        >
          <Users size={12} aria-hidden="true" />
          {names.length > 2 && <span style={{ fontSize: 10, fontWeight: 700 }}>{`+${names.length - 1}`}</span>}
        </button>
        {open && (
          <div
            role="dialog"
            aria-label="Participantes da compra compartilhada"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              left: 0,
              zIndex: 20,
              minWidth: 180,
              maxWidth: 240,
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-surface, #fff)',
              boxShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: 'var(--text-secondary)' }}>Participantes</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {names.map((name) => <li key={name} style={{ fontSize: 12, color: 'var(--text-primary)' }}>{name}</li>)}
            </ul>
          </div>
        )}
      </span>
    );
  };
  const canceledDateLabel = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'data indisponível'
      : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  };

  return (
    <div className="purchases-page">
      <PageHeader
        title="Compras e parcelas"
        subtitle={<span className="purchase-page-subtitle">Compras no cartão e suas parcelas</span>}
        actions={<>
          <a className="btn btn-ghost purchase-export" href={purchasesApi.exportUrl()} aria-label="Exportar CSV">
            <Download size={16} aria-hidden="true" /><span>Exportar CSV</span>
          </a>
          <Button className="purchase-new" variant="primary" onClick={() => setForm(emptyPurchase(period))} disabled={!lookups.ready}>
            <Plus size={17} aria-hidden="true" /> Nova compra
          </Button>
        </>}
      />

      <div className="toolbar purchase-toolbar">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'month'} className={tab === 'month' ? 'on' : ''} onClick={() => setTab('month')}>
            <span className="purchase-tab-desktop">Parcelas do mês</span>
            <span className="purchase-tab-mobile">Parcelas</span>
          </button>
          <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
            <span className="purchase-tab-desktop">Todas as compras</span>
            <span className="purchase-tab-mobile">Todas</span>
          </button>
          <button role="tab" aria-selected={tab === 'subscriptions'} className={tab === 'subscriptions' ? 'on' : ''} onClick={() => setTab('subscriptions')}>
            <span className="purchase-tab-desktop">Assinaturas</span>
            <span className="purchase-tab-mobile">Assinaturas</span>
          </button>
        </div>
        <div className="filters purchase-filters">
          <input className="input purchase-search" type="search" placeholder="Buscar descrição…" value={filters.search} onChange={setF('search')} aria-label="Buscar descrição" />
          <button
            type="button"
            className="purchase-filter-toggle"
            aria-expanded={advancedFiltersOpen}
            aria-controls="purchase-advanced-filters"
            onClick={() => setAdvancedFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span>Filtros avançados</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <div id="purchase-advanced-filters" className={`purchase-advanced-filters${advancedFiltersOpen ? ' is-open' : ''}`}>
            <Select value={filters.personId} onChange={setF('personId')} placeholder="Todas as pessoas" options={opt(lookups.people)} aria-label="Pessoa" />
            <Select value={filters.cardId} onChange={setF('cardId')} placeholder="Todos os cartões" options={opt(lookups.cards)} aria-label="Cartão" />
            <Select value={filters.categoryId} onChange={setF('categoryId')} placeholder="Todas as categorias" options={opt(lookups.categories)} aria-label="Categoria" />
          </div>
        </div>
      </div>

      <Card>
        {active.error && <ErrorState error={active.error} onRetry={reload} />}
        {!active.data && !active.error && <Spinner />}

        {tab === 'month' && month.data && (
          month.data.data.length === 0 ? <><EmptyState title="Nenhuma parcela neste mês">Registre uma compra ou mude o mês no topo.</EmptyState><div className="empty-state-action"><Button variant="primary" onClick={() => setForm(emptyPurchase(period))} disabled={!lookups.ready}>Registrar compra</Button></div></> : (
            <>
              <section className={`purchase-bulk-panel${bulkActionsOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="purchase-bulk-toggle"
                  aria-expanded={bulkActionsOpen}
                  aria-controls="purchase-bulk-content"
                  onClick={() => setBulkActionsOpen((open) => !open)}
                >
                  <Zap size={17} aria-hidden="true" />
                  <span>Pagar / despagar em lote <strong>({unpaidRows.length} pendentes)</strong></span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
                <div id="purchase-bulk-content" className="purchase-bulk-content">
                  <div className="purchase-bulk-toolbar">
                    <div className="purchase-bulk-segment" role="group" aria-label="Seleção de parcelas">
                      <label className="purchase-bulk-segment-option">
                        <input type="checkbox" checked={allUnpaidSelected} onChange={toggleAllUnpaid} disabled={unpaidRows.length === 0} />
                        <span>Pendentes <b>{unpaidRows.length}</b></span>
                      </label>
                      <label className="purchase-bulk-segment-option">
                        <input type="checkbox" checked={allPaidSelected} onChange={toggleAllPaid} disabled={paidRows.length === 0} />
                        <span>Pagas <b>{paidRows.length}</b></span>
                      </label>
                    </div>
                    <div className="purchase-bulk-actions">
                      <button
                        type="button"
                        className="purchase-bulk-info"
                        aria-label="As ações consideram o mês e os filtros selecionados."
                        data-tip="As ações consideram o mês e os filtros selecionados."
                      >
                        <Info size={17} aria-hidden="true" />
                      </button>
                      <div className="purchase-bulk-dropdown">
                        <button
                          type="button"
                          className="purchase-bulk-trigger"
                          popovertarget="purchase-bulk-unpay-menu"
                          aria-controls="purchase-bulk-unpay-menu"
                          aria-haspopup="menu"
                          aria-expanded="false"
                          onKeyDown={handleBulkMenuTriggerKeyDown}
                        >
                          Despagar
                          <ChevronDown size={14} aria-hidden="true" />
                        </button>
                        <div
                          id="purchase-bulk-unpay-menu"
                          className="purchase-bulk-menu"
                          popover="auto"
                          role="menu"
                          aria-label="Opções para despagar parcelas"
                          ref={bindBulkMenu}
                          onKeyDown={handleBulkMenuKeyDown}
                        >
                          <button
                            type="button"
                            className="purchase-bulk-menu-item"
                            role="menuitem"
                            onClick={(event) => { closeBulkMenu(event); setInstallmentsPaid(selectedPaidRows, false); }}
                            disabled={!selectedPaidRows.length || payingAll}
                          >
                            <span>Selecionadas</span>
                            <small>{selectedPaidRows.length}</small>
                          </button>
                          <button
                            type="button"
                            className="purchase-bulk-menu-item"
                            role="menuitem"
                            onClick={(event) => { closeBulkMenu(event); setInstallmentsPaid(paidRows, false); }}
                            disabled={!paidRows.length || payingAll}
                          >
                            Todas exibidas
                          </button>
                        </div>
                      </div>
                      <div className="purchase-bulk-dropdown">
                        <button
                          type="button"
                          className="purchase-bulk-trigger is-primary"
                          popovertarget="purchase-bulk-pay-menu"
                          aria-controls="purchase-bulk-pay-menu"
                          aria-haspopup="menu"
                          aria-expanded="false"
                          onKeyDown={handleBulkMenuTriggerKeyDown}
                        >
                          Pagar
                          <ChevronDown size={14} aria-hidden="true" />
                        </button>
                        <div
                          id="purchase-bulk-pay-menu"
                          className="purchase-bulk-menu"
                          popover="auto"
                          role="menu"
                          aria-label="Opções para pagar parcelas"
                          ref={bindBulkMenu}
                          onKeyDown={handleBulkMenuKeyDown}
                        >
                          <button
                            type="button"
                            className="purchase-bulk-menu-item"
                            role="menuitem"
                            onClick={(event) => { closeBulkMenu(event); setInstallmentsPaid(selectedUnpaidRows, true); }}
                            disabled={!selectedUnpaidRows.length || payingAll}
                          >
                            <span>Selecionadas</span>
                            <small>{selectedUnpaidRows.length}</small>
                          </button>
                          <button
                            type="button"
                            className="purchase-bulk-menu-item"
                            role="menuitem"
                            onClick={(event) => { closeBulkMenu(event); setInstallmentsPaid(unpaidRows, true); }}
                            disabled={!unpaidRows.length || payingAll}
                          >
                            Todas exibidas
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              <div className="table-wrap responsive-desktop-table">
                <table className="table">
                  <thead><tr><th>Selecionar</th><th>Pago</th><th>Descrição</th><th>Categoria</th><th>Pessoa</th><th>Cartão</th><th>Parcela</th><th className="num">Valor</th><th /></tr></thead>
                <tbody>
                  {month.data.data.map((r) => (
                    <tr key={r.id} className={r.paid ? 'row-dim' : ''}>
                      <td><input type="checkbox" checked={selectedInstallments.includes(r.id)} onChange={() => toggleSelected(r.id)} aria-label={`Selecionar parcela de ${r.description}`} /></td>
                      <td><input type="checkbox" checked={r.paid} onChange={() => togglePaid(r)} aria-label={`Marcar ${r.description} como paga`} /></td>
                      <td>
                        {r.description}{r.isSubscription && <span className="tag">Assinatura</span>}{r.sharedGroup && <span className="tag" title="Compra dividida entre várias pessoas">Compartilhada</span>}
                        {r.vehicleExpenseId && <span className="tag" title="Edite este gasto pela Gestão de Veículos">Veículo</span>}
                        <div className="muted small">Compra registrada: {dateTimeLabel(r.purchaseCreatedAt)} · Parcela atualizada: {dateTimeLabel(r.updatedAt)}</div>
                        {r.sharedWith && <div className="muted small">Dividida com {r.sharedWith}</div>}
                      </td>
                      <td className="muted">{r.category || '—'}</td>
                      <td>{r.sharedGroup ? <SharedPeopleBadge person={r.person} sharedWith={r.sharedWith} /> : r.person}</td>
                      <td>{r.card}</td>
                      <td>{r.isSubscription ? 'Mensal' : `${r.number}/${r.count}`}</td>
                      <td className="num"><Money value={r.amount} /></td>
                      <td className="row-actions">
                        <div className="purchase-icon-actions">
                          <Button className="purchase-icon-action" variant="ghost" title="Editar" aria-label={`Editar ${r.description}`} disabled={Boolean(r.vehicleExpenseId)} onClick={() => openEdit(r.purchaseId, r.sharedGroup)}>
                            <Pencil size={16} aria-hidden="true" />
                          </Button>
                          <Button className="purchase-icon-action is-destructive" variant="ghost" title="Excluir" aria-label={`Excluir ${r.description}`} disabled={Boolean(r.vehicleExpenseId)} onClick={() => remove({ id: r.purchaseId, description: r.description, sharedGroup: r.sharedGroup })}>
                            <Trash2 size={16} aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                  <tfoot><tr><td colSpan={7}>Total do mês ({month.data.data.length} parcelas)</td><td className="num"><Money value={month.data.total} strong /></td><td /></tr></tfoot>
                </table>
              </div>
              <div className="mobile-card-list">
                {month.data.data.map((r) => (
                  <article key={r.id} className={`mobile-record-card purchase-mobile-card${r.paid ? ' is-paid' : ''}`}>
                    <div className="mobile-record-heading">
                      <div className="mobile-record-title">
                        <strong>{r.description}</strong>
                        <span className={`purchase-status ${r.paid ? 'is-paid' : 'is-pending'}`}>{r.paid ? 'Pago' : 'Pendente'}</span>
                        {r.isSubscription && <span className="tag tag-flush">Assinatura</span>}
                        {r.sharedGroup && <span className="tag tag-flush">Compartilhada</span>}
                        {r.vehicleExpenseId && <span className="tag tag-flush">Veículo</span>}
                      </div>
                    </div>
                    <div className="purchase-mobile-amounts">
                      <div><span className="muted small">{r.isSubscription ? 'Mensalidade' : `Parcela ${r.number}/${r.count}`}</span><Money value={r.amount} strong /></div>
                      <div><span className="muted small">Total da compra</span><Money value={r.purchaseTotal} /></div>
                    </div>
                    <div className="mobile-record-details">
                      <span>{r.card}</span>
                      <span>{r.sharedGroup ? <SharedPeopleBadge person={r.person} sharedWith={r.sharedWith} /> : r.person}</span>
                      <span>{r.category || 'Sem categoria'}</span>
                      <span>Compra em {r.purchaseDate ? r.purchaseDate.split('-').reverse().join('/') : monthLabel(period.month, period.year)}</span>
                      {r.sharedWith && <span>Dividida com {r.sharedWith}</span>}
                    </div>
                    <div className="mobile-record-actions purchase-mobile-actions">
                      <label className="mobile-record-check">
                        <input type="checkbox" checked={selectedInstallments.includes(r.id)} onChange={() => toggleSelected(r.id)} aria-label={`Selecionar parcela de ${r.description}`} />
                        Selecionar
                      </label>
                      <Button className="purchase-pay-action" variant={r.paid ? 'ghost' : 'primary'} onClick={() => togglePaid(r)}>
                        {r.paid ? 'Desmarcar paga' : 'Marcar como paga'}
                      </Button>
                      <div className="purchase-icon-actions">
                        <Button className="purchase-icon-action" variant="ghost" title="Editar" aria-label={`Editar ${r.description}`} onClick={() => openEdit(r.purchaseId, r.sharedGroup)} disabled={Boolean(r.vehicleExpenseId)}>
                          <Pencil size={17} aria-hidden="true" />
                        </Button>
                        <Button className="purchase-icon-action is-destructive" variant="ghost" title="Excluir" aria-label={`Excluir ${r.description}`} onClick={() => remove({ id: r.purchaseId, description: r.description, sharedGroup: r.sharedGroup })} disabled={Boolean(r.vehicleExpenseId)}>
                          <Trash2 size={17} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )
        )}

        {tab === 'all' && all.data && (
          all.data.data.length === 0 ? <EmptyState title="Nenhuma compra encontrada" /> : (
            <>
              <div className="table-wrap responsive-desktop-table">
                <table className="table">
                  <thead><tr><th>Descrição</th><th>Pessoa</th><th>Cartão</th><th className="num">Total</th><th>Parcelas</th><th>Vencimentos</th><th /></tr></thead>
                  <tbody>
                    {all.data.data.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.description}{p.isSubscription && <span className="tag">Assinatura</span>}{p.shared && <span className="tag" title="Compra dividida entre várias pessoas">Compartilhada</span>}
                          {p.vehicleExpenseId && <span className="tag" title="Edite este gasto pela Gestão de Veículos">Veículo</span>}
                          {p.category && <div className="muted small">{p.category}</div>}
                          <div className="muted small">Registrada: {dateTimeLabel(p.createdAt)} · Atualizada: {dateTimeLabel(p.updatedAt)}</div>
                          {p.shared && filters.personId && <div className="muted small">Parte de {p.person} · total da compra <Money value={p.groupTotal} /></div>}
                        </td>
                        <td>{p.shared ? <SharedPeopleBadge person={p.person} sharedWith={p.participantsNames || p.person} /> : p.person}</td>
                        <td>{p.card}</td>
                        <td className="num"><Money value={p.total} /></td>
                        <td>{p.isSubscription ? <>Mensal · <Money value={p.total} /></> : <>{p.count}x <span className="muted">de</span> <Money value={p.perInstallment} /></>}</td>
                        <td className="muted">{p.isSubscription ? 'Recorrente' : p.firstDue ? `${MONTHS_SHORT[p.firstDue.month - 1]}/${p.firstDue.year} → ${MONTHS_SHORT[p.lastDue.month - 1]}/${p.lastDue.year}` : '—'}</td>
                        <td className="row-actions">
                          <div className="purchase-icon-actions">
                            <Button className="purchase-icon-action" variant="ghost" title="Editar" aria-label={`Editar ${p.description}`} disabled={Boolean(p.vehicleExpenseId)} onClick={() => openEdit(p.id, p.sharedGroup)}>
                              <Pencil size={16} aria-hidden="true" />
                            </Button>
                            <Button className="purchase-icon-action is-destructive" variant="ghost" title="Excluir" aria-label={`Excluir ${p.description}`} disabled={Boolean(p.vehicleExpenseId)} onClick={() => remove(p)}>
                              <Trash2 size={16} aria-hidden="true" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-card-list">
                {all.data.data.map((p) => (
                  <article key={p.id} className="mobile-record-card purchase-mobile-card">
                    <div className="mobile-record-heading">
                      <div className="mobile-record-title">
                        <strong>{p.description}</strong>
                        {p.isSubscription && <span className="tag tag-flush">Assinatura</span>}
                        {p.shared && <span className="tag tag-flush">Compartilhada</span>}
                        {p.vehicleExpenseId && <span className="tag tag-flush">Veículo</span>}
                      </div>
                      <div className="mobile-record-total">
                        <span className="muted small">Total</span>
                        <Money value={p.total} strong />
                      </div>
                    </div>
                    <p className="muted small">
                      {p.isSubscription
                        ? <>Cobrança recorrente de <Money value={p.total} />/mês</>
                        : <>{p.count}x de <Money value={p.perInstallment} />{p.firstDue && <> · vence {MONTHS_SHORT[p.firstDue.month - 1]}/{p.firstDue.year} – {MONTHS_SHORT[p.lastDue.month - 1]}/{p.lastDue.year}</>}</>}
                    </p>
                    <div className="mobile-record-details">
                      {p.category && <span>{p.category}</span>}
                      <span>{p.shared ? <SharedPeopleBadge person={p.person} sharedWith={p.participantsNames || p.person} /> : p.person}</span>
                      <span>{p.card}</span>
                      {p.shared && filters.personId && <span>Parte de {p.person}</span>}
                    </div>
                    <div className="mobile-record-actions">
                      <div className="purchase-icon-actions">
                        <Button className="purchase-icon-action" variant="ghost" title="Editar" aria-label={`Editar ${p.description}`} onClick={() => openEdit(p.id, p.sharedGroup)} disabled={Boolean(p.vehicleExpenseId)}>
                          <Pencil size={17} aria-hidden="true" />
                        </Button>
                        <Button className="purchase-icon-action is-destructive" variant="ghost" title="Excluir" aria-label={`Excluir ${p.description}`} onClick={() => remove(p)} disabled={Boolean(p.vehicleExpenseId)}>
                          <Trash2 size={17} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <div className="pager">
                <span className="muted">{all.data.total} compras</span>
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                <span>{page} / {pages}</span>
                <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            </>
          )
        )}

        {tab === 'subscriptions' && subscriptions.data && (
          <section className="subscriptions-panel">
            <div className="subscription-summary">
              <div>
                <span>Total em assinaturas ativas</span>
                <strong><Money value={subscriptions.data.activeMonthlyTotal} /> <small>/mês</small></strong>
              </div>
              <CreditCard aria-hidden="true" />
            </div>
            <div className="subscription-status-pills" role="tablist" aria-label="Filtrar assinaturas">
              <button
                type="button"
                role="tab"
                aria-selected={subscriptionStatus === 'active'}
                className={subscriptionStatus === 'active' ? 'is-selected' : ''}
                onClick={() => setSubscriptionStatusFilter('active')}
              >
                Ativas ({subscriptions.data.activeCount})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={subscriptionStatus === 'canceled'}
                className={subscriptionStatus === 'canceled' ? 'is-selected' : ''}
                onClick={() => setSubscriptionStatusFilter('canceled')}
              >
                Canceladas ({subscriptions.data.canceledCount})
              </button>
            </div>
            {subscriptions.data.data.length === 0 ? (
              <EmptyState title={subscriptionStatus === 'active' ? 'Nenhuma assinatura ativa' : 'Nenhuma assinatura cancelada'}>
                {subscriptionStatus === 'active' ? 'Marque uma compra recorrente ao cadastrar para gerenciá-la aqui.' : 'Assinaturas canceladas aparecerão nesta lista.'}
              </EmptyState>
            ) : (
              <div className="subscription-list">
                {subscriptions.data.data.map((subscription) => (
                  <article className={`subscription-card${subscription.subscriptionStatus === 'canceled' ? ' is-canceled' : ''}`} key={subscription.id}>
                    <div className="subscription-card-main">
                      <strong>{subscription.description}</strong>
                      <div className="subscription-card-details">
                        <span><CreditCard aria-hidden="true" /> {subscription.card}</span>
                        <span>{subscription.person}</span>
                      </div>
                    </div>
                    <div className="subscription-card-price">
                      <Money value={subscription.amount} strong />
                      <span>/mês</span>
                    </div>
                    {subscription.subscriptionStatus === 'canceled' ? (
                      <div className="subscription-card-status">
                        <span className="subscription-canceled-badge">Cancelada em {canceledDateLabel(subscription.canceledAt)}</span>
                        <Button variant="ghost" onClick={() => setSubscriptionStatus(subscription, 'active')}>
                          <RotateCcw size={15} aria-hidden="true" /> Reativar
                        </Button>
                      </div>
                    ) : (
                      <Button className="subscription-cancel-button" variant="ghost" onClick={() => setSubscriptionStatus(subscription, 'canceled')}>
                        <Ban size={15} aria-hidden="true" /> Cancelar assinatura
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </Card>

      {form && <PurchaseForm value={form} lookups={lookups} onClose={() => setForm(null)} onSubmit={submit} />}
    </div>
  );
}
