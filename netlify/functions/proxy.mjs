// Proxy server-side para a Anthropic Messages API.
// Mantém a chave no Netlify (env var ANTHROPIC_API_KEY) em vez de no navegador
// do aluno. Modelo, max_tokens e tamanhos de payload são limitados aqui para
// controlar custo.

// Whitelist de modelos. Cliente que pedir modelo fora desta lista cai no DEFAULT.
const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]);
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_HARD_LIMIT = 4000;
const MAX_MESSAGES = 80;
const MAX_MSG_CHARS = 6000;
const MAX_SYSTEM_CHARS = 8000;

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'ANTHROPIC_API_KEY não configurada no Netlify.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'JSON inválido.' });
  }

  const model = typeof body.model === 'string' && ALLOWED_MODELS.has(body.model)
    ? body.model
    : DEFAULT_MODEL;

  const system = typeof body.system === 'string'
    ? body.system.slice(0, MAX_SYSTEM_CHARS)
    : '';

  const maxTokensRequested = parseInt(body.max_tokens, 10);
  const max_tokens = Number.isFinite(maxTokensRequested)
    ? Math.min(Math.max(maxTokensRequested, 1), MAX_TOKENS_HARD_LIMIT)
    : 800;

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json(400, { error: 'messages obrigatório.' });
  }
  if (body.messages.length > MAX_MESSAGES) {
    return json(400, { error: 'messages excede o limite (' + MAX_MESSAGES + ').' });
  }

  const messages = body.messages.map((m) => ({
    role: m && m.role === 'assistant' ? 'assistant' : 'user',
    content: String((m && m.content) || '').slice(0, MAX_MSG_CHARS),
  }));

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ model, max_tokens, system, messages }),
    });

    const upstreamText = await upstream.text();

    // Se a Anthropic respondeu 4xx/5xx, repassa o status mas tira detalhes
    // que possam vazar informação sobre a chave/conta.
    if (!upstream.ok) {
      let detail = '';
      try {
        const parsed = JSON.parse(upstreamText);
        detail = parsed?.error?.message || '';
      } catch { /* texto puro */ }
      return json(upstream.status, {
        error: 'Upstream ' + upstream.status,
        detail: String(detail).slice(0, 200),
      });
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: upstreamText,
    };
  } catch (e) {
    return json(502, { error: 'Upstream indisponível.' });
  }
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function corsHeaders() {
  // Mesma origem em produção; o header sai pra cobrir preflights se você
  // hospedar o front em outro domínio. Restrinja se precisar.
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
