-- Migration: 002_pricing_rules_dedup
-- pricing_rules tablosundaki mükerrer kayıtları temizler ve tekrarı önlemek için
-- unique expression index ekler.

-- 1. Mükerrer satırları sil: her (rule_type, scope_type, scope_id) grubundan
--    yalnızca en düşük id'li kayıt tutulur.
DELETE FROM pricing_rules
WHERE id NOT IN (
  SELECT MIN(id)
  FROM pricing_rules
  GROUP BY rule_type, scope_type, COALESCE(scope_id, -1)
);

-- 2. Gelecekteki tekrarları önlemek için unique expression index ekle.
--    scope_id NULL olabileceğinden COALESCE(-1) ile normalize edilir.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_rules_no_dup
  ON pricing_rules(rule_type, scope_type, COALESCE(scope_id, -1));
