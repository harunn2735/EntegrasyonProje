// public/js/profitLossPage.js
(function () {
  'use strict';

  const STYLE = `
    #page-profitloss {
      padding: 8px 0 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: hidden;
    }
    .pl-shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
    }

    /* ── Toolbar ── */
    .pl-toolbar {
      background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,255,255,.92));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: var(--shadow);
    }
    .pl-toolbar-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .pl-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 4px;
    }
    .pl-subtitle {
      font-size: 13px;
      color: var(--muted);
    }
    .pl-period-tabs {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .pl-period-btn {
      padding: 7px 16px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      font-family: inherit;
      transition: .15s ease;
    }
    .pl-period-btn:hover { color: var(--text); }
    .pl-period-btn.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }

    /* ── KPI Grid ── */
    .pl-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .pl-kpi-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      box-shadow: var(--shadow);
    }
    .pl-kpi-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .4px;
      margin-bottom: 8px;
    }
    .pl-kpi-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
    }

    /* ── Tab Card ── */
    .pl-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .pl-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border);
      background: var(--bg3);
      padding: 0 4px;
    }
    .pl-tab {
      padding: 12px 18px;
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      font-family: inherit;
      transition: .15s ease;
      margin-bottom: -1px;
    }
    .pl-tab:hover { color: var(--text); }
    .pl-tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      background: var(--card);
    }

    /* ── Table ── */
    .pl-table-wrap {
      overflow-x: auto;
    }
    .pl-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .pl-table th {
      padding: 10px 14px;
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .4px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    .pl-table td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      color: var(--text);
      vertical-align: middle;
    }
    .pl-table tr:last-child td { border-bottom: none; }
    .pl-table tr:hover td { background: var(--bg3); }
    .pl-product-name {
      font-weight: 600;
      font-size: 13px;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pl-product-barcode {
      font-size: 11px;
      color: var(--muted);
      margin-top: 2px;
    }

    /* ── Badges ── */
    .pl-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .pl-badge-green { background: #dcfce7; color: var(--green); }
    .pl-badge-yellow { background: #fef9c3; color: #b45309; }
    .pl-badge-red { background: #fee2e2; color: var(--red); }

    /* ── Colors ── */
    .pl-green { color: var(--green); }
    .pl-red { color: var(--red); }
    .pl-yellow { color: var(--yellow); }
    .pl-bold { font-weight: 700; }
    .pl-mono { font-family: monospace; font-size: 12px; }

    /* ── Pagination / footer ── */
    .pl-pagination {
      padding: 12px 16px;
      font-size: 12px;
      color: var(--muted);
      border-top: 1px solid var(--border);
    }

    /* ── States ── */
    .pl-loading, .pl-empty, .pl-error {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 160px;
      font-size: 14px;
      color: var(--muted);
      padding: 24px;
    }
    .pl-error { color: var(--red); }

    /* ── Buttons ── */
    .pl-btn-primary {
      padding: 9px 20px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity .15s;
    }
    .pl-btn-primary:hover { opacity: .85; }
    .pl-btn-outline {
      padding: 8px 16px;
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--accent);
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .pl-btn-remove {
      padding: 6px 10px;
      background: #fee2e2;
      color: var(--red);
      border: none;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      font-family: inherit;
    }
    .pl-sim-btn {
      padding: 5px 12px;
      background: var(--bg3);
      color: var(--accent);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      white-space: nowrap;
    }
    .pl-sim-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

    /* ── Alerts filter ── */
    .pl-alerts-filter {
      display: flex;
      gap: 8px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .pl-filter-btn {
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg3);
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      font-family: inherit;
    }
    .pl-filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }

    /* ── Simulate form ── */
    .pl-sim-form {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 480px;
    }
    .pl-form-group { display: flex; flex-direction: column; gap: 6px; }
    .pl-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .4px;
    }
    .pl-input {
      padding: 9px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      color: var(--text);
      background: var(--bg2);
      width: 100%;
      box-sizing: border-box;
    }
    .pl-input:focus { outline: none; border-color: var(--accent); }
    .pl-hint { font-size: 12px; color: var(--muted); margin: 0; }
    .pl-sim-result-card {
      margin: 0 20px 20px;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      max-width: 440px;
    }
    .pl-sim-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 16px;
      font-size: 13px;
      border-bottom: 1px solid var(--border);
    }
    .pl-sim-row:last-child { border-bottom: none; }
    .pl-sim-divider { height: 1px; background: var(--border); margin: 0; }
    .pl-sim-total {
      font-weight: 700;
      font-size: 14px;
      background: var(--bg3);
    }

    /* ── Commission Rates Form ── */
    .pl-rates-form {
      padding: 20px;
    }
    .pl-rates-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 6px;
    }
    .pl-rate-row {
      display: grid;
      grid-template-columns: 1fr 1.5fr 1fr 1fr auto;
      gap: 8px;
      margin-bottom: 8px;
      align-items: center;
    }
    .pl-select {
      padding: 9px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      color: var(--text);
      background: var(--bg2);
    }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .pl-kpi-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 600px) {
      .pl-kpi-grid { grid-template-columns: 1fr 1fr; }
      .pl-toolbar-head { flex-direction: column; align-items: flex-start; }
      .pl-rate-row { grid-template-columns: 1fr 1fr; }
    }
  `;

  let styleInjected = false;
  let currentPeriod = 'monthly';
  let currentTab = 'products';
  let currentAlertType = '';
  let rateRowCount = 1;

  function injectStyle() {
    if (styleInjected) return;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
    styleInjected = true;
  }

  async function plApi(path, opts = {}) {
    const token = localStorage.getItem('dealer_token') || '';
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sunucu hatası');
    return data;
  }

  function plToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    if (!t) return;
    const d = document.createElement('div');
    d.className = `toast-item toast-${type}`;
    d.textContent = msg;
    t.appendChild(d);
    setTimeout(() => d.remove(), 3500);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTL(n) {
    if (n == null) return '—';
    return '₺' + Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtPct(n) {
    if (n == null) return '—';
    return '%' + Number(n).toFixed(2);
  }

  // ── Main load ────────────────────────────────────────────────
  async function loadProfitLoss() {
    injectStyle();
    const container = document.getElementById('page-profitloss');
    if (!container) return;

    container.innerHTML = `
      <div class="pl-shell">
        <div class="pl-toolbar">
          <div class="pl-toolbar-head">
            <div>
              <h2 class="pl-title">Kâr / Zarar Analizi</h2>
              <p class="pl-subtitle">Teslim edilen siparişlere dayalı gerçek kâr analizi</p>
            </div>
            <div class="pl-period-tabs">
              <button class="pl-period-btn ${currentPeriod === 'daily' ? 'active' : ''}" onclick="window._plSetPeriod('daily')">Günlük</button>
              <button class="pl-period-btn ${currentPeriod === 'weekly' ? 'active' : ''}" onclick="window._plSetPeriod('weekly')">Haftalık</button>
              <button class="pl-period-btn ${currentPeriod === 'monthly' ? 'active' : ''}" onclick="window._plSetPeriod('monthly')">Aylık</button>
            </div>
          </div>
        </div>

        <div class="pl-kpi-grid" id="pl-kpi-grid">
          <div class="pl-kpi-card"><div class="pl-loading" style="min-height:60px">Yükleniyor...</div></div>
          <div class="pl-kpi-card"></div>
          <div class="pl-kpi-card"></div>
          <div class="pl-kpi-card"></div>
        </div>

        <div class="pl-card">
          <div class="pl-tabs">
            <button class="pl-tab ${currentTab === 'products' ? 'active' : ''}" onclick="window._plSetTab('products')">Ürün Analizi</button>
            <button class="pl-tab ${currentTab === 'simulate' ? 'active' : ''}" onclick="window._plSetTab('simulate')">Simülasyon</button>
            <button class="pl-tab ${currentTab === 'alerts' ? 'active' : ''}" onclick="window._plSetTab('alerts')">Uyarılar</button>
            <button class="pl-tab ${currentTab === 'rates' ? 'active' : ''}" onclick="window._plSetTab('rates')">Komisyon Oranları</button>
          </div>
          <div id="pl-tab-content"><div class="pl-loading">Yükleniyor...</div></div>
        </div>
      </div>
    `;

    loadSummary();
    loadTab(currentTab);
  }

  // ── KPI Summary ──────────────────────────────────────────────
  async function loadSummary() {
    try {
      const d = await plApi(`/api/profit/summary?period=${currentPeriod}`);
      document.getElementById('pl-kpi-grid').innerHTML = `
        <div class="pl-kpi-card">
          <div class="pl-kpi-label">Toplam Ciro</div>
          <div class="pl-kpi-value">${fmtTL(d.totalRevenue)}</div>
        </div>
        <div class="pl-kpi-card">
          <div class="pl-kpi-label">Net Kâr</div>
          <div class="pl-kpi-value ${(d.totalProfit || 0) >= 0 ? 'pl-green' : 'pl-red'}">${fmtTL(d.totalProfit)}</div>
        </div>
        <div class="pl-kpi-card">
          <div class="pl-kpi-label">Ort. Kâr Marjı</div>
          <div class="pl-kpi-value ${(d.avgMargin || 0) >= 15 ? 'pl-green' : (d.avgMargin || 0) >= 0 ? 'pl-yellow' : 'pl-red'}">${fmtPct(d.avgMargin)}</div>
        </div>
        <div class="pl-kpi-card">
          <div class="pl-kpi-label">Sipariş Sayısı</div>
          <div class="pl-kpi-value">${d.orderCount || 0}</div>
        </div>
      `;
    } catch (e) {
      const grid = document.getElementById('pl-kpi-grid');
      if (grid) grid.innerHTML = `<div class="pl-kpi-card pl-error" style="grid-column:1/-1">${esc(e.message)}</div>`;
    }
  }

  // ── Tab switching ────────────────────────────────────────────
  function loadTab(tab) {
    currentTab = tab;
    const content = document.getElementById('pl-tab-content');
    if (!content) return;

    document.querySelectorAll('.pl-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    if (tab === 'products') loadProductsTab(content);
    else if (tab === 'simulate') renderSimulateTab(content);
    else if (tab === 'alerts') loadAlertsTab(content);
    else if (tab === 'rates') renderRatesTab(content);
  }

  // ── Tab: Ürün Analizi ────────────────────────────────────────
  async function loadProductsTab(content) {
    content.innerHTML = '<div class="pl-loading">Yükleniyor...</div>';
    try {
      const d = await plApi('/api/profit/by-product?limit=50&sortBy=totalProfit&sortDir=desc');
      if (!d.products.length) {
        content.innerHTML = '<div class="pl-empty">Henüz kâr kaydı yok. Teslim edilen siparişler senkronize edildiğinde burada görünecek.</div>';
        return;
      }
      content.innerHTML = `
        <div class="pl-table-wrap">
          <table class="pl-table">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Satış Adedi</th>
                <th>Toplam Ciro</th>
                <th>Net Kâr</th>
                <th>Ort. Marj</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${d.products.map(p => `
                <tr>
                  <td>
                    <div class="pl-product-name">${esc(p.title || p.barcode)}</div>
                    <div class="pl-product-barcode">${esc(p.barcode)}</div>
                  </td>
                  <td>${p.soldCount}</td>
                  <td>${fmtTL(p.totalRevenue)}</td>
                  <td class="${(p.totalProfit || 0) >= 0 ? 'pl-green' : 'pl-red'} pl-bold">${fmtTL(p.totalProfit)}</td>
                  <td>
                    <span class="pl-badge ${(p.avgMargin || 0) >= 15 ? 'pl-badge-green' : (p.avgMargin || 0) >= 0 ? 'pl-badge-yellow' : 'pl-badge-red'}">
                      ${fmtPct(p.avgMargin)}
                    </span>
                  </td>
                  <td>
                    ${p.productId ? `<button class="pl-sim-btn" onclick="window._plSimulateProduct(${Number(p.productId)}, '${esc(p.title || p.barcode)}')">Simüle Et</button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="pl-pagination">Toplam ${d.total} ürün · Sayfa ${d.page} / ${d.totalPages}</div>
      `;
    } catch (e) {
      content.innerHTML = `<div class="pl-error">${esc(e.message)}</div>`;
    }
  }

  // ── Tab: Simülasyon ──────────────────────────────────────────
  function renderSimulateTab(content) {
    content.innerHTML = `
      <div class="pl-sim-form">
        <div class="pl-form-group">
          <label class="pl-label">Ürün ID</label>
          <input type="number" class="pl-input" id="pl-sim-product-id" placeholder="Ürün ID" min="1" />
          <p class="pl-hint">Ürün Analizi sekmesinden "Simüle Et" butonuna tıklayarak otomatik doldurabilirsiniz.</p>
        </div>
        <div class="pl-form-group">
          <label class="pl-label">Satış Fiyatı (₺)</label>
          <input type="number" class="pl-input" id="pl-sim-price" placeholder="Örn: 299.90" min="0.01" step="0.01" />
        </div>
        <button class="pl-btn-primary" onclick="window._plRunSimulate()">Hesapla</button>
      </div>
      <div id="pl-sim-result"></div>
    `;
  }

  // ── Tab: Uyarılar ────────────────────────────────────────────
  async function loadAlertsTab(content) {
    const filterBar = `
      <div class="pl-alerts-filter">
        <button class="pl-filter-btn ${!currentAlertType ? 'active' : ''}" onclick="window._plFilterAlerts('')">Tümü</button>
        <button class="pl-filter-btn ${currentAlertType === 'LOW_MARGIN' ? 'active' : ''}" onclick="window._plFilterAlerts('LOW_MARGIN')">Düşük Marj</button>
        <button class="pl-filter-btn ${currentAlertType === 'COMMISSION_MISMATCH' ? 'active' : ''}" onclick="window._plFilterAlerts('COMMISSION_MISMATCH')">Komisyon Uyuşmazlığı</button>
      </div>
    `;
    content.innerHTML = filterBar + '<div class="pl-loading">Yükleniyor...</div>';

    try {
      const url = `/api/profit/alerts?limit=50${currentAlertType ? '&type=' + currentAlertType : ''}`;
      const d = await plApi(url);

      if (!d.alerts.length) {
        content.innerHTML = filterBar + '<div class="pl-empty">Uyarı bulunamadı.</div>';
        return;
      }

      content.innerHTML = filterBar + `
        <div class="pl-table-wrap">
          <table class="pl-table">
            <thead>
              <tr>
                <th>Tür</th>
                <th>Sipariş</th>
                <th>Barkod</th>
                <th>Marj</th>
                <th>Detay</th>
                <th>Tarih</th>
              </tr>
            </thead>
            <tbody>
              ${d.alerts.map(a => {
                let detail = '';
                try {
                  const info = JSON.parse(a.detail || '{}');
                  if (info.diff_pct != null) detail = `Fark: %${(info.diff_pct * 100).toFixed(1)}`;
                } catch (_) {}
                const isLow = a.alert_type === 'LOW_MARGIN';
                return `<tr>
                  <td><span class="pl-badge ${isLow ? 'pl-badge-red' : 'pl-badge-yellow'}">${isLow ? 'Düşük Marj' : 'Komisyon Uyuşmazlığı'}</span></td>
                  <td class="pl-mono">${esc(a.order_id || '—')}</td>
                  <td class="pl-mono">${esc(a.barcode || '—')}</td>
                  <td>${a.margin != null ? fmtPct(a.margin) : '—'}</td>
                  <td style="font-size:12px;color:var(--muted)">${esc(detail)}</td>
                  <td style="font-size:12px;color:var(--muted)">${a.created_at ? new Date(a.created_at).toLocaleDateString('tr-TR') : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="pl-pagination">Toplam ${d.total} uyarı</div>
      `;
    } catch (e) {
      content.innerHTML = filterBar + `<div class="pl-error">${esc(e.message)}</div>`;
    }
  }

  // ── Tab: Komisyon Oranları ───────────────────────────────────
  function renderRatesTab(content) {
    rateRowCount = 1;
    content.innerHTML = `
      <div class="pl-rates-form">
        <h3 class="pl-rates-title">Komisyon Oranı Ekle / Güncelle</h3>
        <p class="pl-hint" style="margin-bottom:16px">Trendyol kategorilerinin komisyon oranlarını girin. Bu oranlar sipariş bazlı kâr hesabında kullanılır.</p>
        <div id="pl-rates-rows">
          ${rateRowHtml(0)}
        </div>
        <div style="margin-top:8px">
          <button class="pl-btn-outline" onclick="window._plAddRateRow()">+ Satır Ekle</button>
        </div>
        <div style="margin-top:16px;display:flex;gap:10px;align-items:center">
          <button class="pl-btn-primary" onclick="window._plSyncRates()">Kaydet</button>
          <span style="font-size:12px;color:var(--muted)">Mevcut oranlar varsa güncellenir.</span>
        </div>
      </div>
    `;
  }

  function rateRowHtml(idx) {
    return `
      <div class="pl-rate-row" id="pl-rate-row-${idx}">
        <input class="pl-input" placeholder="Kategori ID" id="pl-rate-catid-${idx}" />
        <input class="pl-input" placeholder="Kategori Adı" id="pl-rate-catname-${idx}" />
        <input class="pl-input" type="number" placeholder="Oran %" id="pl-rate-rate-${idx}" min="0" max="100" step="0.1" />
        <select class="pl-select" id="pl-rate-kdv-${idx}">
          <option value="8">KDV %8</option>
          <option value="10">KDV %10</option>
          <option value="20" selected>KDV %20</option>
        </select>
        ${idx > 0
          ? `<button class="pl-btn-remove" onclick="document.getElementById('pl-rate-row-${idx}').remove()">✕</button>`
          : '<div></div>'}
      </div>
    `;
  }

  // ── Window handlers ──────────────────────────────────────────

  window._plSetPeriod = function (period) {
    currentPeriod = period;
    // Update button states
    document.querySelectorAll('.pl-period-btn').forEach(btn => {
      btn.classList.toggle('active', btn.textContent.trim() === { daily: 'Günlük', weekly: 'Haftalık', monthly: 'Aylık' }[period]);
    });
    loadSummary();
  };

  window._plSetTab = function (tab) {
    currentTab = tab;
    // Update tab button active state manually via data-tab
    document.querySelectorAll('.pl-tab').forEach(btn => {
      btn.classList.remove('active');
    });
    // Match by onclick attribute
    const tabMap = { products: 'products', simulate: 'simulate', alerts: 'alerts', rates: 'rates' };
    document.querySelectorAll('.pl-tab').forEach(btn => {
      const onclick = btn.getAttribute('onclick') || '';
      if (onclick.includes(`'${tabMap[tab]}'`)) btn.classList.add('active');
    });
    const content = document.getElementById('pl-tab-content');
    if (!content) return;
    if (tab === 'products') loadProductsTab(content);
    else if (tab === 'simulate') renderSimulateTab(content);
    else if (tab === 'alerts') loadAlertsTab(content);
    else if (tab === 'rates') renderRatesTab(content);
  };

  window._plFilterAlerts = function (type) {
    currentAlertType = type;
    const content = document.getElementById('pl-tab-content');
    if (content) loadAlertsTab(content);
  };

  window._plSimulateProduct = function (productId, name) {
    window._plSetTab('simulate');
    setTimeout(() => {
      const input = document.getElementById('pl-sim-product-id');
      if (input && productId) {
        input.value = productId;
        input.focus();
      }
    }, 50);
  };

  window._plRunSimulate = async function () {
    const productId = document.getElementById('pl-sim-product-id')?.value?.trim();
    const price = document.getElementById('pl-sim-price')?.value?.trim();
    const result = document.getElementById('pl-sim-result');
    if (!result) return;
    if (!productId || !price) { plToast('Ürün ID ve fiyat zorunludur', 'error'); return; }
    result.innerHTML = '<div class="pl-loading">Hesaplanıyor...</div>';
    try {
      const d = await plApi(`/api/profit/simulate?productId=${encodeURIComponent(productId)}&price=${encodeURIComponent(price)}`);
      result.innerHTML = `
        <div class="pl-sim-result-card">
          <div class="pl-sim-row"><span>Satış Fiyatı</span><span>${fmtTL(d.sale_price)}</span></div>
          <div class="pl-sim-row"><span>Maliyet</span><span class="pl-red">-${fmtTL(d.cost_price)}</span></div>
          <div class="pl-sim-row"><span>Komisyon (${d.rate_used}%)</span><span class="pl-red">-${fmtTL(d.commission_amount)}</span></div>
          <div class="pl-sim-row"><span>KDV Payı (%${d.kdv_rate_used})</span><span class="pl-red">-${fmtTL(d.kdv_amount)}</span></div>
          <div class="pl-sim-row"><span>Kargo</span><span class="pl-red">-${fmtTL(d.shipping_cost)}</span></div>
          <div class="pl-sim-row"><span>İade Karşılığı (%${(d.return_provision / (d.sale_price || 1) * 100).toFixed(0)})</span><span class="pl-red">-${fmtTL(d.return_provision)}</span></div>
          <div class="pl-sim-divider"></div>
          <div class="pl-sim-row pl-sim-total">
            <span>Net Kâr</span>
            <span class="${(d.net_profit || 0) >= 0 ? 'pl-green' : 'pl-red'}">${fmtTL(d.net_profit)}</span>
          </div>
          <div class="pl-sim-row pl-sim-total">
            <span>Kâr Marjı</span>
            <span class="${(d.profit_margin || 0) >= 15 ? 'pl-green' : (d.profit_margin || 0) >= 0 ? 'pl-yellow' : 'pl-red'}">${fmtPct(d.profit_margin)}</span>
          </div>
        </div>
      `;
    } catch (e) {
      result.innerHTML = `<div class="pl-error">${esc(e.message)}</div>`;
    }
  };

  window._plAddRateRow = function () {
    const container = document.getElementById('pl-rates-rows');
    if (!container) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = rateRowHtml(rateRowCount++);
    container.appendChild(wrapper.firstElementChild);
  };

  window._plSyncRates = async function () {
    const rows = document.querySelectorAll('[id^="pl-rate-row-"]');
    const rates = [];
    for (const row of rows) {
      const idx = row.id.replace('pl-rate-row-', '');
      const category_id = (document.getElementById(`pl-rate-catid-${idx}`)?.value || '').trim();
      const category_name = (document.getElementById(`pl-rate-catname-${idx}`)?.value || '').trim();
      const rateVal = parseFloat(document.getElementById(`pl-rate-rate-${idx}`)?.value || '');
      const kdv_rate = parseInt(document.getElementById(`pl-rate-kdv-${idx}`)?.value || '20', 10);
      if (!category_id || !category_name || isNaN(rateVal)) continue;
      rates.push({ category_id, category_name, rate: rateVal, kdv_rate });
    }
    if (!rates.length) { plToast('Geçerli satır bulunamadı', 'error'); return; }
    try {
      const result = await plApi('/api/commission-rates/sync', {
        method: 'POST',
        body: JSON.stringify({ rates }),
      });
      const msg = `${result.updated} oran kaydedildi${result.errors.length ? ` · ${result.errors.length} hata` : ''}`;
      plToast(msg, result.errors.length ? 'error' : 'success');
    } catch (e) {
      plToast(e.message, 'error');
    }
  };

  window.loadProfitLoss = loadProfitLoss;
})();
