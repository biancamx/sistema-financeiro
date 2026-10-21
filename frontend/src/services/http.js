// Camada de acesso à API (única que conhece fetch/URL/cookies).
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

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

export async function http(method, path, { body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  let res;
  try {
    res = await fetch(`${BASE}${path}${qs}`, {
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
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, json);
  }
  return json;
}

export async function postFormData(path, formData) {
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
