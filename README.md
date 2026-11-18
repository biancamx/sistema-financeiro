# Caderno de Contas

Aplicação web para organizar as finanças do dia a dia, acompanhar compras e parcelas, controlar contas a receber e manter os dados financeiros de cada usuário separados. O sistema também pode ser instalado como PWA e enviar notificações push para o próprio usuário.

## Funcionalidades

- **Painel financeiro:** resumo mensal de cartões e movimentações em dinheiro, com filtros por período.
- **Lançamentos e compras:** compras, parcelas, pagamentos e rateios entre pessoas.
- **Pessoas:** planilha mensal, extrato, cobrança, aniversários e portal para consultar informações compartilhadas.
- **Dinheiro e empréstimos:** despesas, recebimentos, empréstimos, reembolsos e parcelas em dinheiro.
- **Cartões:** limites, faturas, datas de fechamento e vencimento.
- **Veículos:** cadastro, documentos e fotos, gastos, consumo, manutenção e lembretes. Gastos pagos em dinheiro também podem ser acompanhados no histórico do veículo.
- **Assistente de IA:** integração configurável com provedores compatíveis, usando a chave do usuário e os dados da conta conforme o consentimento apresentado no app.
- **Outras ferramentas:** calculadora de rescisão, categorias, importação e gerenciamento de acessos.
- **PWA e notificações:** instalação na tela inicial e alertas push de faturas para o usuário autenticado.

Os registros financeiros são associados ao usuário da sessão. As notificações push são destinadas ao dono da conta; não fazem parte do fluxo de cobrança por WhatsApp de pessoas cadastradas.

## Tecnologias

| Área | Tecnologias |
| --- | --- |
| Frontend | React 18, React Router 7, Vite 6, CSS, Lucide e Recharts |
| Backend | Node.js, Express 4, Mongoose e Zod |
| Dados | MongoDB |
| Autenticação e segurança | JWT, bcrypt, Helmet, CORS e limitação de requisições |
| Integrações | Google OAuth, Web Push (`web-push`) e importação de planilhas |
| Testes | `node:test` e `mongodb-memory-server` |
| CI | GitHub Actions com Node.js 22 |

## Como o sistema funciona

O frontend React é uma aplicação de página única. Durante o desenvolvimento, o Vite serve a interface e encaminha as chamadas de API ao backend. Em produção, o backend Express pode servir os arquivos compilados em `frontend/dist`.

O backend conecta ao MongoDB antes de começar a aceitar requisições. As rotas privadas da API ficam sob `/api` e verificam a sessão do usuário. O portal compartilhado de pessoas fica em `/api/portal`; os endpoints de notificações agendadas ficam em `/jobs` e exigem um token secreto.

```text
Navegador / PWA
       │
       ├── Interface React (Vite em desenvolvimento; frontend/dist em produção)
       │
       └── API Express (/api) ── MongoDB
                    ├── Portal compartilhado (/api/portal)
                    └── Jobs protegidos (/jobs)
```

### Estrutura do repositório

```text
backend/
  src/
    config/       configuração e validação do ambiente
    middleware/   autenticação, validação e segurança
    models/       modelos MongoDB/Mongoose
    modules/      rotas e serviços por funcionalidade
  scripts/        tarefas administrativas e dados de demonstração
frontend/
  public/         manifest, ícones e service worker
  src/            páginas, componentes e estilos da interface
tools/            utilitários auxiliares
```

## Requisitos

- Node.js 22 (versão usada no CI; o backend declara compatibilidade a partir de Node.js 18.17).
- npm.
- MongoDB local ou uma instância acessível pela rede.

## Executar localmente

1. Clone o repositório e entre na pasta do projeto.
2. Crie o arquivo de ambiente do backend:

   ```powershell
   Copy-Item backend\.env.example backend\.env
   ```

3. Configure `MONGODB_URI`, `JWT_SECRET` e `AI_KEY_SECRET` em `backend/.env`. Gere segredos fortes e exclusivos para o ambiente; mantenha `AI_KEY_SECRET` estável, pois ela é necessária para descriptografar chaves de IA já armazenadas. Para gerar cada valor hexadecimal de 32 bytes, pode-se usar `openssl rand -hex 32`; gere valores diferentes para cada segredo.
4. Instale as dependências:

   ```bash
   npm run setup
   ```

5. Inicie backend e frontend em modo de desenvolvimento:

   ```bash
   npm run dev
   ```

O frontend é servido pelo Vite e o backend, por padrão, na porta `4000`. Consulte os valores de `PORT` e `VITE_API_URL` nos arquivos de ambiente para ajustar portas ou separar os serviços.

### Comandos principais

| Comando | Ação |
| --- | --- |
| `npm run setup` | Instala as dependências do projeto, frontend e backend |
| `npm run dev` | Inicia frontend e backend para desenvolvimento |
| `npm test` | Executa os testes do backend |
| `npm run build` | Gera a versão de produção do frontend |
| `npm start` | Inicia o backend; serve `frontend/dist` quando a pasta compilada existe |
| `npm run seed` | Recria os dados da conta de demonstração `demo@local.dev` |

