---
description: Execution loop — lock the passing criteria with you, then run the native `execute` workflow (an autonomous implement↔verify loop that runs until every criterion is proven with evidence or it hands back to you) and render the task ledger
---

You are the **thin launcher** for the Execution loop — the kit's loop-engineering
centerpiece. You do **not** implement the spec yourself. You resolve the spec,
**lock the passing criteria with the human** (the loop's immutable definition of
"done"), ensure a safe branch, then **call the native Workflow tool** to run the
`execute` orchestration — an autonomous implement→**independent verify**→loop-back
cycle that runs until every locked criterion is proven with evidence, or until it
must hand back to you — and render its task ledger.
The fact that this command instructs you to call `Workflow` is what authorizes its
opt-in; launch it without asking for further permission. The **one** human touch is
the criteria lock in §4 — it sets the contract the loop then satisfies on its own.

## 1 — Load the rules & profile
1. Read `.claude/ensemble/CONTRACT.md` and obey it for the whole run.
2. If `.claude/ensemble/repo-profile.md` exists, read it as ground truth and parse:
   - `commands` — `{build, typecheck, lint, test, testScoped}`.
   - `roster` — `[{name, agentType, whenToSpawn, scope, ownsChecks}]`.
   - `invariants` — `[{name, blastRadius, gateTest}]`.
   - `essentialTests` — the existing suites/tests this repo treats as the ground-truth
     signal of success, and when each applies (from **Test & verification setup** /
     **Essential success tests**). These seed the criteria lock in §4.
   - `mandatoryRequirements` — `[{requirement, appliesWhen, requiredEvidence}]` (the
     hard process/evidence gates the loop must satisfy, CONTRACT §4.8).
   - `tools` — tool/MCP/service ids the implementer/verifier should use.
   - `agentTypes` — `{coder, verifier}` mapped to real agents here (default both
     `general-purpose`; use `verifier` for the verifier if this repo has it).
   - `phasePolicy` — `{phase: {effort, model}}` from **Phase compute policy** (optional;
     omit to use the script's built-in effort defaults — CONTRACT §4.9).
   If the profile is missing, proceed with empty values and flag the gap.

## 2 — Ensure recon
Load `.workflows/recon.md` if fresh; otherwise run CONTRACT §2 recon and cache it.

## 3 — Resolve the spec
Resolve `$ARGUMENTS` to a spec: a path (e.g. `.workflows/spec-*.md`) → read it;
pasted spec text → use it; a raw request with no spec → produce a lightweight inline
spec first (problem + testable acceptance criteria + test strategy). Pass the spec
text in as `spec`. Note where it came from — it sets how heavy §4 is.

## 4 — Assemble, confirm, and LOCK the passing criteria (the one human touch)
The loop is only as trustworthy as its exit condition, so **you lock "done" with the
human before any code is written** — then the loop runs autonomously to it and cannot
move the goalposts. Do this in three moves:

**a. Assemble the candidate criteria** from every source, deduped, each as
`{id, criterion, verifyBy, source}`:
- the spec's **acceptance criteria** (`source: "spec"`);
- the repo's **mandatory requirements** whose `appliesWhen` matches this change
  (`source: "mandatory"`) and **invariant gate tests** whose blast radius it touches
  (`source: "invariant"`) — these are already user-declared, so include them automatically;
- the **essential tests** from the profile that apply to this kind of change
  (`source: "essential-test"`).

**b. Confirm with the human — scale the weight to what's already vetted** (CONTRACT
§4.10; this is the adaptive lock):
- **Spec came from `/spec`** (its criteria were already critiqued) → show the assembled
  set and ask **one** light `AskUserQuestion`: *"Here's exactly what the loop will treat
  as 'done' and won't stop until it proves each with evidence. Right as-is, or is there
  an essential test / edge case / check I'm missing?"* — easy to wave through.
- **Raw request / inline spec** (nothing vetted yet) → a fuller pass: present the set,
  invite edits/additions, and confirm the `verifyBy` for any criterion that lacks one.
