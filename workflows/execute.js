export const meta = {
  name: 'execute',
  description: 'Loop-engineering executor: run an autonomous implement↔verify loop against a LOCKED set of passing criteria, looping (independent verify) until every criterion is proven with evidence or the loop hands back to you — exits complete / needs-you / blocked',
  phases: [
    { title: 'Plan', detail: 'decompose the work into tasks, each mapped to a locked acceptance criterion (criteria are the immutable contract — not invented here)' },
    { title: 'Implement', detail: 'implement each open task (TDD when possible); sequential to avoid write conflicts' },
    { title: 'Verify', detail: 'an INDEPENDENT verifier re-proves each criterion with evidence; misses loop back to Implement while progress is being made' },
    { title: 'Checks', detail: 'final canonical checks + invariant gate tests + mandatory-evidence gate' },
  ],
}

// Repo context arrives via args (the sandbox can't read the repo — CONTRACT §4.2).
// The agents this script spawns DO have full Bash/Read/Write/MCP and do the work.
// The Workflow tool delivers `args` as a JSON STRING (verified) — parse it so the
// script works whether args is a string or an already-parsed object.
const A = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {})
const profile    = (A && A.profile)    || ''
const profileDigest = (A && A.profileDigest) || ''   // compact orientation for fan-out (implement/verify) agents (CONTRACT §4.3); '' → fall back to full profile
const recon      = (A && A.recon)       || ''
const spec       = (A && A.spec)        || ''   // resolved spec text, passed by /execute
const criteria   = (A && A.criteria)    || []   // LOCKED, human-confirmed passing criteria: [{id, criterion, verifyBy, source}] (CONTRACT §4.8)
const commands   = (A && A.commands)    || {}
const roster     = (A && A.roster)      || []
const invariants = (A && A.invariants)  || []
const repoTools  = (A && A.tools)       || []
const mandatory  = (A && A.mandatoryRequirements) || []  // [{requirement, appliesWhen, requiredEvidence}]
const scaleArg   = (A && A.scale)       || 'auto'
const agentTypes = (A && A.agentTypes)  || {}
const coderType    = agentTypes.coder    || 'general-purpose'
const verifierType = agentTypes.verifier || 'general-purpose'  // 'verifier' if the repo has it

const scale = scaleArg === 'audit' ? 'thorough' : scaleArg   // 'audit' = the heaviest pass (CONTRACT §4.6)
// MAX_ROUNDS is now a BACKSTOP only. The loop normally exits on convergence or the
// stuck-detector (a round that closes nothing new and repeats the same feedback) —
// well before this cap. It survives so a pathological oscillation can't run unbounded.
const MAX_ROUNDS = scale === 'quick' ? 3 : scale === 'thorough' ? 6 : 5
// Cost mode (CONTRACT §4.6) — orthogonal $ dial over `scale`. For /execute it shifts only
// per-agent EFFORT (below); the loop's progress-based termination is untouched — cutting the
// loop short to save money risks shipping unconverged code, the wrong place to economise.
const costMode = (A && A.costMode) || 'balanced'             // 'eco' | 'balanced' | 'max'
// Implementation is expensive — keep a larger reserve so the final checks always run.
const budgetOk = () => !budget.total || budget.remaining() > 60_000

// Per-phase compute (CONTRACT §4.9) — effort-first tiering. Planning and adversarial
// verification run hot; running checks is mechanical. `phasePolicy` from the repo
// profile overrides per phase and may pin a model (never defaulted — absent →
// inherit the session model).
const phasePolicy = (A && A.phasePolicy) || {}   // { phase(lowercase): {effort, model} }
const DEFAULT_TIER = { plan: { effort: 'high' }, implement: { effort: 'medium' }, verify: { effort: 'high' }, checks: { effort: 'low' } }
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

function mandatoryLine() {
  return mandatory.length
    ? mandatory.map(m => `${m.requirement} (applies when: ${m.appliesWhen}) → required evidence: ${m.requiredEvidence}`).join('; ')
    : ''
}

