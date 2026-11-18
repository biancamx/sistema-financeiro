import { NavLink, Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/ui/ui.jsx';
import { PATHS } from '../../app/paths.js';

const tabs = [
  { to: PATHS.purchases, label: 'Compras e parcelas', end: true },
  { to: PATHS.cashLedger, label: 'Dinheiro e empréstimos' },
  { to: PATHS.import, label: 'Importação' },
  { to: PATHS.export, label: 'Exportação' },
];

export default function TransactionsPage() {
  return (
    <section className="area-page">
      <PageHeader title="Lançamentos" subtitle="Compras, parcelas, dinheiro, importações e exportações." />
      <nav className="tabs area-tabs" aria-label="Áreas de lançamentos">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `area-tab ${isActive ? 'on' : ''}`}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}
