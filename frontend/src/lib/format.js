const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export const money = (v) => brl.format(Number(v) || 0);
export const moneyPlain = (v) => num.format(Number(v) || 0);
export const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const monthLabel = (m, y) => (m ? `${MONTHS[m - 1]}${y ? ` de ${y}` : ''}` : '—');
export const yearsAround = (center = new Date().getFullYear()) => [center - 2, center - 1, center, center + 1, center + 2, center + 3];
export const dateTimeLabel = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
};

/** "1.234,56" / "1234.56" / "12,5" → número */
export function parseMoney(text) {
  if (typeof text === 'number') return text;
  const s = String(text ?? '').trim().replace(/[R$\s]/g, '');
  if (!s || s === '-') return 0;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}
