export const meta = {
  name: 'spec',
  description: 'Turn a request into an implementation-ready spec grounded in this repo: scope the change, fan out explorers for real context, draft testable criteria, then adversarially critique the spec',
  phases: [
    { title: 'Scope', detail: 'identify the areas/patterns the request touches' },
    { title: 'Gather', detail: 'one explorer per area returns file:line context + patterns to mirror' },
    { title: 'Draft', detail: 'synthesize a testable spec anchored to existing code' },
    { title: 'Critique', detail: 'adversarially check for gaps, contradictions, untestable criteria' },
  ],
}

// Repo context arrives via args (the sandbox can't read the repo — CONTRACT §4.2).
// The Workflow tool delivers `args` as a JSON STRING (verified) — parse it so the
// script works whether args is a string or an already-parsed object.
const A = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {})
const profile    = (A && A.profile)    || ''
const recon      = (A && A.recon)       || ''
const request    = (A && A.request)     || ''
const commands   = (A && A.commands)    || {}
const roster     = (A && A.roster)      || []
const invariants = (A && A.invariants)  || []
const repoTools  = (A && A.tools)       || []
const mandatory  = (A && A.mandatoryRequirements) || []
const scaleArg   = (A && A.scale)       || 'auto'
const agentTypes = (A && A.agentTypes)  || {}
const explorer   = agentTypes.explorer || 'Explore'

const scale = scaleArg === 'audit' ? 'thorough' : scaleArg   // 'audit' = the heaviest pass (CONTRACT §4.6)
// Cost mode (CONTRACT §4.6) — orthogonal $ dial over `scale`: `scale` decides how much to
// look, `costMode` how much to spend. Shifts per-agent effort (below) and the explorer cap.
const costMode = (A && A.costMode) || 'balanced'             // 'eco' | 'balanced' | 'max'
let AREA_CAP = scale === 'quick' ? 2 : scale === 'thorough' ? 8 : 4
if (costMode === 'eco') AREA_CAP = Math.max(1, Math.ceil(AREA_CAP / 2))
else if (costMode === 'max') AREA_CAP += 2
const budgetOk = () => !budget.total || budget.remaining() > 40_000

// Per-phase compute (CONTRACT §4.9) — effort-first tiering. Broad exploration is
// cheap; synthesis/critique is expensive. `phasePolicy` from the repo profile
// overrides per phase and may pin a model (never defaulted — absent → session model).
const phasePolicy = (A && A.phasePolicy) || {}   // { phase(lowercase): {effort, model} }
const DEFAULT_TIER = { scope: { effort: 'low' }, gather: { effort: 'medium' }, draft: { effort: 'high' }, critique: { effort: 'high' } }
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

// Standard brief (CONTRACT §4.3) — no naked subagents: each orients on repo context,
// finds patterns to mirror, and knows the repo's tools.
// Ordering matters (CONTRACT §4.3): the STATIC preamble (profile, recon, tools, evidence
// discipline) is byte-identical across every agent this run, forming a stable prefix any
// prompt-prefix cache can reuse. Per-agent text (role, scope, upstream context, job) sits
// BELOW the ─── delimiter.
function brief({ role, scope, question, evidence, schemaNote, context }) {
  return [
    // ── STATIC PREAMBLE — same for all agents this run (cacheable prefix) ──────────
    profile ? `## Repo profile — ground truth (commands, invariants, conventions, "done" bar)\n<profile>\n${profile}\n</profile>` : `## No repo-profile.md exists\nDetect conventions from neighbouring files before asserting anything.`,
    recon ? `## Cached recon (stack / layout / commands)\n<recon>\n${recon}\n</recon>` : ``,
    repoTools.length ? `## Repo tools\nFor real evidence you may use: ${repoTools.join(', ')}. Load any with ToolSearch ("select:<name>") before calling it.` : ``,
    `## Evidence discipline (CONTRACT §3)\nTag every claim FACT ✓ (file:line / command output) / ASSUMPTION ~ / QUESTION ? / BLOCKED ⛔. A claim without evidence is a QUESTION, not a FACT.`,
    // ── PER-AGENT — varies, so it sits after the cacheable prefix ──────────────────
    `\n────────────────────────────────────────`,
    `You are a ${role} working in THIS repository. Ground every claim in real code.`,
    ``,
    `## Orient first (do not skip)`,
    `- Read the relevant files end-to-end${scope ? `: ${scope}` : ' for the area in scope'}, and find 2–3 existing patterns similar to what's being asked so the spec can say "build it like X at file:line".`,
    context ? `\n## Already derived upstream (reuse it, don't re-derive)\n${context}` : ``,
    ``,
    `## Your single job`,
    question,
    evidence ? `\n## For this job specifically\n${evidence}` : ``,
    schemaNote || `\nReturn ONLY the object the schema requires — it is data for the orchestrator, not a message to a human.`,
  ].filter(Boolean).join('\n')
}

