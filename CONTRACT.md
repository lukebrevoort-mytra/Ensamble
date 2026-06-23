# Workflow Kit — Shared Contract

The portable operating rules and output format shared by `/spec`, `/execute`,
and `/review`. **Read this once at the start of any workflow, then obey it for
the whole run.** It is intentionally generic — nothing here names a language,
framework, or repo. Everything repo-specific lives in `repo-profile.md` (written
by the retrofit) and in the ephemeral `.workflows/recon.md` cache.

This file should be identical in every repo. If you find yourself wanting to
hard-code a repo detail here, put it in `repo-profile.md` instead.

---

## 0. Prime directive — evidence over narrative

A plausible story is not a result. Prefer a command you ran, a file:line you
read, or a test that passed over an assertion you believe. When you cannot
verify something, say so explicitly and label it. The reader must always be able
to tell **what you proved** from **what you guessed**.

---

## 1. Repo recon — always orient before acting

Before doing the workflow's real work, build (or load) a current picture of the
repo. **Cache it** at `.workflows/recon.md` and reuse it across workflows and
sessions; refresh a section when you touch an area it got wrong.

Order of truth: `repo-profile.md` (human-confirmed) **>** `recon.md` (cached) **>**
fresh detection **>** your priors. If `repo-profile.md` exists, load it first and
treat it as ground truth for commands, services, and boundaries.

Detect, don't assume — look for the signal, then record what you found:

- **Language / toolchain** — manifest files: `package.json`, `Cargo.toml`,
  `go.mod`, `pyproject.toml`/`setup.py`/`requirements.txt`, `pom.xml`/`build.gradle`,
  `Gemfile`, `composer.json`, `*.csproj`, `pubspec.yaml`, `mix.exs`, `deno.json`.
- **Repo layout** — single vs monorepo (workspaces, `packages/`, `apps/`,
  `services/`, `turbo.json`/`nx.json`/`pnpm-workspace.yaml`/Cargo workspace). Map
  the top-level subsystems and their boundaries.
- **Build / typecheck / lint / test commands** — `package.json` scripts,
  `Makefile`/`justfile`/`Taskfile.yml`, `tox.ini`, CI configs
  (`.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`), `pre-commit-config`,
  formatter/linter configs (eslint, prettier, ruff, black, clippy, gofmt). The CI
  config is the most reliable source of the *canonical* commands.
- **Test framework & how tests are run** — locate existing tests, infer the
  runner, and note the *fastest way to run a single test or a scoped subset*.
- **Conventions & similar patterns** — before writing code, find 2–3 existing
  examples of the thing you're about to do and match their structure, naming,
  error handling, and test style. Read `editorconfig`, lint rules, and any
  `CONTRIBUTING`/`ARCHITECTURE`/ADR docs.
- **Architecture & docs** — `README`, `docs/`, `ARCHITECTURE.md`, ADRs, package
  README files. Note where the source of truth for design lives.
- **Available services & tools** — anything the workflows can *use* for stronger
  evidence: local run/dev commands, simulation or fixture harnesses, seed data,
  MCP servers connected to this repo (DBs, browsers, issue trackers, docs). These
  are usually recorded in `repo-profile.md`; honor them.

Recon is cheap relative to being wrong. When unsure, delegate the sweep to a
read-only search subagent (see §3) and cache the conclusion.

---

## 2. Evidence discipline — tag every claim

Every statement you carry forward or report is **exactly one** of:

- **FACT ✓** — verified by command output, file:line, or a passing/failing test.
  Cite the evidence inline.
- **ASSUMPTION ~** — plausible but unverified. Note *how it could be verified* and
  what breaks if it's wrong.
- **QUESTION ?** — needs a human/maintainer decision or info you can't obtain.
  Note *what unblocks it*.
- **BLOCKED ⛔** — cannot proceed on this thread. Note the blocker and the
  workarounds you already tried.

Never let an ASSUMPTION graduate to FACT without evidence. If you state something
as fact, a reader must be able to click the citation and see it. Promote
assumptions to facts only by verifying them, and say when you did.

---

## 3. Dynamic roles — generate specialists at runtime, don't rely on fixed files

