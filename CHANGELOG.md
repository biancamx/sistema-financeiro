# Histórico de versões — Sistema Financeiro

## Versão 2.0.0 — Identidade institucional e autoria

**Data:** 24/11/2026

- Assinatura institucional discreta adicionada globalmente ao rodapé.
- Seção “Sobre o sistema” adicionada às Configurações com autoria, versão, ano de criação, propósito, direitos autorais e tecnologias.
- Avisos de autoria e uso proprietário documentados no código-fonte, README e LICENSE.
- Minuta inicial de termos de uso adicionada para orientar eventual acesso de terceiros.

## Versão 2.0 — Reorganização, melhorias de interface e Web Push

**Status:** Pendente de revisão e commit
**Branch:** `main`
**Commit-base:** `b696afe` — `feat(budget): track payment status per month`
**Data do levantamento:** 18/11/2026

---

## 1. Resumo da atualização

A versão 2.0 reúne mudanças de navegação, organização das telas, responsividade e notificações Web Push. As alterações de interface buscam facilitar o acesso às funcionalidades existentes; não representam, por si só, mudanças nos cálculos financeiros.

### Estado do Git

Antes deste changelog, o levantamento registrou 32 arquivos modificados e 21 novos, totalizando 53 caminhos. A criação deste arquivo acrescenta mais um arquivo novo:

- 32 arquivos modificados.
- 22 arquivos novos, incluindo este changelog.
- 54 caminhos com alterações.
- Nenhum arquivo removido.
- Nenhuma alteração staged.
- Nenhum commit criado.

---

## 2. Navegação e organização da interface

- Reorganização da navegação em áreas e adaptação da navegação mobile.
- Menu **Mais** em painel sobreposto, com acesso a ferramentas e configurações.
- Busca global para localizar registros e áreas.
- Botão de criação rápida para acessar os fluxos existentes.
- Indicadores visuais da área ativa e atualização do tour guiado.
- Novas páginas para transações e funcionalidades adicionais.
- Redirecionamentos para rotas antigas e carregamento lazy preservados.

Componentes e páginas novos:

- `frontend/src/components/layout/GlobalSearch.jsx`
- `frontend/src/components/layout/MoreMenu.jsx`
- `frontend/src/components/layout/NewActionButton.jsx`
- `frontend/src/pages/more/MorePage.jsx`
- `frontend/src/pages/transactions/TransactionsPage.jsx`
- `frontend/src/pages/transactions/ExportPage.jsx`

---

## 3. Área de Pessoas

- Criação de um perfil para cada pessoa, com abas e identificação da pessoa selecionada.
- Extrato e Planilha vinculados à pessoa do perfil; a Planilha continua permitindo trocar o ano.
- Cartão da lista com acesso “Mês a mês”.
- Aba Cobrar com conteúdo e ações próprios, sem repetir o cartão da lista.
- Aniversários integrados à área de Pessoas.
- Aba Portal removida da navegação do perfil. As rotas direta e pública do Portal permanecem no código.

Arquivos novos:

- `frontend/src/pages/people/PeopleAreaPage.jsx`
- `frontend/src/pages/people/PersonTabs.jsx`
- `frontend/src/pages/people/PersonBillingPage.jsx`

---

## 4. Painel principal e operações financeiras

- Inclusão do painel **O que precisa de atenção** e ajustes nos resumos do Dashboard.
- Reorganização da apresentação de Compras, Dinheiro, Parcelas, Cartões, Veículos, Planilha e Extrato.
- Organização de opções avançadas nos formulários de compras, dinheiro e gastos de veículos.
- Ajustes nas ações em lote das parcelas, mantendo os fluxos existentes.
- Página própria de Exportação e rota de Importação que reutiliza o fluxo já existente.

Arquivo novo:

- `frontend/src/pages/dashboard/AttentionPanel.jsx`

---

## 5. Configurações

