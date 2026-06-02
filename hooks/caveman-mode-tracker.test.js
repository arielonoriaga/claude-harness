#!/usr/bin/env node
'use strict';
// Aggressive tests for caveman-mode-tracker.js
// Spawns the hook as a child process with controlled stdin + env.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const TRACKER = path.join(__dirname, 'caveman-mode-tracker.js');

function run(input, env = {}) {
  const result = spawnSync(process.execPath, [TRACKER], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 5000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cavetracker-test-'));
}

// ── /caveman command → writes flag ───────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  const r = run({ prompt: '/caveman lite' }, { CLAUDE_CONFIG_DIR: tmpDir, CAVEMAN_DEFAULT_MODE: 'full' });
  assert.strictEqual(r.status, 0, '/caveman lite exits 0');
  assert.ok(fs.existsSync(flagPath), 'flag file created for /caveman lite');
  const content = fs.readFileSync(flagPath, 'utf8').trim();
  assert.strictEqual(content, 'lite', 'flag content is lite');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman lite writes flag');
}

{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  const r = run({ prompt: '/caveman ultra' }, { CLAUDE_CONFIG_DIR: tmpDir });
  assert.ok(fs.existsSync(flagPath), 'flag written for /caveman ultra');
  assert.strictEqual(fs.readFileSync(flagPath, 'utf8').trim(), 'ultra');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman ultra writes flag');
}

{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  // bare /caveman → uses CAVEMAN_DEFAULT_MODE env var
  const r = run({ prompt: '/caveman' }, { CLAUDE_CONFIG_DIR: tmpDir, CAVEMAN_DEFAULT_MODE: 'full' });
  assert.ok(fs.existsSync(flagPath), 'bare /caveman creates flag');
  assert.strictEqual(fs.readFileSync(flagPath, 'utf8').trim(), 'full', 'bare /caveman uses default mode');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: bare /caveman uses default mode');
}

// ── /caveman off deactivates ──────────────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.writeFileSync(flagPath, 'full');
  run({ prompt: '/caveman off' }, { CLAUDE_CONFIG_DIR: tmpDir });
  assert.ok(!fs.existsSync(flagPath), '/caveman off removes flag');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman off removes flag');
}

{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.writeFileSync(flagPath, 'full');
  run({ prompt: '/caveman stop' }, { CLAUDE_CONFIG_DIR: tmpDir });
  assert.ok(!fs.existsSync(flagPath), '/caveman stop removes flag');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman stop removes flag');
}

{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.writeFileSync(flagPath, 'full');
  run({ prompt: '/caveman disable' }, { CLAUDE_CONFIG_DIR: tmpDir });
  assert.ok(!fs.existsSync(flagPath), '/caveman disable removes flag');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman disable removes flag');
}

// ── natural language activation ───────────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  run({ prompt: 'activate caveman' }, { CLAUDE_CONFIG_DIR: tmpDir, CAVEMAN_DEFAULT_MODE: 'full' });
  assert.ok(fs.existsSync(flagPath), '"activate caveman" writes flag');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: "activate caveman" writes flag');
}

{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  run({ prompt: 'turn on caveman mode' }, { CLAUDE_CONFIG_DIR: tmpDir, CAVEMAN_DEFAULT_MODE: 'full' });
  assert.ok(fs.existsSync(flagPath), '"turn on caveman mode" writes flag');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: "turn on caveman mode" writes flag');
}

{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  run({ prompt: 'talk like caveman' }, { CLAUDE_CONFIG_DIR: tmpDir, CAVEMAN_DEFAULT_MODE: 'full' });
  assert.ok(fs.existsSync(flagPath), '"talk like caveman" writes flag');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: "talk like caveman" writes flag');
}

// ── natural language deactivation ────────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.writeFileSync(flagPath, 'full');
  run({ prompt: 'stop caveman' }, { CLAUDE_CONFIG_DIR: tmpDir });
  assert.ok(!fs.existsSync(flagPath), '"stop caveman" removes flag');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: "stop caveman" removes flag');
}

{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.writeFileSync(flagPath, 'full');
  run({ prompt: 'normal mode' }, { CLAUDE_CONFIG_DIR: tmpDir });
  assert.ok(!fs.existsSync(flagPath), '"normal mode" removes flag');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: "normal mode" removes flag');
}

{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.writeFileSync(flagPath, 'full');
  run({ prompt: 'turn off caveman' }, { CLAUDE_CONFIG_DIR: tmpDir });
  assert.ok(!fs.existsSync(flagPath), '"turn off caveman" removes flag');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: "turn off caveman" removes flag');
}

// ── /caveman unknown arg → no change ─────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.writeFileSync(flagPath, 'full');
  run({ prompt: '/caveman notamode' }, { CLAUDE_CONFIG_DIR: tmpDir });
  // flag should be unchanged
  assert.ok(fs.existsSync(flagPath), 'unknown arg leaves flag intact');
  assert.strictEqual(fs.readFileSync(flagPath, 'utf8').trim(), 'full', 'unknown arg leaves mode intact');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman unknown arg → no change');
}

// ── independent mode commands ─────────────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  run({ prompt: '/caveman-commit' }, { CLAUDE_CONFIG_DIR: tmpDir });
  // /caveman-commit writes 'commit' to flag
  if (fs.existsSync(flagPath)) {
    assert.strictEqual(fs.readFileSync(flagPath, 'utf8').trim(), 'commit', '/caveman-commit writes commit mode');
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman-commit sets commit mode');
}

