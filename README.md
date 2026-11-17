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

Você pode publicar sua própria instalação em um provedor de aplicações Node.js e acessá-la pela internet. O sistema precisa de um banco MongoDB acessível pelo servidor.

### 1. Prepare o projeto e a hospedagem

Envie o código-fonte para o servidor ou carregue o ZIP e extraia os arquivos. Não inclua arquivos `.env`, credenciais, backups ou dados pessoais no ZIP. Escolha um provedor que aceite Node.js 20 ou superior.

Crie um banco MongoDB para essa instalação, por exemplo, no MongoDB Atlas. Configure o acesso de rede para permitir conexões do servidor de hospedagem e mantenha a URI e a senha privadas.

### 2. Configure as variáveis de ambiente

Cadastre estas variáveis no painel de configuração do provedor:

| Variável | Valor |
|---|---|
| `MONGODB_URI` | URI de conexão ao banco MongoDB |
| `JWT_SECRET` | Chave aleatória forte e exclusiva para esta instalação |
| `AI_KEY_SECRET` | Segredo aleatório de 32 bytes para criptografar as chaves de IA dos usuários |
| `FRONTEND_URL` | Endereço público do sistema, por exemplo `https://contas.exemplo.com`, sem barra no final |
| `ADMIN_EMAIL` | E-mail que será administrador ao fazer o primeiro acesso |
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth criado na etapa 4 |
| `NODE_ENV` | `production` |
| `ENABLE_LOCAL_LOGIN` | `false` |

O servidor não inicia sem `JWT_SECRET` em nenhum ambiente que não seja de teste. Na hospedagem, confirme `NODE_ENV=production` e gere uma chave `JWT_SECRET` nova, aleatória e exclusiva para esta instalação. Em Linux, use `openssl rand -hex 32`; com Node.js, use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Não compartilhe nem publique essa chave.

`AI_KEY_SECRET` também é obrigatória fora de testes. Gere outro valor independente com `openssl rand -hex 32`; não reutilize `JWT_SECRET`. Cada usuário cadastra seu próprio provedor e sua própria chave de IA nas Configurações. Essa chave de criptografia permanece apenas no servidor e deve ser preservada para que as chaves cadastradas continuem descriptografáveis.

### 3. Publique a aplicação

Configure a hospedagem Node.js com:

- Comando de build: `npm run setup && npm run build`
- Comando de início: `npm start`
- Porta: use a porta definida pelo provedor na variável `PORT`.

O servidor Node inicia a API e também serve os arquivos do frontend gerados na etapa de build. Se o provedor oferecer uma verificação de saúde, configure-a para `GET /api/system/health`.

O script `npm --prefix backend run backup` depende do executável `mongodump` (MongoDB Database Tools), que pode não estar disponível em hospedagens Node.js. Prefira os backups automáticos do MongoDB Atlas ou execute o script em um computador com as ferramentas instaladas e `MONGODB_URI` configurada. Mantenha os arquivos de backup fora do repositório.

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
