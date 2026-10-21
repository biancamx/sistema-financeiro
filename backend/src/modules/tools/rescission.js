import { round2 } from '../../lib/months.js';

/** Equivalente ao DATEDIF(inicio, fim, "M") do Excel: meses completos */
export function fullMonths(start, end) {
  let m = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() < start.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

/** Mesmas fórmulas do bloco de rescisão da aba Dashboard. */
export function calcRescission({ salary, admission, dismissal, reason, notice, fgtsBalance }) {
  const adm = new Date(`${admission}T00:00:00Z`);
  const dis = new Date(`${dismissal}T00:00:00Z`);
  const months = fullMonths(adm, dis);
  const years = Math.floor(months / 12);
  const day = dis.getUTCDate();
  const month = dis.getUTCMonth() + 1;
  const noJustCause = reason === 'Sem justa causa';

  const salaryBalance = (salary / 30) * day;
  const thirteenth = (salary / 12) * (day >= 15 ? month : month - 1);
  const vacation = (salary / 12) * (months - years * 12) * (4 / 3);
  const fgtsFine = noJustCause ? fgtsBalance * 0.4 : 0;
  const noticePay = noJustCause && notice === 'Indenizado' ? salary + (salary / 30) * Math.min(60, years * 3) : 0;

  const items = [
    { key: 'salaryBalance', label: 'Saldo de salário', value: round2(salaryBalance) },
    { key: 'thirteenth', label: '13º proporcional', value: round2(thirteenth) },
    { key: 'vacation', label: 'Férias + 1/3', value: round2(vacation) },
    { key: 'fgtsFine', label: 'Multa do FGTS (40%)', value: round2(fgtsFine) },
    { key: 'notice', label: 'Aviso prévio', value: round2(noticePay) },
  ];
  const total = round2(items.reduce((sum, item) => sum + item.value, 0));
  const availableFgtsBalance = round2(fgtsBalance);
  return {
    monthsWorked: months,
    yearsWorked: years,
    items,
    total,
    fgtsBalance: availableFgtsBalance,
    totalToReceive: round2(total + availableFgtsBalance),
  };
}
