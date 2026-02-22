/**
 * MirrorAI Content Script v3
 * Compatible Google Finance : watchlist (/finance) ET portfolio (/finance/portfolio/...)
 */

console.log('🎯 MirrorAI v3 loaded — URL:', window.location.href);

// ─── Détection type de page ─────────────────────────────────────────────────
const PAGE = {
  isPortfolio: window.location.pathname.includes('/finance/portfolio'),
  isWatchlist: !window.location.pathname.includes('/finance/portfolio'),
};

// ─── Extraction des titres ──────────────────────────────────────────────────
function extractPortfolio() {
  const portfolio = [];
  const seen = new Set();

  // Stratégie A : liens vers des pages de cotation individuelle
  // Sur Google Finance, chaque titre est un lien de la forme /finance/quote/AAPL:NASDAQ
  document.querySelectorAll('a[href*="/finance/quote/"]').forEach(link => {
    const href = link.getAttribute('href') || '';
    // Extrait le symbole depuis l'URL /finance/quote/SYMBOL:EXCHANGE
    const match = href.match(/\/finance\/quote\/([^:/?]+)/);
    if (!match) return;

    const symbol = match[1].trim();
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);

    // Nom affiché dans le lien ou attribut aria-label
    const name = link.getAttribute('aria-label') || link.textContent.trim() || symbol;

    // Cherche un prix dans les éléments voisins
    const parent = link.closest('tr') || link.closest('[data-row]') || link.parentElement?.parentElement;
    let price = 0;
    if (parent) {
      const texts = parent.innerText.split(/\s+/);
      for (const t of texts) {
        const n = parseFloat(t.replace(',', '.').replace(/[^0-9.]/g, ''));
        if (n > 0.5 && n < 100000) { price = n; break; }
      }
    }

    portfolio.push({ symbol, name: name.split('\n')[0].trim(), price: price || 1, change: 0, changePercent: 0, shares: 0, avgPrice: 0 });
  });

  // Stratégie B : lignes de tableau (watchlist classique)
  if (portfolio.length === 0) {
    document.querySelectorAll('tbody tr').forEach(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 2) return;

      const symbolEl = cells[0].querySelector('a') || cells[0];
      const symbol = symbolEl.textContent.trim().split('\n')[0].trim();
      if (!symbol || symbol.length > 12 || seen.has(symbol) || /^\d/.test(symbol)) return;
      seen.add(symbol);

      const priceText = cells[2]?.textContent || cells[1]?.textContent || '';
      const price = parseFloat(priceText.replace(/[^0-9.,]/g, '').replace(',', '.')) || 1;

      portfolio.push({ symbol, name: symbol, price, change: 0, changePercent: 0, shares: 0, avgPrice: 0 });
    });
  }

  // Stratégie C : data-symbol (attribut natif Google Finance)
  if (portfolio.length === 0) {
    document.querySelectorAll('[data-symbol]').forEach(el => {
      const symbol = el.getAttribute('data-symbol');
      if (!symbol || seen.has(symbol)) return;
      seen.add(symbol);
      portfolio.push({ symbol, name: symbol, price: 1, change: 0, changePercent: 0, shares: 0, avgPrice: 0 });
    });
  }

  console.log(`📊 MirrorAI — ${portfolio.length} titre(s) trouvé(s):`, portfolio.map(p => p.symbol).join(', '));
  return portfolio;
}

// ─── Point d'injection du bouton ───────────────────────────────────────────
function findInjectPoint() {
  // Sélecteurs par ordre de priorité selon le type de page
  const selectors = PAGE.isPortfolio
    ? [
        // Pages portfolio
        '.Jv0Q5b',          // container nom portfolio
        '.NKnt9e',          // header portfolio
        '[data-target-id]', // section avec id cible
        '.jKMTzb',          // zone titre
        '.bM0Bbd',          // block holdings
        'h1',               // fallback h1
      ]
    : [
        // Pages watchlist
        '.yDlTYb',
        '.e6hBKb',
        'h1',
      ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      console.log('✅ MirrorAI — inject point:', sel);
      return el;
    }
  }

  // Dernier recours : après le premier h1 ou h2 visible
  const headings = document.querySelectorAll('h1, h2');
  for (const h of headings) {
    if (h.textContent.trim().length > 0) {
      console.log('✅ MirrorAI — inject point: heading fallback');
      return h;
    }
  }

  return null;
}

// ─── Injection du bouton ────────────────────────────────────────────────────
let injecting = false;
let injectAttempts = 0;

