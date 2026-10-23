import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import { analyzeSpreadsheet } from '../src/modules/import/spreadsheet.reader.js';
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
