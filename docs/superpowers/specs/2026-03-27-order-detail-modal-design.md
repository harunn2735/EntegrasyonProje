
# Sipariş Detay Modal Sistemi — Tasarım Dokümanı

**Tarih:** 2026-03-27
**Proje:** claude_trendyol (Bayi Portalı)
**Konu:** Sipariş tablosunda satıra tıklanınca açılan modal + hybrid backend endpoint

---

## 1. Kapsam

Trendyol Bayi Portalı'ndaki sipariş tablosuna tıklanabilir satır ve detay modal sistemi eklenir. Modal; müşteri bilgisi, teslimat adresi, ürün satırları, kargo takip butonu ve Trendyol partner linki içerir.

---

## 2. Yeni Dosyalar

| Dosya | Açıklama |
|---|---|
| `routes/orderDetail.js` | Hybrid fetch endpoint'i ve kargo link helper |
| `public/js/orderModal.js` | Modal HTML injection, event binding, render mantığı |

---

## 3. Değişen Dosyalar

| Dosya | Değişiklik |
|---|---|
| `server.js` | `require('./routes/orderDetail')` satırı eklenir |
| `index.html` | `<script src="/js/orderModal.js">` + `<tr>`'lere `data-order-number` attribute'u |

---

## 4. Backend: `routes/orderDetail.js`

### Route

```
GET /api/orders/:orderNumber
```

`authMiddleware` server.js'den require edilir. Mevcut `GET /api/dealer/orders/:orderNumber` route'una dokunulmaz.

### Hybrid Fetch Mantığı

1. Local DB'de `dealer_id + orderNumber` ile ara.
2. Bulunursa → `lines_json` parse et, `dealer_products`'tan local stock verisini zenginleştir, döndür (`source: "local"`).
3. Bulunamazsa → dealer'ın `api_key`, `api_secret`, `supplier_id`'sini DB'den al, Trendyol'a istek at, yanıtı normalize et, döndür (`source: "trendyol"`).
4. İkisi de başarısızsa → 404.

### Trendyol API İsteği

```
GET https://apigw.trendyol.com/integration/order/sellers/:supplierId/orders?orderNumber=:orderNumber
Authorization: Basic base64(api_key:api_secret)
User-Agent: :supplierId - SelfIntegration
```

Timeout: 5 saniye.

### Kargo Takip Linkleri

`cargo_company` alanı case-insensitive partial match ile eşleştirilir:

| Firma | URL Şablonu |
|---|---|
| Yurtiçi | `https://www.yurticikargo.com/tr/online-islemler/gonderi-sorgula?kod={trackingNo}` |
| Aras | `https://kargotakip.araskargo.com.tr/MainPage.aspx?code={trackingNo}` |
| MNG | `https://www.mngkargo.com.tr/gonderi-takip?takipNo={trackingNo}` |
| PTT | `https://www.ptt.gov.tr/tr/anasayfa/kargo-takip?q={trackingNo}` |
| Sürat | `https://www.suratkargo.com.tr/KargoTakip/{trackingNo}` |
| DHL | `https://www.dhl.com/tr-tr/home/tracking.html?tracking-id={trackingNo}` |

Takip numarası `-` veya boş ise ya da kargo firması eşleşmezse `tracking_url: null` döner.

### Hata Yönetimi

| Durum | HTTP | Yanıt |
|---|---|---|
| Sipariş bulunamadı (her iki kaynakta da) | 404 | `{ error: 'Sipariş bulunamadı' }` |
| API credentials eksik | 400 | `{ error: 'API bilgileri tanımlı değil' }` |
| Trendyol 4xx yanıtı | 502 | `{ error: 'Trendyol API hatası', detail: ... }` |
| Trendyol timeout (>5sn) | 504 | `{ error: 'Trendyol API zaman aşımı' }` |
| lines_json parse hatası | — | lines boş array döner, modal yine de açılır |

### Response Şeması

```json
{
  "order_number": "string",
  "order_date": "ISO8601",
  "status": "string",
  "customer_name": "string",
  "shipping_address": "string",
  "cargo_company": "string",
  "tracking_number": "string",
  "package_number": "string",
  "total_price": 0.0,
  "net_price": 0.0,
  "is_refund": 0,
  "source": "local | trendyol",
  "tracking_url": "string | null",
  "trendyol_url": "string",
  "lines": [
    {
      "title": "string",
      "barcode": "string",
      "quantity": 1,
      "price": 0.0,
      "image_url": "string",
      "local_stock": 5
    }
  ]
}
```

`trendyol_url` her zaman dolu olur: `https://partner.trendyol.com/orders/{orderNumber}`

---

## 5. Frontend: `public/js/orderModal.js`

### Event Delegation

`orders-tbody` üzerine tek bir `click` listener bağlanır. Tıklanan `<tr>`'nin `data-order-number` attribute'u okunur, `GET /api/orders/:orderNumber` çağrılır.

### Modal Layout

```
┌─────────────────────────────────────────┐
│  Sipariş #12345678        [×]           │
├─────────────────────────────────────────┤
│  👤 Müşteri Adı           📍 Adres      │
│  📦 Kargo: Yurtiçi        🔢 Takip No   │
│  📅 Tarih                 💰 Net/Toplam  │
├─────────────────────────────────────────┤
│  Ürünler                                │
│  [img] Ürün adı   barkod   adet   ₺    │
│  [img] ...                              │
├─────────────────────────────────────────┤
│  [📦 Kargo Takip]   [🔗 Trendyol'da Aç]│
└─────────────────────────────────────────┘
```

### Davranış Kuralları

- Modal açılınca önce spinner, API yanıtı gelince render.
- `tracking_url` null ise "Kargo Takip" butonu `disabled`.
- `trendyol_url` her zaman aktif.
- Overlay'e tıklama, `×` butonu veya `Escape` tuşu modalı kapatır.
- Açık modal varken başka satıra tıklanırsa önceki kapatılır, yenisi açılır.
- Ürün resmi yoksa baş harflerden renk-hash avatar gösterilir.

---

## 6. `index.html` Değişiklikleri

### Eklenen script etiketi

`</body>` kapatma etiketinden önce:
```html
<script src="/js/orderModal.js"></script>
```

### `loadOrders()` içindeki `<tr>` template değişikliği

Her satıra iki ek:
```html
<tr data-order-number="${esc(o.order_number)}" style="cursor:pointer">
```

Mevcut `loadOrders()` fonksiyonu (1970. satır) ve eski `loadOrders()` (1830. satır) ayrı ayrı güncellenir. Diğer fonksiyonlara dokunulmaz.

---

## 7. Kimlik Bilgileri

Trendyol API credentials local DB'deki `dealers` tablosundan okunur (`api_key`, `api_secret`, `supplier_id`). `.env` dosyasında bu alanlar bulunmaz; her bayi kendi credentials'ını Ayarlar sayfasından girer. `routes/orderDetail.js` bu alanları `db.prepare('SELECT ... FROM dealers WHERE id = ?').get(dealerId)` ile çeker.

---

## 8. Kısıtlamalar

- Yeni endpoint sadece `authMiddleware` ile korunur — admin endpoint'lerine dokunulmaz.
- `routes/orderDetail.js` içinde yeni DB bağlantısı açılmaz; `database.js` require edilir.
- Modal CSS'i `orderModal.js` içinde `<style>` etiketi olarak inject edilir; mevcut CSS'e dokunulmaz.
