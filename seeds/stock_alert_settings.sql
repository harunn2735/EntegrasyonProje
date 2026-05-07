-- Stok uyarı sistemi varsayılan ayarları
-- migrate.js --seed ile çalıştırılır
INSERT OR IGNORE INTO dealer_settings (dealer_id, key, value) VALUES
  (3, 'stock_alert_threshold_pct',  '10'),
  (3, 'stock_warning_threshold_pct', '20'),
  (3, 'stock_reference_type',        'xml_max');
