// public/js/forecastPage.js
(function () {
  'use strict';

  const STYLE = `
    #page-forecast {
      padding: 8px 0 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: hidden;
    }
    .fp-shell {
      display: flex;
      flex-direction: column;
      gap: 18px;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
    }
    .fp-toolbar {
      background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,255,255,.92));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: var(--shadow);
    }
    .fp-toolbar-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }
    .fp-heading h2 {
      font-size: 17px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 4px;
    }
    .fp-heading p {
      font-size: 13px;
      color: var(--muted);
    }
    .fp-tabs {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 6px;
      border-radius: 14px;
      background: var(--bg3);
      border: 1px solid var(--border);
    }
    .fp-tab {
      padding: 10px 18px;
      border-radius: 10px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      transition: .2s ease;
      font-family: inherit;
    }
    .fp-tab:hover { color: var(--text); background: rgba(255,255,255,.72); }
    .fp-tab.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
      box-shadow: 0 8px 18px rgba(108,99,255,.18);
    }
    .fp-btn-refresh {
      background: var(--accent);
      color: #fff;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      font-family: inherit;
    }
    .fp-btn-refresh:disabled { opacity: .6; cursor: not-allowed; }
    .fp-card {
      background: var(--card);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      padding: 16px 20px;
      margin-bottom: 12px;
      box-shadow: var(--shadow);
      cursor: pointer;
      transition: box-shadow .15s ease;
    }
    .fp-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,.1); }
    .fp-card-critical {
      border-left: 4px solid var(--red, #ef4444);
    }
    .fp-card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .fp-card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .fp-card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 13px;
      color: var(--muted);
    }
    .fp-card-meta strong { color: var(--text); }
    .fp-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 12px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .fp-badge-critical { background: #fee2e2; color: #ef4444; }
    .fp-badge-warning  { background: #fef3c7; color: #d97706; }
    .fp-badge-ok       { background: #dcfce7; color: #16a34a; }
    .fp-detail {
      margin-top: 16px;
      border-top: 1px solid var(--border);
      padding-top: 16px;
    }
    .fp-chart-wrap {
      width: 100%;
      max-width: 560px;
      margin: 0 auto 16px;
    }
    .fp-ai {
      font-size: 13px;
      color: var(--text);
      background: var(--bg3);
      border-radius: 8px;
      padding: 12px 14px;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    .fp-ai-loading { color: var(--muted); font-style: italic; }
    .fp-ai-nokey   { color: var(--yellow, #ca8a04); }
    .fp-ai-error   { color: var(--red, #ef4444); }
    .fp-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      width: 100%;
      color: var(--muted);
      font-size: 14px;
    }
    @media (max-width: 768px) {
      #page-forecast { padding-top: 0; }
      .fp-toolbar { padding: 16px; }
      .fp-card-row { flex-direction: column; align-items: flex-start; }
      .fp-tabs { display: flex; width: 100%; }
      .fp-tab { flex: 1 1 80px; text-align: center; }
    }
  `;

  let styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
    styleInjected = true;
  }

  async function fpApi(path, opts = {}) {
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

  function fpToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    if (!t) return;
    const d = document.createElement('div');
    d.className = `toast-item toast-${type}`;
    d.textContent = msg;
    t.appendChild(d);
    setTimeout(() => d.remove(), 3500);
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let allForecasts = [];
  let activeFilter = 'all';
  const expandedCharts = {};

  function statusBadge(status) {
    const map = {
      kritik: ['🔴 Kritik', 'fp-badge-critical'],
      uyarı:  ['🟡 Uyarı',  'fp-badge-warning'],
      yeterli:['🟢 Yeterli','fp-badge-ok'],
    };
    const [label, cls] = map[status] || ['—', ''];
    return `<span class="fp-badge ${cls}">${label}</span>`;
  }

  function trendArrow(trendLabel) {
    if (trendLabel === 'Artıyor')  return '↑';
    if (trendLabel === 'Azalıyor') return '↓';
    return '→';
  }

  function renderCard(item) {
    const cardClass = item.status === 'kritik' ? 'fp-card fp-card-critical' : 'fp-card';
    return `
      <div class="${cardClass}" id="fp-card-${item.id}" onclick="window._fpToggleDetail(${item.id})">
        <div class="fp-card-row">
          <div class="fp-card-title" title="${esc(item.title)}">${esc(item.title)}</div>
          ${statusBadge(item.status)}
        </div>
        <div class="fp-card-meta">
          <span>📦 Stok: <strong>${item.stock}</strong></span>
          <span>📈 7g Tahmin: <strong>${item.forecast7d}</strong> adet</span>
          <span>Trend: ${trendArrow(item.trendLabel)} <strong>${esc(item.trendLabel)}</strong></span>
          <span>4H Ort: ${item.avg4weeks} adet</span>
        </div>
        <div class="fp-detail" id="fp-detail-${item.id}" style="display:none;">
          <div class="fp-chart-wrap"><canvas id="fp-chart-${item.id}" height="160"></canvas></div>
          <div class="fp-ai" id="fp-ai-${item.id}"><span class="fp-ai-loading">Claude yorumu yükleniyor...</span></div>
        </div>
      </div>
    `;
  }

  function renderList() {
    const list = document.getElementById('fp-list');
    if (!list) return;
    const filtered =
      activeFilter === 'all'
        ? allForecasts
        : allForecasts.filter((f) => f.status === activeFilter);
    if (!filtered.length) {
      list.innerHTML = '<div class="fp-empty">Bu kategoride ürün bulunamadı.</div>';
      return;
    }
    list.innerHTML = filtered.map(renderCard).join('');
  }

  window._fpToggleDetail = async function (id) {
    const detail = document.getElementById(`fp-detail-${id}`);
    if (!detail) return;

    if (detail.style.display !== 'none') {
      detail.style.display = 'none';
      if (expandedCharts[id]) {
        expandedCharts[id].destroy();
        delete expandedCharts[id];
      }
      return;
    }

    detail.style.display = 'block';

    try {
      const data = await fpApi(`/api/forecast/${id}`);

      // Grafik
      const canvas = document.getElementById(`fp-chart-${id}`);
      const ctx = canvas && canvas.getContext('2d');
      if (ctx && typeof Chart !== 'undefined') {
        if (expandedCharts[id]) expandedCharts[id].destroy();
        expandedCharts[id] = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: [
              '4 Hafta Önce',
              '3 Hafta Önce',
              '2 Hafta Önce',
              'Geçen Hafta',
              'Tahmin (7g)',
            ],
            datasets: [
              {
                label: 'Satış (adet)',
                data: [...data.weeklySales, data.forecast7d],
                backgroundColor: [
                  'rgba(108,99,255,.7)',
                  'rgba(108,99,255,.7)',
                  'rgba(108,99,255,.7)',
                  'rgba(108,99,255,.7)',
                  'rgba(245,158,11,.5)',
                ],
                borderColor: [
                  '#6c63ff', '#6c63ff', '#6c63ff', '#6c63ff', '#f59e0b',
                ],
                borderWidth: 2,
                borderSkipped: false,
              },
            ],
          },
          options: {
            responsive: true,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} adet` } },
            },
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
            },
          },
        });
      }

      // AI Yorumu
      const aiDiv = document.getElementById(`fp-ai-${id}`);
      if (aiDiv) {
        if (data.aiComment) {
          aiDiv.innerHTML = `<div class="fp-ai-text">${esc(data.aiComment)}</div>`;
        } else {
          aiDiv.innerHTML =
            '<span class="fp-ai-nokey">⚠️ AI yorumu için ANTHROPIC_API_KEY gerekli.</span>';
        }
      }
    } catch (e) {
      const aiDiv = document.getElementById(`fp-ai-${id}`);
      if (aiDiv)
        aiDiv.innerHTML = `<span class="fp-ai-error">Hata: ${esc(e.message)}</span>`;
      fpToast(e.message, 'error');
    }
  };

  window._fpFilter = function (filter) {
    activeFilter = filter;
    document.querySelectorAll('.fp-tab').forEach((t) => t.classList.remove('active'));
    const tabMap = { all: 0, kritik: 1, 'uyarı': 2, yeterli: 3 };
    const tabIdx = tabMap[filter];
    const tabs = document.querySelectorAll('.fp-tab');
    if (tabs[tabIdx]) tabs[tabIdx].classList.add('active');
    renderList();
  };

  async function loadForecast() {
    injectStyle();

    const container = document.getElementById('page-forecast');
    if (!container) return;

    const topbarActions = document.getElementById('topbar-actions');
    if (topbarActions) {
      topbarActions.innerHTML =
        '<button class="fp-btn-refresh" onclick="window.loadForecast()">Yenile</button>';
    }

    container.innerHTML = `
      <div class="fp-shell">
        <div class="fp-toolbar">
          <div class="fp-toolbar-head">
            <div class="fp-heading">
              <h2>Talep Tahmini</h2>
              <p>Son 4 haftanın satış verisine göre stok risk analizi ve önümüzdeki 7 günlük tahmin.</p>
            </div>
          </div>
          <div class="fp-tabs">
            <button class="fp-tab active" onclick="window._fpFilter('all')">Tümü</button>
            <button class="fp-tab" onclick="window._fpFilter('kritik')">🔴 Kritik</button>
            <button class="fp-tab" onclick="window._fpFilter('uyarı')">🟡 Uyarı</button>
            <button class="fp-tab" onclick="window._fpFilter('yeterli')">🟢 Yeterli</button>
          </div>
        </div>
        <div id="fp-list"><div class="fp-empty">Yükleniyor...</div></div>
      </div>
    `;

    try {
      allForecasts = await fpApi('/api/forecast');
      renderList();
    } catch (e) {
      const list = document.getElementById('fp-list');
      if (list)
        list.innerHTML = `<div class="fp-empty">Hata: ${esc(e.message)}</div>`;
    }
  }

  window.loadForecast = loadForecast;
})();
