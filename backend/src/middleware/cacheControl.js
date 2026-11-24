import { cache } from '../lib/cache.js';

/** Responses financeiras são privadas e nunca devem ser armazenadas por navegadores ou proxies. */
export function cacheControl(req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode < 400 && req.user) cache.invalidateUser(req.user.id);
    });
  }
  next();
}
