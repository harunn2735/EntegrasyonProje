'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'db.sqlite');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const SEEDS_DIR = path.join(__dirname, '..', 'seeds');

/**
 * Tüm bekleyen SQL migration dosyalarını sırayla uygular.
 * Bir kez uygulanan migration bir daha çalıştırılmaz (_migrations tablosu ile izlenir).
 *
 * @param {import('better-sqlite3').Database} db - Mevcut better-sqlite3 bağlantısı
 * @param {{ verbose?: boolean }} [opts]
 * @returns {{ applied: string[], skipped: string[] }}
 */
function runMigrations(db, opts = {}) {
  const log = opts.verbose !== false ? console.log : () => {};

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      filename   TEXT    NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db.prepare('SELECT filename FROM _migrations ORDER BY filename').all().map(r => r.filename)
  );

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    log('  ⚠️  migrations/ klasörü bulunamadı, atlanıyor.');
    return { applied: [], skipped: [] };
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const result = { applied: [], skipped: [] };

  const applyMigration = db.transaction((file, sql) => {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
  });

  for (const file of files) {
    if (applied.has(file)) {
      log(`  ⏭  ${file} (zaten uygulandı)`);
      result.skipped.push(file);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    applyMigration(file, sql);
    log(`  ✅ ${file}`);
    result.applied.push(file);
  }

  return result;
}

/**
 * Seed SQL dosyasını çalıştırır.
 * Seed'ler INSERT OR IGNORE kullanmalı; bu fonksiyon tekrar çalıştırılabilir.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} seedFile - seeds/ klasöründeki dosya adı
 */
function runSeed(db, seedFile) {
  const fullPath = path.join(SEEDS_DIR, seedFile);
  if (!fs.existsSync(fullPath)) {
    console.warn(`  ⚠️  Seed dosyası bulunamadı: ${seedFile}`);
    return;
  }
  const sql = fs.readFileSync(fullPath, 'utf8');
  db.exec(sql);
  console.log(`  🌱 ${seedFile} seed uygulandı`);
}

module.exports = { runMigrations, runSeed };

// ── Standalone CLI modu ─────────────────────────────────────────────────────
if (require.main === module) {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log('\n📦 Migration başlatılıyor...\n');

  const { applied, skipped } = runMigrations(db, { verbose: true });

  const args = process.argv.slice(2);
  if (args.includes('--seed') || args.includes('-s')) {
    console.log('\n🌱 Seed verisi uygulanıyor...\n');
    runSeed(db, 'default_pricing_rules.sql');
  }
  if (args.includes('--seed-demo') || args.includes('-d')) {
    console.log('\n🌱 Demo soruları uygulanıyor...\n');
    runSeed(db, 'demo_questions.sql');
  }

  db.close();

  console.log(`\n✅ Tamamlandı: ${applied.length} yeni migration, ${skipped.length} atlandı.`);
  if (applied.length === 0 && !args.includes('--seed') && !args.includes('--seed-demo')) {
    console.log('   Fiyat kuralları seed için : node scripts/migrate.js --seed');
    console.log('   Demo soru seed için       : node scripts/migrate.js --seed-demo');
  }
}