- **`quick` scale** → show the set for transparency but **do not block** — proceed unless
  the user objects.
Fold the user's edits/additions in (`source: "user"`). This is the *only* place you
interrupt — do not pause again mid-loop.

**c. Lock the set.** The confirmed array becomes `criteria` (immutable for the run). If
the user couldn't be reached or waved it through, still pass what you assembled and note
in the report that the criteria were assembled-not-confirmed.

## 5 — Ensure a safe working branch
This loop **edits files**. If you're on the repo's default branch, create a feature
branch first (never implement on `main`/`master`). Record the branch name to pass as
`branch` and to report. Never discard uncommitted user changes.

## 6 — Launch the native workflow
Call the Workflow tool — installed name first, kit `scriptPath` as fallback:
- `Workflow({ name: "execute", args })` · fallback `Workflow({ scriptPath: "<KIT>/workflows/execute.js", args })`

with `args` =
```
{ profile, recon, spec, criteria, commands, roster, invariants, tools, mandatoryRequirements, agentTypes, phasePolicy, scale, slug, branch }
```
`criteria` is the **locked** set from §4 — the loop decomposes against it, never
re-authors it. Let the script own decomposition and the implement→verify→loop-back
cycle: it loops while it keeps making **progress**, stopping the moment it converges,
stalls, or hits something only you can resolve (it does not grind to a fixed round count).

## 7 — Render by exit state & hand off
The workflow returns `{ exitState, converged, stopReason, rounds, criteriaWereConfirmed,
criteria[], tasks[], decisions[], checks, mandatoryRequirements, blockers, coverage }`.
`exitState` is one of **`complete` / `needs-you` / `blocked`** — lead with it; each is a
different handoff. Render two things:

1. **In chat — the CONTRACT §6 report** with the **task ledger as the body** (each task →
   done ✓ / blocked-external ⛔ / needs-decision ? / unfinished ~, the criterion id it
   advances, rounds, and evidence), the **per-criterion status** from `criteria[]` (met ✓
   / unmet — so the user sees their locked contract scored line by line), and the *Evidence
   / checks run* table from `checks`. State plainly which criteria are met (FACT ✓) and
   which are not. If `criteriaWereConfirmed` is false, say the criteria were derived, not
   human-locked.
2. **A visual artifact** — render the return object into a self-contained HTML page via the
   **Artifact tool** (load the `artifact-design` skill / house style: Fraunces + Spline
   Sans, warm neutrals, one terracotta accent, render-on-first-paint, no external assets).
   Lead with an **exit-state banner** (`exitState` + `stopReason` + `rounds`), then the
   **criteria scorecard** (each locked criterion → met/unmet, colored), the **task ledger
   as a table** (one row per task, colored by status, with its criterion id, rounds, and
   evidence), the *Evidence / checks run* table (pass/fail/blocked badges + key line), the
   mandatory requirements with their status, and the recommended next action. Give its URL.

Then branch on `exitState`:
- **`complete`** → all criteria proven; recommend `/review` of the branch.
- **`needs-you`** → lead with `stopReason`. If `decisions[]` is non-empty, present each as
  a real choice to the user (the loop stopped because the criterion is ambiguous or needs a
  call only they can make) — answer it, then re-run `/execute` so the loop continues with
  the decision settled. Otherwise list the unfinished tasks + unmet criteria + last feedback
  and recommend the next step (re-run with more budget, or escalate a hard task to deep-debug).
- **`blocked`** → lead with the external blocker(s) from `stopReason`/`blockers`; list what
  was tried and exactly what must be cleared (creds, env, infra, a missing test path) before
  a re-run can finish.

**Do not declare done unless `exitState` is `complete`.** A missing mandatory requirement,
a failing check, a pending decision, or an unmet criterion means it is not done — say so.
Save nothing unless asked; the branch + the printed ledger are the handoff.

Spec or request (path, pasted spec, or raw text; optional `quick`/`thorough`): $ARGUMENTS
