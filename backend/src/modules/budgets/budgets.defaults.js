// Blocos da planilha mensal ("Financeiro Pessoa 01"/"Pessoa 07"). `cards` é calculado a partir das compras.
export const SECTIONS = [
  { key: 'income', label: 'Receitas', kind: 'income', defaults: ['Salário', 'Férias / Décimo Terceiro / FGTS', 'Serviços / Pagamentos Extras'] },
  { key: 'benefits', label: 'Benefícios', kind: 'income', defaults: ['Ajuda de custo', 'Alimentação', 'VR combustível'] },
  { key: 'investments', label: 'Investimentos', kind: 'expense', defaults: ['Fundo emergencial'] },
  { key: 'deductions', label: 'Descontos (salário) / impostos', kind: 'expense', defaults: ['INSS/FGTS', 'Plano de saúde', 'IRRF'] },
  { key: 'food', label: 'Alimentação x Combustível', kind: 'expense', defaults: ['Mercantil', 'Variadas', 'Vale combustível'] },
  { key: 'vehicle', label: 'Despesas de veículos', kind: 'expense', defaults: ['Carro', 'Consórcio', 'IPVA carro', 'Seguro carro', 'IPVA moto', 'Licenciamento carro', 'Licenciamento moto'] },
  { key: 'cards', label: 'Cartão de crédito', kind: 'expense', computed: true, defaults: [] },
  { key: 'misc', label: 'Variadas', kind: 'expense', defaults: [] },
  { key: 'housing', label: 'Moradia', kind: 'expense', defaults: ['Energia', 'Água', 'Internet'] },
  { key: 'fixed', label: 'Contas fixas e veículo', kind: 'expense', defaults: [] },
];
export const SECTION_KEYS = SECTIONS.map((s) => s.key);

export function createDefaultRows() {
  const rows = [];
  let pos = 0;
  for (const section of SECTIONS) {
    for (const label of section.defaults) rows.push({ section: section.key, label, position: pos++, cells: [] });
  }
  return rows;
}
