import 'dotenv/config';
import { createApp } from './app.js';
import { connectMongo } from './db/mongo.js';
import { logger } from './lib/logger.js';
import { env } from './config/env.js';
import { openDb } from './db/index.js';

async function bootstrap() {
  try {
    // 1. Conecta ao MongoDB Atlas
    logger.info('Conectando ao MongoDB Atlas...');
    await connectMongo();
    logger.info('MongoDB Atlas conectado com sucesso!');

    // 2. Abre banco de dados SQLite local
    const db = openDb(env.dbPath);
    logger.info('Banco SQLite local conectado com sucesso!');

    // 3. Inicia o servidor HTTP Express
    const app = createApp(db);
    const port = process.env.PORT || env.port || 4000;

    app.listen(port, '0.0.0.0', () => {
      logger.info(`Servidor rodando na porta ${port} [ambiente: ${env.NODE_ENV || 'development'}]`);
    });
  } catch (err) {
    logger.error('Falha crítica ao iniciar o servidor:', err);
    process.exit(1);
  }
}

bootstrap();