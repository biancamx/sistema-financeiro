import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { conflict, unauthorized } from '../../lib/errors.js';
import { User } from '../../models/User.js';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

function newAccountAccessFields(email) {
  return adminEmail && email.toLowerCase() === adminEmail
    ? { role: 'admin', status: 'active' }
    : {};
}

async function promoteConfiguredAdmin(user) {
  if (!adminEmail || user.email.toLowerCase() !== adminEmail) return;
  if (user.role !== 'admin' || user.status !== 'active') {
    user.role = 'admin';
    user.status = 'active';
    await user.save();
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

  const { sub: googleId, email, name, picture } = payload;
  const cleanEmail = email.toLowerCase().trim();

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
    console.log(`🎉 Novo usuário registrado via Google no MongoDB: ${cleanEmail}`);
  } else {
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
  const jwtSecret = process.env.JWT_SECRET || 'REDACTED_SECRET';
  const token = jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role || 'user',
      status: user.status || 'pending',
    },
    jwtSecret,
    { expiresIn: '30d' }
  );

  return {
    token,
    user: publicUser(user),
  };
}

// Gera o token JWT da sessão
export function generateToken(user) {
  const jwtSecret = process.env.JWT_SECRET || 'REDACTED_SECRET';
  return jwt.sign(
    {
      sub: user._id ? user._id.toString() : user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      status: user.status || 'pending',
      role: user.role || 'user',
    },
    jwtSecret,
    { expiresIn: '30d' }
  );
}

// 2. CADASTRO TRADICIONAL COM E-MAIL E SENHA
export async function registerWithEmail(name, email, password) {
  const cleanEmail = email.toLowerCase().trim();

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

  const token = generateToken(user);
  return {
    user: publicUser(user),
    token,
  };
}

// 3. LOGIN TRADICIONAL COM E-MAIL E SENHA
export async function loginWithEmail(email, password) {
  const cleanEmail = email.toLowerCase().trim();

  const user = await User.findOne({ email: cleanEmail });
  if (!user || !user.passwordHash) {
    throw unauthorized('E-mail ou senha incorretos.');
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    throw unauthorized('E-mail ou senha incorretos.');
  }

  await promoteConfiguredAdmin(user);
  const token = generateToken(user);
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