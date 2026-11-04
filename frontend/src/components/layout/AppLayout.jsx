import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  Calculator,
  Cake,
  Car,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Bell,
  CircleHelp,
  AlertTriangle,
  ExternalLink,
  Eye,
  LayoutDashboard,
  Menu,
  ReceiptText,
  Settings,
  ShieldCheck,
  Table,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { MONTHS_SHORT, yearsAround } from '../../lib/format.js';
import { Spinner } from '../ui/ui.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { PATHS } from '../../app/paths.js';
import { preloadRoute, routePaths } from '../../app/routeLoaders.js';
import { remindersApi } from '../../services/api.js';
import { useAppBusy } from '../../context/BusyContext.jsx';
import { startTour } from '../../lib/tour.js';
import AssistantWidget from '../AssistantWidget.jsx';

const NAV = [
  { title: 'Finanças', items: [
    { to: PATHS.dashboard, label: 'Painel', icon: LayoutDashboard },
    { to: PATHS.purchases, label: 'Lançamentos', icon: ReceiptText },
    { to: PATHS.cashLedger, label: 'Avulsos', icon: CircleDollarSign },
    { to: PATHS.cards, label: 'Cartões', icon: CreditCard },
    { to: PATHS.budget, label: 'Planilha mensal', icon: Table },
    { to: PATHS.overview, label: 'Visão geral', icon: Eye },
  ] },
  { title: 'Patrimônio', items: [
    { to: PATHS.vehicles, label: 'Gestão de Veículos', icon: Car },
  ] },
  { title: 'Cadastros', items: [
    { to: PATHS.people, label: 'Pessoas', icon: Users },
    { to: PATHS.birthdays, label: 'Aniversários', icon: Cake },
  ] },
  { title: 'Ferramentas', items: [
    { to: PATHS.rescission, label: 'Calculadora de rescisão', icon: Calculator },
    { to: PATHS.settings, label: 'Configurações', icon: Settings },
  ] },
  { title: 'Administração', adminOnly: true, items: [
    { to: PATHS.adminUsers, label: 'Acessos', icon: ShieldCheck },
  ] },
];

// Telas em que o seletor de mês/ano do topo faz sentido
const USES_PERIOD = [PATHS.dashboard, PATHS.purchases, PATHS.cards];

function PeriodPicker() {
  const { month, year, setMonth, setYear, shift } = usePeriod();
  return (
    <div className="period" role="group" aria-label="Período">
      <button className="icon-btn" onClick={() => shift(-1)} aria-label="Mês anterior">‹</button>
      <select className="input input-ghost" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Mês">
        {MONTHS_SHORT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select className="input input-ghost" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Ano">
        {yearsAround(new Date().getFullYear()).map((y) => <option key={y} value={y}>{String(y).slice(-2)}</option>)}
      </select>
      <button className="icon-btn" onClick={() => shift(1)} aria-label="Próximo mês">›</button>
    </div>
  );
}

function SystemClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const date = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo',
  }).format(now);
  const time = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo',
  }).format(now);

  return (
    <div className="system-clock" aria-label="Data e hora de Brasília">
      <Clock3 aria-hidden="true" />
      <time dateTime={now.toISOString()}>{date}</time>
      <strong>{time}</strong>
    </div>
  );
}

