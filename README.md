# OEA — Internationali Negotia · Model UN

Simulador educacional da Assembleia Geral da OEA — área de Direitos Humanos,
no formato da Internationali Negotia (Modelo Internacional do Brasil). Os
alunos atuam como delegações, redigem DPOs, resoluções e emendas conforme as
regras de procedimento. Cuba é delegação privilegiada (postura: *outsider
crítico*).

- `index.html` — interface completa do aluno (chat, DPO, resolução, votação, jornal, mapa)
- `netlify/functions/proxy.mjs` — proxy server-side para a Anthropic
- `netlify.toml` — config de deploy + headers de segurança

O painel do professor ("Mesa Diretora") é embutido no `index.html` — aparece
automaticamente quando o Firebase Realtime Database tem dados na sessão.

## Arquitetura

- **Frontend estático** (HTML/JS na raiz).
- **API da Anthropic** chamada por uma Netlify Function — a chave fica em env
  var no painel do Netlify, **nunca no navegador do aluno**.
- **Firebase Realtime Database** sincroniza fase da sessão, foco, timer,
  boletins do professor e documentos submetidos pelos alunos, em
  `sessions/{SESSION_ID}/`.
- Session ID vem de `?session=...` na URL (default: `oea-demo`).

## Deploy no Netlify

### Passo 1 — Conectar o repositório

1. Netlify → **Add new site → Import from Git** → escolha este repositório.
2. **Build settings**: deixar em branco (o `netlify.toml` cuida disso).
   - Build command: *(vazio)*
   - Publish directory: `.` (raiz)
3. **Deploy**.

### Passo 2 — Configurar a env var da Anthropic

Em **Site settings → Environment variables → Add a variable**:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` |

Recomendamos uma chave dedicada com **limite de gasto** em
[console.anthropic.com](https://console.anthropic.com/) → Settings → Limits.

Após criar a variável, **trigger deploy** (o Netlify só lê env vars em builds
novos).

### Passo 3 — Autorizar o domínio no Firebase

No console do Firebase (projeto **oea-model-un-225f1**), em
**Authentication → Settings → Authorized domains**, adicione:

- `<seu-site>.netlify.app`
- Domínio custom, se for usar

Sem isso, o Realtime Database recusa conexões da nova URL.

### Passo 4 — Regras do Realtime Database

**Imprescindível antes de usar com alunos reais.** Sem regras, qualquer
pessoa com a URL do banco lê/escreve em qualquer sessão.

No console → **Realtime Database → Rules**, mínimo:

```json
{
  "rules": {
    "sessions": {
      "$sid": {
        ".read": true,
        ".write": true,
        "documents": {
          "$id": {
            ".validate": "newData.hasChildren(['type','country','content']) && newData.child('content').isString() && newData.child('content').val().length < 20000"
          }
        }
      }
    }
  }
}
```

Para um controle real (impedir que aluno A escreva sobre aluno B), habilite
Anonymous Auth e troque `.write` por regras baseadas em `auth.uid`.

## Desenvolvimento local

A Function não roda com `python -m http.server` ou similar — precisa do
Netlify CLI:

```bash
npm install -g netlify-cli
netlify login
netlify link
netlify env:set ANTHROPIC_API_KEY sk-ant-...
netlify dev   # sobe HTML + Function em http://localhost:8888
```

Para testar com uma sessão específica: `http://localhost:8888/?session=turma-2025-A`.

## Notas de segurança aplicadas

- **Headers HTTP** via `netlify.toml`: CSP, X-Frame-Options=DENY, nosniff,
  Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy.
- **CSP em `<meta>`** dentro do HTML como defesa em camadas.
- **Chave da Anthropic** vive só na env var do Netlify; o proxy valida modelo
  contra whitelist (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) e trunca payloads.
- Todo dado dinâmico (input do aluno, resposta da IA, JSON do voto, JSON do
  jornal, boletins da Mesa, tooltip do mapa) é renderizado via `textContent`
  ou passa por `esc()` antes de virar HTML. Fecha o caminho de prompt
  injection → XSS e injeção via Firebase.
- Inline handlers `onclick=` permitidos pela CSP (`'unsafe-inline'`) — eles
  ainda existem em ~46 lugares; substituir todos exigiria refator amplo, e
  como apontam pra funções fixas, não são vetor de injeção.

## Schema do Realtime Database

```
sessions/{SID}/
  meta = { phase, topic, focus }       # controlado pela Mesa Diretora
  news/{id} = { source, type, headline, body, publishedAt }
  timer = { running, startedAt, duration, remaining }
  documents/{id} = { type, country, delegate, content, sponsors?, signatories?, submittedAt }
  delegates/{cc} = { student, present, lastSeen }
```
