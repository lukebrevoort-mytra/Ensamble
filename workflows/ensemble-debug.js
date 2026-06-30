export const meta = {
  name: 'ensemble-debug',
  description: 'Diagnose a bug from a bug report: locate it and form ranked root-cause hypotheses, ALWAYS try to reproduce it with real failing evidence, fan out one investigator per hypothesis grounded in that evidence, adversarially confirm the leading diagnosis, and hand back a documented root cause + an evidence-backed route to a fix (it diagnoses; it does not fix)',
  phases: [
    { title: 'Locate', detail: 'read the bug report + repo: affected areas, ranked root-cause hypotheses, and how to reproduce it' },
    { title: 'Reproduce', detail: 'ALWAYS attempt to recreate the bug — build a minimal failing repro and capture the actual failure (stack/assertion/wrong output)' },
    { title: 'Investigate', detail: 'one investigator per hypothesis, each grounded in the reproduction evidence; trace the root cause to file:line + a fix route' },
    { title: 'Verify', detail: 'adversarially refute the leading diagnosis — does the root cause actually explain the reproduced failure?' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Repo context arrives via `args`. The script's sandbox cannot read the
// filesystem or run git (CONTRACT §4.2), so the /ensemble-debug command gathers all
// static repo knowledge and passes it in. The agents we spawn are NOT sandboxed
// — they read files, run the repo's tests, reproduce the bug, and call MCP tools.
//
// NOTE: the Workflow tool delivers `args` as a JSON STRING (verified), so parse it.
// The script must work whether args arrives as a string or an already-parsed object.
// ─────────────────────────────────────────────────────────────────────────────
const A = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {})
const profile      = (A && A.profile)       || ''           // full repo-profile.md text ('' if none)
const profileDigest = (A && A.profileDigest) || ''          // compact orientation for fan-out agents (CONTRACT §4.3); full profile reserved for synthesis roles. '' → fall back to full profile
const recon        = (A && A.recon)         || ''           // cached .workflows/recon.md text/summary
const bugReport    = (A && A.bugReport)     || ''           // THE INPUT: the bug report (free text — symptom, repro steps, env, logs)
const commands     = (A && A.commands)      || {}           // {build,typecheck,lint,test,testScoped}
const roster       = (A && A.roster)        || []           // [{name,agentType,whenToSpawn,scope,ownsChecks}]
const repoTools    = (A && A.tools)         || []           // tool/MCP ids agents should ToolSearch + use
const agentTypes   = (A && A.agentTypes)    || {}
const debugger_    = agentTypes.debugger || 'oracle'        // deep root-cause reasoning over code (read-only is fine — CONTRACT §4.5); default oracle, used for Investigate
// Reproduction must WRITE and RUN a failing test/script, so it needs a write-capable
// agent — NOT the read-only oracle. Prefer the repo's coder; else omit agentType to get
// the full-tool default workflow agent (Write/Edit/Bash/MCP). This is why Reproduce and
// Investigate intentionally use different agent types.
const reproType    = agentTypes.coder || ''
const scaleArg     = (A && A.scale)         || 'auto'       // 'quick' | 'auto' | 'thorough' | 'audit'

// Adaptive scale (CONTRACT §4.6): fewer hypotheses for an obvious bug, the full set
// for a murky one; a token target — if set — is a hard ceiling.
const scale = scaleArg === 'audit' ? 'thorough' : scaleArg
// Cost mode (CONTRACT §4.6) — an orthogonal $ dial over `scale`. `scale` decides how
// MANY hypotheses to chase; `costMode` decides how much to SPEND chasing each. It shifts
// the per-agent effort (below) and the hypothesis cap.
const costMode = (A && A.costMode) || 'balanced'                  // 'eco' | 'balanced' | 'max'
const VERIFY_VOTES = (scale === 'thorough' ? 3 : 1) + (costMode === 'max' ? 2 : 0)  // panel CEILING (the ladder only spends it when needed)
let HYP_CAP = scale === 'quick' ? 2 : scale === 'thorough' ? 5 : 3 // how many hypotheses get an investigator
if (costMode === 'eco') HYP_CAP = Math.max(1, Math.ceil(HYP_CAP / 2))
else if (costMode === 'max') HYP_CAP += 2
// At thorough scale, try more reproduction strategies in parallel; the FIRST that
// reproduces wins. Reproduction itself ALWAYS runs (see below) — only its breadth scales.
const REPRO_STRATEGIES = scale === 'thorough' ? (costMode === 'eco' ? 2 : 3) : 1
const budgetOk = () => !budget.total || budget.remaining() > 40_000

// Per-phase compute (CONTRACT §4.9) — effort-first tiering. Reproduction and root-cause
// reasoning are the hard, central work (high); locating is moderate mapping. `phasePolicy`
// from the repo profile overrides per phase and may pin a model only when the repo
// genuinely warrants it (model is never defaulted — absent → inherit the session model).
const phasePolicy = (A && A.phasePolicy) || {}   // { phase(lowercase): {effort, model} }
const DEFAULT_TIER = { locate: { effort: 'medium' }, reproduce: { effort: 'high' }, investigate: { effort: 'high' }, verify: { effort: 'high' } }
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
// silence — surface the typo/drift instead of ignoring it.
Object.keys(phasePolicy).forEach(k => { if (!(k in DEFAULT_TIER)) log(`phasePolicy key "${k}" matches no phase (expected: ${Object.keys(DEFAULT_TIER).join(', ')}) — ignored.`) })

// ── The standard brief (CONTRACT §4.3). EVERY agent prompt is built here so no
// subagent is "naked": each re-orients on repo context, knows its tools, and is
// anchored to the ONE bug we're chasing (run-wide human context — like /ensemble-review's
// intent/focus, this stays constant for the whole run). ───────────────────────
// Ordering (CONTRACT §4.3): the STATIC preamble (profile/digest, recon, tools, the bug
// report, evidence discipline) comes first; PER-AGENT text (role, scope, upstream
// reproduction evidence, the job) lives BELOW the ─── delimiter. The profile block is the
// DIGEST for fan-out agents and the full profile for synthesis agents (fullProfile: true) —
// falling back to the full profile whenever no digest was supplied (no regression).
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
    `## The bug we're chasing (honor this for the whole run)\n<bug-report>\n${bugReport}\n</bug-report>`,
    `## Evidence discipline (CONTRACT §3)\nTag every claim FACT ✓ (cite file:line or command/test output) / ASSUMPTION ~ / QUESTION ? / BLOCKED ⛔. A claim without evidence is a QUESTION, not a FACT. A root cause asserted without the reproduction backing it is an ASSUMPTION, not a diagnosis.`,
    // ── PER-AGENT — varies, so it sits after the cacheable prefix ──────────────────
    `\n────────────────────────────────────────`,
    `You are a ${role} working in THIS repository. Be skeptical and concrete — chase the actual failure, not a plausible-sounding story.`,
    ``,
    `## Orient first (do not skip)`,
    `- Read the in-scope code end-to-end: ${scope || '(resolve from the bug report)'}`,
    `- Trace the real execution path the bug report describes, in the actual source.`,
    context ? `\n## Reproduction evidence (already gathered upstream — diagnose against THIS, don't re-theorize)\n${context}` : ``,
    ``,
    `## Your single job`,
    question,
    evidence ? `\n## For this job specifically\n${evidence}` : ``,
    schemaNote || `\nReturn ONLY the object the schema requires — it is data for the orchestrator, not a message to a human.`,
  ].filter(Boolean).join('\n')
}

