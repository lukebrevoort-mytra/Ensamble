export const meta = {
  name: 'review',
  description: 'Repo-aware code review built for human involvement: map the change\'s shape, fan out specialist reviewers, separate facts from judgment calls, verify the bugs, and hand back a Change Map + decisions the user owns',
  phases: [
    { title: 'Shape', detail: 'map the change: intent, structure, reading order, hotspots + risk lenses & invariants' },
    { title: 'Review', detail: 'one specialist per matched roster role / risk lens; tag findings bug | judgment | intent-question' },
    { title: 'Verify', detail: 'adversarially refute objective bugs; judgment & intent-questions pass to the human' },
    { title: 'Checks', detail: 'run canonical build/typecheck/lint/tests + invariant gate tests' },
    { title: 'Completeness', detail: 'independent critic: what did the sweep miss — uncovered file, dropped lens, unverified claim' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Repo context arrives via `args`. The script's sandbox cannot read the
// filesystem or run git (CONTRACT §4.2), so the /review command gathers all
// static repo knowledge and passes it in. The agents we spawn are NOT sandboxed
// — they read files, run `git diff`, run tests, and call MCP tools themselves.
//
// NOTE: the Workflow tool delivers `args` as a JSON STRING (verified), so parse it.
// The script must work whether args arrives as a string or an already-parsed object.
// ─────────────────────────────────────────────────────────────────────────────
const A = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {})
const profile      = (A && A.profile)      || ''            // full repo-profile.md text ('' if none)
const profileDigest = (A && A.profileDigest) || ''          // compact orientation for fan-out agents (CONTRACT §4.3); full profile reserved for synthesis roles. '' → fall back to full profile
const recon        = (A && A.recon)         || ''            // cached .workflows/recon.md text/summary
const target       = (A && A.target)        || 'current branch'
const base         = (A && A.base)          || ''            // merge-base ref, resolved by the command
const changedFiles = (A && A.changedFiles)  || []            // file paths in the diff
const commands     = (A && A.commands)      || {}            // {build,typecheck,lint,test,testScoped}
const roster       = (A && A.roster)        || []            // [{name,agentType,whenToSpawn,scope,ownsChecks}]
const invariants   = (A && A.invariants)    || []            // [{name,blastRadius,gateTest}]
const repoTools    = (A && A.tools)         || []            // tool/MCP ids agents should ToolSearch + use
const scaleArg     = (A && A.scale)         || 'auto'        // 'quick' | 'auto' | 'thorough'
const mandatory    = (A && A.mandatoryRequirements) || []    // [{requirement, appliesWhen, requiredEvidence}] — decided at install
// Human-involvement context, set by the launcher at intake (CONTRACT §4.10):
const reviewerRole = (A && A.reviewerRole)  || 'reviewer'    // 'author' (wrote it) | 'reviewer' (sent to review it)
const focus        = (A && A.focus)         || ''            // what the human asked us to scrutinize
const intent       = (A && A.intent)        || ''            // author's stated intent / what the change does & why
const outOfScope   = (A && A.outOfScope)    || ''            // known / intentional / out-of-scope — do NOT flag

// Adaptive scale (CONTRACT §4.6): lean crew for small diffs, full panel for big
// ones, and a token target — if the user set one — is a hard ceiling.
const sizeScale = changedFiles.length <= 3 ? 'quick'
                : changedFiles.length >= 20 ? 'thorough'
                : 'auto'
const scale = scaleArg === 'audit' ? 'thorough' : scaleArg === 'auto' ? sizeScale : scaleArg
// Cost mode (CONTRACT §4.6) — an orthogonal $ dial over `scale`. `scale` decides how
// MUCH to look (thoroughness); `costMode` decides how much to SPEND doing it. It shifts
// the per-agent effort (below) and the discretionary fan-out caps.
const costMode = (A && A.costMode) || 'balanced'                   // 'eco' | 'balanced' | 'max'
const VERIFY_VOTES = (scale === 'thorough' ? 3 : 1) + (costMode === 'max' ? 2 : 0)  // panel CEILING (the ladder only spends it when needed)
let LENS_CAP = scale === 'quick' ? 2 : scale === 'thorough' ? 12 : 6
if (costMode === 'eco') LENS_CAP = Math.max(1, Math.ceil(LENS_CAP / 2))
else if (costMode === 'max') LENS_CAP += 2
const budgetOk = () => !budget.total || budget.remaining() > 40_000

// Per-phase compute (CONTRACT §4.9) — effort-first tiering. The built-in defaults
// drop mechanical phases (checks) to low and raise hard-reasoning phases (shape,
// verify) to high; `phasePolicy` from the repo profile overrides per phase, and may
// pin a model only when the repo genuinely warrants it (model is never defaulted —
// absent → inherit the session model).
const phasePolicy = (A && A.phasePolicy) || {}   // { phase(lowercase): {effort, model} }
const DEFAULT_TIER = { shape: { effort: 'high' }, review: { effort: 'medium' }, verify: { effort: 'high' }, checks: { effort: 'low' }, completeness: { effort: 'high' } }
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
// A phasePolicy keyed to a phase that doesn't exist (e.g. the old "triage" name, now
// "shape") would otherwise be dropped in silence — surface the drift instead.
Object.keys(phasePolicy).forEach(k => { if (!(k in DEFAULT_TIER)) log(`phasePolicy key "${k}" matches no phase (expected: ${Object.keys(DEFAULT_TIER).join(', ')}) — ignored.`) })

// ── The standard brief (CONTRACT §4.3). EVERY agent prompt is built here so no
// subagent is "naked": each re-orients on repo context, knows its tools, and
// honors what the human told us at intake. ───────────────────────────────────
// Ordering (CONTRACT §4.3): the STATIC preamble (profile/digest, recon, tools, the human's
// run-wide context, evidence discipline) comes first; PER-AGENT text (role, scope, the
// upstream Change Map, the job) lives BELOW the ─── delimiter. The profile block is the
// DIGEST for fan-out agents and the full profile for synthesis agents (fullProfile: true) —
// and falls back to the full profile whenever no digest was supplied (no regression).
function brief({ role, scope, question, evidence, schemaNote, context, fullProfile }) {
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
    (intent || focus || outOfScope)
      ? `## What the human told us (honor this for the whole review)\n${intent ? `- Intent of the change: ${intent}\n` : ''}${focus ? `- Focus especially on: ${focus}\n` : ''}${outOfScope ? `- Out of scope / intentional — do NOT flag these: ${outOfScope}` : ''}`
      : ``,
    `## Evidence discipline (CONTRACT §3)\nTag every claim FACT ✓ (cite file:line or command output) / ASSUMPTION ~ / QUESTION ? / BLOCKED ⛔. A claim without evidence is a QUESTION, not a FACT.`,
    // ── PER-AGENT — varies, so it sits after the cacheable prefix ──────────────────
    `\n────────────────────────────────────────`,
    `You are a ${role} reviewing a code change in THIS repository. Be skeptical and concrete.`,
    ``,
    `## Orient first (do not skip)`,
    `- Read the in-scope files end-to-end: ${scope || '(resolve from the diff)'}`,
    `- Read the actual diff hunks for them: \`git diff ${base || '<merge-base>'} -- <files>\` (or \`gh pr diff\` for a PR target: ${target}).`,
    context ? `\n## Change Map (already derived upstream — reuse it, don't re-map the whole change)\n${context}` : ``,
    ``,
    `## Your single job`,
    question,
    evidence ? `\n## For this job specifically\n${evidence}` : ``,
    schemaNote || `\nReturn ONLY the object the schema requires — it is data for the orchestrator, not a message to a human.`,
  ].filter(Boolean).join('\n')
}

// ── Schemas (CONTRACT §4.7): output validated at the tool layer, retried on miss.
// SHAPE = the change map (comprehension) + risk triage, in one pass.
const SHAPE_SCHEMA = {
  type: 'object',
  // Keep the required set MINIMAL — only the lightweight routing signal the script truly
  // needs. The heavy comprehension fields (structure/narrative/hotspots/relationships/
  // subsystems/invariantsInBlastRadius) are best-effort: every consumer already defaults
  // them (`risk.structure || []`). An over-strict required set turns a 95%-complete map
  // into a hard StructuredOutput failure that aborts the WHOLE review — observed on a
  // 754-line diff, where the agent dropped `structure`, then `narrative`, blowing the
  // retry cap (5). Require only what routing can't proceed without.
  required: ['intent', 'lenses', 'rosterToSpawn'],
  properties: {
    // comprehension — the "shape" the human needs to feel oriented
    intent: { type: 'string', description: 'what this change does and why, in repo terms — one short paragraph' },
    structure: { type: 'array', items: { type: 'object', required: ['group', 'files'], properties: {
      group: { type: 'string', description: 'role of this cluster: core | callers | tests | config | docs | types | ...' },
      files: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } } } },
    relationships: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: {
      from: { type: 'string' }, to: { type: 'string' }, kind: { type: 'string', description: 'calls | tested-by | imports | configures | extends' } } } },
    narrative: { type: 'array', items: { type: 'object', required: ['step'], properties: {
      step: { type: 'string' }, where: { type: 'string', description: 'file:line to start reading this step' } } },
      description: 'ordered reading walk — how to read the change like a story' },
    hotspots: { type: 'array', items: { type: 'object', required: ['where'], properties: {
      where: { type: 'string' }, why: { type: 'string' } } }, description: 'where attention/risk concentrates' },
    // triage — risk routing (consumed downstream)
    subsystems: { type: 'array', items: { type: 'object', required: ['name', 'files'], properties: {
      name: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } } } },
    lenses: { type: 'array', items: { type: 'string' },
      description: 'risk lenses present: security, data-migration, concurrency, api-contract, performance, ui, build-release, correctness' },
    invariantsInBlastRadius: { type: 'array', items: { type: 'string' } },
    rosterToSpawn: { type: 'array', items: { type: 'string' }, description: 'roster role names whose trigger the diff matches' },
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
        description: 'bug = objective defect (gets adversarially verified); judgment = a call the human should make (structure/naming/risk-appetite); intent-question = needs the author to confirm intent before it is even a problem' },
      why: { type: 'string' }, suggestedFix: { type: 'string' }, evidence: { type: 'string' },
      needsDecision: { type: 'boolean', description: 'true for judgment & intent-question, and for high/med bugs — the human should weigh in' },
      decision: { type: 'object', description: 'the human-facing decision this finding poses', properties: {
        question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, recommendation: { type: 'string' } } } } } },
    coverageNotes: { type: 'string', description: 'what you did NOT or could not check in your lens' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', required: ['refuted', 'confidence', 'reasoning'],
  properties: { refuted: { type: 'boolean' }, confidence: { type: 'string', enum: ['high', 'med', 'low'] }, reasoning: { type: 'string' } },
}
const CHECKS_SCHEMA = {
  type: 'object', required: ['checks'],
  properties: {
    checks: { type: 'array', items: { type: 'object', required: ['name', 'command', 'result'], properties: {
      name: { type: 'string' }, command: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'blocked'] }, keyLine: { type: 'string' } } } },
    invariantGates: { type: 'array', items: { type: 'object', required: ['invariant', 'result'], properties: {
      invariant: { type: 'string' }, command: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'blocked'] }, evidence: { type: 'string' } } } },
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

