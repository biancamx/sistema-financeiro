import { useState } from 'react';
import { Button, Field, Modal, Select } from '../../components/ui/ui.jsx';
import { parseMoney } from '../../lib/format.js';
import { KINDS, STATUSES } from './vehicles.js';

export const emptyVehicle = () => ({ kind: 'car', model: '', plate: '', year: '', purchaseValue: '', status: 'active', notes: '' });
export const vehicleToForm = (v) => ({
  id: v.id, kind: v.kind, model: v.model, plate: v.plate, year: v.year ? String(v.year) : '',
  purchaseValue: v.purchaseValue ? String(v.purchaseValue).replace('.', ',') : '', status: v.status, notes: v.notes || '',
});

/** Ficha do veículo: cadastro e edição (placa, modelo, ano, valor de compra, status). */
export default function VehicleForm({ value, onClose, onSubmit }) {
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));

  const submit = async () => {
    const e = {};
    const plate = f.plate.toUpperCase().replace(/[\s-]/g, '');
    const year = f.year ? Number(f.year) : null;
    const price = f.purchaseValue ? parseMoney(f.purchaseValue) : 0;
    if (!f.model.trim()) e.model = 'Informe o modelo';
    if (!/^[A-Z0-9]{5,8}$/.test(plate)) e.plate = 'Placa inválida (ex.: ABC-1D23)';
    if (year !== null && !(year >= 1900 && year <= new Date().getFullYear() + 1)) e.year = 'Ano inválido';
    if (!Number.isFinite(price) || price < 0) e.purchaseValue = 'Valor inválido';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await onSubmit({ kind: f.kind, model: f.model.trim(), plate, year, purchaseValue: price, status: f.status, notes: f.notes.trim() || null }); } finally { setBusy(false); }
  };

  return (
    <Modal open title={f.id ? 'Editar veículo' : 'Novo veículo'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={submit}>{f.id ? 'Salvar' : 'Cadastrar veículo'}</Button></>}>
      <div className="form-grid">
        <Field label="Tipo">{(id) => <Select id={id} value={f.kind} onChange={set('kind')} options={KINDS} />}</Field>
        <Field label="Status">{(id) => <Select id={id} value={f.status} onChange={set('status')} options={STATUSES} />}</Field>
        <Field label="Modelo" error={errors.model}>{(id) => <input id={id} className="input" value={f.model} onChange={set('model')} autoFocus placeholder="Ex.: Chevrolet Ônix, Honda CG 160" />}</Field>
        <Field label="Placa" error={errors.plate}>{(id) => <input id={id} className="input" value={f.plate} onChange={set('plate')} placeholder="ABC-1D23" maxLength={9} />}</Field>
        <Field label="Ano" error={errors.year} hint="Opcional">{(id) => <input id={id} className="input" inputMode="numeric" value={f.year} onChange={set('year')} placeholder="2021" maxLength={4} />}</Field>
        <Field label="Valor de compra (R$)" error={errors.purchaseValue} hint="Opcional">{(id) => <input id={id} className="input" inputMode="decimal" value={f.purchaseValue} onChange={set('purchaseValue')} placeholder="0,00" />}</Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Observações" hint="Opcional">{(id) => <textarea id={id} className="input" rows={2} maxLength={500} value={f.notes} onChange={set('notes')} />}</Field>
      </div>
    </Modal>
  );
}
