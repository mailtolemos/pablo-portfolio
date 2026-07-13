(() => {
  'use strict';

  const HERMES = 'https://hermes.pyth.network';
  const PAGE_SIZE = 25;
  const KEYS = {
    accounts: 'pablo.accounts.v1',
    session: 'pablo.session.v1',
    wallets: 'pablo.wallets.v1',
    alerts: 'pablo.alerts.v1',
    preferences: 'pablo.preferences.v1'
  };
  const assets = [
    { symbol:'BTC', name:'Bitcoin', query:'BTC/USD', price:117840.12, change:2.84, confidence:.018, hue:'#f2c86b' },
    { symbol:'ETH', name:'Ethereum', query:'ETH/USD', price:3574.28, change:1.92, confidence:.024, hue:'#88a9ff' },
    { symbol:'SOL', name:'Solana', query:'SOL/USD', price:166.42, change:4.31, confidence:.042, hue:'#c9ff53' },
    { symbol:'HYPE', name:'Hyperliquid', query:'HYPE/USD', price:45.73, change:-1.18, confidence:.067, hue:'#a5b3ff' },
    { symbol:'AAPL', name:'Apple', query:'AAPL/USD', price:212.38, change:.74, confidence:.012, hue:'#d5d7d2' },
    { symbol:'TSLA', name:'Tesla', query:'TSLA/USD', price:322.05, change:-.93, confidence:.031, hue:'#ff786f' }
  ];
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

  let selectedAsset = assets[0];
  let pythCatalog = [];
  let filteredFeeds = [];
  let feedPrices = new Map();
  let favoriteIds = {};
  let feedPage = 1;
  let currentView = 'Overview';
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

  function renderAssets(filter = '') {
    const rows = assets.filter(asset => `${asset.symbol} ${asset.name}`.toLowerCase().includes(filter.toLowerCase()));
    $('assetRows').innerHTML = rows.length ? rows.map(asset => `
      <tr data-symbol="${asset.symbol}" class="${asset.symbol === selectedAsset.symbol ? 'selected' : ''}">
        <td><div class="asset"><div class="coin" style="color:${asset.hue}">${asset.symbol.slice(0,2)}</div><div><strong>${asset.symbol}</strong><span>${asset.name}</span></div></div></td>
        <td><div class="price balance" data-price="${asset.symbol}">${money(asset.price)}</div><div class="feed">${asset.publishTime ? `updated ${new Date(asset.publishTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}` : 'reference price'}</div></td>
        <td class="${asset.change >= 0 ? 'pos' : 'neg'}">${asset.change >= 0 ? '+' : ''}${asset.change.toFixed(2)}%</td>
        <td><svg class="spark ${asset.change >= 0 ? 'pos' : 'neg'}" viewBox="0 0 70 25" aria-label="${asset.change >= 0 ? 'Up' : 'Down'} trend"><path d="${asset.change >= 0 ? sparkUp : sparkDown}"/></svg></td>
        <td><div>${asset.confidence.toFixed(3)}%</div><div class="feed">oracle interval</div></td>
      </tr>`).join('') : '<tr><td colspan="5" class="loading-row">No watchlist asset matches that search.</td></tr>';
    document.querySelectorAll('#assetRows tr[data-symbol]').forEach(row => row.addEventListener('click', () => selectAsset(row.dataset.symbol)));
    document.querySelectorAll('.balance').forEach(el => el.classList.toggle('hidden-balance', hidden));
  }

  function selectAsset(symbol) {
    selectedAsset = assets.find(asset => asset.symbol === symbol) || assets[0];
    const score = Math.max(28, Math.min(78, 50 + selectedAsset.change * 4));
    $('technicalTitle').textContent = `${selectedAsset.name} / USD`;
    $('rsiValue').textContent = score.toFixed(1);
    $('rsiMeter').style.width = `${score}%`;
    $('bbValue').textContent = selectedAsset.change >= 0 ? `Upper ${Math.round(score + 7)}%` : `Lower ${Math.round(100 - score)}%`;
    $('bbValue').className = selectedAsset.change >= 0 ? 'pos' : 'neg';
    $('momentumValue').textContent = selectedAsset.change > 1 ? 'Bullish' : selectedAsset.change < -1 ? 'Bearish' : 'Neutral';
    renderAssets($('assetSearch').value);
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

  function resolveFavoritesFromCatalog() {
    assets.forEach(asset => {
      const wanted = asset.query.toUpperCase();
      const exact = pythCatalog.find(feed => exactSymbol(feed) === wanted)
        || pythCatalog.find(feed => exactSymbol(feed).endsWith(`.${wanted}`))
        || pythCatalog.find(feed => exactSymbol(feed).includes(wanted));
      if (exact) favoriteIds[asset.symbol] = exact.id.replace(/^0x/, '');
    });
  }

  async function refreshFavoritePrices() {
    const ids = Object.values(favoriteIds);
    if (!ids.length) return;
    const parsed = await fetchLatest(ids);
    const byId = new Map(parsed.map(item => [item.id.replace(/^0x/, ''), parsePythPrice(item)]));
    assets.forEach(asset => {
      const next = byId.get(favoriteIds[asset.symbol]);
      if (!next) return;
      Object.assign(asset, next);
      feedPrices.set(favoriteIds[asset.symbol], next);
    });
    renderAssets($('assetSearch').value);
    $('liveDot').classList.add('ok');
    $('tableDot').classList.add('ok');
    $('liveStatus').textContent = 'Pyth live';
    $('feedNote').textContent = `${ids.length} favorites verified · latest oracle prices · confidence intervals shown`;
  }

  async function loadCatalog(force = false) {
    if (pythCatalog.length && !force) return;
    $('catalogCount').textContent = 'Loading catalog…';
    const response = await fetch(`${HERMES}/v2/price_feeds`, {cache:'no-store'});
    if (!response.ok) throw new Error(`Pyth catalog failed (${response.status})`);
    const feeds = await response.json();
    pythCatalog = Array.isArray(feeds) ? feeds.filter(feed => feed && feed.id && feed.attributes) : [];
    resolveFavoritesFromCatalog();
    const classes = [...new Set(pythCatalog.map(feed => feed.attributes.asset_type || 'Other'))].sort((a,b) => a.localeCompare(b));
    $('feedClass').innerHTML = '<option value="All">All asset classes</option>' + classes.map(item => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
    $('catalogCount').textContent = `${pythCatalog.length.toLocaleString()} feeds`;
    $('catalogDot').classList.add('ok');
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
      return `<tr>
        <td><div class="feed-symbol"><strong>${esc(feedLabel(feed))}</strong><span>${esc(attrs.description || attrs.symbol || id)}</span></div></td>
        <td>${esc(attrs.asset_type || 'Other')}</td>
        <td><div class="price">${live ? money(live.price) : '—'}</div></td>
        <td>${live ? `${live.confidence.toFixed(4)}%` : '—'}</td>
        <td><span class="feed">${live ? new Date(live.publishTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}) : 'waiting'}</span></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="loading-row">No Pyth feeds match those filters.</td></tr>';
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
      await Promise.all([refreshFavoritePrices(), refreshUniversePrices()]);
    } catch (error) {
      console.warn(error);
      $('liveStatus').textContent = 'Reference mode';
      $('feedNote').textContent = 'Pyth is temporarily unavailable · showing clearly labeled reference prices';
      $('catalogCount').textContent = 'Catalog unavailable';
      $('universeRows').innerHTML = '<tr><td colspan="5" class="loading-row">The Pyth catalog could not be reached. Retry in a moment.</td></tr>';
    }
    schedulePriceRefresh();
  }

  function schedulePriceRefresh() {
    clearInterval(favoriteTimer);
    clearInterval(universeTimer);
    const preferences = read(KEYS.preferences, {privacy:false, refresh:true});
    if (preferences.refresh === false) return;
    favoriteTimer = setInterval(() => refreshFavoritePrices().catch(() => {}), 15000);
    universeTimer = setInterval(() => {
      if (currentView === 'Overview' || currentView === 'Markets') refreshUniversePrices().catch(handleUniverseError);
    }, 20000);
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
      renderAccount();
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
      $('accountState').innerHTML = `<div class="eyebrow">Signed in</div><h3>${esc(account.name)}</h3><p>${esc(account.email)}<br>Encrypted device account · created ${new Date(account.createdAt).toLocaleDateString()}</p><div class="account-actions"><button class="tiny-btn" id="switchAccountBtn">Switch account</button><button class="tiny-btn" id="signOutBtn">Sign out</button></div>`;
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
    renderAccount();
    showToast('Signed out on this device');
  }

  function saveWallet(wallet) {
    const wallets = read(KEYS.wallets, []);
    const exists = wallets.some(item => item.type === wallet.type && item.address.toLowerCase() === wallet.address.toLowerCase());
    if (!exists) wallets.push({...wallet, connectedAt:Date.now()});
    write(KEYS.wallets, wallets);
    renderWallets();
  }

  function renderWallets() {
    const wallets = read(KEYS.wallets, []);
    $('walletList').innerHTML = wallets.length ? wallets.map((wallet, index) => `<div class="wallet-row"><div class="wallet-icon">${wallet.type === 'solana' ? '◎' : '◇'}</div><div><strong>${esc(wallet.label)}</strong><small title="${esc(wallet.address)}">${esc(shortAddress(wallet.address))}${wallet.chain ? ` · ${esc(wallet.chain)}` : ''}</small></div><button class="tiny-btn" data-forget-wallet="${index}">Forget</button></div>`).join('') : '<div class="empty-state">No wallets connected yet.<br>Approve a connection to see its public address here.</div>';
    document.querySelectorAll('[data-forget-wallet]').forEach(button => button.addEventListener('click', () => {
      const next = read(KEYS.wallets, []);
      next.splice(Number(button.dataset.forgetWallet), 1);
      write(KEYS.wallets, next);
      renderWallets();
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
        saveWallet({type:'solana', label:'Solana wallet', address, chain:'Solana'});
      } else {
        const provider = window.ethereum;
        if (!provider?.request) throw new Error('No Ethereum wallet detected. Install or unlock MetaMask or Rabby.');
        const accounts = await provider.request({method:'eth_requestAccounts'});
        const address = accounts?.[0];
        if (!address) throw new Error('The wallet did not return an address.');
        const chainId = await provider.request({method:'eth_chainId'}).catch(() => null);
        saveWallet({type, label:type === 'hyperliquid' ? 'Hyperliquid address' : 'Ethereum wallet', address, chain:chainId ? `chain ${parseInt(chainId, 16)}` : 'EVM'});
      }
      closeConnect();
      setView('Accounts');
      showToast('Wallet connected — public address only');
    } catch (error) {
      showToast(error.code === 4001 ? 'Connection cancelled in your wallet' : (error.message || 'Wallet connection failed'), 5200);
    } finally {
      providerButton.disabled = false;
      providerButton.innerHTML = original;
    }
  }

  function renderAlerts() {
    const alerts = read(KEYS.alerts, []);
    $('alertList').innerHTML = alerts.length ? alerts.map((alert, index) => `<div class="alert-row"><div><strong>${esc(alert.symbol)}</strong><div class="feed">Created ${new Date(alert.createdAt).toLocaleDateString()} · saved on this device</div></div><span>${alert.direction === 'above' ? 'Above' : 'Below'} ${money(alert.target)}</span><button class="tiny-btn" data-delete-alert="${index}">Delete</button></div>`).join('') : '<div class="empty-state">No alert levels yet. Create one above.</div>';
    document.querySelectorAll('[data-delete-alert]').forEach(button => button.addEventListener('click', () => {
      const alerts = read(KEYS.alerts, []);
      alerts.splice(Number(button.dataset.deleteAlert), 1);
      write(KEYS.alerts, alerts);
      renderAlerts();
    }));
  }

  function submitAlert(event) {
    event.preventDefault();
    const symbol = $('alertSymbol').value.trim().toUpperCase();
    const target = Number($('alertTarget').value);
    if (!symbol || !Number.isFinite(target) || target <= 0) return;
    const alerts = read(KEYS.alerts, []);
    alerts.push({symbol, target, direction:$('alertDirection').value, createdAt:Date.now()});
    write(KEYS.alerts, alerts);
    event.target.reset();
    renderAlerts();
    showToast(`Alert saved for ${symbol}`);
  }

  function updateSettingsUI() {
    const preferences = read(KEYS.preferences, {privacy:false, refresh:true});
    $('privacySwitch').classList.toggle('on', Boolean(preferences.privacy));
    $('privacySwitch').setAttribute('aria-checked', String(Boolean(preferences.privacy)));
    $('refreshSwitch').classList.toggle('on', preferences.refresh !== false);
    $('refreshSwitch').setAttribute('aria-checked', String(preferences.refresh !== false));
    hidden = Boolean(preferences.privacy);
    document.querySelectorAll('.balance').forEach(el => el.classList.toggle('hidden-balance', hidden));
  }

  function togglePreference(key) {
    const preferences = read(KEYS.preferences, {privacy:false, refresh:true});
    preferences[key] = !(preferences[key] !== false);
    if (key === 'privacy') preferences[key] = !hidden;
    write(KEYS.preferences, preferences);
    updateSettingsUI();
    schedulePriceRefresh();
    showToast(key === 'privacy' ? (preferences.privacy ? 'Privacy mode enabled' : 'Privacy mode disabled') : (preferences.refresh ? 'Live refresh enabled' : 'Live refresh paused'));
  }

  function clearDeviceData() {
    if (!window.confirm('Remove every Pablo account, wallet, alert and preference stored in this browser?')) return;
    Object.values(KEYS).forEach(key => localStorage.removeItem(key));
    renderAccount();
    renderAlerts();
    updateSettingsUI();
    schedulePriceRefresh();
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
    {cat:'Markets', title:'Capital rotates toward quality as volatility settles', source:'Market brief', age:'12 min', desc:'Flows favor profitable growth and liquid majors while breadth quietly improves.'},
    {cat:'Crypto', title:'DeFi liquidity deepens as on-chain activity accelerates', source:'Protocol wire', age:'24 min', desc:'Stablecoin supply and perpetual volumes point to renewed appetite for on-chain risk.'},
    {cat:'Startups', title:'AI infrastructure funding shifts from models to deployment', source:'Venture brief', age:'41 min', desc:'Investors are following revenue into inference, observability and specialized workflows.'}
  ];
  let newsItems = fallbackNews;

  function renderNews(category = 'All') {
    const list = category === 'All' ? newsItems : newsItems.filter(item => item.cat === category);
    const show = (list.length ? list : newsItems).slice(0,3);
    $('newsGrid').innerHTML = show.map((item, index) => `<a class="story ${index === 0 ? 'hero-story' : ''}" href="${esc(safeUrl(item.url))}" ${safeUrl(item.url) !== '#' ? 'target="_blank" rel="noreferrer"' : ''}><span class="tag">${esc(item.cat)}</span><h3>${esc(item.title)}</h3><p>${esc(item.desc || 'A developing story selected for its relevance to markets, capital and technology.')}</p><footer><span>${esc(item.source)}</span><span>·</span><span>${esc(item.age)}</span></footer></a>`).join('');
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
    } catch (_) { $('fearUpdated').textContent = 'Reference'; }
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
      const path = rangePaths[button.dataset.range];
      $('portfolioLine').setAttribute('d', path);
      $('portfolioArea').setAttribute('d', `M0 180 L${path.slice(1)} L760 180Z`);
      showToast(`Performance range: ${button.dataset.range}`);
    }));
    document.querySelectorAll('.nav button').forEach(button => button.addEventListener('click', () => setView(button.dataset.view, true)));
    $('mobileMenuBtn').addEventListener('click', () => {
      const open = document.querySelector('.sidebar').classList.toggle('open');
      $('mobileMenuBtn').setAttribute('aria-expanded', String(open));
    });
    $('assetSearch').addEventListener('input', event => {
      renderAssets(event.target.value);
      if (currentView === 'Overview' || currentView === 'Markets') {
        $('feedSearch').value = event.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { feedPage = 1; applyFeedFilters(); }, 250);
      }
    });
    $('feedSearch').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { feedPage = 1; applyFeedFilters(); }, 250);
    });
    $('feedClass').addEventListener('change', () => { feedPage = 1; applyFeedFilters(); });
    $('feedPrev').addEventListener('click', () => { if (feedPage > 1) { feedPage -= 1; renderUniverse(); refreshUniversePrices().catch(handleUniverseError); } });
    $('feedNext').addEventListener('click', () => { if (feedPage < Math.ceil(filteredFeeds.length / PAGE_SIZE)) { feedPage += 1; renderUniverse(); refreshUniversePrices().catch(handleUniverseError); } });
    $('catalogRefresh').addEventListener('click', () => refreshUniversePrices().then(() => showToast('Visible Pyth feeds refreshed')).catch(handleUniverseError));
    $('refreshBtn').addEventListener('click', () => refreshFavoritePrices().then(() => showToast('Pyth favorites refreshed')).catch(() => showToast('Pyth refresh is temporarily unavailable')));
    $('addAssetBtn').addEventListener('click', () => { setView('Markets'); $('feedSearch').focus(); showToast('Search all Pyth feeds to find an asset'); });
    $('rebalanceBtn').addEventListener('click', () => showToast('Rebalance analysis ready — no trades placed'));
    $('hideBtn').addEventListener('click', () => {
      hidden = !hidden;
      document.querySelectorAll('.balance').forEach(el => el.classList.toggle('hidden-balance', hidden));
      showToast(hidden ? 'Balances hidden' : 'Balances visible');
    });
    $('connectBtn').addEventListener('click', openConnect);
    $('addWalletBtn').addEventListener('click', openConnect);
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
    renderNews();
    renderAccount();
    renderAlerts();
    updateSettingsUI();
    setView('Overview');
    initPyth();
    loadNews();
    loadFearGreed();
  }

  init();
})();
