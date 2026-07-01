# Repo Profile — <REPO NAME>

> Repo-specific ground truth for the Spec / Execution / Review workflows.
> Written by `/ensemble-install`'s retrofit (detection + a short interview) and
> maintained by humans. The workflows read this **before** doing anything and
> treat confirmed entries as FACTs. This is the layer that makes the generic
> workflows *specific* to this repo. Keep it current; it's the highest-value file.
>
> **Personal & gitignored** — your per-developer config, not shared team infra (the
> installer gitignores it). You *may* commit it to share, but nothing relies on that.
>
> Convention: prefix unverified guesses with `~` (assumption) so workflows know
> to confirm them. Confirmed entries need no prefix.

## Repo character — what this system fundamentally is
<2–4 sentences derived from the architecture/PRD docs: what this repo *is*, its
dominant axes (e.g. simulation-heavy, data-intensive UI, airgapped agent,
high-concurrency service), and what "correct" means here. This frames every
decision below. Cite the docs you read.>

## Non-negotiable invariants & their gate tests
The properties that must never regress, each paired with the *exact* check that
proves it. The workflows treat these as **automatic acceptance criteria** for any
change in their blast radius, and `/ensemble-review` weights them by default.
- **<invariant>** — proven by: `<test/command>` — applies when: <which paths>

## Essential success tests — the ground-truth "did it work?" signals
The *existing* suites/tests/checks this repo treats as the **trusted signal that a
change actually succeeded**, each with when it applies. `/ensemble-execute` assembles the
applicable ones into the **locked passing criteria** it confirms with you before the
loop runs (CONTRACT §4.8), so the loop can't declare done without them — this is how
the user guarantees the loop picks up the tests they care about, rather than relying on
the agent to infer them. Distinct from invariants (properties that never regress) and
mandatory requirements (process/evidence gates): these are the positive acceptance
signals. **Machine-read as `essentialTests: [{test, appliesWhen}]` — keep fields exact.**
- **<test/suite/command>** — `appliesWhen:` <which changes this is the success signal for>
  - e.g. **`pnpm test -- checkout/`** — appliesWhen: any change under `web/checkout/`.
  - e.g. **the planner sim scenario suite** — appliesWhen: changes to routing/planning.

## Mandatory requirements — the user's install-time gates
What this repo treats as **non-negotiable** for a change, decided by the user during
`/ensemble-install` and enforced as hard gates by the workflows (CONTRACT §4.8). Not
"properties that never regress" (those are invariants above) but **process/evidence
requirements**: a cycle that must run, a tool that must be used, an artifact that
must be produced. **Machine-read by the scripts — keep the three fields exact.**
Enforcement is a loop: `/ensemble-execute`'s verifier sends work back until the evidence
exists; `/ensemble-review` refuses APPROVE without it.
- **<requirement>** — `appliesWhen:` <which changes trigger it> — `requiredEvidence:`
  <the concrete proof: a passing test name, eval/sim output, a screenshot of the
  working UI, a soak result>
  - e.g. **UI must be shown working** — appliesWhen: any change under `web/` —
    requiredEvidence: a screenshot (via the browser MCP) of the changed view.
  - e.g. **Sim scenario must run** — appliesWhen: changes to the planner — required
    Evidence: `<sim cmd>` output showing the scenario passes.

## Stack & layout
- **Languages / toolchain:** <e.g. TypeScript + Rust; Node 20; pnpm>
- **Repo shape:** <single | monorepo>; subsystems / packages and their roles:
  - `<path/>` — <what it is, who owns it>
- **Architecture source of truth:** <ARCHITECTURE.md / docs/ / ADRs / link>

## Canonical commands
These are the exact commands the workflows run as evidence. Prefer the fastest
scoped form where one exists.
- **Install/setup:** `<cmd>`
- **Build:** `<cmd>`
- **Typecheck:** `<cmd>`
- **Lint / format:** `<cmd>`
- **Test (all):** `<cmd>`
- **Test (single / scoped):** `<cmd + how to target one test or package>`
- **Run / dev:** `<cmd>`

## Test & verification setup
- **Framework(s):** <e.g. vitest, pytest, cargo test>
- **Where tests live & naming:** <pattern>
- **Fixtures / seed data / factories:** <where, how>
- **Simulation / emulation / sandbox harness:** <if any — how to drive it>
- **Coverage / required gates before merge:** <what must be green>
- **Known-flaky / slow areas to scope around:** <if any>

## Services & MCP the agents may use
The workflows can use these for stronger, runtime evidence — name them explicitly.
- **MCP servers connected to this repo & when to use them:** <e.g. a DB MCP for
  schema checks, a browser/Playwright MCP for UI verification, an issue-tracker
  MCP for linked tickets, a docs MCP>
- **Local services / how to bring them up:** <docker compose, devcontainer, etc.>
- **External docs / dashboards / runbooks worth consulting:** <links>

## Conventions & guardrails
- **Code conventions to mirror:** <naming, error handling, module structure;
  point to 1–2 exemplar files>
