import 'dotenv/config';
import { createApp } from './app.js';
import { connectMongo } from './db/mongo.js';
import { logger } from './lib/logger.js';
import { env } from './config/env.js';

async function bootstrap() {
  try {
    logger.info('Conectando ao MongoDB Atlas...');
    await connectMongo();
    logger.info('MongoDB Atlas conectado com sucesso!');

    const app = createApp();
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