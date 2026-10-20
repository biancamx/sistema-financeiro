import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User } from '../../models/User.js';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

  // 3. Emite o JWT de sessão assinado
  const jwtSecret = process.env.JWT_SECRET || 'REDACTED_SECRET';
  const token = jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    },
    jwtSecret,
    { expiresIn: '30d' }
  );

  return {
    token,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      avatar: user.avatar,
    },
  };
}

// Gera o token JWT da sessão
export function generateToken(user) {
  const jwtSecret = process.env.JWT_SECRET || 'REDACTED_SECRET';
  return jwt.sign(
    {
      id: user._id ? user._id.toString() : user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
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
    const error = new Error('Já existe uma conta com este e-mail.');
    error.status = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    name: name.trim(),
    email: cleanEmail,
    passwordHash,
  });

  const token = generateToken(user);
  return {
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      avatar: user.avatar,
    },
    token,
  };
}

// 3. LOGIN TRADICIONAL COM E-MAIL E SENHA
export async function loginWithEmail(email, password) {
  const cleanEmail = email.toLowerCase().trim();

  const user = await User.findOne({ email: cleanEmail });
  if (!user || !user.passwordHash) {
    const error = new Error('E-mail ou senha incorretos.');
    error.status = 401;
    throw error;
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    const error = new Error('E-mail ou senha incorretos.');
    error.status = 401;
    throw error;
  }

  const token = generateToken(user);
  return {
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      avatar: user.avatar,
    },
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
  };
}