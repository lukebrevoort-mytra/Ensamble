---
description: Debug workflow — from a bug report, locate the bug, ALWAYS try to reproduce it with real failing evidence, fan out root-cause investigators grounded in that evidence, adversarially confirm the diagnosis, and hand back a documented root cause + an evidence-backed route to a fix (it diagnoses; it does not fix)
---

You are the **thin launcher** for the Debug workflow. You do **not** diagnose the bug
yourself — you gather repo context, **call the native Workflow tool** to run the
`debug` orchestration, then render its structured diagnosis and save it for handoff.
This command instructing you to call `Workflow` is what authorizes its opt-in; launch
it without asking for further permission. `/debug` **diagnoses** — it reproduces the
bug, finds the root cause, and proposes a *route* to a fix; it does **not** implement
the fix. The fix hands off to `/execute` (concrete route) or `/spec` (needs design).

## 1 — Load the rules & profile
1. Read `.claude/ensemble/CONTRACT.md` and obey it for the whole run.
2. If `.claude/ensemble/repo-profile.md` exists, read it and treat it as ground truth.
   Parse the structured fields the workflow needs:
   - `commands` — `{build, typecheck, lint, test, testScoped}` from **Canonical commands**.
   - `roster` — `[{name, agentType, whenToSpawn, scope, ownsChecks}]`.
   - `tools` — tool/MCP/service ids agents should use for evidence (DB, browser, issue
     tracker, sim/fixture harness) — these are what let an agent actually *reproduce* the bug.
   - `agentTypes` — `{explorer, coder, verifier, debugger}` mapped to real agents here.
     The workflow spawns two kinds: **`debugger`** for the root-cause *Investigation*
     (deep reasoning over code, read-only is fine — default `oracle`; set it to
     `general-purpose` if the repo has no `oracle`), and **`coder`** for *Reproduction*
     (it must WRITE and RUN a failing test, so it needs a write-capable agent; if `coder`
     is absent the workflow falls back to the full-tool default agent).
   - `phasePolicy` — `{phase: {effort, model}}` from **Phase compute policy** (optional;
     omit to use the script's built-in effort defaults — CONTRACT §4.9).
   If the profile is missing, proceed with empty values and flag the gap as a QUESTION.
3. **Distill a `profileDigest`** — a compact ~300–500-token orientation (stack · key
   conventions · the test/repro harness · must-not-break invariants) for fan-out agents.
   Pass it with the full `profile`: the workflow gives synthesis agents (the triage/locate
   pass) the full profile and the parallel investigators the digest (CONTRACT §4.3). No
   profile → leave `profileDigest` empty (the workflow then uses the full profile for all).

## 2 — Ensure recon
Load `.workflows/recon.md` if fresh; otherwise run CONTRACT §2 recon and cache it. The
**test/sim/fixture harness and how to run a single scoped test** matter most here — the
reproduction phase needs them. Keep the recon text (or a tight summary) to pass in.

## 3 — Resolve the bug report
`$ARGUMENTS` is the **bug report** — the symptom, repro steps, environment, and any logs
or stack trace, optionally with a scale hint (`quick`/`thorough`) and/or a cost hint
(`eco`/`max` → `costMode`, default `balanced`). `scale` sets how many root-cause
hypotheses to chase; `costMode` sets spend — orthogonal dials (CONTRACT §4.6).
- If it's a ticket/issue reference and an issue-tracker MCP is in `tools`, **fetch the
  issue body, comments, and any attached logs** and fold them into the report text.
- If the report is too thin to act on (no symptom, no path to reproduce), ask **one**
  light `AskUserQuestion` to capture the missing symptom / repro steps / affected area —
  do not interrogate; a rough report is fine, the workflow will try to reproduce regardless.
- Compute a short kebab `slug` for the artifact (you may use the date here — the *script*
  cannot).

## 4 — Launch the native workflow
Call the Workflow tool — installed name first, kit `scriptPath` as fallback:
- `Workflow({ name: "debug", args })` · fallback `Workflow({ scriptPath: "<KIT>/workflows/debug.js", args })`

with `args` =
```
{ profile, profileDigest, recon, bugReport, commands, roster, tools, agentTypes, phasePolicy, scale, costMode, slug }
```
Let the script own it: locate + hypothesize, **always attempt reproduction**, fan out one
investigator per hypothesis grounded in the reproduction evidence, and adversarially
verify the leading diagnosis.

## 5 — Render the diagnosis & hand off
The workflow returns `{ reproduction, diagnosis, fixRoute, hypothesesConsidered, ruledOut,
affectedAreas, confidence, coverage }`. If it returns `{error}`, surface it and recommend
the fix (skip the artifact). Otherwise render two things:

1. **In chat — the CONTRACT §6 report**, with the **diagnosis as the body section**, in
   this order (reproduction leads — it's the spine of the run):
   - **Reproduction** — front and center: reproduced ✓/✗, the exact `command`, the
     `observedBehavior` vs `expectedBehavior`, and the `failureEvidence` (the real
     stack/assertion/output). If `reproduced` is false, state it plainly and surface
     `notesIfUnreproduced` (what was tried, what reproduction needs) — and mark the whole
     diagnosis an ASSUMPTION ~, not a FACT.
   - **Root cause** — `diagnosis.rootCause` at `location`, the `mechanism` tying it to the
     reproduced failure, tagged FACT ✓ only if reproduced **and** `verified`; otherwise
     ASSUMPTION ~. List `diagnosis.refutations` if the leading lead survived contested verify.
   - **Alternatives ruled out** — `ruledOut` (hypothesis → why), so the reader trusts the
     diagnosis converged rather than guessed.
   - **Route to a fix** — `fixRoute` (summary · approach · files · `testToProveFixed`),
     explicitly framed as a *proposed route, not an applied fix*.
   Map the pieces onto the §6 headers: reproduction + root cause → *Verified facts* /
   *Assumptions*; `ruledOut` and open leads → *Open questions*; `fixRoute` risks → *Risks*;
   the reproduction command + any checks → *Evidence / checks run*.
2. **A visual artifact** — render the diagnosis into a self-contained HTML page via the
   **Artifact tool** (load the `artifact-design` skill / house style: Fraunces + Spline
   Sans, warm neutrals, one terracotta accent, render-on-first-paint, no external assets).
   Lay it out as a **diagnosis card**, top to bottom: the **symptom** → a **reproduction
   panel** (the command + the verbatim failure evidence, with a clear reproduced ✓/✗
   badge) → the **root cause** at its file:line with the mechanism → the **ruled-out
   hypotheses** (struck through) → the **route to a fix**, with a confidence chip. Give
   its URL to the user.

Save the §6 report to `.workflows/debug-<slug>.md` and **also print inline**. End with the
recommended next action:
- a **confirmed, reproduced** diagnosis with a concrete route → offer `/execute` (or
  `/spec` if `fixRoute.handoff` is `spec`), wiring in `testToProveFixed` as the regression test;
- an **unreproduced or unconfirmed** diagnosis → recommend what would confirm it (the
  missing env/creds/data, or a `/spec` to design the investigation further) before fixing.

Do not implement the fix yourself — `/debug` diagnoses; the fix is a separate, human-owned step.

Bug report (symptom / repro steps / env / logs / ticket ref, optional `quick`/`thorough` and/or `eco`/`max`): $ARGUMENTS
