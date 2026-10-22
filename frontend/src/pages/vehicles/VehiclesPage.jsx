import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useLookups } from '../../hooks/useLookups.js';
import { notifyFinanceChanged } from '../../hooks/useFinanceRefresh.js';
import { vehiclesApi } from '../../services/api.js';
import { Button, Card, EmptyState, ErrorState, Money, PageHeader, Select, Spinner } from '../../components/ui/ui.jsx';
import { PATHS } from '../../app/paths.js';
import VehicleForm, { emptyVehicle, vehicleToForm } from './VehicleForm.jsx';
import ExpenseForm, { emptyExpense, expenseToForm } from './ExpenseForm.jsx';
import SummaryTab from './SummaryTab.jsx';
import ExpensesTab from './ExpensesTab.jsx';
import { kindLabel, showKm, showPlate, statusLabel, vehicleLabel } from './vehicles.js';

function VehicleOwner({ name, avatar, compact = false }) {
  if (!name) return compact ? null : <span className="muted">Não informado</span>;
  const initials = name.trim().charAt(0).toLocaleUpperCase('pt-BR') || '?';
  return (
    <span className={`veh-owner ${compact ? 'veh-owner-compact' : ''}`}>
      <span className="veh-owner-avatar" aria-hidden="true">
        {initials}
        {avatar && <img src={avatar} alt="" onError={(event) => event.currentTarget.remove()} />}
      </span>
      <span>{name}</span>
    </span>
  );
}

