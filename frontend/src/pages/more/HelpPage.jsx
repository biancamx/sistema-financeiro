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
    description: 'Use o painel para entender rapidamente o que vence, o que já entrou e onde os gastos estão concentrados.',
    interactions: [
      { title: 'Escolha o período', description: 'Use mês e ano no cabeçalho. No gráfico de faturas, selecione uma coluna para abrir aquele mês.' },
      { title: 'Confira Cartões', description: 'Veja o total das faturas, o valor a pagar nos próximos períodos e o limite disponível. Compare cartões, valores por pessoa e gastos por categoria.' },
      { title: 'Abra Dinheiro e empréstimos', description: 'Alterne a aba para consultar gastos e recebimentos avulsos, valores pendentes, atrasos, próximos vencimentos, evolução mensal e formas de pagamento.' },
      { title: 'Vá do resumo ao detalhe', description: 'Na aba Dinheiro e empréstimos, selecione indicadores e links como “Ver todos” para abrir os registros que compõem os totais. A Central de lembretes destaca vencimentos e pendências que merecem atenção.' },
    ],
  },
  {
    id: 'planejamento',
    title: 'Planejamento Financeiro',
    to: PATHS.financialPlanning,
    description: 'Avalie uma compra antes de assumir o compromisso, comparando o cenário com e sem ela.',
    interactions: [
      { title: 'Monte o cenário', description: 'Escolha a pessoa e informe nome, categoria, valor, entrada, forma de pagamento, parcelas, juros, data prevista e horizonte de 12, 24 ou 36 meses. Se usar crédito, selecione o cartão.' },
      { title: 'Calcule ou salve', description: 'Calcular mostra uma projeção sem guardar no histórico. Salvar simulação calcula e registra o cenário para você voltar a ele depois.' },
      { title: 'Interprete o resultado', description: 'Compare saldo atual, saldo projetado sem e com a compra, impacto mensal, margem restante e custo estimado. O gráfico mostra os cenários ao longo do horizonte escolhido.' },
      { title: 'Decida o próximo passo', description: 'No histórico, aprove ou descarte a simulação. Se decidir comprar, use Converter em compra e confirme: a conversão cria lançamentos reais conforme a forma de pagamento.' },
    ],
  },
  {
    id: 'lancamentos',
    title: 'Lançamentos',
    to: PATHS.transactions,
    description: 'Registre e acompanhe o dinheiro que entra e sai, tanto em compras parceladas quanto em movimentações avulsas.',
    links: [
      { label: 'Compras e parcelas', to: PATHS.purchases, description: 'Registre uma compra, informe valor, data, cartão e parcelamento, e associe as pessoas envolvidas. Alterne entre o mês, o histórico e as assinaturas; pesquise e filtre por pessoa, cartão ou categoria. Marque parcelas como pagas e edite ou remova registros quando necessário.' },
      { label: 'Dinheiro e empréstimos', to: PATHS.cashLedger, description: 'Registre despesas, vendas, empréstimos e reembolsos com descrição, valor, data e dados de recebimento ou vencimento. Filtre por período, tipo, pessoa, categoria ou situação. Abra um registro para conferir detalhes e use Receber para atualizar valores pendentes.' },
      { label: 'Importação', to: PATHS.import, description: 'Selecione ou arraste uma planilha ou fatura compatível. Confira a prévia, corrija itens ambíguos ou sem valor e só então confirme a gravação. Para PDF, configure a IA e dê consentimento em Configurações.' },
      { label: 'Exportação', to: PATHS.export, description: 'Escolha o conjunto de dados — compras e parcelas, dinheiro e empréstimos ou gastos de veículos — e baixe o CSV para abrir numa planilha, arquivar ou fazer análises próprias.' },
    ],
  },
  {
    id: 'pessoas',
    title: 'Pessoas',
    to: PATHS.people,
    description: 'Organize quem participa dos lançamentos e acompanhe separadamente valores, pagamentos e pendências de cada pessoa.',
    interactions: [
      { title: 'Cadastre e encontre', description: 'Inclua a pessoa e mantenha os dados de identificação atualizados. Use a busca global para localizar rapidamente pessoas cadastradas.' },
      { title: 'Abra o Resumo', description: 'Selecione mês e ano para ver o saldo pendente e as próximas parcelas. O botão Cobrar leva ao demonstrativo e às opções de cobrança.' },
      { title: 'Consulte Extrato e Planilha', description: 'No Extrato, confira o consolidado anual de faturas, contas fixas e pendências. Na Planilha, acompanhe receitas, descontos e despesas mês a mês; marque despesas pagas no mês correspondente e atualize observações.' },
      { title: 'Compartilhe com cuidado', description: 'Na área Portal, abra ou copie o link individual para a pessoa consultar as informações disponibilizadas para ela. Esse link não libera acesso às demais áreas da sua conta; compartilhe-o somente com quem deve recebê-lo.' },
    ],
    links: [
      { label: 'Aniversários', to: PATHS.birthdays, description: 'Cadastre nome, dia e mês para consultar as próximas datas. Edite a felicitação sugerida, copie o texto ou abra o WhatsApp para compartilhar.' },
    ],
  },
  {
    id: 'cartoes',
    title: 'Cartões',
    to: PATHS.cards,
    description: 'Acompanhe faturas e limites sem precisar guardar os dados completos do cartão no sistema.',
    interactions: [
      { title: 'Cadastre o cartão', description: 'Informe nome, instituição, bandeira, responsável, limite e dias de fechamento e vencimento. Você pode usar apenas os quatro últimos dígitos; o número completo não é solicitado.' },
      { title: 'Organize limites', description: 'Escolha limite individual ou associe cartões a um grupo de limite compartilhado. Confira o grupo selecionado antes de salvar, pois os cartões do grupo usam o limite comum.' },
      { title: 'Acompanhe a fatura', description: 'Use o período do cabeçalho para ver os valores do mês. Compare o limite utilizado e disponível e abra Pagar para registrar a quitação da fatura.' },
      { title: 'Mantenha os dados consistentes', description: 'Revise fechamento e vencimento ao cadastrar ou editar: essas datas ajudam a organizar as compras no ciclo correto e a acompanhar os alertas.' },
    ],
  },
  {
    id: 'veiculos',
    title: 'Veículos',
    to: PATHS.vehicles,
    description: 'Tenha em um só lugar o histórico de despesas, manutenção, documentos e indicadores de cada veículo.',
    interactions: [
      { title: 'Cadastre e selecione', description: 'Use Novo veículo para criar a ficha. Depois alterne entre Toda a frota e um veículo específico para separar os indicadores.' },
      { title: 'Registre gastos', description: 'Em Novo gasto ou na aba Lançamentos, informe a despesa e o veículo correspondente. Use categoria, data e quilometragem quando disponíveis para melhorar o histórico e os indicadores.' },
      { title: 'Analise os custos', description: 'No Resumo, escolha período e ano para comparar gastos, médias, categorias e custo por quilômetro quando houver dados suficientes. Na frota, compare os veículos entre si.' },
      { title: 'Antecipe tarefas', description: 'Em Manutenção & lembretes, cadastre serviços e vencimentos futuros. Em Documentos, guarde os arquivos relacionados ao veículo e consulte-os quando precisar.' },
    ],
  },
  {
    id: 'mais',
    title: 'Mais',
    to: PATHS.more,
    description: 'Acesse ferramentas, preferências e controles administrativos que não ficam nas áreas principais.',
    interactions: [
      { title: 'Configure o sistema', description: 'Em Configurações, organize categorias, preferências, lembretes e notificações. A área também reúne importação de dados, opções de IA, segurança e ações da conta.' },
      { title: 'Ative notificações', description: 'Em Configurações, ative notificações no dispositivo e aceite a permissão do navegador. Os avisos push são para a sua própria conta e podem lembrar faturas próximas ou atrasadas.' },
      { title: 'Use o Assistente de IA com consentimento', description: 'Configure o provedor, modelo e sua chave em Configurações, teste e salve. Leia o aviso de compartilhamento de dados e dê consentimento antes de usar recursos que enviam informações ao provedor. Você pode retirar o consentimento nas configurações.' },
      { title: 'Acesse ferramentas extras', description: 'A Calculadora de rescisão fornece uma estimativa informativa; confira os dados e o resultado com um profissional antes de tomar decisões. O Tour guiado apresenta os pontos principais da navegação.' },
      { title: 'Administre acessos', description: 'Se sua conta for administradora, use Acessos para aprovar, acompanhar ou bloquear contas cadastradas.' },
    ],
    links: [
      { label: 'Calculadora de rescisão', to: PATHS.rescission, description: 'Informe remuneração, datas, motivo do desligamento e aviso prévio para estimar as verbas rescisórias. O resultado é uma referência, não substitui cálculo profissional.' },
      { label: 'Configurações', to: PATHS.settings, description: 'Gerencie categorias, importação, IA, lembretes, notificações e opções da conta. Leia com atenção as ações de exclusão e redefinição.' },
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
            {area.interactions && (
              <ol className="help-interactions">
                {area.interactions.map((interaction) => (
                  <li key={interaction.title}>
                    <strong>{interaction.title}</strong>
                    <p>{interaction.description}</p>
                  </li>
                ))}
              </ol>
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
          <h2 id="help-shortcuts-title">Interações que economizam tempo</h2>
          <p><strong>Novo registro:</strong> use o atalho para escolher compra, despesa, venda, empréstimo, reembolso ou gasto de veículo. Preencha os dados solicitados para aquele tipo e confira antes de registrar.</p>
          <p><strong>Busca global:</strong> encontre pessoas, compras e veículos sem navegar por cada lista. Selecione um resultado para abrir a área correspondente.</p>
          <p><strong>Período:</strong> os seletores de mês e ano no cabeçalho ajudam a manter os resumos alinhados ao período que você quer analisar. Ao comparar números, confirme sempre o período exibido.</p>
          <p><strong>Central de lembretes:</strong> abra um aviso para consultar o vencimento ou a pendência relacionada e seguir para o registro correspondente.</p>
          <p><strong>Instalação no celular:</strong> o sistema pode ser instalado como aplicativo web. Com o app instalado, HTTPS e permissão do navegador, você pode receber notificações push da sua conta.</p>
          <p><strong>Boas práticas:</strong> registre cada movimentação assim que possível, informe a pessoa e a categoria corretas, confira parcelas e datas, e revise os totais do mês. Simulações não alteram lançamentos até que você as converta e confirme.</p>
        </div>
      </section>
    </section>
  );
}
