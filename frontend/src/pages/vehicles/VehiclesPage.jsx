import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Bike, Car, CircleHelp, Truck } from 'lucide-react';
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
import MaintenanceTab from './MaintenanceTab.jsx';
import DocumentsTab from './DocumentsTab.jsx';
import { kindLabel, showDate, showKm, showPlate, statusLabel, vehicleLabel } from './vehicles.js';
import { prepareVehiclePhoto } from './vehiclePhoto.js';

function VehicleKindIcon({ kind }) {
  const Icon = kind === 'motorcycle' ? Bike : kind === 'utility' ? Truck : kind === 'other' ? CircleHelp : Car;
  return <Icon aria-hidden="true" />;
}

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
  const location = useLocation();
  const params = useParams();
  const selectedId = params.vehicleId || null;
  const [tab, setTab] = useState('summary');
  const [year, setYear] = useState(new Date().getFullYear());
  const [period, setPeriod] = useState('year');
  const [vehicleForm, setVehicleForm] = useState(null);
  const [expenseForm, setExpenseForm] = useState(null);
  const [version, setVersion] = useState(0); // muda quando algo é gravado, para recarregar listas e painel
  const newExpenseHandled = useRef(false);

  useEffect(() => {
    const requestedTab = new URLSearchParams(location.search).get('tab');
    if (requestedTab === 'maintenance' || requestedTab === 'documents') setTab(requestedTab);
  }, [location.search]);

  const vehicles = useFetch(() => vehiclesApi.list(), [version]);
  const cats = useFetch(() => vehiclesApi.categories(), []);
  const summary = useFetch(() => vehiclesApi.summary({
    vehicleId: selectedId,
    year: year === 'all' ? '' : year,
    period: year === 'all' ? 'all' : period,
    month: new Date().getMonth() + 1,
  }), [selectedId, year, period, version]);
  const reminders = useFetch(() => vehiclesApi.listReminders(selectedId ? { vehicleId: selectedId } : {}), [selectedId, version]);
  const reminderSettings = useFetch(() => vehiclesApi.reminderSettings(), []);
  const documents = useFetch(() => vehiclesApi.listDocuments(selectedId ? { vehicleId: selectedId } : {}), [selectedId, version]);

  const refresh = () => setVersion((v) => v + 1);
  const pick = (id) => nav(id ? `${PATHS.vehicles}/${id}` : PATHS.vehicles);
  const list = vehicles.data ?? [];
  const vehicle = selectedId ? list.find((v) => v.id === selectedId) : null;
  const openExpense = useCallback(async (id, defaults = {}) => {
    const availableVehicles = vehicles.data ?? [];
    if (!id) return setExpenseForm({ ...emptyExpense({ vehicleId: selectedId || (availableVehicles.length === 1 ? availableVehicles[0].id : '') }), ...defaults });
    try { setExpenseForm(expenseToForm(await vehiclesApi.expense(id))); } catch (e) { toast.error(e); }
  }, [selectedId, toast, vehicles.data]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (newExpenseHandled.current || params.get('new') !== 'expense' || !vehicles.data || !lookups.ready) return;
    newExpenseHandled.current = true;
    openExpense();
    nav(location.pathname, { replace: true });
  }, [location.pathname, location.search, lookups.ready, nav, openExpense, vehicles.data]);

  if (vehicles.error) return <ErrorState error={vehicles.error} onRetry={vehicles.reload} />;
  if (!vehicles.data || !cats.data) return <Spinner />;

  if (selectedId && !vehicle) return <EmptyState title="Veículo não encontrado"><Button onClick={() => pick(null)}>Ver toda a frota</Button></EmptyState>;

  const saveVehicle = async (body, photoAction = {}) => {
    const editing = Boolean(vehicleForm.id);
    let saved;
    try {
      saved = editing ? await vehiclesApi.update(vehicleForm.id, body) : await vehiclesApi.create(body);
    } catch (e) { toast.error(e); }
    if (!saved) return;

    let photoError;
    try {
      if (photoAction.photoFile) {
        await vehiclesApi.uploadPhoto(saved.id, await prepareVehiclePhoto(photoAction.photoFile));
      } else if (photoAction.removePhoto) {
        await vehiclesApi.removePhoto(saved.id);
      }
    } catch (error) {
      photoError = error;
    }

    setVehicleForm(null);
    refresh();
    if (!editing) pick(saved.id);
    toast[photoError ? 'error' : 'success'](photoError
      ? new Error(`Veículo salvo, mas a foto não foi atualizada: ${photoError.message}`)
      : editing ? 'Veículo atualizado' : 'Veículo cadastrado');
  };
  const removeVehicle = async () => {
    const hist = vehicle.expensesCount > 0;
    const msg = hist
      ? `${vehicleLabel(vehicle)} tem ${vehicle.expensesCount} lançamento(s) (${vehicle.totalSpent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}). Excluir apaga todo esse histórico.\n\nSe o carro só saiu da família, prefira Editar → Status “Vendido”. Excluir mesmo assim?`
      : `Excluir ${vehicleLabel(vehicle)}?`;
    if (!window.confirm(msg)) return;
    try { await vehiclesApi.remove(vehicle.id, hist); toast.success('Veículo excluído'); pick(null); refresh(); } catch (e) { toast.error(e); }
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
  const saveReminder = async (body) => {
    try {
      if (body.id) await vehiclesApi.updateReminder(body.id, body);
      else await vehiclesApi.createReminder(body);
      toast.success(body.id ? 'Lembrete atualizado' : 'Lembrete criado');
      refresh();
      return true;
    } catch (e) { toast.error(e); return false; }
  };
  const removeReminder = async (reminder) => {
    if (!window.confirm(`Excluir o lembrete “${reminder.title}”?`)) return;
    try { await vehiclesApi.removeReminder(reminder.id); toast.success('Lembrete excluído'); refresh(); } catch (e) { toast.error(e); }
  };
  const markReminderPaid = async (reminder) => {
    try { await vehiclesApi.markReminderPaid(reminder.id); toast.success('Lembrete marcado como pago'); refresh(); } catch (e) { toast.error(e); }
  };
  const uploadDocument = async (body) => {
    try { await vehiclesApi.createDocument(body); toast.success('Documento anexado'); refresh(); return true; }
    catch (e) { toast.error(e); return false; }
  };
  const removeDocument = async (document) => {
    if (!window.confirm(`Excluir o documento “${document.name}”?`)) return;
    try { await vehiclesApi.removeDocument(document.id); toast.success('Documento excluído'); refresh(); } catch (e) { toast.error(e); }
  };
  const registerReminder = (reminder) => {
    const category = { oil: 'oil', tires: 'tires', review: 'preventive', ipva: 'ipva', insurance: 'insurance', licensing: 'licensing', other: 'other' }[reminder.type];
    openExpense(null, {
      vehicleId: reminder.vehicleId, category, description: `${reminder.title} — ${reminder.ruleLabel}`,
      reminderId: reminder.id,
    });
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
                <strong className="veh-chip-title">
                  {v.photoThumbnailUrl ? <img src={v.photoThumbnailUrl} alt="" /> : <VehicleKindIcon kind={v.kind} />}
                  {v.model}
                </strong>
                <span>{showPlate(v.plate)}{v.status !== 'active' && ` · ${statusLabel(v.status)}`}</span>
                <VehicleOwner name={v.ownerName} avatar={v.ownerAvatar} compact />
              </button>
            ))}
            <button type="button" className="veh-chip veh-chip-add" onClick={() => setVehicleForm(emptyVehicle())}>+ Adicionar veículo</button>
          </div>

          {vehicle && (
            <Card className="veh-sheet">
              <div className="veh-hero">
                <div className="veh-photo-hero">
                  {vehicle.photoUrl
                    ? <img src={vehicle.photoUrl} alt={`Foto de ${vehicle.model}`} />
                    : <VehicleKindIcon kind={vehicle.kind} />}
                </div>
                <div className="veh-profile">
                  <h2>{vehicle.model} <span className="veh-plate">{showPlate(vehicle.plate)}</span></h2>
                  <dl className="veh-facts">
                    <div><dt>Tipo</dt><dd>{kindLabel(vehicle.kind)}</dd></div>
                    <div><dt>Proprietário</dt><dd><VehicleOwner name={vehicle.ownerName} avatar={vehicle.ownerAvatar} /></dd></div>
                    <div><dt>Ano</dt><dd>{vehicle.year || '—'}</dd></div>
                    <div><dt>Valor de compra</dt><dd>{vehicle.purchaseValue > 0 ? <Money value={vehicle.purchaseValue} /> : '—'}</dd></div>
                    <div><dt>KM atual</dt><dd>{showKm(vehicle.currentKm)}</dd></div>
                    {vehicle.insuranceDueDate && <div><dt>Vencimento do seguro</dt><dd>{showDate(vehicle.insuranceDueDate)}</dd></div>}
                    <div><dt>Status</dt><dd><span className={`pill ${vehicle.status === 'active' ? '' : 'pill-warn'}`} style={{ marginLeft: 0 }}>{statusLabel(vehicle.status)}</span></dd></div>
                    {vehicle.status === 'sold' && <>
                      <div><dt>Data da venda</dt><dd>{vehicle.soldDate ? new Date(`${vehicle.soldDate}T00:00:00`).toLocaleDateString('pt-BR') : '—'}</dd></div>
                      <div><dt>Valor de venda</dt><dd>{vehicle.soldValue != null ? <Money value={vehicle.soldValue} /> : '—'}</dd></div>
                    </>}
                  </dl>
                  {vehicle.notes && <p className="muted small" style={{ marginTop: 10 }}>{vehicle.notes}</p>}
                </div>
                <div className="veh-hero-actions">
                  <Button size="sm" onClick={() => setVehicleForm(vehicleToForm(vehicle))}>Editar ficha</Button>
                  <Button size="sm" variant="ghost" onClick={removeVehicle}>Excluir</Button>
                </div>
              </div>
            </Card>
          )}

          <div className="toolbar">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>{vehicle ? 'Resumo do veículo' : 'Painel da frota'}</button>
              <button role="tab" aria-selected={tab === 'expenses'} className={tab === 'expenses' ? 'on' : ''} onClick={() => setTab('expenses')}>Lançamentos</button>
              <button role="tab" aria-selected={tab === 'maintenance'} className={tab === 'maintenance' ? 'on' : ''} onClick={() => setTab('maintenance')}>Manutenção &amp; lembretes</button>
              <button role="tab" aria-selected={tab === 'documents'} className={tab === 'documents' ? 'on' : ''} onClick={() => setTab('documents')}>Documentos</button>
            </div>
            <div className="veh-period-switch" role="group" aria-label="Período do resumo">
              {[
                ['month', 'Mês'],
                ['quarter', 'Trimestre'],
                ['year', 'Ano'],
                ['all', 'Tudo'],
              ].map(([value, label]) => (
                <button key={value} type="button" className={period === value ? 'on' : ''} aria-pressed={period === value} onClick={() => {
                  setPeriod(value);
                  if (value !== 'all' && year === 'all') setYear(new Date().getFullYear());
                }}>{label}</button>
              ))}
            </div>
            <Select value={year} onChange={(v) => setYear(v === 'all' ? 'all' : Number(v))} options={yearOpts} aria-label="Ano" style={{ width: 'auto', minWidth: 140 }} />
          </div>

          {tab === 'summary' ? (
            summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : !summary.data ? <Spinner /> : (
              <SummaryTab
                summary={summary.data}
                vehicle={vehicle}
                year={year}
                period={period}
                onPickVehicle={pick}
                onOpenExpenses={() => setTab('expenses')}
                onOpenMaintenance={() => setTab('maintenance')}
                onRegisterExpense={() => openExpense()}
              />
            )
          ) : tab === 'maintenance' ? (
            reminders.error ? <ErrorState error={reminders.error} onRetry={reminders.reload} /> : !reminders.data ? <Spinner /> : (
              <MaintenanceTab
                reminders={reminders.data}
                vehicles={list}
                selectedVehicleId={selectedId}
                settings={reminderSettings.data}
                onSave={saveReminder}
                onDelete={removeReminder}
                onPaid={markReminderPaid}
                onRegister={registerReminder}
              />
            )
          ) : tab === 'documents' ? (
            documents.error ? <ErrorState error={documents.error} onRetry={documents.reload} /> : !documents.data ? <Spinner /> : (
              <DocumentsTab
                key={selectedId || 'fleet'}
                documents={documents.data}
                vehicles={list}
                selectedVehicleId={selectedId}
                onUpload={uploadDocument}
                onDelete={removeDocument}
              />
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
