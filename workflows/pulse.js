export const meta = {
  name: 'pulse',
  description: 'Daily repo health check (preventative): scan what changed since the last run (or survey the whole repo), take the repo\'s vitals, fan out specialists to find issues, adversarially refute the bugs, then synthesize a deduped morning briefing — a deterministic health score, the ONE thing worth your attention, and what is net-new vs still-open vs resolved since yesterday. Built to run headless on a schedule (the human triages async when they read it); also runs interactively as /pulse.',
  phases: [
    { title: 'Scan', detail: 'triage the delta (or survey repo hotspots): what changed, which risk lenses & invariants are in blast radius, which roster roles to spawn' },
    { title: 'Vitals', detail: 'run the repo\'s canonical checks + invariant gate tests + cheap metrics — the deterministic signal that trends over time' },
    { title: 'Assess', detail: 'one specialist per matched roster role / risk lens over the in-scope files; tag findings bug | judgment | intent-question' },
    { title: 'Verify', detail: 'adversarially refute objective bugs (escalation ladder) so the briefing carries signal, not noise' },
    { title: 'Synthesize', detail: 'dedup against the last run, score the repo deterministically, and write the briefing: one top item + net-new / still-open / resolved' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// /pulse is the ASYNC sibling of /review (CONTRACT §4.10): /review puts the human
// in the loop at RUNTIME; a scheduled pulse runs while you sleep, so it must NOT
// fabricate a verdict — it prioritizes + presents, and your morning triage
// (keep / dismiss, fed back as args.priorState) is the loop. Same engine, relocated
// human-in-the-loop.
//
// Repo context arrives via `args` — the sandbox cannot read the filesystem or run
// git (CONTRACT §4.2), so the /pulse command (or the headless runner: a cron job,
// a hosted instance) gathers all static knowledge and the prior run's state and
// passes them in. The agents we spawn are NOT sandboxed — they read files, run
// git, run tests, and call MCP tools themselves.
//
// NOTE: the Workflow tool delivers `args` as a JSON STRING (verified), so parse it;
// the script must work whether args arrives as a string or an already-parsed object.
// ─────────────────────────────────────────────────────────────────────────────
const A = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {})
const profile      = (A && A.profile)      || ''            // full repo-profile.md text ('' if none)
const profileDigest = (A && A.profileDigest) || ''          // compact orientation for fan-out agents (CONTRACT §4.3); full profile reserved for synthesis roles
const recon        = (A && A.recon)         || ''            // cached .workflows/recon.md text/summary
const scope        = (A && A.scope)         || 'since'       // 'since' (delta since last run — default) | 'repo' (whole-repo survey) | 'diff' (explicit files)
const changedFiles = (A && A.changedFiles)  || []            // files in the delta window (since/diff); the runner computes these
const sinceLabel   = (A && A.sinceLabel)    || 'the last run' // human label for the delta window, e.g. "since yesterday (a1b2c3d)"
const commands     = (A && A.commands)      || {}            // {build,typecheck,lint,test,testScoped}
const roster       = (A && A.roster)        || []            // [{name,agentType,whenToSpawn,scope,ownsChecks}]
const invariants   = (A && A.invariants)    || []            // [{name,blastRadius,gateTest}]
const repoTools    = (A && A.tools)         || []            // tool/MCP ids agents should ToolSearch + use
const mandatory    = (A && A.mandatoryRequirements) || []    // [{requirement, appliesWhen, requiredEvidence}] — decided at install
const scaleArg     = (A && A.scale)         || 'auto'        // 'quick' | 'auto' | 'thorough'
const runSlug      = (A && A.runSlug)       || 'this-run'    // date/slug for this run (the sandbox can't make one — passed in)

// Prior-run state (the dedup/trend seam). The runner fetches it (interactive: a
// .workflows/pulse-state.json; headless: a hosted store) and passes it in; we return
// the next state for the runner to persist. Shape: { runSlug, score,
// openFindings:[{key,title,file,severity,kind,firstSeen}], dismissed:[{key}] }.
const priorState   = (A && A.priorState)    || null
const priorOpen    = new Map(((priorState && priorState.openFindings) || []).map(o => [o.key, o]))
const dismissedKeys = new Set(((priorState && priorState.dismissed) || []).map(d => d.key))
const priorScore   = priorState && typeof priorState.score === 'number' ? priorState.score : null

// Adaptive scale (CONTRACT §4.6): a repo survey is a wide surface; a delta scales to
// its size. A token target — if the user set one — is a hard ceiling either way.
const sizeScale = scope === 'repo' ? 'auto'
                : changedFiles.length <= 3 ? 'quick'
                : changedFiles.length >= 20 ? 'thorough'
                : 'auto'
const scale = scaleArg === 'audit' ? 'thorough' : scaleArg === 'auto' ? sizeScale : scaleArg
// Cost mode (CONTRACT §4.6) — orthogonal $ dial over `scale`. Daily × many repos makes
// this matter: a fleet can run `eco` on the weekday delta and `max` on a weekly deep pass.
const costMode = (A && A.costMode) || 'balanced'                   // 'eco' | 'balanced' | 'max'
const VERIFY_VOTES = (scale === 'thorough' ? 3 : 1) + (costMode === 'max' ? 2 : 0)  // panel CEILING (the ladder only spends it when needed)
let LENS_CAP = scale === 'quick' ? 2 : scale === 'thorough' ? 12 : 6
if (costMode === 'eco') LENS_CAP = Math.max(1, Math.ceil(LENS_CAP / 2))
else if (costMode === 'max') LENS_CAP += 2
const budgetOk = () => !budget.total || budget.remaining() > 40_000

// Per-phase compute (CONTRACT §4.9) — effort-first tiering. Mechanical phases (vitals)
// drop to low; hard-reasoning phases (scan, verify, synthesize) run high. `phasePolicy`
// from the repo profile overrides per phase and may pin a model only when the repo
// genuinely warrants it (model is never defaulted — absent → inherit the session model).
const phasePolicy = (A && A.phasePolicy) || {}   // { phase(lowercase): {effort, model} }
const DEFAULT_TIER = { scan: { effort: 'high' }, vitals: { effort: 'low' }, assess: { effort: 'medium' }, verify: { effort: 'high' }, synthesize: { effort: 'high' } }
// Cost mode shifts the DEFAULT effort one rung (eco down / max up); an explicit profile
// pin always wins (the repo's deliberate choice beats a per-run dial — mirrors model pinning).
const EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh', 'max']
const COST_DELTA = costMode === 'eco' ? -1 : costMode === 'max' ? 1 : 0
function shiftEffort(e) {
  const i = EFFORT_LADDER.indexOf(e)
  return i < 0 ? e : EFFORT_LADDER[Math.max(0, Math.min(EFFORT_LADDER.length - 1, i + COST_DELTA))]
}
function compute(phaseName) {
  const k = phaseName.toLowerCase()
  const pol = phasePolicy[k] || {}
  const def = DEFAULT_TIER[k] || {}
  const out = {}
  const effort = pol.effort || shiftEffort(def.effort)  // pin wins; else default shifted by the cost dial
  if (effort) out.effort = effort
  if (pol.model) out.model = pol.model           // model only when the profile pins it
  return out
}
// A phasePolicy keyed to a phase that doesn't exist would otherwise be dropped in
// silence — surface the drift instead.
Object.keys(phasePolicy).forEach(k => { if (!(k in DEFAULT_TIER)) log(`phasePolicy key "${k}" matches no phase (expected: ${Object.keys(DEFAULT_TIER).join(', ')}) — ignored.`) })

// Health-score weights (CONTRACT-agnostic, repo-tunable). The score is computed
// DETERMINISTICALLY in JS — never by an agent — so the same open issues always yield
// the same number and the day-over-day trend is meaningful, not LLM jitter. Tune here.
const W = { high: 14, med: 6, low: 2, failedCheck: 14, failedGate: 18, unmetReq: 10, blockedReq: 8 }

// ── The standard brief (CONTRACT §4.3). EVERY agent prompt is built here so no
// subagent is "naked": each re-orients on repo context, knows its tools, and honors
// the run-wide context. Lifted from review.js so /pulse shares its proven DNA.
// Ordering (CONTRACT §4.3): the STATIC preamble (profile/digest, recon, tools, evidence
// discipline) comes first; PER-AGENT text (role, scope, upstream scan map, the job) lives
// BELOW the delimiter. The profile block is the DIGEST for fan-out agents and the full
// profile for synthesis agents (fullProfile: true), falling back to the full profile
// whenever no digest was supplied (no regression).
function brief({ role, scope: agentScope, question, evidence, schemaNote, context, fullProfile }) {
  const useFull = fullProfile || !profileDigest
  const profileBlock = useFull
    ? (profile
        ? `## Repo profile — ground truth (commands, invariants, conventions, "done" bar)\n<profile>\n${profile}\n</profile>`
        : `## No repo-profile.md exists\nDetect conventions from neighbouring files before asserting anything.`)
    : `## Repo orientation (digest — the essentials; synthesis agents read the full profile)\n${profileDigest}`
  return [
    // ── STATIC PREAMBLE — same for all agents this run ────────────────────────────
    profileBlock,
    recon ? `## Cached recon (stack / layout / commands)\n<recon>\n${recon}\n</recon>` : ``,
    repoTools.length
      ? `## Use this repo's tools\nFor real evidence (not guesses) you may use: ${repoTools.join(', ')}. Load any you need with ToolSearch ("select:<name>") before calling it.`
      : ``,
    `## Evidence discipline (CONTRACT §3)\nTag every claim FACT ✓ (cite file:line or command output) / ASSUMPTION ~ / QUESTION ? / BLOCKED ⛔. A claim without evidence is a QUESTION, not a FACT.`,
    // ── PER-AGENT — varies, so it sits after the cacheable prefix ──────────────────
    `\n────────────────────────────────────────`,
    `You are a ${role} examining the health of THIS repository. Be skeptical and concrete; this feeds a daily health briefing an engineer reads first thing — false alarms erode trust, so only surface what you can stand behind.`,
    ``,
    `## Orient first (do not skip)`,
    `- Read the in-scope files end-to-end: ${agentScope || '(resolve from the scan)'}`,
    `- Read the actual recent history yourself: \`git log\`/\`git diff\` for the delta window, or the current file contents for a whole-repo survey.`,
    context ? `\n## Scan map (already derived upstream — reuse it, don't re-survey the whole repo)\n${context}` : ``,
    ``,
    `## Your single job`,
    question,
    evidence ? `\n## For this job specifically\n${evidence}` : ``,
    schemaNote || `\nReturn ONLY the object the schema requires — it is data for the orchestrator, not a message to a human.`,
  ].filter(Boolean).join('\n')
}

// ── Schemas (CONTRACT §4.7): output validated at the tool layer, retried on miss. ──
// SCAN = the health-framed triage: what's happening + risk routing, in one pass.
const SCAN_SCHEMA = {
  type: 'object',
  // Keep the required set MINIMAL — only the routing signal the script can't proceed
  // without (mirrors review.js's lesson: an over-strict required set turns a 95%-complete
  // map into a hard failure that aborts the whole run). Everything else is best-effort.
  required: ['summary', 'lenses', 'rosterToSpawn'],
  properties: {
    summary: { type: 'string', description: 'state of the repo / recent activity in this repo\'s terms — one short paragraph a human can read at a glance' },
    focusFiles: { type: 'array', items: { type: 'string' },
      description: 'the files most worth assessing. For a whole-repo survey, YOU pick these (the hotspots: most-churned / most-complex / security-sensitive / largest); for a delta, the changed files. Cap ~12.' },
    hotspots: { type: 'array', items: { type: 'object', required: ['where'], properties: {
      where: { type: 'string' }, why: { type: 'string' } } }, description: 'where attention/risk concentrates right now' },
    lenses: { type: 'array', items: { type: 'string' },
      description: 'risk lenses in play: security, data-migration, concurrency, api-contract, performance, ui, build-release, correctness' },
    invariantsInBlastRadius: { type: 'array', items: { type: 'string' } },
    rosterToSpawn: { type: 'array', items: { type: 'string' }, description: 'roster role names whose trigger the current state matches' },
    notes: { type: 'string' },
  },
}
const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: { type: 'array', items: { type: 'object', required: ['title', 'file', 'severity', 'why', 'kind'], properties: {
      title: { type: 'string' }, file: { type: 'string' }, line: { type: ['integer', 'null'] },
      severity: { type: 'string', enum: ['high', 'med', 'low'] }, lens: { type: 'string' },
      kind: { type: 'string', enum: ['bug', 'judgment', 'intent-question'],
        description: 'bug = objective defect (gets adversarially verified); judgment = a call worth a human\'s attention (structure/naming/risk-appetite); intent-question = needs intent confirmed before it is even a problem' },
      why: { type: 'string' }, suggestedFix: { type: 'string' }, evidence: { type: 'string' } } } },
    coverageNotes: { type: 'string', description: 'what you did NOT or could not check in your lens' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', required: ['refuted', 'confidence', 'reasoning'],
  properties: { refuted: { type: 'boolean' }, confidence: { type: 'string', enum: ['high', 'med', 'low'] }, reasoning: { type: 'string' } },
}
const VITALS_SCHEMA = {
  type: 'object', required: ['checks'],
  properties: {
    checks: { type: 'array', items: { type: 'object', required: ['name', 'command', 'result'], properties: {
      name: { type: 'string' }, command: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'blocked'] }, keyLine: { type: 'string' } } } },
    invariantGates: { type: 'array', items: { type: 'object', required: ['invariant', 'result'], properties: {
      invariant: { type: 'string' }, command: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'blocked'] }, evidence: { type: 'string' } } } },
    metrics: { type: 'array', items: { type: 'object', required: ['name', 'value'], properties: {
      name: { type: 'string', description: 'e.g. test coverage, dependency freshness, TODO/FIXME count, test count, profile staleness' },
      value: { type: 'string' }, trend: { type: 'string', description: 'better | worse | flat | unknown vs the usual', enum: ['better', 'worse', 'flat', 'unknown'] }, note: { type: 'string' } } },
      description: 'cheap, glanceable signals — gathered from real commands/inspection, not guessed' },
  },
}
const REQUIREMENTS_SCHEMA = {
  type: 'object', required: ['requirements'],
  properties: {
    requirements: { type: 'array', items: { type: 'object', required: ['requirement', 'status'], properties: {
      requirement: { type: 'string' }, applies: { type: 'boolean' },
      status: { type: 'string', enum: ['satisfied', 'unmet', 'blocked', 'n/a'] }, evidence: { type: 'string' } } } },
  },
}
// BRIEFING = the morning read. The agent ORDERS and NARRATES findings we already verified
// and picks the one headline; it does NOT invent findings or recompute the score (passed in).
const BRIEFING_SCHEMA = {
  type: 'object', required: ['state', 'prioritized'],
  properties: {
    allClear: { type: 'boolean', description: 'true if nothing needs the engineer today (no open issues, vitals green)' },
    headline: { type: 'object', description: 'the ONE thing to look at first (omit on an all-clear day)', properties: {
      ref: { type: 'string', description: 'the finding id (e.g. F3) this headline is about, or "vitals" for a failed check/gate' },
      title: { type: 'string' }, file: { type: 'string' }, severity: { type: 'string', enum: ['high', 'med', 'low'] },
      why: { type: 'string', description: 'why THIS is the thing to look at first, in this repo\'s terms' } } },
    state: { type: 'string', description: '2–3 sentence state-of-the-repo an engineer reads in five seconds' },
    prioritized: { type: 'array', items: { type: 'object', required: ['ref'], properties: {
      ref: { type: 'string', description: 'the finding id (e.g. F3)' }, oneLine: { type: 'string', description: 'one-line "what & why it matters" for the digest' } } },
      description: 'ALL given findings, ordered by what matters this morning (most important first), by id' },
  },
}