// COVERAGE = the completeness critic's verdict on what the sweep MISSED (not new bugs).
const COVERAGE_SCHEMA = {
  type: 'object', required: ['gaps'],
  properties: {
    gaps: { type: 'array', items: { type: 'object', required: ['area', 'severity', 'why'], properties: {
      area: { type: 'string', description: 'what was not adequately reviewed: a changed file, subsystem, or risk lens' },
      severity: { type: 'string', enum: ['high', 'med', 'low'] },
      why: { type: 'string', description: 'why this gap matters for THIS diff — concrete, not generic' },
      recommendation: { type: 'string', description: 'how to close it: the lens to run or the check to add' } } } },
    assessment: { type: 'string', description: 'one line: is review coverage adequate to trust the verdict?' },
  },
}

// ── small helpers (no Date/Math.random — sandbox forbids them) ────────────────
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

if (!(A && A.reviewerRole)) log('No reviewerRole in args — intake likely skipped (direct scriptPath invocation?); assuming "reviewer" framing.')
log(`Reviewing ${target} as ${reviewerRole} — ${changedFiles.length} changed file(s), scale=${scale}, cost=${costMode}`)

// ── Phase 1: Shape — read the change as a whole: what it does, how it's built,
// how to read it, where the risk is, and which lenses/roster to spawn. This is
// what makes the human feel oriented (CONTRACT §4.10) — not just a risk list. ──
phase('Shape')
const risk = await agent(
  brief({
    role: 'change cartographer & risk-triage analyst',
    scope: changedFiles.join(', '),
    question: `Read the WHOLE change and produce its SHAPE so a human can understand it at a glance:\n- intent: what this change does and why, in this repo's terms (one short paragraph)${intent ? ` — the author says: "${intent}"; confirm or refine it against the actual code` : ''}.\n- structure: cluster the changed files by role (core / callers / tests / config / ...), with the relationships between clusters (calls, tested-by, imports).\n- narrative: an ordered reading walk — where to start and how to read it like a story (each step with a file:line).\n- hotspots: where attention/risk concentrates.\nThen triage risk: which risk lenses are present (security, data-migration, concurrency, api-contract, performance, ui, build-release, correctness); which of these repo invariants fall in the blast radius [${invariants.map(i => i.name).join(', ') || 'none defined'}]; which of these roster roles should review it [${roster.map(r => r.name).join(', ') || 'none defined'}]. Resolve the diff with the repo's VCS yourself (target: ${target}, base: ${base || 'merge-base with default branch'}).`,
    evidence: 'Base the shape and every lens on hunks you actually read.',
    fullProfile: true,   // synthesis: the cartographer maps the whole change — give it the full profile
  }),
  { schema: SHAPE_SCHEMA, phase: 'Shape', label: 'shape-map', ...compute('Shape') }
)
if (!risk) return { error: 'Shape mapping failed — could not read the diff. Re-run /review or confirm the target resolves to a real diff.' }

