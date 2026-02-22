/**
 * MirrorAI Content Script
 * Scrape Google Finance watchlist & inject analysis UI
 */

console.log('🎯 MirrorAI Extension loaded');

// Configuration
const CONFIG = {
  SELECTORS: {
    // Google Finance DOM selectors (as of Feb 2026)
    watchlistTable: 'tbody',
    tableRows: 'tbody tr',
    symbolCell: 'td:first-child a',
    nameCell: 'td:nth-child(2)',
    priceCell: 'td:nth-child(3)',
    changeCell: 'td:nth-child(4)',
    changePercentCell: 'td:nth-child(5)',
    header: '.yDlTYb', // Watchlist header
  },
  INJECT_POINT: '.yDlTYb', // Where to inject analyze button
};

/**
 * Extract portfolio from Google Finance watchlist
 */
function extractPortfolio() {
  const portfolio = [];
  const rows = document.querySelectorAll(CONFIG.SELECTORS.tableRows);
  
  rows.forEach((row, index) => {
    try {
      const symbolElement = row.querySelector(CONFIG.SELECTORS.symbolCell);
      const nameElement = row.querySelector(CONFIG.SELECTORS.nameCell);
      const priceElement = row.querySelector(CONFIG.SELECTORS.priceCell);
      const changeElement = row.querySelector(CONFIG.SELECTORS.changeCell);
      const changePercentElement = row.querySelector(CONFIG.SELECTORS.changePercentCell);
      
      if (!symbolElement || !priceElement) return;
      
      const symbol = symbolElement.textContent.trim();
      const name = nameElement?.textContent.trim() || symbol;
      const priceText = priceElement.textContent.trim();
      const changeText = changeElement?.textContent.trim() || '0';
      const changePercentText = changePercentElement?.textContent.trim() || '0%';
      
      // Parse price (format: "$123.45" or "123,45 €")
      const price = parseFloat(priceText.replace(/[^0-9.,]/g, '').replace(',', '.'));
      
      // Parse change (format: "+1.23" or "-1.23")
      const change = parseFloat(changeText.replace(/[^0-9.,-]/g, '').replace(',', '.'));
      
      // Parse change percent (format: "+1.23%" or "-1.23%")
      const changePercent = parseFloat(changePercentText.replace(/[^0-9.,-]/g, '').replace(',', '.'));
      
      if (!isNaN(price) && symbol) {
        portfolio.push({
          symbol,
          name,
          price,
          change,
          changePercent,
          shares: 0, // Will be asked to user
          avgPrice: 0, // Will be asked to user
        });
      }
    } catch (err) {
      console.error(`Error parsing row ${index}:`, err);
    }
  });
  
  console.log('📊 Portfolio extracted:', portfolio);
  return portfolio;
}

/**
 * Inject "Analyze with MirrorAI" button
 */
