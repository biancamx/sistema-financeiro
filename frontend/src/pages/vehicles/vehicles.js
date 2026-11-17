export const KINDS = [
  { value: 'car', label: 'Carro' },
  { value: 'motorcycle', label: 'Moto' },
  { value: 'utility', label: 'Utilitário' },
  { value: 'other', label: 'Outro' },
];
export const STATUSES = [
  { value: 'active', label: 'Ativo' },
  { value: 'inactive', label: 'Inativo' },
  { value: 'sold', label: 'Vendido' },
];
export const kindLabel = (k) => KINDS.find((x) => x.value === k)?.label ?? k;
export const statusLabel = (s) => STATUSES.find((x) => x.value === s)?.label ?? s;

/** DEMO001 → DEMO-001 (só para exibir; no banco fica sem hífen) */
export const showPlate = (p) => (p && p.length === 7 ? `${p.slice(0, 3)}-${p.slice(3)}` : p || '');
export const vehicleLabel = (v) => `${v.model} · ${showPlate(v.plate)}`;

export const todayIso = () => new Date().toLocaleDateString('sv'); // AAAA-MM-DD no fuso local
export const showDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
export const showKm = (km) => (km == null ? '—' : `${new Intl.NumberFormat('pt-BR').format(km)} km`);

export const GROUP_TONE = { fixed: 'primary', maintenance: 'accent', operational: 'muted' };
