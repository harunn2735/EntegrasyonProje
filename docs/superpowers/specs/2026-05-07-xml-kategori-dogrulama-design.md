# XML Kategori Doğrulama — Design Spec
**Tarih:** 2026-05-07

## Özet

XML feed'inden direkt gelen (`xml_category_id` dolu ama `kategori_eslestirme` kaydı olmayan) ürünlerin kategorilerini AI ile doğrulayan SSE endpoint ve UI.

---

## Mimari

### Neden Kategori Başına 1 AI Çağrısı?

- `dealer_products.category` alanı XML'deki ham kategori metnini tutar (ör. "Banyo Aksesuarları")
- Aynı kategorideki tüm ürünler aynı Trendyol kategorisine gitmelidir
- Mevcut 22 ürün = 3 unique kategori → 3 AI çağrısı
- 5.000 ürün bile ~50 unique kategoriye düşer → 50 AI çağrısı

---

## Backend

### Endpoint: `GET /api/dealer/categories/verify-xml-stream`

**Akış:**

1. `kategori_eslestirme` kaydı olmayan `xml_category_id` dolu ürünlerden unique `(category, xml_category_id, supplier_name)` listesi çek
2. Her satır için:
   a. Mevcut `xml_category_id`'nin `trendyol_kategoriler`'deki `tam_yol`'unu bul
   b. `oneriKategori(supplier_name, category, category)` çağır (mevcut hafıza fonksiyonu)
   c. AI önerisi ile mevcut `xml_category_id` karşılaştır:
      - **Aynı** → `kategori_eslestirme`'ye kaydet (`kullanici_onayladi=1`), ürünler değişmez
      - **Farklı + yüksek güven (≥0.70)** → `kategori_eslestirme`'ye kaydet, etkilenen ürünlerde `needs_category_review=1`
      - **Farklı + düşük güven (<0.70)** → sadece `kategori_eslestirme`'ye kaydet, review flag'i set etme
   d. Kategoriler arasında 300ms bekle

**SSE Event tipleri:**
```json
{ "type": "start", "total": 3 }
{ "type": "progress", "current": 1, "total": 3, "category": "El Feneri",
  "result": "verified|changed|low_confidence|error",
  "current_path": "Spor & Outdoor > ... > El Feneri",
  "suggested_path": "Spor & Outdoor > ... > El Feneri",
  "affected_products": 7 }
{ "type": "done", "verified": 2, "changed": 1, "low_confidence": 0, "errors": 0 }
```

**Sonuç tipleri:**
- `verified` — AI aynı kategoriyi önerdi, doğrulandı
- `changed` — AI farklı kategori önerdi, güven yüksek → review flag set edildi
- `low_confidence` — AI farklı kategori önerdi ama güven düşük → sadece kaydedildi
- `error` — AI çağrısı başarısız oldu

---

## Frontend (`kategorilerPage.js`)

### Buton
Mevcut "🤖 AI Eşleştir" butonlarının yanına:
```
🔍 XML Doğrulat
```

### Modal
`auto-fill` modalının aynı yapısını kullan:
- İlerleme çubuğu + sayaç
- Canlı log satırları: `"✅ El Feneri — doğrulandı (7 ürün)"`, `"⚠️ Epilatör — farklı kategori önerildi, incelemeye alındı (10 ürün)"`
- Alt özet: `✅ 2 doğrulandı · ⚠️ 1 incelemeye alındı · ❌ 0 hata`
- Bitince "Kapat" butonu aktif olur, `kLoadData()` tetiklenir

---

## Veri Akışı

```
GET /verify-xml-stream
  └── dealer_products (xml_category_id NOT NULL, no kategori_eslestirme)
      └── GROUP BY category → unique (category, xml_category_id, supplier_name)
          └── oneriKategori(supplier_name, category, category)
              └── kategori_eslestirme INSERT/UPSERT
              └── dealer_products UPDATE needs_category_review=1 (sadece changed + güven≥0.70)
```

---

## Değişmeyen Dosyalar

- `services/kategoriOneriService.js` — `oneriKategori` fonksiyonu aynen kullanılır, değiştirilmez
- `database.js` — yeni tablo veya migration gerekmez

## Değişen Dosyalar

- `server.js` — yeni GET endpoint eklenir (~60 satır)
- `public/js/kategorilerPage.js` — modal inject + buton + SSE consumer (~80 satır)

---

## Kapsam Dışı

- Ürün bazında ayrı AI çağrısı yapmak
- Mevcut `oneriKategori` fonksiyonunu değiştirmek
- Yeni DB tablosu
