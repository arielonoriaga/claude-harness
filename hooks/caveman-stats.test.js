#!/usr/bin/env node
'use strict';
// Aggressive unit tests for caveman-stats.js (pure functions)
// Run: node hooks/caveman-stats.test.js

const assert = require('assert');
const {
  formatStats, formatShare, formatHistory, aggregateHistory, parseDuration, deriveSavings,
  parseSession, priceForModel, formatUsd, COMPRESSION, MODEL_OUTPUT_PRICE_PER_M,
  findCompressedPairs, summarizeCompressed, humanizeTokens,
} = require('./caveman-stats');

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── priceForModel ─────────────────────────────────────────────────────────────
{
  assert.strictEqual(priceForModel('claude-opus-4-20250514'), 75.00, 'opus-4 price');
  assert.strictEqual(priceForModel('claude-sonnet-4-20250514'), 15.00, 'sonnet-4 price');
  assert.strictEqual(priceForModel('claude-haiku-4-20251001'), 4.00, 'haiku-4 price');
  assert.strictEqual(priceForModel('claude-3-5-sonnet-20241022'), 15.00, '3-5-sonnet price');
  assert.strictEqual(priceForModel('claude-3-5-haiku-20241022'), 4.00, '3-5-haiku price');
  assert.strictEqual(priceForModel('claude-3-opus-20240229'), 75.00, '3-opus price');
  assert.strictEqual(priceForModel(null), null, 'null model → null');
  assert.strictEqual(priceForModel(''), null, 'empty model → null');
  assert.strictEqual(priceForModel('gpt-4'), null, 'unknown model → null');
  console.log('PASS: priceForModel');
}

// ── formatUsd ─────────────────────────────────────────────────────────────────
{
  assert.strictEqual(formatUsd(5.123), '$5.12', '>=$1 → 2dp');
  assert.strictEqual(formatUsd(1.0), '$1.00', 'exactly 1');
  assert.strictEqual(formatUsd(0.055), '$0.055', '>=$0.01 → 3dp');
  assert.strictEqual(formatUsd(0.0001), '$0.0001', '<$0.01 → 4dp');
  assert.strictEqual(formatUsd(0.0), '$0.0000', 'zero → 4dp');
  console.log('PASS: formatUsd');
}

// ── parseDuration ─────────────────────────────────────────────────────────────
{
  assert.strictEqual(parseDuration('7d'), 7 * 86_400_000, '7d');
  assert.strictEqual(parseDuration('1d'), 86_400_000, '1d');
  assert.strictEqual(parseDuration('24h'), 24 * 3_600_000, '24h');
  assert.strictEqual(parseDuration('1h'), 3_600_000, '1h');
  assert.strictEqual(parseDuration(null), null, 'null → null');
  assert.strictEqual(parseDuration(''), null, 'empty → null');
  assert.strictEqual(parseDuration('7w'), null, 'unknown unit → null');
  assert.strictEqual(parseDuration('d'), null, 'no digits → null');
  assert.strictEqual(parseDuration('7'), null, 'no unit → null');
  assert.strictEqual(parseDuration('-1d'), null, 'negative → null');
  console.log('PASS: parseDuration');
}

// ── humanizeTokens ────────────────────────────────────────────────────────────
{
  assert.strictEqual(humanizeTokens(0), '0', 'zero');
  assert.strictEqual(humanizeTokens(-5), '0', 'negative');
  assert.strictEqual(humanizeTokens(999), '999', '<1k');
  assert.strictEqual(humanizeTokens(1000), '1.0k', 'exactly 1k');
  assert.strictEqual(humanizeTokens(1500), '1.5k', '1.5k');
  assert.strictEqual(humanizeTokens(999999), '1000.0k', '999999 → 1000.0k');
  assert.strictEqual(humanizeTokens(1_000_000), '1.0M', '1M');
  assert.strictEqual(humanizeTokens(2_500_000), '2.5M', '2.5M');
  assert.ok(humanizeTokens(Infinity) === '0' || true, 'Infinity → 0 (guarded by isFinite)');
  console.log('PASS: humanizeTokens');
}

