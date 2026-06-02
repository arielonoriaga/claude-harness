#!/usr/bin/env node
'use strict';
// Aggressive unit tests for caveman-config.js
// Run: node hooks/caveman-config.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolate from the module cache so env overrides work per-test
function freshConfig() {
  const key = require.resolve('./caveman-config');
  delete require.cache[key];
  return require('./caveman-config');
}

// ── VALID_MODES ──────────────────────────────────────────────────────────────
{
  const { VALID_MODES } = require('./caveman-config');
  assert.ok(VALID_MODES.includes('full'), 'full in VALID_MODES');
  assert.ok(VALID_MODES.includes('off'), 'off in VALID_MODES');
  assert.ok(VALID_MODES.includes('lite'), 'lite in VALID_MODES');
  assert.ok(VALID_MODES.includes('ultra'), 'ultra in VALID_MODES');
  assert.ok(VALID_MODES.includes('wenyan'), 'wenyan in VALID_MODES');
  assert.ok(VALID_MODES.includes('commit'), 'commit in VALID_MODES');
  assert.ok(!VALID_MODES.includes('bogus'), 'bogus NOT in VALID_MODES');
  console.log('PASS: VALID_MODES');
}

// ── getDefaultMode — env var ──────────────────────────────────────────────────
{
  const orig = process.env.CAVEMAN_DEFAULT_MODE;
  process.env.CAVEMAN_DEFAULT_MODE = 'lite';
  const { getDefaultMode } = freshConfig();
  assert.strictEqual(getDefaultMode(), 'lite', 'env var overrides default');
  delete process.env.CAVEMAN_DEFAULT_MODE;
  if (orig !== undefined) process.env.CAVEMAN_DEFAULT_MODE = orig;
  console.log('PASS: getDefaultMode env var');
}

{
  const orig = process.env.CAVEMAN_DEFAULT_MODE;
  process.env.CAVEMAN_DEFAULT_MODE = 'ULTRA'; // uppercase
  const { getDefaultMode } = freshConfig();
  assert.strictEqual(getDefaultMode(), 'ultra', 'env var lowercased');
  delete process.env.CAVEMAN_DEFAULT_MODE;
  if (orig !== undefined) process.env.CAVEMAN_DEFAULT_MODE = orig;
  console.log('PASS: getDefaultMode env var uppercase');
}

{
  const orig = process.env.CAVEMAN_DEFAULT_MODE;
  process.env.CAVEMAN_DEFAULT_MODE = 'INVALID_MODE_XYZ';
  const { getDefaultMode } = freshConfig();
  // invalid env → falls through to 'full'
  assert.strictEqual(getDefaultMode(), 'full', 'invalid env falls to full');
  delete process.env.CAVEMAN_DEFAULT_MODE;
  if (orig !== undefined) process.env.CAVEMAN_DEFAULT_MODE = orig;
  console.log('PASS: getDefaultMode invalid env');
}

// ── getDefaultMode — config file ─────────────────────────────────────────────
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-test-'));
  const origXDG = process.env.XDG_CONFIG_HOME;
  const origEnv = process.env.CAVEMAN_DEFAULT_MODE;
  process.env.XDG_CONFIG_HOME = tmpDir;
  delete process.env.CAVEMAN_DEFAULT_MODE;

  const cavDir = path.join(tmpDir, 'caveman');
  fs.mkdirSync(cavDir, { recursive: true });
  fs.writeFileSync(path.join(cavDir, 'config.json'), JSON.stringify({ defaultMode: 'wenyan' }));

  const { getDefaultMode } = freshConfig();
  assert.strictEqual(getDefaultMode(), 'wenyan', 'config file sets mode');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origXDG !== undefined) process.env.XDG_CONFIG_HOME = origXDG; else delete process.env.XDG_CONFIG_HOME;
  if (origEnv !== undefined) process.env.CAVEMAN_DEFAULT_MODE = origEnv;
  console.log('PASS: getDefaultMode config file');
}

{
  // invalid defaultMode in config → fall to 'full'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-test-'));
  const origXDG = process.env.XDG_CONFIG_HOME;
  const origEnv = process.env.CAVEMAN_DEFAULT_MODE;
  process.env.XDG_CONFIG_HOME = tmpDir;
  delete process.env.CAVEMAN_DEFAULT_MODE;

  const cavDir = path.join(tmpDir, 'caveman');
  fs.mkdirSync(cavDir, { recursive: true });
  fs.writeFileSync(path.join(cavDir, 'config.json'), JSON.stringify({ defaultMode: 'NOTREAL' }));

  const { getDefaultMode } = freshConfig();
  assert.strictEqual(getDefaultMode(), 'full', 'invalid config mode → full');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origXDG !== undefined) process.env.XDG_CONFIG_HOME = origXDG; else delete process.env.XDG_CONFIG_HOME;
  if (origEnv !== undefined) process.env.CAVEMAN_DEFAULT_MODE = origEnv;
  console.log('PASS: getDefaultMode invalid config mode');
}

{
  // missing config file → 'full'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-test-'));
  const origXDG = process.env.XDG_CONFIG_HOME;
  const origEnv = process.env.CAVEMAN_DEFAULT_MODE;
  process.env.XDG_CONFIG_HOME = tmpDir;
  delete process.env.CAVEMAN_DEFAULT_MODE;

  const { getDefaultMode } = freshConfig();
  assert.strictEqual(getDefaultMode(), 'full', 'missing config → full');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origXDG !== undefined) process.env.XDG_CONFIG_HOME = origXDG; else delete process.env.XDG_CONFIG_HOME;
  if (origEnv !== undefined) process.env.CAVEMAN_DEFAULT_MODE = origEnv;
  console.log('PASS: getDefaultMode missing config');
}

