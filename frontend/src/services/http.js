// Camada de acesso à API (única que conhece fetch/URL/cookies).
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const GET_CACHE_TTL_MS = 15_000;
const getCache = new Map();
const pendingGets = new Map();
let cacheVersion = 0;

export function clearHttpCache() {
  cacheVersion += 1;
  getCache.clear();
  pendingGets.clear();
}

export class ApiError extends Error {
  constructor(status, body) {
    const apiError = body?.error;
    const message = typeof apiError === 'string' ? apiError : apiError?.message;
    const validationDetails = apiError?.code === 'VALIDATION_ERROR' && Array.isArray(apiError.details)
      ? apiError.details
        .map((detail) => [detail.field, detail.message].filter(Boolean).join(': '))
        .filter(Boolean)
      : [];
    super(validationDetails.length ? `${message}: ${validationDetails.join('; ')}` : message || 'Erro de comunicação com o servidor');
    this.status = status;
    this.code = apiError?.code;
    this.details = apiError?.details;
    this.requestId = apiError?.requestId;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);
let onAccountPending = () => {};
export const setAccountPendingHandler = (fn) => (onAccountPending = fn);

export async function http(method, path, { body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  const url = `${BASE}${path}${qs}`;
  const cacheable = method === 'GET';

  if (!cacheable) clearHttpCache();
  if (cacheable) {
    const cached = getCache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    if (cached) getCache.delete(url);
    const pending = pendingGets.get(url);
    if (pending) return pending;
  }

  const requestVersion = cacheVersion;
  const request = (async () => {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'include',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, { error: { code: 'NETWORK', message: 'Não foi possível falar com a API. O backend está rodando em http://localhost:4000?' } });
    }
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) {
        clearHttpCache();
        if (!path.startsWith('/auth/')) onUnauthorized();
      }
      if (json?.error?.code === 'ACCOUNT_PENDING') {
        clearHttpCache();
        onAccountPending();
      }
      throw new ApiError(res.status, json);
    }
    if (cacheable && requestVersion === cacheVersion) {
      if (getCache.size >= 100) getCache.delete(getCache.keys().next().value);
      getCache.set(url, { data: json, expiresAt: Date.now() + GET_CACHE_TTL_MS });
    }
    return json;
  })();

  if (cacheable) pendingGets.set(url, request);
  try {
    return await request;
  } finally {
    if (cacheable && pendingGets.get(url) === request) pendingGets.delete(url);
    if (!cacheable) clearHttpCache();
  }
}

export async function postFormData(path, formData) {
  clearHttpCache();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'Não foi possível falar com a API. O backend está rodando em http://localhost:4000?' } });
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    if (json?.error?.code === 'ACCOUNT_PENDING') onAccountPending();
    throw new ApiError(res.status, json);
  }
  return json;
}

export const get = (p, query) => http('GET', p, { query });
export const post = (p, body) => http('POST', p, { body: body ?? {} });
export const put = (p, body) => http('PUT', p, { body });
export const patch = (p, body) => http('PATCH', p, { body });
export const del = (p) => http('DELETE', p);
export const apiUrl = (p) => `${BASE}${p}`;
