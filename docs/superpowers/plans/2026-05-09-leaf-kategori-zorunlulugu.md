# Leaf Kategori Zorunluluğu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI kategori önerisinin her zaman Trendyol attribute'u olan leaf (alt) kategori seçmesini garantile — seçilen kategoride attribute boşsa max 3 deneme yap, hâlâ boşsa `needs_category_review=1` olarak işaretle.

**Architecture:** `trendyol_kategoriler` tablosuna `has_attributes INTEGER` kolonu ekle; `kategoriOneriService.js` içinde mevcut `getAnyDealer()+axios` pattern'ı kullanarak attribute sayısını çeken bir helper yaz; `oneriKategori()` içindeki Claude çağrısını bir retry döngüsüyle sar (attribute boşsa excluded-id listesine ekle ve prompt'a not düş); `needsLeafReview` flag döndür ki caller `needs_category_review=1` koyabilsin.

**Tech Stack:** Node.js, SQLite (better-sqlite3), OpenAI SDK, Trendyol REST API, mevcut migration sistemi (`migrations/*.sql` + `runMigrations`)

---

## Dosya Haritası

| Dosya | Değişiklik |
|-------|-----------|
| `migrations/004_add_has_attributes.sql` | Yeni: `trendyol_kategoriler.has_attributes` kolonu |
| `services/kategoriOneriService.js:68-73` | `stmtKategoriLike` + `stmtKategoriRastgele` — `has_attributes` filtresi |
| `services/kategoriOneriService.js:~41` | Yeni: `fetchVeKaydetAttributeSayisi()` helper |
| `services/kategoriOneriService.js:257-398` | `oneriKategori()` retry döngüsü + `needsLeafReview` flag |
| `server.js:1448-1451` | XML import call site — `needsLeafReview` kontrolü |
| `server.js:1802` | Bulk AI match call site — `needsLeafReview` kontrolü |
| `server.js:2626-2631` | XML verify stream call site — `needsLeafReview` kontrolü |
| `server.js` (startup) | Startup'ta `has_attributes=0` kategorilerdeki ürünleri `needs_category_review=1` yap |

---

### Task 1: Migration — `has_attributes` kolonu ekle

**Files:**
- Create: `migrations/004_add_has_attributes.sql`

- [ ] **Step 1: Migration dosyasını oluştur**

```sql
-- Migration: 004_add_has_attributes
-- Trendyol kategorilerin attribute tanımlayıp tanımlamadığını takip eder.
-- NULL = henüz kontrol edilmedi  |  0 = attribute yok (üst/parent kategori)  |  1 = attribute var (leaf)

ALTER TABLE trendyol_kategoriler ADD COLUMN has_attributes INTEGER DEFAULT NULL;
```

- [ ] **Step 2: Sunucuyu başlat ve kolonun oluştuğunu doğrula**

```bash
node -e "const db = require('./database'); console.log(db.prepare('PRAGMA table_info(trendyol_kategoriler)').all().map(c=>c.name))"
```

Expected çıktı `'has_attributes'` içermeli.

- [ ] **Step 3: Commit**

```bash
git add migrations/004_add_has_attributes.sql
git commit -m "feat: add has_attributes column migration for trendyol_kategoriler"
```

---

### Task 2: SQL aday sorgularına `has_attributes` filtresi ekle

**Files:**
- Modify: `services/kategoriOneriService.js:68-73`

Mevcut durum (line 68-73):
```javascript
const stmtKategoriLike = db.prepare(
  'SELECT id, trendyol_id, tam_yol FROM trendyol_kategoriler WHERE tam_yol LIKE ?'
);
const stmtKategoriRastgele = db.prepare(
  'SELECT id, trendyol_id, tam_yol FROM trendyol_kategoriler ORDER BY RANDOM() LIMIT 100'
);
```

- [ ] **Step 1: İki prepared statement'ı güncelle**

