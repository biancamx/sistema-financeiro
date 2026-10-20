export const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// Mesma ideia da coluna "Número correspondente ao mês" da planilha: ano*12 + mês
export const monthIndex = (year, month) => year * 12 + month;
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