// Reuse the Shape map downstream (CONTRACT §4.3 — context threading): the cartographer
// already read the whole change, so hand its map to every lens/verifier instead of
// making each cold-read and re-derive it. Small to inject; the reading was already paid.
const changeMap = [
  risk.intent ? `Intent: ${risk.intent}` : ``,
  (risk.structure || []).length ? `Structure: ${risk.structure.map(s => `${s.group} → [${(s.files || []).join(', ')}]`).join('  ·  ')}` : ``,
  (risk.narrative || []).length ? `Reading order: ${risk.narrative.map((n, i) => `${i + 1}. ${n.step}${n.where ? ` (${n.where})` : ''}`).join('  →  ')}` : ``,
  (risk.hotspots || []).length ? `Hotspots: ${risk.hotspots.map(h => `${h.where}${h.why ? ` — ${h.why}` : ''}`).join('; ')}` : ``,
].filter(Boolean).join('\n')

// ── Build the review job list: matched roster roles (by their real agentType)
// first (CONTRACT §4.5), then generic lenses to cover what the roster misses. ──
const rosterByName = Object.fromEntries(roster.map(r => [r.name, r]))
const rosterJobs = (risk.rosterToSpawn || [])
  .map(name => rosterByName[name]).filter(Boolean)
  .map(r => ({ key: r.name, role: r.name, agentType: r.agentType || 'general-purpose', scope: r.scope || changedFiles.join(', '), owns: r.ownsChecks }))
