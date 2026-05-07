// public/js/healthPage.js
// Ürün Sağlık Merkezi sayfası — SPA IIFE modülü.
(function () {
  'use strict';

  // ── Stiller ──────────────────────────────────────────────────────────────────
  const STYLE = `
    #page-health {
      padding: 8px 0 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: hidden;
    }
    .hp-shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
    }

    /* Toolbar */
    .hp-toolbar {
      background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,255,255,.92));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: var(--shadow);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .hp-toolbar-title { font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
    .hp-toolbar-sub   { font-size: 13px; color: var(--muted); }

    /* Loading / Error */
    .hp-loading {
      text-align: center;
      padding: 56px 20px;
      color: var(--muted);
      font-size: 14px;
    }
    .hp-error {
      text-align: center;
      padding: 56px 20px;
      color: var(--red);
      font-size: 14px;
    }
    .hp-retry-btn {
      margin-left: 10px;
      padding: 6px 14px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      color: var(--text);
    }
    .hp-retry-btn:hover { background: var(--border); }

    /* KPI satırı */
    .hp-kpi-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }
    .hp-kpi {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      position: relative;
      overflow: hidden;
    }
    .hp-kpi-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
    .hp-kpi-val   { font-size: 26px; font-weight: 700; }
    .hp-kpi-sub   { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .hp-kpi-glow  { position: absolute; top: -24px; right: -24px; width: 80px; height: 80px; border-radius: 50%; opacity: .09; }

    /* İki sütun */
    .hp-two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    /* Kart */
    .hp-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .hp-card-head {
      padding: 16px 20px 12px;
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
      border-bottom: 1px solid var(--border);
    }
    .hp-card-body { padding: 16px 20px; }

    /* Kategori bar */
    .hp-cat-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .hp-cat-label {
      font-size: 12px;
      color: var(--muted);
      min-width: 140px;
    }
    .hp-cat-bar-wrap {
      flex: 1;
      height: 8px;
      background: var(--bg3);
      border-radius: 99px;
      overflow: hidden;
    }
    .hp-cat-bar {
      height: 100%;
      border-radius: 99px;
      background: var(--accent);
      transition: width .4s ease;
    }
    .hp-cat-count {
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
      min-width: 70px;
      text-align: right;
    }

    /* Risk badge */
    .hp-risk {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 99px;
    }
    .hp-risk.high   { background: rgba(220,38,38,.12);  color: var(--red); }
    .hp-risk.medium { background: rgba(217,119,6,.12);  color: var(--yellow); }
    .hp-risk.low    { background: rgba(22,163,74,.12);  color: var(--green); }

    /* İade listesi */
    .hp-refund-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      gap: 8px;
    }
    .hp-refund-row:last-child { border-bottom: none; }
    .hp-refund-name { flex: 1; color: var(--text); font-weight: 500; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hp-refund-rate { color: var(--muted); font-size: 12px; }

    /* Skor tablosu */
    .hp-score-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .hp-score-table th {
      text-align: left;
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .4px;
      border-bottom: 2px solid var(--border);
    }
    .hp-score-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      color: var(--text);
    }
    .hp-score-table tr:last-child td { border-bottom: none; }
    .hp-score-table tr:hover td { background: var(--bg3); }
    .hp-score-table tbody tr { cursor: pointer; }
    .hp-score-num {
      font-weight: 700;
      font-size: 14px;
    }
    .hp-score-num.green  { color: var(--green); }
    .hp-score-num.yellow { color: var(--yellow); }
    .hp-score-num.red    { color: var(--red); }
    .hp-alert-tag {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(220,38,38,.1);
      color: var(--red);
      margin-left: 4px;
    }
    .hp-product-name {
      font-weight: 500;
      max-width: 220px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hp-empty {
      text-align: center;
      padding: 32px;
      color: var(--muted);
      font-size: 13px;
    }

    /* Top products listesi */
    .hp-top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 12px;
      border-bottom: 1px solid var(--border);
    }
    .hp-top-row:last-child { border-bottom: none; }
    .hp-top-name { color: var(--text); font-weight: 500; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hp-top-count { color: var(--muted); margin-left: 8px; }

    /* ── Filtre bar (hpf-) ───────────────────────────────────────────────── */
    .hpf-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      gap: 12px;
      flex-wrap: wrap;
      background: var(--bg3);
    }
    .hpf-btn-group { display: flex; gap: 6px; flex-wrap: wrap; }
    .hpf-btn {
      padding: 5px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--card);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      color: var(--muted);
      transition: all .15s;
    }
    .hpf-btn:hover { background: var(--border); color: var(--text); }
    .hpf-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .hpf-sort-wrap { display: flex; align-items: center; gap: 8px; }
    .hpf-sort-label { font-size: 12px; color: var(--muted); white-space: nowrap; }
    .hpf-sort {
      padding: 5px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--card);
      font-size: 12px;
      font-family: inherit;
      color: var(--text);
      cursor: pointer;
    }

    /* ── Ürün detay modalı (hpm-) ───────────────────────────────────────── */
    .hpm-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.45);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; padding: 16px;
    }
    .hpm-card {
      background: #fff; border-radius: 16px;
      width: 100%; max-width: 520px; max-height: 90vh;
      overflow-y: auto; box-shadow: 0 8px 40px rgba(0,0,0,.18);
      display: flex; flex-direction: column;
    }
    .hpm-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      padding: 20px 24px 16px; border-bottom: 1px solid #e2e8f0; gap: 12px;
      position: sticky; top: 0; background: #fff; z-index: 1;
    }
    .hpm-title { font-size: 15px; font-weight: 700; color: #1e293b; line-height: 1.4; }
    .hpm-close {
      background: none; border: none; font-size: 20px; cursor: pointer;
      color: #64748b; padding: 4px 8px; border-radius: 6px; line-height: 1; flex-shrink: 0;
    }
    .hpm-close:hover { background: #f1f5f9; }
    .hpm-body { padding: 20px 24px; flex: 1; display: flex; flex-direction: column; gap: 18px; }
    .hpm-section-title {
      font-size: 11px; font-weight: 700; color: #64748b;
      text-transform: uppercase; letter-spacing: .5px; margin-bottom: 10px;
    }
    .hpm-overall { background: #f8fafc; border-radius: 12px; padding: 16px; }
    .hpm-overall-score { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .hpm-bar-wrap { height: 10px; background: #e2e8f0; border-radius: 99px; overflow: hidden; }
    .hpm-bar { height: 100%; border-radius: 99px; transition: width .4s ease; }
    .hpm-detail-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .hpm-detail-label { font-size: 13px; color: #1e293b; min-width: 90px; }
    .hpm-detail-bar-wrap { flex: 1; height: 8px; background: #e2e8f0; border-radius: 99px; overflow: hidden; }
    .hpm-detail-bar { height: 100%; border-radius: 99px; }
    .hpm-detail-val { font-size: 13px; font-weight: 700; min-width: 55px; text-align: right; }
    .hpm-alert-item {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 10px 12px; background: #fef2f2; border-radius: 8px; margin-bottom: 6px;
      font-size: 13px; color: #dc2626; line-height: 1.4;
    }
    .hpm-alert-item.warn { background: #fffbeb; color: #d97706; }
    .hpm-rec-item {
      padding: 10px 12px; background: #f8fafc; border-radius: 8px; margin-bottom: 6px;
      font-size: 13px; color: #1e293b; line-height: 1.5;
    }
    .hpm-actions {
      display: flex; gap: 10px; padding: 16px 24px;
      border-top: 1px solid #e2e8f0; flex-wrap: wrap;
    }
    .hpm-btn {
      padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; border: 1px solid #e2e8f0; background: #f8fafc;
      color: #1e293b; font-family: inherit; flex: 1; min-width: 140px;
    }
    .hpm-btn:hover { background: #f1f5f9; }
    .hpm-btn-primary { background: #6c63ff; color: #fff; border-color: #6c63ff; }
    .hpm-btn-primary:hover { background: #5b52e0; }

    @media (max-width: 768px) {
      .hp-kpi-row { grid-template-columns: 1fr 1fr; }
      .hp-two-col { grid-template-columns: 1fr; }
    }
    @media (max-width: 540px) {
      .hpm-card    { max-width: 90vw; }
      .hpm-body    { padding: 16px; }
      .hpm-actions { flex-direction: column; }
      .hpf-bar     { flex-direction: column; align-items: flex-start; }
    }
    @media (max-width: 480px) {
      .hp-kpi-row { grid-template-columns: 1fr; }
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

  // ── Filtre / sıralama durumu ──────────────────────────────────────────────
  let _allScores   = [];
  let _filterState = { filter: 'all', sort: 'overall_asc' };

  // ── Yardımcılar ───────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function scoreClass(v) {
    if (v > 70) return 'green';
    if (v >= 50) return 'yellow';
    return 'red';
  }

  function scoreIcon(v) {
    if (v > 70) return '✅';
    if (v >= 50) return '⚠️';
    return '🔴';
  }

  function scoreBadge(v) {
    if (v >= 80) return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:#10b981">🟢 İyi</span>';
    if (v >= 50) return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:#f59e0b">🟡 Orta</span>';
    return           '<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:#ef4444">🔴 Zayıf</span>';
  }

  function scoreBarColor(v) {
    if (v > 70) return '#10b981';
    if (v >= 50) return '#f59e0b';
    return '#ef4444';
  }

  const CAT_LABELS = {
    urun_ozellikleri: 'Ürün Özellikleri',
    kargo_teslimat:   'Kargo / Teslimat',
    iade_talebi:      'İade Talebi',
    fiyat_kampanya:   'Fiyat / Kampanya',
    stok_durumu:      'Stok Durumu',
  };

  const CAT_ORDER = [
    'urun_ozellikleri',
    'kargo_teslimat',
    'iade_talebi',
    'fiyat_kampanya',
    'stok_durumu',
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  function renderKPIs(stats, scores) {
    const { questions, refunds } = stats;
    const analyzedCount = scores.length;
    const riskIcon  = questions.riskAlert ? '⚠️ Risk Var' : '✅ Normal';
    const riskColor = questions.riskAlert ? 'var(--red)' : 'var(--green)';

    return `
      <div class="hp-kpi-row">
        <div class="hp-kpi">
          <div class="hp-kpi-label">Toplam Soru</div>
          <div class="hp-kpi-val">${questions.total}</div>
          <div class="hp-kpi-sub">Analiz edilmiş</div>
          <div class="hp-kpi-glow" style="background:var(--accent)"></div>
        </div>
        <div class="hp-kpi">
          <div class="hp-kpi-label">Genel İade Oranı</div>
          <div class="hp-kpi-val" style="color:${refunds.refundRate >= 15 ? 'var(--red)' : refunds.refundRate >= 8 ? 'var(--yellow)' : 'var(--green)'}">
            %${refunds.refundRate}
          </div>
          <div class="hp-kpi-sub">${refunds.totalRefunds} iade siparişi</div>
          <div class="hp-kpi-glow" style="background:var(--red)"></div>
        </div>
        <div class="hp-kpi">
          <div class="hp-kpi-label">Skor Hesaplanan</div>
          <div class="hp-kpi-val">${analyzedCount}</div>
          <div class="hp-kpi-sub">Ürün</div>
          <div class="hp-kpi-glow" style="background:var(--green)"></div>
        </div>
        <div class="hp-kpi">
          <div class="hp-kpi-label">Risk Durumu</div>
          <div class="hp-kpi-val" style="font-size:18px;color:${riskColor}">${riskIcon}</div>
          <div class="hp-kpi-sub">İade talebi ${questions.riskAlert ? '>%15' : '<%15'}</div>
          <div class="hp-kpi-glow" style="background:var(--yellow)"></div>
        </div>
      </div>`;
  }

  function renderCategoryBars(questions) {
    const { total, byCategory, topProducts } = questions;
    const bars = CAT_ORDER.map(cat => {
      const count = byCategory[cat] || 0;
      const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
      const width = total > 0 ? (count / total) * 100 : 0;
      return `
        <div class="hp-cat-row">
          <span class="hp-cat-label">${CAT_LABELS[cat]}</span>
          <div class="hp-cat-bar-wrap">
            <div class="hp-cat-bar" style="width:${width}%"></div>
          </div>
          <span class="hp-cat-count">${count} (%${pct})</span>
        </div>`;
    }).join('');

    const topList = topProducts.slice(0, 5).map((p, i) => `
      <div class="hp-top-row">
        <span class="hp-top-name">${i + 1}. ${esc(p.product_name)}</span>
        <span class="hp-top-count">${p.questionCount} soru</span>
      </div>`).join('');

    return `
      <div class="hp-card">
        <div class="hp-card-head">💬 Müşteri Soru Dağılımı</div>
        <div class="hp-card-body">
          ${total === 0
            ? '<div class="hp-empty">Henüz analiz edilmiş soru yok.<br>Analiz Et butonuna tıklayın.</div>'
            : bars
          }
          ${topProducts.length > 0 ? `
            <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
              <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">
                ⚠️ En çok soru gelen ürünler
              </div>
              ${topList}
            </div>` : ''}
        </div>
      </div>`;
  }

  function renderRefunds(refunds) {
    const riskIcon = { high: '🔴', medium: '🟡', low: '🟢' };
    const rows = refunds.byProduct.slice(0, 8).map(p => `
      <div class="hp-refund-row">
        <span class="hp-refund-name">${riskIcon[p.risk] || ''} ${esc(p.product_name)}</span>
        <span class="hp-refund-rate">${p.refundCount} iade</span>
        <span class="hp-risk ${p.risk}">%${p.refundRate} ${p.risk === 'high' ? 'Yüksek' : p.risk === 'medium' ? 'Orta' : 'Düşük'} Risk</span>
      </div>`).join('');

    return `
      <div class="hp-card">
        <div class="hp-card-head">📦 İade Durumu</div>
        <div class="hp-card-body">
          <div style="display:flex;gap:24px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:11px;color:var(--muted);font-weight:600">Toplam İade</div>
              <div style="font-size:20px;font-weight:700">${refunds.totalRefunds} sipariş</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--muted);font-weight:600">Genel Oran</div>
              <div style="font-size:20px;font-weight:700">%${refunds.refundRate}</div>
            </div>
          </div>
          ${rows || '<div class="hp-empty">İade verisi bulunamadı.</div>'}
        </div>
      </div>`;
  }

  // ── Skor tablosu satır render ─────────────────────────────────────────────
  function renderScoreRows(list) {
    if (!list.length) {
      return `<tr><td colspan="5" class="hp-empty">Bu filtreye uyan ürün bulunamadı.</td></tr>`;
    }
    return list.map(s => {
      const idx    = _allScores.indexOf(s);
      const alerts = (s.alerts || []).map(a =>
        `<span class="hp-alert-tag" title="${esc(a.message)}">!</span>`
      ).join('');
      return `
        <tr onclick="window._hpOpenModal(${idx})" title="Detay için tıklayın">
          <td><span class="hp-product-name" title="${esc(s.product_title)}">${esc(s.product_title)}</span>${alerts}</td>
          <td>${scoreBadge(s.sales_score)}</td>
          <td>${scoreBadge(s.refund_score)}</td>
          <td>${scoreBadge(s.question_score)}</td>
          <td><span class="hp-score-num ${scoreClass(s.overall_score)}">${scoreIcon(s.overall_score)} ${s.overall_score}</span></td>
        </tr>`;
    }).join('');
  }

  // ── Filtre / sıralama uygula (client-side) ────────────────────────────────
  function applyFilterSort() {
    let data = [..._allScores];

    if      (_filterState.filter === 'critical') data = data.filter(s => s.overall_score < 50);
    else if (_filterState.filter === 'warning')  data = data.filter(s => s.overall_score >= 50 && s.overall_score <= 70);
    else if (_filterState.filter === 'good')     data = data.filter(s => s.overall_score > 70);

    const sortFns = {
      overall_asc:   (a, b) => a.overall_score  - b.overall_score,
      overall_desc:  (a, b) => b.overall_score  - a.overall_score,
      sales_desc:    (a, b) => b.sales_score    - a.sales_score,
      refund_desc:   (a, b) => b.refund_score   - a.refund_score,
      question_desc: (a, b) => b.question_score - a.question_score,
    };
    data.sort(sortFns[_filterState.sort] || sortFns.overall_asc);

    const tbody = document.getElementById('hp-score-tbody');
    if (tbody) tbody.innerHTML = renderScoreRows(data);

    document.querySelectorAll('.hpf-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === _filterState.filter);
    });

    const sel = document.querySelector('.hpf-sort');
    if (sel) sel.value = _filterState.sort;
  }

  // ── Skor tablosu kart ─────────────────────────────────────────────────────
  function renderScoreTable(scores) {
    if (!scores.length) {
      return `
        <div class="hp-card">
          <div class="hp-card-head">🏆 Ürün Performans Tablosu</div>
          <div class="hp-card-body">
            <div class="hp-empty">Henüz skor hesaplanmamış.<br>Analiz Et butonuna tıklayın.</div>
          </div>
        </div>`;
    }

    return `
      <div class="hp-card">
        <div class="hp-card-head">🏆 Ürün Performans Tablosu</div>
        <div class="hpf-bar">
          <div class="hpf-btn-group">
            <button class="hpf-btn active" data-filter="all"      onclick="window._hpFilter('all')">Tümü</button>
            <button class="hpf-btn"        data-filter="critical" onclick="window._hpFilter('critical')">🔴 Kritik</button>
            <button class="hpf-btn"        data-filter="warning"  onclick="window._hpFilter('warning')">⚠️ Uyarı</button>
            <button class="hpf-btn"        data-filter="good"     onclick="window._hpFilter('good')">✅ İyi</button>
          </div>
          <div class="hpf-sort-wrap">
            <span class="hpf-sort-label">Sırala:</span>
            <select class="hpf-sort" onchange="window._hpSort(this.value)">
              <option value="overall_asc">Genel (düşük → yüksek)</option>
              <option value="overall_desc">Genel (yüksek → düşük)</option>
              <option value="sales_desc">Satış Skoru</option>
              <option value="refund_desc">İade Skoru</option>
              <option value="question_desc">Soru Skoru</option>
            </select>
          </div>
        </div>
        <div class="hp-card-body" style="padding:0;overflow-x:auto">
          <table class="hp-score-table">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Satış</th>
                <th>İade</th>
                <th>Soru</th>
                <th>Genel</th>
              </tr>
            </thead>
            <tbody id="hp-score-tbody"></tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Modal yardımcıları ────────────────────────────────────────────────────
  function generateRecommendations(s) {
    const recs = [];
    if (s.overall_score < 50)  recs.push('⚠️ Kritik seviye. Tedarikçiyle acil görüşme yapmanız önerilir.');
    if (s.refund_score < 60)   recs.push('📦 İade oranı yüksek. Ürün kalitesi veya açıklaması gözden geçirilmeli.');
    if (s.question_score < 60) recs.push('💬 İade talebi soruları yoğun. Ürün açıklamasını detaylandırın.');
    if (s.sales_score < 40)    recs.push('🛒 Satış düşük. Fiyat optimizasyonu veya kampanya değerlendirilebilir.');
    if (s.sales_score >= 80)   recs.push('✅ Satış performansı güçlü. Stok takibini artırın.');
    if (s.overall_score >= 80) recs.push('🏆 Ürün sağlıklı. Mevcut stratejiyi koruyun.');
    return recs;
  }

  function renderDetailBar(label, val) {
    const color = scoreBarColor(val);
    return `
      <div class="hpm-detail-row">
        <span class="hpm-detail-label">${label}</span>
        <div class="hpm-detail-bar-wrap">
          <div class="hpm-detail-bar" style="width:${val}%;background:${color}"></div>
        </div>
        <span class="hpm-detail-val" style="color:${color}">${val}/100</span>
      </div>`;
  }

  function openHealthModal(s) {
    const existing = document.getElementById('hpm-overlay');
    if (existing) existing.remove();

    const recs         = generateRecommendations(s);
    const alerts       = s.alerts || [];
    const overallColor = scoreBarColor(s.overall_score);

    const alertsHtml = alerts.length
      ? alerts.map(a => `
          <div class="hpm-alert-item ${a.severity === 'medium' ? 'warn' : ''}">
            ${a.severity === 'high' ? '🔴' : '⚠️'} ${esc(a.message)}
          </div>`).join('')
      : '<div class="hpm-rec-item">✅ Uyarı yok — ürün sağlıklı</div>';

    const recsHtml = recs.length
      ? recs.map(r => `<div class="hpm-rec-item">${r}</div>`).join('')
      : '<div class="hpm-rec-item">Öneri bulunmuyor.</div>';

    document.body.insertAdjacentHTML('beforeend', `
      <div class="hpm-overlay" id="hpm-overlay">
        <div class="hpm-card" id="hpm-card">
          <div class="hpm-header">
            <div class="hpm-title">${esc(s.product_title)}</div>
            <button class="hpm-close" id="hpm-close">✕</button>
          </div>
          <div class="hpm-body">
            <div class="hpm-overall">
              <div class="hpm-section-title">Genel Skor</div>
              <div class="hpm-overall-score" style="color:${overallColor}">
                ${scoreIcon(s.overall_score)} ${s.overall_score}
              </div>
              <div class="hpm-bar-wrap">
                <div class="hpm-bar" style="width:${s.overall_score}%;background:${overallColor}"></div>
              </div>
            </div>
            <div>
              <div class="hpm-section-title">Detay Skorlar</div>
              ${renderDetailBar('🛒 Satış', s.sales_score)}
              ${renderDetailBar('📦 İade', s.refund_score)}
              ${renderDetailBar('💬 Soru', s.question_score)}
            </div>
            <div>
              <div class="hpm-section-title">Uyarılar</div>
              ${alertsHtml}
            </div>
            <div>
              <div class="hpm-section-title">Öneriler</div>
              ${recsHtml}
            </div>
          </div>
          <div class="hpm-actions">
            <button class="hpm-btn hpm-btn-primary" id="hpm-btn-pricing">💰 Fiyat Önerisi Al</button>
            <button class="hpm-btn"                 id="hpm-btn-sales">📊 Satış Grafiği</button>
          </div>
        </div>
      </div>`);

    const overlay  = document.getElementById('hpm-overlay');
    const card     = document.getElementById('hpm-card');
    const closeBtn = document.getElementById('hpm-close');

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (!card.contains(e.target)) close(); });
    document.addEventListener('keydown', onKey);

    document.getElementById('hpm-btn-pricing').addEventListener('click', () => {
      close();
      if (window.navigate) window.navigate('pricing');
    });
    document.getElementById('hpm-btn-sales').addEventListener('click', () => {
      close();
      if (window.navigate) window.navigate('analytics');
    });
  }

  // ── Sayfa iskeleti ────────────────────────────────────────────────────────
  function renderShell() {
    return `
      <div class="hp-shell">
        <div class="hp-toolbar">
          <div>
            <h2 class="hp-toolbar-title">🏥 Ürün Sağlık Merkezi</h2>
            <p class="hp-toolbar-sub">Müşteri soruları ve iade verileri analizi</p>
          </div>
          <button class="btn btn-primary" id="hp-analyze-btn" onclick="window._hpAnalyze()">
            🔄 Analiz Et
          </button>
        </div>
        <div id="hp-body">
          <div class="hp-loading">⏳ Veriler yükleniyor...</div>
        </div>
      </div>`;
  }

  // ── Global handler'lar ────────────────────────────────────────────────────
  window._hpFilter = function (filter) {
    _filterState.filter = filter;
    applyFilterSort();
  };

  window._hpSort = function (sort) {
    _filterState.sort = sort;
    applyFilterSort();
  };

  window._hpOpenModal = function (idx) {
    const s = _allScores[idx];
    if (s) openHealthModal(s);
  };

  // ── Veri yükle ve render et ───────────────────────────────────────────────
  async function loadData() {
    const body = document.getElementById('hp-body');
    if (!body) return;

    try {
      const [stats, scores] = await Promise.all([
        window.api('/api/health/stats'),
        window.api('/api/health/scores'),
      ]);
      if (!stats || !scores) return;

      _allScores   = scores;
      _filterState = { filter: 'all', sort: 'overall_asc' };

      body.innerHTML =
        renderKPIs(stats, scores) +
        `<div class="hp-two-col">
          ${renderCategoryBars(stats.questions)}
          ${renderRefunds(stats.refunds)}
        </div>` +
        renderScoreTable(scores);

      applyFilterSort();

    } catch (e) {
      body.innerHTML = `
        <div class="hp-error">
          ❌ Veriler yüklenemedi: ${esc(e.message)}
          <button class="hp-retry-btn" onclick="window.loadHealthPage()">Tekrar Dene</button>
        </div>`;
    }
  }

  // ── Analiz Et butonu ──────────────────────────────────────────────────────
  window._hpAnalyze = async function () {
    const btn = document.getElementById('hp-analyze-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '⏳ Analiz ediliyor...';

    try {
      const result = await window.api('/api/health/analyze', { method: 'POST' });
      if (!result) return;
      window.toast(
        `✅ ${result.analyzed} soru analiz edildi, ${result.scoresUpdated} ürün skoru güncellendi`,
        'success'
      );
      await loadData();
    } catch (e) {
      window.toast('❌ Analiz hatası: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Analiz Et'; }
    }
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectStyle();
    const container = document.getElementById('page-health');
    if (!container) return;
    container.innerHTML = renderShell();
    loadData();
  }

  window.loadHealthPage = init;

})();
