# Caderno de Contas — gestão financeira (React + API separada)

Sistema que funciona como a planilha `Financeiro_2026.xlsx`: compras parceladas por cartão e pessoa,
quanto cada um deve, limite dos cartões, planilha mensal (receitas, descontos, despesas, saldo),
visão geral por pessoa, aniversários e calculadora de rescisão.

## Ver rodando (sem configurar nada)

Precisa de **Node 20+**.

```bash
npm run setup     # instala backend, frontend e a raiz (uma vez)
npm run dev       # sobe API (http://localhost:4000) + front (http://localhost:5173)
```

Abra **http://localhost:5173** e clique em **“Entrar em modo local”**: entra com os dados da sua planilha já carregados.
O login com Google aparece desativado (veja “Ativar o Google”).

Outros comandos: `npm test` (testes da API) · `npm run seed` (recria os dados de exemplo) · `npm run build`.

## Estrutura (camadas)

| Camada | Onde está |
|---|---|
| Frontend | `frontend/` — React + Vite + React Router. `pages/` (telas), `components/`, `context/`, `services/` (único lugar que fala com a API), `app/router.jsx` (rotas) |
| APIs & Backend Logic | `backend/src/modules/*` — cada módulo tem `routes` (+ `service`). Express montado em `src/app.js` |
| Database & Storage | `backend/src/db/schema.sql` (SQLite, arquivo em `backend/data/`) |
| Auth & Permissions | `middleware/auth.js` (JWT em cookie httpOnly) + `modules/auth` (modo local, e-mail/senha, Google) |
| Hosting & Deployment | `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile` |
| Cloud & Compute | Imagens Docker prontas para Render/Fly/Railway/VPS |
| CI/CD & Version Control | `.github/workflows/ci.yml` (testes + build + docker) |
| Security & RLS | `middleware/security.js` (helmet, CORS, checagem de Origin), zod em toda entrada, **todo dado filtrado por `user_id`** (teste de isolamento em `tests/`) |
| Rate Limiting | `middleware/rateLimit.js` (geral e mais rígido no login) |
| Caching & CDN | `lib/cache.js` (cache por usuário, invalidado em escritas) · `frontend/nginx.conf` (assets imutáveis p/ CDN) |
| Load Balancing & Scaling | API stateless (JWT); para escalar: Postgres + Redis + réplicas atrás do nginx |
| Error Tracking & Logs | `lib/logger.js` (pino, com requestId) · `middleware/errorHandler.js` · `ErrorBoundary` do React reporta em `/api/client-errors` |
| Availability & Recovery | `/api/health` e `/api/ready`, desligamento limpo, `npm --prefix backend run backup`, healthcheck + restart no Docker |

## Rotas

**Front:** `/login` · `/painel` · `/lancamentos` · `/avulsos` · `/cartoes` · `/veiculos/:id?` · `/planilha/:pessoa?/:ano?` · `/visao-geral/:pessoa?/:ano?` · `/pessoas` · `/aniversarios` · `/rescisao` · `/configuracoes`

**API (`/api`):** `GET /health` `GET /ready` · `/auth/{config,local,register,login,google,me,logout}` ·
`/dashboard/{summary,person-overview,status}` · `/purchases` (+ `/installments`, `/export.csv`, `/shared`) · `/budgets` (+ linhas e células) ·
`/cash-ledger` (+ `/entries`, `/installments`, `/receipts`, `/people/:id`, `/summary`, `/dashboard`, `/export.csv`) ·
`/cards` · `/people` · `/categories` · `/birthdays` · `/tools/rescission` · `/vehicles` (+ `/summary`, `/categories`, `/expenses`, `/expenses/export.csv`)

## Como a planilha virou sistema

