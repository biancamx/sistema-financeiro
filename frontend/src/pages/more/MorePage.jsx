import { Link } from 'react-router-dom';
import { BookOpen, Calculator, Settings, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader } from '../../components/ui/ui.jsx';
import { PATHS } from '../../app/paths.js';
import { startTour } from '../../lib/tour.js';

export default function MorePage() {
  const { user } = useAuth();
  const items = [
    { to: PATHS.rescission, label: 'Calculadora de rescisão', icon: Calculator, description: 'Estimativa de verbas rescisórias.' },
    { to: PATHS.settings, label: 'Configurações', icon: Settings, description: 'Categorias, IA e preferências.' },
    ...(user?.role === 'admin' ? [{ to: PATHS.adminUsers, label: 'Acessos', icon: ShieldCheck, description: 'Aprovar e gerenciar usuários.' }] : []),
  ];
  return (
    <section className="area-page">
      <PageHeader title="Mais" subtitle="Ferramentas e áreas que você usa com menos frequência." />
      <div className="more-grid">
        <button type="button" className="more-card" onClick={() => document.querySelector('[aria-label="Abrir assistente financeiro"]')?.click()}>
          <Sparkles aria-hidden="true" /><span><strong>Assistente de IA</strong><small>Consultar seus dados financeiros.</small></span>
        </button>
        {items.map(({ to, label, icon: Icon, description }) => (
          <Link className="more-card" to={to} key={to}><Icon aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span></Link>
        ))}
        <button type="button" className="more-card" onClick={startTour}>
          <BookOpen aria-hidden="true" /><span><strong>Tour guiado</strong><small>Conheça as áreas do sistema.</small></span>
        </button>
      </div>
    </section>
  );
}
