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
  janeiro: 1, january: 1, jan: 1,
  fevereiro: 2, february: 2, fev: 2, feb: 2,
  marco: 3, march: 3, mar: 3,
  abril: 4, april: 4, abr: 4, apr: 4,
  maio: 5, mai: 5,
  junho: 6, june: 6, jun: 6,
  julho: 7, july: 7, jul: 7,
  agosto: 8, august: 8, ago: 8, aug: 8,
  setembro: 9, september: 9, set: 9, sept: 9,
  outubro: 10, october: 10, out: 10, oct: 10,
  novembro: 11, november: 11, nov: 11,
  dezembro: 12, december: 12, dez: 12, dec: 12,
};

function parseMoneyValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (value === null || value === undefined || !String(value).trim()) return null;
  let clean = String(value).replace(/[R$\s]/g, '');
  if (!/^[+-]?\d[\d.,]*$/.test(clean)) return null;
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.lastIndexOf(',') > clean.lastIndexOf('.')
      ? clean.replace(/\./g, '').replace(',', '.')
      : clean.replace(/,/g, '');
  } else if (clean.includes(',')) {
    clean = /^[-+]?\d{1,3}(,\d{3})+$/.test(clean)
      ? clean.replace(/,/g, '')
      : clean.replace(',', '.');
  } else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(clean)) {
    clean = clean.replace(/\./g, '');
  }
  const number = Number(clean);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

export function parseMoney(val) {
  return parseMoneyValue(val) ?? 0;
}

function headerKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

const TABLE_HEADER_ALIASES = {
  description: ['compra', 'nomedacompra', 'descricao', 'descricaodacompra', 'detalhe', 'detalhedacompra', 'estabelecimento', 'produto', 'nomedoproduto', 'item', 'lancamento'],
  person: ['responsavel', 'pessoa', 'titular', 'participante', 'nomedapessoa', 'cliente', 'beneficiario'],
  amount: ['valor', 'valorr', 'valortotal', 'total', 'totalcompra', 'preco', 'amount', 'totalamount', 'valordacompra'],
  category: ['categoria', 'categoriadacompra', 'category'],
  observation: ['observacao', 'observacoes', 'descricaoextra', 'notas', 'detalhes', 'observation', 'observations'],
  monthlyAmount: ['valordaparcela', 'parcelamensal', 'valorparcelado', 'installmentamount'],
  subscriptionAmount: ['valormensal', 'monthlyamount'],
  card: ['cartao', 'nomecartao', 'card', 'paymentmethod'],
  date: ['mesano', 'competencia', 'data', 'datacompra', 'datadacompra', 'date', 'monthyear'],
  month: ['mes', 'mesdacompra', 'month'],
  year: ['ano', 'anodacompra', 'year'],
  start: ['inicio', 'datainicio', 'datainicial', 'start', 'startdate'],
  end: ['fim', 'datafim', 'ultimaparcela', 'end', 'enddate'],
  installments: ['parcelas', 'nparcelas', 'qtdparcelas', 'qtddeparcelas', 'quantidadeparcelas', 'numeroparcelas', 'installments', 'installmentcount'],
};

function parseMonthYear(value, yearValue = null) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { month: value.getMonth() + 1, year: value.getFullYear() };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const year = Number(yearValue);
    if (Number.isInteger(value) && value >= 1 && value <= 12
      && Number.isInteger(year) && year >= 1900) {
      return { month: value, year };
    }
    const excelDate = XLSX.SSF.parse_date_code(value);
    if (excelDate?.y && excelDate?.m) return { month: excelDate.m, year: excelDate.y };
  }
  const text = normalizeText(value);
  const numericMonth = Number(text);
  const explicitYear = Number(yearValue);
  if (Number.isInteger(numericMonth) && numericMonth >= 1 && numericMonth <= 12
    && Number.isInteger(explicitYear) && explicitYear >= 1900) {
    return { month: numericMonth, year: explicitYear };
  }
  const localizedDate = text.match(/^\d{1,2}\/(\d{1,2})\/(20\d{2})$/);
  const isoDate = text.match(/^(20\d{2})-(\d{1,2})-\d{1,2}$/);
  if (localizedDate || isoDate) {
    const month = Number(localizedDate?.[1] ?? isoDate?.[2]);
    const year = Number(localizedDate?.[2] ?? isoDate?.[1]);
    if (month >= 1 && month <= 12) return { month, year };
  }
  const monthYear = text.match(/^([a-z]+)[./\s-]+(20\d{2})$/)
    || text.match(/^(20\d{2})[./\s-]+([a-z]+)$/);
  if (monthYear) {
    const month = MONTHS_MAP[monthYear[1]] || MONTHS_MAP[monthYear[2]];
    const year = Number(monthYear[1].startsWith('20') ? monthYear[1] : monthYear[2]);
    if (month) return { month, year };
  }
  const numericMonthYear = text.match(/^(?:(\d{1,2})[/-](20\d{2})|(20\d{2})[/-](\d{1,2}))$/);
  if (numericMonthYear) {
    const month = Number(numericMonthYear[1] || numericMonthYear[4]);
    const year = Number(numericMonthYear[2] || numericMonthYear[3]);
    if (month >= 1 && month <= 12) return { month, year };
  }
  const month = MONTHS_MAP[text];
  const year = Number(yearValue);
  return month && Number.isInteger(year) && year >= 1900
    ? { month, year }
    : null;
}

