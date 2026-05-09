// services/kategoriOneriService.js
'use strict';

const axios = require('axios');
const { OpenAI } = require('openai');
const db = require('../database');

// ── CLIENT ────────────────────────────────────────────────────
let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// ── YARDIMCILAR ───────────────────────────────────────────────
function addLog(level, message, dealerId = null) {
  try {
    db.prepare('INSERT INTO logs (level, message, dealer_id) VALUES (?, ?, ?)').run(
      level, message, dealerId
    );
  } catch (_) {}
}

function trendyolHeaders(dealer) {
  const auth = Buffer.from(`${dealer.api_key}:${dealer.api_secret}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'User-Agent': `${dealer.supplier_id} - SelfIntegration`,
    'Content-Type': 'application/json',
  };
}

// Herhangi bir API bilgisi olan bayi — attribute çekmek için gerekli
function getAnyDealer() {
  return db
    .prepare("SELECT * FROM dealers WHERE api_key IS NOT NULL AND api_key != '' LIMIT 1")
    .get();
}

// ── HAFIZA KATMANI ────────────────────────────────────────────
const stmtHafizaAra = db.prepare(`
  SELECT * FROM kategori_eslestirme
  WHERE tedarikci_adi = ? AND xml_kategori_metni = ?
  LIMIT 1
`);

const stmtHafizaKaydet = db.prepare(`
  INSERT INTO kategori_eslestirme
    (tedarikci_adi, xml_kategori_metni, trendyol_kategori_id, guven_skoru,
     kullanici_onayladi, kullanim_sayisi, olusturma_tarihi)
  VALUES (?, ?, ?, ?, 0, 1, datetime('now'))
  ON CONFLICT(tedarikci_adi, xml_kategori_metni) DO UPDATE SET
    trendyol_kategori_id = excluded.trendyol_kategori_id,
    guven_skoru          = excluded.guven_skoru,
    kullanim_sayisi      = kategori_eslestirme.kullanim_sayisi + 1
`);

const stmtKullanicOnayla = db.prepare(`
  UPDATE kategori_eslestirme
  SET kullanici_onayladi = 1,
      kullanim_sayisi    = kullanim_sayisi + 1
  WHERE id = ?
`);

// Prepared statements for the 2-step filter
const stmtKategoriLike = db.prepare(
  'SELECT id, trendyol_id, tam_yol FROM trendyol_kategoriler WHERE tam_yol LIKE ? AND (has_attributes IS NULL OR has_attributes = 1)'
);
const stmtKategoriRastgele = db.prepare(
  'SELECT id, trendyol_id, tam_yol FROM trendyol_kategoriler WHERE (has_attributes IS NULL OR has_attributes = 1) ORDER BY RANDOM() LIMIT 100'
);
const stmtKategoriVarMi = db.prepare(
  'SELECT COUNT(*) AS sayi FROM trendyol_kategoriler'
);

// ── ANLAMSIZ KELİMELER LİSTESİ ────────────────────────────────
// Renk, nitelik, sayı, edat gibi kategori aramasında işe yaramayan kelimeler.
// Tümü küçük harfle tanımlanır; karşılaştırma da küçük harfe çevrilerek yapılır.
const ANLAMSIZ_KELIMELER = new Set([
  'antrasit', 'beyaz', 'siyah', 'gri', 'renkli', 'kirmizi', 'mavi', 'yesil',
  'sari', 'mor', 'turuncu', 'pembe', 'kahverengi', 'altin', 'gumus', 'krem',
  'modern', 'dekoratif', 'klasik', 'sade', 'sik', 'seri', 'siva',
  've', 'ile', 'icin', 'için', 'ustu', 'üstü', 'alti', 'altı',
  'ikili', 'tekli', 'ciftli', 'çiftli', 'uclu', 'üçlü', 'dörtlü', 'dortlu',
  'set', 'adet', 'paket', 'takim', 'takım',
  'yeni', 'ozel', 'özel', 'super', 'süper', 'pro', 'plus',
]);

/**
 * Kelimeyi ANLAMSIZ_KELIMELER listesiyle karşılaştırmak için normalleştirir.
 * Türkçe karakterleri ASCII karşılıklarına dönüştürür, küçük harfe çevirir.
 */
function normalizeKelime(kelime) {
  return kelime
    .toLowerCase()
    .replace(/İ/g, 'i').replace(/I/g, 'i')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/Ü/g, 'u')
    .replace(/ş/g, 's').replace(/Ş/g, 's')
    .replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .replace(/ç/g, 'c').replace(/Ç/g, 'c')
    .replace(/ı/g, 'i');
}

// ── ADIM 1: SQL ANAHTAR KELİME FİLTRESİ ─────────────────────
/**
 * urunAdi'nın anlamlı kelimelerini (ANLAMSIZ_KELIMELER'i atlayarak) SQL LIKE
 * ile arar; ilk 4 teknik kelimeyi kullanır.
 * 0 sonuç → aciklama/xmlKategoriMetni kelimeleriyle tekrar dener.
 * Hâlâ 0 → rastgele 100 kategoriden 20 alır.
 * Her zaman en fazla 20 kategori döndürür.
 *
 * @returns {Array<{id: number, trendyol_id: number, tam_yol: string}>}
 */
function filtreKategoriler(urunAdi, aciklama, xmlKategoriMetni) {
  const MAX_SONUC = 20;
  const MIN_UZUNLUK = 4;
  const KOK_UZUNLUK = 5; // LIKE aramasında kullanılacak önek uzunluğu

  // Map<trendyol_id, satır> — tekrarsız biriktirici
  const harita = new Map();

  function araVeEkle(kelimeler) {
    for (const k of kelimeler) {
      if (k.length < MIN_UZUNLUK) continue;
      // Tam kelime yerine ilk KOK_UZUNLUK karakteriyle ara:
      // "Topraklı" → "Topra", "Elektrikli" → "Elektr", "Sensörlü" → "Sensö"
      const kok = k.substring(0, KOK_UZUNLUK);
      const rows = stmtKategoriLike.all(`%${kok}%`);
      for (const row of rows) {
        if (!harita.has(row.trendyol_id)) harita.set(row.trendyol_id, row);
      }
    }
  }

  function temizleVeFiltrele(metin, maxAdet) {
    return metin
      .split(/\s+/)
      .map(k => k.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ0-9]/g, ''))
      .filter(k => k.length >= MIN_UZUNLUK)
      .filter(k => !ANLAMSIZ_KELIMELER.has(normalizeKelime(k)))
      .slice(0, maxAdet);
  }

  // 1a — urunAdi'nın ilk 3 anlamlı (teknik) kelimesi (%70 ağırlık)
  const ilkKelimeler = temizleVeFiltrele(urunAdi, 4);

  addLog('info',
    `filtreKategoriler: "${urunAdi}" → anahtar kelimeler: [${ilkKelimeler.join(', ')}]`
  );

  araVeEkle(ilkKelimeler);

  if (harita.size > 0) {
    return Array.from(harita.values()).slice(0, MAX_SONUC);
  }

  // 1b — aciklama ve xmlKategoriMetni kelimeleri (fallback)
  const fallbackKelimeler = [
    ...(aciklama || '').split(/[\s>\/\\,|.]+/),
    ...(xmlKategoriMetni || '').split(/[\s>\/\\,|.]+/),
  ]
    .map(k => k.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ0-9]/g, ''))
    .filter(k => k.length >= MIN_UZUNLUK)
    .filter(k => !ANLAMSIZ_KELIMELER.has(normalizeKelime(k)))
    .slice(0, 6);

  addLog('info',
    `filtreKategoriler: fallback kelimeler: [${fallbackKelimeler.join(', ')}]`
  );

  araVeEkle(fallbackKelimeler);

  if (harita.size > 0) {
    return Array.from(harita.values()).slice(0, MAX_SONUC);
  }

  // 1c — hiçbir eşleşme yoksa rastgele 100 al, AI'a 20 gönder
  addLog('warn', `filtreKategoriler: hiç aday bulunamadı, rastgele fallback kullanıldı`);
  return stmtKategoriRastgele.all().slice(0, MAX_SONUC);
}

// ── DEBUG: "Priz" kategorilerini bir kez logla ────────────────
// Sunucu başladığında trendyol_kategoriler tablosundaki "Priz" içeren
// kategorileri log tablosuna yazar. Tablo boşsa sessizce atlar.
(function logPrizKategorileri() {
  try {
    const prizler = db
      .prepare("SELECT trendyol_id, tam_yol FROM trendyol_kategoriler WHERE tam_yol LIKE '%Priz%' OR tam_yol LIKE '%priz%'")
      .all();
    if (prizler.length === 0) {
      addLog('info', 'DEBUG priz: trendyol_kategoriler tablosunda "Priz" içeren kategori bulunamadı');
    } else {
      const liste = prizler.map(r => `${r.trendyol_id}|${r.tam_yol}`).join(' || ');
      addLog('info', `DEBUG priz: ${prizler.length} kategori bulundu → ${liste}`);
    }
  } catch (_) {}
})();

// ── 1. KATEGORİ ÖNERİSİ ─────────────────────────────────────
/**
 * Ürün adı ve açıklamasına göre en uygun Trendyol kategorisini önerir.
 *
 * ADIM 1 — SQL ile anahtar kelime filtresi: urunAdi'nın ilk 3 kelimesini
 *           trendyol_kategoriler.tam_yol üzerinde LIKE ile arar, max 20 sonuç alır.
 * ADIM 2 — Claude'a yalnızca filtrelenmiş 20 kategoriyi gönderir.
 *
 * Sonuç, kategori_eslestirme hafıza tablosuna kaydedilir.
 * guven_skoru >= 0.70 ise otomatik olarak kullanici_onayladi = 1 yapılır.
 *
 * @param {string} tedarikciAdi      — Tedarikçi / XML feed adı (hafıza anahtarı)
 * @param {string} xmlKategoriMetni  — XML'deki ham kategori metni (hafıza anahtarı)
 * @param {string} urunAdi           — Claude'a gönderilecek ürün adı
 * @param {string} [aciklama]        — Claude'a gönderilecek ürün açıklaması
 * @returns {Promise<{trendyol_id: number, tam_yol: string, guven_skoru: number,
 *                    gerekce?: string, kaynak: 'hafiza'|'claude',
 *                    eslestirme_id: number, otomatik_onaylandi?: boolean}>}
 */
async function oneriKategori(tedarikciAdi, xmlKategoriMetni, urunAdi, aciklama, marka = '', barcodePrefix = '') {
  // ── Hafıza kontrolü ─────────────────────────────────────────
  const hafiza = stmtHafizaAra.get(tedarikciAdi, xmlKategoriMetni);

  if (hafiza && hafiza.kullanici_onayladi === 1) {
    db.prepare(
      'UPDATE kategori_eslestirme SET kullanim_sayisi = kullanim_sayisi + 1 WHERE id = ?'
    ).run(hafiza.id);

    const kat = db
      .prepare('SELECT trendyol_id, tam_yol FROM trendyol_kategoriler WHERE id = ?')
      .get(hafiza.trendyol_kategori_id);

    return {
      trendyol_id: kat?.trendyol_id ?? hafiza.trendyol_kategori_id,
      tam_yol: kat?.tam_yol || '',
      guven_skoru: hafiza.guven_skoru,
      kaynak: 'hafiza',
      eslestirme_id: hafiza.id,
    };
  }

  // ── Ön koşul kontrolleri ────────────────────────────────────
  if (!process.env.OPENAI_API_KEY) {
    const msg = 'oneriKategori: OPENAI_API_KEY tanımlı değil';
    addLog('error', msg);
    throw new Error(msg);
  }

  if (stmtKategoriVarMi.get().sayi === 0) {
    const msg = 'Kategori listesi boş. Önce syncKategoriler çalıştırın.';
    addLog('warn', msg);
    throw new Error(msg);
  }

  // ── ADIM 1: SQL anahtar kelime filtresi ─────────────────────
  const adayKategoriler = filtreKategoriler(urunAdi, aciklama, xmlKategoriMetni);

  const kategoriListesi = adayKategoriler
    .map(k => `${k.trendyol_id}|${k.tam_yol}`)
    .join('\n');

  console.log(`[filtreKategoriler] "${urunAdi}" → ${adayKategoriler.length} aday:`);
  adayKategoriler.forEach((k, i) =>
    console.log(`  [${i + 1}] ${k.trendyol_id} | ${k.tam_yol}`)
  );

  addLog('info',
    `oneriKategori [${urunAdi}]: SQL filtresi ${adayKategoriler.length} aday döndürdü`
  );

  // ── ADIM 2: Claude'a yalnızca filtrelenmiş listeyi gönder ───
  const markaStr        = marka        ? `Marka: ${marka}` : 'Marka: (belirtilmemiş)';
  const prefixStr       = barcodePrefix ? `Barkod Prefix: ${barcodePrefix}` : '';
  const ekBilgi         = [markaStr, prefixStr].filter(Boolean).join('\n');

  const prompt = `Bir e-ticaret ürününü doğru Trendyol kategorisiyle eşleştirmen gerekiyor.

Ürün Adı: ${urunAdi}
Ürün Açıklaması: ${aciklama ? aciklama : '(belirtilmemiş)'}
${ekBilgi}

Aşağıda seninle paylaşılan ${adayKategoriler.length} aday kategori var. SADECE bu liste içinden seç, başka kategori önerme:
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

  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  let result;
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

    result = JSON.parse(jsonMatch[0]);

    if (typeof result.trendyol_id !== 'number' || typeof result.guven_skoru !== 'number') {
      throw new Error(`Eksik JSON alanı. Alınan: ${JSON.stringify(result)}`);
    }

    // Claude'un seçtiği trendyol_id, aday listede yer alıyor mu?
    const secimGecerli = adayKategoriler.some(k => k.trendyol_id === result.trendyol_id);
    if (!secimGecerli) {
      // Claude listeye uymayan bir ID döndürdü; tam_yol ile adaydan bulmaya çalış
      const eslesiyor = adayKategoriler.find(
        k => k.tam_yol === result.tam_yol || k.tam_yol.includes(result.tam_yol)
      );
      if (eslesiyor) {
        result.trendyol_id = eslesiyor.trendyol_id;
        result.tam_yol = eslesiyor.tam_yol;
      } else {
        // Listedeki en güvenilir adayı fallback olarak kullan
        result.trendyol_id = adayKategoriler[0].trendyol_id;
        result.tam_yol = adayKategoriler[0].tam_yol;
        result.guven_skoru = Math.min(result.guven_skoru, 0.5);
        addLog('warn', `oneriKategori: Claude liste dışı ID seçti, ilk adaya düşüldü [${urunAdi}]`);
      }
    }
  } catch (err) {
    addLog('error', `oneriKategori hatası [${urunAdi}]: ${err.message}`);
    return { trendyol_id: null, guven_skoru: 0, gerekce: 'AI servisi kullanılamıyor' };
  }

  // ── Hafızaya kaydet ─────────────────────────────────────────
  // trendyol_id değil, trendyol_kategoriler.id FK gerekiyor
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

    // guven_skoru >= 0.85 → otomatik onayla; altındaysa kullanıcı incelemesine bırak
    if (eslestirmeId !== null && result.guven_skoru >= 0.85) {
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
  };
}

