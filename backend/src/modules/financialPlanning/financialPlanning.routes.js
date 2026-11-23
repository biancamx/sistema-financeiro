import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { PurchaseSimulation } from '../../models/PurchaseSimulation.js';
import { Person } from '../../models/Person.js';
import { getProjectionData, savePurchaseSimulation } from './projection.service.js';
import { createPurchasesService } from '../purchases/purchases.service.js';
import { createCashLedgerService } from '../cashLedger/cashLedger.service.js';

const id = z.string().regex(/^[\da-f]{24}$/i);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.coerce.number().nonnegative().max(10_000_000);
const modalidade = z.enum(['dinheiro', 'pix', 'debito', 'cartao_credito', 'parcelamento_entrada', 'outras']);

const projectionBody = z.object({
  pessoaId: id,
  nome: z.string().trim().min(1).max(120).default('Compra simulada'),
  categoria: z.string().trim().max(80).optional().default(''),
  categoriaId: id.nullable().optional(),
  valorTotal: z.coerce.number().positive().max(10_000_000),
  entrada: money.optional().default(0),
  quantidadeParcelas: z.coerce.number().int().min(1).max(120).optional().default(1),
  modalidadePagamento: modalidade,
  cartaoId: id.nullable().optional(),
  taxaJuros: z.coerce.number().min(0).max(100).optional().default(0),
  dataPrevista: date,
  horizonteProjecao: z.coerce.number().refine((value) => [12, 24, 36].includes(value)).optional().default(12),
  observacoes: z.string().max(1000).optional().default(''),
  salvar: z.boolean().optional().default(false),
});

export function financialPlanningRoutes() {
  const router = Router();
  const purchaseService = createPurchasesService();
  const cashService = createCashLedgerService();

  router.get('/people', asyncHandler(async (req, res) => {
    const people = await Person.find({ userId: req.user._id }).sort({ name: 1 }).select('_id name').lean();
    res.json({ data: people.map((person) => ({ id: String(person._id), name: person.name })) });
  }));

  router.post('/projection', validate({ body: projectionBody }), asyncHandler(async (req, res) => {
    if (req.body.entrada > req.body.valorTotal) throw badRequest('A entrada não pode superar o valor total');
    if (['cartao_credito', 'parcelamento_entrada'].includes(req.body.modalidadePagamento) && req.body.cartaoId == null) {
      throw badRequest('Selecione um cartão para esta modalidade');
    }
    const result = await getProjectionData(req.user._id, req.body.pessoaId, {
      ...req.body,
      horizon: req.body.horizonteProjecao,
      simulate: true,
    });

    let saved = null;
    if (req.body.salvar) saved = await savePurchaseSimulation(req.user._id, req.body);
    res.json({ data: { ...result, simulationId: saved ? String(saved._id) : null } });
  }));

  router.get('/simulations', validate({ query: z.object({ pessoaId: id.optional(), status: z.enum(['planejada', 'aprovada', 'descartada', 'convertida']).optional() }) }), asyncHandler(async (req, res) => {
    const filter = { userId: req.user._id };
    if (req.query.pessoaId) filter.pessoaId = req.query.pessoaId;
    if (req.query.status) filter.status = req.query.status;
    const simulations = await PurchaseSimulation.find(filter).populate('pessoaId', 'name').sort({ createdAt: -1 }).lean();
    res.json({ data: simulations.map((item) => ({
      id: String(item._id),
      pessoaId: String(item.pessoaId?._id || item.pessoaId),
      pessoa: item.pessoaId?.name || '',
      nome: item.nome,
      categoria: item.categoria,
      valorTotal: item.valorTotal,
      entrada: item.entrada,
      quantidadeParcelas: item.quantidadeParcelas,
      valorParcela: item.valorParcela,
      modalidadePagamento: item.modalidadePagamento,
      cartaoId: item.cartaoId ? String(item.cartaoId) : null,
      taxaJuros: item.taxaJuros,
      dataPrevista: item.dataPrevista,
      horizonteProjecao: item.horizonteProjecao,
      status: item.status,
      resultadoResumo: item.resultadoResumo,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })) });
  }));

  router.patch('/simulations/:id/status', validate({ params: z.object({ id }), body: z.object({ status: z.enum(['planejada', 'aprovada', 'descartada', 'convertida']) }) }), asyncHandler(async (req, res) => {
    const simulation = await PurchaseSimulation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { status: req.body.status } },
      { new: true, runValidators: true },
    );
    if (!simulation) throw notFound('Simulação não encontrada');
    res.json({ success: true, data: { id: String(simulation._id), status: simulation.status } });
  }));

  router.delete('/simulations/:id', validate({ params: z.object({ id }) }), asyncHandler(async (req, res) => {
    const deleted = await PurchaseSimulation.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!deleted) throw notFound('Simulação não encontrada');
    res.status(204).end();
  }));

  router.post('/simulations/:id/convert', validate({ params: z.object({ id }) }), asyncHandler(async (req, res) => {
    const simulation = await PurchaseSimulation.findOne({ _id: req.params.id, userId: req.user._id });
    if (!simulation) throw notFound('Simulação não encontrada');
    if (simulation.status === 'convertida') throw conflict('Esta simulação já foi convertida em compra real');

    let created;
    if (simulation.modalidadePagamento === 'cartao_credito' || simulation.modalidadePagamento === 'parcelamento_entrada') {
      if (!simulation.cartaoId) throw badRequest('Esta simulação não possui cartão vinculado');
      const firstDate = new Date(`${simulation.dataPrevista}T00:00:00`);
      created = await purchaseService.create(req.user._id, {
        description: simulation.nome,
        observation: simulation.observacoes || '',
        categoryId: simulation.categoriaId ? String(simulation.categoriaId) : null,
        personId: String(simulation.pessoaId),
        cardId: String(simulation.cartaoId),
        purchaseDate: simulation.dataPrevista,
        total: simulation.valorTotal,
        count: simulation.quantidadeParcelas,
        startMonth: firstDate.getMonth() + 1,
        startYear: firstDate.getFullYear(),
        isSubscription: false,
      });
    } else {
      const count = Math.max(1, simulation.quantidadeParcelas);
      const paymentMethod = simulation.modalidadePagamento === 'pix' ? 'pix'
        : simulation.modalidadePagamento === 'debito' ? 'debit'
        : 'cash';
      created = await cashService.create(req.user._id, {
        kind: 'expense',
        description: simulation.nome,
        total: simulation.valorTotal,
        categoryId: simulation.categoriaId ? String(simulation.categoriaId) : null,
        personId: String(simulation.pessoaId),
        counterparty: null,
        entryDate: simulation.dataPrevista,
        paymentMethod,
        downPayment: simulation.entrada || 0,
        installmentCount: count,
        firstDueDate: simulation.dataPrevista,
        frequency: 'monthly',
        loanTerm: null,
        interestRate: simulation.taxaJuros || 0,
        notes: simulation.observacoes || '',
      });
    }

    simulation.status = 'convertida';
    await simulation.save();
    res.json({ success: true, data: created });
  }));

  return router;
}
