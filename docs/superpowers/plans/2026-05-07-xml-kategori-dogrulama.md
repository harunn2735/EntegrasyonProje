# XML Kategori Doğrulama — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** XML feed'inden direkt gelen (kategori_eslestirme kaydı olmayan) ürünlerin kategorilerini AI ile SSE stream üzerinden doğrulayan endpoint ve UI ekle.

**Architecture:** Unique `(category, xml_category_id, supplier_name)` kombinasyonları başına 1 AI çağrısı yapılır; mevcut `oneriKategori` fonksiyonu reuse edilir. Sonuç farklıysa ve güven ≥ 0.70 ise etkilenen ürünlerde `needs_category_review = 1` set edilir. SSE pattern auto-fill ile özdeştir.

**Tech Stack:** Node.js/Express SSE, better-sqlite3, OpenAI (kategoriOneriService), vanilla JS EventSource

---

## Dosya Değişiklikleri

| Dosya | İşlem | Değişiklik |
|-------|-------|------------|
| `server.js` | Modify | ~line 2553'den önce: yeni GET SSE endpoint (~65 satır) |
| `public/js/kategorilerPage.js` | Modify | Modal inject + EventSource tüketici (~95 satır) + toolbar butonu (1 satır) |

---

## Task 1: Backend — SSE Endpoint

