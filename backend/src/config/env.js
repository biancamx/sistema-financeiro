import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

function required(name, fallback, mandatory = isProd) {
  const value = process.env[name];
  if (value) return value;
  if (mandatory) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return fallback;
}

const aiKeySecret = required('AI_KEY_SECRET', '0'.repeat(64), nodeEnv !== 'test');
if (!/^[\da-f]{64}$/i.test(aiKeySecret)) {
  throw new Error('AI_KEY_SECRET deve conter exatamente 64 caracteres hexadecimais.');
}

const bool = (v, def) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

export const env = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 4000),
  frontendUrls: (process.env.FRONTEND_URL || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()),
  jwtSecret: required('JWT_SECRET', '', nodeEnv !== 'test'),
  aiKeySecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  allowedDomains: (process.env.ALLOWED_DOMAINS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
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
