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

export const dashboardApi = {
  summary: (q) => get('/dashboard/summary', q).then((r) => r.data),
  overview: (q) => get('/dashboard/person-overview', q).then((r) => r.data),
  setStatus: (b) => put('/dashboard/status', b),
};

export const purchasesApi = {
  installments: (q) => get('/purchases/installments', q),
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
  resetPurchases: () => post('/system/reset-purchases'),
  resetAll: () => post('/system/reset-all'),
};
