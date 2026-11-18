import { Calculator, Car, CreditCard, Settings, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PATHS } from '../../app/paths.js';

const groups = [
  {
    title: 'Áreas',
    mobileOnly: true,
    mobileTwoColumns: true,
    items: [
      { to: PATHS.cards, label: 'Cartões', description: 'Cartões e faturas.', icon: CreditCard },
      { to: PATHS.vehicles, label: 'Veículos', description: 'Veículos e gastos.', icon: Car },
    ],
  },
  {
    title: 'Ferramentas',
    items: [
      { key: 'assistant', label: 'Assistente de IA', shortLabel: 'Assistente IA', description: 'Consulte e registre por conversa.', icon: Sparkles },
      { to: PATHS.rescission, label: 'Rescisão', description: 'Estimativa de verbas rescisórias.', icon: Calculator },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { to: PATHS.settings, label: 'Configurações', shortLabel: 'Ajustes', description: 'Categorias, IA e preferências.', icon: Settings },
      { to: PATHS.adminUsers, label: 'Acessos', description: 'Aprovar ou bloquear contas.', icon: ShieldCheck, adminOnly: true },
    ],
  },
];

function MoreMenuItems({ mobile, isAdmin, onClose, onOpenAssistant }) {
  return groups.map((group) => {
    if (group.mobileOnly && !mobile) return null;
    const items = group.items.filter((item) => !item.adminOnly || isAdmin);
    if (!items.length) return null;
    return (
      <section className="more-menu-group" key={group.title}>
        <h3>{group.title}</h3>
        <div className={mobile ? `more-menu-tiles ${group.mobileTwoColumns ? 'more-menu-tiles-areas' : ''}` : 'more-menu-rows'}>
          {items.map(({ key, to, label, shortLabel, description, icon: Icon }) => {
            const content = (
              <>
                <span className="more-menu-icon"><Icon aria-hidden="true" /></span>
                <span className="more-menu-label">
                  <strong>{mobile ? shortLabel || label : label}</strong>
                  {!mobile && <small>{description}</small>}
                </span>
              </>
            );
            if (key === 'assistant') return (
              <button className="more-menu-item" key={key} type="button" role="menuitem" onClick={() => { onClose(); onOpenAssistant(); }}>
                {content}
              </button>
            );
            return <Link className="more-menu-item" key={to} to={to} role="menuitem" onClick={onClose}>{content}</Link>;
          })}
        </div>
      </section>
    );
  });
}

export default function MoreMenu({ open, isAdmin, onClose, onOpenAssistant }) {
  if (!open) return null;
  return (
    <>
      <button className="more-menu-scrim" type="button" aria-label="Fechar menu Mais" onClick={onClose} />
      <div className="more-flyout" id="more-flyout" role="menu" aria-label="Mais opções">
        <div className="more-menu-desktop">
          <MoreMenuItems mobile={false} isAdmin={isAdmin} onClose={onClose} onOpenAssistant={onOpenAssistant} />
          <p className="more-menu-hint"><kbd>Esc</kbd> para fechar</p>
        </div>
        <div className="more-menu-mobile">
          <MoreMenuItems mobile isAdmin={isAdmin} onClose={onClose} onOpenAssistant={onOpenAssistant} />
        </div>
      </div>
    </>
  );
}
