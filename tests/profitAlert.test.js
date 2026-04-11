'use strict';

const { checkMargin, checkCommissionMismatch } = require('../services/profitAlert');

describe('ProfitAlertService', () => {
  // Test 5: Düşük marj → alert_logs INSERT çağrılır
  test('checkMargin: margin < threshold → inserts LOW_MARGIN alert', () => {
    const insertedRows = [];
    const mockDb = {
      prepare: () => ({
        run: (...args) => insertedRows.push(args)
      })
    };

    checkMargin({
      dealer_id: 1,
      order_number: 'ORD-001',
      barcode: 'BC-001',
      margin: 10,
      threshold: 15,
      db: mockDb
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toContain('LOW_MARGIN');
    expect(insertedRows[0]).toContain(10);  // margin
    expect(insertedRows[0]).toContain(15);  // threshold
  });

  test('checkMargin: margin >= threshold → no insert', () => {
    const insertedRows = [];
    const mockDb = {
      prepare: () => ({ run: (...args) => insertedRows.push(args) })
    };

    checkMargin({
      dealer_id: 1,
      order_number: 'ORD-001',
      barcode: 'BC-001',
      margin: 20,
      threshold: 15,
      db: mockDb
    });

    expect(insertedRows).toHaveLength(0);
  });

  test('checkCommissionMismatch: diff > 5% → inserts COMMISSION_MISMATCH alert', () => {
    const insertedRows = [];
    const mockDb = {
      prepare: () => ({ run: (...args) => insertedRows.push(args) })
    };

    // actual=40, expected=37 → diff=3/37=8.1% > 5%
    checkCommissionMismatch({
      dealer_id: 1,
      order_number: 'ORD-001',
      barcode: 'BC-001',
      actual: 40,
      expected: 37,
      db: mockDb
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toContain('COMMISSION_MISMATCH');
  });

  test('checkCommissionMismatch: diff <= 5% → no insert', () => {
    const insertedRows = [];
    const mockDb = {
      prepare: () => ({ run: (...args) => insertedRows.push(args) })
    };

    // actual=37.5, expected=37 → diff=0.5/37=1.35% < 5%
    checkCommissionMismatch({
      dealer_id: 1,
      order_number: 'ORD-001',
      barcode: 'BC-001',
      actual: 37.5,
      expected: 37,
      db: mockDb
    });

    expect(insertedRows).toHaveLength(0);
  });
});
