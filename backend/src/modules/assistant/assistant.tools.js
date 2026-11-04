import mongoose from 'mongoose';
import { Card } from '../../models/Card.js';
import { Category } from '../../models/Category.js';
import { Person } from '../../models/Person.js';
import { Vehicle } from '../../models/Vehicle.js';
import { createCashLedgerService } from '../cashLedger/cashLedger.service.js';
import { createDashboardService } from '../dashboard/dashboard.service.js';
import { createPurchasesService } from '../purchases/purchases.service.js';
import { createVehiclesService } from '../vehicles/vehicles.service.js';
import { EXPENSE_CATEGORIES } from '../vehicles/vehicles.categories.js';

export const toolsDeclaration = [
  {
    name: 'consultarResumoFinanceiro',
    description: 'Consulta o resumo financeiro de um mês e ano, incluindo faturas de cartão, valores em aberto e resumo do caixa.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mes: { type: 'NUMBER', description: 'Número do mês (de 1 a 12)' },
        ano: { type: 'NUMBER', description: 'Ano com 4 dígitos (ex: 2026)' },
      },
      required: ['mes', 'ano'],
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
    description: 'Registra uma compra no cartão do usuário atual. A pessoa responsável e o cartão devem corresponder a cadastros existentes.',
    parameters: {
      type: 'OBJECT',
      properties: {
        descricao: { type: 'STRING', description: 'Descrição da compra (ex: Supermercado, Farmácia)' },
        valorTotal: { type: 'NUMBER', description: 'Valor total da compra em reais' },
        totalParcelas: { type: 'NUMBER', description: 'Quantidade de parcelas (de 1 a 120)' },
        nomeCartao: { type: 'STRING', description: 'Nome do cartão cadastrado' },
        nomePessoa: { type: 'STRING', description: 'Nome da pessoa responsável pela compra' },
        categoria: { type: 'STRING', description: 'Nome de uma categoria cadastrada, se aplicável' },
        dataCompra: { type: 'STRING', description: 'Data da compra no formato AAAA-MM-DD; se omitida, usa a data atual' },
      },
      required: ['descricao', 'valorTotal', 'totalParcelas', 'nomeCartao', 'nomePessoa'],
    },
  },
  {
    name: 'cadastrarLancamentoAvulso',
    description: 'Registra um lançamento no Caixa Avulso. Os tipos aceitos são expense (despesa), income (venda/valor a receber), loan (empréstimo) e reimbursement (reembolso).',
    parameters: {
      type: 'OBJECT',
      properties: {
        tipo: { type: 'STRING', enum: ['expense', 'income', 'loan', 'reimbursement'] },
        descricao: { type: 'STRING', description: 'Descrição do lançamento' },
        valor: { type: 'NUMBER', description: 'Valor em reais' },
        formaPagamento: { type: 'STRING', enum: ['pix', 'dinheiro', 'debito', 'transferencia'] },
        nomePessoa: { type: 'STRING', description: 'Nome exato da pessoa cadastrada, quando aplicável' },
        contraparte: { type: 'STRING', description: 'Pessoa ou empresa devedora, para reembolso sem pessoa cadastrada' },
        categoria: { type: 'STRING', description: 'Nome exato de uma categoria cadastrada, quando aplicável' },
        parcelas: { type: 'NUMBER', description: 'Quantidade de parcelas para venda ou empréstimo (de 1 a 240)' },
        pago: { type: 'BOOLEAN', description: 'Se a venda ou empréstimo já foi recebido integralmente' },
      },
      required: ['tipo', 'descricao', 'valor'],
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
      const mes = Number(args.mes);
      const ano = Number(args.ano);
      if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new Error('O mês deve ser um número entre 1 e 12.');
      if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new Error('O ano deve estar entre 2000 e 2100.');
      return dashboardService.summary(userId, { month: mes, year: ano });
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
      const paymentMethod = args.formaPagamento
        ? paymentMethodByName[normalizeText(args.formaPagamento)]
        : kind === 'expense' ? 'pix' : null;
      if (args.formaPagamento && !paymentMethod) {
        throw new Error('Forma de pagamento inválida. Use pix, dinheiro, debito ou transferencia.');
      }
      if (kind === 'expense' && !paymentMethod) {
        throw new Error('Informe a forma de pagamento da despesa.');
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
        args.categoria ? Category.find({ userId }).select('_id name').lean() : [],
      ]);
      const person = args.nomePessoa ? matchByName(people, args.nomePessoa, 'Pessoa') : null;
      const category = optionalCategory(categories, args.categoria);
      if (['sale', 'loan'].includes(kind) && !person) {
        throw new Error('Informe o nome exato da pessoa envolvida para venda ou empréstimo.');
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

    default:
      throw new Error(`Ferramenta "${nomeFuncao}" não reconhecida.`);
  }
}