```javascript
const stmtKategoriLike = db.prepare(
  'SELECT id, trendyol_id, tam_yol FROM trendyol_kategoriler WHERE tam_yol LIKE ? AND (has_attributes IS NULL OR has_attributes = 1)'
);
const stmtKategoriRastgele = db.prepare(
  'SELECT id, trendyol_id, tam_yol FROM trendyol_kategoriler WHERE (has_attributes IS NULL OR has_attributes = 1) ORDER BY RANDOM() LIMIT 100'
);
```

`has_attributes IS NULL` = henüz kontrol edilmemiş, dahil et.
`has_attributes = 1` = attribute var, dahil et.
`has_attributes = 0` = attribute yok, hariç tut.

- [ ] **Step 2: Modülün hatasız yüklendiğini doğrula**

```bash
node -e "require('./services/kategoriOneriService'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add services/kategoriOneriService.js
git commit -m "feat: exclude has_attributes=0 categories from AI candidate list"
```

---

### Task 3: `fetchVeKaydetAttributeSayisi` helper fonksiyonu

**Files:**
- Modify: `services/kategoriOneriService.js` (line ~41, `getAnyDealer()` fonksiyonunun hemen arkasına)

Bu helper, mevcut `oneriAttributeMap()` fonksiyonundaki axios pattern'ını (line 444-454) taklit eder.

- [ ] **Step 1: Helper fonksiyonu ekle (`getAnyDealer()` fonksiyonundan sonra, line ~41)**

```javascript
async function fetchVeKaydetAttributeSayisi(trendyolKategoriId) {
  const dealer = getAnyDealer();
  if (!dealer) return null;
  try {
    const response = await axios.get(
      `https://apigw.trendyol.com/integration/product/product-categories/${trendyolKategoriId}/attributes`,
      { headers: trendyolHeaders(dealer), timeout: 10000 }
    );
    const count = (response.data?.categoryAttributes || []).length;
    db.prepare('UPDATE trendyol_kategoriler SET has_attributes = ? WHERE trendyol_id = ?')
      .run(count > 0 ? 1 : 0, trendyolKategoriId);
    return count;
  } catch (err) {
    addLog('warn', `fetchVeKaydetAttributeSayisi hata (kategori ${trendyolKategoriId}): ${err.message}`);
    return null;
  }
}
```

- [ ] **Step 2: Modülün hatasız yüklendiğini doğrula**

```bash
node -e "require('./services/kategoriOneriService'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add services/kategoriOneriService.js
git commit -m "feat: add fetchVeKaydetAttributeSayisi helper — persists attribute check results"
```

---

### Task 4: `oneriKategori()` içine leaf doğrulama retry döngüsü ekle

**Files:**
- Modify: `services/kategoriOneriService.js:257-398`

Mevcut `oneriKategori()` yapısı:
- 222-242: Hafıza kontrolü (değişmez)
- 244-255: Ön koşul kontrolleri (değişmez)
- 257-271: SQL filtresi → `adayKategoriler` (değişmez, döngü dışında kalır)
- 273-362: **Tek** Claude çağrısı + JSON parse (→ retry döngüsüne alınır)
- 364-397: Hafıza kaydet + return (döngü sonrası, değişmez)

- [ ] **Step 1: Line 257'den itibaren tüm bloğu retry döngüsüyle değiştir**

`// ── ADIM 1: SQL anahtar kelime filtresi ─────────────────────` (line 257) ile `}` kapanış parantezi (line 398) arasındaki bloğu şununla değiştir:

