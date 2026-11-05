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

O Caderno de Contas pode ser publicado em um servidor e acessado pela internet pelo endereço do provedor ou por um domínio próprio. Docker não é necessário para o desenvolvimento local; o repositório também inclui uma configuração Docker Compose como opção para publicação.

### Publicação com Docker Compose

Para usar essa opção, o ambiente de hospedagem precisa oferecer Docker com Docker Compose. Também é necessário configurar um banco de dados MongoDB acessível pela aplicação.

### Configuração

1. Obtenha o código do projeto no servidor de hospedagem.
2. Copie `.env.example` para `.env`.
3. Configure `MONGODB_URI`, `JWT_SECRET` e `ADMIN_EMAIL`. Defina `FRONTEND_URL` com o endereço público da instalação.
4. Inicie a aplicação:

   ```bash
   docker compose up --build -d
   ```

A aplicação é disponibilizada na porta `8080` do container. Configure a hospedagem ou o proxy para encaminhar o tráfego, associar o domínio desejado e habilitar HTTPS. Consulte a documentação do provedor para os passos específicos de publicação.

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
