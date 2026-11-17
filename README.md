# Caderno de Contas

Aplicação web para organizar as finanças de pessoas e grupos. Acompanhe cartões, compras parceladas, movimentações avulsas, orçamento mensal e gastos de veículos em um só lugar.

## Recursos

- **Painel:** resumo mensal de cartões e movimentações avulsas, com filtros por período.
- **Lançamentos:** compras, parcelas, pagamentos e rateios entre pessoas.
- **Caixa Avulso:** despesas, recebimentos, empréstimos e reembolsos, com histórico e vencimentos.
- **Planilha mensal e visão por pessoa:** receitas, despesas, parcelas e saldos por mês.
- **Cartões:** limites, faturas, fechamento e vencimento.
- **Veículos:** cadastro, fotos, gastos, consumo, manutenção, lembretes e documentos. Gastos pagos em dinheiro também aparecem em Avulsos, vinculados ao histórico do veículo e gerenciados pela tela de Veículos.
- **Assistente de IA:** Gemini, OpenAI ou Claude; consulta dados atuais da conta autenticada, planilhas por pessoa, compras, parcelas, categorias, contas e recebimentos, e compara períodos.
- **Pessoas, aniversários, acessos e calculadora de rescisão.**

## Requisitos

- Node.js 22.x é a versão usada pelo CI e recomendada para desenvolvimento e hospedagem.
- Um banco MongoDB acessível pela aplicação, por exemplo, MongoDB Atlas.

## Desenvolvimento local

1. Crie `backend/.env` com base em `backend/.env.example`.
2. Preencha `MONGODB_URI`, `JWT_SECRET` e `AI_KEY_SECRET`. Para usar login com Google, configure também `GOOGLE_CLIENT_ID`. Não compartilhe o arquivo `.env`.
3. Na raiz do projeto, instale as dependências e inicie a aplicação:

```bash
npm run setup
npm run dev
```

O frontend fica disponível pelo Vite e a API usa `http://localhost:4000`. Em desenvolvimento, o Vite encaminha as chamadas `/api` para a API local.

Comandos adicionais, executados na raiz:

```bash
npm test       # testes do backend com MongoDB em memória
npm run build  # build de produção do frontend
npm start      # inicia o backend e serve o frontend compilado
```

## Hospedagem Node.js

Configure o serviço para executar a partir da raiz do repositório:

| Configuração | Valor |
|---|---|
| Build | `npm run setup && npm run build` |
| Início | `npm start` |
| Porta | A variável `PORT` fornecida pelo provedor |
| Saúde | `GET /api/system/health` |

O processo Node serve a API e os arquivos compilados do frontend. Defina `NODE_ENV=production` no painel da hospedagem.

### Variáveis de ambiente

Configure os valores no painel do provedor. Não os grave no repositório.

| Variável | Uso |
|---|---|
| `MONGODB_URI` | URI privada de conexão com o MongoDB; obrigatória |
| `NODE_ENV` | Use `production` na hospedagem |
| `PORT` | Porta informada pelo provedor |
| `FRONTEND_URL` | Origem pública autorizada, sem barra final; origens adicionais podem ser separadas por vírgula |
| `JWT_SECRET` | Segredo exclusivo da instalação, com pelo menos 32 bytes aleatórios; obrigatório fora de testes |
| `AI_KEY_SECRET` | Segredo exclusivo de 32 bytes em hexadecimal (64 caracteres); obrigatório fora de testes e usado para criptografar as chaves de IA |
| `ADMIN_EMAIL` | E-mail que deve receber acesso de administrador |
| `GOOGLE_CLIENT_ID` | ID OAuth do Google; necessário para habilitar o login Google |
| `ENABLE_LOCAL_LOGIN` | Em produção, mantenha `false` se o login local não for desejado |
| `JWT_EXPIRES_IN` | Duração da sessão; padrão `7d` |
| `ALLOWED_DOMAINS` | Restrição opcional de cadastros por domínio ou e-mail, separados por vírgula |
| `COOKIE_SAMESITE` | Política do cookie; padrão `lax`. Para front e API em sites diferentes, configure `none` e use HTTPS |
| `VITE_API_URL` | Só precisa ser definida durante o build quando o frontend e a API estão em origens diferentes |

Gere segredos diferentes para `JWT_SECRET` e `AI_KEY_SECRET`, por exemplo:

```bash
openssl rand -hex 32
```

Guarde `AI_KEY_SECRET` de forma permanente e segura: sem ela, as chaves de IA já salvas não poderão ser descriptografadas. Cada usuário fornece sua própria chave de provedor na aba **Configurações**; a aplicação não usa uma chave global como alternativa.

Para backups, prefira os backups automáticos do MongoDB Atlas. O script `npm --prefix backend run backup` depende do programa `mongodump`, que pode não estar instalado no provedor. Se executá-lo localmente, use uma máquina com MongoDB Database Tools e mantenha os arquivos gerados fora do repositório.

## Login com Google

No Google Cloud Console:

1. Configure a tela de consentimento OAuth e, se necessário, cadastre as contas de teste.
2. Crie uma credencial OAuth do tipo **ID do cliente OAuth para aplicativo da Web**.
3. Cadastre a origem do site em **Origens JavaScript autorizadas**.
4. Cadastre `https://SEU-DOMINIO/api/auth/google/callback` em **URIs de redirecionamento autorizados**.
5. Informe o ID do cliente em `GOOGLE_CLIENT_ID`.

Use o domínio HTTPS real da aplicação e mantenha a origem consistente com `FRONTEND_URL`. Reinicie ou publique novamente o serviço após alterar variáveis.

## Primeiro acesso e usuários

Faça login com o endereço definido em `ADMIN_EMAIL` para receber acesso de administrador. Novas contas podem precisar de aprovação na área **Acessos**. Se `ALLOWED_DOMAINS` estiver definido, o cadastro fica limitado aos domínios ou endereços informados.

## Segurança e dados

- Não envie arquivos `.env`, chaves, credenciais, dados pessoais ou backups para o Git.
- As chaves de IA dos usuários são armazenadas criptografadas no servidor e não são devolvidas ao frontend.
- Com consentimento, a mensagem e os dados necessários às consultas do assistente são enviados ao provedor de IA escolhido. Consultas respeitam o usuário autenticado; alterações só são disponibilizadas após um pedido explícito do usuário.
- As imagens e documentos de veículos são associados aos registros e protegidos pelas permissões do usuário.
- Mantenha o acesso ao MongoDB restrito ao necessário para o serviço.