```javascript
  // ── ADIM 1: SQL anahtar kelime filtresi ─────────────────────
  const adayKategoriler = filtreKategoriler(urunAdi, aciklama, xmlKategoriMetni);

  console.log(`[filtreKategoriler] "${urunAdi}" → ${adayKategoriler.length} aday:`);
  adayKategoriler.forEach((k, i) =>
    console.log(`  [${i + 1}] ${k.trendyol_id} | ${k.tam_yol}`)
  );

  addLog('info',
    `oneriKategori [${urunAdi}]: SQL filtresi ${adayKategoriler.length} aday döndürdü`
  );

  // ── ADIM 2: Claude döngüsü — leaf olmayan kategoriler hariç tutularak maks 3 deneme ──
  const MAX_DENEME = 3;
  const haricKategoriIds = new Set();
  let result = null;
  let needsLeafReview = false;
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  const markaStr  = marka        ? `Marka: ${marka}` : 'Marka: (belirtilmemiş)';
  const prefixStr = barcodePrefix ? `Barkod Prefix: ${barcodePrefix}` : '';
  const ekBilgi   = [markaStr, prefixStr].filter(Boolean).join('\n');

  for (let deneme = 0; deneme < MAX_DENEME; deneme++) {
    const aktifAdaylar = adayKategoriler.filter(k => !haricKategoriIds.has(k.trendyol_id));

    if (aktifAdaylar.length === 0) {
      addLog('warn', `oneriKategori [${urunAdi}]: tüm adaylar attribute kontrolünde elendi, incelemeye alındı`);
      needsLeafReview = true;
      break;
    }

    const kategoriListesi = aktifAdaylar.map(k => `${k.trendyol_id}|${k.tam_yol}`).join('\n');

    const haricNot = haricKategoriIds.size > 0
      ? `\nUYARI: ${[...haricKategoriIds].join(', ')} ID'li kategoriler Trendyol'da attribute tanımlamıyor (üst/parent kategori). Bu ID'leri KESINLIKLE SEÇME — daha alt/spesifik bir alt kategori seç.\n`
      : '';

    const prompt = `Bir e-ticaret ürününü doğru Trendyol kategorisiyle eşleştirmen gerekiyor.

Ürün Adı: ${urunAdi}
Ürün Açıklaması: ${aciklama ? aciklama : '(belirtilmemiş)'}
${ekBilgi}
${haricNot}
Aşağıda seninle paylaşılan ${aktifAdaylar.length} aday kategori var. SADECE bu liste içinden seç, başka kategori önerme:
${kategoriListesi}

Kategori seçerken şu kurallara uy:

0. DAIMA LEAF KATEGORİ SEÇ: En alt seviyedeki (leaf) kategoriyi seç. Üst/parent kategori KESINLIKLE seçme — Trendyol attribute'ları yalnızca leaf kategorilerde tanımlıdır. Listede hem parent hem child varsa, her zaman child/leaf olanı tercih et.
   ❌ Yanlış: "Elektrik & Aydınlatma"
   ❌ Yanlış: "Bahçe & Elektrikli El Aletleri"
   ✅ Doğru: "Elektrik & Aydınlatma > Elektrik Malzemeleri > Prizler > Topraklı Priz"
   Tam yolda (tam_yol) ">" ayracı ne kadar çoksa, kategori o kadar spesifik ve tercih edilebilirdir.

1. TEKNIK TERIMLER ÖNCELİKLİ: Ürün adındaki teknik terimlere öncelik ver; genel açıklamayı değil, teknik terimi belirleyici kriter olarak kullan.

2. MARKA İPUCU: Marka bilgisi varsa, o markanın hangi ürün grubuna ait olduğunu kategori seçiminde dikkate al.

3. BARKOD PREFİX: "tt-", "bxml-" gibi prefix'ler tedarikçi kaynaklıdır, ürün tipiyle ilgisi yoktur — yok say.

4. ELEKTRİK/ELEKTRONİK KURALI: Ürün adında priz, fiş, kablo, anahtar, soket, sigorta, röle, kesici, topraklama gibi terimler varsa MUTLAKA "Elektrik Malzemeleri" ana kategorisi altından seç.

5. BİRİNCİL İŞLEV KURALI: Ürünü BİRİNCİL İŞLEVİNE göre kategorile, aksesuar veya güç kaynağına göre değil.
   - Şarjlı/pilli/elektrikli cihaz (tıraş makinesi, epilatör, diş fırçası, süpürge, fan, mikser vb.) → cihazın kendi kategorisi (Kişisel Bakım, Mutfak Aletleri, Ev Aletleri vb.) — Pil & Şarj kategorisi KESİNLİKLE DEĞİL
   - Pil, şarj cihazı, adaptör, şarj kablosu (yalnız aksesuar olarak satılıyor) → Elektronik > Pil & Şarj
   - Kılıf/kapak/koruyucu → o cihazın kategorisi altında Aksesuar
   - Yedek parça (bıçak, fırça başlığı, filtre vb.) → Ana ürünün kategorisi > Aksesuar veya Yedek Parça
   Ürün adında "şarjlı", "pilli", "elektrikli", "kablosuz" geçiyorsa bu ürün BİRİNCİL cihazdır, aksesuar değildir.

6. İLK 3 KELİME AĞIRLIĞI: Ürün adının ilk 3 kelimesine %70 ağırlık ver.

7. DÜŞÜK GÜVEN SKORU: Güven skoru 0.85'in altında kalacaksa, listede daha uygun bir alternatif ara ve gerekçede kısa bir karşılaştırma yap.

SADECE aşağıdaki JSON formatında yanıt ver — başka açıklama ekleme:
{"trendyol_id": <sayı>, "tam_yol": "<seçilen kategorinin tam_yol değeri>", "guven_skoru": <0.0 ile 1.0 arasında ondalık>, "gerekce": "<kısa Türkçe gerekçe>"}`;

    let denemeResult;
    try {
      const completion = await getClient().chat.completions.create({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = completion.choices[0].message.content?.trim() || '';
      if (!text) throw new Error('OpenAI boş yanıt döndürdü');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(`Geçerli JSON bulunamadı. Yanıt: ${text.slice(0, 300)}`);
      }

      denemeResult = JSON.parse(jsonMatch[0]);

      if (typeof denemeResult.trendyol_id !== 'number' || typeof denemeResult.guven_skoru !== 'number') {
        throw new Error(`Eksik JSON alanı. Alınan: ${JSON.stringify(denemeResult)}`);
      }

      // Claude'un seçtiği trendyol_id, aday listede yer alıyor mu?
      const secimGecerli = aktifAdaylar.some(k => k.trendyol_id === denemeResult.trendyol_id);
      if (!secimGecerli) {
        const eslesiyor = aktifAdaylar.find(
          k => k.tam_yol === denemeResult.tam_yol || k.tam_yol.includes(denemeResult.tam_yol)
        );
        if (eslesiyor) {
          denemeResult.trendyol_id = eslesiyor.trendyol_id;
          denemeResult.tam_yol = eslesiyor.tam_yol;
        } else {
          denemeResult.trendyol_id = aktifAdaylar[0].trendyol_id;
          denemeResult.tam_yol = aktifAdaylar[0].tam_yol;
          denemeResult.guven_skoru = Math.min(denemeResult.guven_skoru, 0.5);
          addLog('warn', `oneriKategori: Claude liste dışı ID seçti, ilk adaya düşüldü [${urunAdi}]`);
        }
      }
    } catch (err) {
      addLog('error', `oneriKategori hatası [${urunAdi}] deneme ${deneme + 1}: ${err.message}`);
      return { trendyol_id: null, guven_skoru: 0, gerekce: 'AI servisi kullanılamıyor' };
    }

    // Attribute kontrolü: seçilen kategoride attribute var mı?
    const attrSayisi = await fetchVeKaydetAttributeSayisi(denemeResult.trendyol_id);

    if (attrSayisi === null || attrSayisi > 0) {
      // null = API hatası (ihtiyatlı davran, kabul et) | >0 = leaf kategori, kabul et
      result = denemeResult;
      break;
    }

    // Attribute yok — bu kategoriyi hariç tut, bir sonraki denemede farklı seçilsin
    addLog('warn',
      `oneriKategori [${urunAdi}]: ${denemeResult.trendyol_id} (${denemeResult.tam_yol}) ` +
      `attribute yok (deneme ${deneme + 1}/${MAX_DENEME}), yeniden deniyor`
    );
    haricKategoriIds.add(denemeResult.trendyol_id);
    result = denemeResult; // Son denemenin sonucunu sakla (hafızaya kaydet için lazım)

    if (deneme === MAX_DENEME - 1) {
      needsLeafReview = true;
      addLog('warn', `oneriKategori [${urunAdi}]: ${MAX_DENEME} denemede leaf kategori bulunamadı, incelemeye alındı`);
    }
  }

  if (!result) {
    return { trendyol_id: null, guven_skoru: 0, gerekce: 'Leaf kategori bulunamadı' };
  }

  // ── Hafızaya kaydet ─────────────────────────────────────────
  const katRow = db
    .prepare('SELECT id FROM trendyol_kategoriler WHERE trendyol_id = ?')
    .get(result.trendyol_id);

  let eslestirmeId = hafiza?.id ?? null;
  let otomatikOnaylandi = false;

  try {
    stmtHafizaKaydet.run(
      tedarikciAdi,
      xmlKategoriMetni,
      katRow?.id ?? null,
      result.guven_skoru
    );
    const saved = stmtHafizaAra.get(tedarikciAdi, xmlKategoriMetni);
    eslestirmeId = saved?.id ?? null;

    // Leaf review gerektiriyorsa asla otomatik onayla; yoksa guven_skoru kontrolü yeterli
    if (eslestirmeId !== null && result.guven_skoru >= 0.85 && !needsLeafReview) {
      stmtKullanicOnayla.run(eslestirmeId);
      otomatikOnaylandi = true;
    }
  } catch (err) {
    addLog('warn', `Hafıza kaydı başarısız: ${err.message}`);
  }

  return {
    ...result,
    kaynak: 'claude',
    eslestirme_id: eslestirmeId,
    otomatik_onaylandi: otomatikOnaylandi,
    needsLeafReview,
  };
}
```

- [ ] **Step 2: Modülün hatasız yüklendiğini doğrula**

```bash
node -e "require('./services/kategoriOneriService'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add services/kategoriOneriService.js
git commit -m "feat: add leaf validation retry loop in oneriKategori (max 3 attempts)"
```

---

### Task 5: `server.js` call site'larını `needsLeafReview` için güncelle

**Files:**
- Modify: `server.js` — 3 call site

**Call site 1 — XML import (line ~1448)**

- [ ] **Step 1: `needsLeafReview` kontrolü ekle**

Mevcut (line 1448-1451):
```javascript
if (oneri.guven_skoru >= 0.85) {
    aiResolutions.set(categoryText, { xmlCategoryId: oneri.trendyol_id, needsReview: 0 });
} else {
    aiResolutions.set(categoryText, { xmlCategoryId: oneri.trendyol_id, needsReview: 1 });
}
```

Yeni hali:
```javascript
const needsReview = (oneri.needsLeafReview || oneri.guven_skoru < 0.85) ? 1 : 0;
aiResolutions.set(categoryText, { xmlCategoryId: oneri.trendyol_id, needsReview });
```

**Call site 2 — Bulk AI match (line ~1802)**

- [ ] **Step 2: `needsLeafReview` kontrolü ekle**

Mevcut (line 1802):
```javascript
const review = result.guven_skoru >= 0.85 ? 0 : 1;
```

Yeni hali:
```javascript
const review = (result.needsLeafReview || result.guven_skoru < 0.85) ? 1 : 0;
```

**Call site 3 — Rematch pending (line ~1886-1888) — değişiklik gerekmez**

`applyTx` fonksiyonu zaten `needs_category_review = 1` setliyor (line 1875). Rematch her zaman manuel onay gerektiriyor, `needsLeafReview` sonucu değiştirmiyor.

**Call site 4 — XML verify stream (line ~2626)**

- [ ] **Step 3: `needsLeafReview` durumunda `needs_category_review=1` yap**

Mevcut (line 2614-2631):
```javascript
const isSame = result.trendyol_id === combo.xml_category_id;

