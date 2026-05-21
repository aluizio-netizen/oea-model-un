# OEA Model UN

Simulador educacional da Assembleia Geral da OEA. Os alunos atuam como
delegações e conversam com um assistente de IA; o professor acompanha em
tempo real por um painel separado.

- `index.html` — interface do aluno
- `professor.html` — painel do professor
- `netlify/functions/claude.mjs` — proxy server-side para a Anthropic
- `netlify.toml` — config de deploy + headers de segurança

## Arquitetura

- **Frontend estático** (HTML/JS na raiz).
- **Firebase Realtime Database** sincroniza atividades de aluno → painel do
  professor, sob `oea_rooms/{COD_SALA}/{players|chat|votes}`.
- **API da Anthropic** chamada por uma Netlify Function — a chave fica numa
  variável de ambiente no painel do Netlify, **nunca no navegador do aluno**.

## Deploy no Netlify

### Passo 1 — Conectar o repositório

1. Netlify → **Add new site → Import from Git** → escolha este repositório.
2. **Build settings**: deixar em branco (o `netlify.toml` cuida disso).
   - Build command: *(vazio)*
   - Publish directory: `.` (raiz)
3. **Deploy**.

### Passo 2 — Configurar a env var da Anthropic

No painel do Netlify, em **Site settings → Environment variables → Add a
variable**, crie:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` (sua chave) |

Recomendamos uma chave **dedicada a este projeto**, com **limite de gasto
configurado** em [console.anthropic.com](https://console.anthropic.com/) →
Settings → Limits.

Após criar a variável, faça um **redeploy** (o Netlify só carrega env vars
em builds novos).

### Passo 3 — Autorizar o domínio no Firebase

No console do Firebase, em **Authentication → Settings → Authorized domains**,
adicione:

- `<seu-site>.netlify.app`
- Domínio custom, se for usar

Sem isso, a Realtime Database recusa conexões da nova URL.

### Passo 4 — Configurar as regras do Realtime Database

**Imprescindível antes de usar com alunos reais.** Sem regras, qualquer
pessoa com a URL do banco lê/escreve em qualquer sala.

No console do Firebase → **Realtime Database → Rules**, mínimo:

```json
{
  "rules": {
    "oea_rooms": {
      "$room": {
        ".read": true,
        ".write": true,
        "players": {
          "$uid": {
            ".validate": "newData.hasChildren(['name'])"
          }
        },
        "chat": {
          "$msg": {
            ".validate": "newData.hasChildren(['type','uid','text']) && newData.child('text').isString() && newData.child('text').val().length < 4000"
          }
        }
      }
    }
  }
}
```

Para impedir que aluno A se passe por aluno B, habilite Anonymous Auth e
troque `.write` por `auth != null && newData.child('uid').val() === auth.uid`.

### Passo 5 — Trocar a senha do painel do professor

A senha está armazenada como hash SHA-256 em `professor.html`
(constante `SENHA_HASH`). O valor atual corresponde a `professor2025`.
**Troque antes de distribuir.**

Para gerar um hash novo, rode no console do navegador:

```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode('SUA_SENHA_NOVA'))
  .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')));
```

Cole o resultado em `SENHA_HASH` e faça commit.

> Este portão é só um detrente — o controle real de acesso aos dados depende
> das regras do Realtime Database (Passo 4).

## Desenvolvimento local

A Function não roda com `python -m http.server` ou similar — precisa do
Netlify CLI:

```bash
npm install -g netlify-cli
netlify login
netlify link            # conecta o diretório ao site
netlify env:set ANTHROPIC_API_KEY sk-ant-...   # ou use o painel
netlify dev             # sobe HTML + Function em http://localhost:8888
```

## Notas de segurança aplicadas

- **Headers HTTP** (via `netlify.toml`): CSP, X-Frame-Options=DENY,
  X-Content-Type-Options=nosniff, Referrer-Policy, Permissions-Policy.
- **CSP em `<meta>`** dentro dos HTMLs como defesa em camadas / fallback.
- **SRI** (`integrity=...`) no `<script>` do jsPDF.
- **Chave da Anthropic** vive só na env var do Netlify; passa pelo proxy
  com validação de tamanho e do `model`.
- Todo dado vindo do usuário / do Firebase / da IA passa por `esc()` ou é
  inserido via `textContent` antes de virar HTML — fechando o caminho de
  XSS via prompt injection ou via banco.
- Identidade do aluno usa **UID gerado por `crypto.getRandomValues`** em
  vez do nome — assim renomear não duplica nem sobrescreve registros.
- Código de sala normalizado em maiúsculas (`A-Z 0-9 _ -`) nas duas pontas.
- Senha do professor virou hash SHA-256 com comparação em tempo constante.
- Rate-limit simples no botão de envio do chat (≥ 800 ms entre chamadas).

## Esquema da Realtime Database

```
oea_rooms/{ROOM}/
  players/{uid} = { name, charId, charName, flag, region, online, joinedAt }
  chat/{key}    = { type: 'chat'|'resolution', uid, senderName, charName,
                    flag, text, resType?, resTitle?, ts }
  votes/{key}   = { id, resTitle, resType, proposedBy, flag,
                    results: {favor, contra, abstencao},
                    voters: {}, approved, ts }
```
