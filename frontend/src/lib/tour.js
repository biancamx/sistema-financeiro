import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const tourSteps = [
  { selector: 'inicio', title: 'Início', description: 'Acompanhe o painel mensal, as pendências e as ações que precisam de atenção.' },
  { selector: 'lancamentos-compras', title: 'Lançamentos', description: 'Acesse compras e parcelas, dinheiro e empréstimos e importações em abas.' },
  { selector: 'pessoas', title: 'Pessoas', description: 'Encontre cadastro, extrato, planilha, cobrança, portal e aniversários.' },
  { selector: 'cartoes', title: 'Cartões', description: 'Acompanhe limites, vencimentos e faturas.' },
  { selector: 'veiculos', title: 'Veículos', description: 'Gerencie gastos, manutenções, lembretes e documentos.' },
  { selector: 'mais', title: 'Mais', description: 'Abra o assistente de IA, a calculadora de rescisão, configurações e acessos administrativos.' },
];

export function startTour() {
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  const menuButton = document.querySelector('.menu-toggle-button');
  const navigationSelector = isMobile ? '.mobile-drawer-nav' : '.sidebar-nav';
  if (isMobile && menuButton?.getAttribute('aria-expanded') !== 'true') menuButton?.click();

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
    progressText: '{{current}} de {{total}}',
    onDestroyed: () => {
      if (isMobile && menuButton?.getAttribute('aria-expanded') === 'true') menuButton.click();
    },
    steps: [
      ...tourSteps.map((step) => ({
        element: `${navigationSelector} [data-tour="nav-${step.selector}"]`,
        popover: { title: step.title, description: step.description, side: 'right', align: 'start' },
      })),
      {
        element: isMobile ? '[data-tour="new-action-mobile"]' : '[data-tour="new-action"]',
        popover: { title: 'Novo registro', description: 'Crie compras, despesas, recebimentos ou gastos de veículos sem procurar o formulário.', side: 'bottom', align: 'start' },
      },
      {
        element: '[data-tour="reminders"]',
        popover: { title: 'Central de lembretes', description: 'Consulte vencimentos próximos e pendências financeiras.', side: 'bottom', align: 'start' },
      },
    ],
  });

  tour.drive();
  return tour;
}
