# PROJECT.md — Desafio Full Stack (NewSun Energy)

Este documento descreve **como executar o projeto** e **o que foi implementado** para cumprir o desafio.

---

## Sumário

- [1. Visão geral](#1-visão-geral)
- [2. Tecnologias](#2-tecnologias)
- [3. Como executar localmente](#3-como-executar-localmente)
  - [3.1. Subir o MySQL (Docker)](#31-subir-o-mysql-docker)
  - [3.2. Variáveis de ambiente](#32-variáveis-de-ambiente)
  - [3.3. Backend](#33-backend)
  - [3.4. Frontend](#34-frontend)
- [4. Como testar](#4-como-testar)
- [5. Endpoints implementados](#5-endpoints-implementados)
- [6. Arquitetura do projeto](#6-arquitetura-do-projeto)
- [7. Troubleshooting](#7-troubleshooting)
- [8. Entrega do desafio](#8-entrega-do-desafio)

---

## 1. Visão geral

O fluxo implementado atende ao enunciado do desafio:

1. O usuário acessa **`/simular`**, preenche **nome, e-mail e telefone**, e envia **1 ou mais PDFs** de contas de energia.
2. O **backend** recebe os PDFs via `multipart/form-data`.
3. Para cada PDF, o backend realiza um `POST` no serviço interno **Magic PDF** para decodificação.
4. O retorno do Magic PDF é **mapeado** para o domínio:
   - `Lead` (cadastro do usuário)
   - `Unidade` (unidade consumidora)
   - `Consumo` (histórico mensal)
5. O backend persiste os dados no **MySQL** via **Prisma**.
6. O usuário acessa **`/listagem`** para consultar as simulações registradas (com filtros e paginação via backend).

---

## 2. Tecnologias

### Backend

- Node.js + TypeScript
- Express
- Prisma ORM (com driver adapter `@prisma/adapter-mariadb`)
- MySQL (Docker)
- Multer (upload em memória)
- Zod (validação)
- Axios + form-data (integração com Magic PDF)

### Frontend

- Next.js (React)
- Chakra UI
- Upload de PDFs com suporte a múltiplos arquivos e drag-and-drop
- Formatação de telefone BR no input

---

## 3. Como executar localmente

> A execução abaixo assume dois diretórios: um do **backend** e outro do **frontend**.  
> Se o seu repositório estiver em outra estrutura, execute os comandos no diretório correto do `package.json` correspondente.

### 3.1. Subir o MySQL (Docker)

Na raiz do projeto (onde está o `docker-compose.yml`):

```bash
docker compose up -d
```

Conferir se o container subiu:

```bash
docker ps
```

Parar containers:

```bash
docker compose down
```

Parar e remover volume (zera o banco):

```bash
docker compose down -v
```

---

### 3.2. Variáveis de ambiente

#### Backend — `.env`

Crie/ajuste o arquivo `.env` no diretório do backend com (ajuste credenciais/host/porta se necessário):

```env
PORT=3333

# ✅ MySQL (Docker Compose)
DATABASE_URL="mysql://root:root@localhost:3306/newsun"

# ✅ Endpoint do serviço de decodificação de PDF (Magic PDF)
MAGIC_PDF_URL="https://magic-pdf.solarium.newsun.energy/v1/magic-pdf"

# ✅ Frontend (CORS)
CORS_ORIGIN="http://localhost:3000"
```

#### Frontend — `.env.local`

Crie/ajuste no diretório do frontend:

```env
NEXT_PUBLIC_API_URL="http://localhost:3333"
```

---

### 3.3. Backend

No diretório do backend:

```bash
npm i
npx prisma migrate dev
npm run dev
```

O backend sobe em:

- `http://localhost:3333`

---

### 3.4. Frontend

No diretório do frontend:

```bash
npm i
npm run dev
```

O frontend sobe em:

- `http://localhost:3000`

Rotas esperadas:

- `http://localhost:3000/simular`
- `http://localhost:3000/listagem`

---

## 4. Como testar

### 4.1. Teste via navegador

1. Abra `http://localhost:3000/simular`
2. Preencha nome, e-mail e telefone
3. Envie **1 ou mais PDFs**
4. Após sucesso, acesse `http://localhost:3000/listagem` para ver os registros

### 4.2. Teste via cURL

Exemplo de requisição para criar simulação:

```bash
curl -X POST "http://localhost:3333/simulacoes"   -F "nomeCompleto=João da Silva"   -F "email=joao@email.com"   -F "telefone=(11) 99999-9999"   -F "file=@./conta1.pdf"   -F "file=@./conta2.pdf"
```

---

## 5. Endpoints implementados

### `POST /simulacoes`

Cria um novo lead e persiste unidades + histórico.

- **Content-Type**: `multipart/form-data`
- Campos:
  - `nomeCompleto` (string)
  - `email` (string)
  - `telefone` (string)
  - `file` (1..N PDFs) **ou** `files` (1..N PDFs)

Respostas:

- `201` → retorna o lead criado com `unidades` e `historicoDeConsumoEmKWH`
- `400` → validação/entrada inválida (ex.: nenhum arquivo, duplicado no request, Zod)
- `409` → conflito de unicidade (e-mail já existe / código de unidade já existe)
- `422` → nenhuma unidade decodificada
- `500` → erro interno

---

### `GET /simulacoes`

Lista simulações com filtros e paginação.

Query params:

- `q` → busca em `nomeCompleto` e `email` (contains)
- `codigoDaUnidadeConsumidora` → filtra por unidades (contains)
- `modeloFasico` → `monofasico | bifasico | trifasico`
- `enquadramento` → `AX | B1 | B2 | B3`
- `page` (default 1)
- `pageSize` (default 10, máx 50)

Retorno:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 10,
  "totalPages": 1
}
```

---

### `GET /simulacoes/:id`

Busca uma simulação pelo `id` do lead.

- `404` se não encontrado
- `200` retorna lead + unidades + histórico

---

## 6. Arquitetura do projeto

Estrutura do repositório:

```txt
.
├─ backend/
│  ├─ prisma/
│  │  ├─ migrations/
│  │  │  └─ 20260216170135_init/
│  │  │     └─ migration_lock.toml
│  │  └─ schema.prisma
│  ├─ src/
│  │  ├─ server.ts
│  │  ├─ prisma.ts
│  │  ├─ magicPdf.ts
│  │  └─ mappers.ts
│  ├─ .env
│  ├─ .gitignore
│  ├─ package.json
│  ├─ package-lock.json
│  ├─ prisma.config.ts
│  └─ tsconfig.json
│
├─ frontend/
│  ├─ public/
│  ├─ src/
│  │  ├─ app/
│  │  │  ├─ listagem/
│  │  │  │  └─ page.tsx
│  │  │  ├─ simular/
│  │  │  │  └─ page.tsx
│  │  │  ├─ favicon.ico
│  │  │  ├─ globals.css
│  │  │  ├─ layout.tsx
│  │  │  ├─ page.module.css
│  │  │  └─ page.tsx
│  │  ├─ components/
│  │  │  └─ layout/
│  │  │     └─ Header.tsx
│  │  └─ ui/
│  │     ├─ color-mode.tsx
│  │     ├─ provider.tsx
│  │     ├─ toaster.tsx
│  │     └─ tooltip.tsx
│  ├─ .env.local
│  ├─ .gitignore
│  ├─ eslint.config.mjs
│  ├─ next-env.d.ts
│  ├─ next.config.ts
│  ├─ package.json
│  ├─ package-lock.json
│  └─ tsconfig.json
│
├─ conta-de-energia/              # PDFs de exemplo (para testes locais)
├─ docker-compose.yml             # MySQL local (container newsun-mysql)
├─ PROJECT.md
└─ README.md
```

---

## 7. Troubleshooting

### 7.1. MySQL não sobe / sem conexão

- Verifique containers:
  ```bash
  docker ps
  ```
- Recrie ambiente:
  ```bash
  docker compose down
  docker compose up -d
  ```
- Confirme `DATABASE_URL`:
  ```env
  DATABASE_URL="mysql://root:root@localhost:3306/newsun"
  ```

### 7.2. `pool timeout` / `failed to retrieve a connection`

Normalmente indica banco inacessível.

- confira container rodando
- confira porta `3306`
- confira credenciais `root/root`
- reinicie o MySQL

### 7.3. Magic PDF falhando

- confira `MAGIC_PDF_URL` no `.env`
- teste com outro PDF (arquivo inválido pode retornar payload inesperado)
- o backend retorna erro caso não consiga mapear unidade/histórico

---

## 8. Entrega do desafio

Processo:

1. Fazer o fork do repositório do desafio
2. Criar este `PROJECT.md`
3. Finalizar a implementação
4. Abrir Pull Request
