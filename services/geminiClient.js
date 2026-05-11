'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

function getGenAI() {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

/**
 * Gemini modeli döndürür.
 * @param {{ maxOutputTokens?: number, jsonMode?: boolean }} [opts]
 */
function getModel(opts = {}) {
  const generationConfig = {};
  if (opts.maxOutputTokens) generationConfig.maxOutputTokens = opts.maxOutputTokens;
  if (opts.jsonMode) generationConfig.responseMimeType = 'application/json';

  return getGenAI().getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    generationConfig,
  });
}

/**
 * Prompt'u Gemini'ye gönderir, düz metin döndürür.
 * @param {string} prompt
 * @param {{ maxOutputTokens?: number, jsonMode?: boolean }} [opts]
 * @returns {Promise<string>}
 */
async function generate(prompt, opts = {}) {
  const model = getModel(opts);
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

module.exports = { generate, getModel };