// ── Schemas (CONTRACT §4.7): output validated at the tool layer, retried on miss.
// LOCATE = where the bug lives + ranked hypotheses + how to reproduce it.
const LOCATE_SCHEMA = {
  type: 'object',
  // Keep the required set MINIMAL (mirrors ensemble-review.js's SHAPE rationale): only the routing
  // signal the script can't proceed without. Hypotheses drive the fan-out; the repro
  // strategy drives the always-on Reproduce phase. The rest is best-effort.
  required: ['hypotheses', 'reproStrategy'],
  properties: {
    summary: { type: 'string', description: 'what the bug appears to be, in this repo\'s terms — one short paragraph' },
    affectedAreas: { type: 'array', items: { type: 'object', required: ['name'], properties: {
      name: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } } } },
    hypotheses: { type: 'array', items: { type: 'object', required: ['id', 'hypothesis'], properties: {
      id: { type: 'string', description: 'stable short id, e.g. H1, H2' },
      hypothesis: { type: 'string', description: 'a candidate root cause' },
      mechanism: { type: 'string', description: 'how this cause would produce the reported symptom' },
      suspectFiles: { type: 'array', items: { type: 'string' } },
      likelihood: { type: 'string', enum: ['high', 'med', 'low'] } } },
      description: 'candidate root causes, most-likely first' },
    reproStrategy: { type: 'object', required: ['approach'], properties: {
      approach: { type: 'string', description: 'how to trigger the bug (follow the report\'s steps, or construct a minimal failing test/script)' },
      command: { type: 'string', description: 'the exact command/test to run, if known' },
      fromReportSteps: { type: 'boolean', description: 'true if the report already gives runnable repro steps' },
      harness: { type: 'string', description: 'the repo test/sim/fixture harness to use' } } },
    signalsToGather: { type: 'array', items: { type: 'string' }, description: 'logs, traces, state to capture while reproducing' },
    notes: { type: 'string' },
  },
}
// REPRODUCE = the spine of the workflow: did we actually recreate it, and the proof.
const REPRO_SCHEMA = {
  type: 'object',
  required: ['reproduced', 'method', 'observedBehavior'],
  properties: {
    reproduced: { type: 'boolean', description: 'true ONLY if you actually triggered the failure and saw it' },
    confidence: { type: 'string', enum: ['high', 'med', 'low'] },
    method: { type: 'string', description: 'how you triggered it: a test you wrote, the report\'s steps, a script' },
    command: { type: 'string', description: 'the exact command someone else can run to reproduce it' },
    observedBehavior: { type: 'string', description: 'what actually happened — the failure' },
    expectedBehavior: { type: 'string', description: 'what should have happened' },
    failureEvidence: { type: 'string', description: 'the concrete proof: stack trace, assertion message, wrong output (verbatim, trimmed)' },
    minimalRepro: { type: 'string', description: 'the smallest test/script/steps that reproduce it — reusable downstream as the fix\'s regression test' },
    notesIfUnreproduced: { type: 'string', description: 'if NOT reproduced: every strategy tried, why each failed, and what (env/creds/data) is needed to reproduce' },
  },
}
// INVESTIGATE = one per hypothesis: is it the root cause, and what's the fix route.
const INVESTIGATE_SCHEMA = {
  type: 'object',
  required: ['hypothesisId', 'supported', 'confidence'],
  properties: {
    hypothesisId: { type: 'string' },
    supported: { type: 'boolean', description: 'does the evidence support this hypothesis as the actual root cause?' },
    rootCause: { type: 'string', description: 'the precise root cause, if supported' },
    location: { type: 'string', description: 'file:line of the root cause' },
    mechanism: { type: 'string', description: 'how this cause produces the REPRODUCED failure — tie it to the observed evidence, not theory' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'file:line + how each links to the reproduction' },
    proposedFix: { type: 'object', description: 'a ROUTE to a fix (not the fix itself — /ensemble-debug diagnoses, it does not implement)', properties: {
      summary: { type: 'string' }, approach: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } },
      handoff: { type: 'string', enum: ['execute', 'spec'], description: 'execute if the route is concrete; spec if it needs design first' } } },
    confidence: { type: 'string', enum: ['high', 'med', 'low'] },
    notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', required: ['refuted', 'confidence', 'reasoning'],
  properties: { refuted: { type: 'boolean' }, confidence: { type: 'string', enum: ['high', 'med', 'low'] }, reasoning: { type: 'string' } },
}