const SCOPE_SCHEMA = {
  type: 'object', required: ['areas', 'unknowns'],
  properties: {
    areas: { type: 'array', items: { type: 'object', required: ['name'], properties: {
      name: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, whyRelevant: { type: 'string' } } } },
    similarPatterns: { type: 'array', items: { type: 'object', properties: {
      what: { type: 'string' }, file: { type: 'string' }, line: { type: ['integer', 'null'] } } } },
    unknowns: { type: 'array', items: { type: 'string' } },
  },
}
const CONTEXT_SCHEMA = {
  type: 'object', required: ['area', 'findings'],
  properties: {
    area: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', required: ['file', 'note'], properties: {
      file: { type: 'string' }, line: { type: ['integer', 'null'] }, note: { type: 'string' } } } },
    patternsToMirror: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, file: { type: 'string' } } } },
    gotchas: { type: 'array', items: { type: 'string' } },
  },
}
const SPEC_SCHEMA = {
  type: 'object', required: ['problem', 'acceptanceCriteria', 'approach', 'testStrategy'],
  properties: {
    problem: { type: 'string' },
    acceptanceCriteria: { type: 'array', items: { type: 'object', required: ['id', 'criterion', 'verifyBy'], properties: {
      id: { type: 'string' }, criterion: { type: 'string' }, verifyBy: { type: 'string' } } } },
    affectedAreas: { type: 'array', items: { type: 'object', required: ['path'], properties: {
      path: { type: 'string' }, change: { type: 'string' }, blastRadius: { type: 'string' } } } },
    invariantsTouched: { type: 'array', items: { type: 'string' } },
    mandatoryRequirementsApplying: { type: 'array', items: { type: 'string' } },
    approach: { type: 'string' },
    testStrategy: { type: 'object', properties: {
      framework: { type: 'string' }, levels: { type: 'array', items: { type: 'string' } }, howToRunScoped: { type: 'string' }, fixtures: { type: 'string' } } },
    risks: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['high', 'med', 'low'] }, risk: { type: 'string' }, mitigation: { type: 'string' } } } },
    openQuestions: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, unblockedBy: { type: 'string' } } } },
  },
}
const CRITIQUE_SCHEMA = {
  type: 'object', required: ['verdict'],
  properties: {
    gaps: { type: 'array', items: { type: 'object', properties: {
      issue: { type: 'string' }, severity: { type: 'string', enum: ['high', 'med', 'low'] }, fix: { type: 'string' } } } },
    untestableCriteria: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['ready', 'needs-work'] },
  },
}

// Fail fast on an empty/whitespace-only request — before spending any agent
// (mirrors execute.js's `if (!spec)` guard). Found by /spec reviewing itself.
if (!request.trim()) return { error: 'No request provided — /spec needs an idea, ticket, or description of the change to spec.' }

log(`Speccing: ${request.slice(0, 80)}${request.length > 80 ? '…' : ''} (scale=${scale}, cost=${costMode})`)

// ── Phase 1: Scope — where does this request live, what should it mirror? ─────
phase('Scope')
const scoped = await agent(
  brief({
    role: 'scoping analyst',
    scope: '',
    question: `For this request, identify the repo areas/subsystems it touches, 2–3 existing patterns to mirror (file:line), and the unknowns a spec must resolve. Request:\n"""${request}"""`,
    evidence: 'Name real paths you confirmed exist.',
  }),
  { schema: SCOPE_SCHEMA, phase: 'Scope', label: 'scope', ...compute('Scope') }
)
if (!scoped) return { error: 'Could not scope the request — re-run /spec with more detail.' }

