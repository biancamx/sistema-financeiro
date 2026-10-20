import { useState } from 'react';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useDebounced } from '../../hooks/useDebounced.js';
import { useLookups } from '../../hooks/useLookups.js';
import { purchasesApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Money, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { MONTHS_SHORT, monthLabel } from '../../lib/format.js';
import PurchaseForm, { emptyPurchase, toForm, toSharedForm } from './PurchaseForm.jsx';

export default function PurchasesPage() {
  const period = usePeriod();
  const toast = useToast();
  const lookups = useLookups();
  const [tab, setTab] = useState('month');
  const [filters, setFilters] = useState({ personId: '', cardId: '', categoryId: '', search: '' });
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(null);
  const search = useDebounced(filters.search);
  const q = { personId: filters.personId, cardId: filters.cardId, categoryId: filters.categoryId, search };
  const setF = (k) => (v) => { setFilters((f) => ({ ...f, [k]: v?.target ? v.target.value : v })); setPage(1); };

  const month = useFetch(() => purchasesApi.installments({ ...q, month: period.month, year: period.year, pageSize: 200 }), [tab, period.month, period.year, q.personId, q.cardId, q.categoryId, search], { enabled: tab === 'month' });
  const all = useFetch(() => purchasesApi.list({ ...q, page, pageSize: 30 }), [tab, page, q.personId, q.cardId, q.categoryId, search], { enabled: tab === 'all' });
  const active = tab === 'month' ? month : all;
  const reload = () => active.reload();

  // compra compartilhada: edita o grupo inteiro (todos os participantes de uma vez)
  const openEdit = async (purchaseId, group) => {
    try { setForm(group ? toSharedForm(await purchasesApi.getShared(group)) : toForm(await purchasesApi.get(purchaseId))); } catch (e) { toast.error(e); }
  };
  const submit = async (body) => {
    try {
      const editing = Boolean(form.id || form.group);
      if (form.shared) await (form.group ? purchasesApi.updateShared(form.group, body) : purchasesApi.createShared(body));
      else if (form.id) await purchasesApi.update(form.id, body);
      else await purchasesApi.create(body);
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
    try { await (p.sharedGroup ? purchasesApi.removeShared(p.sharedGroup) : purchasesApi.remove(p.id)); toast.success('Compra excluída'); reload(); } catch (e) { toast.error(e); }
  };
  const togglePaid = async (row) => {
    month.setData((d) => ({ ...d, data: d.data.map((r) => (r.id === row.id ? { ...r, paid: !r.paid } : r)) }));
    try { await purchasesApi.setPaid(row.id, !row.paid); } catch (e) { toast.error(e); reload(); }
  };

  const opt = (l) => l.map((x) => ({ value: x.id, label: x.name }));
  const pages = all.data ? Math.max(1, Math.ceil(all.data.total / all.data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Lançamentos"
        subtitle="Compras no cartão e suas parcelas — a antiga aba “Banco de Dados”"
        actions={<>
          <a className="btn btn-ghost" href={purchasesApi.exportUrl()}>Exportar CSV</a>
          <Button variant="primary" onClick={() => setForm(emptyPurchase(period))} disabled={!lookups.ready}>Nova compra</Button>
        </>}
      />

      <div className="toolbar">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'month'} className={tab === 'month' ? 'on' : ''} onClick={() => setTab('month')}>Parcelas de {monthLabel(period.month, period.year)}</button>
          <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>Todas as compras</button>
        </div>
        <div className="filters">
          <input className="input" type="search" placeholder="Buscar descrição…" value={filters.search} onChange={setF('search')} aria-label="Buscar" />
          <Select value={filters.personId} onChange={setF('personId')} placeholder="Todas as pessoas" options={opt(lookups.people)} aria-label="Pessoa" />
          <Select value={filters.cardId} onChange={setF('cardId')} placeholder="Todos os cartões" options={opt(lookups.cards)} aria-label="Cartão" />
          <Select value={filters.categoryId} onChange={setF('categoryId')} placeholder="Todas as categorias" options={opt(lookups.categories)} aria-label="Categoria" />
        </div>
      </div>

      <Card>
        {active.error && <ErrorState error={active.error} onRetry={reload} />}
        {!active.data && !active.error && <Spinner />}

        {tab === 'month' && month.data && (
          month.data.data.length === 0 ? <EmptyState title="Nenhuma parcela neste mês">Registre uma compra ou mude o mês no topo.</EmptyState> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Pago</th><th>Descrição</th><th>Categoria</th><th>Pessoa</th><th>Cartão</th><th>Parcela</th><th className="num">Valor</th><th /></tr></thead>
                <tbody>
                  {month.data.data.map((r) => (
                    <tr key={r.id} className={r.paid ? 'row-dim' : ''}>
                      <td><input type="checkbox" checked={r.paid} onChange={() => togglePaid(r)} aria-label={`Marcar ${r.description} como paga`} /></td>
                      <td>
                        {r.description}{r.sharedGroup && <span className="tag" title="Compra dividida entre várias pessoas">Compartilhada</span>}
                        {r.sharedWith && <div className="muted small">Dividida com {r.sharedWith}</div>}
                      </td>
                      <td className="muted">{r.category || '—'}</td>
                      <td>{r.person}</td>
                      <td>{r.card}</td>
                      <td>{r.number}/{r.count}</td>
                      <td className="num"><Money value={r.amount} /></td>
                      <td className="row-actions"><Button variant="ghost" size="sm" onClick={() => openEdit(r.purchaseId, r.sharedGroup)}>Editar</Button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={6}>Total do mês ({month.data.data.length} parcelas)</td><td className="num"><Money value={month.data.total} strong /></td><td /></tr></tfoot>
              </table>
            </div>
          )
        )}

        {tab === 'all' && all.data && (
          all.data.data.length === 0 ? <EmptyState title="Nenhuma compra encontrada" /> : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Descrição</th><th>Pessoa</th><th>Cartão</th><th className="num">Total</th><th>Parcelas</th><th>Período</th><th /></tr></thead>
                  <tbody>
                    {all.data.data.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.description}{p.shared && <span className="tag" title="Compra dividida entre várias pessoas">Compartilhada</span>}
                          {p.category && <div className="muted small">{p.category}</div>}
                          {p.shared && filters.personId && <div className="muted small">Parte de {p.person} · total da compra <Money value={p.groupTotal} /></div>}
                        </td>
                        <td>{p.person}</td>
                        <td>{p.card}</td>
                        <td className="num"><Money value={p.total} /></td>
                        <td>{p.count}x <span className="muted">de</span> <Money value={p.perInstallment} /></td>
                        <td className="muted">{p.first ? `${MONTHS_SHORT[p.first.month - 1]}/${p.first.year} → ${MONTHS_SHORT[p.last.month - 1]}/${p.last.year}` : '—'}</td>
                        <td className="row-actions"><Button variant="ghost" size="sm" onClick={() => openEdit(p.id, p.sharedGroup)}>Editar</Button><Button variant="ghost" size="sm" onClick={() => remove(p)}>Excluir</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
      </Card>

      {form && <PurchaseForm value={form} lookups={lookups} onClose={() => setForm(null)} onSubmit={submit} />}
    </>
  );
}
