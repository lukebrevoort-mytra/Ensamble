export const meta = {
  name: 'execute',
  description: 'Implement a spec adaptively (TDD where a test path exists), looping implement→verify until every acceptance criterion is met AND the repo\'s mandatory evidence is produced, then run the full gate checks',
  phases: [
    { title: 'Plan', detail: 'decompose the spec into small, independently verifiable tasks' },
    { title: 'Implement', detail: 'implement each open task (TDD when possible); sequential to avoid write conflicts' },
    { title: 'Verify', detail: 'a verifier re-checks each task + its mandatory evidence; misses loop back to Implement' },
    { title: 'Checks', detail: 'final canonical checks + invariant gate tests + mandatory-requirements gate' },
  ],
}

// Repo context arrives via args (the sandbox can't read the repo — CONTRACT §4.2).
// The agents this script spawns DO have full Bash/Read/Write/MCP and do the work.
// The Workflow tool delivers `args` as a JSON STRING (verified) — parse it so the
// script works whether args is a string or an already-parsed object.
const A = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {})
const profile    = (A && A.profile)    || ''
const recon      = (A && A.recon)       || ''
const spec       = (A && A.spec)        || ''   // resolved spec text, passed by /execute
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
const MAX_ROUNDS = scale === 'quick' ? 2 : scale === 'thorough' ? 4 : 3
// Implementation is expensive — keep a larger reserve so the final checks always run.
const budgetOk = () => !budget.total || budget.remaining() > 60_000

