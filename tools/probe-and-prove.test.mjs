// Reconciliation + Probe & Prove regression guards.
//
// This session resolved a real contradiction: the canonical design doc argued a
// committed `.ensemble/dynamic-check` SCRIPT-FIRST artifact, while the shipped
// CONTRACT/template put the recorded real-run check in the profile's
// `## Live real-run verification` section (model "a", profile-section). Model (a)
// won. These tests fail loudly if that drift ever returns, and assert the
// load-bearing Probe & Prove rules stay present in the install/update prose.
//
// These are doc/prose consistency guards — Probe & Prove itself is agent-run
// command prose (there is no JS code path to unit-test); the ladder is dogfooded
// against real repos per the design doc's "Testing the feature itself".
// Run: node --test 'tools/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const kit = path.join(here, '..')
const read = (rel) => fs.readFileSync(path.join(kit, rel), 'utf8')
// Markdown prose wraps freely, so match load-bearing phrases against whitespace-collapsed
// text — a guard on meaning, not on where lines happen to break.
const flat = (rel) => read(rel).replace(/\s+/g, ' ')

// The files that ship into every repo (the "kit"), vs the design doc (history/rationale).
const SHIPPED = {
  contract: 'CONTRACT.md',
  template: 'templates/repo-profile.template.md',
  install: 'commands/ensemble-install.md',
  update: 'commands/ensemble-update.md',
}
const DESIGN_DOC = 'docs/superpowers/specs/2026-07-01-dynamic-check-probe-and-prove-design.md'

test('reconciliation: no SHIPPED kit file references the dropped script-first artifact', () => {
  // The committed `.ensemble/dynamic-check` script + `.json` sidecar were dropped for the
  // profile-section model. Only the design doc may still name them (to explain the drop).
  for (const [name, rel] of Object.entries(SHIPPED)) {
    const src = read(rel)
    assert.ok(!src.includes('.ensemble/dynamic-check'), `${name} (${rel}) must not reference the dropped .ensemble/dynamic-check`)
    assert.ok(!src.includes('args.dynamicCheck'), `${name} (${rel}) must not wire args.dynamicCheck (model (a) needs no wiring)`)
  }
})

test('reconciliation: the design doc declares the profile-section model and explains dropping script-first', () => {
  const doc = read(DESIGN_DOC)
  assert.match(doc, /Artifact model.*profile-section/s, 'Status must declare the profile-section artifact model')
  assert.match(doc, /why profile-section, not script-first/i, 'must carry the rationale for dropping script-first')
  assert.match(doc, /personal.{0,20}gitignored/is, 'rationale must tie the decision to the personal, gitignored gate library')
})

test('template: Live real-run section keeps the machine-read labels the launchers consume', () => {
  const t = read(SHIPPED.template)
  // The four launchers read these exact labels out of the profile section (§4.11).
  for (const label of ['**Boot:**', '**Health signal:**', '**Real-run checks**', '**Retry cap:**', '**Teardown:**']) {
    assert.ok(t.includes(label), `template must retain the machine-read label ${label}`)
  }
  // ...and now carries Probe & Prove provenance vocabulary.
  for (const token of ['appliesWhen', 'rung', 'provenAt', 'BLOCKED']) {
    assert.ok(t.includes(token), `template Live real-run section must document ${token}`)
  }
})

test('install: step 5b climbs the ladder, records only green rungs, never fabricates a green', () => {
  const i = flat(SHIPPED.install)
  assert.match(i, /5b — Probe & Prove/, 'install must have the Probe & Prove step')
  for (const rung of ['boot + reach', 'functional smoke', 'behavioral']) {
    assert.ok(i.includes(rung), `Probe & Prove must name the "${rung}" rung`)
  }
  assert.match(i, /only for rungs that actually ran green/i, 'must record only rungs that ran green')
  assert.match(i, /Never\*{0,2} fabricate a green/i, 'must forbid fabricating a green')
  assert.match(i, /Always tear down/i, 'teardown must be guaranteed')
  assert.match(i, /[Ss]kip\*{0,2} entirely if step 5 found no runnable service/, 'must skip when there is no runnable service')
  assert.match(i, /never\*{0,2}.{0,20}production|no data exfiltration/i, 'must carry the local-only safety rule')
})

test('update: --reprobe re-proves the gate and is the ONLY path that touches the profile', () => {
  const u = flat(SHIPPED.update)
  assert.match(u, /--reprobe/, 'update must document --reprobe')
  assert.match(u, /5b — Re-probe/, 'update must have the re-probe step')
  assert.match(u, /only.{0,20}path that touches the profile|only\*{0,2} step that edits the profile/i,
    'must state --reprobe is the sole profile-touching path')
  assert.match(u, /Never\*{0,2} modify.{0,40}repo-profile\.md/i, 'plain update must still preserve the profile')
})

test('consumption: the three verifying launchers read the profile Live real-run section (model (a) needs no wiring)', () => {
  for (const rel of ['commands/ensemble-execute.md', 'commands/ensemble-review.md', 'commands/ensemble-debug.md']) {
    assert.ok(read(rel).includes('## Live real-run verification'),
      `${rel} must consume the profile's Live real-run section directly`)
  }
})
