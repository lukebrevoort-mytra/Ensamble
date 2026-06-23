---
description: Review workflow — gather repo context, then launch the native `review` workflow (triage → specialist fan-out → adversarial verify → gate checks) and render a verdict with evidence
---

You are the **thin launcher** for the Review workflow. You do **not** review the
code yourself — you gather repo context, **call the native Workflow tool** to run
the `review` orchestration, then render its structured result as the report. The
fact that this command instructs you to call `Workflow` is what authorizes its
opt-in; launch it without asking the user for further permission.

## 1 — Load the rules & profile
1. Read `.claude/workflow-kit/CONTRACT.md` and obey it for the whole run.
2. If `.claude/workflow-kit/repo-profile.md` exists, read it and treat it as ground
   truth. From it, parse the structured fields the workflow needs:
   - `roster` — array of `{name, agentType, whenToSpawn, scope, ownsChecks}` from
     the **Specialist roster** section. `agentType` is the native agent to spawn
     (`Explore`/`oracle`/`verifier`/`uiux`/`general-purpose` or a custom type).
   - `invariants` — array of `{name, blastRadius, gateTest}` from **Invariants &
     gate tests**.
   - `tools` — the tool/MCP/service ids from **Services & MCP** + **execution
     mode** that reviewers should use for evidence.
   - `commands` — `{build, typecheck, lint, test, testScoped}` from **Canonical
     commands**.
   - `mandatoryRequirements` — array of `{requirement, appliesWhen, requiredEvidence}`
     from **Mandatory requirements** — this repo's install-time hard gates.
   If the profile is missing, proceed with empty arrays and flag the gap as a
   QUESTION — the workflow still runs with generic lenses.

## 2 — Ensure recon
Load `.workflows/recon.md` if fresh; otherwise run CONTRACT §2 recon and cache it.
Capture the recon text (or a tight summary) to pass to the workflow.

## 3 — Resolve the target (these become FACTs you pass in)
Parse `$ARGUMENTS`: a PR number/URL, a branch name, a scale hint (`quick` /
`thorough` / `audit`), or empty (= current branch).
- **base:** merge-base with the repo's **default branch** — detect it, don't assume
  `main` (`git symbolic-ref refs/remotes/origin/HEAD` or `gh repo view`).
- **changedFiles:** the file list in the diff (`git diff --name-only <base>...HEAD`
  or `gh pr diff --name-only`).
- **target:** the human label of what's under review (PR #, branch, or "current").
- **scale:** `quick`/`thorough` if the user said so (or "audit" → `thorough`),
  else `auto` (the workflow derives it from `changedFiles.length`).
- **slug:** a short kebab slug for the artifact filename (from the branch/PR — you
  may use the date here; the *script* cannot, so compute it now).

## 4 — Launch the native workflow
Call the Workflow tool. Prefer the installed named workflow; fall back to the kit
script by path if this repo hasn't installed it yet:
- installed:  `Workflow({ name: "review", args })`
- not yet installed:  `Workflow({ scriptPath: "<KIT>/workflows/review.js", args })`

with `args` =
```
{ profile, recon, target, base, changedFiles, commands, roster, invariants, tools, mandatoryRequirements, scale, slug }
```
Do not duplicate the orchestration here — the script owns triage, the specialist
fan-out, adversarial verification, and check-running. Let it run.

## 5 — Render the verdict & hand off
The workflow returns a structured object:
`{ verdictSuggested, riskMap, findings[], checks, mandatoryRequirements, coverage, scale }`.
Turn it into the **CONTRACT §6 report**, with the body section being the
**verdict** — finalize `verdictSuggested` yourself (`APPROVE` / `APPROVE WITH NITS`
/ `REQUEST CHANGES` / `BLOCK`), findings grouped by severity (each: file:line, why,
suggested fix), the *Evidence / checks run* table from `checks`, and explicit
**residual risks** from `coverage` (lenses capped, gates blocked, dropped-to-budget,
mandatory requirements unmet/blocked). An unmet mandatory requirement means the
verdict **cannot be APPROVE** (CONTRACT §4.8) — `REQUEST CHANGES`, or `BLOCK` if it
couldn't be verified; name the requirement and the evidence that's missing.
If the workflow returns `{error}`, surface it and recommend the fix (usually: confirm
the target resolves to a real diff, then re-run).

Save the report to `.workflows/review-<slug>.md` and **also print it inline**.
Review the code; do not fix it. If asked to fix, hand specific items to `/execute`.

Target (PR number/URL, branch, optional `quick`/`thorough`, or empty for current branch): $ARGUMENTS
