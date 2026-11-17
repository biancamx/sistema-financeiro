import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePdfRecord } from '../src/modules/import/pdf.reader.js';
import { pdfPurchaseSignature } from '../src/modules/import/pdf.dedup.js';

const accounts = { people: [], cards: [], categories: [] };
const recurringRecord = {
  kind: 'recurring',
  description: 'Anuidade',
  cardName: 'Cartao de exemplo',
  monthlyAmount: 120,
  startMonth: 7,
  startYear: 2025,
  endMonth: null,
  endYear: null,
  participants: [
    { personName: 'Pessoa 01', allocatedTotal: 60 },
    { personName: 'Pessoa 05', allocatedTotal: 60 },
  ],
};

test('cobrança recorrente rateada aceita vários responsáveis quando as partes fecham o total mensal', () => {
  const errors = [];
  const record = normalizePdfRecord(recurringRecord, 0, accounts, errors, []);

  assert.equal(errors.length, 0);
  assert.equal(record.kind, 'recurring');
  assert.equal(record.participants.length, 2);
  assert.deepEqual(record.participants.map(({ allocatedTotal }) => allocatedTotal), [60, 60]);
});

test('cobrança recorrente rateada continua bloqueada se as partes não fecharem o total', () => {
  const errors = [];
  const record = normalizePdfRecord({
    ...recurringRecord,
    participants: [
      { personName: 'Pessoa 01', allocatedTotal: 60 },
      { personName: 'Pessoa 05', allocatedTotal: 50 },
    ],
  }, 0, accounts, errors, []);

  assert.equal(record, null);
  assert.ok(errors.some((error) => error.includes('rateio da compra "Anuidade" não soma o valor total')));
});

test('compra parcelada de virada de ano é aceita mesmo quando o intervalo restante do extrato é menor que o total de parcelas', () => {
  const errors = [];
  const record = normalizePdfRecord({
    kind: 'installment',
    description: 'Compra de eletrodoméstico',
    cardName: 'Cartao de exemplo',
    categoryName: 'Casa',
    totalAmount: 2800,
    installmentAmount: 400,
    totalInstallments: 7,
    startMonth: 12,
    startYear: 2025,
    endMonth: 2,
    endYear: 2026,
    participants: [
      { personName: 'Pessoa 01', allocatedTotal: 2800 },
    ],
  }, 0, accounts, errors, []);

  assert.equal(record.kind, 'installment');
  assert.equal(record.totalInstallments, 7);
  assert.equal(record.startMonth, 12);
  assert.equal(record.startYear, 2025);
  assert.equal(record.endMonth, 2);
  assert.equal(record.endYear, 2026);
  assert.ok(errors.some((error) => error.includes('Quantidade ou período de parcelas inconsistente')));
  assert.ok(record);
});

test('assinatura anti-duplicação ignora caixa, acentos e diferenças de representação do centavo', () => {
  const first = pdfPurchaseSignature({
    personId: 'pessoa-1',
    cardId: 'cartao-1',
    description: 'Café Central',
    amount: 10,
    year: 2027,
    month: 3,
  });
  const second = pdfPurchaseSignature({
    personId: 'pessoa-1',
    cardId: 'cartao-1',
    description: 'cafe central',
    amount: 10.001,
    year: 2027,
    month: 3,
  });

  assert.equal(first, second);
});