**Files:**
- Modify: `server.js` (auto-fill endpoint'in bitişi ~line 2552 sonrasına ekle)

- [ ] **Step 1: Endpoint iskeletini ekle**

`server.js`'te `// ── KATEGORİ BAZLI TOPLU ATTRIBUTE ATAMA` yorumunun hemen ÖNÜNE ekle:

```javascript
// ── XML KATEGORİ DOĞRULAMA ────────────────────────────────────────────────
app.get('/api/dealer/categories/verify-xml-stream', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
        // Unique (category, xml_category_id, supplier_name) — no kategori_eslestirme entry
        const combos = db.prepare(`
            SELECT dp.category, dp.xml_category_id, dp.supplier_name,
                   COUNT(*) AS product_count,
                   tk.tam_yol AS current_path
            FROM dealer_products dp
            LEFT JOIN trendyol_kategoriler tk ON tk.trendyol_id = dp.xml_category_id
            WHERE dp.dealer_id = ?
              AND dp.xml_category_id IS NOT NULL
              AND dp.needs_category_review = 0
              AND NOT EXISTS (
                  SELECT 1 FROM kategori_eslestirme ke
                  WHERE ke.tedarikci_adi = dp.supplier_name
                    AND ke.xml_kategori_metni = dp.category
              )
            GROUP BY dp.category, dp.xml_category_id, dp.supplier_name
            ORDER BY product_count DESC
        `).all(dealerId);

        send({ type: 'start', total: combos.length });

        if (combos.length === 0) {
            send({ type: 'done', verified: 0, changed: 0, low_confidence: 0, errors: 0 });
            return res.end();
        }

        let verified = 0, changed = 0, low_confidence = 0, errors = 0;

        for (let i = 0; i < combos.length; i++) {
            const combo = combos[i];
            try {
                const result = await oneriKategori(
                    combo.supplier_name,
                    combo.category,
                    combo.category   // urunAdi olarak kategori metnini kullan
                );

                const isSame = result.trendyol_id === combo.xml_category_id;

                if (isSame) {
                    verified++;
                    send({
                        type: 'progress', current: i + 1, total: combos.length,
                        category: combo.category, result: 'verified',
                        current_path: combo.current_path,
                        suggested_path: result.tam_yol,
                        affected_products: combo.product_count,
                        guven_skoru: result.guven_skoru
                    });
                } else if (result.guven_skoru >= 0.70) {
                    // Farklı kategori, yüksek güven → incelemeye al
                    db.prepare(`
                        UPDATE dealer_products
                        SET needs_category_review = 1, updated_at = datetime('now')
                        WHERE dealer_id = ? AND category = ? AND xml_category_id = ?
                    `).run(dealerId, combo.category, combo.xml_category_id);
                    changed++;
                    send({
                        type: 'progress', current: i + 1, total: combos.length,
                        category: combo.category, result: 'changed',
                        current_path: combo.current_path,
                        suggested_path: result.tam_yol,
                        affected_products: combo.product_count,
                        guven_skoru: result.guven_skoru
                    });
                } else {
                    low_confidence++;
                    send({
                        type: 'progress', current: i + 1, total: combos.length,
                        category: combo.category, result: 'low_confidence',
                        current_path: combo.current_path,
                        suggested_path: result.tam_yol,
                        affected_products: combo.product_count,
                        guven_skoru: result.guven_skoru
                    });
                }
            } catch (e) {
                errors++;
                addLog('error', `verify-xml hatası [${combo.category}]: ${e.message}`, dealerId);
                send({
                    type: 'progress', current: i + 1, total: combos.length,
                    category: combo.category, result: 'error',
                    affected_products: combo.product_count
                });
            }

            if (i < combos.length - 1) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        send({ type: 'done', verified, changed, low_confidence, errors });
    } catch (e) {
        send({ type: 'error', message: e.message });
    }

    res.end();
});
```

- [ ] **Step 2: Sunucuyu yeniden başlat ve endpoint'i test et**

```bash
node -e "
const http = require('http');
http.get('http://localhost:3000/api/dealer/categories/verify-xml-stream', (res) => {
  console.log('Status:', res.statusCode, res.headers['content-type']);
  res.destroy();
});
"
```

Beklenen: `Status: 401 ...` (auth olmadan 401 dönmeli — endpoint var ama korumalı)

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add GET /api/dealer/categories/verify-xml-stream SSE endpoint"
```

---

## Task 2: Frontend — Modal ve EventSource

**Files:**
- Modify: `public/js/kategorilerPage.js`

### 2a — Modal DOM Inject

- [ ] **Step 4: `kmInjectAutoFillModal()` çağrısının hemen altına yeni inject fonksiyonu ekle**

`loadKategorilerPage` fonksiyonunda `kmInjectAutoFillModal();` satırının hemen ALTINA ekle:

```javascript
    kmInjectVerifyXmlModal();
```

Ardından `window.kmCloseAutoFill` fonksiyonunun **hemen altına** (IIFE kapanışından önce) yeni modal kodunu ekle:

```javascript
  // ── XML Kategori Doğrulama Modal ────────────────────────────────

  let kmVxEs = null;

  function kmInjectVerifyXmlModal() {
    if (document.getElementById('km-vx-overlay')) return;
    const el = document.createElement('div');
    el.id = 'km-vx-overlay';
    el.className = 'km-af-overlay'; // auto-fill ile aynı overlay stili
    el.innerHTML = `
      <div class="km-af-modal">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:15px;font-weight:700;color:var(--text)">🔍 XML Kategorileri Doğrulat</span>
          <button class="btn btn-ghost btn-sm" onclick="kmCloseVerifyXml()">✕</button>
        </div>
        <div id="km-vx-controls" style="display:flex;flex-direction:column;gap:12px">
          <div style="font-size:13px;color:var(--muted)">
            XML feed'inden gelen (AI skoru olmayan) ürün kategorilerini AI ile doğrular.<br>
            Her <b>unique kategori</b> için tek AI çağrısı yapılır.
          </div>
          <div>
            <button class="btn btn-primary btn-sm" onclick="kmStartVerifyXml()">▶ Doğrulamayı Başlat</button>
          </div>
        </div>
        <div id="km-vx-run" style="display:none;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)">
            <span id="km-vx-label">Başlıyor…</span>
            <span id="km-vx-pct">0%</span>
          </div>
          <div class="km-af-progress-wrap">
            <div id="km-vx-bar" class="km-af-progress-bar"></div>
          </div>
          <div style="display:flex;gap:20px;font-size:12px">
            <span style="color:var(--green)">✅ <b id="km-vx-verified">0</b> doğrulandı</span>
            <span style="color:var(--yellow)">⚠️ <b id="km-vx-changed">0</b> incelemeye alındı</span>
            <span style="color:var(--muted)">🔅 <b id="km-vx-low">0</b> düşük güven</span>
            <span style="color:var(--red)">❌ <b id="km-vx-errors">0</b> hata</span>
          </div>
          <div id="km-vx-log" class="km-af-log"></div>
        </div>
        <div style="display:flex;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" id="km-vx-close-btn" onclick="kmCloseVerifyXml()">Kapat</button>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  window.kmOpenVerifyXml = function () {
    const overlay = document.getElementById('km-vx-overlay');
    if (!overlay) return;
    document.getElementById('km-vx-controls').style.display = 'flex';
    document.getElementById('km-vx-run').style.display = 'none';
    document.getElementById('km-vx-log').innerHTML = '';
    document.getElementById('km-vx-bar').style.width = '0%';
    document.getElementById('km-vx-pct').textContent = '0%';
    document.getElementById('km-vx-label').textContent = 'Başlamadı';
    ['km-vx-verified', 'km-vx-changed', 'km-vx-low', 'km-vx-errors'].forEach(id => {
      document.getElementById(id).textContent = '0';
    });
    document.getElementById('km-vx-close-btn').textContent = 'İptal';
    overlay.style.display = 'flex';
  };

  window.kmStartVerifyXml = function () {
    const token = localStorage.getItem('dealer_token') || localStorage.getItem('token');

    document.getElementById('km-vx-controls').style.display = 'none';
    document.getElementById('km-vx-run').style.display = 'flex';

    const logEl      = document.getElementById('km-vx-log');
    const bar        = document.getElementById('km-vx-bar');
    const labelEl    = document.getElementById('km-vx-label');
    const pctEl      = document.getElementById('km-vx-pct');
    const verifiedEl = document.getElementById('km-vx-verified');
    const changedEl  = document.getElementById('km-vx-changed');
    const lowEl      = document.getElementById('km-vx-low');
    const errorsEl   = document.getElementById('km-vx-errors');

    function vxLog(msg) {
      logEl.innerHTML += `<div>${msg}</div>`;
      logEl.scrollTop = logEl.scrollHeight;
    }

    if (kmVxEs) { kmVxEs.close(); kmVxEs = null; }

    kmVxEs = new EventSource(`/api/dealer/categories/verify-xml-stream?token=${encodeURIComponent(token)}`);

    kmVxEs.onmessage = function (e) {
      const d = JSON.parse(e.data);

      if (d.type === 'start') {
        if (d.total === 0) {
          vxLog('✅ Doğrulanacak kategori bulunamadı — tüm XML kategorileri zaten kayıtlı.');
          labelEl.textContent = 'Tamamlandı';
          document.getElementById('km-vx-close-btn').textContent = 'Kapat';
          return;
        }
        vxLog(`⏳ ${d.total} unique kategori doğrulanacak…`);
        labelEl.textContent = `0 / ${d.total}`;
      } else if (d.type === 'progress') {
        const pct = d.total > 0 ? Math.round(d.current / d.total * 100) : 0;
        bar.style.width = pct + '%';
        labelEl.textContent = `${d.current} / ${d.total}`;
        pctEl.textContent = pct + '%';

        const resultIcons = {
          verified:      `✅ "${d.category}" — doğrulandı (${d.affected_products} ürün)`,
          changed:       `⚠️ "${d.category}" — farklı kategori önerildi, incelemeye alındı (${d.affected_products} ürün)\n    Mevcut: ${d.current_path}\n    Öneri: ${d.suggested_path}`,
          low_confidence:`🔅 "${d.category}" — düşük güven, kaydedildi ama flag set edilmedi (${d.affected_products} ürün)`,
          error:         `❌ "${d.category}" — hata (${d.affected_products} ürün)`
        };
        vxLog(resultIcons[d.result] || `• ${d.category}`);

        if (d.result === 'verified')      verifiedEl.textContent = String(parseInt(verifiedEl.textContent) + 1);
        if (d.result === 'changed')       changedEl.textContent  = String(parseInt(changedEl.textContent)  + 1);
        if (d.result === 'low_confidence') lowEl.textContent     = String(parseInt(lowEl.textContent)      + 1);
        if (d.result === 'error')         errorsEl.textContent   = String(parseInt(errorsEl.textContent)   + 1);

      } else if (d.type === 'done') {
        kmVxEs.close(); kmVxEs = null;
        bar.style.width = '100%';
        labelEl.textContent = 'Tamamlandı';
        pctEl.textContent = '100%';
        verifiedEl.textContent = String(d.verified);
        changedEl.textContent  = String(d.changed);
        lowEl.textContent      = String(d.low_confidence);
        errorsEl.textContent   = String(d.errors);
        vxLog(`✅ Tamamlandı: ${d.verified} doğrulandı · ${d.changed} incelemeye alındı · ${d.low_confidence} düşük güven · ${d.errors} hata`);
        if (d.changed > 0) {
          vxLog('💡 İncelemeye alınan ürünler "Onay Bekliyor" filtresinde görünür.');
        }
        document.getElementById('km-vx-close-btn').textContent = 'Kapat';
        kLoadData();
      } else if (d.type === 'error') {
        kmVxEs.close(); kmVxEs = null;
        vxLog(`❌ Hata: ${d.message}`);
        document.getElementById('km-vx-close-btn').textContent = 'Kapat';
      }
    };

    kmVxEs.onerror = function () {
      vxLog('❌ Sunucu bağlantısı kesildi');
      if (kmVxEs) { kmVxEs.close(); kmVxEs = null; }
      document.getElementById('km-vx-close-btn').textContent = 'Kapat';
    };
  };

  window.kmCloseVerifyXml = function () {
    if (kmVxEs) { kmVxEs.close(); kmVxEs = null; }
    const overlay = document.getElementById('km-vx-overlay');
    if (overlay) overlay.style.display = 'none';
  };
```

### 2b — Toolbar Butonu

- [ ] **Step 5: Toolbar'a buton ekle**

`kategorilerPage.js`'teki şu satırı bul:
```javascript
              <button class="btn btn-ghost btn-sm" onclick="kmOpenAutoFill()" title="AI ile attribute_json boş ürünleri toplu doldur" style="color:var(--accent)">📋 Toplu AI Doldur</button>
```

Hemen ALTINA ekle:
```javascript
              <button class="btn btn-ghost btn-sm" onclick="kmOpenVerifyXml()" title="XML'den gelen kategorileri AI ile doğrulat" style="color:var(--accent)">🔍 XML Doğrulat</button>
```

- [ ] **Step 6: Commit**

```bash
git add public/js/kategorilerPage.js
git commit -m "feat: add XML category verification modal and toolbar button"
```

---

## Task 3: Manuel Test

- [ ] **Step 7: Sunucuyu başlat ve UI'yi test et**

```bash
node server.js
```

Tarayıcıda Kategori Yönetimi sayfasını aç:
1. Toolbar'da "🔍 XML Doğrulat" butonunun göründüğünü doğrula
2. Butona tıkla → modal açılmalı
3. "▶ Doğrulamayı Başlat" tıkla → progress bar çalışmalı
4. Her kategori için log satırı çıkmalı (✅ / ⚠️ / 🔅)
5. Tamamlandığında "Onay Bekliyor" filtresini kontrol et — değişen kategoriler orada görünmeli

- [ ] **Step 8: Veritabanında sonuçları doğrula**

```bash
node -e "
const db = require('./database');
// kategori_eslestirme'ye kaydedilmiş mi?
const rows = db.prepare('SELECT xml_kategori_metni, guven_skoru, kullanici_onayladi FROM kategori_eslestirme').all();
console.log('Kayıtlar:', JSON.stringify(rows, null, 2));
// needs_category_review=1 set edilen ürünler
const flagged = db.prepare('SELECT title, category, xml_category_id FROM dealer_products WHERE needs_category_review = 1').all();
console.log('Review flag:', JSON.stringify(flagged.slice(0, 5), null, 2));
"
```

Beklenen: "Banyo Aksesuarları", "Epilatör", "El Feneri" kayıtları `kategori_eslestirme`'de görünmeli; AI farklı kategori önerdiyse ilgili ürünlerde `needs_category_review = 1`.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "feat: XML category verification — SSE endpoint + UI complete"
```

---

## Notlar

- **Token auth:** SSE EventSource query param'dan token alıyor (`?token=...`). `authMiddleware` bu pattern'i `auto-fill` endpoint ile aynı şekilde zaten handle etmeli; kontrol et, gerekiyorsa `authMiddleware`'de query token desteği var mı doğrula.
- **oneriKategori hafıza kaydı:** Fonksiyon `kategori_eslestirme`'ye otomatik yazar. `guven_skoru >= 0.85` olanları da otomatik `kullanici_onayladi=1` yapar. Bu davranış kasıtlı — doğrulama sonucu kalıcı hafızaya geçer.
- **Tekrar çalıştırma:** Endpoint `NOT EXISTS (SELECT 1 FROM kategori_eslestirme ...)` ile filtreler. İkinci çalıştırmada `oneriKategori` hafızadan cevap döneceği için hızlı olur ama zaten hiç kayıt olmayan ürün kalmamış olur → "0 unique kategori" mesajı çıkar.