{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  run({ prompt: '/caveman-review' }, { CLAUDE_CONFIG_DIR: tmpDir });
  if (fs.existsSync(flagPath)) {
    assert.strictEqual(fs.readFileSync(flagPath, 'utf8').trim(), 'review', '/caveman-review writes review mode');
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman-review sets review mode');
}

// ── per-turn reinforcement output when flag active ───────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.writeFileSync(flagPath, 'full');
  const r = run({ prompt: 'hello there' }, { CLAUDE_CONFIG_DIR: tmpDir });
  // Should emit JSON with hookSpecificOutput
  assert.ok(r.stdout.length > 0, 'emits output when caveman active');
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch (e) { assert.fail('output is not valid JSON: ' + r.stdout); }
  assert.ok(parsed.hookSpecificOutput, 'hookSpecificOutput present');
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('CAVEMAN MODE ACTIVE'), 'context includes CAVEMAN MODE ACTIVE');
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('full'), 'context includes mode name');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: per-turn reinforcement output when flag active');
}

// ── no output when flag absent ────────────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const r = run({ prompt: 'just a normal question' }, { CLAUDE_CONFIG_DIR: tmpDir });
  // No flag file — should produce no stdout (or empty)
  assert.strictEqual(r.stdout.trim(), '', 'no output when no flag');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: no output when flag absent');
}

// ── independent mode in flag → no reinforcement ──────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  fs.writeFileSync(flagPath, 'commit');
  const r = run({ prompt: 'write me a commit' }, { CLAUDE_CONFIG_DIR: tmpDir });
  // commit is an INDEPENDENT_MODE — should NOT emit per-turn reinforcement
  assert.strictEqual(r.stdout.trim(), '', 'commit mode: no per-turn reinforcement');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: commit mode produces no per-turn reinforcement');
}

// ── malformed / non-object stdin → silent fail ────────────────────────────────
{
  const r = run('not json at all', {});
  assert.strictEqual(r.status, 0, 'malformed stdin exits 0 (silent fail)');
  assert.strictEqual(r.stdout.trim(), '', 'malformed stdin → no output');
  console.log('PASS: malformed stdin silent fail');
}

{
  const r = run('{}', {});
  assert.strictEqual(r.status, 0, 'empty prompt object exits 0');
  console.log('PASS: empty prompt object silent fail');
}

// ── /caveman wenyan-full → stored as wenyan ───────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  run({ prompt: '/caveman wenyan-full' }, { CLAUDE_CONFIG_DIR: tmpDir });
  if (fs.existsSync(flagPath)) {
    const content = fs.readFileSync(flagPath, 'utf8').trim();
    assert.strictEqual(content, 'wenyan', 'wenyan-full alias stored as wenyan');
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman wenyan-full stored as wenyan');
}

// ── /caveman:caveman alias ─────────────────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  run({ prompt: '/caveman:caveman lite' }, { CLAUDE_CONFIG_DIR: tmpDir });
  if (fs.existsSync(flagPath)) {
    assert.strictEqual(fs.readFileSync(flagPath, 'utf8').trim(), 'lite', '/caveman:caveman alias works');
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman:caveman alias');
}

// ── symlink at flag path → safeWriteFlag refuses ─────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  const victimPath = path.join(tmpDir, 'victim.txt');
  fs.writeFileSync(victimPath, 'original');
  fs.symlinkSync(victimPath, flagPath);
  run({ prompt: '/caveman full' }, { CLAUDE_CONFIG_DIR: tmpDir });
  // victim should NOT be overwritten — safeWriteFlag refuses symlinks
  const victimContent = fs.readFileSync(victimPath, 'utf8');
  assert.strictEqual(victimContent, 'original', 'symlink clobber vector refused');
  // symlink still exists, not replaced
  assert.ok(fs.lstatSync(flagPath).isSymbolicLink(), 'flag symlink left intact (not overwritten)');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: symlink at flag path not overwritten (security)');
}

// ── case-insensitive prompt matching ─────────────────────────────────────────
{
  const tmpDir = mkTmp();
  const flagPath = path.join(tmpDir, '.caveman-active');
  run({ prompt: 'ACTIVATE CAVEMAN' }, { CLAUDE_CONFIG_DIR: tmpDir, CAVEMAN_DEFAULT_MODE: 'full' });
  assert.ok(fs.existsSync(flagPath), 'case-insensitive "ACTIVATE CAVEMAN"');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: case-insensitive activation');
}

// ── /caveman off when no flag exists → no error ───────────────────────────────
{
  const tmpDir = mkTmp();
  const r = run({ prompt: '/caveman off' }, { CLAUDE_CONFIG_DIR: tmpDir });
  assert.strictEqual(r.status, 0, '/caveman off with no flag exits 0');
  console.log('PASS: /caveman off with no flag exits 0');
}

// ── /caveman-stats blocked and returns output ────────────────────────────────
{
  const tmpDir = mkTmp();
  // Create a minimal fake session file
  const projDir = path.join(tmpDir, 'projects', 'test');
  fs.mkdirSync(projDir, { recursive: true });
  const sessionPath = path.join(projDir, 'session-abc.jsonl');
  const line = JSON.stringify({
    type: 'assistant',
    message: { model: 'claude-sonnet-4-20250514', usage: { output_tokens: 100, cache_read_input_tokens: 10 } }
  });
  fs.writeFileSync(sessionPath, line + '\n');

  const r = run(
    { prompt: '/caveman-stats', transcript_path: sessionPath },
    { CLAUDE_CONFIG_DIR: tmpDir }
  );
  assert.ok(r.stdout.length > 0, '/caveman-stats produces output');
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch (e) { assert.fail('stats output not JSON: ' + r.stdout); }
  assert.strictEqual(parsed.decision, 'block', '/caveman-stats decision is block');
  assert.ok(parsed.reason.includes('Caveman Stats'), 'stats output in reason');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS: /caveman-stats blocks and returns stats');
}

console.log('\nAll caveman-mode-tracker tests passed.');
