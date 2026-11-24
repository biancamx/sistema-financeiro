// Copyright © 2026 Bianca Moura. Todos os direitos reservados.
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Fragment, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Car,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Bell,
  AlertTriangle,
  MoreHorizontal,
  LayoutDashboard,
  Menu,
  Plus,
  ReceiptText,
  Users,
  Calculator,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePeriod } from '../../context/PeriodContext.jsx';
import { MONTHS_SHORT, yearsAround } from '../../lib/format.js';
import { Spinner } from '../ui/ui.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { PATHS } from '../../app/paths.js';
import { preloadRoute, routePaths } from '../../app/routeLoaders.js';
import { remindersApi } from '../../services/api.js';
import AlertDetailsModal from '../notifications/AlertDetailsModal.jsx';
import { useAppBusy } from '../../context/BusyContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { dismissAlert as dismissAlertRequest } from '../../lib/alerts.js';
import AssistantWidget from '../AssistantWidget.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import NewActionButton from './NewActionButton.jsx';
import MoreMenu from './MoreMenu.jsx';

const NAV = [
  { to: PATHS.dashboard, label: 'Início', icon: LayoutDashboard, end: true },
  { to: PATHS.financialPlanning, label: 'Planejamento Financeiro', icon: Calculator },
  { to: PATHS.purchases, label: 'Lançamentos', icon: ReceiptText },
  { to: PATHS.people, label: 'Pessoas', icon: Users },
  { to: PATHS.cards, label: 'Cartões', icon: CreditCard },
  { to: PATHS.vehicles, label: 'Veículos', icon: Car },
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

const MOBILE_NAV = NAV.filter((item) => [PATHS.dashboard, PATHS.purchases, PATHS.people, PATHS.financialPlanning].includes(item.to));
const navTourId = (path) => `nav-${path.replace(/^\//, '').replaceAll('/', '-')}`;
const isAreaActive = (item, pathname) => {
  if (item.to === PATHS.purchases) return pathname === PATHS.transactions || pathname.startsWith(`${PATHS.transactions}/`);
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
};

export default function AppLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const toast = useToast();
  const { message: busyMessage } = useAppBusy();
  const { pathname } = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [alertsData, setAlertsData] = useState({ totalAlerts: 0, overdueCount: 0, upcomingCount: 0, alerts: [] });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const notificationsRef = useRef(null);
  const shellRef = useRef(null);
  const sidebarRef = useRef(null);
  const sidebarNavRef = useRef(null);
  const [sidebarIndicator, setSidebarIndicator] = useState({ top: 0, left: 0, height: 0, visible: false });
  const [sidebarIndicatorMotionReady, setSidebarIndicatorMotionReady] = useState(false);
  const morePageActive = pathname === PATHS.more || pathname.startsWith(`${PATHS.more}/`);
  const openAlert = (alert) => {
    setNotificationsOpen(false);
    setSelectedAlert(alert);
    void dismissAlertRequest(alert, toast);
  };

  useEffect(() => {
    let frame = 0;
    let enabled = false;
    const enableMotion = () => {
      if (enabled || document.visibilityState !== 'visible') return;
      frame = window.requestAnimationFrame(() => {
        enabled = true;
        setSidebarIndicatorMotionReady(true);
      });
    };

    enableMotion();
    document.addEventListener('visibilitychange', enableMotion);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', enableMotion);
    };
  }, []);

  useEffect(() => {
    shellRef.current?.toggleAttribute('inert', Boolean(busyMessage));
  }, [busyMessage]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setNotificationsOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    const nav = sidebarNavRef.current;
    if (!sidebar || !nav) return undefined;

    const updateIndicator = () => {
      const active = nav.querySelector('.sidebar-more-trigger[aria-expanded="true"]')
        || nav.querySelector('.nav-link[aria-current="page"]');
      const sidebarRect = sidebar.getBoundingClientRect();
      if (!active || sidebarRect.width === 0) {
        setSidebarIndicator((current) => current.visible ? { ...current, visible: false } : current);
        return;
      }

      const activeRect = active.getBoundingClientRect();
      const next = {
        top: activeRect.top - sidebarRect.top,
        left: activeRect.left - sidebarRect.left,
        height: activeRect.height,
        visible: true,
      };
      setSidebarIndicator((current) => (
        current.visible
        && Math.abs(current.top - next.top) < 0.5
        && Math.abs(current.left - next.left) < 0.5
        && Math.abs(current.height - next.height) < 0.5
          ? current
          : next
      ));
    };

    updateIndicator();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateIndicator);
    resizeObserver?.observe(sidebar);
    resizeObserver?.observe(nav);
    const active = nav.querySelector('.sidebar-more-trigger[aria-expanded="true"]')
      || nav.querySelector('.nav-link[aria-current="page"]');
    if (active) resizeObserver?.observe(active);

    const mutationObserver = new MutationObserver(updateIndicator);
    mutationObserver.observe(nav, {
      attributes: true,
      attributeFilter: ['aria-current', 'aria-expanded', 'class'],
      childList: true,
      subtree: true,
    });
    nav.addEventListener('scroll', updateIndicator, { passive: true });
    window.addEventListener('resize', updateIndicator);

    return () => {
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      nav.removeEventListener('scroll', updateIndicator);
      window.removeEventListener('resize', updateIndicator);
    };
  }, [desktopCollapsed, moreOpen, pathname]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [moreOpen]);

  const toggleMore = () => setMoreOpen((open) => !open);
  const openMoreFromDrawer = () => {
    setMobileMenuOpen(false);
    setMoreOpen(true);
  };
  const openAssistant = () => document.querySelector('[aria-label="Abrir assistente financeiro"]')?.click();

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
    <div ref={shellRef} className={`shell ${desktopCollapsed ? 'shell-collapsed' : ''} ${moreOpen ? 'shell-more-open' : ''}`} aria-busy={Boolean(busyMessage)}>
      <aside ref={sidebarRef} className="sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden="true" />{!desktopCollapsed && 'Caderno de Contas'}</div>
        <div
          className={`sidebar-nav-indicator ${sidebarIndicator.visible ? 'is-visible' : ''} ${sidebarIndicatorMotionReady ? 'has-motion' : ''}`}
          aria-hidden="true"
          style={{
            '--indicator-y': `${sidebarIndicator.top}px`,
            '--indicator-left': `${sidebarIndicator.left}px`,
            '--indicator-height': `${sidebarIndicator.height}px`,
          }}
        />
        <nav ref={sidebarNavRef} className="sidebar-nav" aria-label="Principal">
          <div className="nav-group">
            {!desktopCollapsed && <div className="nav-title">Áreas</div>}
            {NAV.map((item) => {
              const isActive = isAreaActive(item, pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onPointerEnter={() => preloadRoute(item.to)}
                  onPointerDown={() => preloadRoute(item.to)}
                  onFocus={() => preloadRoute(item.to)}
                  data-tour={navTourId(item.to)}
                  title={desktopCollapsed ? item.label : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={`nav-link ${desktopCollapsed ? 'nav-link-collapsed' : ''} ${isActive ? 'active' : ''}`}
                >
                  <item.icon className="sidebar-nav-icon" aria-hidden="true" />
                  {!desktopCollapsed && item.label}
                </Link>
              );
            })}
            <button
              type="button"
              className={`nav-link sidebar-more-trigger ${desktopCollapsed ? 'nav-link-collapsed' : ''}`}
              onClick={toggleMore}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-controls="more-flyout"
              aria-current={morePageActive ? 'page' : undefined}
              data-tour={navTourId(PATHS.more)}
              title={desktopCollapsed ? 'Mais' : undefined}
            >
              {desktopCollapsed
                ? <Plus className="sidebar-nav-icon" aria-hidden="true" />
                : <MoreHorizontal className="sidebar-nav-icon" aria-hidden="true" />}
              {!desktopCollapsed && <>Mais<ChevronRight className="more-chevron" aria-hidden="true" /></>}
            </button>
          </div>
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
            <GlobalSearch />
            <SystemClock />
            {USES_PERIOD.some((p) => pathname.startsWith(p)) && <PeriodPicker />}
            <button
              className="icon-btn help-trigger"
              type="button"
              onClick={() => navigate(PATHS.help)}
              aria-label="Abrir ajuda e primeiros passos"
              title="Ajuda e primeiros passos"
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
                            <button type="button" onClick={() => openAlert(alert)} className="notification-link" aria-haspopup="dialog">
                              Ver detalhes <ChevronRight aria-hidden="true" />
                            </button>
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
        <main className={`content ${pathname.includes('/planilha/') ? 'content-wide' : ''}`}>
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<Spinner />}><Outlet /></Suspense>
          </ErrorBoundary>
          <footer className="institutional-footer">
            <strong>SISTEMA FINANCEIRO</strong>
            <span>© {new Date().getFullYear()}</span>
            <span>Desenvolvido por Bianca Moura</span>
            <small>Todos os direitos reservados. Reprodução, distribuição ou comercialização não autorizadas.</small>
          </footer>
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
              <div className="nav-group">
                <div className="nav-title">Áreas do sistema</div>
                {NAV.map((item) => {
                  const isActive = isAreaActive(item, pathname);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onPointerEnter={() => preloadRoute(item.to)}
                      onPointerDown={() => preloadRoute(item.to)}
                      onFocus={() => preloadRoute(item.to)}
                      data-tour={navTourId(item.to)}
                      onClick={() => setMobileMenuOpen(false)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`nav-link ${isActive ? 'active' : ''}`}
                    >
                      <item.icon className="drawer-nav-icon" aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
                <button
                  type="button"
                  className={`nav-link ${moreOpen || morePageActive ? 'active' : ''}`}
                  onClick={openMoreFromDrawer}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  aria-current={morePageActive ? 'page' : undefined}
                  data-tour={navTourId(PATHS.more)}
                >
                  <MoreHorizontal className="drawer-nav-icon" aria-hidden="true" />Mais
                </button>
              </div>
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
          {MOBILE_NAV.map((item, index) => (
            <Fragment key={item.to}>
              {index === 2 && <NewActionButton mobile />}
              <Link
                to={item.to}
                onPointerEnter={() => preloadRoute(item.to)}
                onPointerDown={() => preloadRoute(item.to)}
                onFocus={() => preloadRoute(item.to)}
                data-tour={navTourId(item.to)}
                aria-current={isAreaActive(item, pathname) ? 'page' : undefined}
                className={`mobile-bottom-link ${isAreaActive(item, pathname) ? 'active' : ''}`}
              >
                <item.icon className="mobile-bottom-symbol" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </Fragment>
          ))}
          <button
            type="button"
            className={`mobile-bottom-link ${moreOpen || morePageActive ? 'active' : ''}`}
            onClick={toggleMore}
            aria-label="Mais"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            aria-controls="more-flyout"
            aria-current={morePageActive ? 'page' : undefined}
            data-tour={navTourId(PATHS.more)}
          >
            <MoreHorizontal className="mobile-bottom-symbol" aria-hidden="true" />
            <span>Mais</span>
          </button>
        </div>
      </nav>
      <MoreMenu open={moreOpen} isAdmin={user?.role === 'admin'} onClose={() => setMoreOpen(false)} onOpenAssistant={openAssistant} />
      <NewActionButton floating />
      <AssistantWidget />
      {selectedAlert && <AlertDetailsModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />}
    </div>
  );
}