export default function VehiclesPage() {
  const nav = useNavigate();
  const toast = useToast();
  const lookups = useLookups();
  const params = useParams();
  const selectedId = params.vehicleId || null;
  const [tab, setTab] = useState('summary');
  const [year, setYear] = useState(new Date().getFullYear());
  const [vehicleForm, setVehicleForm] = useState(null);
  const [expenseForm, setExpenseForm] = useState(null);
  const [version, setVersion] = useState(0); // muda quando algo é gravado, para recarregar listas e painel

  const vehicles = useFetch(() => vehiclesApi.list(), [version]);
  const cats = useFetch(() => vehiclesApi.categories(), []);
  const summary = useFetch(() => vehiclesApi.summary({ vehicleId: selectedId, year: year === 'all' ? '' : year }), [selectedId, year, version]);

  const refresh = () => setVersion((v) => v + 1);
  const pick = (id) => nav(id ? `${PATHS.vehicles}/${id}` : PATHS.vehicles);

  if (vehicles.error) return <ErrorState error={vehicles.error} onRetry={vehicles.reload} />;
  if (!vehicles.data || !cats.data) return <Spinner />;

  const list = vehicles.data;
  const vehicle = selectedId ? list.find((v) => v.id === selectedId) : null;
  if (selectedId && !vehicle) return <EmptyState title="Veículo não encontrado"><Button onClick={() => pick(null)}>Ver toda a frota</Button></EmptyState>;

  const saveVehicle = async (body) => {
    try {
      const editing = Boolean(vehicleForm.id);
      const saved = editing ? await vehiclesApi.update(vehicleForm.id, body) : await vehiclesApi.create(body);
      toast.success(editing ? 'Veículo atualizado' : 'Veículo cadastrado');
      setVehicleForm(null);
      refresh();
      if (!editing) pick(saved.id);
    } catch (e) { toast.error(e); }
  };
  const removeVehicle = async () => {
    const hist = vehicle.expensesCount > 0;
    const msg = hist
      ? `${vehicleLabel(vehicle)} tem ${vehicle.expensesCount} lançamento(s) (${vehicle.totalSpent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}). Excluir apaga todo esse histórico.\n\nSe o carro só saiu da família, prefira Editar → Status “Vendido”. Excluir mesmo assim?`
      : `Excluir ${vehicleLabel(vehicle)}?`;
    if (!window.confirm(msg)) return;
    try { await vehiclesApi.remove(vehicle.id, hist); toast.success('Veículo excluído'); pick(null); refresh(); } catch (e) { toast.error(e); }
  };

  const openExpense = async (id) => {
    if (!id) return setExpenseForm(emptyExpense({ vehicleId: selectedId || (list.length === 1 ? list[0].id : '') }));
    try { setExpenseForm(expenseToForm(await vehiclesApi.expense(id))); } catch (e) { toast.error(e); }
  };
  const saveExpense = async (body) => {
    try {
      if (expenseForm.id) await vehiclesApi.updateExpense(expenseForm.id, body);
      else await vehiclesApi.createExpense(body);
      toast.success(expenseForm.id ? 'Gasto atualizado' : 'Gasto registrado');
      setExpenseForm(null);
      notifyFinanceChanged();
      refresh();
    } catch (e) { toast.error(e); }
  };

  const cy = new Date().getFullYear();
  const yearOpts = [{ value: 'all', label: 'Todos os anos' }, ...Array.from({ length: 8 }, (_, i) => cy + 1 - i).map((y) => ({ value: y, label: String(y) }))];
  const fleetTotal = list.reduce((s, v) => s + v.totalSpent, 0);

  return (
    <>
      <PageHeader
        title="Gestão de Veículos"
        subtitle="Frota da família ou da empresa e o histórico de gastos de cada veículo"
        actions={<>
          <Button onClick={() => setVehicleForm(emptyVehicle())}>Novo veículo</Button>
          <Button variant="primary" onClick={() => openExpense()} disabled={!list.length || !lookups.ready}>Novo gasto</Button>
        </>}
      />

      {list.length === 0 ? (
        <Card>
          <EmptyState title="Nenhum veículo cadastrado">Cadastre o primeiro carro, moto ou utilitário para começar a registrar gastos.</EmptyState>
          <div style={{ textAlign: 'center' }}><Button variant="primary" onClick={() => setVehicleForm(emptyVehicle())}>Cadastrar veículo</Button></div>
        </Card>
      ) : (
        <>
          <div className="veh-switch" role="tablist" aria-label="Veículo">
            <button role="tab" aria-selected={!vehicle} className={`veh-chip ${!vehicle ? 'on' : ''}`} onClick={() => pick(null)}>
              <strong>Toda a frota</strong><span>{list.length} veículo(s) · <Money value={fleetTotal} /></span>
            </button>
            {list.map((v) => (
              <button key={v.id} role="tab" aria-selected={v.id === selectedId} className={`veh-chip ${v.id === selectedId ? 'on' : ''} ${v.status !== 'active' ? 'dim' : ''}`} onClick={() => pick(v.id)}>
                <strong>{v.model}</strong>
                <span>{showPlate(v.plate)}{v.status !== 'active' && ` · ${statusLabel(v.status)}`}</span>
                <VehicleOwner name={v.ownerName} avatar={v.ownerAvatar} compact />
              </button>
            ))}
          </div>

          {vehicle && (
            <Card className="veh-sheet" title={`${vehicle.model}`} aside={
              <div className="inline">
                <Button size="sm" onClick={() => setVehicleForm(vehicleToForm(vehicle))}>Editar ficha</Button>
                <Button size="sm" variant="ghost" onClick={removeVehicle}>Excluir</Button>
              </div>
            }>
              <dl className="veh-facts">
                <div><dt>Placa</dt><dd>{showPlate(vehicle.plate)}</dd></div>
                <div><dt>Tipo</dt><dd>{kindLabel(vehicle.kind)}</dd></div>
                <div><dt>Proprietário</dt><dd><VehicleOwner name={vehicle.ownerName} avatar={vehicle.ownerAvatar} /></dd></div>
                <div><dt>Ano</dt><dd>{vehicle.year || '—'}</dd></div>
                <div><dt>Valor de compra</dt><dd>{vehicle.purchaseValue > 0 ? <Money value={vehicle.purchaseValue} /> : '—'}</dd></div>
                <div><dt>Status</dt><dd><span className={`pill ${vehicle.status === 'active' ? '' : 'pill-warn'}`} style={{ marginLeft: 0 }}>{statusLabel(vehicle.status)}</span></dd></div>
                {vehicle.status === 'sold' && <>
                  <div><dt>Data da venda</dt><dd>{vehicle.soldDate ? new Date(`${vehicle.soldDate}T00:00:00`).toLocaleDateString('pt-BR') : '—'}</dd></div>
                  <div><dt>Valor de venda</dt><dd>{vehicle.soldValue != null ? <Money value={vehicle.soldValue} /> : '—'}</dd></div>
                </>}
                <div><dt>KM atual</dt><dd>{showKm(vehicle.currentKm)}</dd></div>
              </dl>
              {vehicle.notes && <p className="muted small" style={{ marginTop: 10 }}>{vehicle.notes}</p>}
            </Card>
          )}

          <div className="toolbar">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>{vehicle ? 'Resumo do veículo' : 'Painel da frota'}</button>
              <button role="tab" aria-selected={tab === 'expenses'} className={tab === 'expenses' ? 'on' : ''} onClick={() => setTab('expenses')}>Lançamentos</button>
            </div>
            <Select value={year} onChange={(v) => setYear(v === 'all' ? 'all' : Number(v))} options={yearOpts} aria-label="Ano" style={{ width: 'auto', minWidth: 140 }} />
          </div>

          {tab === 'summary' ? (
            summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : !summary.data ? <Spinner /> : (
              <SummaryTab summary={summary.data} vehicle={vehicle} year={year} onPickVehicle={pick} />
            )
          ) : (
            <ExpensesTab vehicleId={selectedId} year={year} people={lookups.people} categories={cats.data} version={version} onChanged={refresh} onEdit={openExpense} />
          )}
        </>
      )}

      {vehicleForm && <VehicleForm value={vehicleForm} people={lookups.people} onClose={() => setVehicleForm(null)} onSubmit={saveVehicle} />}
      {expenseForm && <ExpenseForm value={expenseForm} onClose={() => setExpenseForm(null)} onSubmit={saveExpense} vehicles={list} people={lookups.people} categories={cats.data} cards={lookups.cards} />}
    </>
  );
}