function injectAnalyzeButton() {
  if (document.getElementById('mirrorai-btn-wrap')) return;
  if (injecting) return;
  if (injectAttempts > 20) {
    // Après 20 tentatives (~40s), on injecte un bouton flottant en fallback
    injectFloatingButton();
    return;
  }

  injecting = true;
  injectAttempts++;

  const target = findInjectPoint();
  if (!target) {
    console.log(`⏳ MirrorAI — tentative ${injectAttempts}/20, réessai dans 2s`);
    injecting = false;
    setTimeout(injectAnalyzeButton, 2000);
    return;
  }

  const wrap = document.createElement('div');
  wrap.id = 'mirrorai-btn-wrap';
  wrap.style.cssText = 'margin:10px 0 6px 0; display:inline-flex; align-items:center; gap:8px;';

  const btn = document.createElement('button');
  btn.id = 'mirrorai-analyze-btn';
  btn.className = 'mirrorai-btn-primary';
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
    Analyser avec MirrorAI
  `;
  btn.addEventListener('click', handleAnalyzeClick);
  wrap.appendChild(btn);

  // Insère après le target
  if (target.parentNode) {
    target.parentNode.insertBefore(wrap, target.nextSibling);
  } else {
    target.appendChild(wrap);
  }

  console.log('✅ MirrorAI — bouton injecté');
  injecting = false;
}

// Bouton flottant si aucun sélecteur ne fonctionne
function injectFloatingButton() {
  if (document.getElementById('mirrorai-btn-wrap')) return;
  const wrap = document.createElement('div');
  wrap.id = 'mirrorai-btn-wrap';
  wrap.style.cssText = 'position:fixed; bottom:24px; right:24px; z-index:99999;';

  const btn = document.createElement('button');
  btn.id = 'mirrorai-analyze-btn';
  btn.className = 'mirrorai-btn-primary';
  btn.style.cssText = 'box-shadow: 0 4px 20px rgba(37,99,235,0.4);';
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
    Analyser avec MirrorAI
  `;
  btn.addEventListener('click', handleAnalyzeClick);
  wrap.appendChild(btn);
  document.body.appendChild(wrap);
  console.log('✅ MirrorAI — bouton flottant injecté (fallback)');
}

// ─── Handler clic Analyser ──────────────────────────────────────────────────
async function handleAnalyzeClick() {
  const btn = document.getElementById('mirrorai-analyze-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  setButtonLoading(btn, true);

  try {
    const portfolio = extractPortfolio();
    if (portfolio.length === 0) {
      alert('❌ Aucun titre détecté sur cette page.\n\nAssure-toi d\'être sur une page Google Finance qui affiche tes titres.');
      setButtonLoading(btn, false);
      return;
    }

    // Récupère les données mémorisées (quantités / PRU)
    const stored = await chrome.storage.local.get('portfolio');
    let enriched;

    if (stored.portfolio?.length > 0) {
      // Fusionne prix actuels + données mémorisées
      enriched = portfolio.map(stock => {
        const mem = stored.portfolio.find(s => s.symbol === stock.symbol);
        return mem
          ? { ...stock, shares: mem.shares, avgPrice: mem.avgPrice }
          : { ...stock, shares: 0, avgPrice: stock.price };
      });

      // Vérifie si de nouveaux titres ont été ajoutés
      const newSymbols = portfolio.filter(s => !stored.portfolio.find(m => m.symbol === s.symbol));
      if (newSymbols.length > 0) {
        const extra = await askForPRU(newSymbols, `Nouveaux titres détectés (${newSymbols.map(s => s.symbol).join(', ')})`);
        enriched = [...enriched.filter(s => !extra.find(e => e.symbol === s.symbol)), ...extra];
      }
    } else {
      enriched = await askForPRU(portfolio, 'Configure ton portfolio');
    }

    await chrome.storage.local.set({ portfolio: enriched });

    // Appel analyse
    chrome.runtime.sendMessage({ action: 'analyze', portfolio: enriched }, response => {
      if (chrome.runtime.lastError) {
        alert(`❌ ${chrome.runtime.lastError.message}`);
      } else if (response?.error) {
        alert(`❌ Erreur proxy: ${response.error}\n\nVérifie que ton proxy Vercel est bien déployé.`);
      } else {
        openSidebar(response.analysis, enriched);
      }
      setButtonLoading(btn, false);
    });

  } catch (err) {
    if (err.message !== 'cancelled') alert(`❌ ${err.message}`);
    setButtonLoading(btn, false);
  }
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<svg class="mirrorai-spinner" width="15" height="15" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg> Analyse en cours...`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> Analyser avec MirrorAI`;
}

// ─── Modal saisie PRU ───────────────────────────────────────────────────────
function askForPRU(portfolio, title = 'Ton portfolio') {
  return new Promise((resolve, reject) => {
    const modal = document.createElement('div');
    modal.className = 'mirrorai-modal-overlay';
    modal.innerHTML = `
      <div class="mirrorai-modal-content">
        <h2>📝 ${title}</h2>
        <p class="mirrorai-modal-subtitle">Saisis tes quantités et prix d'achat moyens (PRU)</p>
        <div class="mirrorai-pru-list">
          ${portfolio.map(s => `
            <div class="mirrorai-pru-row">
              <div class="mirrorai-pru-stock">
                <strong>${s.symbol}</strong>
                <span class="mirrorai-pru-price">Cours actuel : ${s.price > 1 ? s.price.toFixed(2) + ' €' : 'N/A'}</span>
              </div>
              <div class="mirrorai-pru-inputs">
                <div>
                  <label>Quantité</label>
                  <input type="number" id="pru_shares_${s.symbol}" value="1" min="0" step="1" placeholder="ex: 10"/>
                </div>
                <div>
                  <label>PRU (€)</label>
                  <input type="number" id="pru_avg_${s.symbol}" value="${s.price > 1 ? s.price.toFixed(2) : ''}" min="0" step="0.01" placeholder="ex: 145.50"/>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="mirrorai-modal-actions">
          <button id="pru-cancel" class="mirrorai-btn-secondary">Annuler</button>
          <button id="pru-submit" class="mirrorai-btn-primary">Lancer l'analyse →</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('pru-submit').addEventListener('click', () => {
      const enriched = portfolio.map(s => ({
        ...s,
        shares: parseFloat(document.getElementById(`pru_shares_${s.symbol}`)?.value) || 1,
        avgPrice: parseFloat(document.getElementById(`pru_avg_${s.symbol}`)?.value) || s.price,
      }));
      modal.remove();
      resolve(enriched);
    });
    document.getElementById('pru-cancel').addEventListener('click', () => {
      modal.remove();
      reject(new Error('cancelled'));
    });
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); reject(new Error('cancelled')); } });
  });
}

