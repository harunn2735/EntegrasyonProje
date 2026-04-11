// public/js/analyticsPage.js
(function () {
  'use strict';

  /* ── CSS ────────────────────────────────────────────────────── */
  const STYLE = `
    #page-analytics {
      padding: 10px 16px 6px;
      width: 100%;
      box-sizing: border-box;
    }
    .ap-shell {
      display: flex;
      flex-direction: column;
      gap: 10px;
      height: calc(100vh - 72px);
      max-width: 1400px;
      margin: 0 auto;
    }

    /* ── Row 1: metric cards ── */
    .ap-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      flex: 0 0 auto;
    }
    .ap-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 11px 14px;
      box-shadow: var(--shadow);
    }
    .ap-card-label {
      font-size: 10px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .5px;
      margin-bottom: 3px;
    }
    .ap-card-value {
      font-size: 17px;
      font-weight: 700;
      color: var(--text);
      line-height: 1.2;
    }
    .ap-card-sub {
      font-size: 11px;
      color: var(--muted);
      margin-top: 2px;
    }

    /* ── Row 2 & 3: 2-col grids ── */
    .ap-mid, .ap-bot {
      display: grid;
      gap: 10px;
      flex: 1 1 0;
      min-height: 0;
    }
    .ap-mid { grid-template-columns: 2fr 1fr; }
    .ap-bot { grid-template-columns: 1fr 1fr; }

    /* ── Generic card box ── */
    .ap-box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 11px 14px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }
    .ap-box-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      flex-shrink: 0;
    }
    .ap-box-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text);
      text-transform: uppercase;
      letter-spacing: .4px;
    }

    /* ── Chart wrapper fills remaining space ── */
    .ap-chart-wrap {
      position: relative;
      flex: 1 1 0;
      min-height: 0;
    }

    /* ── Period tabs ── */
    .ap-tabs {
      display: inline-flex;
      gap: 4px;
    }
    .ap-tab {
      padding: 3px 9px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: transparent;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      font-family: inherit;
      transition: .15s ease;
    }
    .ap-tab:hover { color: var(--text); }
    .ap-tab.active {
      background: #F27A1A;
      color: #fff;
      border-color: #F27A1A;
    }

    /* ── Performance card ── */
    .ap-perf-body {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      justify-content: space-around;
    }
    .ap-perf-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 0;
      border-bottom: 1px solid var(--border);
    }
    .ap-perf-row:last-child { border-bottom: none; }
    .ap-perf-label {
      font-size: 11px;
      color: var(--muted);
    }
    .ap-perf-value {
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
    }
    .ap-perf-up   { color: #1D9E75 !important; }
    .ap-perf-down { color: #e53e3e !important; }

    /* ── Status progress bars ── */
    .ap-status-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1 1 0;
      justify-content: center;
    }
    .ap-stat-row { display: flex; flex-direction: column; gap: 4px; }
    .ap-stat-header {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
    }
    .ap-stat-label { color: var(--muted); font-weight: 600; }
    .ap-stat-count { color: var(--text); font-weight: 700; }
    .ap-stat-bar-bg {
      height: 8px;
      background: var(--bg3, #f3f4f6);
      border-radius: 4px;
      overflow: hidden;
    }
    .ap-stat-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width .4s ease;
    }

    /* ── Refresh button ── */
    .ap-btn-refresh {
      background: #F27A1A;
      color: #fff;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      font-family: inherit;
    }
    .ap-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--muted);
      font-size: 13px;
    }

    @media (max-width: 900px) {
      .ap-cards { grid-template-columns: repeat(2, 1fr); }
      .ap-mid   { grid-template-columns: 1fr; }
      .ap-bot   { grid-template-columns: 1fr; }
      .ap-shell { height: auto; }
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

  /* ── Yardımcılar ────────────────────────────────────────────── */
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function apApi(path) {
    const token = localStorage.getItem('dealer_token') || '';
    const res = await fetch(path, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sunucu hatası');
    return data;
  }

  function fmtTL(n) {
    return (
      '₺' +
      Number(n || 0).toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  /* ── Chart instance'ları ────────────────────────────────────── */
  let mainChart = null;
  let topChart  = null;

  /* ── 4 Metrik kart ──────────────────────────────────────────── */
  function renderCards(s) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('ap-today-rev',    fmtTL(s.today_revenue));
    set('ap-today-sub',    `${s.today_orders   || 0} sipariş`);
    set('ap-week-rev',     fmtTL(s.week_revenue));
    set('ap-week-sub',     `${s.week_orders    || 0} sipariş`);
    set('ap-month-rev',    fmtTL(s.month_revenue));
    set('ap-month-sub',    `${s.month_orders   || 0} sipariş`);
    set('ap-total-orders', s.total_orders || 0);
    set('ap-total-sub',    `Net: ${fmtTL(s.total_net_revenue)}`);
  }

  /* ── Satış performansı kartı ────────────────────────────────── */
  function renderPerformance(summary, daily, monthly) {
    const set = (id, val, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val;
      if (cls) el.className = 'ap-perf-value ' + cls;
    };

    // Dün tarihi
    const today   = new Date();
    const yDate   = new Date(Date.UTC(
      today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1
    )).toISOString().slice(0, 10);
    const yRow    = (daily || []).find(d => d.day === yDate);
    set('ap-perf-yesterday', fmtTL(yRow ? yRow.revenue : 0));

    // Bu ay
    set('ap-perf-month', fmtTL(summary.month_revenue));

    // Günlük ortalama
    const dayOfMonth = today.getUTCDate();
    const dailyAvg   = (summary.month_revenue || 0) / Math.max(1, dayOfMonth);
    set('ap-perf-avg', fmtTL(dailyAvg));

    // Ay sonu tahmini
    const daysInMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
    ).getUTCDate();
    set('ap-perf-est', fmtTL(dailyAvg * daysInMonth));

    // Geçen aya göre trend (günlük ort. bazlı)
    const prevDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const prevKey  = prevDate.toISOString().slice(0, 7);
    const prevRow  = (monthly || []).find(m => m.month === prevKey);
    if (prevRow && prevRow.revenue > 0) {
      const prevDays = new Date(
        Date.UTC(prevDate.getUTCFullYear(), prevDate.getUTCMonth() + 1, 0)
      ).getUTCDate();
      const prevAvg = prevRow.revenue / prevDays;
      const diff    = ((dailyAvg - prevAvg) / prevAvg) * 100;
      const sign    = diff >= 0 ? '+' : '';
      set('ap-perf-trend', `${sign}${diff.toFixed(1)}%`, diff >= 0 ? 'ap-perf-up' : 'ap-perf-down');
    } else {
      set('ap-perf-trend', '—');
    }
  }

  /* ── Sipariş durumları progress bar ─────────────────────────── */
  function renderStatus(status) {
    const body = document.getElementById('ap-status-body');
    if (!body) return;

    const delivered  = status.delivered  || 0;
    const processing = status.processing || 0;
    const cancelled  = status.cancelled  || 0;
    const total      = delivered + processing + cancelled;

    if (total === 0) {
      body.innerHTML = '<div class="ap-empty">Sipariş verisi yok</div>';
      return;
    }

    const bars = [
      { label: 'Teslim Edildi / Kargoda', count: delivered,  color: '#1D9E75' },
      { label: 'Hazırlanıyor',            count: processing, color: '#F27A1A' },
      { label: 'İptal / İade',            count: cancelled,  color: '#e53e3e' },
    ];

    body.innerHTML = bars
      .map(b => {
        const pct = ((b.count / total) * 100).toFixed(1);
        return `
          <div class="ap-stat-row">
            <div class="ap-stat-header">
              <span class="ap-stat-label">${esc(b.label)}</span>
              <span class="ap-stat-count">${b.count} adet (${pct}%)</span>
            </div>
            <div class="ap-stat-bar-bg">
              <div class="ap-stat-bar-fill" style="width:${pct}%;background:${b.color}"></div>
            </div>
          </div>`;
      })
      .join('');
  }

  /* ── Ana çizgi grafik ───────────────────────────────────────── */
  function renderMainChart(data, period) {
    const canvas = document.getElementById('ap-main-chart');
    const ctx    = canvas && canvas.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    if (mainChart) { mainChart.destroy(); mainChart = null; }

    const labels = data.map(d => {
      if (period === 'daily') {
        return new Date(d.day + 'T00:00:00Z').toLocaleDateString('tr-TR', {
          day: 'numeric', month: 'short', timeZone: 'UTC',
        });
      }
      if (period === 'weekly') return 'Hft ' + d.week.split('-')[1];
      const [y, m] = d.month.split('-');
      return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString('tr-TR', {
        month: 'short', year: '2-digit', timeZone: 'UTC',
      });
    });

    mainChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ciro (₺)',
            data: data.map(d => d.revenue),
            borderColor: '#F27A1A',
            backgroundColor: 'rgba(242,122,26,.08)',
            fill: true,
            tension: 0.35,
            yAxisID: 'y',
            pointRadius: data.length <= 31 ? 3 : 0,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
          {
            label: 'Sipariş',
            data: data.map(d => d.orders),
            borderColor: '#1D9E75',
            backgroundColor: 'rgba(29,158,117,.06)',
            fill: false,
            tension: 0.35,
            yAxisID: 'y1',
            pointRadius: data.length <= 31 ? 3 : 0,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { usePointStyle: true, boxWidth: 6, font: { size: 10 }, padding: 6 },
          },
          tooltip: {
            callbacks: {
              label: c =>
                c.dataset.yAxisID === 'y'
                  ? ` Ciro: ${fmtTL(c.parsed.y)}`
                  : ` Sipariş: ${c.parsed.y}`,
            },
          },
        },
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            grid: { color: 'rgba(0,0,0,.05)' },
            ticks: {
              callback: v => '₺' + Number(v).toLocaleString('tr-TR'),
              font: { size: 10 },
            },
          },
          y1: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { precision: 0, font: { size: 10 } },
          },
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 } },
          },
        },
      },
    });
  }

  /* ── Yatay bar grafik (en çok satanlar) ─────────────────────── */
  function renderTopChart(products) {
    const canvas = document.getElementById('ap-top-chart');
    const ctx    = canvas && canvas.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    if (topChart) { topChart.destroy(); topChart = null; }

    if (!products.length) {
      canvas.style.display = 'none';
      const box = canvas.parentElement;
      if (box) {
        const m = document.createElement('div');
        m.className = 'ap-empty';
        m.textContent = 'Son 30 günde sipariş verisi bulunamadı.';
        box.appendChild(m);
      }
      return;
    }

    const labels = products.map(p =>
      p.title.length > 28 ? p.title.slice(0, 28) + '…' : p.title
    );

    topChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Ciro (₺)',
            data: products.map(p => p.revenue),
            backgroundColor: 'rgba(242,122,26,.75)',
            borderColor: '#F27A1A',
            borderWidth: 1,
            borderRadius: 3,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: c =>
                ` ${fmtTL(c.parsed.x)} | ${products[c.dataIndex]?.quantity ?? 0} adet`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,.05)' },
            ticks: {
              callback: v => '₺' + Number(v).toLocaleString('tr-TR'),
              font: { size: 10 },
            },
          },
          y: {
            grid: { display: false },
            ticks: { font: { size: 10 } },
          },
        },
      },
    });
  }

  /* ── Periyot geçişi ─────────────────────────────────────────── */
  window._apSwitchPeriod = async function (period) {
    document.querySelectorAll('.ap-tab').forEach(t => t.classList.remove('active'));
    const tabs = document.querySelectorAll('.ap-tab');
    const idx  = { daily: 0, weekly: 1, monthly: 2 };
    if (tabs[idx[period]]) tabs[idx[period]].classList.add('active');

    try {
      const data = await apApi(`/api/analytics/${period}`);
      renderMainChart(data, period);
    } catch (e) {
      console.error('[Analytics] Sekme hatası:', e.message);
    }
  };

  /* ── Ana yükleme fonksiyonu ─────────────────────────────────── */
  async function loadAnalytics() {
    injectStyle();

    const container = document.getElementById('page-analytics');
    if (!container) return;

    const topbar = document.getElementById('topbar-actions');
    if (topbar) {
      topbar.innerHTML =
        '<button class="ap-btn-refresh" onclick="window.loadAnalytics()">Yenile</button>';
    }

    container.innerHTML = `
      <div class="ap-shell">

        <!-- Row 1: 4 metrik kart -->
        <div class="ap-cards">
          <div class="ap-card">
            <div class="ap-card-label">Bugün Ciro</div>
            <div class="ap-card-value" id="ap-today-rev">—</div>
            <div class="ap-card-sub"   id="ap-today-sub"></div>
          </div>
          <div class="ap-card">
            <div class="ap-card-label">Bu Hafta Ciro</div>
            <div class="ap-card-value" id="ap-week-rev">—</div>
            <div class="ap-card-sub"   id="ap-week-sub"></div>
          </div>
          <div class="ap-card">
            <div class="ap-card-label">Bu Ay Ciro</div>
            <div class="ap-card-value" id="ap-month-rev">—</div>
            <div class="ap-card-sub"   id="ap-month-sub"></div>
          </div>
          <div class="ap-card">
            <div class="ap-card-label">Toplam Sipariş</div>
            <div class="ap-card-value" id="ap-total-orders">—</div>
            <div class="ap-card-sub"   id="ap-total-sub"></div>
          </div>
        </div>

        <!-- Row 2: Satış Grafiği (geniş) + Satış Performansı (dar) -->
        <div class="ap-mid">
          <div class="ap-box">
            <div class="ap-box-header">
              <span class="ap-box-title">Satış Grafiği</span>
              <div class="ap-tabs">
                <button class="ap-tab active" onclick="window._apSwitchPeriod('daily')">Günlük</button>
                <button class="ap-tab"        onclick="window._apSwitchPeriod('weekly')">Haftalık</button>
                <button class="ap-tab"        onclick="window._apSwitchPeriod('monthly')">Aylık</button>
              </div>
            </div>
            <div class="ap-chart-wrap">
              <canvas id="ap-main-chart"></canvas>
            </div>
          </div>

          <div class="ap-box">
            <div class="ap-box-header">
              <span class="ap-box-title">Satış Performansı</span>
            </div>
            <div class="ap-perf-body">
              <div class="ap-perf-row">
                <span class="ap-perf-label">Dünkü Ciro</span>
                <span class="ap-perf-value" id="ap-perf-yesterday">—</span>
              </div>
              <div class="ap-perf-row">
                <span class="ap-perf-label">Bu Ay Ciro</span>
                <span class="ap-perf-value" id="ap-perf-month">—</span>
              </div>
              <div class="ap-perf-row">
                <span class="ap-perf-label">Günlük Ortalama</span>
                <span class="ap-perf-value" id="ap-perf-avg">—</span>
              </div>
              <div class="ap-perf-row">
                <span class="ap-perf-label">Ay Sonu Tahmini</span>
                <span class="ap-perf-value" id="ap-perf-est">—</span>
              </div>
              <div class="ap-perf-row">
                <span class="ap-perf-label">Geçen Aya Göre</span>
                <span class="ap-perf-value" id="ap-perf-trend">—</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Row 3: En Çok Satan + Sipariş Durumları -->
        <div class="ap-bot">
          <div class="ap-box">
            <div class="ap-box-header">
              <span class="ap-box-title">En Çok Satan Ürünler (Son 30 Gün)</span>
            </div>
            <div class="ap-chart-wrap">
              <canvas id="ap-top-chart"></canvas>
            </div>
          </div>

          <div class="ap-box">
            <div class="ap-box-header">
              <span class="ap-box-title">Sipariş Durumları</span>
            </div>
            <div class="ap-status-body" id="ap-status-body">
              <div class="ap-empty">Yükleniyor…</div>
            </div>
          </div>
        </div>

      </div>
    `;

    try {
      const [summary, daily, topProducts, monthly, status] = await Promise.all([
        apApi('/api/analytics/summary'),
        apApi('/api/analytics/daily'),
        apApi('/api/analytics/top-products'),
        apApi('/api/analytics/monthly'),
        apApi('/api/analytics/status'),
      ]);
      renderCards(summary);
      renderMainChart(daily, 'daily');
      renderTopChart(topProducts);
      renderPerformance(summary, daily, monthly);
      renderStatus(status);
    } catch (e) {
      container.innerHTML = `<div class="ap-empty">Hata: ${esc(e.message)}</div>`;
    }
  }

  window.loadAnalytics = loadAnalytics;
})();
