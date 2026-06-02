#!/usr/bin/env node
'use strict';
// Additional aggressive edge-case tests for caveman-config.js
// Focuses on security boundaries and coverage gaps in the existing test file.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { safeWriteFlag, readFlag, appendFlag, readHistory, getConfigDir, getConfigPath, VALID_MODES } = require('./caveman-config');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-cfg-extra-'));
}

// ── safeWriteFlag: symlink at flag path → refuses write ──────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  const victimPath = path.join(tmpDir, 'victim.txt');
  fs.writeFileSync(victimPath, 'secret-content');
  fs.symlinkSync(victimPath, flagPath);

  safeWriteFlag(flagPath, 'full');

  // victim must not be modified
  assert.strictEqual(fs.readFileSync(victimPath, 'utf8'), 'secret-content', 'safeWriteFlag: symlink at target refused, victim unmodified');
  // symlink still present
  assert.ok(fs.lstatSync(flagPath).isSymbolicLink(), 'safeWriteFlag: symlink not replaced');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: safeWriteFlag refuses symlink at flag path (clobber protection)');
}

// ── safeWriteFlag: numeric content (mode as numeric string) ──────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  // Should not crash for unusual content, even if readFlag rejects it
  safeWriteFlag(flagPath, '123');
  assert.ok(fs.existsSync(flagPath), 'safeWriteFlag: numeric content written');
  const read = readFlag(flagPath); // should be null (not a valid mode)
  assert.strictEqual(read, null, 'readFlag: numeric content rejected');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: safeWriteFlag writes numeric; readFlag rejects it');
}

// ── safeWriteFlag: empty content ─────────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  safeWriteFlag(flagPath, '');
  // empty string → file exists but readFlag returns null (not a valid mode)
  const read = readFlag(flagPath);
  assert.strictEqual(read, null, 'safeWriteFlag: empty content → readFlag null');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: safeWriteFlag empty content → readFlag null');
}

// ── readFlag: flag is a directory → null ─────────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.mkdirSync(flagPath);
  const read = readFlag(flagPath);
  assert.strictEqual(read, null, 'readFlag: directory → null');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: readFlag directory → null');
}

// ── readFlag: content with trailing whitespace/newline ────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.writeFileSync(flagPath, 'full\n');
  const read = readFlag(flagPath);
  assert.strictEqual(read, 'full', 'readFlag: trims trailing newline');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: readFlag trims trailing whitespace');
}

// ── readFlag: exactly MAX_FLAG_BYTES (64) → null (too large? no, 64 is cap) ──
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  // 64 bytes = at cap: size > MAX_FLAG_BYTES means > 64, so 64 is ok for size check
  // but content must still be a valid mode. Let's verify exactly 64 bytes is allowed by size check.
  const content = 'x'.repeat(64); // 64 bytes, content invalid mode
  fs.writeFileSync(flagPath, content);
  const st = fs.statSync(flagPath);
  // size check: st.size > MAX_FLAG_BYTES (64), so 64 is NOT > 64 → allowed through size check
  // but content 'xxx...x' is not a valid mode → returns null
  const read = readFlag(flagPath);
  assert.strictEqual(read, null, 'readFlag: 64-byte invalid mode → null (size ok, mode rejected)');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: readFlag 64-byte file not rejected by size (only by mode whitelist)');
}

// ── appendFlag: symlink at file path → refuses append ────────────────────────
{
  const tmpDir = mkTmp();
  const histPath = path.join(tmpDir, '.caveman-history.jsonl');
  const victimPath = path.join(tmpDir, 'victim.txt');
  fs.writeFileSync(victimPath, 'safe');
  fs.symlinkSync(victimPath, histPath);

  appendFlag(histPath, JSON.stringify({ ts: 1, session_id: 'x' }));

  // victim must remain unmodified
  assert.strictEqual(fs.readFileSync(victimPath, 'utf8'), 'safe', 'appendFlag: symlink at target refused');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: appendFlag refuses symlink at file path (clobber protection)');
}

// ── appendFlag: newline stripping ─────────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const histPath = path.join(tmpDir, 'history.jsonl');
  // Line with trailing newline should not produce double-newlines
  appendFlag(histPath, '{"a":1}\n');
  appendFlag(histPath, '{"b":2}');
  const raw = fs.readFileSync(histPath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());
  assert.strictEqual(lines.length, 2, 'appendFlag strips trailing newline; 2 entries');
  assert.deepStrictEqual(JSON.parse(lines[0]), { a: 1 });
  assert.deepStrictEqual(JSON.parse(lines[1]), { b: 2 });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: appendFlag newline stripping');
}

