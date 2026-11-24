import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError, conflict, unauthorized } from '../../lib/errors.js';
import { AuthSession } from '../../models/AuthSession.js';
import { User } from '../../models/User.js';
import { recordAuditEvent } from '../../lib/auditEvent.js';
import { raiseSecurityAlerts } from '../../lib/securityAlerts.js';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const adminEmail = env.adminEmail;
const sessionJwtOptions = {
  algorithm: 'HS256',
  issuer: 'caderno-contas',
  audience: 'caderno-contas-web',
};

function ensureEmailAllowed(email) {
  const normalizedEmail = email.toLowerCase().trim();
  if (!env.allowedDomains.length
    || normalizedEmail === adminEmail
    || env.allowedDomains.includes(normalizedEmail)) return;

  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1);
  const allowed = env.allowedDomains.some((entry) => (
    entry.replace(/^@/, '') === domain
  ));
  if (!allowed) {
    throw new AppError(403, 'EMAIL_NOT_ALLOWED', 'Este domínio ou e-mail não está autorizado a acessar o sistema.');
  }
}

function newAccountAccessFields(email) {
  return adminEmail && email.toLowerCase() === adminEmail
    ? { role: 'admin', status: 'active' }
    : {};
}

async function promoteConfiguredAdmin(user) {
  if (!adminEmail || user.email.toLowerCase() !== adminEmail || !user.googleId) return;
  if (user.role !== 'admin' || user.status !== 'active') {
    const previousRole = user.role;
    const previousStatus = user.status;
    user.role = 'admin';
    user.status = 'active';
    await user.save();
    await recordAuditEvent({
      eventType: 'admin.role_changed',
      targetUserId: user._id,
      targetId: user._id.toString(),
      previousRole,
      newRole: user.role,
      previousStatus,
      newStatus: user.status,
    });
    await raiseSecurityAlerts({
      alertType: 'admin_account_change',
      userIds: [user._id],
      dedupeId: `configured-admin:${user._id}:${Date.now()}`,
    });
  }
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    avatar: user.avatar || null,
    status: user.status || 'pending',
    role: user.role || 'user',
  };
}

export async function loginWithGoogle(credential) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID não configurado no backend');
  }

  // 1. Valida o token recebido diretamente com os servidores do Google
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error('Token do Google inválido ou sem e-mail');
  }
  ensureGoogleEmailVerified(payload);

  const { sub: googleId, email, name, picture } = payload;
  const cleanEmail = email.toLowerCase().trim();
  ensureEmailAllowed(cleanEmail);

  // 2. Busca ou Cria o usuário no MongoDB Atlas
  let user = await User.findOne({ email: cleanEmail });

  if (!user) {
    // Cria novo usuário com a foto oficial do Google
    user = await User.create({
      name: name || cleanEmail.split('@')[0],
      email: cleanEmail,
      googleId,
      avatar: picture || null,
      ...newAccountAccessFields(cleanEmail),
    });
  } else {
    ensureGoogleAccountLink(user.googleId, googleId);
    // Se o usuário já existe, atualiza os dados do Google e a foto se necessário
    let updated = false;
    if (!user.googleId) {
      user.googleId = googleId;
      updated = true;
    }
    if (picture && user.avatar !== picture) {
      user.avatar = picture;
      updated = true;
    }
    if (updated) await user.save();
  }
  await promoteConfiguredAdmin(user);

  // 3. Emite o JWT de sessão assinado
  const token = await generateToken(user);

  return {
    token,
    user: publicUser(user),
  };
}

// Gera o token JWT da sessão
export async function generateToken(user) {
  const userId = user._id ? user._id.toString() : user.id;
  const tokenId = randomBytes(32).toString('base64url');
  const token = jwt.sign(
    {
      sub: userId,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      status: user.status || 'pending',
      role: user.role || 'user',
    },
    env.jwtSecret,
    { ...sessionJwtOptions, expiresIn: env.jwtExpiresIn, jwtid: tokenId },
  );
  const { exp } = jwt.decode(token);
  await AuthSession.create({
    userId,
    tokenId,
    expiresAt: new Date(exp * 1000),
  });
  return token;
}

export function verifySessionToken(token) {
  const payload = jwt.verify(token, env.jwtSecret, {
    algorithms: ['HS256'],
    issuer: sessionJwtOptions.issuer,
    audience: sessionJwtOptions.audience,
  });
  if (!payload || typeof payload !== 'object'
    || typeof payload.sub !== 'string'
    || !Number.isInteger(payload.exp)
    || !Number.isInteger(payload.iat)
    || typeof payload.jti !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/.test(payload.jti)) {
    throw new jwt.JsonWebTokenError('Invalid session claims');
  }
  return payload;
}

export function ensureGoogleEmailVerified(payload) {
  if (payload?.email_verified !== true) {
    throw unauthorized('O Google não confirmou o e-mail desta conta.');
  }
}

export function ensureGoogleAccountLink(existingGoogleId, incomingGoogleId) {
  if (existingGoogleId && existingGoogleId !== incomingGoogleId) {
    throw unauthorized('Esta conta está vinculada a outra identidade Google.');
  }
}

// 2. CADASTRO TRADICIONAL COM E-MAIL E SENHA
export async function registerWithEmail(name, email, password) {
  const cleanEmail = email.toLowerCase().trim();
  ensureEmailAllowed(cleanEmail);
  if (adminEmail && cleanEmail === adminEmail) {
    throw new AppError(403, 'ADMIN_EMAIL_GOOGLE_REQUIRED', 'Esta conta deve ser validada pelo provedor de identidade autorizado.');
  }

  const existing = await User.findOne({ email: cleanEmail });
  if (existing) {
    throw conflict('Já existe uma conta com este e-mail.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let user;
  try {
    user = await User.create({
      name: name.trim(),
      email: cleanEmail,
      passwordHash,
      provider: 'password',
      ...newAccountAccessFields(cleanEmail),
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email) {
      throw conflict('Já existe uma conta com este e-mail.');
    }
    throw error;
  }

  const token = await generateToken(user);
  return {
    user: publicUser(user),
    token,
  };
}

// 3. LOGIN TRADICIONAL COM E-MAIL E SENHA
export async function loginWithEmail(email, password) {
  const cleanEmail = email.toLowerCase().trim();
  ensureEmailAllowed(cleanEmail);

  const user = await User.findOne({ email: cleanEmail });
  if (!user || !user.passwordHash) {
    throw unauthorized('E-mail ou senha incorretos.');
  }
  if (adminEmail && cleanEmail === adminEmail && !user.googleId) {
    throw unauthorized('E-mail ou senha incorretos.');
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    throw unauthorized('E-mail ou senha incorretos.');
  }

  await promoteConfiguredAdmin(user);
  const token = await generateToken(user);
  return {
    user: publicUser(user),
    token,
  };
}

// 4. RETORNA DADOS DO USUÁRIO LOGADO
export async function getCurrentUser(userId) {
  const user = await User.findById(userId).select('-passwordHash');
  if (!user) return null;
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    status: user.status || 'pending',
    role: user.role || 'user',
  };
}

export async function getOrCreateDemoUser() {
  const email = 'demo@local.dev';
  const user = await User.findOneAndUpdate(
    { email },
    {
      $setOnInsert: {
        name: 'Usuário Demo',
        email,
        passwordHash: 'local',
        provider: 'local',
        status: 'active',
        role: 'user',
      },
    },
    { returnDocument: 'after', upsert: true, runValidators: true }
  );
  return {
    _id: user._id,
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    status: user.status || 'active',
    role: user.role || 'user',
  };
}