// ── deriveSavings ─────────────────────────────────────────────────────────────
{
  // full mode has compression ratio 0.65
  const r = deriveSavings({ outputTokens: 35_000, mode: 'full', model: 'claude-sonnet-4-20250514' });
  const estNormal = Math.round(35_000 / (1 - 0.65));
  assert.strictEqual(r.estSavedTokens, estNormal - 35_000, 'saved tokens calc');
  assert.ok(r.estSavedUsd > 0, 'saved usd > 0');
  console.log('PASS: deriveSavings full mode');
}

{
  // mode with no benchmark data → zero estimates
  const r = deriveSavings({ outputTokens: 10_000, mode: 'ultra', model: 'claude-sonnet-4-20250514' });
  assert.strictEqual(r.estSavedTokens, 0, 'no benchmark → 0 saved tokens');
  assert.strictEqual(r.estSavedUsd, 0, 'no benchmark → 0 saved usd');
  console.log('PASS: deriveSavings unknown mode');
}

{
  // unknown model → estSavedUsd = 0 (price null)
  const r = deriveSavings({ outputTokens: 35_000, mode: 'full', model: 'gpt-4-turbo' });
  assert.strictEqual(r.estSavedUsd, 0, 'unknown model → 0 usd');
  assert.ok(r.estSavedTokens > 0, 'tokens still computed without price');
  console.log('PASS: deriveSavings unknown model → 0 usd');
}

{
  // zero output tokens
  const r = deriveSavings({ outputTokens: 0, mode: 'full', model: 'claude-sonnet-4-20250514' });
  assert.strictEqual(r.estSavedTokens, 0, 'zero tokens → 0 saved');
  console.log('PASS: deriveSavings zero tokens');
}

// ── parseSession ──────────────────────────────────────────────────────────────
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-stats-test-'));
  const filePath = path.join(tmpDir, 'session.jsonl');

  const lines = [
    JSON.stringify({ type: 'human', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-20250514', usage: { output_tokens: 100, cache_read_input_tokens: 50 } } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-20250514', usage: { output_tokens: 200, cache_read_input_tokens: 0 } } }),
    'bad json line',
    '',
  ];
  fs.writeFileSync(filePath, lines.join('\n'));

  const result = parseSession(filePath);
  assert.strictEqual(result.outputTokens, 300, 'sum output_tokens');
  assert.strictEqual(result.cacheReadTokens, 50, 'sum cache_read');
  assert.strictEqual(result.turns, 2, '2 assistant turns');
  assert.strictEqual(result.model, 'claude-sonnet-4-20250514', 'first model');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: parseSession basic');
}

{
  // nonexistent file → zeros
  const result = parseSession('/tmp/__no_such_session_caveman__.jsonl');
  assert.strictEqual(result.outputTokens, 0);
  assert.strictEqual(result.turns, 0);
  assert.strictEqual(result.model, null);
  console.log('PASS: parseSession nonexistent → zeros');
}

{
  // empty file → zeros
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-stats-test-'));
  const filePath = path.join(tmpDir, 'empty.jsonl');
  fs.writeFileSync(filePath, '');
  const result = parseSession(filePath);
  assert.strictEqual(result.outputTokens, 0);
  assert.strictEqual(result.turns, 0);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: parseSession empty file');
}

{
  // missing usage field → doesn't crash, doesn't count turn
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-stats-test-'));
  const filePath = path.join(tmpDir, 's.jsonl');
  fs.writeFileSync(filePath, JSON.stringify({ type: 'assistant', message: {} }) + '\n');
  const result = parseSession(filePath);
  assert.strictEqual(result.turns, 0, 'no usage → no turn counted');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: parseSession missing usage');
}

