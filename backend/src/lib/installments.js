export const outstandingInstallmentCentsSql = `CASE WHEN i.paid = 1 THEN 0
  ELSE MAX(CAST(ROUND(i.amount * 100) AS INTEGER) - CAST(ROUND(COALESCE(i.paid_amount, 0) * 100) AS INTEGER), 0)
END`;