// ─── Sidebar résultats ──────────────────────────────────────────────────────
const ADVICE_COLORS = { Acheter: '#10b981', Renforcer: '#3b82f6', Conserver: '#64748b', Alléger: '#f59e0b', Vendre: '#ef4444' };
const URGENCY_ICONS = { HAUTE: '🔴', 'MODÉRÉE': '🟡', FAIBLE: '🟢' };

function openSidebar(analysis, portfolio) {
  document.getElementById('mirrorai-sidebar')?.remove();

  const totalVal = portfolio.reduce((s, p) => s + (p.price * p.shares), 0);
  const totalGain = portfolio.reduce((s, p) => s + ((p.price - p.avgPrice) * p.shares), 0);

  const sidebar = document.createElement('div');
  sidebar.id = 'mirrorai-sidebar';
  sidebar.className = 'mirrorai-sidebar';
  sidebar.innerHTML = `
    <div class="mirrorai-sidebar-header">
      <div class="mirrorai-sidebar-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
        MirrorAI
      </div>
      <button id="mirrorai-close" class="mirrorai-btn-icon" title="Fermer">✕</button>
    </div>

    <div class="mirrorai-sidebar-content">

      <!-- Récap portfolio -->
      <div class="mirrorai-recap">
        <div class="mirrorai-recap-row">
          <span>Valeur totale</span>
          <strong>${totalVal > 0 ? totalVal.toFixed(2) + ' €' : '—'}</strong>
        </div>
        <div class="mirrorai-recap-row">
          <span>Gain total</span>
          <strong style="color:${totalGain >= 0 ? '#10b981' : '#ef4444'}">${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(2)} €</strong>
        </div>
        <div class="mirrorai-recap-row">
          <span>Titres analysés</span>
          <strong>${portfolio.length}</strong>
        </div>
      </div>

      <!-- Santé globale -->
      <div class="mirrorai-health">
        <span class="mirrorai-health-badge">${analysis.health || '—'}</span>
        <p>${analysis.healthDesc || ''}</p>
      </div>

      <!-- Signaux par titre -->
      <h4 style="margin:16px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.5px; opacity:.6;">Signaux par titre</h4>
      ${(analysis.signals || []).map(s => {
        const port = portfolio.find(p => p.symbol === s.symbol) || {};
        const gainTitre = port.shares > 0 ? ((s.targetPrice - port.avgPrice) / port.avgPrice * 100).toFixed(1) : null;
        return `
        <div class="mirrorai-signal-card">
          <div class="mirrorai-signal-header">
            <div>
              <strong>${s.name || s.symbol}</strong>
              <span style="font-size:11px; opacity:.6; margin-left:6px;">${s.symbol}</span>
            </div>
            <span class="mirrorai-badge" style="background:${ADVICE_COLORS[s.advice] || '#64748b'}">${s.advice}</span>
          </div>

          <div class="mirrorai-signal-meta">
            ${URGENCY_ICONS[s.urgency] || ''} Urgence ${s.urgency || '—'}
            &nbsp;·&nbsp; Conviction ${s.confidence}/100
          </div>

          <p class="mirrorai-signal-reason">${s.simpleReasoning || ''}</p>

          <div class="mirrorai-signal-targets">
            <div><label>🎯 Objectif</label><span>${s.targetPrice ? s.targetPrice.toFixed(2) + ' €' : '—'}${gainTitre ? ` <em>(+${gainTitre}%)</em>` : ''}</span></div>
            <div><label>🛑 Stop-loss</label><span>${s.stopLoss ? s.stopLoss.toFixed(2) + ' €' : '—'}</span></div>
          </div>

          <div class="mirrorai-signal-action">👉 ${s.action || ''}</div>

          ${s.threeMonthOutlook ? `<div class="mirrorai-outlook">📅 3 mois : ${s.threeMonthOutlook}</div>` : ''}
        </div>
      `}).join('')}
    </div>

    <div class="mirrorai-sidebar-footer">
      <button id="mirrorai-chat-btn" class="mirrorai-btn-secondary" style="width:100%">💬 Poser une question à l'IA</button>
    </div>
  `;

  document.body.appendChild(sidebar);
  requestAnimationFrame(() => sidebar.classList.add('open'));

  document.getElementById('mirrorai-close').addEventListener('click', () => {
    sidebar.classList.remove('open');
    setTimeout(() => sidebar.remove(), 300);
  });
  document.getElementById('mirrorai-chat-btn').addEventListener('click', () => openChatModal(analysis));
}