// ── small helpers (no Date/Math.random — sandbox forbids them) ────────────────
const RANK = { high: 3, med: 2, low: 1 }

// Fail fast on an empty/whitespace-only report — before spending any agent
// (mirrors ensemble-spec.js / ensemble-execute.js guards). /ensemble-debug is useless without a symptom.
if (!bugReport.trim()) return { error: 'No bug report provided — /ensemble-debug needs a description of the bug (symptom, repro steps, env, logs) to diagnose.' }

if (!(A && A.profile) && !profileDigest) log('No repo profile in args — agents will detect conventions from neighbouring files.')
log(`Debugging: ${bugReport.slice(0, 80)}${bugReport.length > 80 ? '…' : ''} (scale=${scale}, cost=${costMode})`)

// ── Phase 1: Locate — read the report + repo as a whole: where it lives, the
// ranked root-cause hypotheses, and exactly how we'll try to reproduce it. ─────
phase('Locate')
const located = await agent(
  brief({
    role: 'bug triage analyst & root-cause hypothesizer',
    scope: '',
    question: `From the bug report, work out:\n- summary: what the bug actually is, in this repo's terms.\n- affectedAreas: the subsystems/files the symptom implicates (real paths you confirmed exist).\n- hypotheses: a RANKED set of candidate root causes (most-likely first), each with the mechanism by which it would produce the reported symptom and the suspect files. Aim for ${HYP_CAP}–${HYP_CAP + 2} distinct, non-overlapping hypotheses — distinct CAUSES, not restatements of the symptom.\n- reproStrategy: exactly how to recreate this bug — prefer the report's own steps if it gives them (fromReportSteps), else construct a minimal failing test/script using the repo's test harness; name the command to run.\n- signalsToGather: the logs/traces/state worth capturing while reproducing.`,
    evidence: 'Base every hypothesis on code you actually read; name real file paths.',
    fullProfile: true,   // synthesis: triage spans the whole repo — give it the full profile
  }),
  { schema: LOCATE_SCHEMA, phase: 'Locate', label: 'locate', ...compute('Locate') }
)
if (!located) return { error: 'Could not locate the bug — re-run /ensemble-debug with more detail (exact symptom, repro steps, affected area, or a stack trace).' }

