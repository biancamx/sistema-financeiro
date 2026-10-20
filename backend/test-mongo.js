import 'dotenv/config';
import { connectMongo } from './src/db/mongo.js';

async function test() {
  console.log('Testando conexão com o MongoDB Atlas...');
  try {
    await connectMongo();
    console.log('🎉 Parabéns! O MongoDB Atlas está 100% pronto para receber seu sistema!');
    process.exit(0);
  } catch (err) {
    console.error('Erro no teste:', err.message);
    process.exit(1);
  }
}

test();