// Per-phase compute (CONTRACT §4.9) — effort-first tiering. Planning and adversarial
// verification run hot; running checks is mechanical. `phasePolicy` from the repo
// profile overrides per phase and may pin a model (never defaulted — absent →
// inherit the session model).
const phasePolicy = (A && A.phasePolicy) || {}   // { phase(lowercase): {effort, model} }
const DEFAULT_TIER = { plan: { effort: 'high' }, implement: { effort: 'medium' }, verify: { effort: 'high' }, checks: { effort: 'low' } }
function compute(phaseName) {
  const k = phaseName.toLowerCase()
  const pol = phasePolicy[k] || {}
  const def = DEFAULT_TIER[k] || {}
  const out = {}
  const effort = pol.effort || def.effort        // effort-first: relative, survives model swaps
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
function brief({ role, scope, question, evidence, schemaNote }) {
  return [
    `You are a ${role} working in THIS repository. Ground every claim in real code and command output.`,
    ``,
    `## Orient first (do not skip)`,
    `- Read the in-scope files end-to-end${scope ? `: ${scope}` : ''} and mirror neighbouring conventions.`,
    profile ? `- Repo profile = ground truth (canonical commands, invariants, conventions, "done" bar):\n<profile>\n${profile}\n</profile>` : `- No repo-profile.md exists; detect conventions from neighbouring files before changing anything.`,
    recon ? `- Cached recon (stack/layout/commands):\n<recon>\n${recon}\n</recon>` : ``,
    repoTools.length ? `\n## Repo tools\nUse these for real work/evidence (not guesses): ${repoTools.join(', ')}. Load any with ToolSearch ("select:<name>") before calling it.` : ``,
    ``,
    `## Your single job`,
    question,
    ``,
    `## Evidence discipline (CONTRACT §3)`,
    `Tag claims FACT ✓ (file:line / command output) / ASSUMPTION ~ / QUESTION ? / BLOCKED ⛔. ${evidence || ''}`,
    schemaNote || `Return ONLY the object the schema requires — it is data for the orchestrator, not a message to a human.`,
  ].filter(Boolean).join('\n')
}

const TASK_LEDGER_SCHEMA = {
  type: 'object', required: ['tasks'],
  properties: {
    tasks: { type: 'array', items: { type: 'object', required: ['id', 'description', 'criterion'], properties: {
      id: { type: 'string' }, description: { type: 'string' }, criterion: { type: 'string' },
      hasTestPath: { type: 'boolean' }, files: { type: 'array', items: { type: 'string' } },
      dependsOn: { type: 'array', items: { type: 'string' } } } } },
    notes: { type: 'string' },
  },
}
const IMPL_SCHEMA = {
  type: 'object', required: ['taskId', 'summary'],
  properties: {
    taskId: { type: 'string' }, summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testAdded: { type: 'string' }, evidence: { type: 'string' },
    blocked: { type: 'boolean' }, blockerReason: { type: 'string' },
  },
}
const TASK_VERDICT_SCHEMA = {
  type: 'object', required: ['taskId', 'satisfied', 'evidenceProduced'],
  properties: {
    taskId: { type: 'string' }, satisfied: { type: 'boolean' }, evidenceProduced: { type: 'boolean' },
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

// ── Phase 1: Plan — decompose into small, independently verifiable tasks. ─────
phase('Plan')
const plan = await agent(
  brief({
    role: 'implementation planner',
    scope: '',
    question: `Decompose this spec into small, independently verifiable tasks, sequenced by dependency. For each: a stable id, what to do, the acceptance criterion it satisfies, whether a real test path exists (hasTestPath), and the files it touches. Spec:\n"""${spec}"""`,
    evidence: 'Tasks must each map to a concrete, checkable criterion.',
  }),
  { schema: TASK_LEDGER_SCHEMA, phase: 'Plan', label: 'decompose', ...compute('Plan') }
)
if (!plan || !(plan.tasks || []).length) return { error: 'Could not decompose the spec into tasks.' }

// ledger: id -> { task, status, rounds, impl, verdict, blocker }
const ledger = {}
plan.tasks.forEach(t => { ledger[t.id] = { task: t, status: 'pending', rounds: 0 } })
const feedback = {}                 // taskId -> verifier feedback to feed the next implement attempt
let remaining = plan.tasks.slice()  // tasks not yet verified-done
let round = 0

// ── Phases 2–3: the implement→verify loop. Implement runs SEQUENTIALLY (agents
// mutate the same working tree; parallel writes would clobber each other), then
// verify runs in PARALLEL (read-only-ish), and any unmet criterion or missing
// mandatory evidence feeds back as feedback for the next round (CONTRACT §4.8).
while (remaining.length && round < MAX_ROUNDS && budgetOk()) {
  round++
  log(`Round ${round}/${MAX_ROUNDS}: implementing ${remaining.length} open task(s)`)

  phase('Implement')
  for (const t of remaining) {
    ledger[t.id].rounds = round
    const impl = await agent(
      brief({
        role: 'implementer (TDD when a test path exists)',
        scope: (t.files || []).join(', '),
        question: [
          `Implement this task: ${t.description}`,
          `It satisfies acceptance criterion: ${t.criterion}`,
          t.hasTestPath
            ? `Use TDD: write a failing test encoding the criterion → implement the minimum to pass → confirm green → refactor.`
            : `No clean test path — add a characterization test or a runtime smoke check and note it BLOCKED ⛔ on TDD.`,
          mandatory.length ? `If any mandatory requirement applies to your files, PRODUCE its evidence now (run the cycle, capture the screenshot via the browser MCP, etc.): ${mandatoryLine()}.` : ``,
          feedback[t.id] ? `\n## A previous attempt was sent back — address this and produce the missing evidence:\n${feedback[t.id]}` : ``,
          `After editing, run the scoped checks and capture real output as evidence.`,
        ].filter(Boolean).join('\n'),
        evidence: 'Report the actual files changed and the command output proving it works.',
      }),
      { schema: IMPL_SCHEMA, phase: 'Implement', agentType: coderType, label: `impl:${t.id} r${round}`, ...compute('Implement') }
    )
    ledger[t.id].impl = impl
    if (impl && impl.blocked) { ledger[t.id].status = 'blocked'; ledger[t.id].blocker = impl.blockerReason || 'blocked by implementer' }
  }

  // Verify only the tasks that didn't self-report blocked this round.
  const toVerify = remaining.filter(t => ledger[t.id].status !== 'blocked')
  phase('Verify')
  const verdicts = await parallel(toVerify.map(t => () =>
    agent(
      brief({
        role: 'task verifier (checks, never fixes)',
        scope: (t.files || []).join(', '),
        question: [
          `Independently verify the acceptance criterion is actually met WITH evidence — do not trust the implementer's claim: ${t.criterion}`,
          `Re-run the relevant scoped test/command yourself and read the changed code.`,
          mandatory.length ? `Also confirm any mandatory requirement that applies to these files was satisfied with real evidence (e.g. a screenshot of the working UI exists, the eval/sim cycle ran): ${mandatoryLine()}. If that evidence is missing, the task is NOT satisfied — state exactly what to produce.` : ``,
          `satisfied=true only if the criterion is met. evidenceProduced=true only if all applicable mandatory evidence exists. Otherwise give precise, actionable feedback for the next attempt.`,
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
    } else {
      feedback[t.id] = (v && (v.missing || v.feedback)) || 'verification failed; re-check the criterion and produce the required evidence'
      next.push(t)
    }
  })
  remaining = next
  log(`Round ${round} done — ${plan.tasks.filter(t => ledger[t.id].status === 'done').length}/${plan.tasks.length} tasks satisfied`)
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

// ── Synthesize the task ledger + convergence verdict. ─────────────────────────
const tasksOut = plan.tasks.map(t => {
  const e = ledger[t.id]
  return {
    id: t.id, criterion: t.criterion, status: e.status, rounds: e.rounds,
    evidence: (e.impl && e.impl.evidence) || '', testAdded: (e.impl && e.impl.testAdded) || '',
    blocker: e.blocker || '', lastFeedback: feedback[t.id] || '',
  }
})
const done = tasksOut.filter(t => t.status === 'done')
const blocked = tasksOut.filter(t => t.status === 'blocked')
const unfinished = tasksOut.filter(t => t.status !== 'done' && t.status !== 'blocked')
const reqs = (reqResults && reqResults.requirements) || []
const unmetReqs = reqs.filter(r => r.status === 'unmet')
const blockedReqs = reqs.filter(r => r.status === 'blocked')
const failedChecks = ((checks && checks.checks) || []).filter(c => c.result === 'fail')
const failedGates = ((checks && checks.invariantGates) || []).filter(g => g.result === 'fail')

const converged = unfinished.length === 0 && failedChecks.length === 0 && failedGates.length === 0 && unmetReqs.length === 0 && blockedReqs.length === 0
const stopReason = converged ? 'all criteria met + checks green + mandatory evidence produced'
  : round >= MAX_ROUNDS && remaining.length ? `hit MAX_ROUNDS (${MAX_ROUNDS}) with ${remaining.length} task(s) still open — escalate (deep-debug) rather than thrash`
  : !budgetOk() ? 'stopped on budget ceiling — re-run with more budget to finish'
  : 'loop exited'

log(`Converged: ${converged} — ${done.length}/${plan.tasks.length} done, ${blocked.length} blocked, ${unfinished.length} unfinished; ${unmetReqs.length} unmet requirement(s)`)

return {
  scale,
  converged,
  stopReason,
  rounds: round,
  tasks: tasksOut,
  checks: checks || { checks: [], invariantGates: [] },
  mandatoryRequirements: reqs,
  blockers: blocked.map(t => ({ id: t.id, blocker: t.blocker })),
  coverage: {
    done: done.map(t => t.id),
    unfinished: unfinished.map(t => t.id),
    mandatoryUnmet: unmetReqs.map(r => r.requirement),
    mandatoryBlocked: blockedReqs.map(r => r.requirement),
    droppedToBudget: !budgetOk(),
  },
}
