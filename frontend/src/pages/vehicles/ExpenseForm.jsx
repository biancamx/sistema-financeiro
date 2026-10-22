import { useMemo, useState } from 'react';
import { Button, Field, Modal, Select } from '../../components/ui/ui.jsx';
import { money, parseMoney } from '../../lib/format.js';
import { showKm, todayIso, vehicleLabel } from './vehicles.js';

export const emptyExpense = (defaults = {}) => {
  const date = todayIso();
  return {
    vehicleId: defaults.vehicleId ? String(defaults.vehicleId) : '', date, category: '', description: '', amount: '', km: '',
    payerId: '', paymentMethod: 'cash', cardId: '', installmentCount: '1',
    requestId: globalThis.crypto.randomUUID(), shared: false, participantIds: [], splitMode: 'equal', values: {},
  };
};

export const expenseToForm = (e) => ({
  id: e.id, requestId: e.requestId, vehicleId: e.vehicleId == null ? '' : String(e.vehicleId), date: e.date, category: e.category, description: e.description || '',
  amount: String(e.amount).replace('.', ','), km: e.km == null ? '' : String(e.km), payerId: e.payerId == null ? '' : String(e.payerId),
  paymentMethod: e.paymentMethod || 'cash', cardId: e.cardId == null ? '' : String(e.cardId), installmentCount: String(e.installmentCount || 1),
  shared: e.shared, participantIds: e.shared ? e.shares.map((s) => String(s.personId)) : [],
  // divisão desigual volta como "valor em R$" (exato, sem arredondar porcentagem)
  splitMode: e.shared && e.splitMode !== 'equal' ? 'amount' : 'equal',
  values: Object.fromEntries(e.shares.map((s) => [String(s.personId), String(s.amount).replace('.', ',')])),
});

const fmtNum = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Valores iguais para cada pessoa (porcentagem ou R$), com os centavos que sobram nas primeiras pessoas. */
function equalValues(mode, ids, total) {
  const unit = mode === 'percent' ? 10000 : Math.round((Number.isFinite(total) ? total : 0) * 100);
  const n = ids.length || 1;
  const base = Math.floor(unit / n);
  const rest = unit - base * n;
  return Object.fromEntries(ids.map((id, i) => [id, fmtNum((base + (i < rest ? 1 : 0)) / 100)]));
}

