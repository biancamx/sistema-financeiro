import { get, post, put, patch, del, apiUrl, postFormData } from './http.js';

// Um objeto por "módulo" da API (espelha as pastas do backend).
export const authApi = {
  config: () => get('/auth/config'),
  me: () => get('/auth/me'),
  local: () => post('/auth/local'),
  login: (b) => post('/auth/login', b),
  register: (b) => post('/auth/register', b),
  google: (credential) => post('/auth/google', { credential }),
  logout: () => post('/auth/logout'),
};
export const adminApi = {
  users: () => get('/admin/users').then((r) => r.data),
  updateUserStatus: (userId, status) => patch(`/admin/users/${userId}`, { status }).then((r) => r.data),
};

export const dashboardApi = {
  summary: (q) => get('/dashboard/summary', q).then((r) => r.data),
  overview: (q) => get('/dashboard/person-overview', q).then((r) => r.data),
  setStatus: (b) => put('/dashboard/status', b),
};
export const assistantApi = {
  chat: (body) => post('/assistant/chat', body),
};

export const purchasesApi = {
  installments: (q) => get('/purchases/installments', q),
  subscriptions: (q) => get('/purchases/subscriptions', q),
  setSubscriptionStatus: (id, status) => patch(`/purchases/${id}/subscription-status`, { status }),
  list: (q) => get('/purchases', q),
  get: (id) => get(`/purchases/${id}`).then((r) => r.data),
  create: (b) => post('/purchases', b),
  update: (id, b) => put(`/purchases/${id}`, b),
  remove: (id) => del(`/purchases/${id}`),
  // compra dividida entre várias pessoas (um "grupo")
  getShared: (group) => get(`/purchases/shared/${group}`).then((r) => r.data),
  createShared: (b) => post('/purchases/shared', b),
  updateShared: (group, b) => put(`/purchases/shared/${group}`, b),
  removeShared: (group) => del(`/purchases/shared/${group}`),
  setPaid: (id, paid) => patch(`/purchases/installments/${id}`, { paid }),
  updateObservation: (id, observation) => patch(`/purchases/${id}/observation`, { observation }),
  setManyPaid: (ids, paid) => post(`/purchases/installments/${paid ? 'pay' : 'unpay'}-selected`, { ids }),
  exportUrl: () => apiUrl('/purchases/export.csv'),
};

export const cashLedgerApi = {
  list: (q) => get('/cash-ledger/entries', q),
  summary: (q) => get('/cash-ledger/summary', q).then((r) => r.data),
  dashboard: (q) => get('/cash-ledger/dashboard', q).then((r) => r.data),
  personSummary: (personId) => get(`/cash-ledger/people/${personId}`).then((r) => r.data),
  get: (id) => get(`/cash-ledger/entries/${id}`).then((r) => r.data),
  create: (body) => post('/cash-ledger/entries', body).then((r) => r.data),
  update: (id, body) => put(`/cash-ledger/entries/${id}`, body).then((r) => r.data),
  remove: (id, confirm = false) => del(`/cash-ledger/entries/${id}${confirm ? '?confirm=true' : ''}`),
  receive: (installmentId, body) => post(`/cash-ledger/installments/${installmentId}/receipts`, body).then((r) => r.data),
  receiveMany: (ids, body) => post('/cash-ledger/installments/receive-selected', { ids, ...body }).then((r) => r.data),
  undoReceipt: (receiptId) => del(`/cash-ledger/receipts/${receiptId}`),
  setRefundStatus: (id, status) => patch(`/cash-ledger/entries/${id}/refund-status`, { status }).then((r) => r.data),
  exportUrl: () => apiUrl('/cash-ledger/export.csv'),
};

export const vehiclesApi = {
  categories: () => get('/vehicles/categories').then((r) => r.data),
  list: () => get('/vehicles').then((r) => r.data),
  create: (b) => post('/vehicles', b).then((r) => r.data),
  update: (id, b) => put(`/vehicles/${id}`, b).then((r) => r.data),
  remove: (id, force) => del(`/vehicles/${id}${force ? '?force=true' : ''}`),
  summary: (q) => get('/vehicles/summary', q).then((r) => r.data),
  expenses: (q) => get('/vehicles/expenses', q),
  expense: (id) => get(`/vehicles/expenses/${id}`).then((r) => r.data),
  createExpense: (b) => post('/vehicles/expenses', b).then((r) => r.data),
  updateExpense: (id, b) => put(`/vehicles/expenses/${id}`, b).then((r) => r.data),
  removeExpense: (id) => del(`/vehicles/expenses/${id}`),
  exportUrl: (q = {}) => apiUrl('/vehicles/expenses/export.csv') + (Object.keys(q).length ? '?' + new URLSearchParams(q) : ''),
};

export const budgetApi = {
  get: (q) => get('/budgets', q).then((r) => r.data),
  years: (q) => get('/budgets/years', q).then((r) => r.data),
  addRow: (sheetId, b) => post(`/budgets/${sheetId}/rows`, b).then((r) => r.data),
  updateRow: (rowId, b) => patch(`/budgets/rows/${rowId}`, b),
  removeRow: (rowId) => del(`/budgets/rows/${rowId}`),
  setCell: (rowId, month, value) => put(`/budgets/rows/${rowId}/cells/${month}`, { value }),
  fill: (rowId, fromMonth, value) => post(`/budgets/rows/${rowId}/fill`, { fromMonth, value }),
};

const crud = (base) => ({
  list: (q) => get(base, q).then((r) => r.data),
  create: (b) => post(base, b).then((r) => r.data),
  update: (id, b) => put(`${base}/${id}`, b).then((r) => r.data),
  remove: (id) => del(`${base}/${id}`),
});
export const peopleApi = crud('/people');
export const portalApi = {
  get: (token) => get(`/portal/${encodeURIComponent(token)}`).then((r) => r.data),
};
export const remindersApi = {
  getSettings: () => get('/reminders/settings').then((r) => r.data),
  saveSettings: (settings) => put('/reminders/settings', settings).then((r) => r.data),
  getAlerts: () => get('/reminders/alerts'),
  getPersonBilling: (personId, month, year) => get(`/reminders/billing/${personId}`, { month, year }),
  getMonthlySummary: (month, year) => get('/reminders/monthly-summary', { month, year }),
  settlePersonMonth: (personId, month, year) => post('/reminders/settle-person-month', { personId, month, year }),
};
export const cardsApi = {
  ...crud('/cards'),
  payInvoice: (id, b) => post(`/cards/${id}/payments`, b).then((r) => r.data),
};
export const categoriesApi = crud('/categories');
export const birthdaysApi = crud('/birthdays');

export const importApi = {
  previewSpreadsheet: (formData) => postFormData('/import/preview', formData),
  executeSpreadsheet: (analyzedData) => post('/import/execute', { analyzedData }),
};

export const toolsApi = { rescission: (b) => post('/tools/rescission', b).then((r) => r.data) };
export const systemApi = {
  clientError: (b) => post('/client-errors', b).catch(() => {}),
  getPortalContact: () => get('/system/portal-contact').then((r) => r.data),
  setPortalContact: (personId) => put('/system/portal-contact', { personId }).then((r) => r.data),
  resetPurchases: () => post('/system/reset-purchases'),
  resetAll: () => post('/system/reset-all'),
};