function injectAnalyzeButton() {
  const header = document.querySelector(CONFIG.SELECTORS.INJECT_POINT);
  if (!header) {
    console.warn('⚠️ Header not found, retrying...');
    setTimeout(injectAnalyzeButton, 1000);
    return;
  }
  
  // Check if button already exists
  if (document.getElementById('mirrorai-analyze-btn')) {
    return;
  }
  
  const button = document.createElement('button');
  button.id = 'mirrorai-analyze-btn';
  button.className = 'mirrorai-btn-primary';
  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
    <span>Analyser avec MirrorAI</span>
  `;
  
  button.addEventListener('click', handleAnalyzeClick);
  
  // Insert button
  const container = document.createElement('div');
  container.className = 'mirrorai-button-container';
  container.appendChild(button);
  
  header.appendChild(container);
  
  console.log('✅ Analyze button injected');
}

/**
 * Handle analyze button click
 */
async function handleAnalyzeClick() {
  const button = document.getElementById('mirrorai-analyze-btn');
  if (!button) return;
  
  // Disable button + loading state
  button.disabled = true;
  button.innerHTML = `
    <svg class="mirrorai-spinner" width="16" height="16" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>
    <span>Analyse en cours...</span>
  `;
  
  try {
    // 1. Extract portfolio
    const portfolio = extractPortfolio();
    
    if (portfolio.length === 0) {
      alert('❌ Aucun titre détecté dans votre watchlist Google Finance.');
      resetButton(button);
      return;
    }
    
    // 2. Check if PRU (Prix de Revient Unitaire) is stored
    const storedPortfolio = await chrome.storage.local.get('portfolio');
    let enrichedPortfolio = portfolio;
    
    if (!storedPortfolio.portfolio) {
      // First time: ask for PRU and shares
      enrichedPortfolio = await askForPRU(portfolio);
      await chrome.storage.local.set({ portfolio: enrichedPortfolio });
    } else {
      // Merge with stored data
      enrichedPortfolio = portfolio.map(stock => {
        const stored = storedPortfolio.portfolio.find(s => s.symbol === stock.symbol);
        return stored ? { ...stock, shares: stored.shares, avgPrice: stored.avgPrice } : stock;
      });
    }
    
    // 3. Send to background for AI analysis
    chrome.runtime.sendMessage(
      {
        action: 'analyze',
        portfolio: enrichedPortfolio,
      },
      (response) => {
        if (response.error) {
          alert(`❌ Erreur: ${response.error}`);
          resetButton(button);
          return;
        }
        
        // 4. Open sidebar with analysis
        openSidebar(response.analysis);
        resetButton(button);
      }
    );
  } catch (err) {
    console.error('Analysis error:', err);
    alert(`❌ Erreur: ${err.message}`);
    resetButton(button);
  }
}

/**
 * Reset button to initial state
 */
function resetButton(button) {
  button.disabled = false;
  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
    <span>Analyser avec MirrorAI</span>
  `;
}

/**
 * Ask user for PRU (Prix de Revient Unitaire) and shares
 */
