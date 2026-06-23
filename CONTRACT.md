# Workflow Kit — Shared Contract

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
(`workflows/*.js`) · **Adjustment** (`workflow-install` → `repo-profile.md`) ·
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
starts blind. The brief always contains, in order:

1. **Role** — the one specialist hat this agent wears.
2. **Orient first** — read the in-scope files end-to-end and the actual diff/hunks;
   plus the injected `profile` and `recon` as ground truth (or "no profile — detect
   conventions from neighbouring files" when absent).
3. **Tools** — the repo tools/services/MCPs this agent should use for real evidence,
   and that it must load them with `ToolSearch ("select:<name>")` before use (§4.4).
4. **Single job** — the one narrow question it must answer.
5. **Evidence discipline** — tag claims per §3; cite file:line; a claim without
   evidence is a QUESTION, not a FACT.
6. **Schema note** — return only the structured object; it is data, not a message.

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

### 4.6 Adaptive scale + budget

Always launch; **scale fan-out to the work**, not a fixed size:

- Derive scale from task size (e.g. changed-file count) unless the user says
  `quick`/`thorough`/`audit`.
- A `quick` task spawns the minimum (1–2 lenses, single-vote verify); a `thorough`
  one spawns the full roster + generic lenses + a 3-vote perspective-diverse verify
  panel.
- `budget.total` (the user's "+Nk" directive) is a **hard ceiling**. Gate expensive
  stages on `budget.remaining()`, degrade gracefully, and `log()` anything dropped —
  silent truncation reads as "covered everything" when it didn't.

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
- **TaskLedger** — `{ tasks: [{id, criterion, status, rounds, evidence}], converged,
  stopReason }` (see `execute.js`).

A workflow returns one structured object; the command turns it into the §6 report.

### 4.8 Mandatory requirements — the user's install-time gates

The retrofit interview asks the user, **right at install**, what this repo treats as
non-negotiable for a change: a test that must pass, a cycle that must run
(eval/sim/soak), an MCP/tool that must be used, an artifact that must be produced
(e.g. a screenshot proving a UI change works). These land in `repo-profile.md` as
`{ requirement, appliesWhen, requiredEvidence }` and reach scripts as
`args.mandatoryRequirements`. This — not editing the script — is how the workflow is
"changed to fit the repo": the portable script reads the repo's declared gates.

Enforcement is a **verification loop, not a one-shot block**. The agent should know
better than to declare done without the evidence:

- In `/execute`, a verifier checks the required evidence was produced; if it's
  missing, the work goes **back into the implement→verify loop** until it exists (or
  is recorded BLOCKED ⛔ with why).
- In `/review`, an unmet mandatory requirement means the verdict **cannot be
  APPROVE** — `REQUEST CHANGES` if fixable, `BLOCK` if the evidence can't be gathered.

"Mandatory" means mandatory: the workflow never papers over a missing requirement.

### 4.9 Per-phase compute — effort-first model/effort tiering

Not every phase needs the same horsepower: a broad exploration sweep is cheap; an
adversarial verification or a synthesis pass is expensive. Each script sets a
per-phase **compute tier** on its `agent()` calls, with two dials:

- **`effort`** (`low`/`medium`/`high`/`xhigh`/`max`) — the **primary, portable**
  lever. It is *relative* to whatever model is running, so it survives model swaps
  and respects the session model the user chose. Built-in defaults drop mechanical
  phases (running checks) to `low` and raise hard-reasoning phases (triage, verify,
  critique, plan) to `high`.
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
  know — for `/review`, author-vs-reviewer, plus focus / intent / out-of-scope — and
  pass it in `args` so every agent's brief honors it. A sweep the user never shaped is
  exactly what makes them feel uninvolved.
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