const lensJobs = (risk.lenses || [])
  .filter(l => GENERIC_LENS[l])
  .map(l => ({ key: l, role: GENERIC_LENS[l], agentType: agentTypeForLens(l), scope: changedFiles.join(', ') }))

let jobs = dedupeBy([...rosterJobs, ...lensJobs], j => j.key)
let droppedLenses = []                                       // lenses cut by the cap — the completeness critic must know what wasn't looked at
if (jobs.length > LENS_CAP) {
  droppedLenses = jobs.slice(LENS_CAP).map(j => j.key)
  log(`Capping ${jobs.length} review lenses to ${LENS_CAP} (scale=${scale}); dropped: ${droppedLenses.join(', ')}`)
  jobs = jobs.slice(0, LENS_CAP)
}
if (!jobs.length) jobs = [{ key: 'correctness', role: GENERIC_LENS.correctness, agentType: 'general-purpose', scope: changedFiles.join(', ') }]

// Ladder instrumentation: count bugs that hit verify and how many escalated to a full
// panel, so the return can report what the escalation ladder saved vs old always-panel.
let _verifyBugs = 0, _verifyEscalated = 0

// ── Verification (CONTRACT §4.6): objective bugs get adversarially refuted to drop
// false positives. Judgment calls & intent-questions are NOT refuted — they are
// opinions/questions for the human, so they pass straight through to adjudication.
async function verifyFindings(found, job) {
  if (!found || !found.findings || !found.findings.length) return []
  const tagged = found.findings.map(f => ({ ...f, lens: f.lens || job.key }))
  // Only an EXPLICIT kind:'bug' is refutable/droppable. Everything else — judgment,
  // intent-question, or an absent/unknown kind — passes straight to the human and is
  // never silently dropped (CONTRACT §4.10: only verified objective bugs get filtered).
  const forHuman = tagged.filter(f => f.kind !== 'bug')
  const bugs = tagged.filter(f => f.kind === 'bug')
  if (!bugs.length) return forHuman
  if (!budgetOk()) {
    log(`Budget low — accepting ${job.key} bug findings without adversarial verify`)
    return [...forHuman, ...bugs.map(f => ({ ...f, verified: false, verifyVotes: 0 }))]
  }
  const PANEL = ['correctness', 'security/impact', 'does-it-actually-reproduce'] // perspective-diverse lenses
  const verifyVote = (f, lens) => agent(
    brief({
      role: `skeptical verifier (${lens} lens)`,
      scope: f.file,
      question: `Try to REFUTE this claimed bug: "${f.title}" at ${f.file}:${f.line == null ? '?' : f.line} — ${f.why}. Read the code and the diff yourself. Default to refuted=true if you cannot independently confirm it is a real problem in this repo's context.`,
      evidence: 'Confirm or refute from the actual code, not plausibility.',
      context: changeMap,
    }),
    { schema: VERDICT_SCHEMA, phase: 'Verify', label: `verify:${f.file}`, ...compute('Verify') }
  )
  // Escalation ladder (CONTRACT §4.6): one vote first. A CONFIDENT refutation drops the
  // finding cheaply (it's noise) — no panel. Anything else (it survives, or the vote is
  // low/med confidence) earns the full perspective-diverse panel before we report it. So
  // we only spend the extra votes on findings that actually warrant scrutiny. eco never
  // escalates (one vote, period); max always convenes the full panel.
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
  return [...forHuman, ...verifiedBugs]
}

