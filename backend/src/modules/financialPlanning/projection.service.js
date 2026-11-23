import { PurchaseSimulation } from '../../models/PurchaseSimulation.js';
import { Person } from '../../models/Person.js';
import { Card } from '../../models/Card.js';
import { Category } from '../../models/Category.js';
import { createBudgetsService } from '../budgets/budgets.service.js';

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function assertOwned(person, userId) {
  if (!person || String(person.userId) !== String(userId)) return null;
  return person;
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

export function installmentPlan({ valorTotal, entrada, quantidadeParcelas, taxaJuros }) {
  const financed = Math.max(0, valorTotal - entrada);
  const months = Math.max(1, quantidadeParcelas);
  const monthlyRate = Math.max(0, taxaJuros) / 100 / 12;
  const financedWithInterest = monthlyRate === 0
    ? financed / months
    : financed * (monthlyRate * (1 + monthlyRate) ** months) / (((1 + monthlyRate) ** months) - 1);
  const principalPerMonth = months ? financed / months : 0;
  const interestPerMonth = monthlyRate === 0 ? 0 : financedWithInterest - principalPerMonth;
  return {
    entrada: round2(entrada),
    parcelaBase: round2(financedWithInterest),
    custoTotal: round2(entrada + financedWithInterest * months),
    jurosEstimados: round2(Math.max(0, financedWithInterest * months - financed)),
  };
}

export function classify(projection) {
  const negative = projection.filter((item) => item.comWithPurchase < 0);
  const margins = projection.map((item) => item.comWithPurchase);
  const minimum = margins.length ? Math.min(...margins) : 0;
  if (negative.length) {
    return {
      situacao: 'inviavel',
      codigo: 'inviavel',
      titulo: 'Compra inviável',
      motivo: 'A projeção identifica saldo negativo em pelo menos um mês.',
      mesesProblematicos: negative.map((item) => item.month),
      minimo: round2(minimum),
    };
  }
  const monthlyImpact = projection.map((item) => item.impact).filter((value) => value > 0);
  const maxImpact = monthlyImpact.length ? Math.max(...monthlyImpact) : 0;
  const threshold = projection.length ? projection[0].withoutPurchase * 0.15 : 0;
  if (minimum < threshold || minimum < maxImpact) {
    return {
      situacao: 'alto_risco', codigo: 'alto_risco', titulo: 'Compra de alto risco',
      motivo: 'A margem restante fica excessivamente baixa ou próxima do limite negativo.',
      mesesProblematicos: projection.filter((item) => item.comWithPurchase < threshold).map((item) => item.month),
      minimo: round2(minimum),
    };
  }
  if (minimum < threshold * 1.5) {
    return {
      situacao: 'atencao', codigo: 'atencao', titulo: 'Compra viável com atenção',
      motivo: 'A compra cabe no orçamento, mas reduz significativamente a margem financeira.',
      mesesProblematicos: projection.filter((item) => item.comWithPurchase < threshold * 1.5).map((item) => item.month),
      minimo: round2(minimum),
    };
  }
  return {
    situacao: 'viavel', codigo: 'viavel', titulo: 'Compra financeiramente viável',
    motivo: 'A compra não gera saldo negativo e mantém margem no horizonte analisado.',
    mesesProblematicos: [], minimo: round2(minimum),
  };
}

export async function getProjectionData(userId, pessoaId, options = {}) {
  const person = assertOwned(await Person.findOne({ _id: pessoaId, userId }).lean(), userId);
  if (!person) throw new Error('Pessoa não encontrada');

  const horizon = [12, 24, 36].includes(Number(options.horizon)) ? Number(options.horizon) : 12;
  const budgets = createBudgetsService();
  const baseDate = options.dataPrevista ? new Date(`${options.dataPrevista}T00:00:00`) : new Date();
  if (Number.isNaN(baseDate.getTime())) throw new Error('Data prevista inválida');

  const projection = [];
  for (let index = 0; index < horizon; index += 1) {
    const date = addMonths(baseDate, index);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const sheet = await budgets.getSheet(userId, pessoaId, year, month);
    const balance = round2(sheet.summary?.lines?.find((line) => line.key === 'balance')?.values?.[month - 1] ?? 0);
    projection.push({
      month: monthKey(year, month),
      year,
      monthNumber: month,
      withoutPurchase: balance,
      comWithPurchase: balance,
      impact: 0,
      withPurchase: balance,
    });
  }

  const plan = installmentPlan(options);
  let firstNegative = null;
  let committedMonths = 0;

  if (options.simulate !== false) {
    const dataDate = new Date(`${options.dataPrevista}T00:00:00`);
    const startIndex = 0;
    const financedMonths = Math.max(0, Number(options.quantidadeParcelas || 0));
    for (let index = startIndex; index < projection.length; index += 1) {
      let impact = 0;
      if (index === 0) impact += plan.entrada;
      if (index < financedMonths) impact += plan.parcelaBase;
      if (impact > 0) committedMonths += 1;
      const item = projection[index];
      item.impact = round2(impact);
      item.comWithPurchase = round2(item.withoutPurchase - impact);
      item.withPurchase = item.comWithPurchase;
      if (item.comWithPurchase < 0 && !firstNegative) firstNegative = item.month;
    }
  }

  const classification = classify(projection);
  const current = projection[0] ?? null;
  const endDate = financedEndDate(baseDate, Number(options.quantidadeParcelas || 0));

  return {
    pessoa: person,
    horizonteProjecao: horizon,
    saldoAtual: round2(current?.withoutPurchase ?? 0),
    saldoSemCompra: round2(current?.withoutPurchase ?? 0),
    saldoComCompra: round2(current?.comWithPurchase ?? 0),
    diferenca: round2((current?.comWithPurchase ?? 0) - (current?.withoutPurchase ?? 0)),
    impactoMensal: round2(plan.parcelaBase),
    entrada: plan.entrada,
    custoTotal: plan.custoTotal,
    jurosEstimados: plan.jurosEstimados,
    valorParcela: plan.parcelaBase,
    primeiroSaldoNegativo: firstNegative,
    quantidadeMesesComprometidos: committedMonths,
    dataEncerramentoParcelas: endDate,
    margemFinanceiraRestante: classification.minimo,
    mesesNegativos: classification.mesesProblematicos,
    classificacao: classification,
    projecao: projection,
  };
}

function financedEndDate(baseDate, count) {
  if (!count) return null;
  const start = baseDate.getDate();
  const end = addMonths(baseDate, count - 1);
  const safeDay = Math.min(start, new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate());
  end.setDate(safeDay);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

export async function savePurchaseSimulation(userId, body) {
  const pessoa = await Person.findOne({ _id: body.pessoaId, userId }).lean();
  if (!pessoa) throw new Error('Pessoa não encontrada');
  if (body.cartaoId) {
    const card = await Card.findOne({ _id: body.cartaoId, userId }).lean();
    if (!card) throw new Error('Cartão não encontrado');
  }
  if (body.categoriaId) {
    const category = await Category.findOne({ _id: body.categoriaId, userId }).lean();
    if (!category) throw new Error('Categoria não encontrada');
  }

  const result = await getProjectionData(userId, body.pessoaId, { ...body, simulate: true });
  return PurchaseSimulation.create({
    userId,
    pessoaId: body.pessoaId,
    nome: body.nome,
    categoria: body.categoria || '',
    categoriaId: body.categoriaId || null,
    valorTotal: body.valorTotal,
    entrada: body.entrada || 0,
    quantidadeParcelas: body.quantidadeParcelas,
    valorParcela: result.valorParcela,
    modalidadePagamento: body.modalidadePagamento,
    cartaoId: body.cartaoId || null,
    taxaJuros: body.taxaJuros || 0,
    dataPrevista: body.dataPrevista,
    horizonteProjecao: body.horizonteProjecao || 12,
    status: 'planejada',
    observacoes: body.observacoes || '',
    resultadoResumo: result,
  });
}
