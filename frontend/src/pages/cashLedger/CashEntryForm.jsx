import { useState } from 'react';
import { Button, Field, Modal, Select } from '../../components/ui/ui.jsx';
import { parseMoney } from '../../lib/format.js';

const TODAY = new Date().toISOString().slice(0, 10);
const METHODS = [
  { value: 'cash', label: 'Dinheiro' },
  { value: 'pix', label: 'Pix' },
  { value: 'debit', label: 'Débito' },
  { value: 'transfer', label: 'Transferência' },
];
const FREQUENCIES = [
  { value: 'monthly', label: 'Mensal' },
  { value: 'biweekly', label: 'Quinzenal' },
  { value: 'weekly', label: 'Semanal' },
];
const stringMoney = (value) => value == null ? '' : String(value).replace('.', ',');

export function emptyCashEntry(kind = 'expense') {
  return {
    kind, description: '', total: '', categoryId: '', personId: '', counterparty: '', entryDate: TODAY,
    paymentMethod: 'pix', downPayment: '', installmentCount: '1', firstDueDate: TODAY,
    frequency: 'monthly', loanTerm: 'date', interestRate: '0', protocol: '',
    expectedReturnDate: '', refundStatus: 'requested', vehicleId: '', notes: '',
  };
}

export function cashEntryToForm(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    description: entry.description,
    total: stringMoney(entry.total),
    categoryId: entry.categoryId ?? '',
    personId: entry.personId ?? '',
    counterparty: entry.counterparty ?? '',
    entryDate: entry.entryDate ?? TODAY,
    paymentMethod: entry.paymentMethod ?? 'pix',
    downPayment: stringMoney((entry.downPaymentCents ?? 0) / 100),
    installmentCount: String(entry.installmentCount ?? 1),
    firstDueDate: entry.firstDueDate ?? '',
    frequency: entry.frequency ?? 'monthly',
    loanTerm: entry.loanTerm ?? 'date',
    interestRate: stringMoney(entry.interestRate ?? 0),
    protocol: entry.protocol ?? '',
    expectedReturnDate: entry.expectedReturnDate ?? '',
    refundStatus: entry.refundStatus ?? 'requested',
    vehicleId: entry.vehicleId ?? '',
    notes: entry.notes ?? '',
  };
}