const hypotheses = (located.hypotheses || []).filter(h => h && h.id)
const reproStrategy = located.reproStrategy || { approach: 'follow the bug report and construct a minimal failing case' }

// ── Phase 2: Reproduce — the SPINE of /debug. This ALWAYS runs (it is the whole
// reason the workflow exists — CONTRACT §0: evidence over narrative). Budget/scale
// only widen HOW MANY strategies we try in parallel; we never skip the attempt. ──
phase('Reproduce')
const reproStrategyText = [
  `Approach: ${reproStrategy.approach}`,
  reproStrategy.command ? `Suggested command: ${reproStrategy.command}` : ``,
  reproStrategy.harness ? `Harness to use: ${reproStrategy.harness}` : ``,
  (located.signalsToGather || []).length ? `Signals to capture: ${located.signalsToGather.join('; ')}` : ``,
].filter(Boolean).join('\n')

const reproQuestion = (variant) => `ALWAYS attempt to recreate this bug — reproduction is the point of this run. ${variant}\nSteps: (1) ${reproStrategy.fromReportSteps ? 'run the report\'s own repro steps' : 'construct the SMALLEST failing test or script that triggers the reported symptom, using the repo\'s test harness'}; (2) actually run it; (3) capture the REAL failure verbatim (stack trace / assertion / wrong output) as failureEvidence; (4) record the exact command someone else can run, and the minimalRepro (ideally a failing test that can later prove the fix). If your first approach does not fail, vary inputs/state/timing and try again before concluding. Set reproduced=true ONLY if you genuinely observed the failure. If you truly cannot reproduce it, set reproduced=false and record in notesIfUnreproduced every strategy you tried, why each failed, and what (env/creds/data/timing) reproduction would need — that is itself a first-class finding, not a failure of this run.\n\nReproduction strategy (from triage):\n${reproStrategyText}`