| Planilha | Sistema |
|---|---|
| Aba *Banco De Dados* (1 linha por parcela) | **Lançamentos**: uma compra + parcelas geradas automaticamente (valor, nº de parcelas, mês inicial) |
| Coluna “Número correspondente ao mês” | consulta por `ano*12+mês` no backend |
| *Dashboard* (cartões do mês, total devido, último mês) | **Painel** |
| *dahbord cartoes* (limite usado/disponível) | **Cartões** |
| *Financeiro Pessoa 01 / Pessoa 07* | **Planilha mensal** por pessoa e ano; linhas de cartão automáticas; células editáveis |
| *financeiro geral* (cartão × mês + Status) | **Visão geral** com Pendente/Pago por mês |
| Bloco de rescisão e Aniversários | **Calculadora de rescisão** e **Aniversários** |
| Compras fora do cartão, vendas e valores a receber | **Avulsos**: caixa em dinheiro/Pix/débito, parcelas e histórico de recebimentos |

### Avulsos (caixa e a receber)

A aba **Avulsos** mantém saídas e recebíveis em tabelas próprias, sem criar compras ou parcelas de cartão. Valores são persistidos em centavos; parcelas e saldos são derivados do cronograma e do histórico de recebimentos. Vendas podem usar Pessoas e marcar um veículo como vendido. O Painel tem sub-abas de Cartões e Avulsos; o resumo de Avulsos usa dados agregados do serviço central e oferece filtros de período, gráficos e atalhos para os registros. A Visão geral e a Planilha mensal também mostram gastos avulsos e valores recebidos.

Na aba **Cartões**, cada cartão pode ter banco/modelo visual, bandeira, cor, arte, últimos quatro dígitos e titular principal
(o número completo nunca é solicitado ou armazenado). A barra de limite considera parcelas em aberto a partir do mês
selecionado; pagamentos totais ou parciais da fatura liberam limite proporcionalmente, e compras continuam podendo ser
atribuídas a outras pessoas.

Observação: na planilha só existem as parcelas restantes; por isso nos dados importados a numeração aparece como 1/N das parcelas que sobraram. Compras novas numeram certo (1/12, 2/12…).

## Compras compartilhadas (dividir uma compra entre várias pessoas)

Em **Lançamentos → Nova compra**, marque **“Compra compartilhada”** e escolha 2 ou mais participantes.
Exemplo: Chiquinha, José e Fábio compram uma TV de R$ 1.300 em 10x de R$ 130 → cada um paga ≈ R$ 43,33 por mês
(com 2 pessoas seria R$ 65,00).

- **Você escolhe como dividir:** *partes iguais*, *por porcentagem* (soma 100%) ou *por valor em R$ do total da compra*
  (soma = total). Ex.: TV de R$ 1.300 em 10x com 50% / 30% / 20% → R$ 65 / R$ 39 / R$ 26 por mês. A tela mostra a
  soma em tempo real ("faltam R$ 100,00"), quanto cada um paga por mês, e tem o botão "Dividir igualmente".
- **Exato no centavo:** a divisão é feita parcela a parcela e a soma das partes é sempre igual à parcela
  (R$ 130,00 ÷ 3 = 43,34 + 43,33 + 43,33; o centavo a mais gira entre as pessoas a cada mês).
- **Duração:** cada participante recebe exatamente as N parcelas configuradas; depois da última não há mais cobrança.
- **Aparece em todas as telas:** o valor de cada pessoa entra no Painel, na Planilha mensal, na Visão geral e em
  “quanto cada um deve”; o cartão continua usando a parcela inteira (R$ 130) do limite.
- **Como funciona por dentro:** cada participante tem a sua própria compra (com a sua fatia das parcelas), ligadas pelo
  campo `purchases.shared_group`. Por isso nenhuma consulta de totais precisou mudar.
- **Editar/excluir:** age no grupo todo. Trocar participantes, valor ou nº de parcelas recalcula tudo e mantém as
  parcelas já marcadas como pagas (por pessoa e número). Cada pessoa marca a *sua* parcela como paga normalmente.
- **API:** `POST /purchases/shared` · `GET|PUT|DELETE /purchases/shared/:group` (corpo igual ao de `/purchases`, trocando `personId` por
  `participants: [{ personId, value }]` + `splitMode: 'equal' | 'percent' | 'amount'`; para partes iguais basta `participantIds: [..]`). Editar/excluir uma fatia isolada por `/purchases/:id` é bloqueado.
- **Bancos antigos** ganham a coluna `shared_group` sozinhos na próxima inicialização (migração automática).