// ── small helpers (no Date/Math.random — the sandbox forbids them) ────────────
function dedupeBy(arr, keyFn) { const seen = new Set(); return arr.filter(x => { const k = keyFn(x); if (seen.has(k)) return false; seen.add(k); return true }) }
function agentTypeForLens(lens) { return lens === 'ui' ? 'uiux' : 'general-purpose' }
const GENERIC_LENS = {
  security: 'security reviewer (authz, secrets, injection, deserialization, SSRF)',
  'data-migration': 'data-integrity & migration-safety reviewer',
  concurrency: 'race/ordering reviewer (shared state, locking, async)',
  'api-contract': 'compatibility & contract reviewer (public/exported surface)',
  performance: 'performance reviewer (hot paths, N+1, large data)',
  ui: 'UX + accessibility reviewer',
  'build-release': 'build/release-safety reviewer',
  correctness: 'correctness reviewer (logic, edge cases, error handling)',
}
// Stable-ish dedup key so the same issue is recognised across runs (net-new vs still-open)
// and a dismissed issue never nags twice. file + lens + a slug of the first words of the
// title — resilient to line drift and minor rewording. (A fuzzy/embedding match is the
// production upgrade; this is the honest v1.)
function findingKey(f) {
  const slug = (f.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 8).join('-')
  return `${f.file || '?'}::${f.lens || '?'}::${slug}`
}

