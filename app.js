// =============================================
// 台股模擬投資平台 - app.js
// =============================================

// ===== STATE =====
const INIT_CASH = 1_000_000;
let state = {
  cash: INIT_CASH,
  holdings: {},      // { symbol: { qty, avgCost, name } }
  orders: [],        // { id, symbol, name, side, qty, price, time, total }
  watchlist: ['2330', '2317', '2454', '0050', '2303'],
  selectedSymbol: null,
  selectedName: '',
  currentPrice: null,
  chartPeriod: '1d',
  orderSide: 'buy',
  priceCache: {},    // { symbol: { price, change, pct, high, low, open, prev, vol, mktcap, name } }
  chart: null,
};

// Save / Load from localStorage
function saveState() {
  const s = { cash: state.cash, holdings: state.holdings, orders: state.orders, watchlist: state.watchlist };
  localStorage.setItem('twStockSim', JSON.stringify(s));
}
function loadState() {
  const raw = localStorage.getItem('twStockSim');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    state.cash = s.cash ?? INIT_CASH;
    state.holdings = s.holdings ?? {};
    state.orders = s.orders ?? [];
    state.watchlist = s.watchlist ?? state.watchlist;
  } catch {}
}

// ===== POPULAR STOCKS DB (fallback names) =====
const STOCK_NAMES = {
  '2330': '台積電', '2317': '鴻海', '2454': '聯發科', '0050': '元大台灣50',
  '2303': '聯電', '2882': '國泰金', '2881': '富邦金', '2886': '兆豐金',
  '3008': '大立光', '2308': '台達電', '2412': '中華電', '2002': '中鋼',
  '1301': '台塑', '1303': '南亞', '2891': '中信金', '2884': '玉山金',
  '3711': '日月光', '2357': '華碩', '2382': '廣達', '3045': '台灣大',
  '4938': '和碩', '2609': '陽明', '2615': '萬海', '2603': '長榮',
  '6505': '台塑化', '2379': '瑞昱', '2395': '研華', '3034': '聯詠',
  '0056': '元大高股息', '00878': '國泰永續高股息', '00919': '群益台灣精選高息',
  '2207': '和泰車', '2912': '統一超', '5871': '中租控股', '6669': '緯穎',
};

function getStockName(sym) {
  return STOCK_NAMES[sym] || sym;
}

// ===== YAHOO FINANCE PROXY =====
// Using allorigins.win as CORS proxy to reach Yahoo Finance
async function fetchYahooQuote(symbols) {
  const list = Array.isArray(symbols) ? symbols : [symbols];
  const syms = list.map(s => s.includes('.') ? s : s + '.TW').join(',');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${syms}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketPreviousClose,regularMarketVolume,marketCap,shortName,longName`;
  const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxy);
  const data = await res.json();
  return JSON.parse(data.contents);
}

async function fetchYahooChart(symbol, period, interval) {
  const sym = symbol.includes('.') ? symbol : symbol + '.TW';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${period}&interval=${interval}&includePrePost=false`;
  const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxy);
  const data = await res.json();
  return JSON.parse(data.contents);
}

// ===== CLOCK & MARKET STATUS =====
function updateClock() {
  const now = new Date();
  const tw = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(now);
  const parts = Object.fromEntries(tw.map(p => [p.type, p.value]));
  const timeStr = `${parts.hour}:${parts.minute}:${parts.second}`;
  document.getElementById('clock').textContent = timeStr;

  const h = parseInt(parts.hour), m = parseInt(parts.minute);
  const dayTW = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(now);
  const isWeekday = !['Sat', 'Sun'].includes(dayTW);
  const isOpen = isWeekday && ((h === 9 && m >= 0) || (h >= 10 && h < 13) || (h === 13 && m < 30));

  const dot = document.getElementById('marketDot');
  const label = document.getElementById('marketLabel');
  dot.className = 'market-dot ' + (isOpen ? 'open' : 'closed');
  label.textContent = isOpen ? '台灣股市 開盤中' : '台灣股市 休市中';
}