// ─── Chat ───────────────────────────────────────────────────────────────────
function openChatModal(analysis) {
  document.getElementById('mirrorai-chat-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'mirrorai-chat-modal';
  modal.className = 'mirrorai-modal-overlay';
  modal.innerHTML = `
    <div class="mirrorai-chat-container">
      <div class="mirrorai-chat-header">
        <h3>💬 Question à MirrorAI</h3>
        <button id="chat-close" class="mirrorai-btn-icon">✕</button>
      </div>
      <div class="mirrorai-chat-messages" id="chat-messages">
        <div class="mirrorai-chat-message assistant">Bonjour ! Pose-moi n'importe quelle question sur ton portfolio ou les marchés.</div>
      </div>
      <div class="mirrorai-chat-input">
        <input id="chat-input" type="text" placeholder="Ex: Dois-je renforcer ma position ?"/>
        <button id="chat-send" class="mirrorai-btn-primary">Envoyer</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const send = () => {
    const input = document.getElementById('chat-input');
    const q = input.value.trim();
    if (!q) return;
    const msgs = document.getElementById('chat-messages');
    addMsg(msgs, q, 'user');
    input.value = '';
    input.disabled = true;

    const lid = Date.now();
    addMsg(msgs, '⏳ Analyse...', 'assistant', lid);

    chrome.runtime.sendMessage({ action: 'ask', question: q }, res => {
      document.getElementById(`msg-${lid}`)?.remove();
      addMsg(msgs, res?.answer || `Erreur : ${res?.error}`, 'assistant');
      input.disabled = false;
      input.focus();
    });
  };

  document.getElementById('chat-send').addEventListener('click', send);
  document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  document.getElementById('chat-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function addMsg(container, text, type, id) {
  const el = document.createElement('div');
  el.className = `mirrorai-chat-message ${type}`;
  if (id) el.id = `msg-${id}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// ─── Init + Observer ────────────────────────────────────────────────────────
function init() {
  setTimeout(injectAnalyzeButton, 1500);

  // Observer avec throttle pour ne pas spammer
  let observerTimeout = null;
  const observer = new MutationObserver(() => {
    if (document.getElementById('mirrorai-btn-wrap')) return;
    clearTimeout(observerTimeout);
    observerTimeout = setTimeout(injectAnalyzeButton, 1500);
  });
  observer.observe(document.body, { childList: true, subtree: false }); // subtree:false = moins de bruit
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
