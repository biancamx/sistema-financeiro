import { Download } from 'lucide-react';
import { PageHeader } from '../../components/ui/ui.jsx';
import { cashLedgerApi, purchasesApi, vehiclesApi } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';

const exports = [
  { label: 'Compras e parcelas', description: 'Baixe as compras e parcelas registradas nos cartões.', download: purchasesApi.downloadCsv },
  { label: 'Dinheiro e empréstimos', description: 'Baixe as entradas e saídas do caixa avulso.', download: cashLedgerApi.downloadCsv },
  { label: 'Gastos de veículos', description: 'Baixe os gastos e despesas registrados para os veículos.', download: vehiclesApi.downloadCsv },
];

export default function ExportPage() {
  const toast = useToast();
  async function download(item) {
    try {
      await item.download();
    } catch (error) {
      if (error.code !== 'REAUTH_REQUIRED') toast.error(error);
    }
  }

  return (
    <section className="export-page">
      <PageHeader title="Exportação" subtitle="Baixe os dados financeiros em CSV para usar em uma planilha." />
      <div className="more-grid">
        {exports.map((item) => (
          <button className="more-card" type="button" onClick={() => download(item)} key={item.label}>
            <Download aria-hidden="true" />
            <span><strong>{item.label}</strong><small>{item.description}</small></span>
          </button>
        ))}
      </div>
    </section>
  );
}
