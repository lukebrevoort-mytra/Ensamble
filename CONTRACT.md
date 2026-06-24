# Ensemble — Shared Contract

The portable operating rules and output format shared by `/spec`, `/execute`, and
`/review`. **Read this once at the start of any workflow, then obey it for the whole
run.** It is intentionally generic — nothing here names a language, framework, or
repo. Everything repo-specific lives in `repo-profile.md` (written by the retrofit)
and in the ephemeral `.workflows/recon.md` cache.

This file is identical in every repo. If you want to hard-code a repo detail here,
put it in `repo-profile.md` instead.

---

## 0. Prime directive — evidence over narrative

A plausible story is not a result. Prefer a command you ran, a file:line you read,
or a test that passed over an assertion you believe. When you cannot verify
something, say so explicitly and label it. The reader must always be able to tell
**what you proved** from **what you guessed**.

---

## 1. The model — thin launcher → native workflow → structured report

These workflows are **centered on Claude's native Workflow tool**. The pieces:

- A **command** (`/spec` `/execute` `/review`) is a *thin launcher* that runs in the
  main agent: it loads context, resolves the target, then **calls the Workflow
  tool** with a named workflow and an `args` payload. A command instructing this
  call is what authorizes the Workflow tool's opt-in.
- A **workflow script** (`workflows/<name>.js`) does the orchestration —
  deterministic fan-out, pipelines, adversarial verification — and returns a
  **structured object**, not prose.
- The command renders that object into the §6 report, saves the artifact, and prints
  it. Human-facing text lives in the main agent; data lives in the workflow.

The four layers (see `PLAN.md`): **Guideline** (this file) · **Workflows**
(`workflows/*.js`) · **Adjustment** (`ensemble-install` → `repo-profile.md`) ·
**Entry points** (the commands). The first two are portable and identical
everywhere; the third is per-repo.

---

## 2. Repo recon — always orient before launching

Before launching a workflow, the command builds (or loads) a current picture of the
repo and **passes it into the workflow as `args`** (the script can't read the repo —
see §4). Cache it at `.workflows/recon.md` and reuse it across workflows/sessions.

Order of truth: `repo-profile.md` (human-confirmed) **>** `recon.md` (cached) **>**
fresh detection **>** priors. If `repo-profile.md` exists, load it first and treat it
as ground truth for commands, services, roster, invariants, and boundaries.

Detect, don't assume — find the signal, then record it:

- **Language / toolchain** — manifests: `package.json`, `Cargo.toml`, `go.mod`,
  `pyproject.toml`/`requirements.txt`, `pom.xml`/`build.gradle`, `Gemfile`,
  `composer.json`, `*.csproj`, `pubspec.yaml`, `mix.exs`, `deno.json`.
- **Repo layout** — single vs monorepo (workspaces, `packages/`, `apps/`,
  `services/`, `turbo.json`/`nx.json`/`pnpm-workspace.yaml`). Map the subsystems.
- **Build / typecheck / lint / test commands** — package scripts,
  `Makefile`/`justfile`/`Taskfile.yml`, CI configs (`.github/workflows/`,
  `.gitlab-ci.yml`), `pre-commit`, linter/formatter configs. **CI config is the most
  reliable source of the canonical commands.**
- **Test framework & how tests run** — locate tests, infer the runner, note the
  *fastest way to run a single test or scoped subset*.
- **Conventions & patterns** — before any code, find 2–3 existing examples of the
  thing and mirror them. Read `editorconfig`, lint rules, `CONTRIBUTING`/`ARCHITECTURE`/ADRs.
- **Services & tools** — anything a workflow can *use* for stronger evidence: run/dev
  commands, sim/fixture harnesses, seed data, MCP servers connected to this repo (DBs,
  browsers, issue trackers, docs). Recorded in `repo-profile.md`; honor them.

Recon is cheap relative to being wrong.

---

## 3. Evidence discipline — tag every claim

Every statement carried forward or reported is **exactly one** of:

- **FACT ✓** — verified by command output, file:line, or a passing/failing test. Cite
  the evidence inline.
- **ASSUMPTION ~** — plausible but unverified. Note *how to verify* and what breaks if
  wrong.
- **QUESTION ?** — needs a human decision or info you can't obtain. Note *what
  unblocks it*.
- **BLOCKED ⛔** — cannot proceed on this thread. Note the blocker and workarounds
  tried.

Never let an ASSUMPTION graduate to FACT without evidence. The structured output
schemas (§4.7) encode this discipline; the §6 report surfaces it.

---

## 4. Orchestration contract — how every workflow script must behave