function findTableHeader(rows) {
  const aliases = Object.fromEntries(
    Object.entries(TABLE_HEADER_ALIASES).map(([field, names]) => [
      field,
      new Set(names.map(headerKey)),
    ]),
  );
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
    const columns = {};
    for (const [columnIndex, value] of rows[rowIndex].entries()) {
      const key = headerKey(value);
      if (!key) continue;
      for (const [field, names] of Object.entries(aliases)) {
        if (columns[field] === undefined && names.has(key)) columns[field] = columnIndex;
      }
    }
    if (columns.description !== undefined && columns.person !== undefined
      && (columns.amount !== undefined || columns.monthlyAmount !== undefined
        || columns.subscriptionAmount !== undefined
        || columns.start !== undefined || columns.end !== undefined
        || columns.installments !== undefined)) {
      return { rowIndex, columns };
    }
  }
  return null;
}

function readGenericPurchaseTables(workbook, report, excludedSheets) {
  const importedSheets = new Set();
  for (const sheetName of workbook.SheetNames) {
    if (excludedSheets.has(normalizeText(sheetName).replace(/\s+/g, ''))) continue;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, raw: true, defval: '',
    });
    const table = findTableHeader(rows);
    if (!table) continue;
    importedSheets.add(sheetName);
    const { columns, rowIndex } = table;
    const fallbackCard = 'Sem cartão informado';

    for (let rowNumber = rowIndex + 1; rowNumber < rows.length; rowNumber++) {
      const row = rows[rowNumber];
      const description = String(row[columns.description] ?? '').trim();
      const personName = String(row[columns.person] ?? '').trim();
      const category = columns.category === undefined
        ? ''
        : String(row[columns.category] ?? '').trim();
      const observation = columns.observation === undefined
        ? ''
        : String(row[columns.observation] ?? '').trim();
      if (!description && !personName) continue;
      const location = `${sheetName}!${rowNumber + 1}`;
      const ignore = (reason) => report.ignoredRows.push({ sheet: sheetName, row: rowNumber + 1, location, reason });

      if (!description || !personName) {
        ignore('Linha sem descrição ou responsável.');
        continue;
      }
      if (/[;,]/.test(personName)) {
        ignore('Há mais de um responsável na linha; a divisão do valor precisa ser conferida.');
        continue;
      }
      if (columns.amount === undefined && columns.monthlyAmount === undefined
        && columns.subscriptionAmount === undefined) {
        ignore('A tabela não informa o valor da compra ou da parcela.');
        continue;
      }

      const amountColumn = columns.subscriptionAmount ?? columns.monthlyAmount ?? columns.amount;
      const unitAmount = parseMoneyValue(row[amountColumn]);
      if (unitAmount === null) {
        ignore('Valor ausente ou ambíguo; nenhuma compra foi criada para esta linha.');
        continue;
      }

      const start = parseMonthYear(
        columns.start !== undefined ? row[columns.start]
          : columns.date !== undefined ? row[columns.date]
            : columns.month !== undefined ? row[columns.month] : null,
        columns.year !== undefined ? row[columns.year] : null,
      );
      const end = columns.end !== undefined ? parseMonthYear(row[columns.end]) : null;
      const hasMonthlyAmount = columns.monthlyAmount !== undefined;
      const subscriptionText = normalizeText(observation);
      const isSubscription = columns.subscriptionAmount !== undefined
        || normalizeText(category).includes('assinaturas')
        || subscriptionText.includes('cobranca mensal recorrente')
        || subscriptionText.includes('assinatura');
      const rawInstallments = columns.installments === undefined
        ? 1
        : Math.max(1, parseInt(row[columns.installments], 10) || 1);
      const periodCount = end && start
        ? Math.max(1, (end.year - start.year) * 12 + end.month - start.month + 1)
        : rawInstallments;
      const recurringImportRow = isSubscription
        && columns.observation !== undefined
        && (
          normalizeText(observation).includes('cobranca mensal recorrente')
          || normalizeText(observation).includes('assinatura')
        );
      const totalInstallments = recurringImportRow ? periodCount : (isSubscription ? 1 : periodCount);

      if (!start) {
        ignore('Mês e ano da compra/início não reconhecidos.');
        continue;
      }

      const subscriptionEnd = isSubscription
        ? (() => {
          const endIndex = start.year * 12 + start.month - 1 + Math.max(1, periodCount) - 1;
          return {
            month: (endIndex % 12) + 1,
            year: Math.floor(endIndex / 12),
          };
        })()
        : null;

      const totalAmount = isSubscription
        ? unitAmount
        : hasMonthlyAmount
          ? Math.round(unitAmount * totalInstallments * 100) / 100
          : unitAmount;
      const installmentAmount = isSubscription || hasMonthlyAmount
        ? unitAmount
        : totalInstallments > 1
          ? Math.round((unitAmount / totalInstallments) * 100) / 100
          : unitAmount;
      const cardName = columns.card === undefined
        ? fallbackCard
        : String(row[columns.card] ?? '').trim() || fallbackCard;
      const purchaseDate = start
        ? `${String(start.year).padStart(4, '0')}-${String(start.month).padStart(2, '0')}-01`
        : null;
      const sharedMatch = normalizeText(observation).includes('compra compartilhada');
      const sharedGroupKey = sharedMatch
        ? [
          purchaseDate,
          normalizeText(description),
          normalizeText(category),
          normalizeText(cardName),
        ].join('__')
        : null;
      const installments = [];
      for (let index = 0; index < totalInstallments; index++) {
        const absoluteMonth = start.year * 12 + start.month - 1 + index;
        installments.push({
          month: (absoluteMonth % 12) + 1,
          year: Math.floor(absoluteMonth / 12),
          amount: installmentAmount,
        });
      }

      const purchase = {
        description,
        category,
        personName,
        cardName,
        purchaseDate,
        totalAmount,
        totalInstallments,
        isSubscription,
        subscriptionEndAt: isSubscription && (subscriptionEnd || end)
          ? new Date(Date.UTC((subscriptionEnd || end).year, (subscriptionEnd || end).month, 0)).toISOString()
          : null,
        sharedGroupKey,
        observation,
        installments,
      };
      report.people.push(personName);
      report.cards.push(cardName);
      if (category) report.categories.push(category);
      report.purchasesGrouped.push(purchase);
      report.summaryCounts.purchasesCount++;
      report.summaryCounts.installmentsCount += installments.length;
    }
  }
  return importedSheets;
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

  const genericPurchaseSheets = readGenericPurchaseTables(
    workbook,
    report,
    new Set(['dados', 'bancodedados']),
  );

  // 4. ABAS MENSAIS POR PESSOA (Item 5 da especificação)
  const personSheets = sheetNames.filter((s) => {
    const norm = normalizeText(s).replace(/\s+/g, '');
    return !['bancodedados', 'dados', 'dashboard', 'dahbordcartoes', 'financeirogeral', 'resumo', 'ajustes'].includes(norm)
      && !genericPurchaseSheets.has(s);
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

  const uniqueNames = (names) => [...new Map(
    names.filter(Boolean).map((name) => [normalizeText(name), name]),
  ).values()];
  report.people = uniqueNames(report.people);
  report.cards = uniqueNames(report.cards);
  report.categories = uniqueNames(report.categories);
  report.summaryCounts.peopleCount = report.people.length;
  report.summaryCounts.cardsCount = report.cards.length;

  return report;
}