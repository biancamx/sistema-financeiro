import mongoose from 'mongoose';
import { round2 } from '../../lib/months.js';
import { subscriptionActiveInPeriod } from '../../lib/cardBilling.js';
import { Card } from '../../models/Card.js';
import { Category } from '../../models/Category.js';
import { BudgetSheet } from '../../models/BudgetSheet.js';
import { Installment } from '../../models/Installment.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';
import { Vehicle } from '../../models/Vehicle.js';
import { createCashLedgerService } from '../cashLedger/cashLedger.service.js';
import { createDashboardService } from '../dashboard/dashboard.service.js';
import { createPurchasesService } from '../purchases/purchases.service.js';
import { createVehiclesService } from '../vehicles/vehicles.service.js';
import { SECTIONS } from '../budgets/budgets.defaults.js';
import { EXPENSE_CATEGORIES } from '../vehicles/vehicles.categories.js';

export const toolsDeclaration = [
  {
    name: 'consultarResumoFinanceiro',
    description: 'Consulta o resumo financeiro de um mês e ano, incluindo faturas de cartão, valores em aberto e resumo do caixa.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mes: { type: 'NUMBER', description: 'Número do mês (de 1 a 12); padrão: mês atual' },
        ano: { type: 'NUMBER', description: 'Ano com 4 dígitos; padrão: ano atual' },
      },
    },
  },
  {
    name: 'consultarContasFinanceiras',
    description: 'Consulta saldo do Caixa Avulso, despesas, valores a receber e vencimentos. Para pendências ou atrasos históricos, use todosPeriodos=true.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mes: { type: 'NUMBER', description: 'Número do mês de 1 a 12; padrão: mês atual' },
        ano: { type: 'NUMBER', description: 'Ano com 4 dígitos; padrão: ano atual' },
        status: { type: 'STRING', enum: ['pendente', 'atrasada', 'quitado'] },
        todosPeriodos: { type: 'BOOLEAN', description: 'Quando verdadeiro, lista itens de todos os períodos' },
      },
    },
  },
  {
    name: 'consultarHistoricoFinanceiro',
    description: 'Consulta compras e parcelas de cartão e lançamentos do Caixa Avulso no mês escolhido, com busca opcional por descrição e filtro opcional por cartão.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mes: { type: 'NUMBER', description: 'Número do mês de 1 a 12; padrão: mês atual' },
        ano: { type: 'NUMBER', description: 'Ano com 4 dígitos; padrão: ano atual' },
        origem: { type: 'STRING', enum: ['cartao', 'avulso', 'todos'], description: 'Fonte do histórico; padrão todos' },
        busca: { type: 'STRING', description: 'Texto para buscar na descrição' },
        nomeCartao: { type: 'STRING', description: 'Nome exato do cartão, quando quiser filtrar' },
      },
    },
  },
  {
    name: 'listarCategoriasFinanceiras',
    description: 'Lista as categorias financeiras cadastradas pelo usuário atual, incluindo seu tipo.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'consultarPlanilhaFinanceiraPessoa',
    description: 'Consulta a planilha financeira anual e as receitas/despesas registradas para uma pessoa. Não cria nem altera a planilha.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nomePessoa: { type: 'STRING', description: 'Nome exato da pessoa cadastrada' },
        ano: { type: 'NUMBER', description: 'Ano com 4 dígitos; padrão: ano atual' },
        mes: { type: 'NUMBER', description: 'Mês de 1 a 12 para restringir o resultado; opcional' },
      },
      required: ['nomePessoa'],
    },
  },
  {
    name: 'consultarComparacaoFinanceira',
    description: 'Compara faturas de cartão, despesas avulsas e recebimentos do mês selecionado com o mês anterior.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mes: { type: 'NUMBER', description: 'Número do mês de 1 a 12; padrão: mês atual' },
        ano: { type: 'NUMBER', description: 'Ano com 4 dígitos; padrão: ano atual' },
      },
    },
  },
  {
    name: 'listarCartoesELimites',
    description: 'Lista os cartões cadastrados pelo usuário atual, com seus limites, fechamentos e vencimentos.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'listarPessoas',
    description: 'Lista os nomes das pessoas participantes cadastradas pelo usuário atual.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'cadastrarCompraCartao',
    description: 'Registra uma compra no cartão do usuário atual. Descrição, valor, parcelas, cartão, pessoa responsável e categoria cadastrada são obrigatórios.',
    parameters: {
      type: 'OBJECT',
      properties: {
        descricao: { type: 'STRING', description: 'Descrição da compra (ex: Supermercado, Farmácia)' },
        valorTotal: { type: 'NUMBER', description: 'Valor total da compra em reais' },
        totalParcelas: { type: 'NUMBER', description: 'Quantidade de parcelas (de 1 a 120)' },
        nomeCartao: { type: 'STRING', description: 'Nome do cartão cadastrado' },
        nomePessoa: { type: 'STRING', description: 'Nome da pessoa responsável pela compra' },
        categoria: { type: 'STRING', description: 'Nome exato de uma categoria cadastrada' },
        dataCompra: { type: 'STRING', description: 'Data da compra no formato AAAA-MM-DD; se omitida, usa a data atual' },
      },
      required: ['descricao', 'valorTotal', 'totalParcelas', 'nomeCartao', 'nomePessoa', 'categoria'],
    },
  },
  {
    name: 'cadastrarLancamentoAvulso',
    description: 'Registra um lançamento no Caixa Avulso. Tipo, descrição, valor, forma de pagamento, categoria cadastrada e pessoa envolvida são obrigatórios. Para reembolso, informe a pessoa ou contraparte.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tipo: { type: 'STRING', enum: ['expense', 'income', 'loan', 'reimbursement'] },
        descricao: { type: 'STRING', description: 'Descrição do lançamento' },
        valor: { type: 'NUMBER', description: 'Valor em reais' },
        formaPagamento: { type: 'STRING', enum: ['pix', 'dinheiro', 'debito', 'transferencia'] },
        nomePessoa: { type: 'STRING', description: 'Nome exato da pessoa cadastrada, quando aplicável' },
        contraparte: { type: 'STRING', description: 'Pessoa ou empresa devedora, para reembolso sem pessoa cadastrada' },
        categoria: { type: 'STRING', description: 'Nome exato de uma categoria cadastrada' },
        parcelas: { type: 'NUMBER', description: 'Quantidade de parcelas para venda ou empréstimo (de 1 a 240)' },
        pago: { type: 'BOOLEAN', description: 'Se a venda ou empréstimo já foi recebido integralmente' },
      },
      required: ['tipo', 'descricao', 'valor', 'formaPagamento', 'categoria'],
    },
  },
  {
    name: 'listarVeiculos',
    description: 'Lista modelo, placa, ano e situação dos veículos do usuário atual.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'cadastrarDespesaVeiculo',
    description: 'Registra uma despesa paga em dinheiro associada a um veículo cadastrado. A categoria aceita a chave ou o nome exibido no sistema.',
    parameters: {
      type: 'OBJECT',
      properties: {
        identificadorVeiculo: { type: 'STRING', description: 'Modelo ou placa do veículo' },
        descricao: { type: 'STRING', description: 'Descrição da despesa' },
        valor: { type: 'NUMBER', description: 'Valor em reais (mínimo R$ 1,00)' },
        categoria: {
          type: 'STRING',
          description: `Categoria da despesa. Valores aceitos: ${EXPENSE_CATEGORIES.map((item) => `${item.key} (${item.label})`).join(', ')}`,
        },
        nomePessoa: { type: 'STRING', description: 'Nome exato da pessoa pagadora cadastrada' },
      },
      required: ['identificadorVeiculo', 'descricao', 'valor', 'categoria', 'nomePessoa'],
    },
  },
  {
    name: 'cadastrarNovoVeiculo',
    description: 'Cadastra um veículo para o usuário atual. Modelo, placa e ano são obrigatórios.',
    parameters: {
      type: 'OBJECT',
      properties: {
        modelo: { type: 'STRING', description: 'Modelo do veículo (até 80 caracteres)' },
        placa: { type: 'STRING', description: 'Placa brasileira do veículo' },
        ano: { type: 'NUMBER', description: 'Ano do veículo (de 1900 a 2100)' },
        tipo: { type: 'STRING', enum: ['car', 'motorcycle', 'utility', 'other'], description: 'Tipo: carro, moto, utilitário ou outro; padrão carro' },
        valorCompra: { type: 'NUMBER', description: 'Valor pago na compra em reais, opcional' },
      },
      required: ['modelo', 'placa', 'ano'],
    },
  },
  {
    name: 'cadastrarNovaPessoa',
    description: 'Cadastra uma pessoa para o usuário atual. Nome obrigatório e telefone opcional.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nome: { type: 'STRING', description: 'Nome da pessoa (até 60 caracteres)' },
        telefone: { type: 'STRING', description: 'Telefone ou WhatsApp, opcional (até 30 caracteres)' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'cadastrarNovoCartao',
    description: 'Cadastra um cartão para o usuário atual. Nome, limite, dia de fechamento e dia de vencimento são obrigatórios. Não solicite número completo do cartão.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nome: { type: 'STRING', description: 'Nome do cartão (até 60 caracteres)' },
        limite: { type: 'NUMBER', description: 'Limite total em reais (de 0 a 10.000.000)' },
        diaFechamento: { type: 'NUMBER', description: 'Dia do fechamento da fatura (1 a 31)' },
        diaVencimento: { type: 'NUMBER', description: 'Dia do vencimento da fatura (1 a 31)' },
      },
      required: ['nome', 'limite', 'diaFechamento', 'diaVencimento'],
    },
  },
  {
    name: 'listarPessoasEChavesPix',
    description: 'Lista os nomes das pessoas cadastradas. Por segurança, não retorna chaves Pix, telefones nem outros dados pessoais; consulte a chave Pix na aba Pessoas.',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

const dashboardService = createDashboardService();
const purchasesService = createPurchasesService();
const cashLedgerService = createCashLedgerService();
const vehiclesService = createVehiclesService();

function requireUserId(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error('Usuário autenticado inválido.');
  }
}