const MOBILE_NAV = NAV.flatMap((group) => group.items.map((item) => ({ ...item, adminOnly: group.adminOnly })));
const navTourId = (path) => `nav-${path.replace(/^\//, '')}`;

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { message: busyMessage } = useAppBusy();
  const { pathname } = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [alertsData, setAlertsData] = useState({ totalAlerts: 0, overdueCount: 0, upcomingCount: 0, alerts: [] });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef(null);
  const shellRef = useRef(null);

  useEffect(() => {
    shellRef.current?.toggleAttribute('inert', Boolean(busyMessage));
  }, [busyMessage]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setNotificationsOpen(false);
  }, [pathname]);

  useEffect(() => {
    const connection = navigator.connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return undefined;

    let cancelled = false;
    let timer;
    let idleId;
    let index = 0;
    const preloadNext = () => {
      if (cancelled || index >= routePaths.length) return;
      preloadRoute(routePaths[index++]);
      if ('requestIdleCallback' in window) {
        idleId = window.requestIdleCallback(preloadNext, { timeout: 2_000 });
      } else {
        timer = window.setTimeout(preloadNext, 500);
      }
    };

    timer = window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idleId = window.requestIdleCallback(preloadNext, { timeout: 2_000 });
      } else {
        preloadNext();
      }
    }, 1_000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleId !== undefined && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
    };
  }, []);

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!notificationsRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    let mounted = true;
    const loadAlerts = async () => {
      try {
        const result = await remindersApi.getAlerts();
        if (mounted) setAlertsData(result);
      } catch (error) {
        console.error('Falha ao carregar alertas:', error);
      }
    };

    loadAlerts();
    const interval = setInterval(loadAlerts, 120_000);
    window.addEventListener('reminders:refresh', loadAlerts);
    window.addEventListener('finance:refresh', loadAlerts);
    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener('reminders:refresh', loadAlerts);
      window.removeEventListener('finance:refresh', loadAlerts);
    };
  }, []);

  return (
    <div ref={shellRef} className={`shell ${desktopCollapsed ? 'shell-collapsed' : ''}`} aria-busy={Boolean(busyMessage)}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden="true" />{!desktopCollapsed && 'Caderno de Contas'}</div>
        <nav className="sidebar-nav" aria-label="Principal">
          {NAV.filter((group) => !group.adminOnly || user?.role === 'admin').map((g) => (
            <div key={g.title} className="nav-group">
              {!desktopCollapsed && <div className="nav-title">{g.title}</div>}
              {g.items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  onPointerEnter={() => preloadRoute(i.to)}
                  onFocus={() => preloadRoute(i.to)}
                  data-tour={navTourId(i.to)}
                  title={desktopCollapsed ? i.label : undefined}
                  className={({ isActive }) => `nav-link ${desktopCollapsed ? 'nav-link-collapsed' : ''} ${isActive ? 'active' : ''}`}
                >
                  <i.icon className="sidebar-nav-icon" aria-hidden="true" />
                  {!desktopCollapsed && i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-user">
          {!desktopCollapsed && (
            <div className="flex items-center gap-3">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-8 h-8 rounded-full object-cover border border-emerald-500/50"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs border border-emerald-500/30">
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </div>
              )}

              <div className="truncate min-w-0">
                <div className="text-xs font-semibold text-slate-200 truncate">{user?.name}</div>
                <div className="text-[10px] text-slate-400 truncate">{user?.email}</div>
              </div>
            </div>
          )}
          {desktopCollapsed && user?.avatar && (
            <img
              src={user.avatar}
              alt={user.name}
              className="w-8 h-8 rounded-full object-cover border border-emerald-500/50"
              referrerPolicy="no-referrer"
              title={user.name}
            />
          )}
          <button className="btn btn-ghost btn-sm" onClick={logout} title="Sair">{desktopCollapsed ? '↪' : 'Sair'}</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="topbar-left">
            <button
              className="btn btn-ghost menu-toggle-button"
              type="button"
              onClick={() => {
                if (window.matchMedia('(max-width: 900px)').matches) {
                  setMobileMenuOpen((open) => !open);
                } else {
                  setDesktopCollapsed((collapsed) => !collapsed);
                }
              }}
              aria-label="Menu de navegação"
              aria-expanded={
                window.matchMedia('(max-width: 900px)').matches
                  ? mobileMenuOpen
                  : !desktopCollapsed
              }
              title="Menu de navegação"
            >
              <Menu aria-hidden="true" />
            </button>
            <span className="mobile-brand">
              <span className="mobile-brand-mark" aria-hidden="true">C</span>
              <span className="mobile-brand-text">Caderno de Contas</span>
            </span>
          </div>
          <div className="topbar-actions">
            <SystemClock />
            {USES_PERIOD.some((p) => pathname.startsWith(p)) && <PeriodPicker />}
            <button
              className="icon-btn tour-trigger"
              type="button"
              onClick={startTour}
              aria-label="Iniciar tour guiado"
              title="Tour guiado"
            >
              <CircleHelp aria-hidden="true" />
            </button>
            <div className="notification-menu" ref={notificationsRef}>
              <button
                className="notification-trigger"
                type="button"
                data-tour="reminders"
                onClick={() => setNotificationsOpen((open) => !open)}
                aria-label={`Central de lembretes, ${alertsData.totalAlerts} pendências`}
                aria-expanded={notificationsOpen}
                title="Central de lembretes e vencimentos"
              >
                <Bell aria-hidden="true" />
                {alertsData.totalAlerts > 0 && (
                  <span className="notification-badge" aria-hidden="true">
                    {alertsData.totalAlerts}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                  <section className="notification-panel" aria-label="Lembretes e vencimentos">
                    <header className="notification-header">
                      <div className="notification-heading">
                        <AlertTriangle aria-hidden="true" />
                        <strong>Lembretes e vencimentos</strong>
                      </div>
                      <span className="notification-count">{alertsData.totalAlerts} pendência(s)</span>
                    </header>
                    <div className="notification-list">
                      {alertsData.alerts.length === 0 ? (
                        <p className="notification-empty">Nenhuma pendência vencida ou próxima do vencimento.</p>
                      ) : alertsData.alerts.map((alert) => (
                        <article
                          key={alert.id}
                          className={`notification-item ${alert.severity === 'danger' ? 'is-danger' : ''}`}
                        >
                          <div className="notification-item-heading">
                            <strong>{alert.title}</strong>
                            <span>{Number(alert.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                          </div>
                          <p>{alert.description}</p>
                          <div className="notification-item-footer">
                            <span className={`notification-status ${alert.severity === 'danger' ? 'is-danger' : ''}`}>
                              {alert.status === 'overdue' ? 'Atrasado' : alert.status === 'today' ? 'Vence hoje' : 'Em breve'}
                            </span>
                            <NavLink
                              to={alert.link}
                              onClick={() => setNotificationsOpen(false)}
                              className="notification-link"
                            >
                              Ver detalhes <ExternalLink aria-hidden="true" />
                            </NavLink>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
              )}
            </div>
            <div className="user">
              {user?.provider === 'local' && <span className="pill pill-warn" title="Dados de exemplo da planilha">modo local</span>}
              {/* Bloco de Perfil do Usuário com Foto Oficial do Google */}
              <div className="flex items-center gap-3">
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-8 h-8 rounded-full object-cover border border-emerald-500/50"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs border border-emerald-500/30">
                    {user?.name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}

                <div className="user-profile-details truncate min-w-0">
                  <div className="text-xs font-semibold text-slate-200 truncate">{user?.name}</div>
                  <div className="text-[10px] text-slate-400 truncate">{user?.email}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <main className={`content ${pathname.startsWith(PATHS.budget) ? 'content-wide' : ''}`}>
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<Spinner />}><Outlet /></Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {mobileMenuOpen && (
        <div className="mobile-drawer" role="presentation">
          <button className="mobile-drawer-backdrop" type="button" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)} />
          <aside className="mobile-drawer-panel" role="dialog" aria-modal="true" aria-label="Menu principal">
            <header className="mobile-drawer-head">
              <strong>Menu principal</strong>
              <button className="icon-btn" type="button" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)}>×</button>
            </header>
            <nav className="mobile-drawer-nav" aria-label="Navegação móvel">
              {NAV.filter((group) => !group.adminOnly || user?.role === 'admin').map((group) => (
                <div key={group.title} className="nav-group">
                  <div className="nav-title">{group.title}</div>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onPointerEnter={() => preloadRoute(item.to)}
                      onFocus={() => preloadRoute(item.to)}
                      data-tour={navTourId(item.to)}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    >
                        <item.icon className="drawer-nav-icon" aria-hidden="true" />
                        {item.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>
            <div className="mobile-drawer-user">
              <div className="flex items-center gap-3">
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-8 h-8 rounded-full object-cover border border-emerald-500/50"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs border border-emerald-500/30">
                    {user?.name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}

                <div className="truncate min-w-0">
                  <div className="text-xs font-semibold text-slate-200 truncate">{user?.name}</div>
                  <div className="text-[10px] text-slate-400 truncate">{user?.email}</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={logout}>Sair</button>
            </div>
          </aside>
        </div>
      )}

      <nav className="mobile-bottom-nav" aria-label="Navegação rápida">
        <div className="mobile-bottom-scroll no-scrollbar">
          {MOBILE_NAV.filter((item) => !item.adminOnly || user?.role === 'admin').map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onPointerEnter={() => preloadRoute(item.to)}
              onFocus={() => preloadRoute(item.to)}
              data-tour={navTourId(item.to)}
              className={({ isActive }) => `mobile-bottom-link ${isActive ? 'active' : ''}`}
            >
              <item.icon className="mobile-bottom-symbol" aria-hidden="true" />
              <span>
                {item.to === PATHS.vehicles ? 'Veículos'
                  : item.to === PATHS.rescission ? 'Rescisão'
                    : item.to === PATHS.overview ? 'Visão Geral'
                      : item.label}
              </span>
            </NavLink>
          ))}
        </div>
      </nav>
      <AssistantWidget />
    </div>
  );
}
