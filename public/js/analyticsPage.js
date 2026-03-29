// public/js/analyticsPage.js
(function () {
  'use strict';

  /* ── CSS ────────────────────────────────────────────────────── */
  const STYLE = `
    #page-analytics {
      padding: 8px 0 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: hidden;
    }
    .ap-shell {
      display: flex;
      flex-direction: column;
      gap: 20px;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
    }
    .ap-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }
    .ap-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      box-shadow: var(--shadow);
    }
    .ap-card-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .5px;
      margin-bottom: 8px;
    }
    .ap-card-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
    }
    .ap-card-sub {
      font-size: 12px;
      color: var(--muted);
      margin-top: 4px;
    }
    .ap-chart-box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      box-shadow: var(--shadow);
    }
    .ap-chart-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 10px;
    }
    .ap-chart-header h3 {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
    }
    .ap-tabs {
      display: inline-flex;
      gap: 6px;
      padding: 4px;
      border-radius: 10px;
      background: var(--bg3);
      border: 1px solid var(--border);
    }
    .ap-tab {
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
    .ap-tab:hover { color: var(--text); background: rgba(255,255,255,.7); }
    .ap-tab.active {
      background: #F27A1A;
      color: #fff;
      border-color: #F27A1A;
    }
    .ap-btn-refresh {
      background: #F27A1A;
      color: #fff;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      font-family: inherit;
    }
    .ap-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      color: var(--muted);
      font-size: 14px;
    }
    @media (max-width: 900px) {
      .ap-cards { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 540px) {
      .ap-cards { grid-template-columns: 1fr; }
      .ap-chart-header { flex-direction: column; align-items: flex-start; }
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

  /* ── API yardımcısı ─────────────────────────────────────────── */
  async function apApi(path) {
    const token = localStorage.getItem('dealer_token') || '';
    const res = await fetch(path, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sunucu hatası');
    return data;
  }

  /* ── Türk lirası formatı ────────────────────────────────────── */
  function fmtTL(n) {
    return (
      '₺' +
      Number(n || 0).toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  /* ── Grafik instance'ları ────────────────────────────────────── */
  let mainChart = null;
  let topChart = null;

  /* ── 4 Metrik kart ──────────────────────────────────────────── */
  function renderCards(s) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('ap-today-rev', fmtTL(s.today_revenue));
    set('ap-today-sub', `${s.today_orders || 0} sipariş`);
    set('ap-week-rev', fmtTL(s.week_revenue));
    set('ap-week-sub', `${s.week_orders || 0} sipariş`);
    set('ap-month-rev', fmtTL(s.month_revenue));
    set('ap-month-sub', `${s.month_orders || 0} sipariş`);
    set('ap-total-orders', s.total_orders || 0);
    set('ap-total-sub', `Net: ${fmtTL(s.total_net_revenue)}`);
  }

  /* ── Ana dual-axis çizgi grafik ─────────────────────────────── */
  function renderMainChart(data, period) {
    const canvas = document.getElementById('ap-main-chart');
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    if (mainChart) { mainChart.destroy(); mainChart = null; }

    const labels = data.map((d) => {
      if (period === 'daily') {
        const dt = new Date(d.day + 'T00:00:00Z');
        return dt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      }
      if (period === 'weekly') {
        return 'Hft ' + d.week.split('-')[1];
      }
      const [y, m] = d.month.split('-');
      return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString('tr-TR', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      });
    });

    mainChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ciro (₺)',
            data: data.map((d) => d.revenue),
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
            label: 'Sipariş Adedi',
            data: data.map((d) => d.orders),
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
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                ctx.dataset.yAxisID === 'y'
                  ? ` Ciro: ${fmtTL(ctx.parsed.y)}`
                  : ` Sipariş: ${ctx.parsed.y}`,
            },
          },
        },
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            grid: { color: 'rgba(0,0,0,.05)' },
            ticks: { callback: (v) => '₺' + Number(v).toLocaleString('tr-TR') },
          },
          y1: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { precision: 0 },
          },
          x: { grid: { display: false } },
        },
      },
    });
  }

  /* ── Yatay bar grafik (en çok satanlar) ─────────────────────── */
  function renderTopChart(products) {
    const canvas = document.getElementById('ap-top-chart');
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    if (topChart) { topChart.destroy(); topChart = null; }

    if (!products.length) {
      const box = canvas.parentElement;
      if (box) {
        canvas.style.display = 'none';
        const msg = document.createElement('div');
        msg.className = 'ap-empty';
        msg.textContent = 'Son 30 günde sipariş verisi bulunamadı.';
        box.appendChild(msg);
      }
      return;
    }

    const labels = products.map((p) =>
      p.title.length > 35 ? p.title.slice(0, 35) + '…' : p.title
    );

    topChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Ciro (₺)',
            data: products.map((p) => p.revenue),
            backgroundColor: 'rgba(242,122,26,.75)',
            borderColor: '#F27A1A',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                ` Ciro: ${fmtTL(ctx.parsed.x)} | Adet: ${products[ctx.dataIndex]?.quantity ?? 0}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,.05)' },
            ticks: { callback: (v) => '₺' + Number(v).toLocaleString('tr-TR') },
          },
          y: { grid: { display: false } },
        },
      },
    });
  }

  /* ── Sekme geçişi ────────────────────────────────────────────── */
  window._apSwitchPeriod = async function (period) {
    document.querySelectorAll('.ap-tab').forEach((t) => t.classList.remove('active'));
    const idx = { daily: 0, weekly: 1, monthly: 2 };
    const tabs = document.querySelectorAll('.ap-tab');
    if (tabs[idx[period]]) tabs[idx[period]].classList.add('active');

    try {
      const data = await apApi(`/api/analytics/${period}`);
      renderMainChart(data, period);
    } catch (e) {
      console.error('[Analytics] Sekme yükleme hatası:', e.message);
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
        <div class="ap-cards">
          <div class="ap-card">
            <div class="ap-card-label">Bugün Ciro</div>
            <div class="ap-card-value" id="ap-today-rev">—</div>
            <div class="ap-card-sub" id="ap-today-sub"></div>
          </div>
          <div class="ap-card">
            <div class="ap-card-label">Bu Hafta Ciro</div>
            <div class="ap-card-value" id="ap-week-rev">—</div>
            <div class="ap-card-sub" id="ap-week-sub"></div>
          </div>
          <div class="ap-card">
            <div class="ap-card-label">Bu Ay Ciro</div>
            <div class="ap-card-value" id="ap-month-rev">—</div>
            <div class="ap-card-sub" id="ap-month-sub"></div>
          </div>
          <div class="ap-card">
            <div class="ap-card-label">Toplam Sipariş</div>
            <div class="ap-card-value" id="ap-total-orders">—</div>
            <div class="ap-card-sub" id="ap-total-sub"></div>
          </div>
        </div>

        <div class="ap-chart-box">
          <div class="ap-chart-header">
            <h3>Satış Grafiği</h3>
            <div class="ap-tabs">
              <button class="ap-tab active" onclick="window._apSwitchPeriod('daily')">Günlük</button>
              <button class="ap-tab" onclick="window._apSwitchPeriod('weekly')">Haftalık</button>
              <button class="ap-tab" onclick="window._apSwitchPeriod('monthly')">Aylık</button>
            </div>
          </div>
          <canvas id="ap-main-chart" height="280"></canvas>
        </div>

        <div class="ap-chart-box">
          <div class="ap-chart-header">
            <h3>En Çok Satan Ürünler (Son 30 Gün)</h3>
          </div>
          <canvas id="ap-top-chart" height="260"></canvas>
        </div>
      </div>
    `;

    try {
      const [summary, daily, topProducts] = await Promise.all([
        apApi('/api/analytics/summary'),
        apApi('/api/analytics/daily'),
        apApi('/api/analytics/top-products'),
      ]);
      renderCards(summary);
      renderMainChart(daily, 'daily');
      renderTopChart(topProducts);
    } catch (e) {
      container.innerHTML = `<div class="ap-empty">Hata: ${String(e.message).replace(/</g, '&lt;')}</div>`;
    }
  }

  window.loadAnalytics = loadAnalytics;
})();
