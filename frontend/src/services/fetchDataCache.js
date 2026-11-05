const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;
const cache = new Map();

export function getFetchData(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

export function setFetchData(key, data) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function clearFetchData({ preserveLookups = false } = {}) {
  if (!preserveLookups) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (!key.startsWith('lookup:')) cache.delete(key);
  }
}

export function refreshFetchData(key, eventName) {
  cache.delete(key);
  window.dispatchEvent(new Event(eventName));
}
