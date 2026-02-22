/**
 * MirrorAI Popup Script
 */

// Load portfolio count
chrome.storage.local.get('portfolio', (result) => {
  const count = result.portfolio ? result.portfolio.length : 0;
  document.getElementById('portfolioCount').textContent = 
    count > 0 ? `${count} titre${count > 1 ? 's' : ''}` : 'Aucun titre';
});

// Open Google Finance
document.getElementById('openFinance').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.google.com/finance' });
});

// Settings (placeholder)
document.getElementById('settings').addEventListener('click', () => {
  alert('⚙️ Paramètres à venir dans la prochaine version !\n\nÀ venir:\n• Sélection du modèle IA (Flash/Pro)\n• Configuration du cache\n• Alertes push');
});

// Help (placeholder)
document.getElementById('help').addEventListener('click', (e) => {
  e.preventDefault();
  alert('📚 Aide MirrorAI\n\n1. Ouvrez Google Finance\n2. Ajoutez des titres à votre watchlist\n3. Cliquez sur "Analyser avec MirrorAI"\n4. Entrez vos PRU (Prix de Revient Unitaire)\n5. Consultez les conseils personnalisés !');
});

// About (placeholder)
document.getElementById('about').addEventListener('click', (e) => {
  e.preventDefault();
  alert('🎯 MirrorAI v1.0\n\nAnalyse ton portfolio Google Finance avec l\'IA.\n\nConseils Buy/Sell/Hold personnalisés en temps réel.\n\nPowered by Gemini 2.5 Flash');
});