log(`Pulse on ${scope === 'repo' ? 'the whole repo' : `${changedFiles.length} changed file(s) ${sinceLabel}`} — scale=${scale}, cost=${costMode}${priorState ? `, prior score ${priorScore}` : ', no prior run (first pulse)'}`)

// ── Phase 1: Scan — triage the current state: what's happening, where the risk is,
// and which lenses/roster to spawn. For a delta we get the changed files; for a
// whole-repo survey the scanner picks the hotspots itself. ────────────────────
const scopeBrief = scope === 'repo'
  ? `There is no delta window — survey the WHOLE repo's health. Using git history and file inspection, identify the hotspots (most-churned, most-complex, security-sensitive, largest, or weakest-tested) and return them in focusFiles (cap ~12) — these are what the specialists will assess. Summarise the repo's current state.`
  : `Assess the health impact of recent activity. Files changed ${sinceLabel}: ${changedFiles.join(', ') || '(none reported — fall back to a light whole-repo glance)'}. Read the actual recent commits/diff yourself and summarise what changed and whether it looks healthy. Put the files most worth a closer look in focusFiles.`

phase('Scan')
const scan = await agent(
  brief({
    role: 'repo health scanner & risk-triage analyst',
    scope: scope === 'repo' ? '(survey — you choose the hotspots)' : changedFiles.join(', '),
    question: `${scopeBrief}\nThen triage risk: which risk lenses are in play (security, data-migration, concurrency, api-contract, performance, ui, build-release, correctness); which of these repo invariants fall in the blast radius [${invariants.map(i => i.name).join(', ') || 'none defined'}]; which of these roster roles should look [${roster.map(r => r.name).join(', ') || 'none defined'}]. Base everything on code/history you actually read.`,
    evidence: 'Ground the summary and every lens in real history/files, not plausibility.',
    fullProfile: true,   // synthesis: the scanner needs the whole picture to judge what matters for THIS repo
  }),
  { schema: SCAN_SCHEMA, phase: 'Scan', label: 'scan-map', ...compute('Scan') }
)
if (!scan) return { error: 'Scan failed — could not read the repo/delta. Re-run /pulse or confirm the scope resolves to real files.' }

