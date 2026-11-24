import * as XLSX from 'xlsx';
import * as cpexcel from 'xlsx/dist/cpexcel.full.mjs';

XLSX.set_cptable(cpexcel);

// 1. Normalização universal obrigatória (Item 1.1)
export function normalizeText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export const MONTHS_MAP = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

export function parseMoney(val) {
  if (typeof val === 'number') return Math.round(val * 100) / 100;
  if (!val) return 0;
  let clean = String(val).replace(/[R$\s]/g, '');
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.lastIndexOf(',') > clean.lastIndexOf('.')
      ? clean.replace(/\./g, '').replace(',', '.')
      : clean.replace(/,/g, '');
  } else if (clean.includes(',')) {
    clean = clean.replace(',', '.');
  }
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : Math.round(num * 100) / 100;
}

export function analyzeSpreadsheet(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellFormula: true, cellDates: true });
  const sheetNames = workbook.SheetNames;

  const report = {
    cards: [],
    people: [],
    categories: [],
    limits: {},
    purchasesGrouped: [],
    monthlyBudgets: [],
    birthdays: [],
    divergences: [],
    ignoredRows: [],
    unrecognizedLabels: [],
    openQuestions: [],
    summaryCounts: {
      peopleCount: 0,
      cardsCount: 0,
      purchasesCount: 0,
      installmentsCount: 0,
      budgetLinesCount: 0,
      birthdaysCount: 0,
    },
  };

  // 1. ABA "Dados" (Item 3 da especificação)
  const dadosSheet = sheetNames.find((s) => normalizeText(s) === 'dados');
  if (dadosSheet) {
    const sheet = workbook.Sheets[dadosSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const cardsSet = new Set();
    const peopleSet = new Set();
    const catSet = new Set();

    for (let r = 1; r < rows.length; r++) {
      const card = String(rows[r][1] || '').trim();
      const person = String(rows[r][2] || '').trim();
      const cat = String(rows[r][4] || '').trim();

      if (card) cardsSet.add(card);
      if (person) peopleSet.add(person);
      if (cat) {
        if (normalizeText(cat) === 'descricao') {
          report.unrecognizedLabels.push({
            sheet: 'Dados',
            location: `E${r + 1}`,
            value: cat,
            reason: 'Rótulo "descrição" identificado na coluna de Categorias.',
          });
        } else {
          catSet.add(cat);
        }
      }
    }
    report.cards = Array.from(cardsSet);
    report.people = Array.from(peopleSet);
    report.categories = Array.from(catSet);
  }

  // 2. ABA "dahbord cartoes" (Limites - Item 4 da especificação)
  const limitSheet = sheetNames.find((s) => normalizeText(s).includes('cartoes'));
  if (limitSheet) {
    const sheet = workbook.Sheets[limitSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    for (let r = 2; r < Math.min(20, rows.length); r++) {
      const cName = String(rows[r][0] || '').trim();
      const limitVal = parseMoney(rows[r][1]);
      if (cName && normalizeText(cName) !== 'total') {
        report.limits[normalizeText(cName)] = limitVal;
      }
    }
  }

  // 3. ABA "Banco De Dados" (Compras e Parcelas - Item 2 da especificação)
  const bdSheet = sheetNames.find((s) => normalizeText(s).replace(/\s+/g, '') === 'bancodedados');
  if (bdSheet) {
    const sheet = workbook.Sheets[bdSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    const purchasesMap = new Map();

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const colA = String(row[0] || '').trim();
      const colB = String(row[1] || '').trim();
      const personRaw = String(row[2] || '').trim();
      const totalAmountRaw = row[3];
      const countRaw = row[4];
      const monthRaw = String(row[6] || '').trim();
      const yearRaw = parseInt(row[7], 10);
      const cardRaw = String(row[8] || '').trim();

      // Pula as ~80 linhas vazias do final da planilha
      if (!personRaw && !totalAmountRaw && !yearRaw) continue;

      if (!personRaw || !totalAmountRaw || !yearRaw || isNaN(yearRaw)) {
        report.ignoredRows.push({
          sheet: 'Banco De Dados',
          row: r + 1,
          reason: 'Linha sem pessoa, sem valor ou sem ano numérico válido',
        });
        continue;
      }

      const totalAmount = parseMoney(totalAmountRaw);
      const totalInstallments = Math.max(1, parseInt(countRaw, 10) || 1);
      const monthNum = MONTHS_MAP[normalizeText(monthRaw)];

      if (!monthNum) {
        report.ignoredRows.push({
          sheet: 'Banco De Dados',
          row: r + 1,
          reason: `Mês "${monthRaw}" não reconhecido`,
        });
        continue;
      }

      // Detecção de Data vs Texto na coluna A (Item 2)
      let description = '';
      let category = '';
      let purchaseDate = null;

      const isDate = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(colA) || /^\d{4}-\d{2}-\d{2}/.test(colA);
      if (isDate) {
        purchaseDate = colA;
        description = colB || 'Compra';
      } else {
        description = colA || 'Compra';
        category = colB;
      }

      // Chave de agrupamento exata (Item 2)
      const purchaseKey = [
        normalizeText(description),
        normalizeText(personRaw),
        totalAmount.toFixed(2),
        totalInstallments,
        normalizeText(cardRaw),
        purchaseDate ? normalizeText(purchaseDate) : 'semdata',
      ].join('__');

      const purchaseGroups = purchasesMap.get(purchaseKey) || [];
      let purchase = purchaseGroups.find(
        (group) => !group.installments.some((installment) => installment.month === monthNum && installment.year === yearRaw),
      );
      if (!purchase) {
        purchase = {
          description,
          category,
          personName: personRaw,
          cardName: cardRaw,
          purchaseDate,
          totalAmount,
          totalInstallments,
          installments: [],
        };
        purchaseGroups.push(purchase);
        purchasesMap.set(purchaseKey, purchaseGroups);
      }

      const rawInstallmentVal = rawRows[r]?.[5];
      const installmentVal = typeof rawInstallmentVal === 'number'
        ? rawInstallmentVal
        : parseMoney(row[5]);
      purchase.installments.push({
        month: monthNum,
        year: yearRaw,
        amount: installmentVal,
      });

      report.summaryCounts.installmentsCount++;
    }

    report.purchasesGrouped = Array.from(purchasesMap.values()).flat();
    report.summaryCounts.purchasesCount = report.purchasesGrouped.length;
  }

  // 4. ABAS MENSAIS POR PESSOA (Item 5 da especificação)
  const personSheets = sheetNames.filter((s) => {
    const norm = normalizeText(s).replace(/\s+/g, '');
    return !['bancodedados', 'dados', 'dashboard', 'dahbordcartoes', 'financeirogeral'].includes(norm);
  });
  const personYears = new Map();

  for (const pSheet of personSheets) {
    const sheet = workbook.Sheets[pSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    if (rows.length < 5) continue;

    // Detecta ano de B2 (Item 5)
    let detectedYear = 2026;
    const b2Str = String(rows[1]?.[1] || rows[0]?.[1] || rows[1]?.[0] || '');
    const yMatch = b2Str.match(/\b(20\d{2})\b/);
    if (yMatch) detectedYear = parseInt(yMatch[1], 10);

    const detectedPerson = pSheet.replace(/financeiro/i, '').trim();
    personYears.set(normalizeText(detectedPerson), { name: detectedPerson, year: detectedYear });

    let currentSection = null;
    let sectionCounts = { receitas: 0 };
    let skipSection = false;

    const sheetTotals = {};
    const calculatedTotals = {};

    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      const label = String(row[0] || '').trim();
      const norm = normalizeText(label);

      if (!norm || norm === '-') continue;
      if (norm === 'resumo geral') break; // Para em Resumo Geral (Item 5.10)

      // Detecção de seções por ordem
      if (norm === 'receitas') {
        sectionCounts.receitas++;
        currentSection = sectionCounts.receitas === 1 ? 'receitas' : 'beneficios';
        skipSection = false;
        continue;
      }
      if (norm === 'investimentos') { currentSection = 'investimentos'; skipSection = false; continue; }
      if (norm.startsWith('descontos')) { currentSection = 'descontos'; skipSection = false; continue; }
      if (norm === 'alimentacao x combustivel') { currentSection = 'alimentacao'; skipSection = false; continue; }
      if (['despesas veiculos', 'despesas de veiculos', 'veiculos'].includes(norm)) {
        currentSection = 'veiculos';
        skipSection = false;
        continue;
      }
      if (norm === 'despesas variaveis') { currentSection = 'despesas_variaveis'; skipSection = false; continue; }
      if (norm === 'cartao de credito') { skipSection = true; continue; } // Ignora cartão (Item 5.7)
      if (norm === 'variadas' && currentSection === 'despesas_variaveis') {
        currentSection = 'variadas';
        skipSection = false;
        continue;
      }
      if (norm === 'moradia') { currentSection = 'moradia'; skipSection = false; continue; }

      if (norm === 'total') {
        if (currentSection && !skipSection) {
          const tVal = parseMoney(row[13]); // Coluna N
          sheetTotals[`${pSheet}__${currentSection}`] = tVal;
        }
        skipSection = false;
        continue;
      }

      if (skipSection || !currentSection) continue;

      const monthlyValues = [];
      let rowSum = 0;
      for (let m = 1; m <= 12; m++) {
        const rawValue = row[m];
        const val = rawValue === '' || (typeof rawValue === 'string' && rawValue.trim() === '-')
          ? null
          : parseMoney(rawValue);
        monthlyValues.push({ month: m, amount: val });
        rowSum += val ?? 0;
      }

      report.monthlyBudgets.push({
        person: detectedPerson,
        year: detectedYear,
        section: currentSection,
        label,
        months: monthlyValues,
      });

      report.summaryCounts.budgetLinesCount++;
      const secKey = `${pSheet}__${currentSection}`;
      calculatedTotals[secKey] = (calculatedTotals[secKey] || 0) + rowSum;
    }

    // Item 1.5: Conferência matemática
    for (const k of Object.keys(sheetTotals)) {
      const exp = sheetTotals[k];
      const got = Math.round((calculatedTotals[k] || 0) * 100) / 100;
      if (Math.abs(exp - got) > 0.05) {
        report.divergences.push({
          section: k,
          sheetTotal: exp,
          calculatedTotal: got,
          diff: Math.round((got - exp) * 100) / 100,
        });
      }
    }
  }

  // 4b. ABA "Financeiro Geral": importa apenas linhas que não sejam cartões
  const generalFinanceSheet = sheetNames.find(
    (s) => normalizeText(s).replace(/\s+/g, '') === 'financeirogeral',
  );
  if (generalFinanceSheet) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[generalFinanceSheet], {
      header: 1, raw: false, defval: '',
    });
    const defaultYear = personYears.values().next().value?.year ?? 2026;
    const peopleByName = new Map(
      report.people.map((name) => [normalizeText(name), { name, year: defaultYear }]),
    );
    for (const person of personYears.values()) {
      peopleByName.set(normalizeText(person.name), person);
    }
    const cardNames = new Set([
      ...report.cards,
      ...report.purchasesGrouped.map((purchase) => purchase.cardName),
    ].map(normalizeText));
    let currentPerson = null;
    let monthColumns = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const label = String(row[0] ?? '').trim();
      const normalizedLabel = normalizeText(label);
      const person = peopleByName.get(normalizedLabel);
      const nextRowIsMonthHeader = normalizeText(rows[index + 1]?.[0]) === 'mes';
      if (person || (label && nextRowIsMonthHeader)) {
        currentPerson = person ?? { name: label, year: defaultYear };
        if (!person) {
          peopleByName.set(normalizedLabel, currentPerson);
          if (!report.people.some((name) => normalizeText(name) === normalizedLabel)) {
            report.people.push(label);
          }
        }
        monthColumns = [];
        continue;
      }
      if (!currentPerson || !normalizedLabel) continue;
      if (normalizedLabel === 'mes') {
        monthColumns = row.slice(1, 13)
          .map((value, index) => ({ month: MONTHS_MAP[normalizeText(value)], column: index + 1 }))
          .filter(({ month }) => month);
        continue;
      }
      if (!monthColumns.length || normalizedLabel === 'status'
        || normalizedLabel.startsWith('total') || cardNames.has(normalizedLabel)) {
        continue;
      }

      const hasValues = monthColumns.some(({ column }) => {
        const value = row[column];
        return value !== '' && value !== null
          && !(typeof value === 'string' && value.trim() === '-');
      });
      if (!hasValues) continue;

      report.monthlyBudgets.push({
        person: currentPerson.name,
        year: currentPerson.year,
        section: 'despesas_variaveis',
        label,
        months: monthColumns.map(({ month, column }) => {
          const value = row[column];
          return {
            month,
            amount: value === '' || (typeof value === 'string' && value.trim() === '-')
              ? null
              : parseMoney(value),
          };
        }),
      });
      report.summaryCounts.budgetLinesCount++;
    }
  }

  // 5. ABA "Dashboard" (Aniversários - Item 7)
  const dashSheet = sheetNames.find((s) => normalizeText(s) === 'dashboard');
  if (dashSheet) {
    const sheet = workbook.Sheets[dashSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    for (const c of [0, 2, 4]) {
      let curMonth = null;
      for (let r = 0; r < rows.length; r++) {
        const cell = normalizeText(rows[r][c]);
        if (MONTHS_MAP[cell]) {
          curMonth = MONTHS_MAP[cell];
          continue;
        }
        if (curMonth && cell !== 'dia' && cell !== 'nome') {
          const day = parseInt(rows[r][c], 10);
          const name = String(rows[r][c + 1] || '').trim();
          if (day && name) {
            report.birthdays.push({ day, month: curMonth, name });
            report.summaryCounts.birthdaysCount++;
          }
        }
      }
    }
  }

  // 6. Perguntas Obrigatórias (Item 9)
  report.openQuestions.push(
    {
      id: 'carro_divisao',
      question: 'Despesas do mesmo veículo aparecem em abas de pessoas diferentes. O valor deve ser rateado ou cada pessoa paga a sua parte?',
      options: ['Despesas individuais de cada um', 'Despesa única compartilhada'],
      default: 'Despesas individuais de cada um',
    },
    {
      id: 'pessoa_sem_aba_mensal',
      question: 'Pessoa 08 aparece em Pessoas e no Banco de Dados (7 parcelas), mas sem aba mensal. Importar apenas os cartões dele?',
      options: ['Sim, importar cartões do Pessoa 08', 'Não importar'],
      default: 'Sim, importar cartões do Pessoa 08',
    },
    {
      id: 'categoria_carro',
      question: 'Deseja que compras cuja descrição contenha a palavra "carro" sejam associadas à categoria "Veículo"?',
      options: ['Sim, categorizar automaticamente', 'Não, manter original'],
      default: 'Não, manter original',
    }
  );

  return report;
}