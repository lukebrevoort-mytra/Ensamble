#!/usr/bin/env node
// Measure the prompt-cache economics of workflow runs from their agent transcripts.
//
// WHY this exists: from inside a workflow script the only token signal is
// `budget.spent()` — and that's OUTPUT tokens only (CONTRACT §4.6). The input /
// cache accounting that decides whether the §4.3 cache-stable brief actually pays
// off lives in the per-agent transcript JSONL the harness writes under
//   ~/.claude/projects/<cwd-slug>/<session>/subagents/[workflows/<wf>/]agent-*.jsonl
// Each assistant turn there carries an Anthropic `usage` block:
//   { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens }
// input_tokens   = uncached fresh input (full price)
// cache_creation = written to cache this turn   (~1.25x input price, 5m TTL)
// cache_read     = served from cache this turn  (~0.1x  input price)
//
// The number that matters for the brief reorder is the FIRST request of each agent
// (its cold start — where the shared profile prefix is paid). If the static preamble
// is a stable, cacheable prefix, the 2nd..Nth agents should show large cache_read on
// their first request. If it's stranded after a varying line, they pay it fresh.
//
// Runs OUTSIDE the sandbox as plain Node ESM — fs/path/os are fair game.
//
// Usage:
//   node tools/analyze-cache.mjs                # latest session, all runs
//   node tools/analyze-cache.mjs <wf_id>        # one run (substring match)
//   node tools/analyze-cache.mjs --session <id> # a specific session dir
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Pricing per MTok. Opus 4.x list; cache read = 0.1x input, cache write(5m) = 1.25x.
// Only the $ ESTIMATES depend on these — the token ratios (the real finding) do not.
const PRICE = { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }
const usd = (tok, rate) => (tok / 1e6) * rate
const k = (n) => (n / 1000).toFixed(1) + 'k'
const pct = (num, den) => (den <= 0 ? '0' : Math.round((num * 100) / den)) + '%'

function projectDir() {
  // Claude Code stores transcripts under a slug of the cwd (every '/' → '-').
  const slug = process.cwd().replace(/\//g, '-')
  return path.join(os.homedir(), '.claude', 'projects', slug)
}

function listSessions(proj) {
  if (!fs.existsSync(proj)) return []
  return fs
    .readdirSync(proj)
    .map((n) => path.join(proj, n))
    .filter((p) => {
      try { return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'subagents')) } catch { return false }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
}

// Group agent transcripts by run id (wf_… for workflows, 'adhoc' for loose subagents).
function collectRuns(session) {
  const runs = {}
  const add = (run, file) => { (runs[run] ||= []).push(file) }
  const wfRoot = path.join(session, 'subagents', 'workflows')
  if (fs.existsSync(wfRoot)) {
    for (const wf of fs.readdirSync(wfRoot)) {
      const dir = path.join(wfRoot, wf)
      try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) add(wf, path.join(dir, f))
    }
  }
  const subRoot = path.join(session, 'subagents')
  if (fs.existsSync(subRoot)) for (const f of fs.readdirSync(subRoot)) if (f.endsWith('.jsonl')) add('adhoc', path.join(subRoot, f))
  return runs
}

function usageEntries(file) {
  const out = []
  for (const ln of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!ln.trim()) continue
    let o
    try { o = JSON.parse(ln) } catch { continue }
    const u = o && o.message && o.message.usage
    if (u) out.push({
      write: u.cache_creation_input_tokens || 0,
      read: u.cache_read_input_tokens || 0,
      uncached: u.input_tokens || 0,
      output: u.output_tokens || 0,
    })
  }
  return out
}

function summarizeAgent(file) {
  const e = usageEntries(file)
  if (!e.length) return null
  const zero = { write: 0, read: 0, uncached: 0, output: 0 }
  const tot = e.reduce((a, x) => ({ write: a.write + x.write, read: a.read + x.read, uncached: a.uncached + x.uncached, output: a.output + x.output }), zero)
  return { id: path.basename(file).replace(/^agent-|\.jsonl$/g, ''), turns: e.length, first: e[0], tot }
}

