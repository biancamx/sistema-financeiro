// Categorias de gasto de veículo. Fica no código (e não no banco) porque os grupos alimentam os relatórios.
export const EXPENSE_GROUPS = [
  { key: 'fixed', label: 'Custos fixos e recorrentes' },
  { key: 'maintenance', label: 'Manutenção e cuidados' },
  { key: 'operational', label: 'Operacional e imprevistos' },
];

export const EXPENSE_CATEGORIES = [
  { key: 'financing', label: 'Financiamento / parcela', group: 'fixed' },
  { key: 'ipva', label: 'IPVA', group: 'fixed' },
  { key: 'licensing', label: 'Licenciamento', group: 'fixed' },
  { key: 'insurance', label: 'Seguro', group: 'fixed' },
  { key: 'dpvat', label: 'DPVAT', group: 'fixed' },

  { key: 'preventive', label: 'Manutenção preventiva', group: 'maintenance' },
  { key: 'corrective', label: 'Manutenção corretiva', group: 'maintenance' },
  { key: 'oil', label: 'Troca de óleo', group: 'maintenance' },
  { key: 'alignment', label: 'Alinhamento e balanceamento', group: 'maintenance' },
  { key: 'tires', label: 'Pneus', group: 'maintenance' },
  { key: 'wash', label: 'Lavagem', group: 'maintenance' },
  { key: 'aesthetics', label: 'Estética', group: 'maintenance' },

  { key: 'fuel', label: 'Combustível', group: 'operational' },
  { key: 'toll', label: 'Pedágio', group: 'operational' },
  { key: 'parking', label: 'Estacionamento', group: 'operational' },
  { key: 'fine', label: 'Multa', group: 'operational' },
  { key: 'accessories', label: 'Acessórios', group: 'operational' },
  { key: 'other', label: 'Outros', group: 'operational' },
];

export const CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key);
export const GROUP_KEYS = EXPENSE_GROUPS.map((g) => g.key);
export const groupOf = (category) => EXPENSE_CATEGORIES.find((c) => c.key === category)?.group;