// ===== WATCHLIST RENDERING =====
async function refreshWatchlistPrices() {
  if (!state.watchlist.length) return;
  try {
    const result = await fetchYahooQuote(state.watchlist);
    const quotes = result?.quoteResponse?.result || [];
    quotes.forEach(q => {
      const sym = q.symbol.replace('.TW', '');
      state.priceCache[sym] = {
        price: q.regularMarketPrice,
        change: q.regularMarketChange,
        pct: q.regularMarketChangePercent,
        open: q.regularMarketOpen,
        high: q.regularMarketDayHigh,
        low: q.regularMarketDayLow,
        prev: q.regularMarketPreviousClose,
        vol: q.regularMarketVolume,
        mktcap: q.marketCap,
        name: q.shortName || q.longName || getStockName(sym),
      };
    });
    renderWatchlist();
    updateNavSummary();
    if (state.selectedSymbol && state.priceCache[state.selectedSymbol]) {
      updateStockHeader(state.selectedSymbol);
    }
  } catch (e) {
    console.warn('Price fetch failed', e);
  }
}

function renderWatchlist() {
  const el = document.getElementById('watchlist');
  if (!state.watchlist.length) {
    el.innerHTML = '<div class="empty-state">自選股清單是空的<br><small>點擊「新增」加入個股</small></div>';
    return;
  }
  el.innerHTML = state.watchlist.map(sym => {
    const c = state.priceCache[sym];
    const name = (c?.name) || getStockName(sym);
    const price = c ? c.price.toFixed(2) : '--';
    const pct = c ? c.pct : null;
    const cls = pct === null ? 'flat' : pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    const changeStr = c ? `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%` : '--';
    const isActive = sym === state.selectedSymbol ? 'active' : '';
    return `
      <div class="watch-item ${isActive}" onclick="selectStock('${sym}')">
        <div class="wi-left">
          <div class="wi-code">${sym}</div>
          <div class="wi-name">${name}</div>
        </div>
        <div class="wi-right">
          <div class="wi-price ${cls}">${price}</div>
          <div class="wi-change ${cls}">${changeStr}</div>
        </div>
      </div>`;
  }).join('');
}

// ===== SELECT STOCK =====
async function selectStock(sym) {
  state.selectedSymbol = sym;
  state.currentPrice = state.priceCache[sym]?.price || null;
  state.selectedName = state.priceCache[sym]?.name || getStockName(sym);

  renderWatchlist();
  updateStockHeader(sym);
  updateOrderEstimate();
  document.getElementById('chartPlaceholder').style.display = 'none';
  await loadChart(sym, state.chartPeriod);
}

function updateStockHeader(sym) {
  const c = state.priceCache[sym];
  document.getElementById('selectedSymbol').textContent = sym;
  document.getElementById('selectedName').textContent = state.selectedName;
  document.getElementById('selectedExchange').textContent = '台灣證券交易所 · TWD';

  if (!c) return;
  const price = c.price.toFixed(2);
  const chg = c.change;
  const pct = c.pct;
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';

  document.getElementById('currentPrice').textContent = price;
  document.getElementById('currentPrice').className = `current-price ${cls}`;
  document.getElementById('priceChange').textContent = `${arrow} ${Math.abs(chg).toFixed(2)} (${Math.abs(pct).toFixed(2)}%)`;
  document.getElementById('priceChange').className = `price-change ${cls}`;

  document.getElementById('statOpen').textContent = c.open?.toFixed(2) ?? '--';
  document.getElementById('statHigh').textContent = c.high?.toFixed(2) ?? '--';
  document.getElementById('statLow').textContent = c.low?.toFixed(2) ?? '--';
  document.getElementById('statPrev').textContent = c.prev?.toFixed(2) ?? '--';
  document.getElementById('statVol').textContent = formatVol(c.vol);
  document.getElementById('statMktCap').textContent = formatMktCap(c.mktcap);

  state.currentPrice = c.price;
  updateOrderEstimate();
}

