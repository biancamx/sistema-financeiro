import { useState } from 'react';
import { Button, Card, EmptyState, Field, Select } from '../../components/ui/ui.jsx';
import { vehicleLabel } from './vehicles.js';

const TYPES = [
  ['crlv', 'CRLV'], ['policy', 'Apólice'], ['purchase_invoice', 'Nota de compra'], ['other', 'Outro'],
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

export default function DocumentsTab({ documents, vehicles, selectedVehicleId, onUpload, onDelete }) {
  const [vehicleId, setVehicleId] = useState(selectedVehicleId || (vehicles.length === 1 ? vehicles[0].id : ''));
  const [name, setName] = useState('');
  const [type, setType] = useState('crlv');
  const [dueDate, setDueDate] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!vehicleId || !name.trim() || !file) {
      setError('Informe o veículo, o nome e selecione um arquivo.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('O arquivo deve ter até 10 MB.');
      return;
    }
    if (file.type && !allowedTypes.has(file.type)) {
      setError('Use um arquivo PDF, JPG, PNG ou WebP.');
      return;
    }
    setBusy(true);
    try {
      const saved = await onUpload({ vehicleId, name: name.trim(), type, dueDate: dueDate || undefined, file });
      if (saved !== false) {
        setName('');
        setDueDate('');
        setFile(null);
        event.target.reset();
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="veh-documents-stack">
      <Card title="Anexar documento">
        <form className="form-grid" onSubmit={submit}>
          <Field label="Veículo">{(id) => <Select id={id} value={vehicleId} onChange={setVehicleId} placeholder="Escolha…" options={vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicleLabel(vehicle) }))} />}</Field>
          <Field label="Nome">{(id) => <input id={id} className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Ex.: Seguro 2026" />}</Field>
          <Field label="Tipo">{(id) => <Select id={id} value={type} onChange={setType} options={TYPES.map(([value, label]) => ({ value, label }))} />}</Field>
          <Field label="Validade (opcional)">{(id) => <input id={id} className="input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />}</Field>
          <Field label="Arquivo (PDF ou imagem, até 10 MB)">{(id) => <input id={id} className="input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />}</Field>
          <div className="veh-document-submit">
            {error && <span className="field-error" role="alert">{error}</span>}
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Enviando…' : 'Anexar documento'}</Button>
          </div>
        </form>
      </Card>

      <Card title="Documentos">
        {documents.length === 0 ? (
          <EmptyState title="Nenhum documento anexado">Os documentos ficam disponíveis somente para quem pode acessar o veículo.</EmptyState>
        ) : (
          <div className="veh-document-list">
            {documents.map((document) => (
              <article className="veh-document" key={document.id}>
                <div>
                  <strong>{document.name}</strong>
                  <span className="muted small">{vehicleLabel(vehicles.find((vehicle) => vehicle.id === document.vehicleId) || { model: document.vehicleId })} · {document.typeLabel} · {(document.size / 1024 / 1024).toFixed(2)} MB</span>
                  {document.dueDate && <span className="muted small">Validade: {document.dueDate.split('-').reverse().join('/')}</span>}
                </div>
                <div className="inline">
                  <a className="btn btn-ghost btn-sm" href={document.fileUrl} target="_blank" rel="noreferrer">Visualizar</a>
                  <a className="btn btn-ghost btn-sm" href={document.downloadUrl}>Baixar</a>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(document)}>Excluir</Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
