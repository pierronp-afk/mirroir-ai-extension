/**
 * MirrorAI - Background Service Worker
 * Les appels Gemini passent par le proxy Vercel → la clé API n'est JAMAIS dans l'extension
 */

console.log('🚀 MirrorAI Background Worker started');

const CONFIG = {
  // URL du proxy Vercel — NE CHANGE PAS si tu utilises le nom mirrorai-proxy sur Vercel
  PROXY_URL: 'https://mirroir-ai-proxy.vercel.app/api/gemini',
  // Secret partagé entre l'extension et le proxy — doit être identique à la variable EXTENSION_SECRET sur Vercel
  EXTENSION_SECRET: 'mirrorai-2024-secret',
  CACHE_TTL_MS: 15 * 60 * 1000,
};

const SYSTEM_PROMPT = `Tu es MirrorAI, un analyste financier senior spécialisé dans la gestion de portefeuille retail.

IDENTITÉ :
- Tu analyses des portefeuilles d'investisseurs particuliers (pas institutionnels)
- Tu parles TOUJOURS en français, même si le prompt est en anglais
- Ton style : direct, chiffré, actionnable. Pas de jargon inutile.

PRINCIPES D'ANALYSE :
1. Priorité au risque de perte en capital avant le potentiel de gain
2. La concentration (>15% sur un seul titre) est toujours signalée
3. Tu croises prix actuel + poids dans le portefeuille
4. Chaque conseil inclut un niveau de conviction (0-100) et une urgence

FORMAT DE RÉPONSE :
- Toujours du JSON valide, sans markdown autour (pas de \`\`\`json)
- Champs texte OBLIGATOIREMENT en français
- Chiffres précis (pas "environ" ou "autour de")
- Jamais de disclaimer juridique dans les champs JSON`;

function buildPortfolioPrompt(portfolio) {
  const totalValue = portfolio.reduce((sum, s) => sum + (s.price * s.shares), 0);
  const portfolioDetail = portfolio
    .map(s => {
      const value = s.price * s.shares;
      const weight = totalValue > 0 ? (value / totalValue * 100).toFixed(1) : 0;
      const gain = s.avgPrice > 0 ? (((s.price - s.avgPrice) / s.avgPrice) * 100).toFixed(2) : 0;
      return `- ${s.symbol} (${s.name}): ${s.shares} actions @ ${s.avgPrice.toFixed(2)}€ PRU (Prix actuel: ${s.price.toFixed(2)}€, Gain: ${gain}%, Poids: ${weight}%)`;
    })
    .join('\n');

  return `${SYSTEM_PROMPT}

MISSION : Analyse ce portefeuille et génère une analyse JSON stricte.

PORTFOLIO (Valeur totale: ${totalValue.toFixed(2)}€) :
${portfolioDetail}

FORMAT JSON STRICT (sans markdown) :
{
  "health": "string - état global court (ex: Surexposé Tech)",
  "healthDesc": "string - 2-3 phrases sur risques et atouts",
  "signals": [
    {
      "symbol": "string",
      "name": "string",
      "advice": "Acheter|Renforcer|Conserver|Alléger|Vendre",
      "confidence": 0-100,
      "targetPrice": number,
      "stopLoss": number,
      "urgency": "HAUTE|MODÉRÉE|FAIBLE",
      "color": "rose|emerald|blue",
      "simpleReasoning": "string - explication simple en français",
      "action": "string - action exacte avec nombre d'actions",
      "threeMonthOutlook": "string - perspective 3 mois",
      "rsi": 0-100,
      "idealWeight": number,
      "sentiment": "BULLISH|BEARISH|NEUTRAL"
    }
  ]
}`;
}

function buildQuestionPrompt(question, portfolioContext) {
  return `${SYSTEM_PROMPT}

QUESTION UTILISATEUR : ${question}

${portfolioContext ? `CONTEXTE PORTFOLIO : ${portfolioContext}` : ''}

INSTRUCTIONS :
- Réponds de manière technique et sérieuse en français
- Si la question porte sur des opportunités, propose 2-3 titres concrets avec justification
- Sois OBJECTIF et ACTIONNABLE`;
}

async function callGeminiViaProxy(prompt, retries = 3) {
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`🔄 Appel proxy Vercel (tentative ${attempt + 1}/${retries})`);

      const response = await fetch(CONFIG.PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mirrorai-secret': CONFIG.EXTENSION_SECRET,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Proxy error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Réponse vide de Gemini');

      console.log('✅ Succès via proxy');
      return text;
    } catch (error) {
      console.error(`❌ Erreur tentative ${attempt + 1}:`, error);
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      } else {
        throw error;
      }
    }
  }
}

async function getCache(key) {
  const { cache } = await chrome.storage.local.get('cache');
  if (!cache?.[key]) return null;
  if (Date.now() - cache[key].timestamp > CONFIG.CACHE_TTL_MS) return null;
  console.log(`✅ Cache hit: ${key}`);
  return cache[key].data;
}

async function setCache(key, data) {
  const { cache = {} } = await chrome.storage.local.get('cache');
  cache[key] = { data, timestamp: Date.now() };
  await chrome.storage.local.set({ cache });
}

async function handleAnalyze(portfolio) {
  const cacheKey = `analysis_${portfolio.map(s => s.symbol).sort().join(',')}`;
  const cached = await getCache(cacheKey);
  if (cached) return { analysis: cached, cached: true };

  const responseText = await callGeminiViaProxy(buildPortfolioPrompt(portfolio));

  let analysis;
  try {
    analysis = JSON.parse(responseText);
  } catch {
    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Impossible de parser la réponse JSON');
    analysis = JSON.parse(match[0]);
  }

  await setCache(cacheKey, analysis);
  return { analysis, cached: false };
}

async function handleQuestion(question) {
  const stored = await chrome.storage.local.get(['portfolio', 'cache']);
  let portfolioContext = '';

  if (stored.portfolio) {
    portfolioContext = `Portefeuille actuel: ${stored.portfolio.map(s => s.symbol).join(', ')}`;
    const cacheKey = `analysis_${stored.portfolio.map(s => s.symbol).sort().join(',')}`;
    if (stored.cache?.[cacheKey]) {
      portfolioContext += `\nDernière analyse: ${stored.cache[cacheKey].data.health}`;
    }
  }

  const answer = await callGeminiViaProxy(buildQuestionPrompt(question, portfolioContext));
  return { answer };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Message reçu:', request.action);

  if (request.action === 'analyze') {
    handleAnalyze(request.portfolio)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (request.action === 'ask') {
    handleQuestion(request.question)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  sendResponse({ error: 'Action inconnue' });
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: 'https://www.google.com/finance' });
  }
});