export default function CashEntryForm({ value, onClose, onSubmit, lookups }) {
  const [form, setForm] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const isEdit = Boolean(form.id);
  const amount = parseMoney(form.total);
  const count = Number(form.installmentCount);
  const setTotal = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const personRequired = ['sale', 'loan'].includes(form.kind);

  const submit = async () => {
    setError('');
    if (!form.description.trim()) return setError('Informe a descrição.');
    if (!(amount > 0)) return setError('Informe um valor maior que zero.');
    if (!form.entryDate) return setError('Informe a data.');
    if (personRequired && !form.personId) return setError('Selecione a pessoa.');
    if (form.kind === 'sale' && (parseMoney(form.downPayment) < 0 || parseMoney(form.downPayment) > amount)) return setError('A entrada deve estar entre zero e o valor total.');
    if (['sale', 'loan'].includes(form.kind) && !Number.isInteger(count)) return setError('Informe a quantidade de parcelas.');
    if (form.kind === 'sale' && !form.firstDueDate) return setError('Informe o vencimento da primeira parcela.');
    if (form.kind === 'loan' && form.loanTerm !== 'none' && !form.firstDueDate) return setError('Informe a data de pagamento.');
    if (form.kind === 'refund' && !form.personId && !form.counterparty.trim()) return setError('Informe a empresa ou pessoa devedora.');
    setBusy(true);
    try {
      await onSubmit({
        ...form,
        total: amount,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        personId: form.personId ? Number(form.personId) : null,
        vehicleId: form.vehicleId ? Number(form.vehicleId) : null,
        downPayment: parseMoney(form.downPayment || 0),
        installmentCount: count || 1,
        interestRate: Number(String(form.interestRate || '0').replace(',', '.')),
        firstDueDate: form.kind === 'loan' && form.loanTerm === 'none' ? null : form.firstDueDate || null,
        expectedReturnDate: form.expectedReturnDate || null,
        entryDate: form.entryDate,
      });
    } catch (submitError) {
      setError(submitError.message || 'Não foi possível salvar o registro.');
    } finally {
      setBusy(false);
    }
  };

  const personOptions = lookups.people.map((person) => ({ value: person.id, label: person.name }));
  const categoryOptions = lookups.categories.map((category) => ({ value: category.id, label: category.name }));
  const vehicleOptions = lookups.vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.model} · ${vehicle.plate}` }));
  const title = form.kind === 'expense' ? 'Compra avulsa' : form.kind === 'sale' ? 'Venda' : form.kind === 'loan' ? 'Empréstimo' : 'Reembolso / estorno';
  const kindOptions = [
    { value: 'expense', label: 'Compra avulsa (saída)' },
    { value: 'sale', label: 'Venda (a receber)' },
    { value: 'loan', label: 'Empréstimo (a receber)' },
    { value: 'refund', label: 'Reembolso / estorno' },
  ];

  return (
    <Modal open title={`${isEdit ? 'Editar' : 'Novo registro'}${isEdit ? ` · ${title}` : ''}`} onClose={onClose} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={submit}>{busy ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Registrar'}</Button></>}>
      <div className="form-grid">
        {!isEdit && <Field label="Tipo">{(id) => <Select id={id} value={form.kind} onChange={(kind) => setForm((current) => ({ ...emptyCashEntry(kind), description: current.description, total: current.total, entryDate: current.entryDate }))} options={kindOptions} />}</Field>}
        <Field label={form.kind === 'sale' ? 'Item vendido' : 'Descrição'}>{(id) => <input id={id} className="input" maxLength={160} value={form.description} onChange={set('description')} autoFocus />}</Field>
        <Field label={form.kind === 'sale' ? 'Valor total (R$)' : form.kind === 'loan' ? 'Valor emprestado (R$)' : 'Valor (R$)'}>
          {(id) => <input id={id} className="input" inputMode="decimal" value={form.total} onChange={setTotal('total')} placeholder="0,00" />}
        </Field>
        <Field label={form.kind === 'expense' ? 'Data' : form.kind === 'sale' ? 'Data da venda' : form.kind === 'loan' ? 'Data do empréstimo' : 'Data do pagamento indevido'}>
          {(id) => <input id={id} className="input" type="date" value={form.entryDate} onChange={set('entryDate')} />}
        </Field>
        {form.kind === 'expense' && <>
          <Field label="Forma de pagamento">{(id) => <Select id={id} value={form.paymentMethod} onChange={set('paymentMethod')} options={METHODS} />}</Field>
          <Field label="Categoria">{(id) => <Select id={id} value={form.categoryId} onChange={set('categoryId')} placeholder="Sem categoria" options={categoryOptions} />}</Field>
        </>}
        {personRequired && <Field label={form.kind === 'sale' ? 'Comprador' : 'Quem pegou'}>{(id) => <Select id={id} value={form.personId} onChange={set('personId')} placeholder="Selecione uma pessoa" options={personOptions} />}</Field>}
        {['sale', 'loan'].includes(form.kind) && <>
          <Field label={form.kind === 'sale' ? 'Forma de recebimento' : 'Como entreguei'}>{(id) => <Select id={id} value={form.paymentMethod} onChange={set('paymentMethod')} options={METHODS} />}</Field>
          {form.kind === 'sale' && <Field label="Entrada (R$), opcional">{(id) => <input id={id} className="input" inputMode="decimal" value={form.downPayment} onChange={set('downPayment')} placeholder="0,00" />}</Field>}
          {form.kind === 'loan' && <Field label="Condição de pagamento">{(id) => <Select id={id} value={form.loanTerm} onChange={set('loanTerm')} options={[
            { value: 'date', label: 'À vista em uma data' },
            { value: 'installments', label: 'Parcelado' },
            { value: 'none', label: 'Sem prazo definido' },
          ]} />}</Field>}
          {(form.kind === 'sale' || form.loanTerm !== 'none') && <>
            {form.kind === 'sale' && <Field label="Número de parcelas">{(id) => <input id={id} className="input" type="number" min="1" max="240" value={form.installmentCount} onChange={set('installmentCount')} />}</Field>}
            {form.kind === 'loan' && form.loanTerm === 'installments' && <Field label="Número de parcelas">{(id) => <input id={id} className="input" type="number" min="1" max="240" value={form.installmentCount} onChange={set('installmentCount')} />}</Field>}
            <Field label={form.kind === 'sale' ? 'Vencimento da 1ª parcela' : 'Data / 1º vencimento'}>{(id) => <input id={id} className="input" type="date" value={form.firstDueDate} onChange={set('firstDueDate')} />}</Field>
            {((form.kind === 'sale' && Number(form.installmentCount) > 1) || (form.kind === 'loan' && form.loanTerm === 'installments')) && <Field label="Periodicidade">{(id) => <Select id={id} value={form.frequency} onChange={set('frequency')} options={FREQUENCIES} />}</Field>}
          </>}
          {form.kind === 'loan' && <Field label="Juros simples (% ao mês), opcional">{(id) => <input id={id} className="input" inputMode="decimal" value={form.interestRate} onChange={set('interestRate')} />}</Field>}
        </>}
        {form.kind === 'sale' && <Field label="Vincular veículo vendido">{(id) => <Select id={id} value={form.vehicleId} onChange={set('vehicleId')} placeholder="Não vincular veículo" options={vehicleOptions} />}</Field>}
        {form.kind === 'refund' && <>
          <Field label="Pessoa cadastrada (opcional)">{(id) => <Select id={id} value={form.personId} onChange={set('personId')} placeholder="Empresa ou pessoa em texto livre" options={personOptions} />}</Field>
          {!form.personId && <Field label="Empresa / pessoa devedora">{(id) => <input id={id} className="input" maxLength={120} value={form.counterparty} onChange={set('counterparty')} />}</Field>}
          <Field label="Número do protocolo">{(id) => <input id={id} className="input" maxLength={120} value={form.protocol} onChange={set('protocol')} />}</Field>
          <Field label="Previsão de devolução">{(id) => <input id={id} className="input" type="date" value={form.expectedReturnDate} onChange={set('expectedReturnDate')} />}</Field>
        </>}
        <Field label="Observação">{(id) => <textarea id={id} className="input" rows="3" maxLength={2000} value={form.notes} onChange={set('notes')} />}</Field>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Modal>
  );
}
