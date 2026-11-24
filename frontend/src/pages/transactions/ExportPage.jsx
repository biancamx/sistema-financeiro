import { Download } from 'lucide-react';
import { PageHeader } from '../../components/ui/ui.jsx';
import { cashLedgerApi, purchasesApi, vehiclesApi } from '../../services/api.js';

const exports = [
  { label: 'Compras e parcelas', description: 'Baixe as compras e parcelas registradas nos cartões.', href: purchasesApi.exportUrl() },
  { label: 'Dinheiro e empréstimos', description: 'Baixe as entradas e saídas do caixa avulso.', href: cashLedgerApi.exportUrl() },
  { label: 'Gastos de veículos', description: 'Baixe os gastos e despesas registrados para os veículos.', href: vehiclesApi.exportUrl() },
];

export default function ExportPage() {
  return (
    <section className="export-page">
      <PageHeader title="Exportação" subtitle="Baixe os dados financeiros em CSV para usar em uma planilha." />
      <div className="more-grid">
        {exports.map((item) => (
          <a className="more-card" href={item.href} key={item.label}>
            <Download aria-hidden="true" />
            <span><strong>{item.label}</strong><small>{item.description}</small></span>
          </a>
        ))}
      </div>
    </section>
  );
}
