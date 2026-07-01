# Dynamic, User-Shaped Verification Gates — Design

> Enhancement to the Ensemble kit. Brainstormed + grilled 2026-07-01.
> Status: **SUPERSEDED (2026-07-01) by [`2026-07-01-dynamic-check-probe-and-prove-design.md`](./2026-07-01-dynamic-check-probe-and-prove-design.md).**
> Kept for its grilled decisions + history. **What changed:** the runtime *derive-probes-and-LLM-judge*
> mechanism below is replaced by a **frozen, recorded real-run check** run deterministically at the gate —
> dynamism moves to *capture* (record/promote the check once), determinism to the *gate* (run it every
> time). The per-run derivation this doc's thesis proposed burned tokens and made the gate
> non-reproducible; CONTRACT §4.11 now reflects the frozen-command model.

## Thesis (north star)

**Autonomous loops work really well *when the testing is great*.** The bottleneck on
agentic build-verify loops was never the loop — it's verification quality. Give a loop
great, situation-appropriate testing and it becomes both effective and trustworthy.
**Dynamic workflows are the structured way to make the testing great per task** —
without hand-authoring the right test every run.

The bet, as a causal chain:

> great testing → loops work → **dynamic per-task verification is how you get great
> testing at scale.**

Dynamism is the *means*; verification quality is the *lever*; trustworthy autonomous
termination is the *payoff*. We prove the bet by delivering and using it — validation
stays qualitative (no eval harness; see Non-goals).

## Framing: personal tool, not team infrastructure

Ensemble is a **personal productivity tool.** The clean split:

- **The kit = the shared tool** — `CONTRACT.md`, the command prompts, `workflows/*.js`.
  Distributed/installed identically everywhere.
- **The profile + gate library = personal config** — **gitignored**, per-developer, never
  assumed to be shared. You *could* commit it to share, but that's a note, not a designed
  feature. No team tier, no governance, no reviewed promotion.

This reverses the kit's current convention that `repo-profile.md` is a committed file
(`CONTRACT §7`) — a **kit-wide** change, not scoped to the new feature (see Blast radius).

## Problem

Autonomous coding loops converge on a **false "done"** — they verify against things that
can't fail interestingly (self-authored criteria, mocks, static assertions), so the loop
grades its own homework. The kit already locks criteria with a human (`CONTRACT §4.8`),
but their *content* is still too often "the suite is green" rather than "the thing works
the way a user would experience it."

## Core idea

Make the acceptance bar **user-shaped, real-tool proof**, **dynamic on three axes**
(`workflow × repo × task`), **proposed by the agent, locked by the human, proven
independently.** Where real proof genuinely can't be produced, say so (an exit state) —
never quietly downgrade to "tests passed."

## Locked decisions (grill session)

1. **Core value = dynamism as the *means* to great testing.** Verification quality is the
   lever; trustworthy termination is the payoff.
2. **Authorship = agent leads, human confirms.** Agent auto-derives and *proposes* the
   gate; human approves/edits; a *separate* agent *proves* it. The human's input is an
   always-available override, not the expected path.
3. **Feasibility pre-checked at lock time.** Intake stands the real tool up before the loop
   starts (fail fast). If it can't run → **offer the strongest labeled fallback**; human
   accepts (recorded ASSUMPTION per `§3`) or fixes the env. Never a silent downgrade.
4. **Personal tool.** All config (profile + gates) is personal and **gitignored**. No team
   tier, no shared/reviewed promotion. Sharing = committing the file yourself, undesigned.
5. **Two lifespans, both personal.** A durable **personal floor** (my invariants + primary
   real-run test + promoted style) + **ephemeral** per-task additions. Promotion moves
   ephemeral → durable, locally, no PR.
6. **Recall by `appliesWhen`.** Durable personal gates carry a blast-radius pattern,
   surfaced when a task matches. Semantic recall is later.
7. **Build execute-first.** Prove the full mechanism in `/ensemble-execute`, then
   generalize to review/debug/spec. No new workflow.
8. **Validation is qualitative.** Deliver great testing; no measurement/eval machinery.

## Design

### 1. A gate has two personal lifespans

- **Durable personal floor** — my library (gitignored): standing invariants, the repo's
  primary real-run test, and promoted per-task style. Entries carry `appliesWhen` and
  surface when a task matches.
- **Ephemeral** — additions derived for this one run, discarded after (or promoted).

At lock time the effective gate = **my recalled durable floor + this run's ephemeral
additions** — a simple two-way merge, all personal. (No team tier.)

### 2. Dynamic on three axes — `(workflow × repo × task)`

Each workflow instantiates the user-shaped bar its own way (execute → exit condition;
review → "does this diff do what it claims from the user's seat?"; debug → reproduce the
user-visible symptom; spec → `verifyBy` in user-observable terms). **First delivery:
`/ensemble-execute` only.**

### 3. User-shaped, real-tool acceptance (the "great testing")

"Done" = the change was exercised the way a user would, **by running a real tool**, and an
error would have surfaced. Not "tests are green." The *method* a gate carries:
- UI → drive the real rendered flow via browser MCP; screenshot the spinner *during* the
  async call and cleared after.
