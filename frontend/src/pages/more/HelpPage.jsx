import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { Button, PageHeader } from '../../components/ui/ui.jsx';
import { PATHS } from '../../app/paths.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { startTour } from '../../lib/tour.js';
import './HelpPage.css';

const firstSteps = [
  {
    title: 'Cadastre as pessoas',
    description: 'Inclua quem participa dos controles financeiros para associar compras e movimentações.',
    to: PATHS.people,
    link: 'Ir para Pessoas',
  },
  {
    title: 'Confira as categorias',
    description: 'Revise as categorias usadas para organizar e filtrar os lançamentos.',
    to: PATHS.settings,
    link: 'Abrir Configurações',
  },
  {
    title: 'Cadastre os cartões',
    description: 'Informe limite, fechamento e vencimento para acompanhar as faturas.',
    to: PATHS.cards,
    link: 'Ir para Cartões',
  },
  {
    title: 'Registre ou importe dados',
    description: 'Use Lançamentos para compras e movimentações, ou importe uma planilha/fatura e confira a prévia antes de confirmar.',
    to: PATHS.transactions,
    link: 'Ir para Lançamentos',
  },
];

const areas = [
  {
    id: 'inicio',
    title: 'Início',
    to: PATHS.dashboard,
    description: 'Abra o resumo do mês para conferir faturas, limite disponível, gastos avulsos, valores recebidos e valores a receber.',
    details: [
      'Alterne entre as abas Cartões e Dinheiro e empréstimos.',
      'Use os seletores de mês e ano no topo para consultar outro período.',
      'Confira os avisos da Central de lembretes para identificar vencimentos e pendências.',
    ],
  },
  {
    id: 'planejamento',
    title: 'Planejamento Financeiro',
    to: PATHS.financialPlanning,
    description: 'Simule uma compra futura e compare o impacto projetado no orçamento.',
    details: [
      'Escolha a pessoa e informe valor, pagamento, parcelas e data prevista.',
      'Calcular mostra a projeção; Salvar simulação guarda o resultado no histórico.',
      'A simulação não altera os lançamentos reais. Use a conversão da própria simulação se decidir registrar a compra.',
    ],
  },
  {
    id: 'lancamentos',
    title: 'Lançamentos',
    to: PATHS.transactions,
    description: 'Esta área reúne compras, movimentações fora do cartão e importação/exportação.',
    links: [
      { label: 'Compras e parcelas', to: PATHS.purchases, description: 'Registre compras no cartão, parcelas e assinaturas; consulte compras do mês ou o histórico.' },
      { label: 'Dinheiro e empréstimos', to: PATHS.cashLedger, description: 'Registre despesas, vendas/valores a receber, empréstimos e reembolsos; acompanhe recebimentos e vencimentos.' },
      { label: 'Importação', to: PATHS.import, description: 'Importe planilhas ou faturas em PDF. Revise a prévia e confirme antes de gravar.' },
      { label: 'Exportação', to: PATHS.export, description: 'Baixe os dados financeiros em CSV para usar em uma planilha.' },
    ],
  },
  {
    id: 'pessoas',
    title: 'Pessoas',
    to: PATHS.people,
    description: 'Cadastre participantes e consulte os dados financeiros relacionados a cada pessoa.',
    details: [
      'A aba Aniversários lista as datas cadastradas e oferece atalhos para preparar felicitações.',
      'Abra uma pessoa para acessar Resumo, Extrato, Planilha e Cobrar.',
      'No cadastro da pessoa, use Portal para copiar o link individual de consulta. O portal não dá acesso às demais áreas da conta.',
    ],
  },
  {
    id: 'cartoes',
    title: 'Cartões',
    to: PATHS.cards,
    description: 'Cadastre cartões e acompanhe faturas, limites utilizados e disponíveis.',
    details: [
      'Consulte o valor em aberto e a data de vencimento da fatura do período selecionado.',
      'Use Pagar para registrar o pagamento da fatura e atualizar o limite.',
      'O cadastro não pede nem armazena o número completo do cartão.',
    ],
  },
  {
    id: 'veiculos',
    title: 'Veículos',
    to: PATHS.vehicles,
    description: 'Organize a frota e acompanhe gastos e informações de cada veículo.',
    details: [
      'Selecione Toda a frota ou um veículo e escolha o período do resumo.',
      'Use as abas Resumo/Painel da frota, Lançamentos, Manutenção & lembretes e Documentos.',
      'Novo gasto registra despesas do veículo; lembretes ajudam a acompanhar manutenção e vencimentos.',
    ],
  },
  {
    id: 'mais',
    title: 'Mais',
    to: PATHS.more,
    description: 'Acesse ferramentas e configurações que não ficam nas áreas principais.',
    details: [
      'O Assistente de IA abre pelo botão flutuante. Ele pode consultar informações financeiras e ajudar em registros; para analisar dados, configure a IA e dê consentimento em Configurações.',
      'O Tour rápido destaca os principais pontos da navegação sem substituir este guia.',
    ],
    links: [
      { label: 'Calculadora de rescisão', to: PATHS.rescission, description: 'Faça uma estimativa com os dados do vínculo e da rescisão; o cálculo é informativo.' },
      { label: 'Configurações', to: PATHS.settings, description: 'Gerencie categorias, importação, IA, lembretes, notificações e opções da conta. Leia com atenção as ações de exclusão.' },
      { label: 'Acessos', to: PATHS.adminUsers, description: 'Área administrativa para aprovar, acompanhar ou bloquear contas.', adminOnly: true },
    ],
  },
];