// ── KULLANICI ONAYI ───────────────────────────────────────────
/**
 * Verilen eslestirme_id için kullanici_onayladi = true yapar ve
 * kullanim_sayisi'ni 1 artırır.
 *
 * @param {number} eslestirmeId  — kategori_eslestirme.id
 * @returns {{ ok: boolean, changes: number }}
 */
function kullaniciOnayla(eslestirmeId) {
  const result = stmtKullanicOnayla.run(eslestirmeId);
  return { ok: result.changes > 0, changes: result.changes };
}

// ── 2. ATTRİBUTE EŞLEŞTİRME ÖNERİSİ ────────────────────────
/**
 * Verilen Trendyol kategori ID'si için API'den attribute listesini çekip
 * XML alanlarını Claude ile eşleştirir.
 *
 * @param {number} trendyolKategoriId
 * @param {string[]} xmlAlanlari  — XML feed'deki alan adları (örn. ['color','size','brand'])
 * @returns {Promise<Array<{xml_alan: string, trendyol_attribute: string, zorunlu: boolean}>>}
 */
async function oneriAttributeMap(trendyolKategoriId, xmlAlanlari) {
  if (!process.env.OPENAI_API_KEY) {
    const msg = 'oneriAttributeMap: OPENAI_API_KEY tanımlı değil';
    addLog('error', msg);
    throw new Error(msg);
  }

  if (!Array.isArray(xmlAlanlari) || xmlAlanlari.length === 0) {
    return [];
  }

  // Trendyol API için bayi bilgisi
  const dealer = getAnyDealer();
  if (!dealer) {
    const msg = 'oneriAttributeMap: API bilgisi olan bayi bulunamadı';
    addLog('error', msg);
    throw new Error(msg);
  }

  // Trendyol'dan kategori attribute'larını çek
  let attributes;
  try {
    const response = await axios.get(
      `https://apigw.trendyol.com/integration/product/product-categories/${trendyolKategoriId}/attributes`,
      { headers: trendyolHeaders(dealer), timeout: 10000 }
    );
    attributes = response.data?.categoryAttributes || [];
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    const msg = `Attribute listesi çekilemedi (kategori ${trendyolKategoriId}): ${detail}`;
    addLog('error', msg, dealer.id);
    throw new Error(msg);
  }

  if (attributes.length === 0) {
    addLog('warn', `oneriAttributeMap: kategori ${trendyolKategoriId} için attribute bulunamadı`, dealer.id);
    return [];
  }

  // Attribute listesini Claude için sadeleştir
  const attributeOzeti = attributes.map(a => ({
    ad: a.attribute?.name,
    zorunlu: a.required === true,
    ozelDegerGirilebilir: a.attribute?.allowCustom === true,
    ornekDegerler: (a.attributeValues || []).slice(0, 8).map(v => v.name),
  }));

  const prompt = `Bir XML ürün feed'indeki alanları Trendyol'un kategori attribute'larıyla eşleştirmem gerekiyor.

XML Feed Alanları:
${xmlAlanlari.map(a => `- ${a}`).join('\n')}

Trendyol Kategori Attribute'ları:
${JSON.stringify(attributeOzeti, null, 2)}

Yukarıdaki XML alanlarını en uygun Trendyol attribute'larıyla eşleştir.
Sadece makul ve anlamlı eşleşmeleri dahil et. Eşleştirilemeyen alanları atla.

SADECE aşağıdaki JSON array formatında yanıt ver — başka hiçbir şey ekleme:
[{"xml_alan": "<xml alan adı>", "trendyol_attribute": "<trendyol attribute adı>", "zorunlu": <true veya false>}]`;

  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  try {
    const completion = await getClient().chat.completions.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = completion.choices[0].message.content?.trim() || '';
    if (!text) throw new Error('OpenAI boş yanıt döndürdü');

    // JSON array'i bul ve parse et
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error(`Geçerli JSON array bulunamadı. Yanıt: ${text.slice(0, 300)}`);
    }

    const result = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(result)) throw new Error('Yanıt array formatında değil');

    return result;
  } catch (err) {
    addLog('error', `oneriAttributeMap hatası (kategori ${trendyolKategoriId}): ${err.message}`, dealer.id);
    throw err;
  }
}