function formatVol(v) {
  if (!v) return '--';
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '億';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '萬';
  return v.toLocaleString();
}
function formatMktCap(v) {
  if (!v) return '--';
  if (v >= 1e12) return (v / 1e12).toFixed(2) + '兆';
  if (v >= 1e8) return (v / 1e8).toFixed(0) + '億';
  return v.toLocaleString();
}

// ===== CHART =====
const PERIOD_CONFIG = {
  '1d': { range: '1d', interval: '5m' },
  '5d': { range: '5d', interval: '15m' },
  '1mo': { range: '1mo', interval: '1d' },
  '3mo': { range: '3mo', interval: '1d' },
  '1y': { range: '1y', interval: '1wk' },
};

async function loadChart(sym, period) {
  const cfg = PERIOD_CONFIG[period];
  try {
    const raw = await fetchYahooChart(sym, cfg.range, cfg.interval);
    const result = raw?.chart?.result?.[0];
    if (!result) { showToast('圖表資料載入失敗', 'error'); return; }

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const labels = timestamps.map(t => {
      const d = new Date(t * 1000);
      if (period === '1d' || period === '5d') {
        return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' });
      }
      return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Taipei' });
    });

    const validPairs = labels.map((l, i) => ({ l, v: closes[i] })).filter(p => p.v != null);
    const firstVal = validPairs[0]?.v;
    const isUp = (validPairs[validPairs.length - 1]?.v ?? firstVal) >= firstVal;
    const color = isUp ? '#f85149' : '#3fb950';

    drawChart(validPairs.map(p => p.l), validPairs.map(p => p.v), color);
  } catch (e) {
    console.warn('Chart error', e);
    showToast('圖表載入錯誤，請稍後再試', 'error');
  }
}

function drawChart(labels, data, color) {
  const ctx = document.getElementById('priceChart').getContext('2d');
  if (state.chart) { state.chart.destroy(); state.chart = null; }

  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, color + '33');
  gradient.addColorStop(1, color + '00');

  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: gradient,
        borderWidth: 1.5,
        fill: true,
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: color,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#7d8590',
          bodyColor: '#e6edf3',
          bodyFont: { family: 'Consolas, monospace', size: 13 },
          callbacks: {
            label: ctx => ` ${ctx.parsed.y.toFixed(2)} 元`,
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#21262d', drawBorder: false },
          ticks: {
            color: '#7d8590', maxTicksLimit: 8, maxRotation: 0,
            font: { size: 11 }
          },
        },
        y: {
          position: 'right',
          grid: { color: '#21262d', drawBorder: false },
          ticks: {
            color: '#7d8590', font: { family: 'Consolas', size: 11 },
            callback: v => v.toFixed(1)
          }
        }
      }
    }
  });
}

