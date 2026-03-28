# Tasarım: AI Destekli Müşteri Soru Cevaplama Sistemi

**Tarih:** 2026-03-28
**Durum:** Onaylandı

## Özet

Trendyol mağazalarındaki müşteri sorularını otomatik olarak çekip Anthropic Claude API'si ile Türkçe cevap öneren, admin panelinden onay/red mekanizmasıyla Trendyol'a gönderen bir sistem.

---

## Veritabanı

`database.js`'e yeni `questions` tablosu eklenir (`CREATE TABLE IF NOT EXISTS` + `safeAlter` pattern):

```sql
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  product_name TEXT,
  question_text TEXT NOT NULL,
  ai_answer TEXT,
  status TEXT DEFAULT 'pending',   -- pending | sent | rejected
  asked_at DATETIME,
  sent_at DATETIME,
  created_at DATETIME DEFAULT (datetime('now')),
  UNIQUE(dealer_id, question_id),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id)
)
```

**Status akışı:** `pending` → `sent` (onaylanıp gönderilince) veya `rejected` (reddedilince).
`ai_answer` null olabilir — Anthropic API erişilemezse soru yine de kaydedilir, admin manuel cevap yazar.

---

## Dosya Yapısı

```
claude_trendyol/
├── server.js                    # +3 satır: require + router mount + cron başlatma
├── database.js                  # +questions tablosu
├── .env.example                 # +ANTHROPIC_API_KEY, AI_MODEL
├── routes/
│   ├── orderDetail.js           # değişmez
│   └── questions.js             # YENİ
├── services/
│   └── aiService.js             # YENİ
├── cron/
│   └── questionsCron.js         # YENİ
└── public/js/
    ├── orderModal.js            # değişmez
    └── questionsPage.js         # YENİ
```

---

## API Endpoint'leri

Tümü `authMiddleware` ile korunur. Her dealer yalnızca kendi sorularını görür.

| Method | Path | Açıklama |
|--------|------|----------|
| `GET` | `/api/questions` | DB'deki soruları listele (`?status=pending\|sent\|rejected`) |
| `POST` | `/api/questions/fetch` | Trendyol'dan yeni soruları çek, AI cevabı üret, DB'ye kaydet |
| `PUT` | `/api/questions/:id` | AI cevabını güncelle |
| `POST` | `/api/questions/:id/approve` | Trendyol'a gönder → status=sent |
| `POST` | `/api/questions/:id/reject` | status=rejected yap |

**Trendyol endpoints:**
- `GET https://apigw.trendyol.com/integration/sellers/{supplierId}/questions?status=waitingForAnswer`
- `POST https://apigw.trendyol.com/integration/sellers/{supplierId}/questions/{questionId}/answers`

Auth: `Basic base64(api_key:api_secret)`, User-Agent: `{supplierId} - SelfIntegration`

---

## AI Servis (`services/aiService.js`)

```
Model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001'
API Key: process.env.ANTHROPIC_API_KEY
Max tokens: 300
```

**Prompt şablonu:**
```
Sen bir Trendyol satıcısısın. Mağaza adı: {storeName}.
Müşteri "{productName}" ürünü hakkında şunu sordu: "{questionText}"
Türkçe, kısa (1-3 cümle), samimi ve yardımsever bir cevap yaz.
Sadece cevap metnini döndür, başka hiçbir şey ekleme.
```

`generateAnswer(storeName, productName, questionText)` → `string | null`

API erişilemezse `null` döner (exception fırlatmaz), çağıran katman log yazar.

---

## Cron Job (`cron/questionsCron.js`)

- **Zamanlama:** Her 15 dakika (`*/15 * * * *`)
- **Başlama koşulu:** `ANTHROPIC_API_KEY` tanımlıysa başlar, yoksa `console.warn` + cron kurulmaz
- **Her çalışmada:**
  1. `api_key` ve `api_secret` dolu tüm aktif dealer'ları çek
  2. Her dealer için Trendyol'dan `waitingForAnswer` sorularını çek
  3. Her yeni soru için `aiService.generateAnswer()` çağır
  4. `INSERT OR IGNORE` ile DB'ye kaydet (`pending` status, `ai_answer` null olabilir)
  5. Hata durumunda o dealer'ı atla, log yaz, diğerlerine devam et

---

## Admin Panel (`public/js/questionsPage.js`)

**Sidebar nav item:** `navigate('questions')` — "💬 Sorular"

`questionsPage.js` dosyası `index.html`'e `orderModal.js` ile aynı şekilde `<script src="js/questionsPage.js"></script>` tag'iyle dahil edilir.

**Sayfa layout:**
```
┌─────────────────────────────────────────────────┐
│  Müşteri Soruları                    [Yenile 🔄] │
│  [Bekleyen] [Gönderildi] [Reddedildi]            │
├─────────────────────────────────────────────────┤
│  📦 Ürün Adı                    12 Mart 2025     │
│  Soru: "Bu ürün 2 yıl garantili mi?"             │
│                                                  │
│  AI Cevabı:                                      │
│  ┌─────────────────────────────────────────┐     │
│  │ Evet, ürünümüz 2 yıl üretici garantisi  │     │
│  │ kapsamındadır...             [düzenle]   │     │
│  └─────────────────────────────────────────┘     │
│                    [Reddet ✗]  [Onayla & Gönder ✓]│
└─────────────────────────────────────────────────┘
```

**Davranışlar:**
- Sayfa açılınca `GET /api/questions?status=pending` çeker
- AI cevabı `<textarea>` ile düzenlenebilir → `PUT /api/questions/:id` kaydeder
- "Onayla & Gönder" → `POST /api/questions/:id/approve` → kart listeden kalkar
- "Reddet" → `POST /api/questions/:id/reject` → kart listeden kalkar
- "Yenile" → `POST /api/questions/fetch` → yeni sorular çekilir, liste yenilenir
- Sekmeler → `?status=` ile filtreler
- `ai_answer` null ise "AI cevabı üretilemedi — lütfen manuel yazın" uyarısı gösterilir

---

## Hata Yönetimi

| Durum | Davranış |
|-------|----------|
| Trendyol 401/403 | Log yaz, dealer atla |
| Trendyol timeout (5sn) | Log yaz, dealer atla |
| Trendyol 429 | Log yaz, dealer atla (cron 15dk sonra tekrar dener) |
| Anthropic API hatası | `ai_answer=null`, soru yine DB'ye kaydedilir |
| `ANTHROPIC_API_KEY` yok | Cron başlamaz, `console.warn` |
| Trendyol'a gönderim hatası | `status` değişmez, kullanıcıya hata mesajı |
| Duplicate soru | `INSERT OR IGNORE` ile sessizce atlanır |

---

## Environment Değişkenleri

`.env.example`'a eklenecekler:

```
# AI soru cevaplama
ANTHROPIC_API_KEY=
AI_MODEL=claude-haiku-4-5-20251001
```

---

## Paket Gereksinimleri

```bash
npm install @anthropic-ai/sdk node-cron
```