## Atualizar os dados com uma planilha nova (ex.: `Financeiro_2027.xlsx`)

Os dados de exemplo vivem em `backend/src/db/seed-data.json`. Para trazer parcelas, planilha mensal, contas fixas
(luz, água, internet, veículo…) e status de uma planilha nova:

```bash
pip install openpyxl
python3 tools/importar_planilhas.py caminho/Financeiro_2027.xlsx --ano 2027
npm run seed      # recria a conta demo com os dados novos (edições feitas só na conta demo são perdidas)
```

O ano da planilha nova manda naquele ano; os outros anos não mudam. O script lista o que entrou/saiu e guarda um `.bak`.
`npm test` confere os totais de 2026 e 2027 com as planilhas.

## Ativar o Google (quando quiser)

0. `cp backend/.env.example backend/.env`
1. No Google Cloud Console crie um *OAuth Client ID* do tipo **Web** com a origem `http://localhost:5173`.
2. Em `backend/.env` coloque `GOOGLE_CLIENT_ID=seu-id` e reinicie. O botão do Google passa a funcionar sozinho (o front pega o ID da API).

## Produção

```bash
cp .env.example .env   # defina JWT_SECRET (openssl rand -hex 32), FRONTEND_URL
docker compose up --build   # http://localhost:8080
```
Em produção `ENABLE_LOCAL_LOGIN` fica **desligado** por padrão. Se front e API ficarem em domínios diferentes, use `COOKIE_SAMESITE=none` (HTTPS) e `VITE_API_URL`.


## Gestão de Veículos (frota + histórico de gastos)

Menu **Patrimônio → Gestão de Veículos** (`/veiculos`). Vários veículos (carro, moto, utilitário), cada um com a sua ficha e o seu histórico.

- **Alternar entre veículos:** a barra do topo tem “Toda a frota” (painel consolidado) e um botão por veículo; o filtro de ano vale para painel e lançamentos.
- **Ficha:** placa (aceita `ABC-1D23` ou `ABC1234`; única por usuário), modelo, ano, tipo, valor de compra, status (Ativo / Inativo / Vendido) e observações. O KM atual é o maior KM já lançado.
- **Gastos (a partir de R$ 1,00):** data, veículo, categoria, descrição, valor, KM e pessoa responsável/pagadora. Categorias:
  *fixos e recorrentes* (financiamento, IPVA, licenciamento, seguro, DPVAT) · *manutenção e cuidados* (preventiva, corretiva, óleo, alinhamento, pneus, lavagem, estética) · *operacional e imprevistos* (combustível, pedágio, estacionamento, multa, acessórios, outros).
- **Rateio:** “Despesa compartilhada” divide o gasto entre 2+ pessoas em *partes iguais*, *%* ou *R$* (mesma lógica das compras compartilhadas: fecha no centavo). Sem marcar, o gasto é individual e fica com quem pagou. O painel traz o **acerto entre pessoas**: pagou × assume = saldo (positivo = a receber).
- **Painel:** total, média mensal, KM atual, custo por km rodado, gasto × valor de compra, por grupo, por categoria, por mês e por veículo.
- **Rastreabilidade:** cada gasto guarda quem pagou e a fatia de cada pessoa (`vehicle_expense_shares`). Pessoa com gasto de veículo **não pode ser excluída** (409); veículo com lançamentos só é excluído com confirmação (`DELETE /vehicles/:id?force=true`) — prefira marcar como *Vendido*.
- **API:** `GET|POST /vehicles` · `GET|PUT|DELETE /vehicles/:id` · `GET /vehicles/summary?vehicleId&year` · `GET|POST /vehicles/expenses` (filtros: `vehicleId, category, group, personId, shared, year, from, to, search, page`) · `GET|PUT|DELETE /vehicles/expenses/:id` · `GET /vehicles/expenses/export.csv` · `GET /vehicles/categories`.
  Corpo de gasto: `{ vehicleId, date, category, description, amount, km, payerId, shared, splitMode, participants:[{personId,value}] }`.
- **Dados de exemplo:** o modo local já traz 2 veículos com gastos (`npm run seed` para recriar). Bancos antigos ganham as tabelas novas sozinhos ao subir a API.
