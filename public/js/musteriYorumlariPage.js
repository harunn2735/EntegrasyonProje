// public/js/musteriYorumlariPage.js
(function () {
  'use strict';

  const STYLE = `
    #page-reviews { padding: 8px 0 0; width: 100%; max-width: 100%; box-sizing: border-box; }
    .rv-shell { display: flex; flex-direction: column; gap: 16px; max-width: 1180px; margin: 0 auto; }
    .rv-toolbar { background: linear-gradient(180deg,rgba(255,255,255,.98),rgba(255,255,255,.92)); border: 1px solid var(--border); border-radius: 16px; padding: 18px 20px; box-shadow: var(--shadow); }
    .rv-toolbar-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .rv-title { font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
    .rv-sub { font-size: 13px; color: var(--muted); }
    .rv-kpi-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; }
    .rv-kpi { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
    .rv-kpi-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
    .rv-kpi-val { font-size: 24px; font-weight: 700; }
    .rv-filter-bar { display: inline-flex; gap: 4px; padding: 4px; background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; }
    .rv-filter-btn { padding: 7px 14px; border-radius: 8px; border: none; background: transparent; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--muted); font-family: inherit; transition: .15s; }
    .rv-filter-btn:hover { color: var(--text); }
    .rv-filter-btn.active { background: var(--accent); color: #fff; }
    .rv-table { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .rv-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .rv-table th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); background: var(--bg3); }
    .rv-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    .rv-table tr:last-child td { border-bottom: none; }
    .rv-table tr:hover td { background: var(--bg3); }
    .rv-badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
    .rv-badge.pozitif { background: rgba(22,163,74,.1); color: var(--green); }
    .rv-badge.negatif { background: rgba(220,38,38,.1); color: var(--red); }
    .rv-badge.nötr { background: var(--bg3); color: var(--muted); }
    .rv-stars { color: #f59e0b; }
    .rv-response-area { width: 100%; padding: 6px 8px; font-family: inherit; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg2); color: var(--text); resize: vertical; min-height: 60px; }
    .rv-response-area:focus { outline: none; border-color: var(--accent); }
    .rv-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
    .rv-empty { text-align: center; padding: 56px 20px; color: var(--muted); }
    .rv-empty .emoji { font-size: 44px; margin-bottom: 12px; }
    @media (max-width: 640px) { .rv-kpi-row { grid-template-columns: 1fr 1fr; } }
  `;

  let currentFilter = '';

  function stars(n) {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  function sentimentBadge(s) {
    if (!s) return '<span class="rv-badge nötr">—</span>';
    const labels = { pozitif: 'Pozitif ✓', negatif: 'Negatif ✗', 'nötr': 'Nötr' };
    return `<span class="rv-badge ${s}">${labels[s] || s}</span>`;
  }

  function statusBadge(s) {
    const map = { Bekliyor: '#f59e0b', Onaylandı: 'var(--accent)', Gönderildi: 'var(--green)', Reddedildi: 'var(--red)' };
    return `<span style="font-size:11px;font-weight:600;color:${map[s]||'var(--muted)'}">${s}</span>`;
  }

  function renderRow(r) {
    const canApprove = r.status === 'Bekliyor';
    const canSend    = r.status === 'Onaylandı';
    const responseText = r.approved_response || r.ai_response || '';

    return `
      <tr id="rv-row-${r.id}">
        <td style="max-width:180px">
          <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(r.product_name || '—')}</div>
          <div style="font-size:11px;color:var(--muted)">${r.barcode || ''}</div>
        </td>
        <td style="max-width:260px">
          <div class="rv-stars">${stars(r.rating)}</div>
          <div style="font-size:12px;margin-top:2px">${escHtml(r.review_text.slice(0, 150))}${r.review_text.length > 150 ? '…' : ''}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${r.customer_name || ''}</div>
        </td>
        <td>${sentimentBadge(r.sentiment)}<br><span style="font-size:11px;color:var(--muted)">${r.category || '—'}</span></td>
        <td>
          ${r.ai_response
            ? `<textarea class="rv-response-area" id="rv-txt-${r.id}">${escHtml(responseText)}</textarea>
               <div class="rv-actions">
                 ${canApprove ? `<button class="btn btn-success btn-sm" onclick="window.rvApprove(${r.id})">✓ Onayla</button>` : ''}
                 ${canSend    ? `<button class="btn btn-primary btn-sm" onclick="window.rvSend(${r.id})">📤 Gönder</button>` : ''}
                 ${canApprove ? `<button class="btn btn-danger btn-sm"  onclick="window.rvReject(${r.id})">✗ Reddet</button>` : ''}
               </div>`
            : `<span style="font-size:12px;color:var(--muted)">AI analizi bekleniyor…</span>
               <div><button class="btn btn-ghost btn-sm" style="margin-top:4px" onclick="window.rvAnalyze(${r.id})">▶ Analiz Et</button></div>`
          }
        </td>
        <td>${statusBadge(r.status)}</td>
      </tr>`;
  }

  async function load(filter) {
    currentFilter = filter ?? currentFilter;
    const tbody = document.getElementById('rv-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">Yükleniyor…</td></tr>';

    try {
      const params = new URLSearchParams({ limit: 50, page: 1 });
      if (currentFilter === 'pending')  params.set('status', 'Bekliyor');
      if (currentFilter === 'negative') params.set('rating_max', '2');
      if (currentFilter === 'approved') params.set('status', 'Onaylandı');

      const data = await window.api('/api/dealer/reviews?' + params);
      if (!data) return;

      // KPI güncelle
      const s = data.stats || {};
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };
      set('rv-kpi-total', s.total);
      set('rv-kpi-pos',   s.positive);
      set('rv-kpi-neg',   s.negative);
      set('rv-kpi-pend',  s.pending_response);

      if (!tbody) return;
      if (!data.reviews?.length) {
        tbody.innerHTML = '<tr><td colspan="5"><div class="rv-empty"><div class="emoji">⭐</div><p>Yorum bulunamadı. "Yorumları Çek" butonuna tıklayın.</p></div></td></tr>';
        return;
      }
      tbody.innerHTML = data.reviews.map(renderRow).join('');
    } catch (e) {
      const tbody2 = document.getElementById('rv-tbody');
      if (tbody2) tbody2.innerHTML = `<tr><td colspan="5"><div class="rv-empty"><div class="emoji">⚠️</div><p>${escHtml(e.message)}</p></div></td></tr>`;
    }
  }

  function setFilter(f) {
    currentFilter = f;
    document.querySelectorAll('.rv-filter-btn').forEach(b => b.classList.remove('active'));
    const ids = { '': 'rv-fb-all', pending: 'rv-fb-pending', negative: 'rv-fb-negative', approved: 'rv-fb-approved' };
    const btn = document.getElementById(ids[f] ?? 'rv-fb-all');
    if (btn) btn.classList.add('active');
  }

  window.rvFilter = function (f) { setFilter(f); load(f); };

  window.rvSync = async function () {
    const btn = document.getElementById('rv-sync-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Çekiliyor…'; }
    try {
      const r = await window.api('/api/dealer/reviews/sync');
      if (r) window.toast(`✅ ${r.fetched} yorum kontrol edildi, ${r.saved} yeni kaydedildi`, 'success');
      await load();
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('404') || msg.includes('mevcut değil')) {
        window.toast('⚠️ Trendyol yorum API bu hesap için aktif değil. "Demo Veri Ekle" butonunu kullanın.', 'error');
      } else {
        window.toast('❌ ' + msg, 'error');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Yorumları Çek'; }
    }
  };

  window.rvSeedDemo = async function () {
    const btn = document.getElementById('rv-demo-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Ekleniyor…'; }
    try {
      const r = await window.api('/api/dealer/reviews/seed-demo', { method: 'POST' });
      if (r) window.toast(`✅ ${r.message}`, 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🧪 Demo Veri Ekle'; }
    }
  };

  window.rvAnalyzeAll = async function () {
    const btn = document.getElementById('rv-analyze-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Analiz ediliyor…'; }
    try {
      const r = await window.api('/api/dealer/reviews/analyze-all', { method: 'POST' });
      if (r) window.toast(`✅ ${r.analyzed} yorum analiz edildi`, 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🤖 Tümünü Analiz Et'; }
    }
  };

  window.rvBulkPositive = async function () {
    try {
      const r = await window.api('/api/dealer/reviews/bulk-approve-positive', { method: 'POST' });
      if (r) window.toast(`✅ ${r.approved} pozitif yorum otomatik onaylandı`, 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    }
  };

  window.rvAnalyze = async function (id) {
    try {
      await window.api(`/api/dealer/reviews/analyze/${id}`, { method: 'POST' });
      window.toast('✅ Analiz tamamlandı', 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    }
  };

  window.rvApprove = async function (id) {
    const txt = document.getElementById(`rv-txt-${id}`)?.value?.trim();
    if (!txt) return window.toast('Yanıt metni boş olamaz', 'error');
    try {
      await window.api(`/api/dealer/reviews/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ response_text: txt }),
      });
      window.toast('✅ Onaylandı — "Gönder" ile Trendyol\'a iletin', 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    }
  };

  window.rvSend = async function (id) {
    const txt = document.getElementById(`rv-txt-${id}`)?.value?.trim();
    if (txt) {
      try {
        await window.api(`/api/dealer/reviews/${id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ response_text: txt }),
        });
      } catch (_) {}
    }
    try {
      await window.api(`/api/dealer/reviews/${id}/send`, { method: 'POST' });
      window.toast('✅ Yanıt Trendyol\'a gönderildi', 'success');
      const row = document.getElementById(`rv-row-${id}`);
      if (row) { row.style.opacity = '0.5'; setTimeout(() => load(), 1000); }
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    }
  };

  window.rvReject = async function (id) {
    try {
      await window.api(`/api/dealer/reviews/${id}/reject`, { method: 'POST' });
      window.toast('Reddedildi', 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    }
  };

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function init() {
    const container = document.getElementById('page-reviews');
    if (!container) return;

    container.innerHTML = `
      <div class="rv-shell">
        <div class="rv-toolbar">
          <div class="rv-toolbar-head">
            <div>
              <h2 class="rv-title">⭐ Müşteri Yorumları</h2>
              <p class="rv-sub">Trendyol yorumları — AI analizi ve yanıt yönetimi</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-ghost"    id="rv-analyze-btn"  onclick="window.rvAnalyzeAll()">🤖 Tümünü Analiz Et</button>
              <button class="btn btn-ghost"                         onclick="window.rvBulkPositive()">✅ Pozitiflere Otomatik Yanıt</button>
              <button class="btn btn-ghost"    id="rv-demo-btn"     onclick="window.rvSeedDemo()" title="Trendyol API mevcut olmadığında test verisi ekler">🧪 Demo Veri Ekle</button>
              <button class="btn btn-primary"  id="rv-sync-btn"     onclick="window.rvSync()">🔄 Yorumları Çek</button>
            </div>
          </div>
        </div>

        <div class="rv-kpi-row" id="rv-kpis">
          <div class="rv-kpi"><div class="rv-kpi-label">Toplam Yorum</div><div class="rv-kpi-val" id="rv-kpi-total">—</div></div>
          <div class="rv-kpi"><div class="rv-kpi-label">Pozitif</div><div class="rv-kpi-val" style="color:var(--green)" id="rv-kpi-pos">—</div></div>
          <div class="rv-kpi"><div class="rv-kpi-label">Negatif</div><div class="rv-kpi-val" style="color:var(--red)" id="rv-kpi-neg">—</div></div>
          <div class="rv-kpi"><div class="rv-kpi-label">Bekleyen Yanıt</div><div class="rv-kpi-val" style="color:var(--accent)" id="rv-kpi-pend">—</div></div>
        </div>

        <div>
          <div class="rv-filter-bar">
            <button class="rv-filter-btn active" id="rv-fb-all"      onclick="window.rvFilter('')">Tümü</button>
            <button class="rv-filter-btn"         id="rv-fb-pending"  onclick="window.rvFilter('pending')">Bekleyen</button>
            <button class="rv-filter-btn"         id="rv-fb-negative" onclick="window.rvFilter('negative')">Negatif (1-2★)</button>
            <button class="rv-filter-btn"         id="rv-fb-approved" onclick="window.rvFilter('approved')">Onaylandı</button>
          </div>
        </div>

        <div class="rv-table">
          <table>
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Yorum</th>
                <th>Analiz</th>
                <th>AI Yanıt Önerisi</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody id="rv-tbody">
              <tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">Yükleniyor…</td></tr>
            </tbody>
          </table>
        </div>
      </div>`;

    load('');
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  window.loadReviewsPage = init;
})();
