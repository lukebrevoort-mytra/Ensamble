# PLAN — Ensemble, re-centered on the native Workflow tool

Living architecture doc for the pivot. The kit used to be a **prompt harness** that
treated Claude's native Workflow engine as an "optional accelerator" it never
pressed. This plan makes that engine the **center**: `/ensemble-spec /ensemble-execute /ensemble-review` become
thin launchers that drive real, deterministic, schema-validated native workflows —
while a hard rule keeps the orchestrated subagents repo-aware and tool-aware so we
don't pay the usual orchestration tax (lost repo context, unused repo tools).

## The thesis (what Ensemble proves)

Autonomous loops work really well **when the testing is great** — the bottleneck was
never the loop, it's verification quality. Ensemble is the proof: it makes "done" mean
**real-tool, user-shaped evidence** that the change works through the real running service
(the **live real-run gate**, CONTRACT §4.11), locked with the human up front and proven
independently. **Dynamic workflows are the means** — the gate flexes per `(workflow ×
repo × task)` so the testing is always the *right* testing without hand-authoring it each
run. Ensemble is a **personal tool**: the kit is shared, your config is personal.

## Why (the two downsides we're engineering against)

Native workflows give us determinism, managed parallel fan-out, schema-validated
output, and budget-scaled depth. Their cost, if used naively:

1. **Lost repo context** — workflow scripts run in a **sandbox with no filesystem
   access**. A `.js` workflow *cannot read* `repo-profile.md`. Fresh subagents start
   blind.
2. **Unused repo tools** — orchestrated agents don't automatically know which repo
   services / MCPs / harnesses they should use for real evidence.

## The decision that shapes everything

> The orchestration script can't see the repo, but **the agents it spawns can**
> (full Bash/Read/MCP). So: inject *static* repo knowledge (profile + recon) into
> every agent prompt via `args`, and let agents do *live* repo work (read files,
> run `git diff`, run tests) with their own tools. **No naked subagents** — every
> prompt orients on the profile + in-scope files and names the repo tools to use.

That single rule is how we keep orchestration without context loss. It is codified
in `CONTRACT.md §4`.

## Architecture — four layers

| Layer | Files | Role | Committed? |
|---|---|---|---|
| **Guideline** | `CONTRACT.md` | Orchestration contract: launch model, sandbox truths, the standard agent brief, tool-awareness rule, adaptive scale, adversarial-verify, the canonical output schemas | ✅ portable, identical everywhere |
| **Workflows** | `workflows/{ensemble-spec,ensemble-execute,ensemble-review,ensemble-debug}.js` | The actual native dynamic workflows. Generic scripts; take `args={profile,recon,target,...}`; orchestrate fan-out → pipeline → adversarial-verify → schema-validated result | ✅ portable |
| **Adjustment** | `commands/ensemble-install.md` → `repo-profile.md` | "Dynamically enable for this repo": recon + derive roster / invariants→gate-tests / **agent types** / **repo tools** / **live real-run gate** the scripts read | 🔒 per-repo, **personal/gitignored** |
| **Entry points** | `commands/{ensemble-spec,ensemble-execute,ensemble-review,ensemble-debug}.md` | Thin launchers: read profile → ensure recon → resolve target → **call `Workflow({name,args})`** → render the report | ✅ portable |

Personal (gitignored): `.claude/ensemble/repo-profile.md` — your config, which doubles as
your gate library (CONTRACT §7). Ephemeral (gitignored): `.workflows/recon.md`,
`.workflows/{spec,review}-<slug>.md`, workflow run journals.

## How a command runs (the loop, using `/ensemble-review`)

1. **Command (main agent)** reads `CONTRACT.md` + `repo-profile.md`, ensures
   `recon.md` is fresh, resolves the diff target (`gh pr diff` / merge-base, *not*
   assume `main`), gathers the changed-file list + canonical commands as FACTs,
   and parses `roster / invariants / tools` out of the profile.
2. It calls `Workflow({ name: 'ensemble-review', args: { profile, recon, target, base,
   changedFiles, commands, roster, invariants, tools, scale, slug } })`. The command
   *instructing* this call is what satisfies the Workflow tool's opt-in requirement.
3. **`ensemble-review.js`** orchestrates: Triage → Review (one specialist per matched roster
   role / risk lens) → Verify (adversarial refutation, panel when `thorough`) →
   Checks (canonical + invariant gate tests) — every prompt built through the
   standard brief. Returns a **structured** `{shape, riskMap, findings, checks,
   mandatoryRequirements, coverage, verdictSuggested, reviewerRole}` — where `shape`
   is the Change Map (intent/structure/narrative/hotspots), `riskMap` the narrowed
   triage subset, and each finding carries `kind` + `decision` for adjudication.
4. **Command** renders the `CONTRACT §5` report from that structured object,
   finalizes the verdict, saves to `.workflows/review-<slug>.md`, prints inline.

## Adaptive scale (resolved decision)

Always launch a workflow; scale fan-out to diff size and the user's token target.

- `changedFiles ≤ 3` → `quick` (≤2 lenses, single-vote verify)
- `4–19` → `auto` (≤6 lenses)
- `≥ 20` or user says "thorough/audit" → `thorough` (≤12 lenses, up to a 3-vote
  perspective-diverse verify panel — now *laddered*: see cost mode)