const scopeFiles = (scan.focusFiles && scan.focusFiles.length) ? scan.focusFiles : changedFiles
// Reuse the scan downstream (CONTRACT §4.3 — context threading): the scanner already
// read the change/repo, so hand its map to every lens/verifier instead of re-surveying.
const scanContext = [
  scan.summary ? `State: ${scan.summary}` : ``,
  (scan.hotspots || []).length ? `Hotspots: ${scan.hotspots.map(h => `${h.where}${h.why ? ` — ${h.why}` : ''}`).join('; ')}` : ``,
  scopeFiles.length ? `In scope: ${scopeFiles.join(', ')}` : ``,
].filter(Boolean).join('\n')

// ── Build the assessment job list: matched roster roles (by their real agentType)
// first (CONTRACT §4.5), then generic lenses to cover what the roster misses. ──
const rosterByName = Object.fromEntries(roster.map(r => [r.name, r]))
const rosterJobs = (scan.rosterToSpawn || [])
  .map(name => rosterByName[name]).filter(Boolean)
  .map(r => ({ key: r.name, role: r.name, agentType: r.agentType || 'general-purpose', scope: r.scope || scopeFiles.join(', '), owns: r.ownsChecks }))
const lensJobs = (scan.lenses || [])
  .filter(l => GENERIC_LENS[l])
  .map(l => ({ key: l, role: GENERIC_LENS[l], agentType: agentTypeForLens(l), scope: scopeFiles.join(', ') }))

