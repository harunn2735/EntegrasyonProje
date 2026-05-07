-- Seed: default_pricing_rules
-- Dinamik fiyatlandırma modülü için varsayılan başlangıç kuralları

INSERT OR IGNORE INTO pricing_rules (name, rule_type, scope_type, scope_id, parameters, priority, is_active)
VALUES
  -- 1. Global minimum kâr marjı koruması (%5) — her zaman aktif, en yüksek öncelik
  (
    'Global Minimum Kâr Marjı',
    'min_margin',
    'global',
    NULL,
    '{"min_margin_percent": 5, "action": "block_below_margin"}',
    1,
    1
  ),

  -- 2. Global stok bazlı fiyatlandırma — aktif, düşük stoğa prim / yüksek stoğa indirim
  (
    'Global Stok Bazlı Fiyatlandırma',
    'stock_based',
    'global',
    NULL,
    '{
      "low_stock_threshold": 10,
      "low_stock_price_increase_percent": 10,
      "high_stock_threshold": 50,
      "high_stock_price_decrease_percent": 5,
      "out_of_stock_action": "hide"
    }',
    5,
    1
  ),

  -- 3. Global satış hızı (velocity) bazlı fiyatlandırma — kapalı, hazır ama pasif
  (
    'Global Satış Hızı Fiyatlandırması',
    'velocity_based',
    'global',
    NULL,
    '{
      "fast_velocity_window_days": 7,
      "fast_velocity_min_units": 10,
      "fast_velocity_price_increase_percent": 5,
      "slow_velocity_window_days": 30,
      "slow_velocity_max_units": 2,
      "slow_velocity_price_decrease_percent": 5
    }',
    10,
    0
  );
