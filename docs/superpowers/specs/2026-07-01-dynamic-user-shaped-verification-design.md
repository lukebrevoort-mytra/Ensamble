# Dynamic, User-Shaped Verification Gates — Design

> Design doc for an enhancement to the Ensemble kit. Product of a brainstorming
> session on 2026-07-01. Status: **design agreed, pending written-spec review.**

## Problem

Autonomous coding loops converge on a **false "done."** They verify against things
that can't fail in an interesting way — self-authored criteria, mocks, static
assertions — so the loop grades its own homework and stops when the homework says
pass. The kit already fights this with human-locked criteria (`CONTRACT §4.8`), but
the *content* of those criteria is still too often "the test suite is green" rather
than "the thing works the way a user would experience it."

The value proposition is a **loop-engineering tool that surfaces real errors by
running real, dynamically-chosen tools** — the actual browser on the actual view,
real HTTP against the running service, the repo's real sim/eval harness. Errors
propagate and get caught because the thing under test is *real* and *runnable*, not
because a mock agreed. "Done" must mean a real tool exercised the change and the
error would have shown up.

## Core idea

Make the loop's acceptance bar **user-shaped, real-tool proof**, that is **dynamic on
three axes** — `(workflow × repo × task)` — **proposed by the agents, locked by the
human, and proven independently.** Where that proof genuinely can't be produced, the
loop says so (an exit state) rather than quietly downgrading to "tests passed."

## Design

### 1. The two-layer gate

The acceptance gate for a run is a **union** (this is already the shape of the locked
criteria in `CONTRACT §4.8`):

- **Always-floor** — durable, per-repo, path-selected from `repo-profile.md`
  (invariants, mandatory requirements, essential tests). Can only be *strengthened*
  by a task, never waived.
- **Per-task gate** — ephemeral, derived *for this run* from the task's intent.
  Additive: it can add proof, never weaken the floor.

### 2. Three dynamism axes — `(workflow × repo × task)`

The gate is a function of all three. Each workflow instantiates the user-shaped bar
its own way:
- **`/ensemble-execute`** — the gate is the loop's exit condition.
- **`/ensemble-review`** — "does this diff do what it claims, from the user's seat?"
- **`/ensemble-debug`** — reproduce the *user-visible* symptom (reproduce is the spine).
- **`/ensemble-spec`** — `verifyBy` is authored in user-observable terms.

### 3. User-shaped, real-tool acceptance (the moat)

"Done" = the change was exercised the way a user would, **by running a real tool**,
and an error would have surfaced. Not "tests are green." Examples of the *method* a
gate carries:
- UI change → drive the real rendered flow via the browser MCP; screenshot the
  spinner *during* the async call and cleared after — not just "a screenshot exists."
- Backend change → bring the service up, send real requests (`POST /quote`), assert
  status + body shape a client would receive.
- Sim/eval repo → run the repo's real scenario/eval harness.

### 4. The trust chain — propose → lock → prove (unchanged)

- **Propose** — the agent inspects `(workflow, repo, task)` and proposes the
  verification *method* into `verifyBy`.
- **Lock** — the human confirms it at intake (`CONTRACT §4.10`); it is frozen for the
  run and passed as `args.criteria`.
- **Prove** — a *separate* verifier re-proves it with its own evidence
  (`CONTRACT §4.8` independent verification).

The agent can make "done" **stricter**, never **looser** — so dynamism never becomes
a way to launder a wrong result.

### 5. "Hard" lives in the three exit states

The real-tool, user-shaped proof is a **locked criterion**. If it can't be produced:
- `needs-you` — the human relaxes it or supplies the environment, **or**
- `blocked` — an external wall (no browser MCP, service won't start, no creds).

**Never `complete` on a mock or an assumption.** The evidence-discipline rule
(`CONTRACT §0`, `§3`) labels every residual gap (FACT / ASSUMPTION / BLOCKED) so a
shortfall is visible, not silent. This is where "hard" is enforced: hard by default;
when reality can't meet it, that is a first-class exit, never a quiet downgrade.

### 6. Intake ergonomics — the same interaction at two altitudes

A gate the human can't easily set is a gate they won't set. The human-input space
must be first-class at **two moments**, both following one ladder —
**detect → propose → ask → lock**:

- **Setup (`/ensemble-install` retrofit)** — establishes the durable floor's
  **primary real-run test**. The agent detects how a change is actually proven here
  ("how do you know it worked?"), proposes it, and if it can't determine it
  confidently, **asks the user**. The answer populates `repo-profile.md`
  ("Characteristic execution & verification mode" + essential tests / mandatory
  requirements). Durable.
- **Launch (`/ensemble-execute` intake)** — a low-friction space for "here's how I'd
  test this once done." The human can state it inline in the invocation, or the
  intake prompts for it ("how should I verify this from a user's seat? — I'll propose
  one if you don't"). The agent turns free text into a structured `verifyBy`
  criterion, echoes it back to confirm (lock), and the loop runs to it. Ephemeral for
  the run.

Same "tell me how you'd test it," two altitudes: setup sets the durable default;
launch adds/overrides for the run.

### 7. Promotable per-task gates

When a per-task gate recurs across runs, the agent offers to write it into
`repo-profile.md` (it becomes floor). **Human-approved**, so the profile learns
without accreting cruft. This is the one net-new piece of storage/machinery.

## What's new vs. existing machinery (anti-bloat check)

Most of this already exists — the locked-criteria union, the three exit states,
independent verify, the intake in the launcher. Genuinely new/thin, all fitting the
existing shape, **no new workflow**:

1. **Method-derivation** — `verifyBy` must carry *a real tool to run*, not just name a
   test. A sharpening of the spec-draft / execute-plan reasoning that already runs.
2. **The raw (no-spec) path** — the launcher must derive-and-propose the per-task
   method at intake when there is no spec to inherit acceptance criteria from.
3. **Setup-time real-run-test elicitation** — extend the `/ensemble-install` retrofit
   with the detect → propose → ask ladder for the primary real-run test.
4. **Promotion** — write-back from a recurring per-task gate into `repo-profile.md`.

This tunes the four existing workflows + the profile + the CONTRACT — consistent with
the kit's discipline (adding a workflow requires clearing the `§4.1` bar; nothing here
does).

## Trade-offs (accepted, eyes open)

- **Hard blocks more** in thin environments (no browser MCP, service won't start).
  That is the point, not a bug — better an honest `blocked` than a false `complete`.
- **Real-tool proof is expensive** — it should fire at the **task's gate**, not every
  micro-iteration. The `§4.6` cost-mode / budget dials already exist to bound it.
- **Promotion can accrete cruft** — mitigated by keeping every promotion
  human-approved.

## Open questions / to settle during planning

- Exact schema delta for `verifyBy` (today it tends to name a test; it must now carry
  `{ method, tool, expectedEvidence }` or similar without breaking existing specs).
- The promotion UX: when/how the agent notices recurrence and offers write-back
  (heuristic vs explicit "promote this" command).
- How much of the setup-time elicitation is auto-detected vs always-asked, per repo
  type.

## Where it touches the kit

- `CONTRACT.md` — sharpen `§4.8` (criteria carry a real-tool method) and `§4.10`
  (the two-altitude intake ladder).
- `templates/repo-profile.template.md` — the "primary real-run test" is the headline
  of the verification-mode section; promotion target.
- `commands/ensemble-install.md` — detect → propose → ask for the real-run test.
- `commands/ensemble-execute.md` — the low-friction "here's how I'd test this" intake.
- `workflows/ensemble-*.js` — method-derivation in spec-draft / execute-plan; verifier
  proves against the real tool.