let jobs = dedupeBy([...rosterJobs, ...lensJobs], j => j.key)
if (jobs.length > LENS_CAP) {
  log(`Capping ${jobs.length} assessment lenses to ${LENS_CAP} (scale=${scale}); dropped: ${jobs.slice(LENS_CAP).map(j => j.key).join(', ')}`)
  jobs = jobs.slice(0, LENS_CAP)
}
if (!jobs.length) jobs = [{ key: 'correctness', role: GENERIC_LENS.correctness, agentType: 'general-purpose', scope: scopeFiles.join(', ') }]

// Ladder instrumentation (a showcase metric): how many bugs hit verify and how many
// escalated to a full panel — so the return can report what the escalation ladder saved.
let _verifyBugs = 0, _verifyEscalated = 0

// ── Verification (CONTRACT §4.6): objective bugs get adversarially refuted to drop
// false positives — critical here, since a noisy daily briefing gets muted in a week.
// Judgment calls & intent-questions are NOT refuted; they pass through as advisory.
async function verifyFindings(found, job) {
  if (!found || !found.findings || !found.findings.length) return []
  const tagged = found.findings.map(f => ({ ...f, lens: f.lens || job.key }))
  const advisory = tagged.filter(f => f.kind !== 'bug')   // judgment / intent-question / unknown → listed, never refuted/dropped
  const bugs = tagged.filter(f => f.kind === 'bug')
  if (!bugs.length) return advisory
  if (!budgetOk()) {
    log(`Budget low — accepting ${job.key} bug findings without adversarial verify`)
    return [...advisory, ...bugs.map(f => ({ ...f, verified: false, verifyVotes: 0 }))]
  }
  const PANEL = ['correctness', 'security/impact', 'does-it-actually-reproduce'] // perspective-diverse lenses
  const verifyVote = (f, lens) => agent(
    brief({
      role: `skeptical verifier (${lens} lens)`,
      scope: f.file,
      question: `Try to REFUTE this claimed issue: "${f.title}" at ${f.file}:${f.line == null ? '?' : f.line} — ${f.why}. Read the code yourself. Default to refuted=true if you cannot independently confirm it is a real problem in this repo's context (a daily briefing must not cry wolf).`,
      evidence: 'Confirm or refute from the actual code, not plausibility.',
      context: scanContext,
    }),
    { schema: VERDICT_SCHEMA, phase: 'Verify', label: `verify:${f.file}`, ...compute('Verify') }
  )
  // Escalation ladder (CONTRACT §4.6): one vote first. A CONFIDENT refutation drops the
  // finding cheaply (it's noise) — no panel. Anything else earns the full perspective-
  // diverse panel before it reaches the briefing. eco never escalates; max always does.
  const verifiedBugs = (await parallel(bugs.map(f => async () => {
    _verifyBugs++
    const first = await verifyVote(f, VERIFY_VOTES > 1 ? PANEL[0] : 'refutation')
    let live = [first].filter(Boolean)
    const confidentlyRefuted = first && first.refuted && first.confidence === 'high'
    const wantPanel = VERIFY_VOTES > 1 && costMode !== 'eco' && (costMode === 'max' || !confidentlyRefuted)
    if (wantPanel) {
      _verifyEscalated++
      const rest = await parallel(Array.from({ length: VERIFY_VOTES - 1 }, (_, k) => () => verifyVote(f, PANEL[(k + 1) % PANEL.length])))
      live = [...live, ...rest.filter(Boolean)]
    }
    const survives = live.length > 0 && live.filter(v => !v.refuted).length >= Math.ceil(live.length / 2)
    return survives ? { ...f, verified: true, verifyVotes: live.length } : null
  }))).filter(Boolean)
  return [...advisory, ...verifiedBugs]
}