async function askForPRU(portfolio) {
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'mirrorai-pru-modal';
  modal.innerHTML = `
    <div class="mirrorai-modal-overlay">
      <div class="mirrorai-modal-content">
        <h2>📝 Configuration de votre portfolio</h2>
        <p class="mirrorai-modal-subtitle">
          Entrez vos prix d'achat (PRU) et quantités pour une analyse personnalisée
        </p>
        <form id="mirrorai-pru-form">
          ${portfolio.map(stock => `
            <div class="mirrorai-pru-row">
              <div class="mirrorai-pru-stock">
                <strong>${stock.symbol}</strong>
                <span>${stock.name}</span>
              </div>
              <div class="mirrorai-pru-inputs">
                <input 
                  type="number" 
                  name="shares_${stock.symbol}" 
                  placeholder="Quantité"
                  step="1"
                  min="0"
                  required
                />
                <input 
                  type="number" 
                  name="avgPrice_${stock.symbol}" 
                  placeholder="PRU (€)"
                  step="0.01"
                  min="0"
                  value="${stock.price}"
                  required
                />
              </div>
            </div>
          `).join('')}
          <div class="mirrorai-modal-actions">
            <button type="button" id="mirrorai-pru-cancel" class="mirrorai-btn-secondary">
              Annuler
            </button>
            <button type="submit" class="mirrorai-btn-primary">
              Valider
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Handle form submission
  return new Promise((resolve, reject) => {
    const form = document.getElementById('mirrorai-pru-form');
    const cancelBtn = document.getElementById('mirrorai-pru-cancel');
    
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      
      const enriched = portfolio.map(stock => ({
        ...stock,
        shares: parseFloat(formData.get(`shares_${stock.symbol}`)) || 0,
        avgPrice: parseFloat(formData.get(`avgPrice_${stock.symbol}`)) || stock.price,
      }));
      
      modal.remove();
      resolve(enriched);
    });
    
    cancelBtn.addEventListener('click', () => {
      modal.remove();
      reject(new Error('User cancelled'));
    });
  });
}

/**
 * Open sidebar with analysis results
 */
function openSidebar(analysis) {
  // Check if sidebar already exists
  let sidebar = document.getElementById('mirrorai-sidebar');
  
  if (!sidebar) {
    sidebar = document.createElement('div');
    sidebar.id = 'mirrorai-sidebar';
    sidebar.className = 'mirrorai-sidebar';
    document.body.appendChild(sidebar);
  }
  
  sidebar.innerHTML = `
    <div class="mirrorai-sidebar-header">
      <div class="mirrorai-sidebar-title">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
        <h3>MirrorAI</h3>
      </div>
      <button id="mirrorai-sidebar-close" class="mirrorai-btn-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    
    <div class="mirrorai-sidebar-content">
      <div class="mirrorai-analysis">
        <h4>📊 Analyse Globale</h4>
        <div class="mirrorai-health">
          <span class="mirrorai-health-badge">${analysis.health || 'En cours...'}</span>
          <p>${analysis.healthDesc || ''}</p>
        </div>
        
        <h4>🎯 Signaux par Titre</h4>
        <div class="mirrorai-signals">
          ${(analysis.signals || []).map(signal => `
            <div class="mirrorai-signal-card ${signal.color || 'blue'}">
              <div class="mirrorai-signal-header">
                <strong>${signal.name || signal.symbol}</strong>
                <span class="mirrorai-signal-badge">${signal.advice || 'HOLD'}</span>
              </div>
              <p class="mirrorai-signal-reason">${signal.simpleReasoning || signal.reason || ''}</p>
              <div class="mirrorai-signal-action">
                <strong>Action:</strong> ${signal.action || 'Conserver'}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    
    <div class="mirrorai-sidebar-footer">
      <button id="mirrorai-chat-open" class="mirrorai-btn-secondary">
        💬 Poser une question
      </button>
    </div>
  `;
  
  // Add open class for animation
  setTimeout(() => sidebar.classList.add('open'), 10);
  
  // Handle close button
  document.getElementById('mirrorai-sidebar-close').addEventListener('click', () => {
    sidebar.classList.remove('open');
    setTimeout(() => sidebar.remove(), 300);
  });
  
  // Handle chat button
  document.getElementById('mirrorai-chat-open').addEventListener('click', openChatModal);
}

/**
 * Open chat modal
 */
function openChatModal() {
  const modal = document.createElement('div');
  modal.id = 'mirrorai-chat-modal';
  modal.innerHTML = `
    <div class="mirrorai-modal-overlay">
      <div class="mirrorai-chat-container">
        <div class="mirrorai-chat-header">
          <h3>💬 Posez votre question</h3>
          <button id="mirrorai-chat-close" class="mirrorai-btn-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="mirrorai-chat-messages" id="mirrorai-chat-messages"></div>
        <form id="mirrorai-chat-form" class="mirrorai-chat-input">
          <input 
            type="text" 
            id="mirrorai-chat-input" 
            placeholder="Ex: Dois-je renforcer Apple maintenant ?"
            required
          />
          <button type="submit" class="mirrorai-btn-primary">
            Envoyer
          </button>
        </form>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Handle close
  document.getElementById('mirrorai-chat-close').addEventListener('click', () => {
    modal.remove();
  });
  
  // Handle form submission
  const form = document.getElementById('mirrorai-chat-form');
  const input = document.getElementById('mirrorai-chat-input');
  const messagesDiv = document.getElementById('mirrorai-chat-messages');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    
    // Add user message
    addChatMessage(messagesDiv, question, 'user');
    input.value = '';
    input.disabled = true;
    
    // Add loading message
    const loadingId = Date.now();
    addChatMessage(messagesDiv, 'Analyse en cours...', 'assistant', loadingId);
    
    // Send to background
    chrome.runtime.sendMessage(
      { action: 'ask', question },
      (response) => {
        // Remove loading message
        document.getElementById(`msg-${loadingId}`)?.remove();
        
        if (response.error) {
          addChatMessage(messagesDiv, `Erreur: ${response.error}`, 'error');
        } else {
          addChatMessage(messagesDiv, response.answer, 'assistant');
        }
        
        input.disabled = false;
        input.focus();
      }
    );
  });
}

/**
 * Add message to chat
 */
function addChatMessage(container, text, type, id) {
  const msg = document.createElement('div');
  msg.className = `mirrorai-chat-message ${type}`;
  if (id) msg.id = `msg-${id}`;
  msg.textContent = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

/**
 * Initialize extension
 */
function init() {
  // Wait for page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
    return;
  }
  
  // Inject button after a delay (ensure DOM is ready)
  setTimeout(injectAnalyzeButton, 1000);
  
  // Listen for dynamic page changes (SPA navigation)
  const observer = new MutationObserver(() => {
    if (!document.getElementById('mirrorai-analyze-btn')) {
      injectAnalyzeButton();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Start
init();
