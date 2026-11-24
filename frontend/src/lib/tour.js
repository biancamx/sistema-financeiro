import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const tourSteps = [
  { selector: 'inicio', title: 'Comece pelo Início', description: 'Confira o resumo do mês, as pendências e o que precisa de atenção.' },
  { selector: 'planejamento-financeiro', title: 'Planejamento Financeiro', description: 'Simule compras futuras e veja o impacto projetado antes de registrá-las.' },
  { selector: 'lancamentos-compras', title: 'Lançamentos', description: 'Organize compras e parcelas, movimentações em dinheiro, empréstimos e importações.' },
  { selector: 'pessoas', title: 'Pessoas', description: 'Consulte cadastros, extratos, cobranças, planilhas e aniversários.' },
  { selector: 'cartoes', title: 'Cartões', description: 'Acompanhe cartões, limites, faturas e vencimentos.' },
  { selector: 'veiculos', title: 'Veículos', description: 'Registre gastos e acompanhe manutenções, lembretes e documentos.' },
  { selector: 'mais', title: 'Mais ferramentas', description: 'Acesse o assistente de IA, a calculadora de rescisão e as configurações. Acessos administrativos aparecem para administradores.' },
];
const quickActionStep = {
  title: 'Atalhos rápidos',
  description: 'Use Novo registro para lançar compras, despesas ou recebimentos. O sino reúne vencimentos e pendências.',
};

export function startTour() {
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  const menuButton = document.querySelector('.menu-toggle-button');
  const navigationSelector = isMobile ? '.mobile-drawer-nav' : '.sidebar-nav';
  const openedMobileMenu = Boolean(isMobile && menuButton && menuButton.getAttribute('aria-expanded') !== 'true');
  if (openedMobileMenu) menuButton?.click();

  const tour = driver({
    animate: true,
    allowClose: true,
    showProgress: true,
    popoverClass: 'app-tour-popover',
    skipMissingElement: true,
    waitForElement: 1000,
    nextBtnText: 'Próximo',
    prevBtnText: 'Voltar',
    doneBtnText: 'Concluir',
    progressText: 'Etapa {{current}} de {{total}}',
    onDestroyed: () => {
      if (openedMobileMenu && menuButton?.getAttribute('aria-expanded') === 'true') menuButton.click();
    },
    steps: [
      ...tourSteps.map((step, index) => ({
        element: `${navigationSelector} [data-tour="nav-${step.selector}"]`,
        ...(isMobile && index === tourSteps.length - 1 ? {
          onNextClick: (_element, _step, { driver: activeDriver }) => {
            if (menuButton?.getAttribute('aria-expanded') === 'true') menuButton.click();
            window.requestAnimationFrame(() => activeDriver.moveNext());
          },
        } : {}),
        popover: {
          title: step.title,
          description: step.description,
          side: isMobile ? 'bottom' : 'right',
          align: 'start',
        },
      })),
      {
        element: isMobile ? '[data-tour="new-action-mobile"]' : '[data-tour="new-action"]',
        popover: {
          title: quickActionStep.title,
          description: quickActionStep.description,
          side: isMobile ? 'top' : 'bottom',
          align: 'start',
        },
      },
    ],
  });

  if (openedMobileMenu) {
    window.requestAnimationFrame(() => tour.drive());
  } else {
    tour.drive();
  }
  return tour;
}