// ── 3. TOPLU ATTRİBUTE DOLDURMA ─────────────────────────────
/**
 * Ürün adına bakarak zorunlu attribute'ların değerlerini AI ile tahmin eder.
 *
 * @param {string} urunAdi
 * @param {Array<{id,name,required,allow_custom,values:{id,name}[]}>} attributes
 * @returns {Promise<Array<{attributeId,attributeValueId?} | {attributeId,customValue?}>>}
 */
async function oneriAttributeDoldur(urunAdi, attributes) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY tanımlı değil');
  if (!attributes || attributes.length === 0) return [];

  const attrListesi = attributes.map(a => {
    if (a.values && a.values.length > 0) {
      const degerler = a.values.slice(0, 20).map(v => `${v.id}:${v.name}`).join(', ');
      return `- ${a.name} (attributeId:${a.id}) → seçenekler: [${degerler}]`;
    }
    return `- ${a.name} (attributeId:${a.id}) → serbest metin`;
  }).join('\n');

  const prompt = `Ürün: "${urunAdi}"

Bu ürün için şu zorunlu attribute değerlerini tahmin et:
${attrListesi}

Kurallar:
- Değer listesi olan attribute'lar için listeden bir seçenek seç (attributeValueId kullan)
- Serbest metin attribute'lar için kısa ve doğru bir değer yaz (customValue kullan)
- "Menşei" veya "Ülke" içeren attribute'lar için varsayılan değer "Çin"dir; listede "Çin" seçeneğini bul ve kullan. Ürün adında başka bir ülke açıkça geçiyorsa o ülkeyi kullan.
- Emin olmadığın attribute'ları atla
- Sadece JSON array döndür, başka açıklama ekleme

Format: [{"attributeId": <number>, "attributeValueId": <number>}] veya [{"attributeId": <number>, "customValue": "<metin>"}]`;

  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  try {
    const completion = await getClient().chat.completions.create({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = completion.choices[0].message.content?.trim() || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const result = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(result)) return [];

    // Validate: only return entries with correct attributeId + valid value reference
    return result.filter(r => {
      if (typeof r.attributeId !== 'number') return false;
      const attr = attributes.find(a => a.id === r.attributeId);
      if (!attr) return false;
      if (typeof r.attributeValueId === 'number') {
        if (attr.values && attr.values.length > 0) {
          return attr.values.some(v => v.id === r.attributeValueId);
        }
        return true;
      }
      if (typeof r.customValue === 'string' && r.customValue.trim()) return true;
      return false;
    });
  } catch (err) {
    addLog('error', `oneriAttributeDoldur hatası [${urunAdi}]: ${err.message}`);
    return [];
  }
}

module.exports = { oneriKategori, oneriAttributeMap, oneriAttributeDoldur, kullaniciOnayla };