- **Default branch & branch/PR conventions:** <e.g. base = `main`; branch naming>
- **Definition of done / merge bar:** <criteria that gate "done" here>
- **Do-not-touch / sensitive areas:** <generated code, vendored, secrets, infra>
- **Security-sensitive surfaces:** <auth, payments, PII paths — review hard>

## Specialist roster — this repo's standing crew (derived, not generic)
The named subagents this repo's work characteristically needs, derived from the
character + invariants above. Workflows instantiate these **by name first**
(CONTRACT §4.5), falling back to the generic lens table only for gaps.

Each entry is **machine-read by the workflow scripts**, so keep the fields exact:
- **<Role name>** — `agentType:` <native agent to spawn: `Explore` | `oracle` |
  `verifier` | `uiux` | `general-purpose` | custom> — spawn when: <signal> —
  scope: <paths> — owns: <the specific tests/commands/questions it must run and
  answer>

`agentType` must be a real agent available in this repo; when in doubt use
`general-purpose` (the role lives in the prompt the script builds, not on disk).

## Characteristic execution & verification mode
How a change is actually proven *done* here — this differs sharply by repo type
(eval-grounding-driven for an LLM agent; sim-scenario-driven for a simulator;
browser-flow + data-diff for a data UI; load/soak for a perf service). Spell out
the loop and the acceptance signal so `/ensemble-execute` adopts it.
- **Acceptance signal:** <what actually proves correctness beyond "tests pass">
- **Inner loop:** <the per-change verify cycle for this repo>
- **Tooling/harness to drive it:** <sim runner, eval harness, browser, fixtures>

## Live real-run verification (CONTRACT §4.11 — the real-tool "done" gate)
The concrete, executable form of the acceptance mode above: how the workflows prove a
change **through the real running service the way a user hits it**, not just in the test
harness. This is the highest-value gate — great real-run testing is what makes the
autonomous loop trustworthy. Present → the launcher runs it at **two touchpoints**: a
*feasibility pre-check* when criteria are locked, and *verification* after the run
(CONTRACT §4.11). **Omit this whole section** if the repo has no runnable service/flow —
the gate then does not apply. **Machine-read — keep the field labels exact.**
- **Skip when:** <changes the gate does NOT apply to — test-only, docs, infra-only, or
  paths outside the runtime-reachable surface. The launcher skips *and says so*.>
- **Boot:** `<command to start the service/flow with the branch's CURRENT config>` — so a
  config change under test is exercised for real.
- **Health signal:** <how to know it's up before probing — e.g. `GET /health` → 200, a log
  line, a port open. The launcher polls this.>
- **Real-run checks** (runnable, keyed by `appliesWhen` — the launcher **runs** the matching
  check against the real service; it does *not* invent probes per run. **This list is your
  personal gate library** — a per-task check you promote from a run lands here, keyed by
  `appliesWhen`). Each check may carry provenance from install's **Probe & Prove** (the
  highest ladder rung it actually ran green — `boot`/`smoke`/`behavioral` — and `provenAt`);
  a flow that couldn't be exercised at install is recorded `BLOCKED` honestly, never a
  fabricated green:
  - e.g. **pricing/checkout change** (`appliesWhen: api/quote/**`) — rung: smoke — provenAt:
    2026-07-01 → `curl -fsS :PORT/quote -d @fixtures/sample-cart.json | jq -e '.total==… and .tax==…'`.
  - e.g. **has an e2e/scenario harness** (`appliesWhen: …`) — rung: behavioral → the exact
    invocation, e.g. `npx playwright test orders.spec.ts`.
  - e.g. **UI view change, no assertable check** (`appliesWhen: web/**`) — rung: behavioral →
    browser-MCP recipe: open the view, assert the changed element renders; screenshot as proof.
  - e.g. **planner flow** (`appliesWhen: planner/**`) — BLOCKED: needs GPU sim host
    unavailable at install; reached rung 1 (boots, health 200).
- **Retry cap:** <max gate attempts before handing back `needs-you`; default 3>
- **Teardown:** `<command to stop the service/flow when done>`

## Phase compute policy (optional — effort-first)
Per-phase compute tiers the workflows apply to their agents (CONTRACT §4.9). **Omit
this whole section to use the built-in defaults** (mechanical phases low, hard-
reasoning phases high, model = the session model). Set `effort` to retune a phase;
pin `model` **only** when this repo genuinely needs a specific tier for a phase
(otherwise it's inherited — pinning model names is brittle). Phases by workflow:
`ensemble-spec` → scope · gather · draft · critique; `ensemble-execute` → plan · implement · verify ·
checks; `ensemble-review` → shape · review · verify · checks. Machine-read as
`phasePolicy: {phase: {effort, model}}` — keep the field names exact.
- **<phase>** — `effort:` <low|medium|high|xhigh|max> — `model:` <optional: haiku|sonnet|opus|fable>
  - e.g. **gather** — effort: low   (huge codebase; broad sweeps should stay cheap)
  - e.g. **verify** — effort: high — model: opus   (safety-critical; never under-verify)

## Notes for each workflow (optional overrides)
- **Spec:** <repo-specific things specs here must always address>
- **Execution:** <e.g. always run X before declaring done>
- **Review:** <e.g. always check migration reversibility; required reviewers>
