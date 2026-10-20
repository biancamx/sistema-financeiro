import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

function required(name, fallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProd) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return fallback;
}

const bool = (v, def) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

export const env = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 4000),
  frontendUrls: (process.env.FRONTEND_URL || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()),
  dbPath: process.env.DB_PATH || './data/financeiro.db',
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-nao-use-em-producao'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieName: 'fin_token',
  cookieSameSite: process.env.COOKIE_SAMESITE || 'lax',
  localLoginEnabled: bool(process.env.ENABLE_LOCAL_LOGIN, !isProd),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  get googleEnabled() {
    return Boolean(this.googleClientId);
  },
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 600),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 40),
  logLevel: process.env.LOG_LEVEL || 'info',
};