- A `budget.total` (the user's "+Nk" directive) is a hard ceiling; checks/verify
  degrade gracefully and `log()` what was dropped (no silent truncation).
- **Cost mode** (`eco`/`balanced`/`max`, `args.costMode`) is an orthogonal $ dial over
  scale: it shifts per-agent effort one rung and the discretionary caps, and gates the
  **verify escalation ladder** (1 vote → full panel only when a finding isn't
  *confidently* refuted, so the panel is spent only on contested findings). `/ensemble-execute`
  applies it to effort only — never to the convergence loop. See CONTRACT §4.6.

## Mandatory requirements — how "change the workflow per repo" actually works (resolved)

Mechanism = **portable script + generated profile** (not bespoke scripts per repo).
The `.js` is identical everywhere; `/ensemble-install` **asks the user, right at
install,** what this repo treats as non-negotiable and writes it into
`repo-profile.md` as `{ requirement, appliesWhen, requiredEvidence }`. The script
reads `args.mandatoryRequirements` and enforces it. So the workflow's *behavior* is
fully repo-specific while the code stays portable and the repo's values live in one
maintainable file (CONTRACT §4.8).

Examples the install interview captures: "any change under `web/` must show a
screenshot of the working UI (browser MCP)"; "planner changes must run the sim
scenario"; "migrations must pass the reversibility gate".

Enforcement is a **verification loop, not a one-shot block**:
- `/ensemble-execute` — a verifier checks the required evidence exists; if not, work goes
  **back into the implement→verify loop** until it does (or BLOCKED ⛔ with why).
- `/ensemble-review` — an unmet mandatory requirement means the verdict **cannot be APPROVE**
  (`REQUEST CHANGES`, or `BLOCK` if unverifiable).

## Rollout status

- [x] Decisions locked: reference-first; adaptive scale.
- [x] `PLAN.md` (this doc)
- [x] `CONTRACT.md` rewritten as the orchestration guideline
- [x] `workflows/ensemble-review.js` — reference native workflow
- [x] `commands/ensemble-review.md` — thin launcher
- [x] `templates/repo-profile.template.md` — machine-read fields (agentType, tools)
- [x] `commands/ensemble-install.md` — copy `workflows/*`, emit machine-read profile
- [x] **SIGN-OFF GATE cleared** — user approved the `/ensemble-review` pattern + the
      mandatory-requirements refinement, then said "build spec/ensemble-execute, then validate"
- [x] `workflows/ensemble-spec.js` + `commands/ensemble-spec.md`
- [x] `workflows/ensemble-execute.js` + `commands/ensemble-execute.md` (implement→verify loop)
- [x] `workflows/ensemble-debug.js` + `commands/ensemble-debug.md` — the **diagnose** workflow (Locate →
      always-Reproduce → Investigate fan-out → adversarial Verify → root cause + fix
      *route*). Passes the §4.1 anti-bloat test cleanly: its core is parallel hypothesis
      fan-out + *independent* reproduction + adversarial root-cause verification — none of
      it human-steered mid-run (the human decides what to do with the finished diagnosis).
      It diagnoses only; the fix routes to `/ensemble-execute` or `/ensemble-spec`, so it never overlaps
      `/ensemble-execute`'s lane.
- [x] `docs/architecture.html` — redrawn for the Workflow-centered model
- [x] `README.md` — rewritten around the new model
- [x] Live validation: ran `/ensemble-review` end-to-end on this repo's own scripts
      (run `wf_fd99a799-7e2`) — engine + schemas + pipeline confirmed working; it
      caught a real install-copy-list bug (now fixed) and two stale-doc nits (fixed)
- [x] **Live real-run verification gate (§4.11) + personal-tool reframe** — the real-tool
      "done" gate (feasibility pre-check at the lock + verification at the end) wired into
      execute/review/debug; `repo-profile.md` is now personal/gitignored config that doubles
      as the gate library (probe patterns keyed by `appliesWhen`, promotable from a run).

## Validation & hardening (live runs through the real engine)

- `/ensemble-review` (run `wf_fd99a799`) — engine + schemas + fan-out/verify pipeline confirmed;
  caught a real install bug + stale docs (fixed).
- `/ensemble-spec` (run `wf_2248fef0`) — all four phases; produced a sharp, anchored spec.
- `/ensemble-execute` (run `wf_597e1916`) — implement→verify loop on that spec; also exercises
  the per-phase compute feature via an explicit `phasePolicy`.

Bugs the validation surfaced and fixed:
- **CRITICAL — `args` arrives as a JSON string, not an object.** The Workflow tool
  delivers `args` stringified (verified by a zero-agent probe: `typeof args ==="string"`),
  so `args.x` was `undefined` and every field silently defaulted — every installed
  workflow would have run on defaults. Fixed: each script normalizes
  `const A = typeof args === 'string' ? JSON.parse(args) : (args || {})` and reads `A.x`.
- **`ensemble-spec.js` lacked an empty-request guard** (found by `/ensemble-spec` reviewing itself) —
  added a fail-fast `if (!request.trim()) return {error}` mirroring `ensemble-execute.js`.

Feature added — **per-phase compute, effort-first** (CONTRACT §4.9): `compute(phase)`
in each script sets `effort` (and an optional profile-pinned `model`) per `agent()`
call; `phasePolicy` in the profile overrides the built-in tier defaults. Effort is
the primary lever (portable, relative); model is pinned only when a repo warrants it.

## Open questions

- **RESOLVED** — mechanism = portable script + generated profile (Q1); enforcement =
  verification loop (a verifier sends work back when mandatory evidence is missing).
- **Q?** Where do installed scripts live — `.claude/workflows/*.js` (Workflow tool's
  named-workflow registry) is the assumption. The command falls back to `scriptPath`
  pointing at the kit if a repo hasn't installed them yet. Confirm during validation.
- **Q?** Should `ensemble-spec.js`/`ensemble-execute.js` share a common `brief()` helper via a copied
  `workflows/_lib.js`, or duplicate it per script (scripts are self-contained)? The
  Workflow tool wants self-contained scripts → lean toward duplication. Revisit when
  building spec/execute.