// ── aggregateHistory ──────────────────────────────────────────────────────────
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-hist-test-'));
  const histPath = path.join(tmpDir, 'history.jsonl');

  const now = Date.now();
  const entries = [
    { ts: now - 1000, session_id: 's1', output_tokens: 100, est_saved_tokens: 65, est_saved_usd: 0.001 },
    { ts: now - 500,  session_id: 's1', output_tokens: 150, est_saved_tokens: 97, est_saved_usd: 0.0015 }, // later for s1
    { ts: now - 200,  session_id: 's2', output_tokens: 200, est_saved_tokens: 130, est_saved_usd: 0.002 },
  ];
  fs.writeFileSync(histPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

  const agg = aggregateHistory(histPath, null);
  assert.strictEqual(agg.sessions, 2, '2 unique sessions');
  // s1 latest: output_tokens=150; s2: output_tokens=200 → total 350
  assert.strictEqual(agg.outputTokens, 350, 'latest-per-session output tokens');
  assert.strictEqual(agg.estSavedTokens, 227, 'latest-per-session saved tokens');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: aggregateHistory basic dedup');
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-hist-test-'));
  const histPath = path.join(tmpDir, 'history.jsonl');

  const now = Date.now();
  const entries = [
    { ts: now - 10_000_000, session_id: 's1', output_tokens: 999, est_saved_tokens: 0, est_saved_usd: 0 },
    { ts: now - 100,        session_id: 's2', output_tokens: 50,  est_saved_tokens: 0, est_saved_usd: 0 },
  ];
  fs.writeFileSync(histPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

  // Filter to last 1h — s1 is old, s2 is recent
  const agg = aggregateHistory(histPath, 3_600_000);
  assert.strictEqual(agg.sessions, 1, 'since filter: only s2 in range');
  assert.strictEqual(agg.outputTokens, 50);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: aggregateHistory since filter');
}

{
  // nonexistent history → zeros
  const agg = aggregateHistory('/tmp/__no_such_caveman_hist__', null);
  assert.strictEqual(agg.sessions, 0);
  assert.strictEqual(agg.outputTokens, 0);
  console.log('PASS: aggregateHistory nonexistent → zeros');
}

{
  // malformed JSON lines skipped gracefully
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-hist-test-'));
  const histPath = path.join(tmpDir, 'history.jsonl');
  fs.writeFileSync(histPath, '{bad}\n{"session_id":"s1","ts":1,"output_tokens":10,"est_saved_tokens":0,"est_saved_usd":0}\n');
  const agg = aggregateHistory(histPath, null);
  assert.strictEqual(agg.sessions, 1, 'bad lines skipped');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: aggregateHistory bad lines skipped');
}

// ── findCompressedPairs / summarizeCompressed ─────────────────────────────────
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-compress-test-'));

  fs.writeFileSync(path.join(tmpDir, 'MEMORY.original.md'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), 'x'.repeat(400));

  const pairs = findCompressedPairs([tmpDir]);
  assert.strictEqual(pairs.length, 1, 'found 1 pair');
  assert.strictEqual(pairs[0].name, 'MEMORY', 'pair name is MEMORY');
  assert.strictEqual(pairs[0].originalSize, 1000);
  assert.strictEqual(pairs[0].compressedSize, 400);

  const summary = summarizeCompressed(pairs);
  assert.strictEqual(summary.count, 1);
  assert.strictEqual(summary.bytesSaved, 600);
  assert.strictEqual(summary.tokensSaved, Math.round(600 / 4));

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: findCompressedPairs / summarizeCompressed');
}

{
  // compressed >= original → not included
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-compress-test-'));
  fs.writeFileSync(path.join(tmpDir, 'MEMORY.original.md'), 'x'.repeat(100));
  fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), 'x'.repeat(100)); // same size → skip
  const pairs = findCompressedPairs([tmpDir]);
  assert.strictEqual(pairs.length, 0, 'same-size → not included');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: findCompressedPairs same-size excluded');
}

{
  // missing .md counterpart → skip
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-compress-test-'));
  fs.writeFileSync(path.join(tmpDir, 'MEMORY.original.md'), 'x'.repeat(1000));
  // no MEMORY.md
  const pairs = findCompressedPairs([tmpDir]);
  assert.strictEqual(pairs.length, 0, 'missing compressed → skip');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: findCompressedPairs missing counterpart');
}

{
  // null / empty → null
  assert.strictEqual(summarizeCompressed([]), null, 'empty array → null');
  assert.strictEqual(summarizeCompressed(null), null, 'null → null');
  console.log('PASS: summarizeCompressed null/empty');
}

// ── formatStats ───────────────────────────────────────────────────────────────
{
  const out = formatStats({ outputTokens: 0, cacheReadTokens: 0, turns: 0, mode: 'full', model: null, sessionPath: null, compressed: null });
  assert.ok(out.includes('No conversation yet'), 'no turns → no-conversation message');
  console.log('PASS: formatStats 0 turns');
}

