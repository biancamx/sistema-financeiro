import { useState } from 'react';
import { Button, Card, EmptyState, Field, Modal, Select } from '../../components/ui/ui.jsx';
import { showKm, vehicleLabel } from './vehicles.js';

const TYPES = [
  ['oil', 'Óleo'], ['tires', 'Pneus'], ['review', 'Revisão'], ['ipva', 'IPVA'],
  ['insurance', 'Seguro'], ['licensing', 'Licenciamento'], ['other', 'Outro'],
];
const RULES = [
  ['km', 'Por km'], ['time', 'Por tempo'], ['km_or_time', 'Por km ou tempo'], ['fixed_date', 'Data fixa'],
];
const emptyReminder = (vehicleId = '') => ({
  vehicleId, type: 'oil', title: '', rule: 'km', intervalKm: '10000', intervalMonths: '',
  dueDate: '', lastPerformedDate: '', lastPerformedKm: '',
});
const toForm = (reminder) => ({
  id: reminder.id, vehicleId: reminder.vehicleId, type: reminder.type, title: reminder.type === 'other' ? reminder.title : '',
  rule: reminder.rule, intervalKm: reminder.intervalKm == null ? '' : String(reminder.intervalKm),
  intervalMonths: reminder.intervalMonths == null ? '' : String(reminder.intervalMonths),
  dueDate: reminder.dueDate || '', lastPerformedDate: reminder.lastPerformedDate || '',
  lastPerformedKm: reminder.lastPerformedKm == null ? '' : String(reminder.lastPerformedKm),
});

export default function MaintenanceTab({ reminders, vehicles, selectedVehicleId, settings, onSave, onDelete, onPaid, onRegister }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const rules = form && {
    km: form.rule === 'km' || form.rule === 'km_or_time',
    time: form.rule === 'time' || form.rule === 'km_or_time',
    fixedDate: form.rule === 'fixed_date',
  };
  const submit = async () => {
    setBusy(true);
    try {
      const saved = await onSave({
        ...form, intervalKm: form.intervalKm ? Number(form.intervalKm) : null,
        intervalMonths: form.intervalMonths ? Number(form.intervalMonths) : null,
        dueDate: form.dueDate || null, lastPerformedDate: form.lastPerformedDate || null,
        lastPerformedKm: form.lastPerformedKm === '' ? null : Number(form.lastPerformedKm),
      });
      if (saved !== false) setForm(null);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Card title="Manutenção e lembretes" aside={
        <Button variant="primary" onClick={() => setForm(emptyReminder(selectedVehicleId || (vehicles.length === 1 ? vehicles[0].id : '')))}>
          + Novo lembrete
        </Button>
      }>
        {reminders.length === 0 ? (
          <EmptyState title="Nenhum lembrete cadastrado">Acompanhe vencimentos por km, tempo ou data fixa.</EmptyState>
        ) : (
          <div className="veh-reminder-list">
            {reminders.map((reminder) => (
              <article className="veh-reminder" key={reminder.id}>
                <div className="veh-reminder-main">
                  <div className="inline">
                    <strong>{reminder.title}</strong>
                    <span className={`pill ${reminder.status === 'overdue' ? 'pill-danger' : reminder.status === 'upcoming' ? 'pill-warn' : ''}`}>{reminder.statusLabel}</span>
                  </div>
                  <span className="muted small">{vehicleLabel(vehicles.find((vehicle) => vehicle.id === reminder.vehicleId) || { model: reminder.vehicleModel })} · {reminder.description}</span>
                  {reminder.lastPerformedDate && <span className="muted small">Última realização: {reminder.lastPerformedDate.split('-').reverse().join('/')}{reminder.lastPerformedKm != null && ` · ${showKm(reminder.lastPerformedKm)}`}</span>}
                </div>
                <div className="inline veh-reminder-actions">
                  {reminder.active && reminder.source !== 'document' && <Button size="sm" variant="primary" onClick={() => onRegister(reminder)}>Registrar gasto</Button>}
                  {reminder.active && reminder.rule === 'fixed_date' && reminder.source !== 'document' && <Button size="sm" onClick={() => onPaid(reminder)}>Marcar como pago</Button>}
                  {reminder.source === 'manual' ? (
                    <>
                      <Button size="sm" onClick={() => setForm(toForm(reminder))}>Editar</Button>
                      <Button size="sm" variant="ghost" onClick={() => onDelete(reminder)}>Excluir</Button>
                    </>
                  ) : <span className="muted small">{reminder.source === 'insurance' ? 'Gerenciado pela ficha do veículo' : 'Gerenciado por Documentos'}</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      {form && (
        <Modal open title={form.id ? 'Editar lembrete' : 'Novo lembrete'} wide
          footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={submit}>Salvar lembrete</Button></>}>
          <div className="form-grid">
            <Field label="Veículo">{(id) => <Select id={id} value={form.vehicleId} onChange={(value) => setForm((current) => ({ ...current, vehicleId: value }))} placeholder="Escolha…" options={vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicleLabel(vehicle) }))} />}</Field>
            <Field label="Tipo">{(id) => <Select id={id} value={form.type} onChange={(value) => setForm((current) => ({ ...current, type: value }))} options={TYPES.map(([value, label]) => ({ value, label }))} />}</Field>
            {form.type === 'other' && <Field label="Nome do lembrete">{(id) => <input id={id} className="input" value={form.title} maxLength={80} onChange={set('title')} />}</Field>}
            <Field label="Regra">{(id) => <Select id={id} value={form.rule} onChange={(value) => setForm((current) => ({ ...current, rule: value }))} options={RULES.map(([value, label]) => ({ value, label }))} />}</Field>
            {rules.km && <Field label="A cada (km)">{(id) => <input id={id} className="input" type="number" min="1" value={form.intervalKm} onChange={set('intervalKm')} />}</Field>}
            {rules.time && <Field label="A cada (meses)">{(id) => <input id={id} className="input" type="number" min="1" max="120" value={form.intervalMonths} onChange={set('intervalMonths')} />}</Field>}
            {rules.fixedDate && <Field label="Data de vencimento">{(id) => <input id={id} className="input" type="date" value={form.dueDate} onChange={set('dueDate')} />}</Field>}
            {!rules.fixedDate && <Field label="Última realização">{(id) => <input id={id} className="input" type="date" value={form.lastPerformedDate} onChange={set('lastPerformedDate')} />}</Field>}
            {rules.km && <Field label="KM da última realização">{(id) => <input id={id} className="input" type="number" min="0" value={form.lastPerformedKm} onChange={set('lastPerformedKm')} />}</Field>}
          </div>
          <p className="field-hint">O lembrete fica “Em breve” até {settings?.daysBefore ?? 30} dias ou {settings?.kmBefore ?? 500} km do vencimento. O status é calculado com o km atual do veículo.</p>
        </Modal>
      )}
    </>
  );
}