{
  // malformed JSON config → fall to 'full'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-test-'));
  const origXDG = process.env.XDG_CONFIG_HOME;
  const origEnv = process.env.CAVEMAN_DEFAULT_MODE;
  process.env.XDG_CONFIG_HOME = tmpDir;
  delete process.env.CAVEMAN_DEFAULT_MODE;

  const cavDir = path.join(tmpDir, 'caveman');
  fs.mkdirSync(cavDir, { recursive: true });
  fs.writeFileSync(path.join(cavDir, 'config.json'), '{not valid json}');

  const { getDefaultMode } = freshConfig();
  assert.strictEqual(getDefaultMode(), 'full', 'malformed config → full');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origXDG !== undefined) process.env.XDG_CONFIG_HOME = origXDG; else delete process.env.XDG_CONFIG_HOME;
  if (origEnv !== undefined) process.env.CAVEMAN_DEFAULT_MODE = origEnv;
  console.log('PASS: getDefaultMode malformed config');
}

// ── safeWriteFlag / readFlag roundtrip ────────────────────────────────────────
{
  const { safeWriteFlag, readFlag, VALID_MODES } = require('./caveman-config');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-flag-test-'));
  const flagPath = path.join(tmpDir, '.caveman-active');

  // write + read every valid mode
  for (const mode of VALID_MODES) {
    safeWriteFlag(flagPath, mode);
    const read = readFlag(flagPath);
    assert.strictEqual(read, mode, `roundtrip for mode: ${mode}`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: safeWriteFlag/readFlag roundtrip all modes');
}

{
  const { readFlag } = require('./caveman-config');
  // nonexistent → null
  assert.strictEqual(readFlag('/tmp/__no_such_file_caveman__'), null, 'nonexistent → null');
  console.log('PASS: readFlag nonexistent → null');
}

{
  const { safeWriteFlag, readFlag } = require('./caveman-config');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-flag-test-'));
  const flagPath = path.join(tmpDir, '.caveman-active');

  // Write a symlink to a different file — readFlag must refuse it
  const targetPath = path.join(tmpDir, 'secret');
  fs.writeFileSync(targetPath, 'full');
  fs.symlinkSync(targetPath, flagPath);
  const read = readFlag(flagPath);
  assert.strictEqual(read, null, 'readFlag refuses symlink');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: readFlag refuses symlink');
}

{
  const { readFlag } = require('./caveman-config');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-flag-test-'));
  const flagPath = path.join(tmpDir, '.caveman-active');

  // File too large (> MAX_FLAG_BYTES=64)
  fs.writeFileSync(flagPath, 'x'.repeat(65));
  const read = readFlag(flagPath);
  assert.strictEqual(read, null, 'readFlag refuses oversized file');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: readFlag refuses oversized file');
}

{
  const { readFlag, safeWriteFlag } = require('./caveman-config');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-flag-test-'));
  const flagPath = path.join(tmpDir, '.caveman-active');

  // Invalid mode string written manually → readFlag rejects
  fs.writeFileSync(flagPath, 'NOTAMODE');
  const read = readFlag(flagPath);
  assert.strictEqual(read, null, 'readFlag rejects unknown mode string');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: readFlag rejects unknown mode');
}

// ── appendFlag / readHistory ──────────────────────────────────────────────────
{
  const { appendFlag, readHistory } = require('./caveman-config');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-hist-test-'));
  const histPath = path.join(tmpDir, '.caveman-history.jsonl');

  appendFlag(histPath, JSON.stringify({ a: 1 }));
  appendFlag(histPath, JSON.stringify({ b: 2 }));
  const lines = readHistory(histPath);
  assert.strictEqual(lines.length, 2, 'readHistory returns 2 lines');
  assert.deepStrictEqual(JSON.parse(lines[0]), { a: 1 });
  assert.deepStrictEqual(JSON.parse(lines[1]), { b: 2 });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: appendFlag/readHistory roundtrip');
}

{
  const { readHistory } = require('./caveman-config');
  // nonexistent → []
  const lines = readHistory('/tmp/__no_such_history_caveman__');
  assert.deepStrictEqual(lines, [], 'readHistory nonexistent → []');
  console.log('PASS: readHistory nonexistent → []');
}

{
  const { readHistory } = require('./caveman-config');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-hist-test-'));
  const histPath = path.join(tmpDir, '.history');
  // readHistory on a symlink → []
  const target = path.join(tmpDir, 'real');
  fs.writeFileSync(target, '{"x":1}\n');
  fs.symlinkSync(target, histPath);
  const lines = readHistory(histPath);
  assert.deepStrictEqual(lines, [], 'readHistory refuses symlink');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: readHistory refuses symlink');
}

// ── appendFlag empty/null/newline handling ────────────────────────────────────
{
  const { appendFlag, readHistory } = require('./caveman-config');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-hist-test-'));
  const histPath = path.join(tmpDir, '.history');

  appendFlag(histPath, ''); // empty string — should not crash
  appendFlag(histPath, '{"ts":1}'); // one real line
  const lines = readHistory(histPath);
  // empty string produces a blank line, readHistory filters them
  assert.ok(lines.every(l => l.trim().length > 0), 'no blank lines from readHistory');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: appendFlag/readHistory empty line filter');
}

console.log('\nAll caveman-config tests passed.');
