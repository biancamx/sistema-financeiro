import mongoose from 'mongoose';
import { ensurePersonShareTokens } from '../models/Person.js';

let isConnected = false;

export async function connectMongo() {
  if (isConnected) return mongoose.connection;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('A variável de ambiente MONGODB_URI não foi definida no arquivo .env!');
  }

  try {
    const conn = await mongoose.connect(uri, {
      autoIndex: true, // Cria índices automaticamente em desenvolvimento
      serverSelectionTimeoutMS: 5000, // Timeout de 5s para não travar
    });

    isConnected = conn.connection.readyState === 1;
    await ensurePersonShareTokens();
    console.log('✅ Conexão com o MongoDB Atlas estabelecida com sucesso!');
    return conn.connection;
  } catch (err) {
    console.error('❌ Falha ao conectar com o MongoDB Atlas:', err.message);
    throw err;
  }
}

export function getMongoConnection() {
  return mongoose.connection;
}