// Standard brief (CONTRACT §4.3) — no naked subagents.
// Ordering: the STATIC preamble (profile, recon, tools, evidence discipline) is
// byte-identical across every agent this run; per-agent text (role, scope, upstream
// context, job) sits BELOW the ─── delimiter. (Measured caveat in CONTRACT §4.3: this is
// clean structure, not a token saving in the current harness.)
function brief({ role, scope, question, evidence, schemaNote, context, fullProfile }) {
  // DIGEST for fan-out (implement/verify/check) agents; full profile for synthesis
  // (fullProfile) and the no-digest fallback (CONTRACT §4.3).
  const useFull = fullProfile || !profileDigest
  const profileBlock = useFull
    ? (profile ? `## Repo profile — ground truth (canonical commands, invariants, conventions, "done" bar)\n<profile>\n${profile}\n</profile>` : `## No repo-profile.md exists\nDetect conventions from neighbouring files before changing anything.`)
    : `## Repo orientation (digest — the essentials; synthesis agents read the full profile)\n${profileDigest}`
  return [
    // ── STATIC PREAMBLE — same for all agents this run ────────────────────────────
    profileBlock,
    recon ? `## Cached recon (stack / layout / commands)\n<recon>\n${recon}\n</recon>` : ``,
    repoTools.length ? `## Repo tools\nUse these for real work/evidence (not guesses): ${repoTools.join(', ')}. Load any with ToolSearch ("select:<name>") before calling it.` : ``,
    `## Evidence discipline (CONTRACT §3)\nTag every claim FACT ✓ (file:line / command output) / ASSUMPTION ~ / QUESTION ? / BLOCKED ⛔. A claim without evidence is a QUESTION, not a FACT.`,
    // ── PER-AGENT — varies ────────────────────────────────────────────────────────
    `\n────────────────────────────────────────`,
    `You are a ${role} working in THIS repository. Ground every claim in real code and command output.`,
    ``,
    `## Orient first (do not skip)`,
    `- Read the in-scope files end-to-end${scope ? `: ${scope}` : ''} and mirror neighbouring conventions.`,
    context ? `\n## Already derived upstream (reuse it, don't re-derive)\n${context}` : ``,
    ``,
    `## Your single job`,
    question,
    evidence ? `\n## For this job specifically\n${evidence}` : ``,
    schemaNote || `\nReturn ONLY the object the schema requires — it is data for the orchestrator, not a message to a human.`,
  ].filter(Boolean).join('\n')
}