// ── Vitals: run the repo's canonical checks + invariant gate tests + cheap metrics.
// This is the DETERMINISTIC layer that trends over time — the "score moved" signal.
async function runVitals() {
  if (!budgetOk()) { log('Budget low — skipping vitals execution'); return { checks: [], invariantGates: [], metrics: [] } }
  const cmdList = Object.entries(commands).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
    || '(none provided; detect from CI config / package scripts / Makefile)'
  const gates = invariants.filter(i => (scan.invariantsInBlastRadius || []).includes(i.name))
  const res = await agent(
    brief({
      role: 'vitals & metrics runner',
      scope: scopeFiles.join(', '),
      question: `Take this repo's vitals and report REAL output (prefer fast/scoped forms). Run the canonical checks:\n${cmdList}\n${gates.length ? 'Plus these invariant gate tests (their blast radius is in play):\n' + gates.map(g => `- ${g.name}: ${g.gateTest}`).join('\n') : 'No invariant gates in the current blast radius.'}\nThen gather a few CHEAP, glanceable metrics with real commands — e.g. test coverage if available, dependency freshness (outdated/vulnerable deps), a TODO/FIXME count, and whether repo-profile.md looks stale vs the code. For anything you cannot run (no creds/env), mark it blocked and say why. Do NOT guess a number — omit a metric you can't measure.`,
      evidence: 'Paste the key passing/failing line for each command; every metric must come from a command you ran.',
    }),
    { schema: VITALS_SCHEMA, phase: 'Vitals', label: 'vitals', ...compute('Vitals') }
  )
  return res || { checks: [], invariantGates: [], metrics: [] }
}

// ── Mandatory-requirements gate (CONTRACT §4.8) — only meaningful on a delta (a specific
// change to hold to its non-negotiables); skipped on a whole-repo survey.
async function checkRequirements() {
  if (!mandatory.length || scope === 'repo' || !changedFiles.length) return { requirements: [] }
  if (!budgetOk()) { log('Budget low — skipping mandatory-requirements gate'); return { requirements: [] } }
  const res = await agent(
    brief({
      role: 'mandatory-requirements gate checker',
      scope: changedFiles.join(', '),
      question: `This repo declares mandatory requirements (decided at install). For EACH: decide whether it applies to the recent change (appliesWhen), then verify its required evidence was actually produced — inspect the commits/branch for it (screenshots, eval/sim output, cycle logs). Requirements:\n${mandatory.map(m => `- ${m.requirement} — applies when: ${m.appliesWhen} — required evidence: ${m.requiredEvidence}`).join('\n')}\nMark each satisfied / unmet / blocked / n/a with concrete evidence or why it is missing.`,
      evidence: 'A requirement is satisfied ONLY if you can point to the concrete evidence; otherwise it is unmet.',
    }),
    { schema: REQUIREMENTS_SCHEMA, phase: 'Vitals', label: 'requirements-gate', ...compute('Vitals') }
  )
  return res || { requirements: [] }
}

// ── Assess + Verify pipeline runs concurrently with vitals + the requirements gate
// (a barrier here is correct: synthesis needs all of them). The pipeline has NO
// internal barrier — a finding verifies as soon as its lens completes. ─────────
phase('Assess')
const [assessedNested, vitals, reqResults] = await parallel([
  () => pipeline(
    jobs,
    (job) => agent(
      brief({
        role: job.role,
        scope: job.scope,
        question: `Examine ONLY your lens on the in-scope files and report what affects this repo's HEALTH. For EACH finding give file:line, severity, and \`kind\`: "bug" (an objective defect — these get adversarially verified before they reach the briefing), "judgment" (a call worth a human's attention — structure, naming, risk, tech-debt), or "intent-question" (you'd need to confirm intent first). Add \`suggestedFix\` for bugs.${job.owns ? ' You also own these checks: ' + job.owns + ' — note whether they pass.' : ''} If your lens turns up nothing real, return an empty findings array — do NOT invent issues to look busy (a daily briefing lives or dies on signal-to-noise).`,
        evidence: 'A "finding" without a file:line and a concrete failure mode is a QUESTION, not a finding.',
        context: scanContext,
      }),
      { schema: FINDINGS_SCHEMA, phase: 'Assess', agentType: job.agentType, label: `assess:${job.key}`, ...compute('Assess') }
    ),
    (found, job) => verifyFindings(found, job)
  ),
  () => runVitals(),
  () => checkRequirements(),
])

