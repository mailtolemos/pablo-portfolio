(() => {
  'use strict';

  const HERMES = 'https://hermes.pyth.network';
  const PAGE_SIZE = 25;
  const KEYS = {
    accounts: 'pablo.accounts.v1',
    session: 'pablo.session.v1',
    legacyWallets: 'pablo.wallets.v1',
    legacyAlerts: 'pablo.alerts.v1',
    legacyPreferences: 'pablo.preferences.v1',
    workspace: 'pablo.workspace.v2'
  };
  const DEFAULT_ASSETS = [
    { symbol:'BTC', name:'Bitcoin', query:'BTC/USD', price:0, change:0, confidence:0, hue:'#f2c86b' },
    { symbol:'ETH', name:'Ethereum', query:'ETH/USD', price:0, change:0, confidence:0, hue:'#88a9ff' },
    { symbol:'SOL', name:'Solana', query:'SOL/USD', price:0, change:0, confidence:0, hue:'#c9ff53' },
    { symbol:'HYPE', name:'Hyperliquid', query:'HYPE/USD', price:0, change:0, confidence:0, hue:'#a5b3ff' },
    { symbol:'AAPL', name:'Apple', query:'AAPL/USD', price:0, change:0, confidence:0, hue:'#d5d7d2' },
    { symbol:'TSLA', name:'Tesla', query:'TSLA/USD', price:0, change:0, confidence:0, hue:'#ff786f' }
  ];
  const HUES = ['#c9ff53','#88a9ff','#f2c86b','#a5b3ff','#ff786f','#d5d7d2','#7ee0c3','#f49ac2'];
  const sparkUp = 'M1 21 C10 19 14 22 21 15 S34 18 41 10 S54 12 69 3';
  const sparkDown = 'M1 6 C10 8 14 5 21 12 S34 9 41 16 S54 13 69 22';
  const viewCopy = {
    Overview: ['Private wealth intelligence', 'Your whole world, one view.', 'Every Pablo workspace, together in one complete command center.'],
    Portfolio: ['Portfolio', 'Your portfolio, without the noise.', 'Allocation, performance and the assets that matter to you.'],
    Markets: ['Markets', 'Every market, one oracle.', 'Search the complete live Pyth catalog across crypto, equities, FX and commodities.'],
    Intelligence: ['Intelligence', 'Signal over spectacle.', 'Risk appetite, technical indicators and the stories moving capital.'],
    Accounts: ['Identity & connections', 'Accounts you control.', 'Manage your device identity, approved wallets and broker connections.'],
    Alerts: ['Price intelligence', 'Move when the market does.', 'Build a private list of price levels worth your attention.'],
    Settings: ['Control room', 'Pablo, on your terms.', 'Manage privacy, refresh behavior and data held on this device.']
  };

  let assets = DEFAULT_ASSETS.map(asset => ({...asset}));
  let selectedAsset = assets[0];
  let pythCatalog = [];
  let filteredFeeds = [];
  let feedPrices = new Map();
  let priceHistory = new Map();
  let favoriteIds = {};
  let feedPage = 1;
  let currentView = 'Overview';
  let selectedRange = '1M';
  let hidden = false;
  let authMode = 'signin';
  let favoriteTimer;
  let universeTimer;
  let toastTimer;
  let searchTimer;

  const $ = id => document.getElementById(id);
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const workspaceKey = () => `${KEYS.workspace}.${currentAccount()?.id || 'guest'}`;
  function getWorkspace() {
    const existing = read(workspaceKey(), null);
    if (existing) return {
      watchlist: Array.isArray(existing.watchlist) ? existing.watchlist : null,
      wallets: Array.isArray(existing.wallets) ? existing.wallets : [],
      alerts: Array.isArray(existing.alerts) ? existing.alerts : [],
      portfolioHistory: Array.isArray(existing.portfolioHistory) ? existing.portfolioHistory : [],
      preferences: {...{privacy:false, refresh:true}, ...(existing.preferences || {})}
    };
    const shouldMigrate = localStorage.getItem('pablo.workspace.migrated') !== '1';
    const initial = {
      watchlist: null,
      wallets: shouldMigrate ? read(KEYS.legacyWallets, []) : [],
      alerts: shouldMigrate ? read(KEYS.legacyAlerts, []) : [],
      portfolioHistory: [],
      preferences: shouldMigrate ? read(KEYS.legacyPreferences, {privacy:false, refresh:true}) : {privacy:false, refresh:true}
    };
    write(workspaceKey(), initial);
    if (shouldMigrate) localStorage.setItem('pablo.workspace.migrated', '1');
    return initial;
  }
  function updateWorkspace(patch) {
    write(workspaceKey(), {...getWorkspace(), ...patch});
  }
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const shortAddress = value => value && value.length > 16 ? `${value.slice(0,7)}…${value.slice(-6)}` : value;
  const exactSymbol = feed => String(feed.attributes?.display_symbol || feed.attributes?.symbol || '').toUpperCase();
  const feedLabel = feed => feed.attributes?.display_symbol || feed.attributes?.symbol || feed.attributes?.description || 'Unknown feed';
  const safeUrl = value => /^https?:\/\//i.test(value || '') ? value : '#';

  function money(value) {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= .01 ? 6 : 8;
    return new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:Math.min(2,digits), maximumFractionDigits:digits}).format(value);
  }

  function relativeTime(date) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 60000));
    return mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.floor(mins / 60)} hr` : `${Math.floor(mins / 1440)} d`;
  }

  function showToast(text, duration = 3000) {
    const toast = $('toast');
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
  }

  const assetKey = asset => asset?.feedId || asset?.query || asset?.symbol;

  function sessionChange(asset) {
    const history = priceHistory.get(assetKey(asset)) || [];
    if (history.length < 2 || !history[0]) return null;
    return (history[history.length - 1] / history[0] - 1) * 100;
  }

  function renderAssets(filter = '') {
    const rows = assets.filter(asset => `${asset.symbol} ${asset.name} ${asset.query}`.toLowerCase().includes(filter.toLowerCase()));
    $('assetRows').innerHTML = rows.length ? rows.map(asset => {
      const change = sessionChange(asset);
      const positive = change == null || change >= 0;
      return `<tr data-asset-key="${esc(assetKey(asset))}" class="${assetKey(asset) === assetKey(selectedAsset) ? 'selected' : ''}">
        <td><div class="asset"><div class="coin" style="color:${asset.hue}">${esc(asset.symbol.slice(0,2))}</div><div><strong>${esc(asset.symbol)}</strong><span>${esc(asset.name)}</span></div></div></td>
        <td><div class="price balance">${asset.publishTime ? money(asset.price) : '—'}</div><div class="feed">${asset.publishTime ? `updated ${new Date(asset.publishTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}` : 'waiting for Pyth'}</div></td>
        <td class="${asset.publishTime ? 'pos' : ''}">${asset.publishTime ? 'Live' : 'Waiting'}</td>
        <td class="${change == null ? '' : positive ? 'pos' : 'neg'}">${change == null ? 'Collecting' : `${positive ? '+' : ''}${change.toFixed(3)}%`}</td>
        <td><div>${asset.publishTime ? `${asset.confidence.toFixed(4)}%` : '—'}</div><div class="feed">oracle interval</div></td>
        <td class="watch-action"><button class="tiny-btn" data-remove-feed="${esc(assetKey(asset))}" aria-label="Remove ${esc(asset.symbol)} from watchlist">Remove</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="loading-row">No watchlist feeds match. Use “+ Asset” to add one from the complete Pyth catalog.</td></tr>';
    document.querySelectorAll('#assetRows tr[data-asset-key]').forEach(row => row.addEventListener('click', () => selectAsset(row.dataset.assetKey)));
    document.querySelectorAll('[data-remove-feed]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      removeFeedFromWatchlist(button.dataset.removeFeed);
    }));
    document.querySelectorAll('.balance').forEach(el => el.classList.toggle('hidden-balance', hidden));
  }

  function selectAsset(key) {
    selectedAsset = assets.find(asset => assetKey(asset) === key) || assets[0] || null;
    updateTechnicals();
    renderAssets($('assetSearch').value);
  }

  function updateTechnicals() {
    if (!selectedAsset) {
      $('technicalTitle').textContent = 'No feed selected';
      $('rsiValue').textContent = '—';
      $('rsiMeter').style.width = '0%';
      $('bbValue').textContent = 'Add a Pyth feed';
      $('bbValue').className = '';
      $('momentumValue').textContent = 'Not calculated';
      return;
    }
    const history = priceHistory.get(assetKey(selectedAsset)) || [];
    $('technicalTitle').textContent = feedLabel({attributes:{display_symbol:selectedAsset.query}});
    if (history.length < 15) {
      $('rsiValue').textContent = '—';
      $('rsiMeter').style.width = `${Math.min(100, history.length / 15 * 100)}%`;
      $('bbValue').textContent = `Collecting ${history.length}/20 samples`;
      $('bbValue').className = '';
      $('momentumValue').textContent = history.length > 1 ? (history.at(-1) >= history[0] ? 'Session rising' : 'Session falling') : 'Awaiting history';
      return;
    }
    const changes = history.slice(-15).slice(1).map((price, index) => price - history.slice(-15)[index]);
    const gains = changes.reduce((sum, change) => sum + Math.max(change, 0), 0) / changes.length;
    const losses = changes.reduce((sum, change) => sum + Math.max(-change, 0), 0) / changes.length;
    const rsi = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
    $('rsiValue').textContent = rsi.toFixed(1);
    $('rsiMeter').style.width = `${rsi}%`;
    if (history.length >= 20) {
      const sample = history.slice(-20);
      const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
      const deviation = Math.sqrt(sample.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / sample.length);
      const position = deviation ? Math.max(0, Math.min(100, ((sample.at(-1) - (mean - 2 * deviation)) / (4 * deviation)) * 100)) : 50;
      $('bbValue').textContent = `${position.toFixed(0)}% of band`;
      $('bbValue').className = position >= 50 ? 'pos' : 'neg';
    } else {
      $('bbValue').textContent = `Collecting ${history.length}/20 samples`;
      $('bbValue').className = '';
    }
    $('momentumValue').textContent = rsi > 60 ? 'Bullish' : rsi < 40 ? 'Bearish' : 'Neutral';
  }

  async function fetchLatest(ids) {
    if (!ids.length) return [];
    const query = ids.map(id => `ids[]=${encodeURIComponent(id.replace(/^0x/, ''))}`).join('&');
    const response = await fetch(`${HERMES}/v2/updates/price/latest?${query}`, {cache:'no-store'});
    if (!response.ok) throw new Error(`Pyth price request failed (${response.status})`);
    const data = await response.json();
    return data.parsed || [];
  }

  function parsePythPrice(item) {
    const scale = Math.pow(10, Number(item.price.expo));
    const price = Number(item.price.price) * scale;
    const confidence = Number(item.price.conf) * scale;
    return { price, confidence: Math.abs(confidence / price * 100), publishTime: Number(item.price.publish_time) * 1000 };
  }

  function findFeed(query) {
    const wanted = String(query).toUpperCase();
    return pythCatalog.find(feed => exactSymbol(feed) === wanted)
      || pythCatalog.find(feed => exactSymbol(feed).endsWith(`.${wanted}`))
      || pythCatalog.find(feed => exactSymbol(feed).includes(wanted));
  }

  function feedToAsset(feed, preferred = null, index = 0) {
    const attrs = feed.attributes || {};
    const display = attrs.display_symbol || attrs.symbol || 'UNKNOWN/USD';
    const symbol = preferred?.symbol || attrs.base || display.split('/')[0].split('.').at(-1) || 'FEED';
    const live = feedPrices.get(feed.id.replace(/^0x/, ''));
    return {
      feedId: feed.id.replace(/^0x/, ''),
      symbol,
      name: preferred?.name || attrs.description || display,
      query: display,
      price: live?.price || 0,
      confidence: live?.confidence || 0,
      publishTime: live?.publishTime,
      hue: preferred?.hue || HUES[index % HUES.length]
    };
  }

  function hydrateWatchlist() {
    if (!pythCatalog.length) return;
    const workspace = getWorkspace();
    favoriteIds = {};
    if (workspace.watchlist === null) {
      assets = DEFAULT_ASSETS.map((preferred, index) => {
        const feed = findFeed(preferred.query);
        return feed ? feedToAsset(feed, preferred, index) : null;
      }).filter(Boolean);
      updateWorkspace({watchlist:assets.map(asset => asset.feedId)});
    } else {
      assets = workspace.watchlist.map((id, index) => {
        const feed = pythCatalog.find(item => item.id.replace(/^0x/, '') === String(id).replace(/^0x/, ''));
        return feed ? feedToAsset(feed, null, index) : null;
      }).filter(Boolean);
    }
    assets.forEach(asset => { favoriteIds[assetKey(asset)] = asset.feedId; });
    selectedAsset = assets.find(asset => assetKey(asset) === assetKey(selectedAsset)) || assets[0] || null;
    renderAssets($('assetSearch').value);
    updateTechnicals();
    renderUniverse();
  }

  function addFeedToWatchlist(feedId) {
    const id = String(feedId).replace(/^0x/, '');
    if (assets.some(asset => asset.feedId === id)) { showToast('That feed is already in your watchlist'); return; }
    const feed = pythCatalog.find(item => item.id.replace(/^0x/, '') === id);
    if (!feed) return;
    const asset = feedToAsset(feed, null, assets.length);
    assets.push(asset);
    favoriteIds[assetKey(asset)] = id;
    updateWorkspace({watchlist:assets.map(item => item.feedId)});
    selectedAsset = asset;
    renderAssets($('assetSearch').value);
    renderUniverse();
    updateTechnicals();
    refreshFavoritePrices().catch(() => {});
    showToast(`${asset.query} added to your watchlist`);
  }

  function removeFeedFromWatchlist(key) {
    const removed = assets.find(asset => assetKey(asset) === key);
    assets = assets.filter(asset => assetKey(asset) !== key);
    delete favoriteIds[key];
    updateWorkspace({watchlist:assets.map(asset => asset.feedId)});
    selectedAsset = assets[0] || null;
    renderAssets($('assetSearch').value);
    renderUniverse();
    updateTechnicals();
    showToast(removed ? `${removed.query} removed from your watchlist` : 'Feed removed');
  }

  async function refreshFavoritePrices() {
    const ids = requiredPriceIds();
    if (!ids.length) {
      $('feedNote').textContent = 'Watchlist is empty · add any feed from the Pyth universe';
      renderAssets($('assetSearch').value);
      renderPortfolio();
      return;
    }
    const parsed = await fetchLatest(ids);
    const byId = new Map(parsed.map(item => [item.id.replace(/^0x/, ''), parsePythPrice(item)]));
    assets.forEach(asset => {
      const next = byId.get(asset.feedId);
      if (!next) return;
      Object.assign(asset, next);
      feedPrices.set(asset.feedId, next);
      const history = priceHistory.get(assetKey(asset)) || [];
      if (!history.length || history.at(-1) !== next.price) {
        history.push(next.price);
        priceHistory.set(assetKey(asset), history.slice(-60));
      }
    });
    renderAssets($('assetSearch').value);
    updateTechnicals();
    renderPortfolio();
    checkAlerts();
    renderMacroSignals();
    $('liveDot').classList.add('ok');
    $('tableDot').classList.add('ok');
    $('liveStatus').textContent = 'Pyth live';
    const verified = assets.filter(asset => asset.publishTime).length;
    $('feedNote').textContent = `${verified} watchlist feeds verified · editable · confidence intervals shown`;
  }

  async function loadCatalog(force = false) {
    if (pythCatalog.length && !force) return;
    $('catalogCount').textContent = 'Loading catalog…';
    const response = await fetch(`${HERMES}/v2/price_feeds`, {cache:'no-store'});
    if (!response.ok) throw new Error(`Pyth catalog failed (${response.status})`);
    const feeds = await response.json();
    pythCatalog = Array.isArray(feeds) ? feeds.filter(feed => feed && feed.id && feed.attributes) : [];
    const classes = [...new Set(pythCatalog.map(feed => feed.attributes.asset_type || 'Other'))].sort((a,b) => a.localeCompare(b));
    $('feedClass').innerHTML = '<option value="All">All asset classes</option>' + classes.map(item => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
    $('catalogCount').textContent = `${pythCatalog.length.toLocaleString()} feeds`;
    $('catalogDot').classList.add('ok');
    hydrateWatchlist();
    applyFeedFilters(false);
  }

  function applyFeedFilters(refresh = true) {
    const query = $('feedSearch').value.trim().toLowerCase();
    const assetClass = $('feedClass').value;
    filteredFeeds = pythCatalog.filter(feed => {
      const attrs = feed.attributes || {};
      const haystack = `${attrs.display_symbol || ''} ${attrs.symbol || ''} ${attrs.description || ''} ${attrs.base || ''} ${attrs.quote_currency || ''}`.toLowerCase();
      return (!query || haystack.includes(query)) && (assetClass === 'All' || (attrs.asset_type || 'Other') === assetClass);
    });
    const pages = Math.max(1, Math.ceil(filteredFeeds.length / PAGE_SIZE));
    feedPage = Math.min(feedPage, pages);
    $('feedResultCount').textContent = `${filteredFeeds.length.toLocaleString()} matching feeds`;
    renderUniverse();
    if (refresh && (currentView === 'Overview' || currentView === 'Markets')) refreshUniversePrices().catch(handleUniverseError);
  }

  function currentFeedPage() {
    return filteredFeeds.slice((feedPage - 1) * PAGE_SIZE, feedPage * PAGE_SIZE);
  }

  function renderUniverse() {
    if (!pythCatalog.length) return;
    const pageFeeds = currentFeedPage();
    const pages = Math.max(1, Math.ceil(filteredFeeds.length / PAGE_SIZE));
    $('feedPage').textContent = `Page ${feedPage} of ${pages}`;
    $('feedPrev').disabled = feedPage <= 1;
    $('feedNext').disabled = feedPage >= pages;
    $('universeRows').innerHTML = pageFeeds.length ? pageFeeds.map(feed => {
      const attrs = feed.attributes || {};
      const id = feed.id.replace(/^0x/, '');
      const live = feedPrices.get(id);
      const watched = assets.some(asset => asset.feedId === id);
      return `<tr>
        <td><div class="feed-symbol"><strong>${esc(feedLabel(feed))}</strong><span>${esc(attrs.description || attrs.symbol || id)}</span></div></td>
        <td>${esc(attrs.asset_type || 'Other')}</td>
        <td><div class="price">${live ? money(live.price) : '—'}</div></td>
        <td>${live ? `${live.confidence.toFixed(4)}%` : '—'}</td>
        <td><span class="feed">${live ? new Date(live.publishTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}) : 'waiting'}</span></td>
        <td class="watch-action"><button class="tiny-btn ${watched ? 'added' : ''}" data-add-feed="${id}" ${watched ? 'disabled' : ''}>${watched ? '✓ Added' : '+ Add'}</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="loading-row">No Pyth feeds match those filters.</td></tr>';
    document.querySelectorAll('[data-add-feed]:not([disabled])').forEach(button => button.addEventListener('click', () => addFeedToWatchlist(button.dataset.addFeed)));
  }

  async function refreshUniversePrices() {
    const pageFeeds = currentFeedPage();
    if (!pageFeeds.length) return;
    $('universeNote').textContent = 'Verifying visible feeds with Pyth Hermes…';
    const parsed = await fetchLatest(pageFeeds.map(feed => feed.id));
    parsed.forEach(item => feedPrices.set(item.id.replace(/^0x/, ''), parsePythPrice(item)));
    renderUniverse();
    $('universeNote').textContent = `${parsed.length} visible prices verified in one Pyth batch · ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    $('catalogDot').classList.add('ok');
  }

  function handleUniverseError(error) {
    console.warn(error);
    $('catalogDot').classList.remove('ok');
    $('universeNote').textContent = 'Live price request paused. The complete catalog remains searchable.';
  }

  async function initPyth() {
    try {
      await loadCatalog();
      await Promise.all([refreshFavoritePrices(), refreshUniversePrices(), refreshWalletBalances()]);
    } catch (error) {
      console.warn(error);
      $('liveStatus').textContent = 'Reference mode';
      $('feedNote').textContent = 'Pyth is temporarily unavailable · showing clearly labeled reference prices';
      $('catalogCount').textContent = 'Catalog unavailable';
      $('universeRows').innerHTML = '<tr><td colspan="6" class="loading-row">The Pyth catalog could not be reached. Retry in a moment.</td></tr>';
    }
    schedulePriceRefresh();
  }

  function schedulePriceRefresh() {
    clearInterval(favoriteTimer);
    clearInterval(universeTimer);
    const preferences = getWorkspace().preferences;
    if (preferences.refresh === false) return;
    favoriteTimer = setInterval(() => Promise.all([refreshFavoritePrices(), refreshWalletBalances()]).catch(() => {}), 15000);
    universeTimer = setInterval(() => {
      if (currentView === 'Overview' || currentView === 'Markets') refreshUniversePrices().catch(handleUniverseError);
    }, 20000);
  }

  function requiredPriceIds() {
    const ids = new Set(assets.map(asset => asset.feedId).filter(Boolean));
    getWorkspace().wallets.forEach(wallet => {
      if (!wallet.assetSymbol) return;
      const feed = findFeed(`${wallet.assetSymbol}/USD`);
      if (feed) ids.add(feed.id.replace(/^0x/, ''));
    });
    getWorkspace().alerts.forEach(alert => {
      const feed = findFeed(alert.symbol.includes('/') ? alert.symbol : `${alert.symbol}/USD`);
      if (feed) ids.add(feed.id.replace(/^0x/, ''));
    });
    Object.values(macroFeedMap()).filter(Boolean).forEach(feed => ids.add(feed.id.replace(/^0x/, '')));
    return [...ids];
  }

  function macroFeedMap() {
    return {
      vix:findFeed('VIX/USD'),
      dxy:findFeed('DXY/USD'),
      tenYear:findFeed('US10Y/USD') || findFeed('10Y/USD')
    };
  }

  function renderMacroSignals() {
    const feeds = macroFeedMap();
    const render = (elementId, feed, suffix = '') => {
      const live = feed ? feedPrices.get(feed.id.replace(/^0x/, '')) : null;
      $(elementId).textContent = live ? `${live.price.toLocaleString(undefined,{maximumFractionDigits:3})}${suffix}` : 'Not listed';
    };
    render('vixSignal', feeds.vix);
    render('dxySignal', feeds.dxy);
    render('tenYearSignal', feeds.tenYear, '%');
  }

  function priceForSymbol(symbol) {
    const asset = assets.find(item => item.symbol.toUpperCase() === symbol.toUpperCase() && item.publishTime);
    if (asset) return asset.price;
    const feed = findFeed(`${symbol}/USD`);
    if (!feed) return 0;
    return feedPrices.get(feed.id.replace(/^0x/, ''))?.price || 0;
  }

  async function fetchSolanaBalance(address) {
    const response = await fetch('https://api.mainnet-beta.solana.com', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0', id:1, method:'getBalance', params:[address, {commitment:'confirmed'}]})
    });
    if (!response.ok) throw new Error('Solana balance unavailable');
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Solana balance unavailable');
    return Number(data.result?.value || 0) / 1e9;
  }

  async function fetchHyperliquidAccount(address) {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:'clearinghouseState', user:address})
    });
    if (!response.ok) throw new Error('Hyperliquid account unavailable');
    const data = await response.json();
    return {
      usdValue:Number(data.marginSummary?.accountValue || 0),
      withdrawable:Number(data.withdrawable || 0),
      positionCount:Array.isArray(data.assetPositions) ? data.assetPositions.filter(item => Number(item.position?.szi || 0) !== 0).length : 0
    };
  }

  async function refreshWalletBalances() {
    const workspace = getWorkspace();
    if (!workspace.wallets.length) { renderWallets(); renderPortfolio(); return; }
    const wallets = await Promise.all(workspace.wallets.map(async wallet => {
      try {
        if (wallet.type === 'solana') {
          return {...wallet, balance:await fetchSolanaBalance(wallet.address), assetSymbol:'SOL', balanceUpdatedAt:Date.now(), balanceError:null};
        }
        if (wallet.type === 'ethereum' && window.ethereum?.request) {
          const raw = await window.ethereum.request({method:'eth_getBalance', params:[wallet.address, 'latest']});
          return {...wallet, balance:Number(BigInt(raw)) / 1e18, balanceUpdatedAt:Date.now(), balanceError:wallet.assetSymbol ? null : wallet.balanceError};
        }
        if (wallet.type === 'hyperliquid') {
          return {...wallet, ...await fetchHyperliquidAccount(wallet.address), balanceUpdatedAt:Date.now(), balanceError:null};
        }
        return wallet;
      } catch (error) {
        return {...wallet, balanceError:error.message || 'Balance unavailable'};
      }
    }));
    updateWorkspace({wallets});
    renderWallets();
    renderPortfolio();
  }

  function renderPortfolio() {
    const workspace = getWorkspace();
    const positions = [];
    workspace.wallets.forEach(wallet => {
      if (wallet.type === 'hyperliquid') {
        if (Number(wallet.usdValue) > 0) positions.push({label:'Hyperliquid', value:Number(wallet.usdValue), category:'defi', count:Math.max(1, Number(wallet.positionCount) || 0)});
        return;
      }
      if (Number(wallet.balance) < 0 || !wallet.assetSymbol) return;
      const price = priceForSymbol(wallet.assetSymbol);
      if (price > 0 && Number(wallet.balance) > 0) positions.push({label:wallet.assetSymbol, value:Number(wallet.balance) * price, category:'crypto', count:1});
    });
    const total = positions.reduce((sum, position) => sum + position.value, 0);
    const crypto = positions.filter(position => position.category === 'crypto').reduce((sum, position) => sum + position.value, 0);
    const defi = positions.filter(position => position.category === 'defi').reduce((sum, position) => sum + position.value, 0);
    const cryptoPct = total ? crypto / total * 100 : 0;
    const defiPct = total ? defi / total * 100 : 0;
    $('netWorthValue').textContent = money(total);
    $('positionCount').textContent = positions.reduce((sum, position) => sum + position.count, 0);
    $('allocationCrypto').textContent = `${cryptoPct.toFixed(0)}%`;
    $('allocationEquities').textContent = '0%';
    $('allocationDefi').textContent = `${defiPct.toFixed(0)}%`;
    $('allocationCash').textContent = '0%';
    $('allocationDonut').style.background = total
      ? `conic-gradient(var(--acid) 0 ${cryptoPct}%, var(--amber) ${cryptoPct}% ${cryptoPct + defiPct}%, rgba(255,255,255,.06) ${cryptoPct + defiPct}% 100%)`
      : 'conic-gradient(rgba(255,255,255,.07) 0 100%)';
    $('portfolioLabel').textContent = currentAccount() ? 'Verified net worth' : 'Connected balances';
    $('portfolioDot').classList.toggle('ok', total > 0);
    $('portfolioConfidence').textContent = total > 0 ? 'On-chain balances · Pyth prices' : 'No holdings synced';
    $('portfolioNote').textContent = total > 0
      ? `${positions.length} verified source${positions.length === 1 ? '' : 's'} contribute to this total. Broker balances remain excluded until authorized.`
      : 'No sample wealth. Pablo only counts balances that can be verified from your connected sources.';
    const history = workspace.portfolioHistory.slice();
    const previous = history.at(-1);
    if ((total > 0 || history.length) && (!previous || Math.abs(previous.v - total) > .01 || Date.now() - previous.t > 60000)) {
      history.push({t:Date.now(), v:total});
      updateWorkspace({portfolioHistory:history.slice(-500)});
    }
    renderPortfolioChart();
    document.querySelectorAll('.balance').forEach(el => el.classList.toggle('hidden-balance', hidden));
  }

  function renderPortfolioChart() {
    const durations = {'1D':86400000,'1W':604800000,'1M':2592000000,'3M':7776000000,'1Y':31536000000,ALL:Infinity};
    const all = getWorkspace().portfolioHistory;
    const cutoff = Date.now() - (durations[selectedRange] || durations['1M']);
    const history = all.filter(point => point.t >= cutoff);
    const chart = $('portfolioChart');
    const latest = history.at(-1)?.v || 0;
    $('chartTip').textContent = money(latest);
    if (!history.length) {
      chart.classList.add('empty');
      $('chartEmpty').textContent = 'Portfolio history begins after your first verified balance sync.';
      $('portfolioLine').setAttribute('d', 'M0 151 L760 151');
      $('portfolioArea').setAttribute('d', 'M0 180 L0 151 L760 151 L760 180Z');
      $('netWorthDelta').textContent = 'Connect a wallet to begin';
      $('netWorthDelta').className = 'delta';
      return;
    }
    const values = history.map(point => point.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = Math.max(max - min, Math.max(max * .01, 1));
    const points = history.length === 1 ? [{...history[0], t:history[0].t - 1}, history[0]] : history;
    const startTime = points[0].t;
    const endTime = points.at(-1).t;
    const path = points.map((point, index) => {
      const x = endTime === startTime ? 760 : ((point.t - startTime) / (endTime - startTime)) * 760;
      const y = 160 - ((point.v - min) / spread) * 125;
      return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    $('portfolioLine').setAttribute('d', path);
    $('portfolioArea').setAttribute('d', `M0 180 ${path} L760 180Z`);
    chart.classList.toggle('empty', history.length < 2);
    $('chartEmpty').textContent = history.length < 2 ? 'First verified balance recorded. History builds as prices and balances update.' : '';
    const first = history[0].v;
    const change = first ? (latest / first - 1) * 100 : 0;
    $('netWorthDelta').textContent = history.length < 2 ? 'First verified snapshot' : `${change >= 0 ? '↗' : '↘'} ${change >= 0 ? '+' : ''}${change.toFixed(2)}% for ${selectedRange}`;
    $('netWorthDelta').className = `delta ${change < 0 ? 'down' : ''}`;
    const dateLabel = timestamp => new Date(timestamp).toLocaleDateString([], {month:'short', day:'numeric'}).toUpperCase();
    $('chartStart').textContent = dateLabel(history[0].t);
    $('chartQuarter').textContent = history.length > 2 ? dateLabel(history[Math.floor((history.length - 1) / 3)].t) : '';
    $('chartMid').textContent = history.length > 2 ? dateLabel(history[Math.floor((history.length - 1) * 2 / 3)].t) : '';
    $('chartEnd').textContent = 'NOW';
    $('portfolioChart').setAttribute('aria-label', `Verified portfolio history for ${selectedRange}`);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    return Uint8Array.from(atob(value), char => char.charCodeAt(0));
  }

  async function hashPassword(password, saltBase64) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt:base64ToBytes(saltBase64), iterations:150000, hash:'SHA-256'}, material, 256);
    return bytesToBase64(new Uint8Array(bits));
  }

  function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let difference = 0;
    for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return difference === 0;
  }

  function currentAccount() {
    const sessionId = localStorage.getItem(KEYS.session);
    return read(KEYS.accounts, []).find(account => account.id === sessionId) || null;
  }

  function loadScopedWorkspace() {
    priceHistory = new Map();
    if (pythCatalog.length) hydrateWatchlist();
    else {
      assets = DEFAULT_ASSETS.map(asset => ({...asset}));
      selectedAsset = assets[0] || null;
      renderAssets($('assetSearch').value);
    }
    renderAccount();
    renderAlerts();
    updateSettingsUI();
    renderPortfolio();
    schedulePriceRefresh();
    if (pythCatalog.length) Promise.all([refreshFavoritePrices(), refreshWalletBalances()]).catch(() => {});
  }

  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll('[data-auth-mode]').forEach(button => button.classList.toggle('active', button.dataset.authMode === mode));
    $('nameField').hidden = mode !== 'signup';
    $('authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    $('authSubmit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    $('authTitle').textContent = mode === 'signup' ? 'Create your Pablo.' : 'Enter Pablo.';
    $('authError').textContent = '';
  }

  function openAuth(mode = 'signin') {
    setAuthMode(mode);
    $('authModal').classList.add('open');
    setTimeout(() => (mode === 'signup' ? $('authName') : $('authEmail')).focus(), 40);
  }

  function closeAuth() {
    $('authModal').classList.remove('open');
    $('authForm').reset();
    $('authError').textContent = '';
  }

  async function submitAuth(event) {
    event.preventDefault();
    const name = $('authName').value.trim();
    const email = $('authEmail').value.trim().toLowerCase();
    const password = $('authPassword').value;
    $('authError').textContent = '';
    if (password.length < 8) { $('authError').textContent = 'Use at least 8 characters.'; return; }
    const accounts = read(KEYS.accounts, []);
    const existing = accounts.find(account => account.email === email);
    $('authSubmit').disabled = true;
    $('authSubmit').textContent = authMode === 'signup' ? 'Creating…' : 'Checking…';
    try {
      if (authMode === 'signup') {
        if (!name) throw new Error('Add your name.');
        if (existing) throw new Error('An account with this email already exists on this device.');
        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        const salt = bytesToBase64(saltBytes);
        const account = {id:crypto.randomUUID(), name, email, salt, hash:await hashPassword(password, salt), createdAt:Date.now()};
        accounts.push(account);
        write(KEYS.accounts, accounts);
        localStorage.setItem(KEYS.session, account.id);
        closeAuth();
        showToast('Account created securely on this device');
      } else {
        if (!existing) throw new Error('No account with this email exists on this device.');
        const candidate = await hashPassword(password, existing.salt);
        if (!constantTimeEqual(candidate, existing.hash)) throw new Error('That password is not correct.');
        localStorage.setItem(KEYS.session, existing.id);
        closeAuth();
        showToast(`Welcome back, ${existing.name.split(' ')[0]}`);
      }
      loadScopedWorkspace();
    } catch (error) {
      $('authError').textContent = error.message || 'Account request failed.';
    } finally {
      $('authSubmit').disabled = false;
      $('authSubmit').textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
    }
  }

  function renderAccount() {
    const account = currentAccount();
    const avatar = $('accountBtn');
    if (account) {
      avatar.textContent = account.name.split(/\s+/).map(part => part[0]).slice(0,2).join('').toUpperCase();
      avatar.title = account.email;
      $('accountPrimaryBtn').textContent = 'Sign out';
      $('accountState').innerHTML = `<div class="eyebrow">Signed in</div><h3>${esc(account.name)}</h3><p>${esc(account.email)}<br>Encrypted device account · private watchlist, wallets and alerts · created ${new Date(account.createdAt).toLocaleDateString()}</p><div class="account-actions"><button class="tiny-btn" id="switchAccountBtn">Switch account</button><button class="tiny-btn" id="signOutBtn">Sign out</button></div>`;
      $('switchAccountBtn').addEventListener('click', () => openAuth('signin'));
      $('signOutBtn').addEventListener('click', signOut);
    } else {
      avatar.textContent = 'PL';
      avatar.title = 'Create or sign in to your account';
      $('accountPrimaryBtn').textContent = 'Create account';
      $('accountState').innerHTML = '<div class="eyebrow">Device account</div><h3>Make Pablo yours.</h3><p>Create a password-protected identity for this browser. Cloud sync is not configured yet.</p><div class="account-actions"><button class="btn primary" id="createAccountInline">Create account</button><button class="btn" id="signInInline">Sign in</button></div>';
      $('createAccountInline').addEventListener('click', () => openAuth('signup'));
      $('signInInline').addEventListener('click', () => openAuth('signin'));
    }
    renderWallets();
  }

  function signOut() {
    localStorage.removeItem(KEYS.session);
    loadScopedWorkspace();
    showToast('Signed out on this device');
  }

  function saveWallet(wallet) {
    const workspace = getWorkspace();
    const wallets = workspace.wallets.slice();
    const index = wallets.findIndex(item => item.type === wallet.type && item.address.toLowerCase() === wallet.address.toLowerCase());
    if (index >= 0) wallets[index] = {...wallets[index], ...wallet};
    else wallets.push({...wallet, connectedAt:Date.now()});
    updateWorkspace({wallets});
    renderWallets();
    renderPortfolio();
  }

  function renderWallets() {
    const wallets = getWorkspace().wallets;
    $('walletList').innerHTML = wallets.length ? wallets.map((wallet, index) => {
      const nativePrice = wallet.assetSymbol ? priceForSymbol(wallet.assetSymbol) : 0;
      const balanceLine = wallet.type === 'hyperliquid'
        ? `${money(Number(wallet.usdValue) || 0)} account value · ${Number(wallet.positionCount) || 0} open positions`
        : Number.isFinite(Number(wallet.balance))
          ? `${Number(wallet.balance).toLocaleString(undefined,{maximumFractionDigits:6})} ${esc(wallet.assetSymbol || '')}${nativePrice ? ` · ${money(Number(wallet.balance) * nativePrice)}` : ''}`
          : 'Balance waiting for sync';
      return `<div class="wallet-row"><div class="wallet-icon">${wallet.type === 'solana' ? '◎' : wallet.type === 'hyperliquid' ? 'H' : '◇'}</div><div><strong>${esc(wallet.label)}</strong><small title="${esc(wallet.address)}">${esc(shortAddress(wallet.address))}${wallet.chain ? ` · ${esc(wallet.chain)}` : ''}<br>${balanceLine}${wallet.balanceError ? ` · ${esc(wallet.balanceError)}` : ''}</small></div><button class="tiny-btn" data-forget-wallet="${index}">Forget</button></div>`;
    }).join('') : '<div class="empty-state">No wallets connected yet.<br>Approve a connection to sync verified balances.</div>';
    document.querySelectorAll('[data-forget-wallet]').forEach(button => button.addEventListener('click', () => {
      const next = getWorkspace().wallets.slice();
      next.splice(Number(button.dataset.forgetWallet), 1);
      updateWorkspace({wallets:next});
      renderWallets();
      renderPortfolio();
      showToast('Wallet removed from Pablo');
    }));
  }

  function openConnect() {
    $('connectModal').classList.add('open');
    setTimeout(() => document.querySelector('.provider').focus(), 40);
  }

  function closeConnect() {
    $('connectModal').classList.remove('open');
  }

  async function connectWallet(type) {
    if (type === 'ibkr') {
      closeConnect();
      setView('Accounts');
      showToast('IBKR requires a secure server authorization flow. It is not enabled yet.', 5200);
      return;
    }
    const providerButton = document.querySelector(`[data-provider="${type}"]`);
    const original = providerButton.innerHTML;
    providerButton.disabled = true;
    providerButton.innerHTML = '<strong>Waiting for approval…</strong><small>Check your wallet extension</small>';
    try {
      if (type === 'solana') {
        const provider = window.phantom?.solana || window.solana;
        if (!provider?.connect) throw new Error('No Solana wallet detected. Install or unlock Phantom, Backpack, or Solflare.');
        const result = await provider.connect();
        const address = result?.publicKey?.toString() || provider.publicKey?.toString();
        if (!address) throw new Error('The Solana wallet did not return an address.');
        const balance = await fetchSolanaBalance(address).catch(() => null);
        saveWallet({type:'solana', label:'Solana wallet', address, chain:'Solana', assetSymbol:'SOL', balance, balanceUpdatedAt:balance == null ? null : Date.now()});
      } else {
        const provider = window.ethereum;
        if (!provider?.request) throw new Error('No Ethereum wallet detected. Install or unlock MetaMask or Rabby.');
        const accounts = await provider.request({method:'eth_requestAccounts'});
        const address = accounts?.[0];
        if (!address) throw new Error('The wallet did not return an address.');
        const chainId = await provider.request({method:'eth_chainId'}).catch(() => null);
        if (type === 'hyperliquid') {
          const account = await fetchHyperliquidAccount(address).catch(() => ({usdValue:0, positionCount:0}));
          saveWallet({type, label:'Hyperliquid account', address, chain:'HyperCore', ...account, balanceUpdatedAt:Date.now()});
        } else {
          const raw = await provider.request({method:'eth_getBalance', params:[address, 'latest']}).catch(() => null);
          const balance = raw ? Number(BigInt(raw)) / 1e18 : null;
          const chainNumber = chainId ? parseInt(chainId, 16) : null;
          const ethNativeChains = [1,10,42161,8453,59144,324];
          saveWallet({type, label:'Ethereum wallet', address, chain:chainNumber ? `chain ${chainNumber}` : 'EVM', assetSymbol:ethNativeChains.includes(chainNumber) ? 'ETH' : null, balance, balanceUpdatedAt:balance == null ? null : Date.now(), balanceError:chainNumber && !ethNativeChains.includes(chainNumber) ? 'Native asset pricing not supported on this chain yet' : null});
        }
      }
      closeConnect();
      setView('Accounts');
      await refreshFavoritePrices().catch(() => {});
      showToast('Wallet connected and verified balances synced');
    } catch (error) {
      showToast(error.code === 4001 ? 'Connection cancelled in your wallet' : (error.message || 'Wallet connection failed'), 5200);
    } finally {
      providerButton.disabled = false;
      providerButton.innerHTML = original;
    }
  }

  function renderAlerts() {
    const alerts = getWorkspace().alerts;
    $('alertList').innerHTML = alerts.length ? alerts.map((alert, index) => `<div class="alert-row"><div><strong>${esc(alert.symbol)}</strong><div class="feed">${alert.lastTriggeredAt ? `Triggered ${new Date(alert.lastTriggeredAt).toLocaleString()}` : `Monitoring live Pyth price · created ${new Date(alert.createdAt).toLocaleDateString()}`}</div></div><span class="${alert.lastTriggeredAt ? 'pos' : ''}">${alert.direction === 'above' ? 'Above' : 'Below'} ${money(alert.target)}</span><button class="tiny-btn" data-delete-alert="${index}">Delete</button></div>`).join('') : '<div class="empty-state">No alert levels yet. Create one above.</div>';
    document.querySelectorAll('[data-delete-alert]').forEach(button => button.addEventListener('click', () => {
      const alerts = getWorkspace().alerts.slice();
      alerts.splice(Number(button.dataset.deleteAlert), 1);
      updateWorkspace({alerts});
      renderAlerts();
    }));
  }

  function submitAlert(event) {
    event.preventDefault();
    const symbol = $('alertSymbol').value.trim().toUpperCase();
    const target = Number($('alertTarget').value);
    if (!symbol || !Number.isFinite(target) || target <= 0) return;
    const feed = pythCatalog.length ? findFeed(symbol.includes('/') ? symbol : `${symbol}/USD`) : null;
    if (pythCatalog.length && !feed) { showToast(`No Pyth feed found for ${symbol}`); return; }
    const alerts = getWorkspace().alerts.slice();
    alerts.push({symbol:feed ? feedLabel(feed) : symbol, feedId:feed?.id.replace(/^0x/, ''), target, direction:$('alertDirection').value, createdAt:Date.now()});
    updateWorkspace({alerts});
    event.target.reset();
    renderAlerts();
    refreshFavoritePrices().catch(() => {});
    showToast(`Live alert created for ${feed ? feedLabel(feed) : symbol}`);
  }

  function checkAlerts() {
    const alerts = getWorkspace().alerts.slice();
    let changed = false;
    let triggeredMessage = '';
    alerts.forEach(alert => {
      const id = alert.feedId || findFeed(alert.symbol)?.id.replace(/^0x/, '');
      const live = id ? feedPrices.get(id) : null;
      if (!live) return;
      const triggered = alert.direction === 'above' ? live.price >= alert.target : live.price <= alert.target;
      if (triggered && (!alert.lastTriggeredAt || Date.now() - alert.lastTriggeredAt > 3600000)) {
        alert.lastTriggeredAt = Date.now();
        alert.lastPrice = live.price;
        changed = true;
        if (!triggeredMessage) triggeredMessage = `${alert.symbol} is ${money(live.price)} — alert triggered`;
      }
    });
    if (changed) {
      updateWorkspace({alerts});
      renderAlerts();
      showToast(triggeredMessage, 5200);
    }
  }

  function updateSettingsUI() {
    const preferences = getWorkspace().preferences;
    $('privacySwitch').classList.toggle('on', Boolean(preferences.privacy));
    $('privacySwitch').setAttribute('aria-checked', String(Boolean(preferences.privacy)));
    $('refreshSwitch').classList.toggle('on', preferences.refresh !== false);
    $('refreshSwitch').setAttribute('aria-checked', String(preferences.refresh !== false));
    hidden = Boolean(preferences.privacy);
    document.querySelectorAll('.balance').forEach(el => el.classList.toggle('hidden-balance', hidden));
  }

  function togglePreference(key) {
    const preferences = {...getWorkspace().preferences};
    preferences[key] = key === 'privacy' ? !hidden : preferences.refresh === false;
    updateWorkspace({preferences});
    updateSettingsUI();
    schedulePriceRefresh();
    showToast(key === 'privacy' ? (preferences.privacy ? 'Privacy mode enabled' : 'Privacy mode disabled') : (preferences.refresh ? 'Live refresh enabled' : 'Live refresh paused'));
  }

  function clearDeviceData() {
    if (!window.confirm('Remove every Pablo account, wallet, alert and preference stored in this browser?')) return;
    [...Array(localStorage.length)].map((_, index) => localStorage.key(index)).filter(Boolean).filter(key => key.startsWith('pablo.')).forEach(key => localStorage.removeItem(key));
    loadScopedWorkspace();
    showToast('Pablo device data cleared');
  }

  function updateSectionGrid() {
    document.querySelectorAll('.section-grid').forEach(grid => {
      const visible = [...grid.children].filter(child => !child.hidden).length;
      grid.classList.toggle('single', visible === 1);
      grid.style.display = visible ? '' : 'none';
    });
  }

  function setView(name, announce = false) {
    currentView = name;
    document.querySelectorAll('.nav button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    document.querySelectorAll('.view-item').forEach(item => {
      const groups = (item.dataset.groups || '').split(/\s+/);
      item.hidden = name !== 'Overview' && !groups.includes(name);
    });
    updateSectionGrid();
    const copy = viewCopy[name] || viewCopy.Overview;
    $('pageEyebrow').textContent = copy[0];
    $('pageTitle').textContent = copy[1];
    $('pageSub').textContent = copy[2];
    $('rangeControl').hidden = !['Overview','Portfolio'].includes(name);
    document.querySelector('.sidebar').classList.remove('open');
    $('mobileMenuBtn').setAttribute('aria-expanded', 'false');
    window.scrollTo({top:0, behavior:'smooth'});
    if ((name === 'Overview' || name === 'Markets') && pythCatalog.length) refreshUniversePrices().catch(handleUniverseError);
    if (announce) showToast(`${name} workspace selected`);
  }

  const fallbackNews = [
    {cat:'Markets', title:'Live intelligence is reconnecting', source:'Pablo status', age:'Retrying', desc:'No cached headline is being presented as current market news.'},
    {cat:'Crypto', title:'Crypto wire awaiting a verified response', source:'Pablo status', age:'Retrying', desc:'Fresh stories will appear automatically when the live source responds.'},
    {cat:'Startups', title:'Startup wire awaiting a verified response', source:'Pablo status', age:'Retrying', desc:'Pablo keeps unavailable data explicit instead of filling the feed with samples.'}
  ];
  let newsItems = fallbackNews;

  function renderNews(category = 'All') {
    const list = category === 'All' ? newsItems : newsItems.filter(item => item.cat === category);
    const show = (list.length ? list : newsItems).slice(0,3);
    $('newsGrid').innerHTML = show.map((item, index) => {
      const url = safeUrl(item.url);
      const tag = url === '#' ? 'article' : 'a';
      const link = url === '#' ? '' : ` href="${esc(url)}" target="_blank" rel="noreferrer"`;
      return `<${tag} class="story ${index === 0 ? 'hero-story' : ''}"${link}><span class="tag">${esc(item.cat)}</span><h3>${esc(item.title)}</h3><p>${esc(item.desc || 'A developing story selected for its relevance to markets, capital and technology.')}</p><footer><span>${esc(item.source)}</span><span>·</span><span>${esc(item.age)}</span></footer></${tag}>`;
    }).join('');
  }

  async function loadNews() {
    try {
      const queries = [{q:'crypto defi',cat:'Crypto'},{q:'startup funding',cat:'Startups'},{q:'markets economy',cat:'Markets'}];
      const batches = await Promise.all(queries.map(async query => {
        const response = await fetch(`https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=3&query=${encodeURIComponent(query.q)}`);
        const data = await response.json();
        return data.hits.filter(item => item.title).slice(0,2).map(item => ({cat:query.cat, title:item.title, source:new URL(safeUrl(item.url) === '#' ? 'https://news.ycombinator.com' : item.url).hostname.replace('www.',''), age:relativeTime(item.created_at), url:safeUrl(item.url) === '#' ? `https://news.ycombinator.com/item?id=${item.objectID}` : item.url, desc:'A fresh signal from the live technology and capital ecosystem.'}));
      }));
      const fresh = batches.flat();
      if (fresh.length >= 3) { newsItems = fresh; renderNews(); }
    } catch (_) {}
  }

  async function loadFearGreed() {
    try {
      const response = await fetch('https://api.alternative.me/fng/?limit=1&format=json');
      const data = await response.json();
      const fear = data.data?.[0];
      if (!fear) return;
      const value = Number(fear.value);
      $('fearValue').textContent = value;
      $('fearLabel').textContent = fear.value_classification;
      $('fearUpdated').textContent = 'Updated now';
      $('pulseTitle').textContent = value > 74 ? 'Crowded optimism.' : value > 54 ? 'Risk-on, with discipline.' : value < 26 ? 'Fear is dominant.' : 'A balanced tape.';
      $('pulseCopy').textContent = `The crypto sentiment index is ${fear.value_classification.toLowerCase()} at ${value}/100. Treat it as context, not a trading signal.`;
    } catch (_) {
      $('fearUpdated').textContent = 'Unavailable';
      $('fearValue').textContent = '—';
      $('fearLabel').textContent = 'Offline';
      $('pulseTitle').textContent = 'Sentiment feed unavailable.';
      $('pulseCopy').textContent = 'Pablo will retry without substituting a sample value.';
    }
  }

  const rangePaths = {
    '1D':'M0 141 C65 152 90 100 148 125 S244 139 307 90 S391 112 466 67 S586 78 660 37 S721 39 760 22',
    '1W':'M0 160 C57 147 90 164 142 132 S224 153 281 112 S371 129 426 91 S521 73 584 84 S692 37 760 22',
    '1M':'M0 151 C45 146 60 158 101 142 S155 121 190 130 S239 111 279 116 S332 86 369 95 S412 117 448 89 S503 68 540 77 S592 44 631 52 S687 31 760 22',
    '3M':'M0 171 C92 154 126 111 204 132 S313 71 379 96 S481 54 549 77 S646 28 760 22',
    '1Y':'M0 175 C70 169 101 145 163 153 S273 116 332 129 S425 75 485 95 S587 42 650 62 S716 30 760 22',
    'ALL':'M0 177 C92 176 117 154 189 158 S286 124 350 136 S462 88 525 102 S626 52 692 66 S730 35 760 22'
  };

  function bindEvents() {
    document.querySelectorAll('.range button').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('.range button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      selectedRange = button.dataset.range;
      renderPortfolioChart();
      showToast(`Performance range: ${button.dataset.range}`);
    }));
    document.querySelectorAll('.nav button').forEach(button => button.addEventListener('click', () => setView(button.dataset.view, true)));
    $('mobileMenuBtn').addEventListener('click', () => {
      const open = document.querySelector('.sidebar').classList.toggle('open');
      $('mobileMenuBtn').setAttribute('aria-expanded', String(open));
    });
    $('assetSearch').addEventListener('input', event => {
      renderAssets(event.target.value);
      if (event.target.value && currentView !== 'Overview' && currentView !== 'Markets') setView('Markets');
      $('feedSearch').value = event.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { feedPage = 1; applyFeedFilters(); }, 250);
    });
    $('feedSearch').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { feedPage = 1; applyFeedFilters(); }, 250);
    });
    $('feedClass').addEventListener('change', () => { feedPage = 1; applyFeedFilters(); });
    $('feedPrev').addEventListener('click', () => { if (feedPage > 1) { feedPage -= 1; renderUniverse(); refreshUniversePrices().catch(handleUniverseError); } });
    $('feedNext').addEventListener('click', () => { if (feedPage < Math.ceil(filteredFeeds.length / PAGE_SIZE)) { feedPage += 1; renderUniverse(); refreshUniversePrices().catch(handleUniverseError); } });
    $('catalogRefresh').addEventListener('click', () => refreshUniversePrices().then(() => showToast('Visible Pyth feeds refreshed')).catch(handleUniverseError));
    $('refreshBtn').addEventListener('click', () => Promise.all([refreshFavoritePrices(), refreshWalletBalances()]).then(() => showToast('Prices and balances refreshed')).catch(() => showToast('Refresh is temporarily unavailable')));
    $('addAssetBtn').addEventListener('click', () => { setView('Markets'); $('feedSearch').value = ''; feedPage = 1; applyFeedFilters(); $('feedSearch').focus(); $('pythUniverse').scrollIntoView({behavior:'smooth'}); showToast('Search, then press “+ Add” on any Pyth feed'); });
    $('rebalanceBtn').addEventListener('click', () => showToast(getWorkspace().wallets.length ? 'Allocation uses verified balances only — trading remains disabled' : 'Connect a wallet before running allocation analysis'));
    $('hideBtn').addEventListener('click', () => {
      hidden = !hidden;
      document.querySelectorAll('.balance').forEach(el => el.classList.toggle('hidden-balance', hidden));
      showToast(hidden ? 'Balances hidden' : 'Balances visible');
    });
    $('connectBtn').addEventListener('click', openConnect);
    $('addWalletBtn').addEventListener('click', openConnect);
    $('refreshWalletsBtn').addEventListener('click', () => Promise.all([refreshWalletBalances(), refreshFavoritePrices()]).then(() => showToast('Wallet balances synced')).catch(() => showToast('Wallet sync is temporarily unavailable')));
    document.querySelector('#connectModal .close').addEventListener('click', closeConnect);
    $('connectModal').addEventListener('click', event => { if (event.target === $('connectModal')) closeConnect(); });
    document.querySelectorAll('.provider').forEach(button => button.addEventListener('click', () => connectWallet(button.dataset.provider)));
    $('accountBtn').addEventListener('click', () => currentAccount() ? setView('Accounts') : openAuth('signup'));
    $('accountPrimaryBtn').addEventListener('click', () => currentAccount() ? signOut() : openAuth('signup'));
    document.querySelector('#authModal .close').addEventListener('click', closeAuth);
    $('authModal').addEventListener('click', event => { if (event.target === $('authModal')) closeAuth(); });
    document.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
    $('authForm').addEventListener('submit', submitAuth);
    $('alertForm').addEventListener('submit', submitAlert);
    $('privacySwitch').addEventListener('click', () => togglePreference('privacy'));
    $('refreshSwitch').addEventListener('click', () => togglePreference('refresh'));
    $('clearDataBtn').addEventListener('click', clearDeviceData);
    document.querySelectorAll('#newsTabs button').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('#newsTabs button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      renderNews(button.dataset.news);
    }));
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('assetSearch').focus(); }
      if (event.key === 'Escape') { closeConnect(); closeAuth(); document.querySelector('.sidebar').classList.remove('open'); }
    });
  }

  function init() {
    bindEvents();
    renderAssets();
    updateTechnicals();
    renderNews();
    renderAccount();
    renderAlerts();
    updateSettingsUI();
    renderPortfolio();
    setView('Overview');
    initPyth();
    loadNews();
    loadFearGreed();
  }

  init();
})();