// ── readHistory: blank file → [] ─────────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const histPath = path.join(tmpDir, 'history.jsonl');
  fs.writeFileSync(histPath, '');
  const lines = readHistory(histPath);
  assert.deepStrictEqual(lines, [], 'readHistory: blank file → []');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: readHistory blank file → []');
}

// ── readHistory: file with only blank lines → [] ─────────────────────────────
{
  const tmpDir = mkTmp();
  const histPath = path.join(tmpDir, 'history.jsonl');
  fs.writeFileSync(histPath, '\n\n\n');
  const lines = readHistory(histPath);
  assert.deepStrictEqual(lines, [], 'readHistory: only newlines → []');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: readHistory only blank lines → []');
}

// ── readHistory: directory → [] ──────────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const lines = readHistory(tmpDir);
  assert.deepStrictEqual(lines, [], 'readHistory: directory → []');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: readHistory directory → []');
}

// ── VALID_MODES: all wenyan variants present ──────────────────────────────────
{
  assert.ok(VALID_MODES.includes('wenyan-lite'), 'wenyan-lite in VALID_MODES');
  assert.ok(VALID_MODES.includes('wenyan'), 'wenyan in VALID_MODES');
  assert.ok(VALID_MODES.includes('wenyan-full'), 'wenyan-full in VALID_MODES');
  assert.ok(VALID_MODES.includes('wenyan-ultra'), 'wenyan-ultra in VALID_MODES');
  console.log('PASS: all wenyan variants in VALID_MODES');
}

// ── getConfigDir / getConfigPath with XDG override ───────────────────────────
{
  const origXDG = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = '/tmp/test-xdg';

  // Reload module to pick up env
  const key = require.resolve('./caveman-config');
  delete require.cache[key];
  const { getConfigDir, getConfigPath } = require('./caveman-config');

  const dir = getConfigDir();
  assert.ok(dir.startsWith('/tmp/test-xdg'), 'getConfigDir uses XDG_CONFIG_HOME');
  assert.ok(dir.endsWith('caveman'), 'getConfigDir appends caveman');

  const configPath = getConfigPath();
  assert.ok(configPath.endsWith('config.json'), 'getConfigPath ends with config.json');
  assert.ok(configPath.includes('caveman'), 'getConfigPath includes caveman');

  if (origXDG !== undefined) process.env.XDG_CONFIG_HOME = origXDG;
  else delete process.env.XDG_CONFIG_HOME;
  console.log('PASS: getConfigDir/getConfigPath with XDG_CONFIG_HOME');
}

// ── safeWriteFlag: concurrent writes don't corrupt data ──────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  // Multiple rapid safeWriteFlag calls to same path — last write wins, no crash
  for (const mode of ['lite', 'full', 'ultra', 'lite', 'full']) {
    safeWriteFlag(flagPath, mode);
  }
  const read = readFlag(flagPath);
  assert.ok(VALID_MODES.includes(read), `concurrent writes: final value is valid mode (got: ${read})`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: concurrent safeWriteFlag: final value is valid mode');
}

// ── safeWriteFlag/readFlag: all modes round-trip correctly ───────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  for (const mode of VALID_MODES) {
    safeWriteFlag(flagPath, mode);
    const read = readFlag(flagPath);
    assert.strictEqual(read, mode, `round-trip for mode: ${mode}`);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: safeWriteFlag/readFlag all modes round-trip');
}

// ── env var priority over config file ─────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const origXDG = process.env.XDG_CONFIG_HOME;
  const origEnv = process.env.CAVEMAN_DEFAULT_MODE;
  process.env.XDG_CONFIG_HOME = tmpDir;
  process.env.CAVEMAN_DEFAULT_MODE = 'ultra';

  const cavDir = path.join(tmpDir, 'caveman');
  fs.mkdirSync(cavDir, { recursive: true });
  fs.writeFileSync(path.join(cavDir, 'config.json'), JSON.stringify({ defaultMode: 'lite' }));

  const key = require.resolve('./caveman-config');
  delete require.cache[key];
  const { getDefaultMode } = require('./caveman-config');

  // env var 'ultra' should win over config file 'lite'
  assert.strictEqual(getDefaultMode(), 'ultra', 'env var beats config file');

  if (origXDG !== undefined) process.env.XDG_CONFIG_HOME = origXDG; else delete process.env.XDG_CONFIG_HOME;
  if (origEnv !== undefined) process.env.CAVEMAN_DEFAULT_MODE = origEnv; else delete process.env.CAVEMAN_DEFAULT_MODE;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: env var priority over config file');
}

console.log('\nAll caveman-config extra tests passed.');
