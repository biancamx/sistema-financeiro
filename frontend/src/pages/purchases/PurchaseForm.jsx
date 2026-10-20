import { useState } from 'react';
import { Button, Field, Modal, Select } from '../../components/ui/ui.jsx';
import { MONTHS, MONTHS_SHORT, money, parseMoney, yearsAround } from '../../lib/format.js';

export const emptyPurchase = (period, defaults = {}) => ({
  description: '', categoryId: '', personId: defaults.personId || '', cardId: defaults.cardId || '',
  purchaseDate: '', total: '', count: '1', startMonth: period.month, startYear: period.year,
  shared: false, participantIds: [], splitMode: 'equal', values: {},
});

export function toForm(p) {
  return {
    id: p.id, description: p.description, categoryId: p.categoryId || '', personId: p.personId, cardId: p.cardId,
    purchaseDate: p.purchaseDate || '', total: String(p.total).replace('.', ','), count: String(p.count),
    startMonth: p.first?.month || 1, startYear: p.first?.year || new Date().getFullYear(),
    shared: false, participantIds: [], splitMode: 'equal', values: {},
  };
}

/** Formulário de edição de uma compra compartilhada (o valor é o total do grupo, não a fatia de uma pessoa). */
export function toSharedForm(g) {
  return {
    group: g.group, description: g.description, categoryId: g.categoryId || '', personId: '', cardId: g.cardId,
    purchaseDate: g.purchaseDate || '', total: String(g.total).replace('.', ','), count: String(g.count),
    startMonth: g.first?.month || 1, startYear: g.first?.year || new Date().getFullYear(),
    shared: true, participantIds: g.participants.map((x) => x.personId),
    // divisão desigual volta como "valor em R$" (exato, sem arredondar porcentagem)
    splitMode: g.splitMode === 'equal' ? 'equal' : 'amount',
    values: Object.fromEntries(g.participants.map((x) => [x.personId, String(x.total).replace('.', ',')])),
  };
}

const fmtNum = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Valores iguais para cada pessoa (porcentagem ou R$), com os centavos que sobram nas primeiras pessoas. */
function equalValues(mode, ids, total) {
  const unit = mode === 'percent' ? 10000 : Math.round((Number.isFinite(total) ? total : 0) * 100);
  const n = ids.length || 1;
  const base = Math.floor(unit / n);
  const rest = unit - base * n;
  return Object.fromEntries(ids.map((id, i) => [id, fmtNum((base + (i < rest ? 1 : 0)) / 100)]));
}

