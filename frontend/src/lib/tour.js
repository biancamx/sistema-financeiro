import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { PATHS } from '../app/paths.js';

const tourSteps = [
  {
    path: PATHS.dashboard,
    title: 'Painel financeiro',
    description: 'Veja o resumo do mês, acompanhe faturas de cartões e consulte os indicadores do caixa avulso.',
  },
  {
    path: PATHS.purchases,
    title: 'Lançamentos',
    description: 'Registre compras, associe cartão, pessoa e categoria, e acompanhe as parcelas ao longo dos meses.',
  },
  {
    path: PATHS.cashLedger,
    title: 'Avulsos',
    description: 'Controle despesas, vendas, empréstimos e reembolsos fora das compras de cartão, incluindo parcelas e recebimentos.',
  },
  {
    path: PATHS.cards,
    title: 'Cartões',
    description: 'Cadastre cartões, informe titular e limites e acompanhe faturas e pagamentos.',
  },
  {
    path: PATHS.budget,
    title: 'Planilha mensal',
    description: 'Organize receitas, despesas e contas fixas por pessoa, ano e mês.',
  },
  {
    path: PATHS.overview,
    title: 'Visão geral',
    description: 'Consulte uma visão consolidada dos valores e compromissos financeiros por período.',
  },
  {
    path: PATHS.vehicles,
    title: 'Gestão de veículos',
    description: 'Cadastre veículos e registre manutenções e despesas com datas, quilometragem e rateio entre pessoas.',
  },
  {
    path: PATHS.people,
    title: 'Pessoas e portal do participante',
    description: 'Mantenha contatos e dados das pessoas, gere links do portal do participante e prepare cobranças.',
  },
  {
    path: PATHS.birthdays,
    title: 'Aniversários',
    description: 'Consulte e organize os aniversários cadastrados para as pessoas da sua conta.',
  },
  {
    path: PATHS.rescission,
    title: 'Calculadora de rescisão',
    description: 'Faça uma estimativa dos valores de rescisão informando os dados do vínculo de trabalho.',
  },
  {
    path: PATHS.settings,
    title: 'Configurações',
    description: 'Acesse as opções da conta, revise importações e encontre as ações de gerenciamento de dados.',
  },
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
        element: `${navigationSelector} [data-tour="nav-${step.path.replace(/^\//, '')}"]`,
        popover: {
          title: step.title,
          description: step.description,
          side: 'right',
          align: 'start',
        },
      })),
      {
        element: '[data-tour="reminders"]',
        popover: {
          title: 'Central de lembretes',
          description: 'Use este sino para consultar vencimentos próximos e pendências financeiras.',
          side: 'bottom',
          align: 'start',
        },
      },
    ],
  });

  tour.drive();
  return tour;
}