if (isSame) {
    verified++;
    send({ ... result: 'verified' ... });
} else if (result.guven_skoru >= 0.70) {
    db.prepare(`
        UPDATE dealer_products
        SET needs_category_review = 1, updated_at = datetime('now')
        WHERE dealer_id = ? AND category = ? AND xml_category_id = ?
    `).run(dealerId, combo.category, combo.xml_category_id);
    changed++;
```

Yeni hali — `isSame` kontrolünden önce `needsLeafReview` kontrolü ekle:
```javascript
const isSame = result.trendyol_id === combo.xml_category_id;

if (result.needsLeafReview) {
    db.prepare(`
        UPDATE dealer_products
        SET needs_category_review = 1, updated_at = datetime('now')
        WHERE dealer_id = ? AND category = ? AND xml_category_id = ?
    `).run(dealerId, combo.category, combo.xml_category_id);
    changed++;
} else if (isSame) {
    verified++;
    send({ ... result: 'verified' ... });
} else if (result.guven_skoru >= 0.70) {
    db.prepare(`
        UPDATE dealer_products
        SET needs_category_review = 1, updated_at = datetime('now')
        WHERE dealer_id = ? AND category = ? AND xml_category_id = ?
    `).run(dealerId, combo.category, combo.xml_category_id);
    changed++;
```

- [ ] **Step 4: Sunucuyu başlat, hata yok mu doğrula**

```bash
node -e "require('./server')" 2>&1 | head -5
```

Expected: Hata yok, sunucu başlıyor.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: propagate needsLeafReview flag to needs_category_review at all call sites"
```

---

### Task 6: Startup'ta mevcut `has_attributes=0` kategorilerdeki ürünleri işaretle

**Files:**
- Modify: `server.js` (uygulama başlatma bloğu, `initializeServer()` veya `app.listen()` çağrısından hemen önce)

Bu UPDATE başlangıçta genellikle 0 satır etkiler (yeni kolonun tüm değerleri NULL). Zamanla `fetchVeKaydetAttributeSayisi()` çalıştıkça `has_attributes=0` kayıtlar birikeceğinden, bu UPDATE her startup'ta onları yakalar.

- [ ] **Step 1: Uygulama başlatma bloğunu bul**

`server.js` içinde `app.listen(` çağrısını bul.

- [ ] **Step 2: `app.listen()` çağrısından hemen önce UPDATE ekle**

```javascript
// has_attributes=0 olan kategorilere atanmış ürünleri incelemeye al
try {
  const flagged = db.prepare(`
    UPDATE dealer_products
    SET needs_category_review = 1, updated_at = datetime('now')
    WHERE xml_category_id IN (
      SELECT trendyol_id FROM trendyol_kategoriler WHERE has_attributes = 0
    )
    AND needs_category_review = 0
  `).run();
  if (flagged.changes > 0) {
    console.log(`⚠️  ${flagged.changes} ürün non-leaf kategoriye atanmış, incelemeye alındı`);
  }
} catch (err) {
  console.error('Startup leaf flag hatası:', err.message);
}
```

`AND needs_category_review = 0` koşulu: zaten incelemede olanları tekrar etiketleme, sadece yeni keşfedilenleri yakala.

- [ ] **Step 3: Sunucuyu başlat, log çıktısını doğrula**

```bash
node server.js
```

Expected: Mevcut `has_attributes=0` kayıt yoksa sessizce çalışır. Varsa `⚠️ X ürün non-leaf kategoriye atanmış...` mesajı görünür.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: flag products in no-attribute categories as needs_category_review on startup"
```

---

## Spec Kapsamı Kontrolü

| Spec Maddesi | Kapsayan Task |
|---|---|
| `oneriKategori()` attribute kontrolü + boşsa yeniden sor | Task 3 + Task 4 |
| Maksimum 3 deneme | Task 4 (MAX_DENEME = 3) |
| 3 denemede hâlâ boşsa `needs_category_review=1` | Task 4 (`needsLeafReview`) + Task 5 |
| `trendyol_kategoriler.has_attributes` kolonu ekle | Task 1 |
| Attribute çekildiğinde `has_attributes` kaydet | Task 3 (`fetchVeKaydetAttributeSayisi`) |
| `has_attributes=0` kategorileri öneri listesinden çıkar | Task 2 |
| Mevcut `has_attributes=0` kategorilerdeki ürünleri işaretle | Task 6 |
