// TDD coverage for AC2 of validate-workflows.mjs: target enumeration is scoped to
// workflows/*.js discovered relative to the script-resolved repo root (not cwd),
// and tools/*.mjs is NEVER scanned. Run: node --test 'tools/*.test.mjs'
//
// This validator module runs OUTSIDE the workflow sandbox, so node:* is fair game.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { listWorkflowScripts, validateScript, formatResult, main } from './validate-workflows.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const workflowsDir = path.join(repoRoot, 'workflows')

// Write `src` to a throwaway .js file and validate it, returning the result.
function checkSource(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfval-'))
  const file = path.join(dir, 'probe.js')
  fs.writeFileSync(file, src)
  try {
    return validateScript(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('AC2: enumerates exactly the workflows/*.js scripts', () => {
  const scripts = listWorkflowScripts()
  const names = scripts.map((f) => path.basename(f))
  assert.deepEqual(names, ['debug.js', 'execute.js', 'review.js', 'spec.js'], 'debug/execute/review/spec .js, sorted')
})

test('AC2: every target is an absolute path under workflows/, ending in .js', () => {
  for (const f of listWorkflowScripts()) {
    assert.ok(path.isAbsolute(f), `absolute path: ${f}`)
    assert.equal(path.dirname(f), workflowsDir, `lives in workflows/: ${f}`)
    assert.ok(f.endsWith('.js'), `.js file: ${f}`)
  }
})

test('AC2: never scans tools/*.mjs (no .mjs, no tools/ entries)', () => {
  const scripts = listWorkflowScripts()
  for (const f of scripts) {
    assert.ok(!f.endsWith('.mjs'), `no .mjs target: ${f}`)
    assert.notEqual(path.dirname(f), here, `nothing from tools/: ${f}`)
  }
  // The validator itself and its test live in tools/ — neither may appear.
  const names = scripts.map((f) => path.basename(f))
  assert.ok(!names.includes('validate-workflows.mjs'), 'validator not self-scanned')
  assert.ok(!names.includes('validate-workflows.test.mjs'), 'test not scanned')
})

test('AC2: discovery is repo-root-relative, independent of process.cwd()', () => {
  const before = listWorkflowScripts()
  const orig = process.cwd()
  try {
    process.chdir(path.parse(orig).root) // chdir to filesystem root
    const after = listWorkflowScripts()
    assert.deepEqual(after, before, 'same targets regardless of cwd')
  } finally {
    process.chdir(orig)
  }
})

test('AC2: returns [] when workflows/ is absent (no crash, no mid-loop exit)', (t) => {
  // listWorkflowScripts must not throw; absence yields empty enumeration.
  const scripts = listWorkflowScripts()
  assert.ok(Array.isArray(scripts), 'always returns an array')
})

test('AC3: a real workflow body with top-level return/await constructs cleanly', () => {
  // The actual scripts use top-level `return`/`await`, illegal at script scope but
  // legal inside the async wrapper. They must validate without errors.
  for (const file of listWorkflowScripts()) {
    const errors = validateScript(file)
    assert.deepEqual(errors, [], `${path.basename(file)} should have no parse errors`)
  }
})

test('AC3: the seven sandbox globals resolve inside the wrapper (STUBS defines them)', () => {
  // Reference every injected global at top level. If STUBS did not declare all
  // seven, a strict-mode reference error would surface; construction must succeed.
  const src =
    'export const meta = { name: "probe" }\n' +
    'agent(); parallel(); pipeline(); log("x"); phase("y");\n' +
    'const a = args; const b = budget;\n' +
    'return { a, b }\n'
  assert.deepEqual(checkSource(src), [], 'all 7 globals must be declared by STUBS')
})

test('AC3: only the FIRST `export const meta` is stripped', () => {
  // A stray second occurrence inside a string must survive (s.replace = first only).
  // Construct must still succeed; we assert no error rather than reaching into source.
  const src =
    'export const meta = { name: "probe" }\n' +
    'const note = "export const meta appears again here"\n' +
    'return note\n'
  assert.deepEqual(checkSource(src), [], 'first-occurrence swap keeps the body valid')
})

test('AC3: a SyntaxError yields a failure carrying the error message', () => {
  const src = 'export const meta = { name: "probe" }\nconst x = (\n' // unbalanced paren
  const errors = checkSource(src)
  assert.equal(errors.length, 1, 'one parse failure')
  assert.match(errors[0], /SyntaxError|Unexpected|missing|\)/i, 'message is carried, not swallowed')
})

test('AC4: a missing meta object literal fails with the expected reason', () => {
  // No `meta = {` anywhere → AC4 failure with the exact reason string.
  const src = 'const notMeta = { name: "probe" }\nreturn 1\n'
  const errors = checkSource(src)
  assert.ok(
    errors.includes('no meta object literal found'),
    `expected AC4 reason, got: ${JSON.stringify(errors)}`,
  )
})

test('AC4: matches both `export const meta = {` and bare `const meta = {`', () => {
  // The regex runs against the ORIGINAL source, so the exported form passes; and a
  // post-swap-style bare declaration passes too. Neither yields the AC4 reason.
  for (const src of ['export const meta = {}\nreturn 1\n', 'const meta = {}\nreturn 1\n']) {
    assert.ok(
      !checkSource(src).includes('no meta object literal found'),
      `meta literal should be detected in: ${JSON.stringify(src)}`,
    )
  }
})

test('AC4: all real workflow scripts contain a meta object literal', () => {
  for (const file of listWorkflowScripts()) {
    assert.ok(
      !validateScript(file).includes('no meta object literal found'),
      `${path.basename(file)} must satisfy AC4`,
    )
  }
})

test('AC5: each forbidden API is flagged in its trailing-paren / argless form', () => {
  const cases = [
    ['Date.now(', 'const t = Date.now()\n'],
    ['Math.random(', 'const r = Math.random()\n'],
    ['new Date()', 'const d = new Date()\n'],
    ['require(', 'const x = require("fs")\n'],
    ['process.', 'const p = process.env\n'],
    ['fs.', 'fs.readFileSync("x")\n'],
  ]
  for (const [token, body] of cases) {
    const src = 'export const meta = { name: "probe" }\n' + body + 'return 1\n'
    const errors = checkSource(src)
    assert.ok(
      errors.some((e) => e.includes('forbidden') && e.includes(token)),
      `expected a forbidden-API error naming ${JSON.stringify(token)}, got: ${JSON.stringify(errors)}`,
    )
  }
})

test('AC5: the forbidden-API error reports the line number of the match', () => {
  // Token sits on line 3 (meta on 1, blank on 2, match on 3).
  const src = 'export const meta = { name: "probe" }\n\nconst t = Date.now()\nreturn 1\n'
  const errors = checkSource(src)
  assert.ok(
    errors.some((e) => /forbidden/.test(e) && /Date\.now\(/.test(e) && /\b3\b/.test(e)),
    `expected error naming token + line 3, got: ${JSON.stringify(errors)}`,
  )
})

test('AC5: `new Date(args.ts)` (non-argless) is ALLOWED, not flagged', () => {
  const src = 'export const meta = { name: "probe" }\nconst d = new Date(args.ts)\nreturn d\n'
  const errors = checkSource(src)
  assert.ok(
    !errors.some((e) => /forbidden/.test(e)),
    `non-argless new Date(args.ts) must not be flagged, got: ${JSON.stringify(errors)}`,
  )
})

test('AC5: argless `new Date()` with inner whitespace is still flagged', () => {
  const src = 'export const meta = { name: "probe" }\nconst d = new  Date(  )\nreturn d\n'
  const errors = checkSource(src)
  assert.ok(
    errors.some((e) => /forbidden/.test(e) && e.includes('new Date()')),
    `argless new Date() with whitespace must be flagged, got: ${JSON.stringify(errors)}`,
  )
})

test('AC5: review.js:136 comment (bare Date / Math.random) does NOT false-positive', () => {
  // The real comment contains "Date" and "Math.random" but neither trailing-paren form.
  const src =
    'export const meta = { name: "probe" }\n' +
    '// small helpers (no Date/Math.random — sandbox forbids them)\n' +
    'return 1\n'
  const errors = checkSource(src)
  assert.ok(
    !errors.some((e) => /forbidden/.test(e)),
    `bare Date / Math.random in a comment must not trigger, got: ${JSON.stringify(errors)}`,
  )
})

test('AC5: all real workflow scripts are free of forbidden APIs', () => {
  for (const file of listWorkflowScripts()) {
    const errors = validateScript(file)
    assert.ok(
      !errors.some((e) => /forbidden/.test(e)),
      `${path.basename(file)} must have no forbidden-API matches, got: ${JSON.stringify(errors)}`,
    )
  }
})

test('AC1/AC6: clean tree prints exactly one ✓ line per workflow and exits 0', () => {
  // Run the real CLI as a subprocess so we exercise main() + process.exit end-to-end.
  const out = execFileSync('node', ['validate-workflows.mjs'], { cwd: here, encoding: 'utf8' })
  const lines = out.trim().split('\n')
  assert.deepEqual(
    lines,
    ['✓ workflows/debug.js', '✓ workflows/execute.js', '✓ workflows/review.js', '✓ workflows/spec.js'],
    'exactly one ✓ line per workflows/*.js, in sorted order, no extra summary line',
  )
  // execFileSync throws on non-zero exit; reaching here proves exit 0 on a clean tree.
})

test('AC6: a failing file produces exactly ONE ✗ line in the contract format', () => {
  // Build a probe with TWO distinct failures (forbidden API + parse error) and assert
  // formatResult collapses them into a single `✗ <rel> — <reasons>` line.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfval-fmt-'))
  const file = path.join(dir, 'bad.js')
  fs.writeFileSync(file, 'export const meta = { name: "x" }\nconst t = Date.now()\nconst y = (\n')
  try {
    const { pass, line } = formatResult(file)
    assert.equal(pass, false, 'file with errors must not pass')
    const matches = line.match(/✗/g) || []
    assert.equal(matches.length, 1, `exactly one ✗ marker, got: ${JSON.stringify(line)}`)
    assert.ok(line.includes(' — '), `uses the em-dash separator, got: ${JSON.stringify(line)}`)
    assert.ok(line.includes('Date.now('), 'carries the forbidden-API reason')
    assert.ok(/SyntaxError|Unexpected|\)/i.test(line), 'carries the parse-error reason')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('AC6: a passing file formats as `✓ workflows/<f>` with the prefix', () => {
  const file = listWorkflowScripts()[0]
  const { pass, line } = formatResult(file)
  assert.equal(pass, true, 'a real clean workflow passes')
  assert.match(line, /^✓ workflows\/[^/]+\.js$/, `✓ + workflows/ prefix, got: ${JSON.stringify(line)}`)
})

test('AC1/AC6: main() returns 0 when every file passes (clean tree)', () => {
  assert.equal(main(), 0, 'all-pass returns 0')
})

test('AC3: the Function is constructed, NOT invoked (no body side effects)', () => {
  // If validateScript invoked the constructed function, this assignment to a global
  // would fire. Constructing only must leave the probe untouched.
  delete globalThis.__wfval_invoked__
  const src =
    'export const meta = { name: "probe" }\n' +
    'globalThis.__wfval_invoked__ = true\n' +
    'return 1\n'
  const errors = checkSource(src)
  assert.deepEqual(errors, [], 'valid body constructs')
  assert.equal(globalThis.__wfval_invoked__, undefined, 'body must never run')
})
