import { cache } from '../lib/cache.js';

/** Escritas bem-sucedidas invalidam o cache do usuário; leituras da API nunca são cacheadas por proxies. */
export function cacheControl(req, res, next) {
  res.set('Cache-Control', 'private, no-cache');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode < 400 && req.user) cache.invalidateUser(req.user.id);
    });
  }
  next();
}
