#!/usr/bin/env node
// Validate the workflow scripts in workflows/ WITHOUT executing them.
//
// The scripts in workflows/{ensemble-spec,ensemble-execute,ensemble-review}.js run inside Claude Code's
// restricted Workflow sandbox (CONTRACT §4.2): they get seven injected globals
// (agent, parallel, pipeline, log, phase, args, budget) and must NOT touch the
// filesystem, Date.now(), Math.random(), argless `new Date()`, require(), or
// process.*. We cannot run the real engine here, so we statically construct each
// script with those globals stubbed and the forbidden APIs absent — proving the
// body PARSES and references only what the sandbox provides. We construct, we do
// NOT invoke (running them would fan out real agents).
//
// This validator itself runs OUTSIDE the sandbox as plain Node ESM, so node:fs /
// node:path / node:url are fair game.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Resolve the repo root from THIS script's own location (its URL), not from the
// current working directory, so the validator works from any directory (AC2).
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowsDir = path.join(repoRoot, 'workflows')

// The seven globals the sandbox injects. STUBS is a string that DECLARES all seven
// as no-ops/empties so the workflow body's references resolve at construction time
// (we never invoke the body, so the stub bodies don't matter — only that the names
// exist). Prepended verbatim ahead of the body inside the async wrapper.
const STUBS =
  'const agent=()=>{},parallel=()=>{},pipeline=()=>{},log=()=>{},phase=()=>{},args={},budget={total:0,remaining:()=>0};'

export function listWorkflowScripts() {
  if (!fs.existsSync(workflowsDir)) return []
  return fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => path.join(workflowsDir, f))
}

// AC5: forbidden sandbox APIs, matched in their TRAILING-PAREN / argless forms so a
// bare mention (e.g. the ensemble-review.js:136 comment "no Date/Math.random") never trips —
// only an actual call/access does. `new Date()` is argless-only: `new Date(args.ts)`
// is allowed. Substring tokens use indexOf; `new Date()` needs a regex to tolerate
// inner/surrounding whitespace while still requiring empty parens.
const FORBIDDEN = [
  { name: 'Date.now(', test: (line) => line.includes('Date.now(') },
  { name: 'Math.random(', test: (line) => line.includes('Math.random(') },
  { name: 'new Date()', test: (line) => /new\s+Date\s*\(\s*\)/.test(line) },
  { name: 'require(', test: (line) => line.includes('require(') },
  { name: 'process.', test: (line) => line.includes('process.') },
  { name: 'fs.', test: (line) => line.includes('fs.') },
]

// Scan line-by-line so we can name the offending token AND its 1-based line number.
// Returns one error string per (token, line) hit, or [] when the source is clean.
function scanForbidden(src) {
  const errors = []
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const { name, test } of FORBIDDEN) {
      if (test(line)) errors.push(`forbidden API ${name} at line ${i + 1}`)
    }
  }
  return errors
}

export function validateScript(file) {
  const errors = []
  const src = fs.readFileSync(file, 'utf8')

  // AC4: every workflow must open with a `meta` object literal (the engine reads it
  // before running the body). Check the ORIGINAL source — the regex matches both the
  // canonical `export const meta = {` and the post-swap bare `const meta = {`, so it
  // is order-independent of the strip below. Absence is a hard failure.
  if (!/(?:const\s+)?meta\s*=\s*\{/.test(src)) {
    errors.push('no meta object literal found')
    return errors
  }

  // AC5: flag any forbidden sandbox API (each in its trailing-paren / argless form),
  // naming the token(s) and line(s). Reported alongside any parse error below.
  errors.push(...scanForbidden(src))

  // The engine requires `export const meta` first; strip the `export` so the body is
  // constructable as a plain function. String.replace with a string pattern swaps
  // ONLY the first occurrence — every script opens with `export const meta = {` on
  // line 1, so this targets exactly that and leaves any later literal text intact.
  const stripped = src.replace('export const meta', 'const meta')

  // Construct only — wrap the body in an async function so its top-level `await`/
  // `return` (illegal at script scope, legal inside a function) parse cleanly, with
  // STUBS prepended so the seven injected globals resolve. Constructing a Function
  // parses the body and throws SyntaxError on malformed source; we never invoke the
  // returned function, so the body never runs and no real agents fan out (AC3).
  try {
    // eslint-disable-next-line no-new-func
    new Function('return (async function(){ ' + STUBS + stripped + '\n})')
  } catch (e) {
    // Carry the engine's own message so the ✗ line points at the real problem.
    errors.push(e.message)
  }

  return errors
}

// AC6: one status line per file. A file PASSES only when validateScript returns
// no errors (T3 parse + T4 meta + T5 forbidden all clean); otherwise it FAILS and
// every collected reason is joined into ONE line so the output is exactly one line
// per workflows/<f>. The em-dash separator and the `workflows/` prefix are part of
// the contract. Returns { rel, pass, line } so main() and tests share one formatter.
export function formatResult(file) {
  const rel = path.relative(repoRoot, file)
  const errors = validateScript(file)
  if (errors.length === 0) return { rel, pass: true, line: `✓ ${rel}` }
  // Combine all reasons into a single ✗ line (AC6: one line per file). The joined
  // message carries the engine's own text so a syntax failure stays actionable (AC3).
  return { rel, pass: false, line: `✗ ${rel} — ${errors.join('; ')}` }
}

export function main() {
  const scripts = listWorkflowScripts()
  if (scripts.length === 0) {
    console.log('No workflow scripts found in', path.relative(repoRoot, workflowsDir) || workflowsDir)
    return 0
  }

  // Track an overall-fail flag across all files; exactly one line is printed per file.
  let anyFailed = false
  for (const file of scripts) {
    const { pass, line } = formatResult(file)
    if (!pass) anyFailed = true
    console.log(line)
  }

  // Exit 1 if ANY file failed, else 0 (AC1/AC6).
  return anyFailed ? 1 : 0
}

// Run the CLI only when invoked directly (node tools/validate-workflows.mjs),
// not when imported by tests — importing must not exit the test process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
