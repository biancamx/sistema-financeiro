import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import { analyzeSpreadsheet, parseMoney } from '../src/modules/import/spreadsheet.reader.js';
import { processSpreadsheetImport } from '../src/modules/import/import.service.js';

test('processSpreadsheetImport rejeita usuário ou arquivo ausentes antes de acessar o banco', async () => {
  await assert.rejects(
    () => processSpreadsheetImport('', null),
    /Identificação do usuário ausente|Arquivo da planilha ausente/
  );

  await assert.rejects(
    () => processSpreadsheetImport('user-1', Buffer.alloc(0)),
    /Arquivo da planilha ausente/
  );
});

test('analyzeSpreadsheet continua lendo planilhas válidas sem depender do banco', () => {
  const rows = [{
    Descrição: 'Compra teste',
    Pessoa: 'Pessoa teste',
    Cartão: 'Cartão teste',
    'Valor Total': 42.5,
    'Qtd. Parcelas': 1,
    Mês: 'Janeiro',
    Ano: 2026,
  }];

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Banco De Dados');
  const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const analyzed = analyzeSpreadsheet(fileBuffer);
  assert.ok(Array.isArray(analyzed.people));
  assert.ok(Array.isArray(analyzed.cards));
  assert.ok(Array.isArray(analyzed.purchasesGrouped));
  assert.ok(typeof analyzed.summaryCounts === 'object');
});

test('analyzeSpreadsheet preserva caracteres acentuados em arquivos XLS legados', () => {
  const workbook = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.aoa_to_sheet([
    ['ID', 'Cartão', 'Pessoa', 'Outro', 'Categoria'],
    [1, 'Cartão de demonstração', 'Pessoa 01', '', 'Alimentação'],
  ]);
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Dados');
  const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' });

  const analyzed = analyzeSpreadsheet(fileBuffer);

  assert.deepEqual(analyzed.cards, ['Cartão de demonstração']);
  assert.deepEqual(analyzed.people, ['Pessoa 01']);
  assert.deepEqual(analyzed.categories, ['Alimentação']);
});

test('parseMoney aceita valores brasileiros com separador de milhar', () => {
  assert.equal(parseMoney('R$ 1.234,56'), 1234.56);
});

test('analyzeSpreadsheet reconhece tabelas de compras e recorrências pelos cabeçalhos', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Mês', 'Ano', 'Descrição da compra', 'Pessoa', 'Valor (R$)', 'Cartão'],
    [1, 2026, 'Café', 'Ana', 'R$ 12,50', 'Visa'],
    [2, 2026, 'Táxi', 'Bia', 18, ''],
  ]), 'Movimentações');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Produto', 'Titular', 'Valor mensal', 'Data início', 'Fim'],
    ['Streaming', 'Ana', 'R$ 9,99', 'mar/2026', 'mai/2026'],
    ['Serviço variável', 'Ana', 'R$ 10,00 a R$ 12,00', 'mar/2026', 'mai/2026'],
  ]), 'Assinaturas');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Compra', 'Responsável', 'Parcelas', 'Início', 'Última parcela'],
    ['Compra sem valor', 'Bia', 3, 'jan/2026', 'mar/2026'],
  ]), 'Parceladas');
  const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const analyzed = analyzeSpreadsheet(fileBuffer);

  assert.equal(analyzed.summaryCounts.purchasesCount, 3);
  assert.equal(analyzed.summaryCounts.installmentsCount, 3);
  assert.deepEqual(analyzed.people, ['Ana', 'Bia']);
  assert.deepEqual(analyzed.cards, ['Visa', 'Sem cartão informado']);
  assert.deepEqual(
    analyzed.purchasesGrouped.map(({ description, totalAmount, totalInstallments }) => ({
      description, totalAmount, totalInstallments,
    })),
    [
      { description: 'Café', totalAmount: 12.5, totalInstallments: 1 },
      { description: 'Táxi', totalAmount: 18, totalInstallments: 1 },
      { description: 'Streaming', totalAmount: 9.99, totalInstallments: 1 },
    ],
  );
  assert.equal(analyzed.purchasesGrouped[2].isSubscription, true);
  assert.equal(analyzed.purchasesGrouped[2].subscriptionEndAt, '2026-05-31T00:00:00.000Z');
  assert.equal(analyzed.ignoredRows.length, 2);
  assert.ok(analyzed.ignoredRows.every((row) => row.reason));
  assert.equal(analyzed.summaryCounts.budgetLinesCount, 0);
});
