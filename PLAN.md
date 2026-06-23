# PLAN — Workflow Kit, re-centered on the native Workflow tool

Living architecture doc for the pivot. The kit used to be a **prompt harness** that
treated Claude's native Workflow engine as an "optional accelerator" it never
pressed. This plan makes that engine the **center**: `/spec /execute /review` become
thin launchers that drive real, deterministic, schema-validated native workflows —
while a hard rule keeps the orchestrated subagents repo-aware and tool-aware so we
don't pay the usual orchestration tax (lost repo context, unused repo tools).

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
| **Workflows** | `workflows/{spec,execute,review}.js` | The actual native dynamic workflows. Generic scripts; take `args={profile,recon,target,...}`; orchestrate fan-out → pipeline → adversarial-verify → schema-validated result | ✅ portable |
| **Adjustment** | `commands/workflow-install.md` → `repo-profile.md` | "Dynamically enable for this repo": recon + derive roster / invariants→gate-tests / **agent types** / **repo tools** the scripts read | ✅ per-repo |
| **Entry points** | `commands/{spec,execute,review}.md` | Thin launchers: read profile → ensure recon → resolve target → **call `Workflow({name,args})`** → render the report | ✅ portable |

Ephemeral (gitignored): `.workflows/recon.md`, `.workflows/{spec,review}-<slug>.md`,
workflow run journals.

## How a command runs (the loop, using `/review`)

1. **Command (main agent)** reads `CONTRACT.md` + `repo-profile.md`, ensures
   `recon.md` is fresh, resolves the diff target (`gh pr diff` / merge-base, *not*
   assume `main`), gathers the changed-file list + canonical commands as FACTs,
   and parses `roster / invariants / tools` out of the profile.
2. It calls `Workflow({ name: 'review', args: { profile, recon, target, base,
   changedFiles, commands, roster, invariants, tools, scale, slug } })`. The command
   *instructing* this call is what satisfies the Workflow tool's opt-in requirement.
3. **`review.js`** orchestrates: Triage → Review (one specialist per matched roster
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
- `≥ 20` or user says "thorough/audit" → `thorough` (≤12 lenses, 3-vote
  perspective-diverse verify panel)
- A `budget.total` (the user's "+Nk" directive) is a hard ceiling; checks/verify
  degrade gracefully and `log()` what was dropped (no silent truncation).

## Mandatory requirements — how "change the workflow per repo" actually works (resolved)

Mechanism = **portable script + generated profile** (not bespoke scripts per repo).
The `.js` is identical everywhere; `/workflow-install` **asks the user, right at
install,** what this repo treats as non-negotiable and writes it into
`repo-profile.md` as `{ requirement, appliesWhen, requiredEvidence }`. The script
reads `args.mandatoryRequirements` and enforces it. So the workflow's *behavior* is
fully repo-specific while the code stays portable and the repo's values live in one
maintainable file (CONTRACT §4.8).

Examples the install interview captures: "any change under `web/` must show a
screenshot of the working UI (browser MCP)"; "planner changes must run the sim
scenario"; "migrations must pass the reversibility gate".

Enforcement is a **verification loop, not a one-shot block**:
- `/execute` — a verifier checks the required evidence exists; if not, work goes
  **back into the implement→verify loop** until it does (or BLOCKED ⛔ with why).
- `/review` — an unmet mandatory requirement means the verdict **cannot be APPROVE**
  (`REQUEST CHANGES`, or `BLOCK` if unverifiable).

## Rollout status

- [x] Decisions locked: reference-first; adaptive scale.
- [x] `PLAN.md` (this doc)
- [x] `CONTRACT.md` rewritten as the orchestration guideline
- [x] `workflows/review.js` — reference native workflow
- [x] `commands/review.md` — thin launcher
- [x] `templates/repo-profile.template.md` — machine-read fields (agentType, tools)
- [x] `commands/workflow-install.md` — copy `workflows/*`, emit machine-read profile
- [x] **SIGN-OFF GATE cleared** — user approved the `/review` pattern + the
      mandatory-requirements refinement, then said "build spec/execute, then validate"
- [x] `workflows/spec.js` + `commands/spec.md`
- [x] `workflows/execute.js` + `commands/execute.md` (implement→verify loop)
- [x] `docs/architecture.html` — redrawn for the Workflow-centered model
- [x] `README.md` — rewritten around the new model
- [x] Live validation: ran `/review` end-to-end on this repo's own scripts
      (run `wf_fd99a799-7e2`) — engine + schemas + pipeline confirmed working; it
      caught a real install-copy-list bug (now fixed) and two stale-doc nits (fixed)

## Validation & hardening (live runs through the real engine)

- `/review` (run `wf_fd99a799`) — engine + schemas + fan-out/verify pipeline confirmed;
  caught a real install bug + stale docs (fixed).
- `/spec` (run `wf_2248fef0`) — all four phases; produced a sharp, anchored spec.
- `/execute` (run `wf_597e1916`) — implement→verify loop on that spec; also exercises
  the per-phase compute feature via an explicit `phasePolicy`.

Bugs the validation surfaced and fixed:
- **CRITICAL — `args` arrives as a JSON string, not an object.** The Workflow tool
  delivers `args` stringified (verified by a zero-agent probe: `typeof args ==="string"`),
  so `args.x` was `undefined` and every field silently defaulted — every installed
  workflow would have run on defaults. Fixed: each script normalizes
  `const A = typeof args === 'string' ? JSON.parse(args) : (args || {})` and reads `A.x`.
- **`spec.js` lacked an empty-request guard** (found by `/spec` reviewing itself) —
  added a fail-fast `if (!request.trim()) return {error}` mirroring `execute.js`.

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
- **Q?** Should `spec.js`/`execute.js` share a common `brief()` helper via a copied
  `workflows/_lib.js`, or duplicate it per script (scripts are self-contained)? The
  Workflow tool wants self-contained scripts → lean toward duplication. Revisit when
  building spec/execute.