// ── Dedup against the last run (CONTRACT §4.10 relocated to async): net-new vs still-open
// vs resolved, with dismissed issues filtered so they never nag twice. Plain JS — set math,
// not an agent. ───────────────────────────────────────────────────────────────
const confirmed = (assessedNested || []).flat().filter(Boolean)
const seenThisRun = new Set()
const keyed = confirmed
  .map(f => ({ ...f, key: findingKey(f) }))
  .filter(f => !dismissedKeys.has(f.key))            // never re-surface what the human dismissed
  .filter(f => (seenThisRun.has(f.key) ? false : (seenThisRun.add(f.key), true)))  // collapse intra-run dupes across lenses
  .map(f => ({ ...f, status: priorOpen.has(f.key) ? 'still-open' : 'net-new', firstSeen: (priorOpen.get(f.key) || {}).firstSeen || runSlug }))
keyed.forEach((f, i) => { f.id = `F${i + 1}` })       // stable id for the briefing agent to reference
const currentKeys = new Set(keyed.map(f => f.key))
const netNew   = keyed.filter(f => f.status === 'net-new')
const stillOpen = keyed.filter(f => f.status === 'still-open')
// Resolved = was open last run, isn't now, wasn't dismissed → it got fixed. Worth celebrating.
const resolved = (((priorState && priorState.openFindings) || [])
  .filter(o => !currentKeys.has(o.key) && !dismissedKeys.has(o.key)))

// ── Deterministic health score (never an agent — so the trend is real). Open verified
// bugs + failed vitals + unmet mandatory evidence. Clamped to [0,100]. ─────────
const bugs = keyed.filter(f => f.kind === 'bug')        // verified objective defects (net-new + still-open)
const advisory = keyed.filter(f => f.kind !== 'bug')    // judgment / intent-question — advisory, don't tank the score
const sev = s => bugs.filter(f => f.severity === s).length
const v = vitals || { checks: [], invariantGates: [], metrics: [] }
const failedChecks = (v.checks || []).filter(c => c.result === 'fail')
const failedGates  = (v.invariantGates || []).filter(g => g.result === 'fail')
const reqs = (reqResults && reqResults.requirements) || []
const unmetReqs   = reqs.filter(r => r.status === 'unmet')
const blockedReqs = reqs.filter(r => r.status === 'blocked')
let score = 100
  - W.high * sev('high') - W.med * sev('med') - W.low * sev('low')
  - W.failedCheck * failedChecks.length - W.failedGate * failedGates.length
  - W.unmetReq * unmetReqs.length - W.blockedReq * blockedReqs.length
score = Math.max(0, Math.min(100, Math.round(score)))
const scoreDelta = priorScore == null ? null : score - priorScore

// ── Phase 5: Synthesize the briefing. The agent ORDERS + NARRATES what we verified and
// picks the one headline; it does not invent findings or recompute the score. ──
phase('Synthesize')
const findingsForBrief = keyed.length
  ? keyed.map(f => `${f.id} [${f.severity}/${f.kind}/${f.status}] ${f.file}${f.line != null ? ':' + f.line : ''} — ${f.title}${f.why ? ` — ${f.why}` : ''}`).join('\n')
  : '(no open findings)'
const vitalsForBrief = [
  (v.checks || []).length ? `Checks: ${v.checks.map(c => `${c.name}=${c.result}`).join(', ')}` : '',
  (v.invariantGates || []).length ? `Gates: ${v.invariantGates.map(g => `${g.invariant}=${g.result}`).join(', ')}` : '',
  (v.metrics || []).length ? `Metrics: ${v.metrics.map(m => `${m.name}=${m.value}${m.trend && m.trend !== 'unknown' ? `(${m.trend})` : ''}`).join(', ')}` : '',
  unmetReqs.length ? `Unmet mandatory: ${unmetReqs.map(r => r.requirement).join('; ')}` : '',
].filter(Boolean).join('\n') || '(no vitals gathered)'

