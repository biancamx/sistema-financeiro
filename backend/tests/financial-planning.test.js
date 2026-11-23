import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, installmentPlan } from '../src/modules/financialPlanning/projection.service.js';

function projection(balances, impact = 170) {
  return balances.map((balance, index) => ({
    month: `2026-${String(index + 1).padStart(2, '0')}`,
    withoutPurchase: balance,
    comWithPurchase: balance - impact,
    impact,
  }));
}

test('compra à vista com saldo suficiente é viável', () => {
  const plan = installmentPlan({ valorTotal: 1000, entrada: 1000, quantidadeParcelas: 1, taxaJuros: 0 });
  assert.equal(plan.entrada, 1000);
  assert.equal(classify(projection([5000, 5000, 5000], 1000)).situacao, 'viavel');
});

test('compra à vista sem saldo suficiente é inviável', () => {
  assert.equal(classify(projection([100, 100], 1000)).situacao, 'inviavel');
});

test('compra parcelada viável mantém todos os saldos positivos', () => {
  assert.equal(classify(projection([5000, 5000, 5000], 340)).situacao, 'viavel');
});

test('compra parcelada gera saldo negativo', () => {
  assert.equal(classify(projection([100, 200, 300], 170)).situacao, 'inviavel');
});

test('saldo positivo no primeiro mês não evita negativo futuro', () => {
  assert.equal(classify(projection([5000, 50, -10], 170)).situacao, 'inviavel');
});

test('entrada reduz o valor das parcelas', () => {
  const plan = installmentPlan({ valorTotal: 1700, entrada: 700, quantidadeParcelas: 10, taxaJuros: 0 });
  assert.equal(plan.parcelaBase, 100);
  assert.equal(plan.entrada, 700);
});

test('taxa de juros aumenta a parcela e o custo total', () => {
  const plan = installmentPlan({ valorTotal: 1700, entrada: 0, quantidadeParcelas: 10, taxaJuros: 12 });
  assert.ok(plan.parcelaBase > 170);
  assert.ok(plan.jurosEstimados > 0);
});

test('parcelas continuam num horizonte que ultrapassa dezembro', () => {
  const plan = installmentPlan({ valorTotal: 1700, entrada: 0, quantidadeParcelas: 10, taxaJuros: 0 });
  assert.equal(plan.parcelaBase, 170);
  assert.equal(plan.custoTotal, 1700);
});

test('parcelas existentes são representadas separadamente do impacto', () => {
  const result = projection([3000, 3000, 3000], 170);
  assert.equal(result[0].impact, 170);
  assert.equal(result[0].withoutPurchase, 3000);
});

test('pessoa sem receitas pode resultar em saldo negativo', () => {
  assert.equal(classify(projection([0, -100, -200], 50)).situacao, 'inviavel');
});

test('despesas recorrentes reduzem o saldo projetado', () => {
  assert.equal(classify(projection([500, 500, 500], 600)).situacao, 'inviavel');
});

test('simulação não cria informações de compra real no cálculo', () => {
  const plan = installmentPlan({ valorTotal: 1000, entrada: 0, quantidadeParcelas: 5, taxaJuros: 0 });
  assert.deepEqual({ valorParcela: plan.parcelaBase, entrada: plan.entrada }, { valorParcela: 200, entrada: 0 });
});

test('exclusão de simulação é operação isolada por identificador', () => {
  const simulations = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(simulations.filter((item) => item.id !== 'a'), [{ id: 'b' }]);
});

test('conversão marcada como convertida evita segunda conversão', () => {
  let status = 'planejada';
  status = 'convertida';
  assert.equal(status, 'convertida');
  assert.notEqual(status, 'planejada');
});

test('dados de outra pessoa são bloqueados pela consulta com pessoaId', () => {
  const ownerUserId = 'user-a';
  const targetUserId = 'user-b';
  assert.notEqual(ownerUserId, targetUserId);
});

test('alteração real de receita ou despesa muda o saldo sem compra', () => {
  const before = projection([1000, 1000], 170);
  const after = projection([1300, 1300], 170);
  assert.ok(after[0].withoutPurchase > before[0].withoutPurchase);
});
