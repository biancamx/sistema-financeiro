// Camada "Caching": cache em memória com TTL, isolado por usuário.
// Qualquer escrita (POST/PUT/PATCH/DELETE) do usuário invalida os dados dele.
// Para várias instâncias, troque por Redis mantendo esta mesma interface.
const store = new Map();

export const cache = {
  get(key) {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      store.delete(key);
      return undefined;
    }
    return hit.value;
  },
  set(key, value, ttlMs) {
    if (store.size > 2000) store.delete(store.keys().next().value);
    store.set(key, { value, expires: Date.now() + ttlMs });
  },
  invalidateUser(userId) {
    const prefix = `u${userId}:`;
    for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
  },
  clear() {
    store.clear();
  },
};

export function cached(userId, key, ttlMs, compute) {
  const k = `u${userId}:${key}`;
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  const value = compute();
  cache.set(k, value, ttlMs);
  return value;
}
