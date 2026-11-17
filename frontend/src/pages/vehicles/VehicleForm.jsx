import { useEffect, useRef, useState } from 'react';
import { Bike, Car, CircleHelp, ImagePlus, Trash2, Truck } from 'lucide-react';
import { Button, Field, Modal, Select } from '../../components/ui/ui.jsx';
import { parseMoney } from '../../lib/format.js';
import { KINDS, STATUSES } from './vehicles.js';
import { validateVehiclePhoto } from './vehiclePhoto.js';

export const emptyVehicle = () => ({
  kind: 'car', model: '', plate: '', year: '', purchaseValue: '', currentKm: '', insuranceDueDate: '',
  ownerId: '', status: 'active', notes: '', photoUrl: null,
});
export const vehicleToForm = (v) => ({
  id: v.id, kind: v.kind, model: v.model, plate: v.plate, year: v.year ? String(v.year) : '',
  purchaseValue: v.purchaseValue ? String(v.purchaseValue).replace('.', ',') : '', ownerId: v.ownerId == null ? '' : String(v.ownerId),
  currentKm: v.currentKm == null ? '' : String(v.currentKm), insuranceDueDate: v.insuranceDueDate || '',
  status: v.status, notes: v.notes || '', photoUrl: v.photoUrl || null,
});

/** Ficha do veículo: cadastro e edição (placa, modelo, ano, valor de compra, status). */
export default function VehicleForm({ value, people, onClose, onSubmit }) {
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [draggingPhoto, setDraggingPhoto] = useState(false);
  const photoInput = useRef(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));

  useEffect(() => {
    if (!photoFile) {
      setPhotoUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const choosePhoto = (file) => {
    if (!file) return;
    try {
      validateVehiclePhoto(file);
      setPhotoFile(file);
      setRemovePhoto(false);
      setPhotoError('');
    } catch (error) {
      setPhotoError(error.message);
    }
  };
  const displayedPhoto = photoUrl || (removePhoto ? null : f.photoUrl);
  const KindIcon = f.kind === 'motorcycle' ? Bike : f.kind === 'utility' ? Truck : f.kind === 'other' ? CircleHelp : Car;

  const submit = async () => {
    const e = {};
    const plate = f.plate.toUpperCase().replace(/[\s-]/g, '');
    const year = f.year ? Number(f.year) : null;
    const price = f.purchaseValue ? parseMoney(f.purchaseValue) : 0;
    if (!f.model.trim()) e.model = 'Informe o modelo';
    if (!/^[A-Z0-9]{5,8}$/.test(plate)) e.plate = 'Placa inválida (ex.: ABC-1D23)';
    if (year !== null && !(year >= 1900 && year <= new Date().getFullYear() + 1)) e.year = 'Ano inválido';
    if (!Number.isFinite(price) || price < 0) e.purchaseValue = 'Valor inválido';
    const currentKm = f.currentKm === '' ? null : Number(f.currentKm);
    if (currentKm !== null && (!Number.isInteger(currentKm) || currentKm < 0 || currentKm > 5_000_000)) e.currentKm = 'KM inválido';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await onSubmit({
        kind: f.kind, model: f.model.trim(), plate, year, purchaseValue: price,
        currentKm, insuranceDueDate: f.insuranceDueDate || null,
        ownerId: f.ownerId || null, status: f.status, notes: f.notes.trim() || null,
      }, { photoFile, removePhoto });
    } finally { setBusy(false); }
  };

  return (
    <Modal open title={f.id ? 'Editar veículo' : 'Novo veículo'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={submit}>{f.id ? 'Salvar' : 'Cadastrar veículo'}</Button></>}>
      <div
        className={`vehicle-photo-dropzone${draggingPhoto ? ' is-dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDraggingPhoto(true); }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDraggingPhoto(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingPhoto(false);
          choosePhoto(event.dataTransfer.files?.[0]);
        }}
      >
        <div className="vehicle-photo-preview">
          {displayedPhoto
            ? <img src={displayedPhoto} alt="Prévia da foto do veículo" />
            : <KindIcon aria-hidden="true" />}
        </div>
        <div className="vehicle-photo-copy">
          <strong>Foto do veículo <span className="muted small">· opcional</span></strong>
          <p>Arraste uma imagem ou escolha um arquivo. JPG, PNG ou WebP, até 5 MB.</p>
          <div className="inline">
            <Button size="sm" onClick={() => photoInput.current?.click()} disabled={busy}>
              <ImagePlus aria-hidden="true" /> Escolher foto
            </Button>
            {(displayedPhoto || photoFile) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (photoFile) setPhotoFile(null);
                  else setRemovePhoto(true);
                  setPhotoError('');
                }}
                disabled={busy}
              >
                <Trash2 aria-hidden="true" /> Remover
              </Button>
            )}
          </div>
          <input
            ref={photoInput}
            className="vehicle-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              choosePhoto(event.target.files?.[0]);
              event.target.value = '';
            }}
            aria-label="Escolher foto do veículo"
          />
          {photoError && <p className="field-error" role="alert">{photoError}</p>}
        </div>
      </div>
      <div className="form-grid">
        <Field label="Tipo">{(id) => <Select id={id} value={f.kind} onChange={set('kind')} options={KINDS} />}</Field>
        <Field label="Status">{(id) => <Select id={id} value={f.status} onChange={set('status')} options={STATUSES} />}</Field>
        <Field label="Proprietário" hint="Opcional">{(id) => <Select id={id} value={f.ownerId} onChange={set('ownerId')} placeholder="Sem proprietário informado" options={people.map((person) => ({ value: person.id, label: person.name }))} />}</Field>
        <Field label="Modelo" error={errors.model}>{(id) => <input id={id} className="input" value={f.model} onChange={set('model')} autoFocus placeholder="Ex.: Chevrolet Ônix, Honda CG 160" />}</Field>
        <Field label="Placa" error={errors.plate}>{(id) => <input id={id} className="input" value={f.plate} onChange={set('plate')} placeholder="ABC-1D23" maxLength={9} />}</Field>
        <Field label="Ano" error={errors.year} hint="Opcional">{(id) => <input id={id} className="input" inputMode="numeric" value={f.year} onChange={set('year')} placeholder="2021" maxLength={4} />}</Field>
        <Field label="Valor de compra (R$)" error={errors.purchaseValue} hint="Opcional">{(id) => <input id={id} className="input" inputMode="decimal" value={f.purchaseValue} onChange={set('purchaseValue')} placeholder="0,00" />}</Field>
        <Field label="KM atual" error={errors.currentKm} hint="Opcional; atualiza automaticamente com gastos de KM maior">{(id) => <input id={id} className="input" inputMode="numeric" value={f.currentKm} onChange={(event) => setF((current) => ({ ...current, currentKm: event.target.value.replace(/\D/g, '') }))} placeholder="Ex.: 41200" />}</Field>
        <Field label="Vencimento do seguro" hint="Opcional">{(id) => <input id={id} className="input" type="date" value={f.insuranceDueDate} onChange={set('insuranceDueDate')} />}</Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Observações" hint="Opcional">{(id) => <textarea id={id} className="input" rows={2} maxLength={500} value={f.notes} onChange={set('notes')} />}</Field>
      </div>
    </Modal>
  );
}
