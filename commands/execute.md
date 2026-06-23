---
description: Execution workflow — resolve a spec, ensure a working branch, then launch the native `execute` workflow (plan → implement→verify loop → gate checks) and render a task ledger
---

You are the **thin launcher** for the Execution workflow. You do **not** implement
the spec yourself — you resolve the spec, ensure a safe branch, **call the native
Workflow tool** to run the `execute` orchestration (which loops implement→verify
until criteria and mandatory evidence are satisfied), then render its task ledger.
The fact that this command instructs you to call `Workflow` is what authorizes its
opt-in; launch it without asking for further permission.

## 1 — Load the rules & profile
1. Read `.claude/workflow-kit/CONTRACT.md` and obey it for the whole run.
2. If `.claude/workflow-kit/repo-profile.md` exists, read it as ground truth and parse:
   - `commands` — `{build, typecheck, lint, test, testScoped}`.
   - `roster` — `[{name, agentType, whenToSpawn, scope, ownsChecks}]`.
   - `invariants` — `[{name, blastRadius, gateTest}]`.
   - `mandatoryRequirements` — `[{requirement, appliesWhen, requiredEvidence}]` (the
     hard gates the implement→verify loop must satisfy, CONTRACT §4.8).
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
text in as `spec`.

## 4 — Ensure a safe working branch
This workflow **edits files**. If you're on the repo's default branch, create a
feature branch first (never implement on `main`/`master`). Record the branch name to
pass as `branch` and to report. Never discard uncommitted user changes.

## 5 — Launch the native workflow
Call the Workflow tool — installed name first, kit `scriptPath` as fallback:
- `Workflow({ name: "execute", args })` · fallback `Workflow({ scriptPath: "<KIT>/workflows/execute.js", args })`

with `args` =
```
{ profile, recon, spec, commands, roster, invariants, tools, mandatoryRequirements, agentTypes, phasePolicy, scale, slug, branch }
```
Let the script own decomposition and the implement→verify→loop-back cycle. It loops
until every acceptance criterion is met **and** the repo's mandatory evidence is
produced (e.g. a screenshot proving the UI works), or it hits its round/budget cap.

## 6 — Render the ledger & hand off
The workflow returns `{ converged, stopReason, rounds, tasks[], checks,
mandatoryRequirements, blockers, coverage }`. Render the **CONTRACT §6 report** with
the **task ledger as the body** (each task → done/blocked/unfinished + the criterion
it satisfies + evidence), and the *Evidence / checks run* table from `checks`. State
plainly which criteria are met (FACT ✓) and which are not.
- If `converged` is true → recommend `/review` of the branch.
- If not → lead with `stopReason`, list the unfinished tasks + any unmet mandatory
  requirements (and what evidence is missing), and recommend the next step (re-run
  with more budget, answer an open question, or escalate a blocker to deep-debug).

**Do not declare done unless `converged` is true.** A missing mandatory requirement
or a failing check means it is not done — say so. Save nothing unless asked; the
branch + the printed ledger are the handoff.

Spec or request (path, pasted spec, or raw text; optional `quick`/`thorough`): $ARGUMENTS