// Plan output: tasks each mapped to the criterion id(s) they advance. The criteria
// themselves are NOT invented here when locked ones were passed in (§4.8); only the
// degenerate "no locked criteria" path returns derivedCriteria (flagged downstream).
const TASK_LEDGER_SCHEMA = {
  type: 'object', required: ['tasks'],
  properties: {
    tasks: { type: 'array', items: { type: 'object', required: ['id', 'description', 'criterionIds'], properties: {
      id: { type: 'string' }, description: { type: 'string' },
      criterionIds: { type: 'array', items: { type: 'string' } },  // which locked criteria this task advances
      criterion: { type: 'string' },                               // optional human-readable restatement
      hasTestPath: { type: 'boolean' }, files: { type: 'array', items: { type: 'string' } },
      dependsOn: { type: 'array', items: { type: 'string' } } } } },
    derivedCriteria: { type: 'array', items: { type: 'object', required: ['id', 'criterion'], properties: {
      id: { type: 'string' }, criterion: { type: 'string' }, verifyBy: { type: 'string' } } } },
    notes: { type: 'string' },
  },
}
const IMPL_SCHEMA = {
  type: 'object', required: ['taskId', 'summary'],
  properties: {
    taskId: { type: 'string' }, summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testAdded: { type: 'string' }, evidence: { type: 'string' },
    blocked: { type: 'boolean' },
    blockerKind: { type: 'string', enum: ['external', 'decision'] },  // external=infra/creds/env wall; decision=needs a human choice
    blockerReason: { type: 'string' },
  },
}
const TASK_VERDICT_SCHEMA = {
  type: 'object', required: ['taskId', 'satisfied', 'evidenceProduced'],
  properties: {
    taskId: { type: 'string' }, satisfied: { type: 'boolean' }, evidenceProduced: { type: 'boolean' },
    needsHuman: { type: 'boolean' },        // criterion is ambiguous/underspecified — no implementation can settle it
    humanQuestion: { type: 'string' },      // the exact decision the human must make
    missing: { type: 'string' }, feedback: { type: 'string' },
  },
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

if (!spec) return { error: 'No spec provided — /execute needs a spec path or text.' }

// ── Phase 1: Plan — decompose into tasks mapped to the LOCKED criteria. ────────
// The criteria are the immutable contract for this run; the planner consumes them,
// it does not author them. Only the no-locked-criteria fallback derives a set.
const criteriaProvided = criteria.length > 0
const criteriaBlock = criteriaProvided
  ? criteria.map(c => `- [${c.id}] ${c.criterion}${c.verifyBy ? ` (verify by: ${c.verifyBy})` : ''}${c.source ? `  ·source: ${c.source}` : ''}`).join('\n')
  : '(none locked — derive a minimal testable set from the spec and FLAG that they were not human-confirmed)'

phase('Plan')
const plan = await agent(
  brief({
    role: 'implementation planner',
    scope: '',
    question: [
      criteriaProvided
        ? `These passing criteria are LOCKED — the human confirmed them as the immutable definition of "done" for this run. Do NOT invent, broaden, or narrow them. Decompose the work into small, independently verifiable tasks so that, once all are done, EVERY locked criterion is satisfied. Map each task to the criterion id(s) it advances via criterionIds. Every locked criterion must be covered by at least one task — if one cannot be, flag it as a QUESTION in notes rather than silently dropping it.`
        : `No locked criteria were provided. Derive a minimal set of testable acceptance criteria from the spec, return them in derivedCriteria with stable ids, and map every task to them via criterionIds. These were NOT human-confirmed — the orchestrator will flag that in the report.`,
      ``,
      `Locked criteria:\n${criteriaBlock}`,
      ``,
      `Spec / request:\n"""${spec}"""`,
      ``,
      `For each task: a stable id, what to do, the criterion id(s) it advances (criterionIds), whether a real test path exists (hasTestPath), and the files it touches. Sequence by dependency.`,
    ].join('\n'),
    evidence: 'Every criterion must map to ≥1 task; flag any criterion you cannot map as a QUESTION.',
    fullProfile: true,   // synthesis: the planner decomposes against the whole spec/profile — full profile
  }),
  { schema: TASK_LEDGER_SCHEMA, phase: 'Plan', label: 'decompose', ...compute('Plan') }
)
if (!plan || !(plan.tasks || []).length) return { error: 'Could not decompose the spec into tasks.' }

// Planner notes orient each implementer (CONTRACT §4.3) without re-deriving the rationale.
const planContext = plan.notes ? `Planner notes: ${plan.notes}` : ''

// The criteria the loop measures against: the locked set, or (fallback) the derived one.
const effectiveCriteria = criteriaProvided ? criteria : ((plan.derivedCriteria) || [])
const critById = {}
effectiveCriteria.forEach(c => { critById[c.id] = { id: c.id, criterion: c.criterion, source: c.source || '', taskIds: [] } })
plan.tasks.forEach(t => (t.criterionIds || []).forEach(cid => { if (critById[cid]) critById[cid].taskIds.push(t.id) }))
function critText(t) {
  const ids = t.criterionIds || []
  const mapped = ids.map(cid => critById[cid] ? `[${cid}] ${critById[cid].criterion}` : cid).filter(Boolean)
  return mapped.join('; ') || t.criterion || '(criterion unmapped)'
}

// ledger: id -> { task, status, rounds, impl, verdict, blocker }
// status ∈ pending | done | blocked-external | needs-decision
const ledger = {}
plan.tasks.forEach(t => { ledger[t.id] = { task: t, status: 'pending', rounds: 0 } })
const feedback = {}                 // taskId -> verifier feedback to feed the next implement attempt
const decisions = []                // [{taskId, question, source}] — human questions surfaced by the loop
let remaining = plan.tasks.slice()  // tasks not yet verified-done
let round = 0
let stuck = false

const doneCount = () => plan.tasks.filter(t => ledger[t.id].status === 'done').length

// ── Phases 2–3: the implement→verify loop. Implement runs SEQUENTIALLY (agents
// mutate the same working tree; parallel writes would clobber each other), then
// verify runs in PARALLEL and INDEPENDENTLY (the verifier re-proves the criterion
// rather than trusting the implementer — this is what makes the autonomous loop
// trustworthy, CONTRACT §4.8). The loop continues while there is open work AND the
// last round made PROGRESS — it stops the moment it stalls instead of grinding to
// the cap (CONTRACT §4.8: progress-based termination, not a fixed round count).
while (remaining.length && round < MAX_ROUNDS && budgetOk() && !stuck) {
  round++
  const doneBefore = doneCount()
  const feedbackBefore = {}
  remaining.forEach(t => { feedbackBefore[t.id] = feedback[t.id] || '' })
  log(`Round ${round}: implementing ${remaining.length} open task(s)`)

  phase('Implement')
  for (const t of remaining) {
    ledger[t.id].rounds = round
    const impl = await agent(
      brief({
        role: 'implementer (TDD when a test path exists)',
        scope: (t.files || []).join(', '),
        question: [
          `Implement this task: ${t.description}`,
          `It advances acceptance criterion: ${critText(t)}`,
          t.hasTestPath
            ? `Use TDD: write a failing test encoding the criterion → implement the minimum to pass → confirm green → refactor.`
            : `No clean test path — add a characterization test or a runtime smoke check and note it BLOCKED ⛔ on TDD.`,
          mandatory.length ? `If any mandatory requirement applies to your files, PRODUCE its evidence now (run the cycle, capture the screenshot via the browser MCP, etc.): ${mandatoryLine()}.` : ``,
          feedback[t.id] ? `\n## A previous attempt was sent back — address this and produce the missing evidence:\n${feedback[t.id]}` : ``,
          `If this task genuinely cannot be completed, set blocked=true and: blockerKind='external' for an infra/creds/env/no-test-path wall (say exactly what is missing), or blockerKind='decision' if it needs a human choice the spec does not settle (state the exact question). Do NOT fake completion.`,
          `After editing, run the scoped checks and capture real output as evidence.`,
        ].filter(Boolean).join('\n'),
        evidence: 'Report the actual files changed and the command output proving it works.',
        context: planContext,
      }),
      { schema: IMPL_SCHEMA, phase: 'Implement', agentType: coderType, label: `impl:${t.id} r${round}`, ...compute('Implement') }
    )
    ledger[t.id].impl = impl
    if (impl && impl.blocked) {
      if (impl.blockerKind === 'decision') {
        ledger[t.id].status = 'needs-decision'
        decisions.push({ taskId: t.id, question: impl.blockerReason || 'needs a human decision', source: 'implementer' })
      } else {
        ledger[t.id].status = 'blocked-external'
        ledger[t.id].blocker = impl.blockerReason || 'blocked by implementer'
      }
    }
  }

  // Verify only the tasks still pending (not self-reported blocked/decision this round).
  const toVerify = remaining.filter(t => ledger[t.id].status === 'pending')
  phase('Verify')
  const verdicts = await parallel(toVerify.map(t => () =>
    agent(
      brief({
        role: 'task verifier (independent — checks, never fixes)',
        scope: (t.files || []).join(', '),
        question: [
          `Independently verify this acceptance criterion is actually met WITH evidence — do not trust the implementer's claim: ${critText(t)}`,
          `Re-run the relevant scoped test/command yourself and read the changed code.`,
          mandatory.length ? `Also confirm any mandatory requirement that applies to these files was satisfied with real evidence (e.g. a screenshot of the working UI exists, the eval/sim cycle ran): ${mandatoryLine()}. If that evidence is missing, the task is NOT satisfied — state exactly what to produce.` : ``,
          `satisfied=true only if the criterion is met; evidenceProduced=true only if all applicable mandatory evidence exists. If the criterion itself is ambiguous/underspecified such that no implementation can settle it without a human decision, set needsHuman=true with a precise humanQuestion. Otherwise give precise, actionable feedback for the next attempt.`,
        ].filter(Boolean).join('\n'),
        evidence: 'Cite the command output or file:line you checked.',
        schemaNote: 'Return the verdict object; `missing`/`feedback` must be specific enough to act on.',
      }),
      { schema: TASK_VERDICT_SCHEMA, phase: 'Verify', agentType: verifierType, label: `verify:${t.id} r${round}`, ...compute('Verify') }
    )
  ))

  const next = []
  toVerify.forEach((t, i) => {
    const v = verdicts[i]
    ledger[t.id].verdict = v
    if (v && v.satisfied && v.evidenceProduced) {
      ledger[t.id].status = 'done'
    } else if (v && v.needsHuman) {
      ledger[t.id].status = 'needs-decision'
      decisions.push({ taskId: t.id, question: v.humanQuestion || 'criterion is underspecified — needs a human decision', source: 'verifier' })
    } else {
      feedback[t.id] = (v && (v.missing || v.feedback)) || 'verification failed; re-check the criterion and produce the required evidence'
      next.push(t)
    }
  })
  remaining = next

  // Progress = a task newly closed this round, OR genuinely new verifier feedback on
  // a still-open task. A round that does neither is the loop spinning — stop and hand
  // back to the human rather than burn more rounds (and tokens) on the same wall.
  const madeProgress = doneCount() > doneBefore || remaining.some(t => (feedback[t.id] || '') !== (feedbackBefore[t.id] || ''))
  log(`Round ${round} done — ${doneCount()}/${plan.tasks.length} tasks satisfied`)
  if (!madeProgress && remaining.length) {
    stuck = true
    log(`No progress this round (nothing closed, feedback unchanged) — stopping the loop and returning to you instead of thrashing.`)
  }
}

// ── Phase 4: final gate — canonical checks + invariant gates + mandatory reqs. ─
phase('Checks')
const changedFiles = Array.from(new Set(plan.tasks.flatMap(t => (ledger[t.id].impl && ledger[t.id].impl.filesChanged) || (t.files || []))))

async function runChecks() {
  if (!budgetOk()) { log('Budget low — skipping final check execution'); return { checks: [], invariantGates: [] } }
  const cmdList = Object.entries(commands).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
    || '(none provided; detect from CI config / package scripts / Makefile)'
  return await agent(
    brief({
      role: 'final check runner',
      scope: changedFiles.join(', '),
      question: `Run the repo's canonical checks against the implemented change and report real output. Canonical commands:\n${cmdList}\nAlso run any invariant gate test whose blast radius this change touches: ${invariants.map(i => `${i.name}: ${i.gateTest}`).join(' | ') || 'none defined'}. Mark anything you cannot run (no creds/env) as blocked with why.`,
      evidence: 'Paste the key passing/failing line for each command.',
    }),
    { schema: CHECKS_SCHEMA, phase: 'Checks', label: 'final-checks', ...compute('Checks') }
  ) || { checks: [], invariantGates: [] }
}

async function checkRequirements() {
  if (!mandatory.length) return { requirements: [] }
  if (!budgetOk()) { log('Budget low — skipping mandatory-requirements gate'); return { requirements: [] } }
  return await agent(
    brief({
      role: 'mandatory-requirements gate checker',
      scope: changedFiles.join(', '),
      question: `For EACH mandatory requirement: decide if it applies to this change (appliesWhen), then verify its required evidence was actually produced — inspect the working tree/branch for it (screenshots, eval/sim output, cycle logs); produce it yourself with the repo's tools if you can. Requirements:\n${mandatory.map(m => `- ${m.requirement} — applies when: ${m.appliesWhen} — required evidence: ${m.requiredEvidence}`).join('\n')}\nMark each satisfied / unmet / blocked / n/a with concrete evidence or why it's missing.`,
      evidence: 'A requirement is satisfied ONLY if you can point to concrete evidence.',
    }),
    { schema: REQUIREMENTS_SCHEMA, phase: 'Checks', label: 'requirements-gate', ...compute('Checks') }
  ) || { requirements: [] }
}

const [checks, reqResults] = await parallel([() => runChecks(), () => checkRequirements()])

// ── Synthesize the ledger, per-criterion satisfaction, and the exit state. ─────
const tasksOut = plan.tasks.map(t => {
  const e = ledger[t.id]
  return {
    id: t.id, description: t.description, criterionIds: t.criterionIds || [], status: e.status, rounds: e.rounds,
    evidence: (e.impl && e.impl.evidence) || '', testAdded: (e.impl && e.impl.testAdded) || '',
    blocker: e.blocker || '', lastFeedback: feedback[t.id] || '',
  }
})
// A criterion is met only when every task mapped to it is done. Unmapped criteria
// (no task addresses them) count as unmet — a planning gap, surfaced below.
const criteriaOut = effectiveCriteria.map(c => {
  const taskIds = critById[c.id].taskIds
  return {
    id: c.id, criterion: c.criterion, source: c.source || '',
    satisfied: taskIds.length > 0 && taskIds.every(id => ledger[id].status === 'done'),
    mappedTasks: taskIds, unmapped: taskIds.length === 0,
  }
})

const done           = tasksOut.filter(t => t.status === 'done')
const blockedExternal = tasksOut.filter(t => t.status === 'blocked-external')
const needsDecision  = tasksOut.filter(t => t.status === 'needs-decision')
const unfinished     = tasksOut.filter(t => t.status === 'pending')  // loop stopped (stuck/rounds/budget) without resolving
const unmetCriteria  = criteriaOut.filter(c => !c.satisfied)
const reqs           = (reqResults && reqResults.requirements) || []
const unmetReqs      = reqs.filter(r => r.status === 'unmet')
const blockedReqs    = reqs.filter(r => r.status === 'blocked')
const failedChecks   = ((checks && checks.checks) || []).filter(c => c.result === 'fail')
const failedGates    = ((checks && checks.invariantGates) || []).filter(g => g.result === 'fail')

// Convergence requires the FULL contract: every criterion met (with evidence) AND
// checks green AND invariant gates green AND mandatory evidence produced AND no
// pending human decision. Anything short is not done — say which.
const allCriteriaMet = criteriaOut.length ? unmetCriteria.length === 0 : unfinished.length === 0
const isComplete = allCriteriaMet && failedChecks.length === 0 && failedGates.length === 0
  && unmetReqs.length === 0 && blockedReqs.length === 0 && needsDecision.length === 0

// Three exit states — each a distinct handoff to the human (CONTRACT §4.8):
//   complete  → done, proven; recommend /review.
//   needs-you → a decision is pending, work is unfinished, or a check/requirement
//               failed — the loop returns to you with the specific thing.
//   blocked   → the ONLY thing left is an external wall (creds/env/infra); no human
//               decision unblocks it, you need to clear the wall.
let exitState
if (isComplete) exitState = 'complete'
else if (decisions.length || unfinished.length || failedChecks.length || failedGates.length || unmetReqs.length) exitState = 'needs-you'
else if (blockedExternal.length || blockedReqs.length) exitState = 'blocked'
else exitState = 'needs-you'

const stopReason =
  exitState === 'complete' ? 'every locked criterion proven with evidence + checks green + mandatory evidence produced'
  : exitState === 'blocked' ? `external blocker(s) — ${[...blockedExternal.map(t => t.blocker), ...blockedReqs.map(r => r.requirement)].filter(Boolean).join('; ') || 'cannot proceed without infra/creds/env'}`
  : decisions.length ? `needs your decision: ${decisions.map(d => d.question).join(' | ')}`
  : stuck ? `loop stalled (no progress) with ${unfinished.length} task(s) open — returning to you with the unmet criteria + last feedback`
  : round >= MAX_ROUNDS && remaining.length ? `hit the MAX_ROUNDS backstop (${MAX_ROUNDS}) — escalate (deep-debug) or re-run with more budget`
  : !budgetOk() ? 'stopped on budget ceiling — re-run with more budget to finish'
  : (failedChecks.length || failedGates.length || unmetReqs.length) ? 'all tasks attempted but a check / invariant gate / mandatory requirement is not satisfied'
  : 'returning to you with the unmet criteria + last feedback'

log(`Exit: ${exitState} — ${done.length}/${plan.tasks.length} tasks done, ${criteriaOut.filter(c => c.satisfied).length}/${criteriaOut.length} criteria met, ${needsDecision.length} need-decision, ${blockedExternal.length} blocked; ${unmetReqs.length} unmet requirement(s)`)

return {
  scale,
  costMode,
  exitState,
  converged: isComplete,        // kept for back-compat: true iff exitState === 'complete'
  stopReason,
  rounds: round,
  criteriaWereConfirmed: criteriaProvided,   // false → criteria were DERIVED, not human-locked (flag in the report)
  criteria: criteriaOut,
  tasks: tasksOut,
  decisions,                    // [{taskId, question, source}] — the questions a needs-you exit hands back
  checks: checks || { checks: [], invariantGates: [] },
  mandatoryRequirements: reqs,
  blockers: blockedExternal.map(t => ({ id: t.id, blocker: t.blocker })),
  coverage: {
    done: done.map(t => t.id),
    unfinished: unfinished.map(t => t.id),
    needsDecision: needsDecision.map(t => t.id),
    unmetCriteria: unmetCriteria.map(c => c.id),
    unmappedCriteria: criteriaOut.filter(c => c.unmapped).map(c => c.id),
    mandatoryUnmet: unmetReqs.map(r => r.requirement),
    mandatoryBlocked: blockedReqs.map(r => r.requirement),
    droppedToBudget: !budgetOk(),
  },
}