This is the heart of the kit. A workflow that ignores §4 reintroduces exactly the
failure modes orchestration is supposed to avoid.

### 4.1 Launch from the command, orchestrate in the script

The command resolves the target and gathers repo context (§2), then calls
`Workflow({ name: '<name>', args: {...} })`. The script never asks the user
anything and never prints the final human report — it returns structured data.

**What belongs in the script vs. the launcher (the anti-bloat rule).** A workflow
script earns its lines *only* by doing what the main agent + human loop cannot:
parallel fan-out, *independent/adversarial* verification, or determinism across many
units. A phase that is inherently **sequential and needs human steering belongs in
the launcher** (conversational, in the main agent), not in the detached script — a
script can't pause to ask, so burying a steerable phase in it either thrashes or locks
the user out. Concretely: implementation is sequential and the launcher locks its
contract with the human; the *verification* of that contract is independent and
fans out — so it lives in the script. Apply this test before adding any phase or a
new workflow: if its core is sequential-and-human-steered, don't put it in a script.

### 4.2 Sandbox truths — inject static context, delegate live work

Workflow scripts run in a **restricted JS sandbox**:

- **No filesystem / Node APIs.** A script *cannot* read `repo-profile.md` or run
  `git`. ⇒ The command passes all static repo knowledge in `args` (`profile`,
  `recon`, `commands`, `roster`, `invariants`, `tools`, `target`, `base`,
  `changedFiles`, `scale`, `slug`).
- **No `Date.now()` / `Math.random()` / argless `new Date()`** (they break resume).
  ⇒ Pass any timestamp/slug via `args`; vary agents by index, not randomness.
- **But the agents a script spawns are NOT sandboxed** — they have full Bash, Read,
  and MCP access. ⇒ Let subagents do the *live* repo work: read files, run
  `git diff`/`gh pr diff`, run tests, query MCP services.

Static knowledge flows in via `args`; live evidence is gathered by the agents.

### 4.3 No naked subagents — the standard brief

**Every `agent()` prompt is built through one shared `brief()` helper** so no agent
starts blind. The brief groups the STATIC context first (one block), then the
PER-AGENT part after a delimiter.

> **Measured caveat — this ordering is structure, not a token saving (yet).** A probe
> (`tools/cache-probe.js` + `tools/analyze-cache.mjs`) showed that in the current
> harness sibling sub-agents share a prompt cache for the **system prompt + tool
> defs only** — *never* for user-message content. So the `profile` is paid per-agent
> regardless of where it sits; reordering does not move it into a shared cache.
> Keep the ordering (it's clean and future-proofs against cross-sibling caching if it
> lands), but the real cost levers are **fewer agents** (§4.6) and a **smaller
> per-agent profile**, not prompt order. Re-run the probe when the harness changes.

