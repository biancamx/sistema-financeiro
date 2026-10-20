import { useRef, useState } from 'react';
import { moneyPlain, parseMoney } from '../lib/format.js';

/** Célula editável: mostra o valor formatado, edita ao focar e salva ao sair (Enter/Tab). */
export default function MoneyCell({ value, onSave }) {
  const [text, setText] = useState(null);
  const ref = useRef(null);
  const shown = text ?? (value ? moneyPlain(value) : '');
  const commit = () => {
    if (text === null) return;
    const n = parseMoney(text);
    setText(null);
    if (!Number.isNaN(n) && n !== value) onSave(n);
  };
  return (
    <input
      ref={ref}
      className={`cell ${value < 0 ? 'neg' : ''}`}
      inputMode="decimal"
      value={shown}
      onFocus={(e) => { setText(value ? String(value).replace('.', ',') : ''); requestAnimationFrame(() => e.target.select()); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(null); e.currentTarget.blur(); } }}
      aria-label="Valor"
    />
  );
}