const briefing = await agent(
  brief({
    role: 'health briefing synthesizer',
    scope: scopeFiles.join(', '),
    question: [
      `Write the morning health briefing an engineer reads first thing. You are given the ALREADY-VERIFIED findings (ids F1…), the vitals, and the DETERMINISTICALLY-computed health score — do NOT invent findings or recompute the score; order and narrate what's here.`,
      ``,
      `Health score: ${score}/100${scoreDelta == null ? ' (first run — no trend yet)' : ` (${scoreDelta >= 0 ? '+' : ''}${scoreDelta} vs last run's ${priorScore})`}.`,
      `Open findings (${keyed.length}): ${netNew.length} net-new, ${stillOpen.length} still-open. Resolved since last run: ${resolved.length}.`,
      ``,
      `Findings:\n${findingsForBrief}`,
      ``,
      `Vitals:\n${vitalsForBrief}`,
      ``,
      `Produce: (1) headline — the ONE thing to look at first (its finding id, or "vitals" for a failed check/gate), and WHY it matters most in THIS repo's terms (use the profile: a failing safety gate or an issue on a critical surface outranks a cosmetic nit). On an all-clear day (no open findings, vitals green) set allClear=true and omit the headline. (2) state — 2–3 sentences an engineer reads in five seconds. (3) prioritized — EVERY given finding id, ordered by what matters this morning, each with a one-line "what & why".`,
    ].join('\n'),
    evidence: 'Rank by real impact in this repo, not severity labels alone. Be calm and concrete — this is a daily read, not an alarm.',
    fullProfile: true,   // synthesis: judging "what matters for THIS repo" needs the whole profile
  }),
  { schema: BRIEFING_SCHEMA, phase: 'Synthesize', label: 'briefing', ...compute('Synthesize') }
) || { state: keyed.length ? 'Findings gathered; synthesis unavailable — see the prioritized list.' : 'All clear.', prioritized: keyed.map(f => ({ ref: f.id, oneLine: f.title })), allClear: !keyed.length && !failedChecks.length && !failedGates.length }

// Re-order the full findings by the briefing's priority (fall back to the keyed order
// for any id the agent dropped), so the command renders them most-important-first.
const byId = Object.fromEntries(keyed.map(f => [f.id, f]))
const orderedIds = (briefing.prioritized || []).map(p => p.ref).filter(id => byId[id])
const oneLineById = Object.fromEntries((briefing.prioritized || []).map(p => [p.ref, p.oneLine]))
const prioritizedFindings = [
  ...orderedIds.map(id => ({ ...byId[id], oneLine: oneLineById[id] || '' })),
  ...keyed.filter(f => !orderedIds.includes(f.id)),   // any the agent didn't rank, appended
]

// ── The next state for the runner to persist (the dedup/trend seam). Carries the
// current open set + the dismissed list forward; firstSeen lets the UI show "open 3 days".
const newState = {
  runSlug,
  score,
  openFindings: keyed.map(f => ({ key: f.key, id: f.id, title: f.title, file: f.file, line: f.line == null ? null : f.line, severity: f.severity, kind: f.kind, firstSeen: f.firstSeen })),
  dismissed: ((priorState && priorState.dismissed) || []),   // the command appends to this when the human dismisses
}

// What the escalation ladder (§4.6) saved vs an always-N-vote panel, on this run's real
// bug set (a deterministic counterfactual — a showcase number, no second run needed).
const verifyStats = {
  votesPerBug: VERIFY_VOTES,
  bugsVerified: _verifyBugs,
  escalatedToPanel: _verifyEscalated,
  shortCircuited: _verifyBugs - _verifyEscalated,
  verifyAgentsRun: _verifyBugs + _verifyEscalated * (VERIFY_VOTES - 1),
  verifyAgentsOldWay: _verifyBugs * VERIFY_VOTES,
}
verifyStats.agentsSaved = verifyStats.verifyAgentsOldWay - verifyStats.verifyAgentsRun

log(`Pulse done — score ${score}${scoreDelta == null ? '' : ` (${scoreDelta >= 0 ? '+' : ''}${scoreDelta})`}; ${netNew.length} net-new, ${stillOpen.length} still-open, ${resolved.length} resolved; ${failedChecks.length} failed check(s), ${failedGates.length} failed gate(s), ${unmetReqs.length} unmet requirement(s)`)

return {
  scope,
  scale,
  costMode,
  runSlug,
  verifyStats,
  // headline + score: the glanceable top of the briefing
  score,
  scoreDelta,
  prevScore: priorScore,
  isFirstRun: !priorState,
  headline: briefing.headline || null,
  state: briefing.state || '',
  allClear: !!briefing.allClear,
  // the deduped findings, ordered for the read
  findings: prioritizedFindings,
  netNew,
  stillOpen,
  resolved,
  advisoryCount: advisory.length,
  // the deterministic vitals layer
  vitals: { checks: v.checks || [], invariantGates: v.invariantGates || [], metrics: v.metrics || [] },
  mandatoryRequirements: reqs,
  scan: { summary: scan.summary || '', hotspots: scan.hotspots || [], lenses: scan.lenses || [], invariantsInBlastRadius: scan.invariantsInBlastRadius || [], focusFiles: scopeFiles },
  // the seam the runner persists for tomorrow's dedup/trend
  newState,
  coverage: {
    lensesAssessed: jobs.map(j => j.key),
    invariantsGated: (v.invariantGates || []).map(g => g.invariant),
    scoreWeights: W,
    mandatoryUnmet: unmetReqs.map(r => r.requirement),
    mandatoryBlocked: blockedReqs.map(r => r.requirement),
    droppedToBudget: !budgetOk(),
  },
}