export default function HelpPage() {
  const { user } = useAuth();

  return (
    <section className="area-page help-page">
      <PageHeader
        title="Ajuda e primeiros passos"
        subtitle="Veja por onde começar, onde encontrar cada área e para que servem as principais funções."
        actions={(
          <Button onClick={startTour}>
            <BookOpen aria-hidden="true" /> Tour rápido
          </Button>
        )}
      />

      <section className="card help-start" aria-labelledby="help-start-title">
        <div className="help-section-heading">
          <span className="help-eyebrow">Comece aqui</span>
          <h2 id="help-start-title">Por onde começar</h2>
          <p>Uma sequência simples para preparar o sistema antes de registrar as movimentações.</p>
        </div>
        <ol className="help-steps">
          {firstSteps.map((step, index) => (
            <li className="help-step" key={step.title}>
              <span className="help-step-number" aria-hidden="true">{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                <Link to={step.to}>{step.link}</Link>
              </div>
            </li>
          ))}
        </ol>
        <p className="help-note">Não usa cartão? Você pode começar direto em Lançamentos &gt; Dinheiro e empréstimos.</p>
      </section>

      <nav className="help-index" aria-label="Ir para uma área da ajuda">
        {areas.map((area) => <a key={area.id} href={`#help-${area.id}`}>{area.title}</a>)}
      </nav>

      <div className="help-areas">
        {areas.map((area) => (
          <section className="card help-area" id={`help-${area.id}`} key={area.id}>
            <header className="help-area-heading">
              <div>
                <h2>{area.title}</h2>
                <p>{area.description}</p>
              </div>
              <Link className="btn btn-ghost help-open-link" to={area.to}>Abrir área</Link>
            </header>
            {area.details && (
              <ul className="help-details">
                {area.details.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            )}
            {area.links && (
              <div className="help-subareas">
                {area.links.filter((link) => !link.adminOnly || user?.role === 'admin').map((link) => (
                  <article className="help-subarea" key={link.label}>
                    <h3><Link to={link.to}>{link.label}</Link></h3>
                    <p>{link.description}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <section className="help-shortcuts" aria-labelledby="help-shortcuts-title">
        <div>
          <h2 id="help-shortcuts-title">Atalhos que aparecem em várias telas</h2>
          <p><strong>Novo registro</strong> abre opções rápidas para compra, despesa, venda, empréstimo, reembolso, gasto de veículo e pagamento/recebimento.</p>
          <p><strong>Busca</strong> ajuda a encontrar áreas e registros; <strong>lembretes</strong> mostram vencimentos e pendências; o <strong>assistente de IA</strong> fica no botão flutuante e depende de configuração e consentimento.</p>
        </div>
      </section>
    </section>
  );
}