- Backend → boot the service, send real requests (`POST /quote`), assert status + body a
  client would receive.
- Sim/eval repo → run the repo's real scenario/eval harness.

### 4. propose → lock → prove

Agent inspects `(workflow, repo, task)` and proposes the *method* into `verifyBy`; the
human locks it at intake (`CONTRACT §4.10`), frozen as `args.criteria`; a *separate*
verifier re-proves it (`§4.8`). The agent can make "done" stricter, never looser.

### 5. Feasibility pre-checked at lock time

The launcher stands the real tool up (boot service, open browser MCP, locate harness)
**before** locking. Can't run → **offer the strongest labeled fallback**; human accepts
(loop proceeds; "done" carries the caveat, recorded ASSUMPTION per `§3`) or fixes the env.
No full loop burned only to block at the end; no silent downgrade.

### 6. "Hard" lives in the three exit states

The real-tool proof is a locked criterion. Can't produce it → `needs-you` (human relaxes
or supplies the env) or `blocked` (external wall). **Never `complete` on a mock or
assumption.** `CONTRACT §0`/`§3` label every residual gap so a shortfall is visible.

### 7. Intake ergonomics — same interaction at two altitudes

Both follow **detect → propose → ask → lock**:
- **Setup (`/ensemble-install`)** establishes the durable personal floor's primary
  real-run test → the (gitignored) profile. Agent detects "how do you prove it worked
  here?", proposes, asks if unsure.
- **Launch (`/ensemble-execute` intake)** sets the *ephemeral* per-task gate: a
  low-friction "here's how I'd test this," inline or prompted; agent turns free text into a
  structured `verifyBy`, echoes it to confirm. Promotable into the durable personal floor.

### 8. Recall & promotion (personal library)

Durable personal gates carry `appliesWhen`; when a new task touches the pattern the agent
surfaces the saved gate as its proposal (you still confirm/edit). Promotion = save an
ephemeral gate into the durable library — **local, no PR.**

## Blast radius — kit-wide, beyond the new feature

Making config personal reclassifies `repo-profile.md` across the *existing* kit:
- `CONTRACT §7` — `repo-profile.md` moves from "committed, human-maintained" to
  gitignored/personal.
- `/ensemble-install` — writes a gitignored profile; the installer adds it to `.gitignore`.
- `/ensemble-update` — still preserves the local (now gitignored) profile.
- All four workflows already *read* the profile — unaffected by where it's tracked.

## What's new vs. existing machinery (anti-bloat)

Most already exists — locked-criteria union, three exit states, independent verify,
launcher intake. Genuinely new/thin, all fitting the existing shape, **no new workflow**:
1. **Method-carrying `verifyBy`** — a real tool to run, not just a test name.
2. **No-spec intake path** — derive-and-propose the per-task method when there's no spec.
3. **Lock-time feasibility pre-check** — stand the tool up before locking.
4. **Personal gate library** — gitignored store + `appliesWhen` recall + promotion + the
   two-way merge at lock time.
5. **Config → personal/gitignored** — the kit-wide reclassification above.

## Non-goals

- **No team tier / governance** — no shared floor, no reviewed promotion. Personal only.
- **No eval/measurement harness** — validation is qualitative.
- **Not all four workflows** in the first pass — execute-first.
- **No semantic recall** in v1 — `appliesWhen` only.

## Trade-offs (accepted, eyes open)

- **Hard blocks more** in thin environments — the point, not a bug.
- **Real-tool proof is expensive** — fire it at the *task's gate*, not every
  micro-iteration; `§4.6` cost/budget dials bound it.
- **Personal config means no shared "done"** — each dev builds their own profile/gates;
  accepted, because the tool is personal by intent.
- **Lock-time pre-check makes intake heavier** — accepted; the honest place to pay.

## Open questions / to settle during planning

- `verifyBy` schema delta (e.g. `{method, tool, expectedEvidence}`) without breaking
  existing specs.
- Where the personal library lives (e.g. `~/.ensemble/gates/<repo>` vs a gitignored
  in-repo file) and how it's keyed to a repo.
- The line between an invariant (durable, always) and per-task style (promoted) — both
  personal now, but recall/precedence between them needs a rule.
- Lock-time pre-check UX: how long to spend standing tools up, timeouts, cheap probes.
- Promotion trigger: heuristic recurrence detection vs an explicit "save this."

## Where it touches the kit

- `CONTRACT.md` — sharpen `§4.8` (criteria carry a real-tool method; two-way merge) and
  `§4.10` (two-altitude intake, lock-time pre-check); update `§7` (profile is personal).
- `templates/repo-profile.template.md` — durable personal floor: invariants + primary
  real-run test; framed as personal config.
- `commands/ensemble-install.md` — detect → propose → ask for the real-run test; gitignore
  the profile.
- `commands/ensemble-execute.md` — low-friction per-task intake + lock-time pre-check.
- `workflows/ensemble-execute.js` — method-derivation in plan; verifier proves against the
  real tool; the durable-floor + ephemeral merge.
- **New:** the personal gate library (gitignored store + `appliesWhen` recall + promotion).
