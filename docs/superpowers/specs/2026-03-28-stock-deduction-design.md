# Sipariş Tabanlı Otomatik Stok Düşme — Tasarım Dokümanı

**Tarih:** 2026-03-28
**Durum:** Onaylandı

---

## Amaç

Trendyol'dan çekilen siparişlerde ürün stoğu otomatik olarak düşülsün. Aynı sipariş tekrar sync edildiğinde stok iki kez düşmesin. İptal/iade siparişlerde stok geri eklensin. Her 30 dakikada cron job otomatik olarak siparişleri senkronize etsin.

---

## Stok Düşme Mantığı

### Aktif Statüler (stok düşülür)
Sipariş statüsü şunlardan **biri değilse** stok düşülür:
- `Cancelled`
- `Returned`
- `UnDelivered`

Yani `Created`, `Picking`, `Shipped`, `Delivered` gibi tüm aktif statülerde stok düşer.

### `stock_applied` Flag Sistemi
- `orders` tablosuna `stock_applied INTEGER DEFAULT 0` sütunu eklenir
- İlk sync → aktif statü → stok düşülür → `stock_applied = 1`
- Aynı sipariş tekrar sync → `stock_applied = 1` olduğu için atlanır (double deduction yok)
- Statü iade/iptal'e döner → `stock_applied = 1` ise stok geri eklenir → `stock_applied = 0`

### Barkod Eşleştirme
`lines_json` içindeki her satırın `barcode` alanı `dealer_products.barcode` ile eşleştirilir. Eşleşme yoksa satır atlanır (log yazılır). Stok 0'ın altına düşmez (`MAX(0, stock - quantity)`).

### Trendyol'a Push
Stok düşme/artma sonrası `AUTO_PUSH_TRENDYOL_STOCK=true` ise `pushDealerStocksToTrendyol()` çağrılır.

---

## Mimari

### Yeni/Değişen Bileşenler

| Dosya | İşlem | Sorumluluk |
|-------|-------|-----------|
| `database.js` | Güncelle | `orders` tablosuna `stock_applied` sütunu + `safeAlter` |
| `server.js` | Güncelle | Sync mantığını `syncDealerOrders(dealer)` fonksiyonuna çıkar; endpoint bu fonksiyonu çağırsın |
| `server.js` | Güncelle | `syncDealerOrders` içine stok düşme/geri ekleme mantığı ekle |
| `cron/ordersCron.js` | Oluştur | Her 30 dakika tüm aktif bayiler için `syncDealerOrders` çağır |
| `server.js` | Güncelle | `startOrdersCron()` ile cron'u başlat |

### Fonksiyon Yapısı

```
syncDealerOrders(dealer)
  ├── Trendyol API'dan siparişleri çek
  ├── Her sipariş için upsert (mevcut davranış)
  └── applyStockChanges(dealerId, orders)   ← YENİ
        ├── stock_applied=0 + aktif statü  → stok düş, stock_applied=1
        └── stock_applied=1 + iptal/iade   → stok geri ekle, stock_applied=0
        └── AUTO_PUSH ise pushDealerStocksToTrendyol()
```

---

## Veri Akışı

```
[Cron / Manuel Buton]
        │
        ▼
syncDealerOrders(dealer)
        │
        ├── GET Trendyol API → siparişler
        │
        ├── upsert → orders tablosu
        │
        └── applyStockChanges()
              │
              ├── Yeni aktif sipariş → dealer_products.stock -= quantity
              │   stock_applied = 1
              │
              └── İptal/iade (stock_applied=1) → dealer_products.stock += quantity
                  stock_applied = 0
                  │
                  └── [AUTO_PUSH=true] → pushDealerStocksToTrendyol()
```

---

## Hata Yönetimi

- Barkod eşleşmezse: log yaz, atla (hata fırlatma)
- Trendyol API başarısız: log yaz, sync sonucu döndür (stok değişikliği geri alınmaz — stok zaten düşmüş durumda)
- Cron job: her dealer için try/catch, bir dealer hatası diğerlerini durdurmaz

---

## Cron Job

**Dosya:** `cron/ordersCron.js`
**Schedule:** `*/30 * * * *` (her 30 dakika)
**Kapsam:** `status = 'active'` olan, Trendyol API bilgileri dolu tüm bayiler
**Log:** Her sync sonunda kaç sipariş işlendiğini yazar

---

## Commit Planı

```
feat: add stock_applied column to orders table
feat: extract syncDealerOrders() and add stock deduction logic
feat: add orders cron job (every 30 minutes)
feat: start orders cron in server.js
```