**Static preamble (identical all run → cacheable prefix):**
1. **Repo profile** — injected `profile` as ground truth (or "no profile — detect
   conventions from neighbouring files" when absent).
2. **Recon** — cached stack/layout/commands.
3. **Tools** — the repo tools/services/MCPs to use for real evidence, loaded with
   `ToolSearch ("select:<name>")` before use (§4.4).
4. **Human context** (review) — what the human told us at intake (intent/focus/
   out-of-scope), constant for the whole run.
5. **Evidence discipline** — tag claims per §3; a claim without evidence is a
   QUESTION, not a FACT.

**Per-agent (varies → after the delimiter):**
6. **Role** — the one specialist hat this agent wears.
7. **Orient first** — read the in-scope files end-to-end and the actual diff/hunks.
8. **Upstream context** (optional, `context` param) — a map an earlier phase already
   produced (`/review`'s Change Map, `/spec`'s scope findings, `/execute`'s plan
   notes), threaded in so the agent **reuses** it instead of re-deriving the whole
   change. Reusing upstream work is the cheapest token saving there is.
9. **Single job** — the one narrow question it must answer.
10. **Schema note** — return only the structured object; it is data, not a message.

**Profile digest — pay for the full profile only where it's needed.** The full `profile`
is the single biggest per-agent payload, and (measured — it's written per agent, never
shared across siblings) it scales with `N_agents × profile_size`. So the launcher distills
a compact **`profileDigest`** (stack · key conventions / "done" bar · must-not-break
invariants) and the brief gives **that** to **fan-out agents** (lenses, verifiers,
explorers, implementers, check-runners) while reserving the **full profile for synthesis
agents** (`fullProfile: true` — the cartographer / planner / drafter / critic that need the
whole picture). This drops the profile write on every fan-out agent — a linear saving that
grows with profile size and fan-out width (measured ~$0.5/fan-out-agent on a ~13k-token
profile; a no-op on small/empty profiles). **Fallback:** no `profileDigest` supplied (e.g.
an un-updated install) → the brief uses the full profile for everyone, so nothing regresses.

### 4.4 Tool-awareness rule

Orchestrated agents must use the repo's real tools instead of guessing. The command
passes `args.tools` (from the profile's "Services & MCP" + "execution mode"
sections); the brief names them and tells the agent to `ToolSearch` them. A UI lens
gets the browser MCP; a data lens gets the DB MCP; a sim-heavy repo gets its
scenario runner. If the profile lists no tools, the agent still has Bash/Read.

### 4.5 Specialist roster first, generic lenses to fill gaps

Spawn the repo's **named roster** (from `repo-profile.md`) **first**, each by its real
`agentType` (`Explore`, `oracle`, `verifier`, `uiux`, `general-purpose`, or a custom
type) — they were derived from this repo's architecture and beat any generic guess.
Use the generic lens table only to cover risk the roster misses:

| Signal in diff / task / recon | Generic lens |
|---|---|
| Broad "where/how" search | read-only explorer (`Explore`) |
| Auth, crypto, secrets, input handling, deserialization, SSRF/SQLi | security |
| Schema/data migrations, persistence | data-integrity & migration-safety |
| Concurrency, async, locking, shared state | race/ordering |
| Public/exported API or protocol change | compatibility & contract |
| Perf-sensitive path, hot loop, N+1, large data | performance |
| UI / frontend change | UX + accessibility (`uiux`) |
| Hard bug, murky root cause | deep-debug (`oracle`) |
| Final acceptance gate | verifier (`verifier`) — checks, never fixes |

### 4.6 Adaptive scale + cost mode + budget

Three orthogonal dials decide what a run costs. Always launch; never fix the size.

- **Scale — how much to look (thoroughness).** Derive from task size (e.g.
  changed-file count) unless the user says `quick`/`thorough`/`audit`. A `quick` task
  spawns the minimum (1–2 lenses); a `thorough` one spawns the full roster + generic
  lenses + the verify panel.
- **Cost mode — how much to spend looking.** `eco | balanced | max` (default
  `balanced`), passed as `args.costMode`, orthogonal to scale. It shifts the per-agent
  **effort** one rung (§4.9) and the discretionary **fan-out caps** (eco tightens, max
  loosens). Where cheaping out risks correctness — e.g. `/execute`'s implement→verify
  loop — cost mode touches effort only and never cuts the loop short.
  `thorough eco` is valid and useful: wide coverage at low effort.
- **Escalation ladder — spend the panel only where it's earned.** Verification runs
  one vote first; a *confident refutation* drops a finding cheaply (it's noise), while
  anything that survives or is low-confidence earns the full perspective-diverse panel
  before it's reported. Panel-grade rigor on contested findings, no panel cost on
  clear-cut ones. (`eco` never escalates; `max` always convenes the panel.) Measured at
  `thorough`: saves `(votesPerBug−1) ×` the false-positive count — $0 on a clean diff,
  up to the whole panel overhead on a noisy one.
- **Budget — the hard ceiling.** `budget.total` (the user's "+Nk" directive) bounds
  **output** tokens. Gate expensive stages on `budget.remaining()`, degrade
  gracefully, and `log()` anything dropped — silent truncation reads as "covered
  everything" when it didn't.

### 4.7 Structured output — the canonical schemas

Pass a JSON Schema to `agent({schema})` so output is validated at the tool layer
(the model retries on mismatch). This is how we recover the determinism the prose
era lacked. The canonical shapes the scripts use:

- **Finding** — `{ title, file, line, severity: high|med|low, kind:
  bug|judgment|intent-question, lens, why, suggestedFix, evidence, needsDecision,
  decision: {question, options, recommendation} }`. `kind` is required: only
  `bug` is adversarially verified (§4.6) and droppable; `judgment` /
  `intent-question` (and any absent kind) pass to the human for adjudication
  (§4.10), carrying `decision` so the launcher can present the choice.
- **Verdict** (adversarial verify) — `{ refuted: bool, confidence: high|med|low,
  reasoning }`
- **Checks** — `{ checks: [{name, command, result: pass|fail|blocked, keyLine}],
  invariantGates: [{invariant, command, result, evidence}] }`
- **Spec** — `{ problem, acceptanceCriteria: [{id, criterion, verifyBy}],
  affectedAreas, approach, testStrategy, risks, openQuestions }` (see `spec.js`).
- **TaskLedger** — `{ exitState: complete|needs-you|blocked, criteria: [{id,
  criterion, satisfied}], tasks: [{id, criterionIds, status, rounds, evidence}],
  decisions, converged, stopReason }` (see `execute.js`, §4.8).

A workflow returns one structured object; the command turns it into the §6 report.

### 4.8 The execute loop — locked criteria, independent verify, progress-based exit

`/execute` is the kit's loop-engineering primitive: the human defines "done" **once**,
up front, and the loop then runs autonomously to it. Three properties make that
autonomy *trustworthy* rather than a way to launder a wrong result:

**Locked, human-confirmed criteria (the immutable contract).** The loop is only as
good as its exit condition, so the criteria are confirmed with the human in the
*launcher* before any code is written, then frozen for the run. The launcher assembles
candidates from the spec's acceptance criteria + the applicable **mandatory
requirements** + **invariant gate tests** in blast radius + the repo's **essential
success tests**, confirms them with the human (adaptively — light when `/spec` already
vetted them, fuller for a raw request; §4.10), and passes the locked set as
`args.criteria` (`[{id, criterion, verifyBy, source}]`). The script **decomposes
against these criteria; it never re-authors them.** If reality diverges (a criterion is
wrong or impossible), the loop does **not** silently redefine "done" — it returns to the
human (the `needs-you` exit), per §5.

**Independent verification.** Implementation and verification are **separate agents**.
The verifier re-proves each criterion with its own command output / file:line — it does
not trust the implementer's claim. A loop that grades its own homework will converge on
a false "done"; the independent verify is what prevents that. A criterion is *met* only
when every task mapped to it passes the verifier with the required evidence.

**Progress-based termination (not a fixed round count).** The loop continues while
there is open work **and** the last round made progress — a criterion newly satisfied,
or genuinely new verifier feedback. A round that closes nothing new and repeats the
same feedback is the loop *spinning*: it stops and hands back rather than burning rounds
(and tokens) on the same wall. `MAX_ROUNDS` survives only as a backstop against
pathological oscillation, not as the primary exit.

The loop ends in exactly one of **three exit states**, each a distinct handoff:
- **`complete`** — every locked criterion proven with evidence, checks green, invariant
  gates green, mandatory evidence produced, no pending decision. Only this is "done."
- **`needs-you`** — a decision only the human can make (an ambiguous/underspecified
  criterion), unfinished work after a stall, or a failed check/requirement. It returns
  the *specific* question or the unmet criteria + last feedback. Settle it and re-run.
- **`blocked`** — the only thing left is an external wall (creds/env/infra/no test path)
  that no human decision unblocks; it returns what was tried and what must be cleared.

The **mandatory requirements** are one input to the locked criteria *and* a final
evidence gate: a verifier checks the required evidence was produced; if it's missing the
work loops back until it exists (or is recorded BLOCKED ⛔). In `/review`, an unmet
mandatory requirement means the verdict **cannot be APPROVE** — `REQUEST CHANGES` if
fixable, `BLOCK` if the evidence can't be gathered. "Mandatory" means mandatory: the
workflow never papers over a missing requirement, and never reports `complete` without it.

### 4.9 Per-phase compute — effort-first model/effort tiering

Not every phase needs the same horsepower: a broad exploration sweep is cheap; an
adversarial verification or a synthesis pass is expensive. Each script sets a
per-phase **compute tier** on its `agent()` calls, with two dials:

- **`effort`** (`low`/`medium`/`high`/`xhigh`/`max`) — the **primary, portable**
  lever. It is *relative* to whatever model is running, so it survives model swaps
  and respects the session model the user chose. Built-in defaults drop mechanical
  phases (running checks) to `low` and raise hard-reasoning phases (triage, verify,
  critique, plan) to `high`. The per-run `costMode` (§4.6) shifts these defaults one
  rung up (`max`) or down (`eco`); an explicit `phasePolicy` effort pin always wins
  over the dial — the repo's deliberate choice beats a per-run knob.
- **`model`** (`haiku`/`sonnet`/`opus`/`fable`) — an **optional override**, pinned
  **only** by the repo profile and **only** when a repo genuinely warrants it (e.g. a
  safety-critical repo forcing `verify` stronger). Never defaulted: absent → inherit
  the session model (per the Workflow tool's own guidance — pinning model names is
  brittle, so prefer effort).

The profile may carry a **`phasePolicy`** — `{ phase: {effort, model} }` — decided at
install; the command passes it as `args.phasePolicy` and each script merges it over
its built-in defaults via a small `compute(phase)` helper. Absent policy → defaults →
session model. This is one more axis of tuning the workflow to the repo: a giant
monorepo can make broad `gather` cheaper; a sim-heavy repo can make `verify` stronger
— without editing a script.

### 4.10 Human-in-the-loop — comprehension first, decisions owned by the user

A workflow script runs detached and its agents cannot pause to ask the user, so all
human interaction lives in the **launcher** (the command), which brackets the sweep.
This is what turns a sweeping report into a collaboration instead of a verdict handed
down — the fix for "I didn't feel involved":

- **Intake (before the workflow):** confirm who the user is and capture what only they
  know — for `/review`, author-vs-reviewer, plus focus / intent / out-of-scope; for
  `/execute`, **lock the passing criteria** (§4.8) so the loop runs to a human-confirmed
  definition of "done" — and pass it in `args` so every agent's brief honors it. A sweep
  the user never shaped — or a loop whose "done" the user never set — is exactly what
  makes them feel uninvolved.
- **Comprehension before issues:** lead the output with the **shape** of the work — a
  Change Map (intent, structure, reading order, hotspots), not a raw list of findings.
  People disengage when handed issues with no map; orient them first.
- **Separate facts from judgment:** tag findings `bug` (objective — the workflow
  adversarially verifies these) vs `judgment` / `intent-question` (opinions/questions
  — the user's call). Only the latter need adjudication.
- **Adjudication (after the workflow):** the workflow *prepares* each decision
  (question, options, recommendation); the **user makes it** and owns the final
  verdict. `verdictSuggested` is a starting point, never the last word. Scale how much
  you interrupt to the work — adjudicate what matters, list nits.

---

## 5. Dynamic readjustment — revise when reality diverges

You will be wrong about some things up front. When you hit a trigger, **stop, record
the delta, revise, continue** — never push a broken plan:

- repo structure differs from what the plan/args assumed;
- the spec is incomplete or self-contradictory;
- implementation reveals hidden coupling or an undocumented dependency;
- the intended test path is unavailable (no harness, can't run, needs creds);
- a verification step is blocked (network, secrets, flaky env);
- a PR's real risk profile differs from the first read.

The loop: **Observe** (expected vs found) → **Reframe** → **Re-plan** (smallest change)
→ **Log** it (in the workflow's returned `readjustments` and the report's
*Readjustments* section) → continue. Silent course changes are not allowed. A blocked
path is recorded BLOCKED ⛔ with the best alternative taken (e.g. no test path → add a
characterization test or runtime smoke check, and say so).

---

## 6. Output contract — every workflow ends in this shape

The launching command renders this from the workflow's structured return. Lead with
the summary; use the exact headers (workflows add their own body section — a spec, a
task ledger, a verdict — above *Recommended next action*). Scannable; cite evidence;
never pad.

```
## <Spec | Execution | Review> Report — <subject>

**Summary:** <2–4 sentences: what this is and the bottom line.>
**Confidence:** High | Medium | Low — <one line why>

### Verified facts ✓
- <claim> — evidence: <cmd output | file:line | test name>

### Assumptions ~
- <assumption> — verify by: <how> — risk if wrong: <what>

### Open questions ?
- <question> — unblocked by: <who/what>

### Risks
- [high|med|low] <risk> — mitigation: <action>

### Evidence / checks run
| check | command | result |
|---|---|---|
| <typecheck> | <cmd> | <pass/fail + key line> |

### Readjustments
- expected <X> → found <Y> → changed <Z>   (omit only if none)

### Recommended next action
- <the single most useful next step, plus alternatives if blocked>
```

If a section is empty, write "none" rather than deleting it — absence is a signal.

Alongside this inline report, every command also renders a **visual HTML artifact**
(via the Artifact tool, house style: Fraunces + Spline Sans, warm neutrals, one
terracotta accent, render-on-first-paint, no external assets) so the outcome is
legible at a glance rather than read as raw return data: `/spec` → the spec sheet,
`/execute` → the task ledger, `/review` → the change map. The workflow still returns
data only; the artifact is presentation the command adds after the run is done.

---

## 7. Artifacts — where things get written

Scripts can't write files; the **command** writes them after the workflow returns.

- Durable output goes under **`.workflows/`** in the repo root, which is
  **gitignored** (the installer adds it) — scratch/handoff space, not a deliverable.
  - `.workflows/recon.md` — cached repo profile (§2 output).
  - `.workflows/spec-<slug>.md` — specs (handoff from `/spec` to `/execute`).
  - `.workflows/review-<slug>.md` — review reports.
- Always **also print the report inline** in chat; the file is for handoff/re-use.
- The only committed, human-maintained files are this `CONTRACT.md`, the command
  prompts, the `workflows/*.js` scripts, and `repo-profile.md`. Keep that set small.
