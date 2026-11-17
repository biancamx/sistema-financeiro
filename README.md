# Caderno de Contas

Aplicação de gestão financeira para acompanhar despesas, receitas e compromissos. Organize informações por período, cartão, pessoa e veículo em um só sistema.

## Funcionalidades

- Compras parceladas e compartilhadas.
- Acompanhamento de faturas, pagamentos e limites de cartões.
- Controle mensal de receitas, descontos, despesas e saldo.
- Despesas avulsas, valores a receber e histórico de pagamentos.
- Visões consolidadas por período e pessoa.
- Gestão de veículos e respectivos gastos.
- Cadastro de aniversários e calculadora de rescisão.
- Autenticação e gerenciamento de acessos.

## Hospede sua própria instalação

Você pode publicar sua própria instalação em um provedor de aplicações Node.js e acessá-la pela internet. O sistema precisa de um banco MongoDB acessível pelo servidor. Docker é **opcional**: use-o somente se preferir esse formato e sua hospedagem oferecer Docker Compose.

### 1. Prepare o projeto e a hospedagem

Envie o código-fonte para o servidor ou carregue o ZIP e extraia os arquivos. Não inclua arquivos `.env`, credenciais, backups ou dados pessoais no ZIP. Escolha um provedor que aceite Node.js 20 ou superior. Para Docker, o provedor também precisa aceitar Docker Compose.

Crie um banco MongoDB para essa instalação, por exemplo, no MongoDB Atlas. Configure o acesso de rede para permitir conexões do servidor de hospedagem e mantenha a URI e a senha privadas.

### 2. Configure as variáveis de ambiente

Cadastre estas variáveis na área de configuração do provedor. Se for usar Docker Compose, coloque-as em um arquivo `.env` no servidor, nunca dentro do ZIP:

| Variável | Valor |
|---|---|
| `MONGODB_URI` | URI de conexão ao banco MongoDB |
| `JWT_SECRET` | Chave aleatória forte e exclusiva para esta instalação |
| `FRONTEND_URL` | Endereço público do sistema, por exemplo `https://contas.exemplo.com`, sem barra no final |
| `ADMIN_EMAIL` | E-mail que será administrador ao fazer o primeiro acesso |
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth criado na etapa 4 |
| `NODE_ENV` | `production` |
| `ENABLE_LOCAL_LOGIN` | `false` |

O servidor não inicia sem `JWT_SECRET` em nenhum ambiente que não seja de teste. Na hospedagem, confirme `NODE_ENV=production` e gere uma chave `JWT_SECRET` nova, aleatória e exclusiva para esta instalação. Em Linux, use `openssl rand -hex 32`; com Node.js, use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Não compartilhe nem publique essa chave.

### 3. Publique a aplicação

Escolha **uma** das opções:

**Sem Docker — hospedagem Node.js**

- Comando de build: `npm run setup && npm run build`
- Comando de início: `npm start`
- Porta: use a porta definida pelo provedor na variável `PORT`.

O servidor Node inicia a API e também serve os arquivos do frontend gerados na etapa de build.

**Com Docker Compose**

No servidor com Docker Compose instalado, execute:

```bash
docker compose up --build -d
```

O container escuta na porta `4000` e a configuração do Compose a publica na porta `8080` do servidor. Configure o proxy ou serviço de hospedagem para encaminhar o tráfego HTTPS à aplicação. Os passos para domínio, proxy e certificado variam conforme o provedor.

### 4. Configure o login com Google

No [Google Cloud Console](https://console.cloud.google.com/):

1. Crie ou selecione um projeto e configure a tela de consentimento OAuth. Se o aplicativo estiver em modo de teste, adicione as contas de teste permitidas; para uso mais amplo, conclua a configuração de publicação exigida pelo Google.
2. Crie uma credencial OAuth do tipo **ID do cliente OAuth para aplicativo da Web**.
3. Em **Origens JavaScript autorizadas**, adicione o endereço do sistema, sem caminho. Exemplo: `https://contas.exemplo.com`.
4. Em **URIs de redirecionamento autorizados**, adicione o callback: `https://contas.exemplo.com/api/auth/google/callback`.
5. Copie o ID do cliente para `GOOGLE_CLIENT_ID` nas variáveis do provedor.

Use o endereço público real da instalação e mantenha o domínio e o HTTPS iguais nos endereços autorizados e em `FRONTEND_URL`. O projeto usa o ID do cliente no fluxo de login; não coloque segredos OAuth no frontend. Reinicie ou publique novamente a aplicação após alterar as variáveis.

### 5. Faça o primeiro acesso

Entre com a conta Google definida em `ADMIN_EMAIL`; ela recebe acesso de administrador. Os demais usuários podem precisar de aprovação na área **Acessos**. A variável opcional `ALLOWED_DOMAINS` restringe os cadastros a domínios ou endereços específicos, como `empresa.com,usuario@exemplo.com`; sem configuração, não há essa restrição adicional.

## Desenvolvimento

O projeto requer **Node.js 20 ou superior**. Para instalar as dependências, iniciar o ambiente de desenvolvimento, executar os testes ou gerar a build:

```bash
npm run setup
npm run dev
npm test
npm run build
```

## Instalação como aplicativo

Em navegadores compatíveis, abra a instalação publicada e selecione **Instalar app** ou **Adicionar à tela inicial**. A instalação deve estar disponível por HTTPS.