export default function ExpenseForm({ value, onClose, onSubmit, vehicles, people, categories, cards }) {
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));

  const amount = parseMoney(f.amount);
  const n = f.participantIds.length;
  const custom = f.shared && f.splitMode !== 'equal';
  const vals = f.participantIds.map((id) => parseMoney(f.values[id]));
  const sum = vals.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const target = f.splitMode === 'percent' ? 100 : amount;
  const diff = Math.round((target - sum) * 100) / 100;
  const splitOk = !custom || (vals.every((v) => v > 0) && Math.abs(diff) < 0.01);
  const weights = custom ? vals : f.participantIds.map(() => 1);
  const wSum = weights.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const shareOf = (i) => (wSum > 0 && amount > 0 ? (amount * weights[i]) / wSum : 0);
  const exact = !custom && n > 0 && Math.round(amount * 100) % n === 0;
  const nameOf = (id) => people.find((x) => x.id === id)?.name;
  const cardOf = (id) => cards.find((card) => card.id === id);
  const chooseCard = (value) => {
    const card = cardOf(value);
    setF((current) => ({
      ...current,
      cardId: value || '',
      ...(card?.ownerId ? { payerId: String(card.ownerId) } : {}),
    }));
  };

  const vehicle = vehicles.find((v) => v.id === f.vehicleId);
  const km = f.km === '' ? null : Number(f.km);
  const kmLow = vehicle?.currentKm != null && km != null && km < vehicle.currentKm;

  const groups = useMemo(() => categories.groups.map((g) => ({ ...g, items: categories.categories.filter((c) => c.group === g.key) })), [categories]);

  const setIds = (ids, mode = f.splitMode) => setF((s) => ({ ...s, participantIds: ids, splitMode: mode, values: mode === 'equal' ? s.values : equalValues(mode, ids, amount) }));
  const toggle = (id) => setIds(f.participantIds.includes(id) ? f.participantIds.filter((x) => x !== id) : [...f.participantIds, id]);
  const changeMode = (mode) => {
    if (mode === f.splitMode) return;
    setF((s) => {
      if (mode === 'equal') return { ...s, splitMode: mode };
      if (s.splitMode !== 'equal' && amount > 0) {
        const conv = Object.fromEntries(s.participantIds.map((id) => {
          const v = parseMoney(s.values[id]);
          return [id, fmtNum(mode === 'percent' ? (v / amount) * 100 : (v / 100) * amount)];
        }));
        return { ...s, splitMode: mode, values: conv };
      }
      return { ...s, splitMode: mode, values: equalValues(mode, s.participantIds, amount) };
    });
  };

  const submit = async () => {
    const e = {};
    if (!f.vehicleId) e.vehicleId = 'Escolha o veículo';
    if (!f.date) e.date = 'Informe a data';
    if (!f.category) e.category = 'Escolha a categoria';
    if (!(amount >= 1)) e.amount = 'O valor mínimo é R$ 1,00';
    if (f.km !== '' && !(Number.isInteger(km) && km >= 0)) e.km = 'KM inválido';
    if (!f.payerId) e.payerId = 'Informe quem pagou';
    if (f.paymentMethod === 'card' && !f.cardId) e.cardId = 'Escolha o cartão';
    if (f.paymentMethod === 'card' && !(Number.isInteger(Number(f.installmentCount)) && Number(f.installmentCount) >= 1 && Number(f.installmentCount) <= 120)) {
      e.installmentCount = 'Informe de 1 a 120 parcelas';
    }
    if (f.shared && n < 2) e.participantIds = 'Escolha pelo menos 2 pessoas';
    else if (f.shared && !splitOk) e.participantIds = f.splitMode === 'percent' ? 'As porcentagens precisam somar 100% e cada pessoa precisa ter mais que 0' : 'Os valores precisam somar o valor do gasto e cada pessoa precisa ter mais que 0';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = {
        vehicleId: f.vehicleId, date: f.date, category: f.category, description: f.description.trim(),
        amount, km, payerId: f.payerId, shared: f.shared, paymentMethod: f.paymentMethod,
        ...(f.paymentMethod === 'card' && {
          cardId: f.cardId, installmentCount: Number(f.installmentCount),
        }),
        ...(!f.id && { requestId: f.requestId }),
      };
      await onSubmit(f.shared
        ? { ...body, splitMode: f.splitMode, participants: f.participantIds.map((id, i) => ({ personId: id, ...(custom && { value: vals[i] }) })) }
        : body);
    } finally { setBusy(false); }
  };

  const personOpts = people.map((x) => ({ value: x.id, label: x.name }));
  return (
    <Modal open title={f.id ? 'Editar gasto' : 'Novo gasto'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={submit}>{f.id ? 'Salvar alterações' : 'Registrar gasto'}</Button></>}>
      <div className="form-grid">
        <Field label="Data" error={errors.date}>{(id) => <input id={id} className="input" type="date" value={f.date} onChange={set('date')} />}</Field>
        <Field label="Veículo" error={errors.vehicleId}>
          {(id) => <Select id={id} value={f.vehicleId} onChange={set('vehicleId')} placeholder="Escolha…" options={vehicles.map((v) => ({ value: v.id, label: vehicleLabel(v) }))} />}
        </Field>
        <Field label="Categoria do gasto" error={errors.category}>
          {(id) => (
            <select id={id} className="input" value={f.category} onChange={set('category')}>
              <option value="">Escolha…</option>
              {groups.map((g) => <optgroup key={g.key} label={g.label}>{g.items.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
            </select>
          )}
        </Field>
        <Field label="Valor (R$)" error={errors.amount} hint="A partir de R$ 1,00">{(id) => <input id={id} className="input" inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="0,00" />}</Field>
        <Field label="Descrição" error={errors.description}>{(id) => <input id={id} className="input" value={f.description} onChange={set('description')} maxLength={200} placeholder="Ex.: Gasolina aditivada — Posto Ipiranga" />}</Field>
        <Field label="KM atual" error={errors.km} hint={kmLow ? `Menor que o último registrado (${showKm(vehicle.currentKm)}). Confira o odômetro.` : vehicle?.currentKm != null ? `Último registrado: ${showKm(vehicle.currentKm)}` : 'Opcional'}>
          {(id) => <input id={id} className="input" inputMode="numeric" value={f.km} onChange={(e) => setF((s) => ({ ...s, km: e.target.value.replace(/\D/g, '') }))} placeholder="Ex.: 41200" />}
        </Field>
        <Field label="Pessoa responsável / pagadora" error={errors.payerId}>{(id) => <Select id={id} value={f.payerId} onChange={set('payerId')} placeholder="Escolha…" options={personOpts} />}</Field>
        <Field label="Forma de pagamento">
          {(id) => <Select id={id} value={f.paymentMethod} onChange={set('paymentMethod')} options={[{ value: 'cash', label: 'Dinheiro / outro' }, { value: 'card', label: 'Cartão de crédito' }]} />}
        </Field>
        {f.paymentMethod === 'card' && (
          <>
            <Field label="Cartão de crédito" error={errors.cardId}>
              {(id) => <Select id={id} value={f.cardId} onChange={chooseCard} placeholder="Escolha o cartão…" options={cards.map((card) => ({ value: card.id, label: `${card.name}${card.owner ? ` · ${card.owner}` : ''}` }))} />}
            </Field>
            <Field label="Número de parcelas" error={errors.installmentCount} hint="A despesa será lançada como parcelas em aberto">
              {(id) => <input id={id} className="input" type="number" min="1" max="120" step="1" value={f.installmentCount} onChange={set('installmentCount')} />}
            </Field>
          </>
        )}
      </div>
      {f.paymentMethod === 'card' && <p className="field-hint">A compra e as parcelas serão criadas automaticamente em Lançamentos e na Planilha mensal. A data deste gasto e o fechamento do cartão definem a primeira fatura. Em despesas compartilhadas, o valor de cada parcela seguirá o rateio escolhido acima.</p>}

      <label className="share-toggle">
        <input type="checkbox" checked={f.shared} onChange={(e) => setF((s) => ({ ...s, shared: e.target.checked, participantIds: e.target.checked ? s.participantIds : [], splitMode: 'equal', values: {} }))} />
        <span><strong>Despesa compartilhada</strong> — dividir entre membros da casa/equipe{!f.shared && ' (sem marcar, quem pagou assume o gasto sozinho)'}</span>
      </label>

      {f.shared && (
        <fieldset className="people-pick">
          <legend className="field-label">Quem divide este gasto?</legend>
          <div className="people-pick-list">
            {people.map((x) => (
              <label key={x.id} className={`pick ${f.participantIds.includes(x.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={f.participantIds.includes(x.id)} onChange={() => toggle(x.id)} />
                {x.name}
              </label>
            ))}
            {people.length > 2 && <button type="button" className="link-btn" onClick={() => setIds(people.map((x) => x.id))}>Selecionar todos</button>}
          </div>

          <div className="split-modes" role="group" aria-label="Como dividir">
            {[['equal', 'Partes iguais'], ['percent', 'Por porcentagem (%)'], ['amount', 'Por valor (R$)']].map(([m, label]) => (
              <button key={m} type="button" className={`pick ${f.splitMode === m ? 'on' : ''}`} aria-pressed={f.splitMode === m} onClick={() => changeMode(m)}>{label}</button>
            ))}
          </div>

          {n >= 2 && (
            <ul className="split-list">
              {f.participantIds.map((id, i) => (
                <li key={id}>
                  <span className="split-name">{nameOf(id)}</span>
                  {custom && (
                    <span className="split-input">
                      {f.splitMode === 'amount' && <span className="muted">R$</span>}
                      <input className="input input-sm" inputMode="decimal" aria-label={`Parte de ${nameOf(id)}`} value={f.values[id] ?? ''} onChange={(e) => { const v = e.target.value; setF((s) => ({ ...s, values: { ...s.values, [id]: v } })); }} />
                      {f.splitMode === 'percent' && <span className="muted">%</span>}
                    </span>
                  )}
                  <span className="split-result">{amount > 0 ? <>{exact || custom ? '' : '≈ '}{money(shareOf(i))}</> : '—'}</span>
                </li>
              ))}
            </ul>
          )}

          {custom && n >= 2 && (
            <div className="split-sum">
              <span className={Math.abs(diff) < 0.01 ? 'ok' : 'bad'}>
                {f.splitMode === 'percent' ? `Soma: ${fmtNum(sum)}% de 100%` : `Soma: ${money(sum)} de ${money(amount || 0)}`}
                {Math.abs(diff) >= 0.01 && (diff > 0 ? ` — faltam ${f.splitMode === 'percent' ? `${fmtNum(diff)}%` : money(diff)}` : ` — passou ${f.splitMode === 'percent' ? `${fmtNum(-diff)}%` : money(-diff)}`)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setIds(f.participantIds)}>Dividir igualmente</Button>
            </div>
          )}

          {errors.participantIds ? <span className="field-error">{errors.participantIds}</span>
            : <span className="field-hint">Os centavos são acertados pelo sistema e a soma sempre fecha no valor do gasto. Quem pagou recebe dos demais a parte de cada um (veja “Acerto entre pessoas” no resumo).</span>}
        </fieldset>
      )}
    </Modal>
  );
}