function matchByName(items, name, label) {
  const normalizedName = name.trim().toLocaleLowerCase('pt-BR');
  const matches = items.filter((item) => item.name.toLocaleLowerCase('pt-BR') === normalizedName);
  if (matches.length !== 1) {
    throw new Error(`${label} "${name}" não encontrado. Consulte os cadastros e informe o nome exato.`);
  }
  return matches[0];
}

function normalizeText(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
}

function optionalCategory(categories, name) {
  if (!name) return null;
  return matchByName(categories, name, 'Categoria');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function resolvePeriod(args = {}) {
  const now = new Date();
  const month = args.mes === undefined ? now.getUTCMonth() + 1 : Number(args.mes);
  const year = args.ano === undefined ? now.getUTCFullYear() : Number(args.ano);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('O mês deve ser um número entre 1 e 12.');
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('O ano deve estar entre 2000 e 2100.');
  }
  return { month, year };
}

function previousPeriod({ month, year }) {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

function compareAmounts(current, previous) {
  return {
    atual: current,
    periodoAnterior: previous,
    diferenca: round2(current - previous),
    variacaoPercentual: previous === 0 ? null : round2(((current - previous) / previous) * 100),
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validatePurchaseArgs(args) {
  if (typeof args.descricao !== 'string' || !args.descricao.trim() || args.descricao.trim().length > 120) {
    throw new Error('A descrição deve ter entre 1 e 120 caracteres.');
  }
  if (!Number.isFinite(args.valorTotal) || args.valorTotal <= 0 || args.valorTotal > 10_000_000) {
    throw new Error('O valor total deve ser maior que zero e não pode exceder R$ 10.000.000.');
  }
  if (!Number.isInteger(args.totalParcelas) || args.totalParcelas < 1 || args.totalParcelas > 120) {
    throw new Error('A quantidade de parcelas deve ser um número inteiro entre 1 e 120.');
  }
  if (typeof args.nomeCartao !== 'string' || !args.nomeCartao.trim()) {
    throw new Error('Informe o nome do cartão.');
  }
  if (typeof args.nomePessoa !== 'string' || !args.nomePessoa.trim()) {
    throw new Error('Informe a pessoa responsável pela compra.');
  }
  if (typeof args.categoria !== 'string' || !args.categoria.trim()) {
    throw new Error('Informe uma categoria cadastrada para a compra.');
  }
  if (args.dataCompra !== undefined) {
    if (typeof args.dataCompra !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args.dataCompra)) {
      throw new Error('A data da compra deve estar no formato AAAA-MM-DD.');
    }
    const parsedDate = new Date(`${args.dataCompra}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== args.dataCompra) {
      throw new Error('A data da compra informada não é válida.');
    }
  }
  if (args.categoria !== undefined && (typeof args.categoria !== 'string' || !args.categoria.trim())) {
    throw new Error('A categoria informada deve ser um nome válido.');
  }
}

export async function executarFerramenta(nomeFuncao, args, userId) {
  requireUserId(userId);

  switch (nomeFuncao) {
    case 'consultarResumoFinanceiro': {
      const period = resolvePeriod(args);
      return dashboardService.summary(userId, period);
    }

    case 'consultarComparacaoFinanceira': {
      const currentPeriod = resolvePeriod(args);
      const priorPeriod = previousPeriod(currentPeriod);
      const current = await dashboardService.summary(userId, currentPeriod);
      const previous = await dashboardService.summary(userId, priorPeriod);
      return {
        periodo: currentPeriod,
        periodoAnterior: priorPeriod,
        cartoes: compareAmounts(current.totals.month, previous.totals.month),
        despesasAvulsas: compareAmounts(current.totals.cash.spent, previous.totals.cash.spent),
        valoresRecebidos: compareAmounts(current.totals.cash.received, previous.totals.cash.received),
        valoresAReceber: current.totals.cash.totalReceivable,
      };
    }

    case 'consultarContasFinanceiras': {
      const period = resolvePeriod(args);
      if (args.todosPeriodos !== undefined && typeof args.todosPeriodos !== 'boolean') {
        throw new Error('O campo todosPeriodos deve ser verdadeiro ou falso.');
      }
      const filters = {
        ...(args.todosPeriodos ? { all: true } : period),
        ...(args.status && { status: args.status }),
      };
      if (args.status && !['pendente', 'atrasada', 'quitado'].includes(args.status)) {
        throw new Error('Status inválido. Use pendente, atrasada ou quitado.');
      }
      const [summary, result, dashboard] = await Promise.all([
        cashLedgerService.summary(userId, period.month, period.year),
        cashLedgerService.list(userId, filters),
        cashLedgerService.dashboard(userId, { period: 'month', ...period }),
      ]);
      const entries = result.data.slice(-30).map((item) => ({
        id: item.entryId,
        tipo: item.kind,
        descricao: item.description,
        data: item.entryDate,
        vencimento: item.dueDate,
        parcela: item.number,
        totalParcelas: item.count,
        categoria: item.category,
        pessoa: item.person,
        contraparte: item.counterparty,
        valor: item.amount,
        recebido: item.received,
        emAberto: item.outstanding,
        status: item.status,
      }));
      return {
        periodo: period,
        resumo: summary,
        saldoCaixa: round2(dashboard.totals.balanceCents / 100),
        vencidas: dashboard.overdue.map((item) => ({
          descricao: item.description,
          pessoa: item.person,
          vencimento: item.dueDate,
          emAberto: round2(item.amountCents / 100),
        })),
        proximas: dashboard.upcoming.map((item) => ({
          descricao: item.description,
          pessoa: item.person,
          vencimento: item.dueDate,
          emAberto: round2(item.amountCents / 100),
        })),
        totalLancamentos: result.data.length,
        truncado: result.data.length > 30,
        lancamentos: entries,
        aviso: 'Despesas avulsas são registradas como movimentações; o Caixa Avulso não controla status de pagamento para elas.',
      };
    }

    case 'consultarHistoricoFinanceiro': {
      const period = resolvePeriod(args);
      const origin = args.origem ?? 'todos';
      if (!['cartao', 'avulso', 'todos'].includes(origin)) {
        throw new Error('Origem inválida. Use cartao, avulso ou todos.');
      }
      if (args.busca !== undefined && (typeof args.busca !== 'string' || args.busca.length > 100)) {
        throw new Error('A busca deve ter até 100 caracteres.');
      }
      let cardId;
      if (args.nomeCartao) {
        if (typeof args.nomeCartao !== 'string' || !args.nomeCartao.trim()) {
          throw new Error('Informe um nome de cartão válido.');
        }
        const cards = await Card.find({ userId }).select('_id name').lean();
        cardId = matchByName(cards, args.nomeCartao, 'Cartão')._id;
      }

      const items = {};
      if (origin !== 'avulso') {
        const periodInstallments = await Installment.find({
          userId, year: period.year, month: period.month,
        }).select('purchaseId number year month amount paidAmount paid').lean();
        const periodStart = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
        const periodEnd = new Date(Date.UTC(period.year, period.month, 0)).toISOString().slice(0, 10);
        const purchaseFilter = {
          userId,
          ...(cardId && { cardId }),
          ...(args.busca && { description: { $regex: escapeRegex(args.busca), $options: 'i' } }),
          $or: [
            { _id: { $in: periodInstallments.map((item) => item.purchaseId) } },
            { purchaseDate: { $gte: periodStart, $lte: periodEnd } },
          ],
        };
        const purchaseRows = await Purchase.find(purchaseFilter)
          .populate('personId', 'name')
          .populate('cardId', 'name')
          .populate('categoryId', 'name')
          .sort({ purchaseDate: -1, createdAt: -1 })
          .limit(101)
          .lean();
        const purchases = purchaseRows.slice(0, 100);
        const cardHistoryTruncated = purchaseRows.length > 100;
        const purchaseIds = purchases.map((item) => item._id);
        const installments = purchaseIds.length
          ? await Installment.find({
            userId, purchaseId: { $in: purchaseIds }, year: period.year, month: period.month,
          }).lean()
          : [];
        const installmentByPurchase = new Map(installments.map((item) => [String(item.purchaseId), item]));
        items.cartao = purchases.map((purchase) => {
          const installment = installmentByPurchase.get(String(purchase._id));
          if (purchase.isSubscription && !subscriptionActiveInPeriod(purchase, period.year, period.month)) return null;
          return {
            descricao: purchase.description,
            dataCompra: purchase.purchaseDate,
            cartao: purchase.cardId?.name ?? null,
            pessoa: purchase.personId?.name ?? null,
            categoria: purchase.categoryId?.name ?? null,
            valorTotal: purchase.totalAmount,
            parcelas: purchase.totalInstallments,
            parcelaNoPeriodo: installment ? {
              numero: installment.number,
              valor: installment.amount,
              pago: installment.paid,
              valorPago: installment.paidAmount,
            } : null,
          };
        }).filter(Boolean);
        items.cartaoTruncado = cardHistoryTruncated;
      }

      if (origin !== 'cartao') {
        const cash = await cashLedgerService.list(userId, {
          month: period.month,
          year: period.year,
          ...(args.busca && { search: args.busca }),
        });
        items.avulso = cash.data.slice(-30).map((item) => ({
          tipo: item.kind,
          descricao: item.description,
          data: item.entryDate,
          vencimento: item.dueDate,
          parcela: item.number,
          totalParcelas: item.count,
          categoria: item.category,
          pessoa: item.person,
          valor: item.amount,
          recebido: item.received,
          emAberto: item.outstanding,
          status: item.status,
        }));
        items.avulsoTruncado = cash.data.length > 30;
      }

      return { periodo: period, ...items };
    }

    case 'listarCategoriasFinanceiras': {
      const categories = await Category.find({ userId }).select('name type').sort({ name: 1 }).lean();
      return categories.map(({ name, type }) => ({ nome: name, tipo: type }));
    }

    case 'consultarPlanilhaFinanceiraPessoa': {
      if (typeof args.nomePessoa !== 'string' || !args.nomePessoa.trim()) {
        throw new Error('Informe o nome exato da pessoa cadastrada.');
      }
      const { year } = resolvePeriod({ ano: args.ano });
      const month = args.mes === undefined ? null : Number(args.mes);
      if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
        throw new Error('O mês deve ser um número entre 1 e 12.');
      }
      const people = await Person.find({ userId }).select('_id name').lean();
      const person = matchByName(people, args.nomePessoa, 'Pessoa');
      const sheet = await BudgetSheet.findOne({
        userId, personId: person._id, year,
      }).select('rows').lean();
      if (!sheet) {
        return {
          pessoa: person.name,
          ano: year,
          encontrada: false,
          mensagem: 'Não há uma planilha financeira salva para esta pessoa e ano.',
        };
      }

      const sectionLabels = new Map(SECTIONS.map((section) => [section.key, section.label]));
      const totalsBySection = new Map();
      const preparedRows = sheet.rows.map((row) => {
        const values = Array(12).fill(0);
        for (const cell of row.cells) values[cell.month - 1] = cell.value;
        const totals = totalsBySection.get(row.section) ?? Array(12).fill(0);
        values.forEach((value, index) => { totals[index] += value; });
        totalsBySection.set(row.section, totals);
        return { row, values };
      });
      const relevantRows = preparedRows.filter(({ values }) => month === null || values[month - 1] !== 0);
      const rows = relevantRows.slice(0, 100).map(({ row, values }) => ({
        secao: sectionLabels.get(row.section) ?? row.section,
        nome: row.label,
        ...(month === null ? { valoresMensais: values } : { valor: values[month - 1] }),
      }));
      const sections = [...totalsBySection].map(([key, values]) => ({
        secao: sectionLabels.get(key) ?? key,
        ...(month === null ? { valoresMensais: values.map(round2) } : { valor: round2(values[month - 1]) }),
      }));
      return {
        pessoa: person.name,
        ano: year,
        ...(month !== null && { mes: month }),
        encontrada: true,
        linhasRetornadas: rows.length,
        linhasTotais: relevantRows.length,
        truncada: relevantRows.length > 100,
        secoes: sections,
        linhas: rows,
      };
    }

    case 'listarCartoesELimites': {
      const cartoes = await Card.find({ userId })
        .select('name limit closingDay dueDay')
        .sort({ name: 1 })
        .lean();
      return cartoes.map((cartao) => ({
        id: String(cartao._id),
        nome: cartao.name,
        limite: cartao.limit,
        diaFechamento: cartao.closingDay,
        diaVencimento: cartao.dueDay,
      }));
    }

    case 'listarPessoas': {
      const pessoas = await Person.find({ userId }).select('name').sort({ name: 1 }).lean();
      return pessoas.map((pessoa) => ({ id: String(pessoa._id), nome: pessoa.name }));
    }

    case 'listarPessoasEChavesPix': {
      const pessoas = await Person.find({ userId }).select('name').sort({ name: 1 }).lean();
      return {
        pessoas: pessoas.map((pessoa) => ({ id: String(pessoa._id), nome: pessoa.name })),
        aviso: 'Chaves Pix e outros dados pessoais não são enviados ao assistente. Consulte a chave na aba Pessoas.',
      };
    }

    case 'listarVeiculos': {
      const veiculos = await Vehicle.find({ userId }).select('model plate year status').sort({ model: 1 }).lean();
      return veiculos.map((veiculo) => ({
        id: String(veiculo._id),
        modelo: veiculo.model,
        placa: veiculo.plate,
        ano: veiculo.year,
        status: veiculo.status,
      }));
    }

    case 'cadastrarCompraCartao': {
      validatePurchaseArgs(args);
      const [cartoes, pessoas] = await Promise.all([
        Card.find({ userId }).select('_id name').lean(),
        Person.find({ userId }).select('_id name').lean(),
      ]);
      const cartao = matchByName(cartoes, args.nomeCartao, 'Cartão');
      const pessoa = matchByName(pessoas, args.nomePessoa, 'Pessoa');
      let categoria = null;
      if (args.categoria) {
        const categories = await Category.find({ userId }).select('_id name').lean();
        categoria = matchByName(categories, args.categoria, 'Categoria');
      }

      const now = new Date();
      const purchaseDate = args.dataCompra ?? now.toISOString().slice(0, 10);
      const result = await purchasesService.create(userId, {
        description: args.descricao.trim(),
        total: args.valorTotal,
        count: args.totalParcelas,
        cardId: String(cartao._id),
        personId: String(pessoa._id),
        categoryId: categoria ? String(categoria._id) : null,
        purchaseDate,
        startMonth: Number(purchaseDate.slice(5, 7)),
        startYear: Number(purchaseDate.slice(0, 4)),
      });

      return {
        sucesso: true,
        mensagem: `Compra "${result.description}" cadastrada no cartão ${result.card}.`,
        compraId: result.id,
        parcelas: result.count,
        valorTotal: result.total,
      };
    }

    case 'cadastrarLancamentoAvulso': {
      const kindByType = {
        expense: 'expense',
        income: 'sale',
        loan: 'loan',
        reimbursement: 'refund',
      };
      const kind = kindByType[args.tipo];
      if (!kind) throw new Error('Tipo inválido. Use expense, income, loan ou reimbursement.');
      if (typeof args.formaPagamento !== 'string' || !args.formaPagamento.trim()) {
        throw new Error('Informe a forma de pagamento do lançamento.');
      }
      if (typeof args.categoria !== 'string' || !args.categoria.trim()) {
        throw new Error('Informe uma categoria cadastrada para o lançamento.');
      }
      if (typeof args.descricao !== 'string' || !args.descricao.trim() || args.descricao.trim().length > 160) {
        throw new Error('A descrição deve ter entre 1 e 160 caracteres.');
      }
      if (!Number.isFinite(args.valor) || args.valor <= 0 || args.valor > 100_000_000) {
        throw new Error('O valor deve ser maior que zero e não pode exceder R$ 100.000.000.');
      }
      const installmentCount = args.parcelas ?? 1;
      if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 240) {
        throw new Error('A quantidade de parcelas deve ser um número inteiro entre 1 e 240.');
      }

      const paymentMethodByName = {
        pix: 'pix',
        dinheiro: 'cash',
        debito: 'debit',
        transferencia: 'transfer',
      };
      const paymentMethod = paymentMethodByName[normalizeText(args.formaPagamento)];
      if (!paymentMethod) {
        throw new Error('Forma de pagamento inválida. Use pix, dinheiro, debito ou transferencia.');
      }
      if (kind === 'refund' && args.pago === true) {
        throw new Error('Para registrar um reembolso já recebido, use a tela Avulsos e informe o recebimento.');
      }
      if (args.pago !== undefined && typeof args.pago !== 'boolean') {
        throw new Error('O campo pago deve ser verdadeiro ou falso.');
      }
      if (kind === 'expense' && args.pago !== undefined) {
        throw new Error('O Caixa Avulso não controla status de pagamento de despesas; registre-a pela tela Avulsos.');
      }
      if (args.contraparte !== undefined
        && (typeof args.contraparte !== 'string' || args.contraparte.trim().length > 120)) {
        throw new Error('A contraparte deve ter até 120 caracteres.');
      }

      const [people, categories] = await Promise.all([
        Person.find({ userId }).select('_id name').lean(),
        Category.find({ userId }).select('_id name').lean(),
      ]);
      const person = args.nomePessoa ? matchByName(people, args.nomePessoa, 'Pessoa') : null;
      const category = optionalCategory(categories, args.categoria);
      if (!category) {
        throw new Error('A categoria informada não corresponde a uma categoria cadastrada.');
      }
      if (kind !== 'refund' && !person) {
        throw new Error('Informe o nome exato da pessoa envolvida no lançamento.');
      }
      if (kind === 'refund' && !person && !args.contraparte?.trim()) {
        throw new Error('Informe uma pessoa cadastrada ou o nome da empresa/pessoa devedora do reembolso.');
      }

      const entryDate = today();
      const result = await cashLedgerService.create(userId, {
        kind,
        description: args.descricao.trim(),
        total: args.valor,
        categoryId: category ? String(category._id) : null,
        personId: person ? String(person._id) : null,
        counterparty: args.contraparte?.trim() || null,
        entryDate,
        paymentMethod,
        installmentCount,
        firstDueDate: kind === 'expense' ? null : entryDate,
        frequency: 'monthly',
        loanTerm: kind === 'loan' ? 'installments' : null,
        expectedReturnDate: kind === 'refund' ? entryDate : null,
        refundStatus: kind === 'refund' ? 'requested' : undefined,
      });

      if (args.pago === true && ['sale', 'loan'].includes(kind) && result.installments.length) {
        await cashLedgerService.receiveMany(
          userId,
          result.installments.map((installment) => installment.id),
          paymentMethod ?? 'pix',
          entryDate,
        );
      }

      return {
        sucesso: true,
        mensagem: `Lançamento "${result.entry.description}" registrado no Caixa Avulso.`,
        tipo: kind,
        valor: result.entry.total,
        parcelas: result.installments.length,
        status: args.pago === true ? 'recebido' : result.entry.entryStatus,
      };
    }

    case 'cadastrarDespesaVeiculo': {
      if (typeof args.identificadorVeiculo !== 'string' || !args.identificadorVeiculo.trim()) {
        throw new Error('Informe o modelo ou a placa do veículo.');
      }
      if (typeof args.descricao !== 'string' || !args.descricao.trim() || args.descricao.trim().length > 200) {
        throw new Error('A descrição deve ter entre 1 e 200 caracteres.');
      }
      if (!Number.isFinite(args.valor) || args.valor < 1 || args.valor > 10_000_000) {
        throw new Error('O valor deve ser de pelo menos R$ 1,00 e não pode exceder R$ 10.000.000.');
      }
      if (typeof args.categoria !== 'string' || !args.categoria.trim()) {
        throw new Error('Informe a categoria da despesa.');
      }
      if (typeof args.nomePessoa !== 'string' || !args.nomePessoa.trim()) {
        throw new Error('Informe o nome da pessoa pagadora.');
      }

      const [vehicles, people] = await Promise.all([
        Vehicle.find({ userId }).select('_id model plate kind').lean(),
        Person.find({ userId }).select('_id name').lean(),
      ]);
      const term = normalizeText(args.identificadorVeiculo);
      const matches = vehicles.filter((vehicle) => (
        normalizeText(vehicle.model).includes(term)
        || normalizeText(vehicle.plate).includes(term)
      ));
      if (matches.length !== 1) {
        throw new Error(matches.length
          ? `O identificador corresponde a mais de um veículo. Informe uma placa ou modelo mais específico.`
          : `Veículo "${args.identificadorVeiculo}" não encontrado.`);
      }
      const person = matchByName(people, args.nomePessoa, 'Pessoa');
      const normalizedCategory = normalizeText(args.categoria);
      const category = EXPENSE_CATEGORIES.find((item) => (
        normalizeText(item.key) === normalizedCategory || normalizeText(item.label) === normalizedCategory
      ));
      if (!category) {
        throw new Error(`Categoria de veículo inválida. Use uma destas: ${EXPENSE_CATEGORIES.map((item) => item.key).join(', ')}.`);
      }

      const result = await vehiclesService.createExpense(userId, {
        vehicleId: String(matches[0]._id),
        date: today(),
        category: category.key,
        description: args.descricao.trim(),
        amount: args.valor,
        payerId: String(person._id),
        shared: false,
        paymentMethod: 'cash',
        installmentCount: 1,
      });

      return {
        sucesso: true,
        mensagem: `Despesa "${result.description || result.categoryLabel}" registrada para o veículo ${result.vehicleModel}.`,
        veiculo: result.vehicleModel,
        categoria: result.categoryLabel,
        valor: result.amount,
        pagador: result.payer,
      };
    }

    case 'cadastrarNovoVeiculo': {
      if (typeof args.modelo !== 'string' || !args.modelo.trim() || args.modelo.trim().length > 80) {
        throw new Error('Informe o modelo do veículo (até 80 caracteres).');
      }
      if (typeof args.placa !== 'string' || !/^[A-Z0-9]{5,8}$/.test(args.placa.toUpperCase().replace(/[\s-]/g, ''))) {
        throw new Error('Informe uma placa válida.');
      }
      if (!Number.isInteger(args.ano) || args.ano < 1900 || args.ano > 2100) {
        throw new Error('Informe um ano válido entre 1900 e 2100.');
      }
      const kind = args.tipo ?? 'car';
      if (!['car', 'motorcycle', 'utility', 'other'].includes(kind)) {
        throw new Error('Tipo de veículo inválido.');
      }
      const purchaseValue = args.valorCompra ?? 0;
      if (!Number.isFinite(purchaseValue) || purchaseValue < 0 || purchaseValue > 100_000_000) {
        throw new Error('O valor de compra deve estar entre R$ 0,00 e R$ 100.000.000,00.');
      }
      const vehicle = await vehiclesService.createVehicle(userId, {
        kind,
        model: args.modelo.trim(),
        plate: args.placa,
        year: args.ano,
        purchaseValue,
        status: 'active',
      });
      return {
        sucesso: true,
        mensagem: `Veículo "${vehicle.model}" cadastrado com sucesso. Placa: ${vehicle.plate}.`,
        veiculoId: vehicle.id,
        modelo: vehicle.model,
        placa: vehicle.plate,
        ano: vehicle.year,
      };
    }

    case 'cadastrarNovaPessoa': {
      if (typeof args.nome !== 'string' || !args.nome.trim() || args.nome.trim().length > 60) {
        throw new Error('Informe o nome da pessoa (até 60 caracteres).');
      }
      if (args.telefone !== undefined
        && (typeof args.telefone !== 'string' || args.telefone.trim().length > 30)) {
        throw new Error('O telefone deve ter até 30 caracteres.');
      }
      const person = await Person.create({
        userId,
        name: args.nome.trim(),
        phone: args.telefone?.trim() || null,
      });
      return {
        sucesso: true,
        mensagem: `Pessoa "${person.name}" cadastrada com sucesso.`,
        pessoaId: String(person._id),
        nome: person.name,
      };
    }

    case 'cadastrarNovoCartao': {
      if (typeof args.nome !== 'string' || !args.nome.trim() || args.nome.trim().length > 60) {
        throw new Error('Informe o nome do cartão (até 60 caracteres).');
      }
      if (!Number.isFinite(args.limite) || args.limite < 0 || args.limite > 10_000_000) {
        throw new Error('O limite deve estar entre R$ 0,00 e R$ 10.000.000,00.');
      }
      if (!Number.isInteger(args.diaFechamento) || args.diaFechamento < 1 || args.diaFechamento > 31) {
        throw new Error('O dia de fechamento deve ser um número entre 1 e 31.');
      }
      if (!Number.isInteger(args.diaVencimento) || args.diaVencimento < 1 || args.diaVencimento > 31) {
        throw new Error('O dia de vencimento deve ser um número entre 1 e 31.');
      }
      const card = await Card.create({
        userId,
        name: args.nome.trim(),
        limit: args.limite,
        brand: 'Outro',
        closingDay: args.diaFechamento,
        dueDay: args.diaVencimento,
      });
      return {
        sucesso: true,
        mensagem: `Cartão "${card.name}" cadastrado com limite de R$ ${card.limit.toFixed(2)}.`,
        cartaoId: String(card._id),
        nome: card.name,
        limite: card.limit,
        diaFechamento: card.closingDay,
        diaVencimento: card.dueDay,
      };
    }

    default:
      throw new Error(`Ferramenta "${nomeFuncao}" não reconhecida.`);
  }
}