let reproduction
if (REPRO_STRATEGIES <= 1) {
  reproduction = await agent(
    brief({
      role: 'reproduction engineer',
      scope: (located.affectedAreas || []).flatMap(a => a.files || []).join(', '),
      question: reproQuestion('Build the minimal reproduction and run it.'),
      evidence: 'failureEvidence must be the ACTUAL output you saw, not a description of what you expect.',
    }),
    { schema: REPRO_SCHEMA, phase: 'Reproduce', label: 'reproduce', ...(reproType ? { agentType: reproType } : {}), ...compute('Reproduce') }
  )
} else {
  // Thorough: race a few independent reproduction strategies; the first that genuinely
  // reproduces wins (prefer higher confidence). Diversity beats a single angle for flaky
  // / state-dependent / timing bugs (CONTRACT multi-modal sweep).
  const ANGLES = ['via a focused unit test', 'via the report\'s end-to-end steps / a runtime smoke', 'by varying inputs, state, ordering, or timing around the suspect path']
  const attempts = (await parallel(Array.from({ length: REPRO_STRATEGIES }, (_, i) => () =>
    agent(
      brief({
        role: `reproduction engineer (strategy ${i + 1})`,
        scope: (located.affectedAreas || []).flatMap(a => a.files || []).join(', '),
        question: reproQuestion(`Attempt reproduction ${ANGLES[i % ANGLES.length]}.`),
        evidence: 'failureEvidence must be the ACTUAL output you saw, not a description of what you expect.',
      }),
      { schema: REPRO_SCHEMA, phase: 'Reproduce', label: `reproduce:${i + 1}`, ...(reproType ? { agentType: reproType } : {}), ...compute('Reproduce') }
    )
  ))).filter(Boolean)
  const reproduced = attempts.filter(a => a.reproduced).sort((a, b) => (RANK[b.confidence] || 0) - (RANK[a.confidence] || 0))
  reproduction = reproduced[0] || attempts[0] || null
}
if (!reproduction) reproduction = { reproduced: false, method: 'none', observedBehavior: 'reproduction agent returned nothing', notesIfUnreproduced: 'The reproduction phase produced no result; treat the diagnosis below as hypothesis-level until the bug is reproduced.' }
log(reproduction.reproduced ? `Reproduced ✓ (${reproduction.confidence || 'med'}) — ${(reproduction.observedBehavior || '').slice(0, 80)}` : `Could NOT reproduce — diagnosis will be hypothesis-level. ${(reproduction.notesIfUnreproduced || '').slice(0, 80)}`)

// Thread the reproduction evidence into every investigator + verifier (CONTRACT §4.3 —
// context threading). The repro is the ground truth they diagnose AGAINST; injecting it
// keeps root-cause work tied to the observed failure instead of theory.
const reproContext = [
  `Reproduced: ${reproduction.reproduced ? 'YES' : 'NO'}${reproduction.confidence ? ` (confidence: ${reproduction.confidence})` : ''}`,
  reproduction.method ? `Method: ${reproduction.method}` : ``,
  reproduction.command ? `Command: ${reproduction.command}` : ``,
  reproduction.observedBehavior ? `Observed (the failure): ${reproduction.observedBehavior}` : ``,
  reproduction.expectedBehavior ? `Expected: ${reproduction.expectedBehavior}` : ``,
  reproduction.failureEvidence ? `Failure evidence:\n${reproduction.failureEvidence}` : ``,
  !reproduction.reproduced && reproduction.notesIfUnreproduced ? `Why it could not be reproduced: ${reproduction.notesIfUnreproduced}` : ``,
].filter(Boolean).join('\n')

// ── Build the investigation job list: the top hypotheses (capped by scale). ───
let hypJobs = hypotheses.slice(0, HYP_CAP)
if (hypotheses.length > HYP_CAP) log(`Investigating ${HYP_CAP} of ${hypotheses.length} hypotheses (scale=${scale}); dropped: ${hypotheses.slice(HYP_CAP).map(h => h.id).join(', ')}`)
if (!hypJobs.length) hypJobs = [{ id: 'H1', hypothesis: 'root cause is in the primary affected area', suspectFiles: (located.affectedAreas || []).flatMap(a => a.files || []) }]