function runCost(agents, pick) {
  // pick(agent) → the {write,read,uncached,output} slice to price (first request or full run)
  const z = { write: 0, read: 0, uncached: 0, output: 0 }
  const s = agents.reduce((a, ag) => { const x = pick(ag); return { write: a.write + x.write, read: a.read + x.read, uncached: a.uncached + x.uncached, output: a.output + x.output } }, z)
  const dollars = usd(s.uncached, PRICE.input) + usd(s.write, PRICE.cacheWrite) + usd(s.read, PRICE.cacheRead) + usd(s.output, PRICE.output)
  const inputTot = s.write + s.read + s.uncached
  return { ...s, inputTot, dollars }
}

function reportRun(run, files) {
  const agents = files.map(summarizeAgent).filter(Boolean)
  if (!agents.length) { console.log(`\n${run}: (no usage data)`); return }
  const first = runCost(agents, (a) => a.first)
  const full = runCost(agents, (a) => a.tot)
  const n = agents.length

  console.log(`\n━━ ${run} — ${n} agents ━━`)
  console.log(`FIRST REQUEST, per-agent average (cold start):`)
  console.log(`  shared (cache_read) ${(k(first.read / n) + '/agent').padStart(11)}   (${pct(first.read, first.inputTot)} — system+tools, shared ACROSS sibling agents)`)
  console.log(`  per-agent write     ${(k(first.write / n) + '/agent').padStart(11)}   (${pct(first.write, first.inputTot)} — incl. the profile; written per agent, NOT shared)`)
  console.log(`  per-agent uncached  ${(k(first.uncached / n) + '/agent').padStart(11)}   (${pct(first.uncached, first.inputTot)} — harness overhead, fresh per agent)`)
  console.log(`  → only the shared slice is amortized; the rest scales LINEARLY with agent count.`)
  console.log(`FULL RUN (all turns):  input ${k(full.inputTot)}  output ${k(full.output)}  →  ~$${full.dollars.toFixed(3)}`)
  return { run, agents: n, first, full }
}

function main() {
  const argv = process.argv.slice(2)
  let sessionId = null
  let filter = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--session') sessionId = argv[++i]
    else filter = argv[i]
  }

  const proj = projectDir()
  const sessions = listSessions(proj)
  if (!sessions.length) { console.log(`No sessions with subagents found under ${proj}`); return 1 }
  const session = sessionId ? sessions.find((s) => s.includes(sessionId)) : sessions[0]
  if (!session) { console.log(`Session ${sessionId} not found.`); return 1 }
  console.log(`Session: ${path.basename(session)}`)

  let runs = collectRuns(session)
  if (filter) runs = Object.fromEntries(Object.entries(runs).filter(([r]) => r.includes(filter)))
  const names = Object.keys(runs).sort()
  if (!names.length) { console.log('No matching runs.'); return 1 }

  const summaries = names.map((r) => reportRun(r, runs[r])).filter(Boolean)

  // Cross-run headline: what fraction of first-request input is currently cached, and
  // what the uncached-constant portion would cost if it became a shared cached prefix.
  if (summaries.length) {
    const agg = summaries.reduce((a, s) => ({ read: a.read + s.first.read, write: a.write + s.first.write, uncached: a.uncached + s.first.uncached, agents: a.agents + s.agents }), { read: 0, write: 0, uncached: 0, agents: 0 })
    const inputTot = agg.read + agg.write + agg.uncached
    const perAgentUnshared = (agg.write + agg.uncached) / Math.max(1, agg.agents)
    console.log(`\n══ headline (first requests across ${summaries.length} run[s], ${agg.agents} agents) ══`)
    console.log(`  shared across siblings: ${pct(agg.read, inputTot)}   ·   paid per-agent: ${pct(agg.write + agg.uncached, inputTot)}`)
    console.log(`  ~${k(perAgentUnshared)}/agent is NOT shared (profile + harness overhead). MEASURED: sibling agents share`)
    console.log(`  cache only for system+tools, never for user-message content — so the cost lever is FEWER`)
    console.log(`  agents (§4.6 cost mode / escalation ladder) and a SMALLER per-agent profile, NOT prompt ordering.`)
    console.log(`  (pricing: input $${PRICE.input} · cacheRead $${PRICE.cacheRead} · cacheWrite $${PRICE.cacheWrite} · output $${PRICE.output} /MTok — edit PRICE to match your tier)`)
  }
  return 0
}

process.exit(main())