// ── run canonical checks + mandatory invariant gate tests for this diff ───────
async function runChecks() {
  if (!budgetOk()) { log('Budget low — skipping check execution'); return { checks: [], invariantGates: [] } }
  const cmdList = Object.entries(commands).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
    || '(none provided; detect from CI config / package scripts / Makefile)'
  const gates = invariants.filter(i => (risk.invariantsInBlastRadius || []).includes(i.name))
  const res = await agent(
    brief({
      role: 'check runner',
      scope: changedFiles.join(', '),
      question: `Run the repo's canonical checks against the changed surface and report real output (prefer scoped/fast forms). Canonical commands:\n${cmdList}\n${gates.length ? 'MANDATORY invariant gate tests (their blast radius is touched — a passing gate is the strongest evidence the invariant held):\n' + gates.map(g => `- ${g.name}: ${g.gateTest}`).join('\n') : 'No invariant gates in blast radius.'}\nFor anything you cannot run (no creds/env), mark it blocked and say why.`,
      evidence: 'Paste the key passing/failing line for each command.',
    }),
    { schema: CHECKS_SCHEMA, phase: 'Checks', label: 'checks', ...compute('Checks') }
  )
  return res || { checks: [], invariantGates: [] }
}

// ── verify this repo's mandatory requirements were actually satisfied for this
// diff (CONTRACT §4.8 — these were decided by the user at install). Missing
// evidence is what /execute's verify loop sends back; here it gates the verdict.
async function checkRequirements() {
  if (!mandatory.length) return { requirements: [] }
  if (!budgetOk()) { log('Budget low — skipping mandatory-requirements gate'); return { requirements: [] } }
  const res = await agent(
    brief({
      role: 'mandatory-requirements gate checker',
      scope: changedFiles.join(', '),
      question: `This repo declares mandatory requirements (decided at install). For EACH: decide whether it applies to this diff (appliesWhen), then verify its required evidence was actually produced — inspect the PR/branch for it (attached screenshots, eval/sim output, cycle logs); if you can produce the evidence yourself with the repo's tools, do so. Requirements:\n${mandatory.map(m => `- ${m.requirement} — applies when: ${m.appliesWhen} — required evidence: ${m.requiredEvidence}`).join('\n')}\nMark each satisfied / unmet / blocked / n/a, each with concrete evidence or why it is missing.`,
      evidence: 'A requirement is satisfied ONLY if you can point to the concrete evidence; otherwise it is unmet.',
    }),
    { schema: REQUIREMENTS_SCHEMA, phase: 'Checks', label: 'requirements-gate', ...compute('Checks') }
  )
  return res || { requirements: [] }
}

