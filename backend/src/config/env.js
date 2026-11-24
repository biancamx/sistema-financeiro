import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

function required(name, fallback, mandatory = isProd) {
  const value = process.env[name];
  if (value) return value;
  if (mandatory) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return fallback;
}

function validateProductionSecret(name, value) {
  if (!isProd) return;
  const distinctBytes = new Set(Buffer.from(value, 'utf8')).size;
  if (Buffer.byteLength(value, 'utf8') < 32 || distinctBytes < 12
    || /substitua|change.?me|replace.?me|your.?secret|example/i.test(value)) {
    throw new Error(`${name} deve ser um segredo aleatório com pelo menos 32 bytes em produção.`);
  }
}

const jwtSecret = required('JWT_SECRET', '', nodeEnv !== 'test');
validateProductionSecret('JWT_SECRET', jwtSecret);

const aiKeySecret = required('AI_KEY_SECRET', '0'.repeat(64), nodeEnv !== 'test');
if (!/^[\da-f]{64}$/i.test(aiKeySecret)) {
  throw new Error('AI_KEY_SECRET deve conter exatamente 64 caracteres hexadecimais.');
}
validateProductionSecret('AI_KEY_SECRET', aiKeySecret);
if (isProd && aiKeySecret.toLowerCase() === jwtSecret.toLowerCase()) {
  throw new Error('AI_KEY_SECRET deve ser diferente de JWT_SECRET.');
}

const jobsToken = required('JOBS_TOKEN', '', isProd);
validateProductionSecret('JOBS_TOKEN', jobsToken);
if (isProd && jobsToken === jwtSecret) {
  throw new Error('JOBS_TOKEN deve ser diferente de JWT_SECRET.');
}
if (isProd && jobsToken.toLowerCase() === aiKeySecret.toLowerCase()) {
  throw new Error('JOBS_TOKEN deve ser diferente de AI_KEY_SECRET.');
}

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
if (Boolean(vapidPublicKey) !== Boolean(vapidPrivateKey)) {
  throw new Error('VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY devem ser configuradas juntas.');
}

const bool = (v, def) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

function normalizeVapidSubject(value) {
  const subject = String(value || '').trim();
  if (!subject) return 'mailto:admin@example.com';
  if (/^mailto:/i.test(subject) || /^https?:\/\//i.test(subject)) return subject;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) return `mailto:${subject}`;
  return 'mailto:admin@example.com';
}

export const env = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 4000),
  frontendUrls: (process.env.FRONTEND_URL || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()),
  jwtSecret,
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
  vapidPublicKey,
  vapidPrivateKey,
  vapidSubject: normalizeVapidSubject(process.env.VAPID_SUBJECT),
  jobsToken,
  logLevel: process.env.LOG_LEVEL || 'info',
};