> **Atenção:** `npm run seed` apaga e recria os registros financeiros da conta de demonstração. Não execute em uma base que contenha dados que você queira preservar.

## Variáveis de ambiente

O arquivo `backend/.env.example` contém a lista atualizada e os valores ilustrativos. Configure os valores reais em `backend/.env` e nunca publique esse arquivo.

| Variável | Finalidade |
| --- | --- |
| `NODE_ENV` | Ambiente de execução (`development` ou `production`) |
| `PORT` | Porta HTTP do backend |
| `MONGODB_URI` | URI de conexão com o MongoDB |
| `FRONTEND_URL` | Origem ou origens permitidas para o frontend |
| `JWT_SECRET` | Segredo usado para assinar tokens de sessão |
| `AI_KEY_SECRET` | Segredo persistente usado para proteger chaves de IA armazenadas |
| `JWT_EXPIRES_IN` | Duração da sessão |
| `GOOGLE_CLIENT_ID` | Habilita a autenticação Google quando configurado |
| `ADMIN_EMAIL` | E-mail autorizado como administrador |
| `ALLOWED_DOMAINS` | Domínios de e-mail permitidos, quando aplicável |
| `ENABLE_LOCAL_LOGIN` | Habilita ou desabilita o login local |
| `COOKIE_SAMESITE` | Política `SameSite` dos cookies de sessão |
| `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX` | Limites de requisições gerais e de autenticação |
| `LOG_LEVEL` | Nível de detalhamento dos logs |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Configuração do Web Push |
| `JOBS_TOKEN` | Token secreto para proteger os endpoints `/jobs` |

`VITE_API_URL` é uma variável do frontend, não do backend: configure-a no ambiente usado para compilar o frontend quando a API estiver em outra origem. Em produção, defina explicitamente `ENABLE_LOCAL_LOGIN=false` se o login local não for desejado. Configure `FRONTEND_URL` com as origens reais e use HTTPS.

## Login e acesso

O login Google é habilitado por `GOOGLE_CLIENT_ID`. No console do Google, configure a origem do frontend e o URI de callback do backend:

```text
https://SEU_DOMINIO/api/auth/google/callback
```

O valor de `ADMIN_EMAIL` identifica a conta administradora. Contas novas podem depender de aprovação, conforme o fluxo de acessos do sistema.

## PWA e notificações Web Push

O frontend inclui um manifest PWA com modo `standalone` e um service worker que recebe e exibe notificações. Para usar no iPhone/iPad, publique o sistema em HTTPS, abra-o no Safari e adicione-o à Tela de Início. O suporte a Web Push no iOS/iPadOS requer a versão 16.4 ou posterior e o uso do app instalado.

As notificações push atuais avisam o usuário autenticado sobre faturas de cartão que vencem no dia ou estão atrasadas. Elas não são enviadas às pessoas cadastradas nem acionam a cobrança por WhatsApp.

1. Gere as chaves VAPID:

   ```bash
   npm --prefix backend run generate:vapid
   ```

2. Configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` no ambiente do backend. Gere também um valor forte e privado para `JOBS_TOKEN`.
3. No app instalado, entre em **Configurações** e toque em **Ativar notificações no celular**. A permissão do navegador é solicitada somente após essa ação.
4. Configure um agendador externo (por exemplo, cron ou o agendador do provedor) para chamar `POST /jobs/notificar` com o header `x-jobs-token` igual ao `JOBS_TOKEN`. Não há agendador interno no backend.
5. Para enviar uma notificação de teste, chame `POST /jobs/teste` com o mesmo header e um JSON contendo o identificador do usuário ativo:

   ```json
   { "userId": "ID_DE_24_CARACTERES_DO_USUARIO" }
   ```

As assinaturas são associadas ao usuário autenticado. Assinaturas inválidas ou expiradas são removidas quando o serviço de push retorna os erros correspondentes.

## Testes, build e publicação

Antes de publicar, execute:

```bash
npm test
npm run build
```

O workflow do GitHub Actions também executa os testes do backend e o build do frontend. Para uma instalação em um único serviço Node:

```bash
npm run setup
npm run build
npm start
```

O backend serve o frontend compilado quando `frontend/dist` existe. Se frontend e API forem publicados separadamente, configure `VITE_API_URL` para o endereço da API antes de executar o build e ajuste `FRONTEND_URL` no backend.

O endpoint de saúde da API é `/api/system/health`. Para backup do MongoDB, o backend disponibiliza `npm --prefix backend run backup`; verifique se as ferramentas do MongoDB estão instaladas e se o destino do backup está configurado antes de executar.

## Segurança e operação

- Não versione `.env`, chaves VAPID, tokens, credenciais OAuth ou backups.
- Mantenha `JWT_SECRET`, `AI_KEY_SECRET` e `JOBS_TOKEN` fortes e fora do código. Preserve uma cópia segura de `AI_KEY_SECRET`; trocá-la pode impedir o acesso às chaves de IA já criptografadas.
- Use HTTPS em produção, especialmente para autenticação, PWA e Web Push.
- O token dos jobs deve ser enviado apenas pelo servidor/agendador, nunca pelo frontend público.
- Restrinja origens e domínios permitidos às necessidades da implantação.