- Página reorganizada em coluna única e grupos de opções.
- Formulários de Importação, chave de IA e lembretes apresentados em diálogos.
- Ações existentes de categorias e conta mantidas.
- Diálogos desta página podem fechar por Escape, clique fora e controles de fechamento.
- A rota independente de Importação continua disponível.
- Notificações no celular e limpeza de lançamentos foram mantidas na página.

Arquivos relacionados:

- `frontend/src/pages/settings/SettingsPage.jsx`
- `frontend/src/pages/settings/SettingsPage.css`
- `frontend/src/pages/settings/SettingsImportPage.jsx`

---

## 6. Layout e responsividade

- Ajustes de camadas visuais, contêineres e tabelas roláveis.
- Regras documentadas para prevenir sobreposição e problemas de responsividade.
- Barras de rolagem ocultas visualmente sem desativar a rolagem.
- Rolagem por toque mantida nos contêineres roláveis.

Arquivos relacionados:

- `frontend/src/styles/global.css`
- `frontend/LAYOUT.md`

---

## 7. Web Push

Foi adicionada infraestrutura para notificações financeiras destinadas ao usuário da conta.

### Backend

- Modelos para assinaturas de dispositivos e registro de entregas.
- Rotas autenticadas para consultar a chave pública VAPID e salvar/remover assinaturas.
- Rotas de job protegidas por `JOBS_TOKEN`.
- Envio com `web-push`, deduplicação de entregas e remoção de assinaturas que retornem HTTP 404 ou 410.

### Frontend

- Registro do Service Worker e tratamento de eventos `push` e `notificationclick`.
- Configuração nas Configurações para ativar e desativar notificações no dispositivo.
- Solicitação de permissão iniciada pelo botão de ativação.
- A interface informa os requisitos para uso no iPhone.

### Escopo e observações

- O job implementado envia alertas `card_invoice` de faturas que vencem hoje ou estão atrasadas.
- O processamento depende de uma chamada externa a `/jobs/notificar`; não foi adicionado agendador interno.
- `/jobs/teste` envia uma notificação de teste para um `userId` explícito.
- O manifest existente já declara `display: "standalone"`; ele não foi alterado nesta atualização.
- As credenciais VAPID e `JOBS_TOKEN` são configuração de ambiente; valores secretos não devem ser incluídos neste arquivo.

Novos arquivos do recurso:

- `backend/src/models/PushDelivery.js`
- `backend/src/models/PushSubscription.js`
- `backend/src/modules/push/jobs.routes.js`
- `backend/src/modules/push/push.routes.js`
- `backend/src/modules/push/push.service.js`
- `backend/src/modules/push/pushJobs.service.js`
- `backend/tests/push.test.js`
- `frontend/public/service-worker.js`
- `frontend/src/pages/settings/PushNotificationsSettings.jsx`

---

## 8. Ambiente de demonstração

- Ajustes no contexto de autenticação do frontend para o acesso local de demonstração.
- Ajuste no seed da conta demo.
- Arquivos do ambiente de desenvolvimento e exemplos de configuração atualizados.

Esses ajustes de demonstração não devem ser interpretados como uma alteração deliberada da política de autenticação de produção.

---

## 9. Inventário de arquivos

### Backend — modificados (7)

- `backend/.env.example`
- `backend/package.json`
- `backend/package-lock.json`
- `backend/scripts/seed.js`
- `backend/src/app.js`
- `backend/src/config/env.js`
- `backend/src/modules/reminders/reminders.service.js`

### Frontend — modificados (25)