// ── Phase 3: Investigate — one investigator per hypothesis, in parallel, each
// grounded in the reproduction evidence. Each confirms or rejects its hypothesis
// against the real failure and, if supported, proposes a ROUTE to a fix. ───────
phase('Investigate')
const investigations = (await parallel(hypJobs.map(h => () =>
  agent(
    brief({
      role: 'root-cause investigator',
      scope: (h.suspectFiles || []).join(', ') || (located.affectedAreas || []).flatMap(a => a.files || []).join(', '),
      question: `Test ONLY this hypothesis as the bug's root cause:\n  [${h.id}] ${h.hypothesis}${h.mechanism ? `\n  proposed mechanism: ${h.mechanism}` : ''}\nRead the actual code on the failing path and decide: is this the real root cause? Set supported true/false. If supported, give the precise rootCause, its location (file:line), and the mechanism that produces the REPRODUCED failure above (tie it to the observed evidence, not theory). Then propose a ROUTE to a fix — summary, approach, the files to change, and whether it should hand off to \`execute\` (route is concrete) or \`spec\` (needs design first). DO NOT implement the fix; this workflow diagnoses only. If the evidence does not support this hypothesis, say so plainly (supported=false) with why — a clean rejection narrows the diagnosis.`,
      evidence: 'A supported root cause must point at file:line AND explain the reproduced failure. Without the reproduction, mark confidence low and say what would confirm it.',
      context: reproContext,
    }),
    { schema: INVESTIGATE_SCHEMA, phase: 'Investigate', agentType: debugger_, label: `investigate:${h.id}`, ...compute('Investigate') }
  )
))).filter(Boolean)

// Attach the originating hypothesis so the report can show what each investigator chased.
const byId = Object.fromEntries(hypotheses.map(h => [h.id, h]))
const enriched = investigations.map(v => ({ ...v, hypothesis: (byId[v.hypothesisId] || {}).hypothesis || v.hypothesisId }))
const supported = enriched.filter(v => v.supported)
  .sort((a, b) => (RANK[b.confidence] || 0) - (RANK[a.confidence] || 0))   // strongest first
const ruledOut = enriched.filter(v => !v.supported)
  .map(v => ({ hypothesis: v.hypothesis, whyRuledOut: v.notes || v.mechanism || 'evidence did not support it' }))

// ── Phase 4: Verify — adversarially refute the LEADING diagnosis. A plausible
// root cause that does not actually explain the reproduced failure is exactly the
// false "done" the escalation ladder (CONTRACT §4.6) exists to catch. If the leader
// is confidently refuted, fall through to the next-best supported hypothesis. ──
phase('Verify')
let _verifyChecked = 0, _verifyEscalated = 0
const PANEL = ['does-this-actually-explain-the-reproduced-failure', 'could-it-be-a-different-root-cause', 'would-the-proposed-fix-actually-resolve-it']
const verifyVote = (cand, lens) => agent(
  brief({
    role: `skeptical diagnosis verifier (${lens} lens)`,
    scope: cand.location || (cand.proposedFix && (cand.proposedFix.files || []).join(', ')) || '',
    question: `Try to REFUTE this diagnosis: the root cause is "${cand.rootCause || cand.hypothesis}"${cand.location ? ` at ${cand.location}` : ''}, by the mechanism: ${cand.mechanism || '(none given)'}. Read the code and the reproduction evidence yourself. Does this cause actually and fully explain the observed failure, or could the real cause be elsewhere? Default to refuted=true if you cannot independently confirm it from the code + the reproduction.`,
    evidence: 'Confirm or refute from the actual code and the reproduced failure, not plausibility.',
    context: reproContext,
  }),
  { schema: VERDICT_SCHEMA, phase: 'Verify', label: `verify:${cand.hypothesisId}`, ...compute('Verify') }
)

async function verifyCandidate(cand) {
  if (!budgetOk()) { log('Budget low — accepting leading diagnosis without adversarial verify'); return { verified: false, verifyVotes: 0 } }
  _verifyChecked++
  const first = await verifyVote(cand, VERIFY_VOTES > 1 ? PANEL[0] : 'refutation')
  let live = [first].filter(Boolean)
  const confidentlyRefuted = first && first.refuted && first.confidence === 'high'
  // Escalation ladder (CONTRACT §4.6): one vote first; escalate to the perspective-diverse
  // panel only when the diagnosis isn't confidently refuted. eco never escalates; max always.
  const wantPanel = VERIFY_VOTES > 1 && costMode !== 'eco' && (costMode === 'max' || !confidentlyRefuted)
  if (wantPanel) {
    _verifyEscalated++
    const rest = await parallel(Array.from({ length: VERIFY_VOTES - 1 }, (_, k) => () => verifyVote(cand, PANEL[(k + 1) % PANEL.length])))
    live = [...live, ...rest.filter(Boolean)]
  }
  const survives = live.length > 0 && live.filter(v => !v.refuted).length >= Math.ceil(live.length / 2)
  return { verified: survives, verifyVotes: live.length, refutations: live.filter(v => v.refuted).map(v => v.reasoning) }
}