let areas = (scoped.areas || []).slice(0, AREA_CAP)
if ((scoped.areas || []).length > AREA_CAP) log(`Capping ${scoped.areas.length} areas to ${AREA_CAP} (scale=${scale})`)
if (!areas.length) areas = [{ name: 'primary', files: [], whyRelevant: 'request target' }]

// Thread the scope findings downstream (CONTRACT §4.3): the explorers and the drafter
// start from the patterns/unknowns scope already surfaced instead of re-deriving them.
const scopeContext = [
  (scoped.similarPatterns || []).length ? `Patterns to mirror (from scope): ${scoped.similarPatterns.map(p => `${p.what}${p.file ? ` (${p.file}${p.line != null ? ':' + p.line : ''})` : ''}`).join('; ')}` : ``,
  (scoped.unknowns || []).length ? `Unknowns this spec must resolve: ${scoped.unknowns.join('; ')}` : ``,
].filter(Boolean).join('\n')

// ── Phase 2: Gather — one explorer per area, in parallel (read-only). ─────────
phase('Gather')
const contexts = (await parallel(areas.map(a => () =>
  agent(
    brief({
      role: `code explorer for the "${a.name}" area`,
      scope: (a.files || []).join(', '),
      question: `Map how "${a.name}" works today and what this request would touch here. Return concrete file:line findings, the patterns to mirror, and gotchas. Why relevant: ${a.whyRelevant || '(request target)'}.`,
      evidence: 'Every finding needs a file:line.',
      context: scopeContext,
    }),
    { schema: CONTEXT_SCHEMA, phase: 'Gather', agentType: explorer, label: `explore:${a.name}`, ...compute('Gather') }
  )
))).filter(Boolean)

// ── Phase 3: Draft — synthesize one testable spec from the gathered context. ──
phase('Draft')
const spec = await agent(
  brief({
    role: 'spec author',
    scope: areas.flatMap(a => a.files || []).join(', '),
    question: `Using the gathered context below, write an implementation-ready spec for the request. Every acceptance criterion must be concrete and testable (a command or observable behavior). Flag which invariants [${invariants.map(i => i.name).join(', ') || 'none'}] and mandatory requirements [${mandatory.map(m => m.requirement).join(', ') || 'none'}] this change touches — those become non-negotiable downstream gates. Anchor the approach to existing patterns by file:line.\n\nGathered context:\n${JSON.stringify(contexts).slice(0, 6000)}\n\nRequest:\n"""${request}"""`,
    evidence: 'Tie acceptance criteria to how each is verified.',
    context: scopeContext,
  }),
  { schema: SPEC_SCHEMA, phase: 'Draft', label: 'draft-spec', ...compute('Draft') }
)
if (!spec) return { error: 'Could not draft the spec from the gathered context.' }

// ── Phase 4: Critique — adversarially stress the spec before handing it off. ──
phase('Critique')
let critique = null
if (budgetOk()) {
  critique = await agent(
    brief({
      role: 'skeptical spec reviewer',
      scope: '',
      question: `Adversarially critique this spec: untestable criteria, missing edge cases, hidden coupling, contradictions, and any invariant/mandatory-requirement it fails to address. Be specific about the smallest fix for each gap.\n\nSpec:\n${JSON.stringify(spec).slice(0, 6000)}`,
      evidence: 'Each gap: what is missing and the smallest fix.',
    }),
    { schema: CRITIQUE_SCHEMA, phase: 'Critique', label: 'critique', ...compute('Critique') }
  )
}

log(`Spec drafted — ${(spec.acceptanceCriteria || []).length} acceptance criteria; critique: ${critique ? critique.verdict : 'skipped (budget)'}`)

return {
  request,
  scale,
  costMode,
  spec,
  critique,
  areasExplored: areas.map(a => a.name),
  unknowns: scoped.unknowns || [],
}