- `frontend/src/app/paths.js`
- `frontend/src/app/routeLoaders.js`
- `frontend/src/app/router.jsx`
- `frontend/src/components/layout/AppLayout.jsx`
- `frontend/src/components/ui/ui.jsx`
- `frontend/src/context/AuthContext.jsx`
- `frontend/src/lib/tour.js`
- `frontend/src/main.jsx`
- `frontend/src/pages/birthdays/BirthdaysPage.jsx`
- `frontend/src/pages/budget/BudgetPage.jsx`
- `frontend/src/pages/cards/CardsPage.jsx`
- `frontend/src/pages/cashLedger/CashEntryForm.jsx`
- `frontend/src/pages/cashLedger/CashLedgerPage.jsx`
- `frontend/src/pages/dashboard/CashDashboard.jsx`
- `frontend/src/pages/dashboard/DashboardPage.jsx`
- `frontend/src/pages/overview/OverviewPage.jsx`
- `frontend/src/pages/people/PeoplePage.jsx`
- `frontend/src/pages/purchases/PurchaseForm.jsx`
- `frontend/src/pages/purchases/PurchasesPage.jsx`
- `frontend/src/pages/settings/SettingsPage.css`
- `frontend/src/pages/settings/SettingsPage.jsx`
- `frontend/src/pages/vehicles/ExpenseForm.jsx`
- `frontend/src/pages/vehicles/VehiclesPage.jsx`
- `frontend/src/services/api.js`
- `frontend/src/styles/global.css`

### Novos arquivos — backend (7)

- `backend/src/models/PushDelivery.js`
- `backend/src/models/PushSubscription.js`
- `backend/src/modules/push/jobs.routes.js`
- `backend/src/modules/push/push.routes.js`
- `backend/src/modules/push/push.service.js`
- `backend/src/modules/push/pushJobs.service.js`
- `backend/tests/push.test.js`

### Novos arquivos — frontend e documentação (14)

- `frontend/LAYOUT.md`
- `frontend/public/service-worker.js`
- `frontend/src/components/layout/GlobalSearch.jsx`
- `frontend/src/components/layout/MoreMenu.jsx`
- `frontend/src/components/layout/NewActionButton.jsx`
- `frontend/src/pages/dashboard/AttentionPanel.jsx`
- `frontend/src/pages/more/MorePage.jsx`
- `frontend/src/pages/people/PeopleAreaPage.jsx`
- `frontend/src/pages/people/PersonBillingPage.jsx`
- `frontend/src/pages/people/PersonTabs.jsx`
- `frontend/src/pages/settings/PushNotificationsSettings.jsx`
- `frontend/src/pages/settings/SettingsImportPage.jsx`
- `frontend/src/pages/transactions/ExportPage.jsx`
- `frontend/src/pages/transactions/TransactionsPage.jsx`

### Novo arquivo — raiz (1)

- `CHANGELOG.md`

---

## 10. Validação técnica

- `npm test`: 88 testes aprovados (88/88). A execução ocorreu antes da última alteração, que foi somente CSS.
- `npm run build`: concluído sem erro após a alteração de CSS.
- `git diff --check`: aprovado.
- Inspeção responsiva em 390px: abas e páginas continuaram roláveis, sem rolagem horizontal indesejada do documento.
- Inspeção em desktop: barras de rolagem ocultas visualmente.

### Limitação observada

Durante uma inspeção local, a rota de Compras retornou erros HTTP 500 da API, impedindo a conferência dos dados dessa tela naquele momento. Os testes e o build não substituem uma validação funcional completa em produção.

---

## 11. Arquivos e funcionalidades não alterados

- `tools/importar_planilhas.py` não foi modificado.
- As alterações de interface não representam, por si só, mudanças nos cálculos financeiros.
- As rotas direta e pública do Portal continuam no código, embora a aba tenha sido removida da navegação de Pessoas.
- Segredos de ambiente não são registrados neste changelog.

---

## 12. Antes da publicação

1. Testar os fluxos de Compras, pagamentos e recebimentos.
2. Conferir as conexões entre Veículos, Dinheiro e Cartões.
3. Testar as novas abas de Pessoas.
4. Testar a ativação e o recebimento de Web Push em dispositivos compatíveis.
5. Configurar a chamada externa dos jobs no ambiente de implantação.
6. Investigar o erro HTTP 500 observado na rota de Compras.
7. Reexecutar testes e build após futuras alterações.

---

## 13. Registro da versão

**Versão:** 2.0
**Commit-base:** `b696afe`
**Status:** Aguardando revisão e commit.

Este documento registra as alterações identificadas no worktree durante a preparação da versão 2.0. Não representa uma garantia de que todos os fluxos foram testados em produção.
