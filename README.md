<div align="center">

# Caderno de Contas

**Aplicação full stack de controle financeiro: parcelas, extratos, importação de planilhas e visão por pessoa.**

[![Demo](https://img.shields.io/badge/demo-online-0f766e?style=for-the-badge&logo=render&logoColor=white)](https://sistema-financeiro-4ing.onrender.com/)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)

</div>

---

## Sobre

O projeto nasceu de uma planilha de controle financeiro e virou um sistema completo: o que antes dependia de abas, fórmulas e cópia manual agora tem login, regras de negócio, histórico e uma interface feita para o dia a dia.

## Demo

🔗 **https://sistema-financeiro-4ing.onrender.com/**

> O back-end está em hospedagem gratuita, então o primeiro acesso pode levar alguns segundos para "acordar". <!-- remova se não for o seu caso -->

## Screenshots

| Dashboard | Parcelas |
| :--: | :--: |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Parcelas](docs/screenshots/parcelas.png) |
| **Importação** | **Perfil da pessoa** |
| ![Importação](docs/screenshots/importacao.png) | ![Perfil](docs/screenshots/perfil.png) |

## Funcionalidades

- Login com **Google** e autenticação por **JWT**.
- Controle de parcelas de cartões e contas fixas (luz, água, etc.), com marcação de pagas e pendentes, inclusive em lote.
- Visão por pessoa: resumo, extrato, planilha e cobrança.
- Importação de planilhas e faturas.
- Interface responsiva e com instalação como app (PWA).

<!-- ajuste a lista ao que está realmente no ar -->

## Arquitetura

```mermaid
flowchart LR
    U[Usuário] --> F[Front-end React]
    F -->|REST + JWT| A[API Node.js / Express]
    A --> V[Validação Zod]
    A --> D[(MongoDB / Mongoose)]
    F -.->|login| G[Google OAuth]
    G -.-> A
```

Front-end e back-end são **separados**, comunicando-se apenas por uma API REST. Isso permite evoluir, testar e hospedar cada parte de forma independente.

## Stack

| Área | Tecnologias |
| :-- | :-- |
| Front-end | React · JavaScript |
| Back-end | Node.js · Express |
| Banco de dados | MongoDB com Mongoose |
| Autenticação | JWT · Google OAuth |
| Validação | Zod |
| Hospedagem | Render |

## Segurança

| Medida | Como foi aplicada |
| :-- | :-- |
| Senhas | Armazenadas com hash (bcrypt) |
| Sessão | Tokens JWT |
| Entrada de dados | Validação com Zod em todas as rotas |
| Cabeçalhos HTTP | Helmet |
| Origens permitidas | CORS restrito |
| Abuso de requisições | Rate limiting |
| Segredos | Variáveis de ambiente, fora do repositório |

## Como rodar localmente

**Pré-requisitos:** Node.js 18+ e uma instância do MongoDB (local ou Atlas).

```bash
git clone https://github.com/biancamx/sistema-financeiro.git
cd sistema-financeiro
```

**Back-end**

```bash
cd backend            # ajuste ao nome real da pasta
npm install
cp .env.example .env
npm run dev
```

**Front-end**

```bash
cd frontend           # ajuste ao nome real da pasta
npm install
npm run dev
```

**Variáveis de ambiente** (`backend/.env`), ajuste aos nomes reais:

```env
PORT=3000
MONGODB_URI=
JWT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
CLIENT_URL=http://localhost:5173
```

## Roadmap

- [ ] Migração para PostgreSQL com Prisma
- [ ] Containerização com Docker
- [ ] Testes automatizados (API e interface)
- [ ] Pipeline de CI/CD
- [ ] Relatórios e gráficos por período

## Autora

**Maria Bianca Moura** · [LinkedIn](https://www.linkedin.com/in/SEU-LINKEDIN/) · [GitHub](https://github.com/biancamx)
