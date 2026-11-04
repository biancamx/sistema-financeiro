import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('Erro: GEMINI_API_KEY não está definida no arquivo .env.');
  process.exit(1);
}

console.log('Conectando com a IA do Google...');

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

try {
  const prompt = 'Diga uma frase curta de boas-vindas confirmando que você está pronta para ajudar no Caderno de Contas.';
  const result = await model.generateContent(prompt);

  console.log('\nSUCESSO! A IA respondeu:');
  console.log('--------------------------------------------------');
  console.log(result.response.text());
  console.log('--------------------------------------------------\n');
} catch (error) {
  console.error('Ocorreu um erro ao falar com a IA:');
  console.error(error.message);
  process.exitCode = 1;
}
