// public/js/questionsPage.js
(function () {
  'use strict';

  // ── CSS ─────────────────────────────────────────────────────
  const STYLE = `
    #page-questions { padding: 0; }
    .qp-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px;
    }
    .qp-header h2 { font-size: 18px; font-weight: 700; color: var(--text); }
    .qp-tabs {
      display: flex; gap: 8px; margin-bottom: 20px;
    }
    .qp-tab {
      padding: 7px 16px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg2); cursor: pointer; font-size: 13px; font-weight: 500;
      color: var(--muted);
    }
    .qp-tab.active {
      background: var(--accent); color: #fff; border-color: var(--accent);
    }
    .qp-card {
      background: var(--card); border-radius: var(--radius); border: 1px solid var(--border);
      padding: 18px 20px; margin-bottom: 14px; box-shadow: var(--shadow);
    }
    .qp-card-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 10px;
    }
    .qp-product { font-size: 13px; font-weight: 600; color: var(--text); }
    .qp-date { font-size: 12px; color: var(--muted); }
    .qp-question {
      font-size: 13px; color: var(--text); margin-bottom: 12px;
      padding: 10px 12px; background: var(--bg3); border-radius: 8px;
      font-style: italic;
    }
    .qp-label {
      font-size: 11px; font-weight: 700; color: var(--muted);
      text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px;
    }
    .qp-textarea {
      width: 100%; min-height: 80px; padding: 10px 12px;
      border: 1px solid var(--border); border-radius: 8px;
      font-family: inherit; font-size: 13px; color: var(--text);
      background: var(--bg2); resize: vertical; margin-bottom: 12px;
      box-sizing: border-box;
    }
    .qp-textarea:focus { outline: none; border-color: var(--accent); }
    .qp-textarea[readonly] { background: var(--bg3); color: var(--muted); }
    .qp-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .qp-btn {
      padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; border: none; font-family: inherit;
    }
    .qp-btn-approve { background: var(--green); color: #fff; }
    .qp-btn-approve:hover { opacity: .85; }
    .qp-btn-reject {
      background: var(--bg3); color: var(--muted); border: 1px solid var(--border);
    }
    .qp-btn-reject:hover { background: #fee2e2; color: var(--red); border-color: var(--red); }
    .qp-btn-fetch {
      background: var(--accent); color: #fff; padding: 8px 16px;
      border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; border: none; font-family: inherit;
    }
    .qp-btn-fetch:disabled { opacity: .6; cursor: not-allowed; }
    .qp-empty {
      text-align: center; padding: 48px; color: var(--muted); font-size: 14px;
    }
    .qp-no-ai {
      font-size: 12px; color: var(--yellow); margin-bottom: 8px;
      padding: 6px 10px; background: #fefce8; border-radius: 6px;
    }
    .qp-status-badge {
      font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 12px;
    }
    .qp-status-sent { background: #dcfce7; color: var(--green); }
    .qp-status-rejected { background: #fee2e2; color: var(--red); }
  `;

  let styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
    styleInjected = true;
  }

  // ── API HELPER ───────────────────────────────────────────────
  async function qpApi(path, opts = {}) {
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

  // ── TOAST HELPER ─────────────────────────────────────────────
  function qpToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    if (!t) return;
    const d = document.createElement('div');
    d.className = `toast-item toast-${type}`;
    d.textContent = msg;
    t.appendChild(d);
    setTimeout(() => d.remove(), 3500);
  }

  // ── HTML HELPERS ─────────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let currentStatus = 'pending';
  let saveTimers = {};

  // ── RENDER CARD ──────────────────────────────────────────────
  function renderCard(q) {
    const date = q.asked_at
      ? new Date(q.asked_at).toLocaleDateString('tr-TR')
      : '';
    const isPending = q.status === 'pending';

    const noAiBadge = !q.ai_answer
      ? `<div class="qp-no-ai">⚠️ AI cevabı üretilemedi — lütfen manuel yazın.</div>`
      : '';

    const statusBadge = !isPending
      ? `<span class="qp-status-badge qp-status-${q.status}">${q.status === 'sent' ? '✓ Gönderildi' : '✗ Reddedildi'}</span>`
      : '';

    const actions = isPending
      ? `<div class="qp-actions">
           <button class="qp-btn qp-btn-reject" onclick="window._qpReject(${q.id})">✗ Reddet</button>
           <button class="qp-btn qp-btn-approve" onclick="window._qpApprove(${q.id})">✓ Onayla &amp; Gönder</button>
         </div>`
      : '';

    return `
      <div class="qp-card" id="qp-card-${q.id}">
        <div class="qp-card-header">
          <span class="qp-product">📦 ${esc(q.product_name || 'Ürün')}</span>
          <div style="display:flex;gap:8px;align-items:center;">
            ${statusBadge}
            <span class="qp-date">${date}</span>
          </div>
        </div>
        <div class="qp-question">"${esc(q.question_text)}"</div>
        ${noAiBadge}
        <div class="qp-label">AI Cevabı</div>
        <textarea
          class="qp-textarea"
          id="qp-answer-${q.id}"
          ${!isPending ? 'readonly' : ''}
          oninput="window._qpSaveDebounce(${q.id})"
        >${esc(q.ai_answer || '')}</textarea>
        ${actions}
      </div>
    `;
  }

  // ── LOAD QUESTIONS ───────────────────────────────────────────
  async function loadQuestions(status) {
    if (status !== undefined) currentStatus = status;
    injectStyle();

    const container = document.getElementById('page-questions');
    if (!container) return;

    container.innerHTML = `
      <div class="qp-header">
        <h2>Müşteri Soruları</h2>
        <button class="qp-btn-fetch" id="qp-btn-fetch" onclick="window._qpFetch()">🔄 Trendyol'dan Çek</button>
      </div>
      <div class="qp-tabs">
        <button class="qp-tab ${currentStatus === 'pending' ? 'active' : ''}" onclick="window.loadQuestions('pending')">Bekleyen</button>
        <button class="qp-tab ${currentStatus === 'sent' ? 'active' : ''}" onclick="window.loadQuestions('sent')">Gönderildi</button>
        <button class="qp-tab ${currentStatus === 'rejected' ? 'active' : ''}" onclick="window.loadQuestions('rejected')">Reddedildi</button>
      </div>
      <div id="qp-list"><div class="qp-empty">⏳ Yükleniyor...</div></div>
    `;

    try {
      const questions = await qpApi(`/api/questions?status=${currentStatus}`);
      const list = document.getElementById('qp-list');
      if (!list) return;
      if (!questions.length) {
        list.innerHTML = `<div class="qp-empty">Bu kategoride soru bulunamadı.</div>`;
      } else {
        list.innerHTML = questions.map(renderCard).join('');
      }
    } catch (e) {
      const list = document.getElementById('qp-list');
      if (list) list.innerHTML = `<div class="qp-empty">❌ ${esc(e.message)}</div>`;
    }
  }

  // ── ACTIONS ──────────────────────────────────────────────────
  window._qpSaveDebounce = function (id) {
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(async () => {
      const ta = document.getElementById(`qp-answer-${id}`);
      if (!ta) return;
      try {
        await qpApi(`/api/questions/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ ai_answer: ta.value }),
        });
      } catch (_) { /* silent — kullanıcı onay sırasında hata alır */ }
    }, 800);
  };

  window._qpApprove = async function (id) {
    const ta = document.getElementById(`qp-answer-${id}`);
    if (ta) {
      try {
        await qpApi(`/api/questions/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ ai_answer: ta.value }),
        });
      } catch (_) {}
    }
    try {
      await qpApi(`/api/questions/${id}/approve`, { method: 'POST' });
      document.getElementById(`qp-card-${id}`)?.remove();
      const list = document.getElementById('qp-list');
      if (list && !list.querySelector('.qp-card')) {
        list.innerHTML = `<div class="qp-empty">Bu kategoride soru bulunamadı.</div>`;
      }
      qpToast("✅ Cevap Trendyol'a gönderildi", 'success');
    } catch (e) {
      qpToast('❌ ' + e.message, 'error');
    }
  };

  window._qpReject = async function (id) {
    try {
      await qpApi(`/api/questions/${id}/reject`, { method: 'POST' });
      document.getElementById(`qp-card-${id}`)?.remove();
      const list = document.getElementById('qp-list');
      if (list && !list.querySelector('.qp-card')) {
        list.innerHTML = `<div class="qp-empty">Bu kategoride soru bulunamadı.</div>`;
      }
      qpToast('Soru reddedildi', 'info');
    } catch (e) {
      qpToast('❌ ' + e.message, 'error');
    }
  };

  window._qpFetch = async function () {
    const btn = document.getElementById('qp-btn-fetch');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Çekiliyor...'; }
    try {
      const result = await qpApi('/api/questions/fetch', { method: 'POST' });
      qpToast(`✅ ${result.saved} yeni soru eklendi (${result.fetched} çekildi)`, 'success');
      loadQuestions(currentStatus);
    } catch (e) {
      qpToast('❌ ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = "🔄 Trendyol'dan Çek"; }
    }
  };

  window.loadQuestions = loadQuestions;
})();
