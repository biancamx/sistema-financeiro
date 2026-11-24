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
| `JWT_SECRET` | Segredo usado para assinar tokens; em produção deve ter ao menos 32 bytes aleatórios |
| `AI_KEY_SECRET` | Segredo persistente usado para proteger chaves de IA armazenadas |
| `BACKUP_ENCRYPTION_KEY` | Chave exclusiva de 32 bytes para cifrar/restaurar backups AES-256-GCM |
| `JWT_EXPIRES_IN` | Duração da sessão |
| `GOOGLE_CLIENT_ID` | Habilita a autenticação Google quando configurado |
| `ADMIN_EMAIL` | E-mail autorizado como administrador |
| `ALLOWED_DOMAINS` | Domínios de e-mail permitidos, quando aplicável |
| `ENABLE_LOCAL_LOGIN` | Habilita ou desabilita o login local |
| `COOKIE_SAMESITE` | Política `SameSite` dos cookies de sessão |
| `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX` | Limites de requisições gerais e de autenticação |
| `LOG_LEVEL` | Nível de detalhamento dos logs |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Configuração do Web Push |
| `JOBS_TOKEN` | Segredo exclusivo para proteger `/jobs`; obrigatório em produção e diferente de `JWT_SECRET` |

`VITE_API_URL` é uma variável do frontend, não do backend: configure-a no ambiente usado para compilar o frontend quando a API estiver em outra origem. Em produção, defina explicitamente `ENABLE_LOCAL_LOGIN=false` se o login local não for desejado. Configure `FRONTEND_URL` com as origens reais e use HTTPS.

## Login e acesso

O login Google é habilitado por `GOOGLE_CLIENT_ID`. No cliente OAuth do console do Google, configure a origem JavaScript do frontend (somente esquema e domínio, sem caminho) e o URI de redirecionamento do backend:

```text
Origem JavaScript: https://SEU_DOMINIO
URI de redirecionamento: https://SEU_DOMINIO/api/auth/google/callback
```

O valor de `ADMIN_EMAIL` identifica a conta administradora e só é promovido após autenticação Google com e-mail verificado. O cadastro por senha não pode reivindicar essa identidade. Contas novas podem depender de aprovação, conforme o fluxo de acessos do sistema.

Cada login cria uma sessão individual no backend. `POST /api/auth/logout` revoga a sessão atual; `GET /api/auth/sessions` lista sessões ativas; `DELETE /api/auth/sessions/:sessionId` revoga uma sessão; `POST /api/auth/logout-all` encerra todas as sessões da conta. JWTs antigos, sem emissor, público e identificador de sessão, deixam de ser aceitos após esta atualização; usuários precisarão autenticar novamente.

Somente alterações relacionadas à segurança — mudanças administrativas de conta, gestão de sessões, chaves de IA e links compartilhados — exigem login emitido nos últimos cinco minutos. Exportações, importações e operações de dados não encerram a sessão nem pedem novo login. Os alertas de segurança aparecem em **Mais → Configurações → Alertas de segurança** e, quando há assinatura Web Push, também no dispositivo. O push contém apenas uma mensagem genérica. São monitoradas cinco falhas de login em 15 minutos, reutilização de sessão revogada, três tentativas em 15 minutos de acessar registros indisponíveis e alterações administrativas. `GET /api/auth/security-alerts` e `PATCH /api/auth/security-alerts/read` são restritos à conta autenticada.

Links do Portal do participante usam tokens aleatórios de 256 bits, armazenados como hash e com expiração de 90 dias. O link em texto claro é exibido somente quando criado/renovado; se for perdido, gere outro, o que revoga o anterior. Para migrar os links existentes, faça primeiro um backup criptografado e verificado e, antes de publicar a nova versão, execute `npm --prefix backend run migrate:security` com `SECURITY_MIGRATION_BACKUP_VERIFIED=true`. A migração converte os links legados e ajusta índices sem apagar registros financeiros.

## PWA e notificações Web Push