// ── Completeness critic (CONTRACT §4 completeness-critic pattern): one INDEPENDENT
// agent that judges the sweep's COVERAGE, not its findings — what changed file no
// lens read, what present risk lens was dropped to the cap, what concern was claimed
// but never verified. A high gap on a risk-bearing diff has verdict teeth below: it
// stops a "we never looked" from masquerading as a clean APPROVE. Runs concurrently
// in the barrier (it depends on the lens list + shape, not on the findings), so it
// costs one agent and ~zero added wall-clock. Skipped only on the cheapest runs.
async function checkCompleteness() {
  if (costMode === 'eco' && scale === 'quick' && !droppedLenses.length) return { gaps: [] }
  if (!budgetOk()) { log('Budget low — skipping completeness critic'); return { gaps: [] } }
  const res = await agent(
    brief({
      role: 'review-completeness critic',
      scope: changedFiles.join(', '),
      question: `The review swept these lenses: [${jobs.map(j => j.key).join(', ')}]${droppedLenses.length ? `, and DROPPED these to a cap: [${droppedLenses.join(', ')}]` : ''}. Risk lenses the cartographer saw present in the diff: [${(risk.lenses || []).join(', ') || 'none'}]. Read the diff yourself and answer ONE question: what did this review MISS? Look for (a) a changed file or subsystem no lens actually covered, (b) a risk lens that is present but was dropped or never ran, (c) a concern claimed but never verified. Report ONLY gaps that matter for THIS diff — if coverage is adequate, return an empty gaps array. Do NOT re-review for new bugs; judge COVERAGE only.`,
      evidence: 'Name the uncovered file/lens concretely; a vague "could be more thorough" is not a gap.',
      context: changeMap,
      fullProfile: true,   // synthesis: it reasons over the whole change + the full lens list
    }),
    { schema: COVERAGE_SCHEMA, phase: 'Completeness', label: 'completeness', ...compute('Completeness') }
  )
  return res || { gaps: [] }
}

// ── Review+Verify pipeline runs concurrently with the checks + completeness critic
// (a barrier here is correct: synthesis needs them all complete). The pipeline has NO
// internal barrier — a finding verifies as soon as its lens completes (CONTRACT shape).
phase('Review')
const [reviewedNested, checkResults, reqResults, coverageResult] = await parallel([
  () => pipeline(
    jobs,
    (job) => agent(
      brief({
        role: job.role,
        scope: job.scope,
        question: `Review ONLY your lens on the changed files. For EACH finding give file:line, severity, and \`kind\`: "bug" (an objective defect), "judgment" (a call a human should make — structure, naming, risk appetite, alternative design), or "intent-question" (you need the author to confirm intent before it is even a problem). For judgment & intent-question findings, fill \`decision\` with a crisp \`question\` for the human, 2–4 \`options\`, and your \`recommendation\`, and set \`needsDecision\` true (also set it true for high/med bugs). Add \`suggestedFix\` for bugs.${job.owns ? ' You also own these checks: ' + job.owns + ' — note whether they pass.' : ''} The reader is the change's ${reviewerRole === 'author' ? 'AUTHOR — frame findings as what a reviewer will flag and where their intent matters' : 'REVIEWER deciding whether to merge — frame findings to support that decision'}. If your lens turns up nothing real, return an empty findings array — do not invent issues to look busy.`,
        evidence: 'A "finding" without a file:line and a concrete failure mode is an Open question, not a finding. Never flag anything the human marked out-of-scope / intentional.',
        context: changeMap,
      }),
      { schema: FINDINGS_SCHEMA, phase: 'Review', agentType: job.agentType, label: `review:${job.key}`, ...compute('Review') }
    ),
    (found, job) => verifyFindings(found, job)
  ),
  () => runChecks(),
  () => checkRequirements(),
  () => checkCompleteness(),
])