export default function PurchaseForm({ value, onClose, onSubmit, lookups }) {
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const setCard = (cardId) => {
    const card = lookups.cards.find((item) => String(item.id) === cardId);
    setF((current) => ({ ...current, cardId, ...(card?.ownerId && { personId: String(card.ownerId) }) }));
  };

  const total = parseMoney(f.total);
  const count = Number(f.count);
  const editing = Boolean(f.id || f.group);
  const n = f.participantIds.length;
  const valid = f.description.trim() && (f.shared ? n >= 2 : f.personId) && f.cardId && total > 0 && count >= 1;
  const perInstallment = total / count;
  const custom = f.shared && f.splitMode !== 'equal';
  const vals = f.participantIds.map((id) => parseMoney(f.values[id]));
  const sum = vals.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const target = f.splitMode === 'percent' ? 100 : total;
  const diff = Math.round((target - sum) * 100) / 100;
  const splitOk = !custom || (vals.every((v) => v > 0) && Math.abs(diff) < 0.01);
  // quanto cada pessoa paga por mês (aproximado: o sistema acerta os centavos parcela a parcela)
  const weights = custom ? vals : f.participantIds.map(() => 1);
  const wSum = weights.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const monthlyOf = (i) => (wSum > 0 ? (perInstallment * weights[i]) / wSum : 0);
  const exactSplit = !custom && n > 0 && Math.round(perInstallment * 100) % n === 0;

  const setIds = (ids, mode = f.splitMode) => setF((s) => ({ ...s, participantIds: ids, splitMode: mode, values: mode === 'equal' ? s.values : equalValues(mode, ids, total) }));
  const toggleParticipant = (id) => setIds(f.participantIds.includes(id) ? f.participantIds.filter((x) => x !== id) : [...f.participantIds, id]);
  const changeMode = (mode) => {
    if (mode === f.splitMode) return;
    setF((s) => {
      if (mode === 'equal') return { ...s, splitMode: mode };
      // porcentagem ↔ valor: converte o que já foi digitado; vindo de "igual", começa dividindo igualmente
      if (s.splitMode !== 'equal' && total > 0) {
        const conv = Object.fromEntries(s.participantIds.map((id) => {
          const v = parseMoney(s.values[id]);
          return [id, fmtNum(mode === 'percent' ? (v / total) * 100 : (v / 100) * total)];
        }));
        return { ...s, splitMode: mode, values: conv };
      }
      return { ...s, splitMode: mode, values: equalValues(mode, s.participantIds, total) };
    });
  };
  const endIdx = f.startYear * 12 + (f.startMonth - 1) + Math.max(count - 1, 0);
  const end = { year: Math.floor(endIdx / 12), month: (endIdx % 12) + 1 };

  const submit = async () => {
    const e = {};
    if (!f.description.trim()) e.description = 'Informe a descrição';
    if (f.shared && n < 2) e.participantIds = 'Escolha pelo menos 2 pessoas';
    else if (f.shared && !splitOk) e.participantIds = f.splitMode === 'percent' ? 'As porcentagens precisam somar 100% e cada pessoa precisa ter mais que 0' : 'Os valores precisam somar o total da compra e cada pessoa precisa ter mais que 0';
    if (!f.shared && !f.personId) e.personId = 'Escolha a pessoa';
    if (!f.cardId) e.cardId = 'Escolha o cartão';
    if (!(total > 0)) e.total = 'Informe um valor maior que zero';
    if (!(count >= 1 && count <= 120)) e.count = 'Entre 1 e 120 parcelas';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = {
        description: f.description.trim(), categoryId: f.categoryId ? Number(f.categoryId) : null,
        cardId: Number(f.cardId), purchaseDate: f.purchaseDate || null,
        total, count, startMonth: Number(f.startMonth), startYear: Number(f.startYear),
      };
      await onSubmit(f.shared
        ? { ...body, splitMode: f.splitMode, participants: f.participantIds.map((id, i) => ({ personId: Number(id), ...(custom && { value: vals[i] }) })) }
        : { ...body, personId: Number(f.personId) });
    } finally { setBusy(false); }
  };

  const opt = (list) => list.map((x) => ({ value: x.id, label: x.name }));
  return (
    <Modal open title={editing ? (f.shared ? 'Editar compra compartilhada' : 'Editar compra') : 'Nova compra'} onClose={onClose} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={submit}>{editing ? 'Salvar alterações' : 'Registrar compra'}</Button></>}>
      <div className="form-grid">
        <Field label="Descrição" error={errors.description}>{(id) => <input id={id} className="input" value={f.description} onChange={set('description')} autoFocus placeholder="Ex.: Shopee, Mercado, Uber" />}</Field>
        <Field label="Categoria">{(id) => <Select id={id} value={f.categoryId} onChange={set('categoryId')} placeholder="Sem categoria" options={opt(lookups.categories)} />}</Field>
        {!f.shared && <Field label="Pessoa" error={errors.personId}>{(id) => <Select id={id} value={f.personId} onChange={set('personId')} placeholder="Escolha…" options={opt(lookups.people)} />}</Field>}
        <Field label="Cartão" error={errors.cardId}>{(id) => <Select id={id} value={f.cardId} onChange={setCard} placeholder="Escolha…" options={opt(lookups.cards)} />}</Field>
        <Field label="Valor total (R$)" error={errors.total}>{(id) => <input id={id} className="input" inputMode="decimal" value={f.total} onChange={set('total')} placeholder="0,00" />}</Field>
        <Field label="Parcelas" error={errors.count}>{(id) => <input id={id} className="input" inputMode="numeric" value={f.count} onChange={set('count')} />}</Field>
        <Field label="Primeira parcela em">
          {(id) => (
            <div className="inline">
              <Select id={id} value={f.startMonth} onChange={(v) => set('startMonth')(Number(v))} options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} />
              <Select value={f.startYear} onChange={(v) => set('startYear')(Number(v))} options={yearsAround().map((y) => ({ value: y, label: y }))} aria-label="Ano" />
            </div>
          )}
        </Field>
        <Field label="Data da compra" hint="Opcional">{(id) => <input id={id} className="input" type="date" value={f.purchaseDate} onChange={set('purchaseDate')} />}</Field>
      </div>

      {!editing && (
        <label className="share-toggle">
          <input type="checkbox" checked={f.shared} onChange={(e) => setF((s) => ({ ...s, shared: e.target.checked, participantIds: e.target.checked ? s.participantIds : [], splitMode: 'equal', values: {} }))} />
          <span><strong>Compra compartilhada</strong> — dividir entre várias pessoas (você escolhe quanto cada uma paga)</span>
        </label>
      )}
      {f.shared && (
        <fieldset className="people-pick">
          <legend className="field-label">Quem divide esta compra?</legend>
          <div className="people-pick-list">
            {lookups.people.map((x) => (
              <label key={x.id} className={`pick ${f.participantIds.includes(x.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={f.participantIds.includes(x.id)} onChange={() => toggleParticipant(x.id)} />
                {x.name}
              </label>
            ))}
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
                  <span className="split-name">{lookups.people.find((x) => x.id === id)?.name}</span>
                  {custom && (
                    <span className="split-input">
                      {f.splitMode === 'amount' && <span className="muted">R$</span>}
                      <input className="input input-sm" inputMode="decimal" aria-label={`Parte de ${lookups.people.find((x) => x.id === id)?.name}`} value={f.values[id] ?? ''} onChange={(e) => { const v = e.target.value; setF((s) => ({ ...s, values: { ...s.values, [id]: v } })); }} />
                      {f.splitMode === 'percent' && <span className="muted">%</span>}
                    </span>
                  )}
                  <span className="split-result">{total > 0 && count >= 1 ? <>{exactSplit || custom ? '' : '≈ '}{money(monthlyOf(i))}<span className="muted"> /mês</span></> : '—'}</span>
                </li>
              ))}
            </ul>
          )}

          {custom && n >= 2 && (
            <div className="split-sum">
              <span className={Math.abs(diff) < 0.01 ? 'ok' : 'bad'}>
                {f.splitMode === 'percent' ? `Soma: ${fmtNum(sum)}% de 100%` : `Soma: ${money(sum)} de ${money(total)}`}
                {Math.abs(diff) >= 0.01 && (diff > 0 ? ` — faltam ${f.splitMode === 'percent' ? `${fmtNum(diff)}%` : money(diff)}` : ` — passou ${f.splitMode === 'percent' ? `${fmtNum(-diff)}%` : money(-diff)}`)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setIds(f.participantIds)}>Dividir igualmente</Button>
            </div>
          )}

          {errors.participantIds ? <span className="field-error">{errors.participantIds}</span> : <span className="field-hint">Escolha 2 ou mais pessoas e como dividir. Os centavos são acertados parcela a parcela, e a soma sempre fecha no total.</span>}
        </fieldset>
      )}

      {valid && (
        <p className="preview">
          {count}x de <strong>{money(perInstallment)}</strong> · de {MONTHS_SHORT[f.startMonth - 1]}/{f.startYear} até {MONTHS_SHORT[end.month - 1]}/{end.year}
          {f.shared && n >= 2 && splitOk && (
            <>
              <br />{f.participantIds.map((id, i) => `${lookups.people.find((x) => x.id === id)?.name}: ${exactSplit || custom ? '' : '≈ '}${money(monthlyOf(i))}/mês`).join(' · ')}.
              {' '}A cobrança termina após a parcela {count}.
            </>
          )}
        </p>
      )}
      {editing && f.shared && <p className="field-hint">Ao salvar, a divisão é recalculada para todos os participantes (parcelas já marcadas como pagas são mantidas, por pessoa e número).</p>}
      {f.id && <p className="field-hint">Ao mudar valor, parcelas ou mês inicial, as parcelas são recalculadas (as já marcadas como pagas são mantidas pelo número).</p>}
    </Modal>
  );
}