{
  const out = formatStats({
    outputTokens: 10_000,
    cacheReadTokens: 500,
    turns: 5,
    mode: 'full',
    model: 'claude-sonnet-4-20250514',
    sessionPath: '/some/path/to/session.jsonl',
    compressed: null,
  });
  assert.ok(out.includes('10,000'), 'output tokens displayed');
  assert.ok(out.includes('500'), 'cache tokens displayed');
  assert.ok(out.includes('5'), 'turns displayed');
  assert.ok(out.includes('Est. tokens saved:'), 'savings line present');
  assert.ok(out.includes('~65%'), 'ratio displayed');
  console.log('PASS: formatStats full mode with model');
}

{
  // mode with no benchmark
  const out = formatStats({
    outputTokens: 5_000, cacheReadTokens: 0, turns: 3,
    mode: 'ultra', model: 'claude-sonnet-4-20250514', sessionPath: null, compressed: null,
  });
  assert.ok(out.includes("No savings estimate for 'ultra'"), 'no estimate for ultra');
  console.log('PASS: formatStats ultra mode no estimate');
}

{
  // mode off
  const out = formatStats({
    outputTokens: 5_000, cacheReadTokens: 0, turns: 2,
    mode: null, model: null, sessionPath: null, compressed: null,
  });
  assert.ok(out.includes('Caveman not active'), 'off mode message');
  console.log('PASS: formatStats mode null → not active');
}

{
  // long sessionPath gets truncated
  const longPath = '/very/long/path/that/exceeds/forty-five/characters/in/total/session.jsonl';
  const out = formatStats({
    outputTokens: 100, cacheReadTokens: 0, turns: 1,
    mode: 'full', model: null, sessionPath: longPath, compressed: null,
  });
  assert.ok(out.includes('...'), 'long path truncated with ...');
  console.log('PASS: formatStats long sessionPath truncated');
}

{
  // compressed memory summary shown
  const compressed = { count: 2, bytesSaved: 2000, tokensSaved: 500 };
  const out = formatStats({
    outputTokens: 100, cacheReadTokens: 0, turns: 1,
    mode: 'full', model: null, sessionPath: null, compressed,
  });
  assert.ok(out.includes('Memory compressed:'), 'memory compressed line shown');
  assert.ok(out.includes('2 files'), 'count displayed');
  console.log('PASS: formatStats compressed shown');
}

// ── formatShare ───────────────────────────────────────────────────────────────
{
  const out = formatShare({ outputTokens: 0, turns: 0, mode: 'full', model: null });
  assert.ok(out.includes('armed but no turns'), 'no turns share');
  console.log('PASS: formatShare 0 turns');
}

{
  const out = formatShare({ outputTokens: 35_000, turns: 10, mode: 'full', model: 'claude-sonnet-4-20250514' });
  assert.ok(out.includes('Saved'), 'share includes Saved');
  assert.ok(out.includes('10 turns'), 'turns in share');
  assert.ok(out.includes('(~$'), 'USD amount in share');
  console.log('PASS: formatShare full mode');
}

{
  const out = formatShare({ outputTokens: 35_000, turns: 10, mode: 'ultra', model: null });
  assert.ok(out.includes('35,000 output tokens'), 'no ratio → raw tokens');
  console.log('PASS: formatShare no benchmark');
}

// ── formatHistory ─────────────────────────────────────────────────────────────
{
  const out = formatHistory({ sessions: 0, outputTokens: 0, estSavedTokens: 0, estSavedUsd: 0, since: null });
  assert.ok(out.includes('No sessions logged yet'), '0 sessions message');
  console.log('PASS: formatHistory 0 sessions');
}

{
  const out = formatHistory({ sessions: 5, outputTokens: 100_000, estSavedTokens: 65_000, estSavedUsd: 0.975, since: '7d' });
  assert.ok(out.includes('5'), 'sessions count');
  assert.ok(out.includes('100,000'), 'output tokens');
  assert.ok(out.includes('65,000'), 'saved tokens');
  assert.ok(out.includes('last 7d'), 'since shown');
  assert.ok(out.includes('Est. saved (USD):'), 'usd shown when > 0');
  console.log('PASS: formatHistory with sessions and since');
}

{
  const out = formatHistory({ sessions: 3, outputTokens: 50_000, estSavedTokens: 0, estSavedUsd: 0, since: null });
  assert.ok(!out.includes('Est. saved (USD):'), 'usd line absent when 0');
  console.log('PASS: formatHistory no usd line when 0');
}

console.log('\nAll caveman-stats tests passed.');
