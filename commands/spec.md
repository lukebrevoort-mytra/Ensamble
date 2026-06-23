---
description: Spec workflow — gather repo context, then launch the native `spec` workflow (scope → explore → draft → critique) and render an implementation-ready spec
---

You are the **thin launcher** for the Spec workflow. You do **not** write the spec
yourself — you gather repo context, **call the native Workflow tool** to run the
`spec` orchestration, then render its structured result and save it for handoff.
The fact that this command instructs you to call `Workflow` is what authorizes its
opt-in; launch it without asking for further permission.

## 1 — Load the rules & profile
1. Read `.claude/ensemble/CONTRACT.md` and obey it for the whole run.
2. If `.claude/ensemble/repo-profile.md` exists, read it and treat it as ground
   truth. Parse the structured fields the workflow needs:
   - `commands` — `{build, typecheck, lint, test, testScoped}` from **Canonical commands**.
   - `roster` — `[{name, agentType, whenToSpawn, scope, ownsChecks}]`.
   - `invariants` — `[{name, blastRadius, gateTest}]`.
   - `mandatoryRequirements` — `[{requirement, appliesWhen, requiredEvidence}]`.
   - `tools` — tool/MCP/service ids reviewers should use for evidence.
   - `agentTypes` — `{explorer, coder, verifier}` mapped to real agents available
     here (default `explorer: "Explore"`, the rest `general-purpose`).
   - `phasePolicy` — `{phase: {effort, model}}` from **Phase compute policy** (optional;
     omit to use the script's built-in effort defaults — CONTRACT §4.9).
   If the profile is missing, proceed with empty values and flag the gap as a QUESTION.

## 2 — Ensure recon
Load `.workflows/recon.md` if fresh; otherwise run CONTRACT §2 recon and cache it.
Keep the recon text (or a tight summary) to pass in.

## 3 — Resolve the request
`$ARGUMENTS` is the idea/ticket/request, optionally with a scale hint
(`quick`/`thorough`). If it's a ticket reference and an issue-tracker MCP is in
`tools`, fetch the ticket body. Compute a short kebab `slug` for the artifact (you
may use the date here — the *script* cannot).

## 4 — Launch the native workflow
Call the Workflow tool — installed name first, kit `scriptPath` as fallback:
- `Workflow({ name: "spec", args })` · fallback `Workflow({ scriptPath: "<KIT>/workflows/spec.js", args })`

with `args` =
```
{ profile, recon, request, commands, roster, invariants, tools, mandatoryRequirements, agentTypes, phasePolicy, scale, slug }
```
Let the script own scoping, the parallel explorers, the draft, and the critique.

## 5 — Render the spec & hand off
The workflow returns `{ spec, critique, areasExplored, unknowns, scale }`. Render the
**CONTRACT §6 report** with the **spec as the body section** (problem · testable
acceptance criteria · affected areas + blast radius · approach · test strategy ·
risks · open questions · invariants & mandatory requirements it touches). Fold the
`critique` gaps into *Open questions*/*Risks*; if `critique.verdict` is `needs-work`,
say so and list what to resolve before building. If the workflow returns `{error}`,
surface it and recommend the fix.

Save to `.workflows/spec-<slug>.md` and **also print inline**. End with the
recommended next action — usually `/execute .workflows/spec-<slug>.md`, or the open
questions that must be answered first. Do not start implementing.

Request (idea / ticket / text, optional `quick`/`thorough`): $ARGUMENTS
