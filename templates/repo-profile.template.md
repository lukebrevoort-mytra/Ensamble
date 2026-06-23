# Repo Profile — <REPO NAME>

> Repo-specific ground truth for the Spec / Execution / Review workflows.
> Written by `/workflow-install`'s retrofit (detection + a short interview) and
> maintained by humans. The workflows read this **before** doing anything and
> treat confirmed entries as FACTs. This is the layer that makes the generic
> workflows *specific* to this repo. Keep it current; it's the highest-value file.
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
change in their blast radius, and `/review` weights them by default.
- **<invariant>** — proven by: `<test/command>` — applies when: <which paths>

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
(CONTRACT §3), falling back to the generic table only for gaps. Each entry: the
role, when to spawn it, its scope, and the concrete evidence/checks it owns.
- **<Role name>** — spawn when: <signal> — scope: <paths> — owns: <the specific
  tests/commands/questions it must run and answer>

## Characteristic execution & verification mode
How a change is actually proven *done* here — this differs sharply by repo type
(eval-grounding-driven for an LLM agent; sim-scenario-driven for a simulator;
browser-flow + data-diff for a data UI; load/soak for a perf service). Spell out
the loop and the acceptance signal so `/execute` adopts it.
- **Acceptance signal:** <what actually proves correctness beyond "tests pass">
- **Inner loop:** <the per-change verify cycle for this repo>
- **Tooling/harness to drive it:** <sim runner, eval harness, browser, fixtures>

## Notes for each workflow (optional overrides)
- **Spec:** <repo-specific things specs here must always address>
- **Execution:** <e.g. always run X before declaring done>
- **Review:** <e.g. always check migration reversibility; required reviewers>