function switchChart(period, btn) {
  state.chartPeriod = period;
  document.querySelectorAll('.chart-tabs .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (state.selectedSymbol) loadChart(state.selectedSymbol, period);
}

// ===== ORDER SYSTEM =====
function setOrderSide(side, btn) {
  state.orderSide = side;
  document.querySelectorAll('.order-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const submitBtn = document.getElementById('submitOrderBtn');
  if (side === 'buy') {
    submitBtn.textContent = '買進下單';
    submitBtn.className = 'submit-order buy';
  } else {
    submitBtn.textContent = '賣出下單';
    submitBtn.className = 'submit-order sell-btn';
  }
  updateOrderEstimate();
}

document.getElementById('orderType').addEventListener('change', function() {
  document.getElementById('limitPriceRow').style.display = this.value === 'limit' ? 'flex' : 'none';
  updateOrderEstimate();
});
document.getElementById('limitPrice').addEventListener('input', updateOrderEstimate);
document.getElementById('orderQty').addEventListener('input', updateOrderEstimate);

function adjustQty(delta) {
  const el = document.getElementById('orderQty');
  const val = parseInt(el.value) || 1000;
  el.value = Math.max(1000, val + delta);
  updateOrderEstimate();
}

function updateOrderEstimate() {
  const qty = parseInt(document.getElementById('orderQty').value) || 0;
  const type = document.getElementById('orderType').value;
  const limitPx = parseFloat(document.getElementById('limitPrice').value);
  const usePx = type === 'limit' ? limitPx : state.currentPrice;
  const est = usePx && qty ? (usePx * qty).toFixed(0) : null;
  document.getElementById('estAmount').textContent = est ? `NT$ ${parseInt(est).toLocaleString()}` : '--';
  document.getElementById('availCash').textContent = `NT$ ${state.cash.toLocaleString()}`;
}

let pendingOrder = null;

function submitOrder() {
  if (!state.selectedSymbol) { showToast('請先選擇股票', 'error'); return; }
  const qty = parseInt(document.getElementById('orderQty').value) || 0;
  if (qty < 1) { showToast('請輸入有效股數', 'error'); return; }
  const type = document.getElementById('orderType').value;
  const limitPx = parseFloat(document.getElementById('limitPrice').value);
  const usePx = type === 'limit' ? limitPx : state.currentPrice;
  if (!usePx || usePx <= 0) { showToast('無法取得成交價格，請稍後再試', 'error'); return; }

  const total = usePx * qty;
  const side = state.orderSide;

  if (side === 'buy' && total > state.cash) {
    showToast(`現金不足！需要 NT$ ${total.toLocaleString()}，現有 NT$ ${state.cash.toLocaleString()}`, 'error'); return;
  }
  if (side === 'sell') {
    const held = state.holdings[state.selectedSymbol]?.qty || 0;
    if (qty > held) { showToast(`持股不足！持有 ${held} 股，欲賣 ${qty} 股`, 'error'); return; }
  }

  pendingOrder = { symbol: state.selectedSymbol, name: state.selectedName, side, qty, price: usePx, total };
  const sideLabel = side === 'buy' ? '買進' : '賣出';
  const color = side === 'buy' ? '#f85149' : '#3fb950';

  document.getElementById('modalTitle').innerHTML = `確認<span style="color:${color}">　${sideLabel}　</span>委託`;
  document.getElementById('modalBody').innerHTML = `
    <div class="modal-row"><span>股票代號</span><span class="mval">${state.selectedSymbol} ${state.selectedName}</span></div>
    <div class="modal-row"><span>委託方向</span><span class="mval" style="color:${color}">${sideLabel}</span></div>
    <div class="modal-row"><span>委託類型</span><span class="mval">${type === 'limit' ? '限價' : '市價'}</span></div>
    <div class="modal-row"><span>委託價格</span><span class="mval">NT$ ${usePx.toFixed(2)}</span></div>
    <div class="modal-row"><span>委託數量</span><span class="mval">${qty.toLocaleString()} 股（${qty/1000} 張）</span></div>
    <div class="modal-row"><span>${side === 'buy' ? '所需資金' : '預估入帳'}</span><span class="mval">NT$ ${total.toLocaleString()}</span></div>
  `;
  document.getElementById('confirmBtn').style.background = color;
  document.getElementById('confirmModal').classList.remove('hidden');
}

function confirmOrder() {
  if (!pendingOrder) return;
  const { symbol, name, side, qty, price, total } = pendingOrder;

  if (side === 'buy') {
    state.cash -= total;
    if (!state.holdings[symbol]) state.holdings[symbol] = { qty: 0, avgCost: 0, name };
    const h = state.holdings[symbol];
    h.avgCost = (h.avgCost * h.qty + price * qty) / (h.qty + qty);
    h.qty += qty;
  } else {
    state.cash += total;
    state.holdings[symbol].qty -= qty;
    if (state.holdings[symbol].qty <= 0) delete state.holdings[symbol];
  }

  state.orders.unshift({
    id: Date.now(),
    symbol, name, side, qty, price,
    total: Math.round(total),
    time: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
  });

  saveState();
  closeModal();
  renderHoldings();
  renderOrders();
  updateNavSummary();
  updateOrderEstimate();
  showToast(`${side === 'buy' ? '買進' : '賣出'} ${symbol} ${qty.toLocaleString()}股 @${price.toFixed(2)} 成功！`, 'success');
  pendingOrder = null;
}

function closeModal() { document.getElementById('confirmModal').classList.add('hidden'); }

// ===== HOLDINGS =====
function renderHoldings() {
  const el = document.getElementById('holdingsList');
  const syms = Object.keys(state.holdings);
  if (!syms.length) {
    el.innerHTML = '<div class="empty-state">尚無持股<br><small>開始下單進行模擬投資</small></div>';
    document.getElementById('portfolioSummary').innerHTML = '';
    return;
  }

  let stockValue = 0;
  let totalCost = 0;

  el.innerHTML = syms.map(sym => {
    const h = state.holdings[sym];
    const c = state.priceCache[sym];
    const curPx = c?.price || h.avgCost;
    const val = curPx * h.qty;
    const cost = h.avgCost * h.qty;
    const pnl = val - cost;
    const pct = ((curPx - h.avgCost) / h.avgCost * 100);
    stockValue += val;
    totalCost += cost;

    const cls = pnl >= 0 ? 'up' : 'down';
    const arrow = pnl >= 0 ? '▲' : '▼';
    return `
      <div class="holding-item" onclick="selectStock('${sym}')">
        <div class="hi-top">
          <div>
            <div class="hi-code">${sym}</div>
            <div class="hi-name">${h.name || getStockName(sym)}</div>
          </div>
          <div class="hi-pnl">
            <div class="hi-pnl-val ${cls}">${arrow} ${Math.abs(pnl).toLocaleString('zh-TW', {maximumFractionDigits: 0})}</div>
            <div class="hi-pnl-pct ${cls}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</div>
          </div>
        </div>
        <div class="hi-bottom">
          <span>均價 ${h.avgCost.toFixed(2)}</span>
          <span>現價 ${curPx.toFixed(2)}</span>
          <span>${(h.qty / 1000).toFixed(0)} 張</span>
          <span>市值 ${val.toLocaleString('zh-TW', {maximumFractionDigits: 0})}</span>
        </div>
      </div>`;
  }).join('');

  const totalPnl = stockValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0;
  const cls = totalPnl >= 0 ? 'up' : 'down';
  document.getElementById('portfolioSummary').innerHTML = `
    <div class="ps-row"><span class="ps-label">股票市值</span><span class="ps-value">NT$ ${stockValue.toLocaleString('zh-TW', {maximumFractionDigits: 0})}</span></div>
    <div class="ps-row"><span class="ps-label">持倉損益</span><span class="ps-value ${cls}">${totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString('zh-TW', {maximumFractionDigits: 0})} (${totalPnlPct.toFixed(2)}%)</span></div>
    <div class="ps-row"><span class="ps-label">現金餘額</span><span class="ps-value">NT$ ${state.cash.toLocaleString()}</span></div>
  `;
}

function renderOrders() {
  const el = document.getElementById('ordersList');
  if (!state.orders.length) {
    el.innerHTML = '<div class="empty-state">尚無交易紀錄</div>';
    return;
  }
  el.innerHTML = state.orders.slice(0, 50).map(o => `
    <div class="order-item">
      <div class="oi-top">
        <span class="oi-code">${o.symbol} ${o.name || ''}</span>
        <span class="oi-type ${o.side === 'buy' ? 'oi-buy' : 'oi-sell'}">${o.side === 'buy' ? '買進' : '賣出'}</span>
      </div>
      <div class="oi-bottom">
        <span>${o.qty.toLocaleString()}股</span>
        <span>@${o.price.toFixed(2)}</span>
        <span>NT$${o.total.toLocaleString()}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-subtle)">${o.time}</span>
      </div>
    </div>`).join('');
}

// ===== NAV SUMMARY =====
function updateNavSummary() {
  let stockVal = 0;
  Object.entries(state.holdings).forEach(([sym, h]) => {
    const p = state.priceCache[sym]?.price || h.avgCost;
    stockVal += p * h.qty;
  });
  const total = state.cash + stockVal;
  const initTotal = INIT_CASH;
  const pnl = total - initTotal;
  const cls = pnl >= 0 ? 'up' : 'down';

  document.getElementById('totalAsset').textContent = `NT$ ${total.toLocaleString('zh-TW', {maximumFractionDigits: 0})}`;
  document.getElementById('cashDisplay').textContent = `NT$ ${state.cash.toLocaleString()}`;
  const pnlEl = document.getElementById('totalPnl');
  pnlEl.textContent = `${pnl >= 0 ? '+' : ''}${pnl.toLocaleString('zh-TW', {maximumFractionDigits: 0})}`;
  pnlEl.className = `value ${cls}`;
}

// ===== RIGHT TABS =====
function switchRightTab(tab, btn) {
  document.querySelectorAll('.rtab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('holdingsTab').classList.toggle('hidden', tab !== 'holdings');
  document.getElementById('ordersTab').classList.toggle('hidden', tab !== 'orders');
}

// ===== SEARCH =====
function liveSearch(val) {
  const q = val.trim().toUpperCase();
  const dd = document.getElementById('searchDropdown');
  if (!q || q.length < 1) { dd.classList.add('hidden'); return; }

  const matches = Object.entries(STOCK_NAMES).filter(([code, name]) =>
    code.includes(q) || name.includes(q)
  ).slice(0, 8);

  if (!matches.length) { dd.classList.add('hidden'); return; }
  dd.innerHTML = matches.map(([code, name]) => `
    <div class="search-item" onclick="selectFromSearch('${code}', '${name}')">
      <span class="si-code">${code}</span>
      <span class="si-name">${name}</span>
    </div>`).join('');
  dd.classList.remove('hidden');
}

function selectFromSearch(sym, name) {
  document.getElementById('searchInput').value = '';
  document.getElementById('searchDropdown').classList.add('hidden');
  if (!state.watchlist.includes(sym)) {
    state.watchlist.push(sym);
    saveState();
    refreshWatchlistPrices();
  }
  selectStock(sym);
}

// ===== WATCHLIST MODAL =====
function openAddWatchModal() {
  document.getElementById('addWatchInput').value = '';
  document.getElementById('addWatchModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('addWatchInput').focus(), 100);
}
function closeAddWatchModal() { document.getElementById('addWatchModal').classList.add('hidden'); }
async function addToWatchlist() {
  const sym = document.getElementById('addWatchInput').value.trim().toUpperCase();
  if (!sym) return;
  if (state.watchlist.includes(sym)) {
    showToast(`${sym} 已在自選股清單中`, 'error');
    closeAddWatchModal(); return;
  }
  state.watchlist.push(sym);
  saveState();
  closeAddWatchModal();
  await refreshWatchlistPrices();
  showToast(`已新增 ${sym} 到自選股`, 'success');
}
document.getElementById('addWatchInput').addEventListener('keydown', e => { if (e.key === 'Enter') addToWatchlist(); });

// ===== TOAST =====
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ===== INIT =====
async function init() {
  loadState();
  updateClock();
  setInterval(updateClock, 1000);
  renderWatchlist();
  renderHoldings();
  renderOrders();
  updateNavSummary();
  updateOrderEstimate();
  await refreshWatchlistPrices();
  // Auto refresh every 60 seconds
  setInterval(async () => {
    await refreshWatchlistPrices();
    renderHoldings();
  }, 60_000);
  // Pre-select first stock
  if (state.watchlist.length > 0) {
    setTimeout(() => selectStock(state.watchlist[0]), 1200);
  }
}

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('click', e => {
  if (!e.target.closest('.search-bar')) {
    document.getElementById('searchDropdown').classList.add('hidden');
  }
});
