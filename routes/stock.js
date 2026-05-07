'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const {
  getStockSettings,
  getStockAlerts,
  updateStockSettings,
} = require('../services/stockAlertService');

// GET /api/stock/alerts[?summary=true]
router.get('/alerts', (req, res) => {
  try {
    const dealerId = req.dealer.id;
    const alerts   = getStockAlerts(db, dealerId);
    if (req.query.summary === 'true') {
      return res.json({ summary: alerts.summary });
    }
    res.json(alerts);
  } catch (e) {
    console.error('[stock] /alerts hatası:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/stock/settings
router.get('/settings', (req, res) => {
  try {
    res.json(getStockSettings(db, req.dealer.id));
  } catch (e) {
    console.error('[stock] /settings hatası:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/stock/settings
router.put('/settings', (req, res) => {
  try {
    const { criticalPct, warningPct } = req.body;
    if (criticalPct === undefined || warningPct === undefined) {
      return res.status(400).json({ error: 'criticalPct ve warningPct zorunlu' });
    }
    const cPct = Number(criticalPct);
    const wPct = Number(warningPct);
    if (isNaN(cPct) || isNaN(wPct) || cPct < 1 || wPct < 1 || cPct >= wPct) {
      return res.status(400).json({ error: 'Geçersiz eşik değerleri (kritik < uyarı olmalı)' });
    }
    updateStockSettings(db, req.dealer.id, { criticalPct: cPct, warningPct: wPct });
    res.json({ success: true });
  } catch (e) {
    console.error('[stock] PUT /settings hatası:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
