import { useState } from 'react';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounced } from '../../hooks/useDebounced.js';
import { useFetch } from '../../hooks/useFetch.js';
import { vehiclesApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Money, Select, Spinner } from '../../components/ui/ui.jsx';
import { money } from '../../lib/format.js';
import { showDate, showKm } from './vehicles.js';

/** Histórico de gastos (do veículo selecionado ou da frota), com filtros, edição e exportação. */
export default function ExpensesTab({ vehicleId, year, people, categories, onEdit, version, onChanged }) {
  const toast = useToast();
  const [f, setF] = useState({ group: '', category: '', personId: '', shared: '', search: '' });
  const [page, setPage] = useState(1);
  const search = useDebounced(f.search);
  const set = (k) => (v) => { setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v })); setPage(1); };
  const q = { vehicleId, year: year === 'all' ? '' : year, group: f.group, category: f.category, personId: f.personId, shared: f.shared, search };

  const { data, error, loading, reload } = useFetch(
    () => vehiclesApi.expenses({ ...q, page, pageSize: 30 }),
    [vehicleId, year, f.group, f.category, f.personId, f.shared, search, page, version],
  );

  const remove = async (e) => {
    if (!window.confirm(`Excluir o gasto "${e.categoryLabel}${e.description ? ` — ${e.description}` : ''}" de ${money(e.amount)}?`)) return;
    try { await vehiclesApi.removeExpense(e.id); toast.success('Gasto excluído'); onChanged(); } catch (err) { toast.error(err); }
  };

  const cats = categories.categories.filter((c) => !f.group || c.group === f.group);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const exportQ = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v !== undefined));

  return (
    <>
      <div className="toolbar">
        <div className="filters">
          <input className="input" type="search" placeholder="Buscar descrição…" value={f.search} onChange={set('search')} aria-label="Buscar" />
          <Select value={f.group} onChange={(v) => { setF((s) => ({ ...s, group: v, category: '' })); setPage(1); }} placeholder="Todos os grupos" options={categories.groups.map((g) => ({ value: g.key, label: g.label }))} aria-label="Grupo" />
          <Select value={f.category} onChange={set('category')} placeholder="Todas as categorias" options={cats.map((c) => ({ value: c.key, label: c.label }))} aria-label="Categoria" />
          <Select value={f.personId} onChange={set('personId')} placeholder="Todas as pessoas" options={people.map((p) => ({ value: p.id, label: p.name }))} aria-label="Pessoa" />
          <Select value={f.shared} onChange={set('shared')} placeholder="Individuais e compartilhados" options={[{ value: 'false', label: 'Só individuais' }, { value: 'true', label: 'Só compartilhados' }]} aria-label="Tipo" />
        </div>
        <a className="btn btn-ghost" href={vehiclesApi.exportUrl(exportQ)}>Exportar CSV</a>
      </div>

      <Card className={loading ? 'is-loading' : ''}>
        {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Spinner /> : data.data.length === 0 ? (
          <EmptyState title="Nenhum gasto encontrado">Ajuste os filtros ou registre um novo gasto.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Data</th>{!vehicleId && <th>Veículo</th>}<th>Categoria</th><th>Descrição</th><th className="num">KM</th><th>Pagou</th><th>Pagamento</th><th>Rateio</th><th className="num">Valor</th><th /></tr></thead>
              <tbody>
                {data.data.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{showDate(e.date)}</td>
                    {!vehicleId && <td>{e.vehicleModel} <span className="muted small">{e.vehiclePlate}</span></td>}
                    <td>{e.categoryLabel}</td>
                    <td>{e.description || <span className="muted">—</span>}</td>
                    <td className="num">{showKm(e.km)}</td>
                    <td>{e.payer}</td>
                    <td>{e.paymentMethod === 'card' ? `Cartão · ${e.card || 'registrado'}` : 'Dinheiro / outro'}</td>
                    <td>
                      {e.shared
                        ? <span title={e.shares.map((s) => `${s.person}: ${money(s.amount)}`).join('\n')}><span className="tag tag-flush">Compartilhado</span> <span className="muted small">{e.shares.map((s) => s.person).join(', ')}</span></span>
                        : <span className="muted small">Individual</span>}
                    </td>
                    <td className="num"><Money value={e.amount} strong /></td>
                    <td className="row-actions">
                      <Button variant="ghost" size="sm" onClick={() => onEdit(e.id)}>Editar</Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(e)}>Excluir</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={vehicleId ? 7 : 8}>Total dos {data.total} lançamento(s) filtrados</td><td className="num">{money(data.sum)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
        {data && pages > 1 && (
          <div className="pager">
            <span className="muted">Página {page} de {pages}</span>
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button>
          </div>
        )}
      </Card>
    </>
  );
}