// ── Synthesize a SUGGESTED verdict. The launcher renders the Change Map, runs
// human adjudication on the judgment / intent-question findings, and sets the
// FINAL verdict — so this is only a starting point (CONTRACT §4.10).
const confirmed = (reviewedNested || []).flat().filter(Boolean)
const bugs = confirmed.filter(f => f.kind === 'bug')        // explicit bugs only (mirrors verifyFindings)
const decisions = confirmed.filter(f => f.kind !== 'bug')   // judgment / intent-question / unclassified → the human (clean partition, no overlap)
const sev = s => bugs.filter(f => f.severity === s)
const checks = checkResults || { checks: [], invariantGates: [] }
const failedChecks = (checks.checks || []).filter(c => c.result === 'fail')
const failedGates = (checks.invariantGates || []).filter(g => g.result === 'fail')
const reqs = (reqResults && reqResults.requirements) || []
const unmetReqs = reqs.filter(r => r.status === 'unmet')      // mandatory evidence not produced — fixable
const blockedReqs = reqs.filter(r => r.status === 'blocked')  // mandatory evidence couldn't be verified at all
const coverageGaps = (coverageResult && coverageResult.gaps) || []
const highGaps = coverageGaps.filter(g => g.severity === 'high')  // a risk lens/file the sweep never covered

let verdictSuggested
if (failedGates.length || blockedReqs.length) verdictSuggested = 'BLOCK'
else if (failedChecks.length || unmetReqs.length || sev('high').length || sev('med').length) verdictSuggested = 'REQUEST CHANGES'
// A high coverage gap can't be a clean APPROVE — "we never looked" ≠ "we looked, it's fine".
// It's not a found defect, so it stops short of REQUEST CHANGES; the human decides whether
// to run the missing lens (CONTRACT §4.10 — they own the verdict).
else if (sev('low').length || decisions.length || highGaps.length) verdictSuggested = 'APPROVE WITH NITS'
else verdictSuggested = 'APPROVE'

log(`Done — ${bugs.length} bug(s), ${decisions.length} decision(s) for the human, ${unmetReqs.length + blockedReqs.length} unmet requirement(s), ${coverageGaps.length} coverage gap(s) (${highGaps.length} high); suggested verdict: ${verdictSuggested}`)

// What the escalation ladder (§4.6) actually saved vs the old always-N-vote panel, on
// THIS run's real bug set (a deterministic counterfactual — no second run needed).
const verifyStats = {
  votesPerBug: VERIFY_VOTES,
  bugsVerified: _verifyBugs,
  escalatedToPanel: _verifyEscalated,
  shortCircuited: _verifyBugs - _verifyEscalated,
  verifyAgentsRun: _verifyBugs + _verifyEscalated * (VERIFY_VOTES - 1),
  verifyAgentsOldWay: _verifyBugs * VERIFY_VOTES,
}
verifyStats.agentsSaved = verifyStats.verifyAgentsOldWay - verifyStats.verifyAgentsRun
log(`Ladder: ${verifyStats.bugsVerified} bug(s), ${verifyStats.escalatedToPanel} escalated → ${verifyStats.verifyAgentsRun} verify agents vs ${verifyStats.verifyAgentsOldWay} old-way (saved ${verifyStats.agentsSaved})`)

return {
  target,
  scale,
  costMode,
  verifyStats,
  reviewerRole,
  verdictSuggested,
  shape: {
    intent: risk.intent || '',
    structure: risk.structure || [],
    relationships: risk.relationships || [],
    narrative: risk.narrative || [],
    hotspots: risk.hotspots || [],
  },
  riskMap: {
    subsystems: risk.subsystems || [],
    lenses: risk.lenses || [],
    invariantsInBlastRadius: risk.invariantsInBlastRadius || [],
    rosterToSpawn: risk.rosterToSpawn || [],
  },
  findings: confirmed,
  checks,
  mandatoryRequirements: reqs,
  coverageGaps,                                   // what the sweep missed (completeness critic) — the human adjudicates highs
  coverageAssessment: (coverageResult && coverageResult.assessment) || '',
  coverage: {
    lensesReviewed: jobs.map(j => j.key),
    lensesDropped: droppedLenses,
    invariantsGated: (checks.invariantGates || []).map(g => g.invariant),
    decisionsForHuman: decisions.length,
    mandatoryUnmet: unmetReqs.map(r => r.requirement),
    mandatoryBlocked: blockedReqs.map(r => r.requirement),
    coverageGapsHigh: highGaps.map(g => g.area),
    droppedToBudget: !budgetOk(),
  },
}