O frontend inclui um manifest PWA com modo `standalone` e um service worker que recebe e exibe notificações. Para usar no iPhone/iPad, publique o sistema em HTTPS, abra-o no Safari e adicione-o à Tela de Início. O suporte a Web Push no iOS/iPadOS requer a versão 16.4 ou posterior e o uso do app instalado.

As notificações push avisam o usuário autenticado sobre faturas de cartão que vencem no dia ou estão atrasadas e, se habilitadas, sobre eventos de segurança. Alertas de segurança usam conteúdo genérico e não incluem informações financeiras. As notificações não são enviadas às pessoas cadastradas nem acionam a cobrança por WhatsApp.

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

O workflow do GitHub Actions também executa os testes do backend, auditoria das dependências e build do frontend. O Dependabot verifica atualizações semanais de dependências npm e GitHub Actions. Para uma instalação em um único serviço Node:

```bash
npm run setup
npm run build
npm start
```

O backend serve o frontend compilado quando `frontend/dist` existe. Se frontend e API forem publicados separadamente, configure `VITE_API_URL` para o endereço da API antes de executar o build e ajuste `FRONTEND_URL` no backend.

O endpoint de saúde da API é `/api/system/health`. O backup do MongoDB é cifrado com AES-256-GCM. Configure uma `BACKUP_ENCRYPTION_KEY` aleatória de 32 bytes (64 caracteres hexadecimais) e guarde-a separadamente dos arquivos de backup; perda dessa chave impede a restauração. Execute `npm --prefix backend run backup` e mantenha os arquivos `.archive.gz.enc` em armazenamento seguro.

Para validar a restauração, configure `RESTORE_MONGODB_URI` para uma instância MongoDB isolada, defina `RESTORE_TARGET_ACK=isolated-nonproduction` e execute `npm --prefix backend run restore:backup -- <caminho-do-arquivo>`. O processo restaura em `security_restore_test` sem `--drop`; não use um destino que contenha dados necessários.

## Segurança e operação

- Não versione `.env`, chaves VAPID, tokens, credenciais OAuth ou backups.
- Mantenha `JWT_SECRET`, `AI_KEY_SECRET` e `JOBS_TOKEN` fortes e fora do código. Preserve uma cópia segura de `AI_KEY_SECRET`; trocá-la pode impedir o acesso às chaves de IA já criptografadas.
- Em produção, o backend recusa `JWT_SECRET`, `AI_KEY_SECRET` ou `JOBS_TOKEN` ausentes/fracos e exige segredos diferentes. Gere-os com um gerador criptograficamente seguro.
- Faça e valide um backup do MongoDB antes do deploy desta etapa: ela adiciona as coleções `AuthSession`, `AuditEvent` e `SecurityAlert` e migra índices/tokens do Portal. Após o deploy, sessões JWT antigas serão invalidadas e os usuários precisarão entrar novamente.
- Antes da publicação, gere `BACKUP_ENCRYPTION_KEY`, configure-a no ambiente e faça backup/restauração em uma instância isolada. Rode a migração de segurança somente após confirmar o backup.
- A coleção `AuditEvent` registra autenticações, alterações administrativas, exportações e criação/revogação do Portal sem armazenar tokens ou dados financeiros. O acesso de leitura ao histórico é restrito a administradores; a aplicação só permite inserções.
- A CSP permite o script e a folha de estilos do Google Identity Services, além de estilos inline necessários ao botão Google. Scripts inline permanecem bloqueados. SRI não é aplicável ao script dinâmico do Google sem suporte do provedor.
- Use HTTPS em produção, especialmente para autenticação, PWA e Web Push.
- O token dos jobs deve ser enviado apenas pelo servidor/agendador, nunca pelo frontend público.
- Restrinja origens e domínios permitidos às necessidades da implantação.
- MFA, permissões mínimas, regras de rede e backups criptografados/restauráveis precisam ser configurados e verificados nos consoles do GitHub, Render e MongoDB Atlas; não são alteráveis por este repositório.