// Walk the supported hypotheses strongest-first; the first that survives refutation is
// the confirmed diagnosis. None survive → the strongest supported one stands as an
// ASSUMPTION (unverified) so the human still gets the best lead, clearly labelled.
let diagnosis = null
for (const cand of supported) {
  const v = await verifyCandidate(cand)
  if (v.verified) { diagnosis = { ...cand, verified: true, verifyVotes: v.verifyVotes }; break }
  if (!budgetOk()) { diagnosis = { ...cand, verified: false, verifyVotes: v.verifyVotes }; break }
  // Refuted → remember the strongest as a fallback, keep walking.
  if (!diagnosis) diagnosis = { ...cand, verified: false, verifyVotes: v.verifyVotes, refutations: v.refutations }
}
if (!diagnosis && supported.length) diagnosis = { ...supported[0], verified: false, verifyVotes: 0 }

// Confidence is bounded by the evidence chain: a reproduced + verified root cause is the
// only path to "high"; no reproduction caps it at "low" no matter how clean the code read.
let confidence
if (!diagnosis) confidence = 'Low'
else if (reproduction.reproduced && diagnosis.verified && diagnosis.confidence === 'high') confidence = 'High'
else if (reproduction.reproduced && (diagnosis.verified || diagnosis.confidence !== 'low')) confidence = 'Medium'
else confidence = 'Low'

log(`Diagnosis: ${diagnosis ? (diagnosis.verified ? 'confirmed' : 'unconfirmed (best lead)') : 'none — no hypothesis supported'}; reproduced=${reproduction.reproduced}; confidence=${confidence}`)
const verifyStats = { votesPerCandidate: VERIFY_VOTES, candidatesChecked: _verifyChecked, escalatedToPanel: _verifyEscalated }

return {
  bugReport,
  scale,
  costMode,
  confidence,
  verifyStats,
  reproduction: {
    reproduced: !!reproduction.reproduced,
    confidence: reproduction.confidence || '',
    method: reproduction.method || '',
    command: reproduction.command || '',
    observedBehavior: reproduction.observedBehavior || '',
    expectedBehavior: reproduction.expectedBehavior || '',
    failureEvidence: reproduction.failureEvidence || '',
    minimalRepro: reproduction.minimalRepro || '',
    notesIfUnreproduced: reproduction.notesIfUnreproduced || '',
  },
  diagnosis: diagnosis ? {
    rootCause: diagnosis.rootCause || diagnosis.hypothesis || '',
    location: diagnosis.location || '',
    mechanism: diagnosis.mechanism || '',
    verified: !!diagnosis.verified,
    confidence: diagnosis.confidence || '',
    evidence: diagnosis.evidence || [],
    refutations: diagnosis.refutations || [],
  } : null,
  fixRoute: diagnosis && diagnosis.proposedFix ? {
    summary: diagnosis.proposedFix.summary || '',
    approach: diagnosis.proposedFix.approach || '',
    files: diagnosis.proposedFix.files || [],
    handoff: diagnosis.proposedFix.handoff || 'execute',
    testToProveFixed: reproduction.minimalRepro || '',
  } : null,
  affectedAreas: located.affectedAreas || [],
  hypothesesConsidered: hypotheses.map(h => ({ id: h.id, hypothesis: h.hypothesis, likelihood: h.likelihood || '' })),
  ruledOut,
  coverage: {
    reproduced: !!reproduction.reproduced,
    hypothesesInvestigated: hypJobs.map(h => h.id),
    hypothesesDropped: hypotheses.slice(HYP_CAP).map(h => h.id),
    supportedCount: supported.length,
    droppedToBudget: !budgetOk(),
  },
}