Do **not** depend on a library of permanent role files. Decide *from the recon
and the task* which specialists you need, then **author each role prompt at
runtime** and spawn it with the Agent tool. The role prompt should name: the
specific files/area in scope, the single question the agent must answer, the
evidence it must return, and the output schema (use the §5 contract).

**Roster precedence — this is the superpower.** No two repos need the same crew:
a sim-heavy k8s repo wants scenario-runners and cluster-state inspectors; a
data-intensive UI repo wants browser-driving and visual/data-diff reviewers; an
airgapped LLM agent wants invariant guardians and grounding evaluators. So:

1. If `repo-profile.md` defines a **Specialist roster** and **Invariants & gate
   tests**, those are this repo's *standing crew and acceptance gates* — instantiate
   them **first**, by name, and run their owned gate tests. They were derived from
   this repo's architecture; they beat any generic guess.
2. Use the generic table below only as a **portable fallback** — to fill risk
   lenses the roster doesn't cover, or in a repo with no profile yet.

Generic fallback — spawn a role only when the signal is present:

| Signal in the diff / task / recon | Spawn a role focused on… |
|---|---|
| Broad "where does X live / how is Y done" search | read-only explorer (use `Explore`) |
| Auth, crypto, secrets, input handling, deserialization, SSRF/SQLi surface | security reviewer |
| Schema/data migrations, persistence changes | data-integrity & migration-safety reviewer |
| Concurrency, async, locking, shared state | race/ordering reviewer |
| Public API / exported interface / protocol change | compatibility & contract reviewer |
| Perf-sensitive path, hot loop, N+1, large data | performance reviewer |
| UI / frontend change | UX + accessibility reviewer (`uiux` if available) |
| Hard bug, repeated failure, murky root cause | deep-debug investigator (`oracle` if available) |
| Final acceptance gate | verifier (`verifier` if available) — checks, never fixes |

Prefer the repo's named agents (`Explore`, `oracle`, `verifier`, `uiux`,
`general-purpose`) **if they exist**; otherwise spawn `general-purpose` with the
role baked into the prompt. The role lives in the *prompt*, not on disk. Launch
independent roles in a single batch so they run in parallel, give each a
**narrow** scope, and synthesize their structured findings yourself — never dump
raw subagent output. For very large fan-outs the Workflow tool is an optional
accelerator, but the portable default is batched Agent calls.

---

## 4. Dynamic readjustment — revise when reality diverges

You are expected to be wrong about some things up front. When you hit one of
these triggers, **stop, record the delta, revise, and continue** — do not push a
broken plan forward:

- the repo structure differs from what the plan assumed;
- the spec is incomplete or self-contradictory;
- implementation reveals hidden coupling or an undocumented dependency;
- the intended test path is unavailable (no harness, can't run, needs creds);
- a verification step is blocked (network, secrets, flaky env);
- a PR's real risk profile differs from the first read.

The readjust loop: **Observe** (what did I expect vs find?) → **Reframe** (what
does this change?) → **Re-plan** (smallest change to the task list/approach) →
**Log** it in the report's *Readjustments* section → continue. Every readjustment
is visible in the final output; silent course changes are not allowed. If a
chosen path is blocked, record it as BLOCKED ⛔ and switch to the best available
alternative (e.g. test path unavailable → add a characterization test or a
runtime smoke check and say so).

---

## 5. Output contract — every workflow ends in this shape

Lead with the summary. Use the exact section headers below (workflows add their
own body section — a spec, a task ledger, a verdict — above *Recommended next
action*). Keep it scannable; cite evidence; never pad.

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

## 6. Artifacts — where things get written

- All durable workflow output goes under **`.workflows/`** in the repo root, which
  is **gitignored** (the installer adds it). It is a scratch/handoff space, not a
  committed deliverable.
  - `.workflows/recon.md` — cached repo profile (this contract's §1 output).
  - `.workflows/spec-<slug>.md` — specs (handoff from `/spec` to `/execute`).
  - `.workflows/review-<slug>.md` — review reports.
- Always **also print the report inline** in chat; the file is for handoff and
  re-use across sessions, not a substitute for talking to the user.
- The only committed, human-maintained files are this `CONTRACT.md`, the three
  command prompts, and `repo-profile.md`. Keep that set small.
