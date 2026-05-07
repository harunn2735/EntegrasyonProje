// services/kategoriService.js
'use strict';

const axios = require('axios');
const db = require('../database');

const TRENDYOL_CATEGORIES_URL =
  'https://apigw.trendyol.com/integration/product/product-categories';

// ── AUTH HEADER ───────────────────────────────────────────────
function trendyolHeaders(dealer) {
  const auth = Buffer.from(`${dealer.api_key}:${dealer.api_secret}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'User-Agent': `${dealer.supplier_id} - SelfIntegration`,
    'Content-Type': 'application/json',
  };
}

// ── LOG YARDIMCISI ────────────────────────────────────────────
function addLog(level, message, dealerId = null) {
  try {
    db.prepare('INSERT INTO logs (level, message, dealer_id) VALUES (?, ?, ?)').run(
      level, message, dealerId
    );
  } catch (_) {}
}

// ── AĞAÇ YAPIYI DÜZLEŞTIR ────────────────────────────────────
// Her kategori için: { trendyol_id, kategori_adi, parent_id (trendyol_id), tam_yol }
function flattenCategories(cats, parentTrendyolId = null, parentPath = '') {
  const result = [];
  for (const cat of (cats || [])) {
    const tamYol = parentPath ? `${parentPath} > ${cat.name}` : cat.name;
    result.push({
      trendyol_id: cat.id,
      kategori_adi: cat.name,
      parent_trendyol_id: parentTrendyolId,
      tam_yol: tamYol,
    });
    if (cat.subCategories && cat.subCategories.length > 0) {
      result.push(...flattenCategories(cat.subCategories, cat.id, tamYol));
    }
  }
  return result;
}

// ── VERİTABANINA KAYDET ───────────────────────────────────────
// parent_id: trendyol_kategoriler tablosundaki id (trendyol_id üzerinden lookup)
const upsertKategori = db.prepare(`
  INSERT INTO trendyol_kategoriler
    (trendyol_id, kategori_adi, parent_id, tam_yol, guncelleme_tarihi)
  VALUES
    (@trendyol_id, @kategori_adi, NULL, @tam_yol, datetime('now'))
  ON CONFLICT(trendyol_id) DO UPDATE SET
    kategori_adi      = excluded.kategori_adi,
    tam_yol           = excluded.tam_yol,
    guncelleme_tarihi = datetime('now')
`);

const updateParentId = db.prepare(`
  UPDATE trendyol_kategoriler
  SET parent_id = (
    SELECT id FROM trendyol_kategoriler WHERE trendyol_id = ?
  )
  WHERE trendyol_id = ?
`);

// ── ANA FONKSİYON ─────────────────────────────────────────────
async function syncKategoriler(dealer) {
  if (!dealer?.api_key || !dealer?.api_secret || !dealer?.supplier_id) {
    const msg = 'syncKategoriler: Trendyol API bilgileri eksik';
    addLog('error', msg, dealer?.id ?? null);
    throw new Error(msg);
  }

  // 1. API'den çek
  let responseData;
  try {
    const response = await axios.get(TRENDYOL_CATEGORIES_URL, {
      headers: trendyolHeaders(dealer),
      timeout: 15000,
    });
    responseData = response.data;
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    const msg = `Trendyol kategorileri çekilemedi: ${detail}`;
    addLog('error', msg, dealer.id);
    throw new Error(msg);
  }

  // 2. Düzleştir
  const rootCats = Array.isArray(responseData)
    ? responseData
    : responseData?.categories || [];

  if (rootCats.length === 0) {
    const msg = 'Trendyol kategorileri boş döndü';
    addLog('warn', msg, dealer.id);
    return { synced: 0 };
  }

  const flat = flattenCategories(rootCats);

  // 3. Transaction içinde upsert
  const saveAll = db.transaction((rows) => {
    for (const row of rows) {
      upsertKategori.run(row);
    }
    // parent_id'leri ikinci geçişte doldur (self-referential FK)
    for (const row of rows) {
      if (row.parent_trendyol_id !== null) {
        updateParentId.run(row.parent_trendyol_id, row.trendyol_id);
      }
    }
  });

  try {
    saveAll(flat);
  } catch (err) {
    const msg = `Kategoriler kaydedilemedi: ${err.message}`;
    addLog('error', msg, dealer.id);
    throw new Error(msg);
  }

  addLog('info', `Trendyol kategori sync tamamlandı: ${flat.length} kategori`, dealer.id);
  return { synced: flat.length };
}

// ── VERİTABANINDAN KATEGORİ OKUMA HELPERLERİ ─────────────────
function getKategoriById(trendyolId) {
  return db
    .prepare('SELECT * FROM trendyol_kategoriler WHERE trendyol_id = ?')
    .get(trendyolId);
}

function searchKategoriler(query) {
  return db
    .prepare(
      `SELECT * FROM trendyol_kategoriler
       WHERE kategori_adi LIKE ? OR tam_yol LIKE ?
       ORDER BY tam_yol
       LIMIT 50`
    )
    .all(`%${query}%`, `%${query}%`);
}

function getKategoriCount() {
  return db.prepare('SELECT COUNT(*) as count FROM trendyol_kategoriler').get()?.count ?? 0;
}

module.exports = { syncKategoriler, getKategoriById, searchKategoriler, getKategoriCount };
