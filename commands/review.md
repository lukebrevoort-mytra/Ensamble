---
description: Review workflow — built for involvement: confirm who you are, capture your focus/intent, map the change's SHAPE, then walk you through the decisions and let YOU own the verdict (author & reviewer aware)
---

You are the **thin launcher** for the Review workflow. You do not review the code
yourself — you bracket the autonomous sweep with the human: an **intake** before it
and an **adjudication** after it, so the user understands the change's shape and owns
every decision (CONTRACT §4.10). The workflow finds + verifies; the human decides.
This command instructing you to call `Workflow` is its opt-in — launch without
re-asking permission, but DO ask the intake/adjudication questions below.

## 1 — Load the rules & profile
Read `.claude/workflow-kit/CONTRACT.md` (obey it all run). If
`.claude/workflow-kit/repo-profile.md` exists, read it as ground truth and parse:
`roster`, `invariants`, `tools`, `commands`, `mandatoryRequirements`, `phasePolicy`
(see CONTRACT §4). Missing profile → empty values + flag the gap.

## 2 — Who are you? (auto-detect, then confirm) — sets the whole tone
Detect the persona, don't assume:
- If the target is a PR, compare its author (`gh pr view <n> --json author`) to you
  (`gh api user -q .login`): **you = author** if they match, else **reviewer**.
- If it's your current branch with your own recent commits (`git log` author = you),
  lean **author**; reviewing someone else's branch → **reviewer**.
Confirm with one `AskUserQuestion` ("Are you the **author** of this change or the
**reviewer**?", recommended = detected). This sets `reviewerRole`.

## 3 — Intake: capture what only you know (one AskUserQuestion, free-text via "Other")
- **Author** → "What's the intent of this change, and is anything intentional /
  known-rough / out-of-scope I should NOT flag?" → fills `intent` + `outOfScope`.
- **Reviewer** → "What do you most want me to scrutinize (or leave blank for a
  balanced pass)?" → fills `focus`.
Keep it to **one** question with an easy "just do a balanced review" option — never
interrogate. These flow into every reviewer's brief so the sweep respects your context.

## 4 — Resolve the target (FACTs you pass in)
Parse `$ARGUMENTS` (PR number/URL, branch, scale hint `quick`/`thorough`/`audit`, or
empty = current branch). Get **base** = merge-base with the detected default branch
(don't assume `main`), **changedFiles** (`git diff --name-only <base>...HEAD` or
`gh pr diff --name-only`), **target** label, **scale** (`auto` unless told), and a
short kebab **slug** (you may use the date; the script cannot).

## 5 — Launch the native workflow
`Workflow({ name: "review", args })` (installed) or `Workflow({ scriptPath:
"<KIT>/workflows/review.js", args })` (not yet installed), with `args` =
```
{ profile, recon, target, base, changedFiles, commands, roster, invariants, tools, mandatoryRequirements, phasePolicy, reviewerRole, focus, intent, outOfScope, scale, slug }
```
Let it run — it maps the shape, fans out reviewers, tags findings `bug` /
`judgment` / `intent-question`, adversarially verifies the bugs, and runs the checks.

## 6 — Show the SHAPE first (comprehension before issues)
The workflow returns `{ shape, riskMap, findings[], checks, mandatoryRequirements,
coverage, verdictSuggested, reviewerRole }`. (`riskMap` carries the triage routing —
subsystems & risk lenses — which you may surface briefly alongside the map.) Before
any finding, present the **Change Map** so the user is oriented:
1. **In chat — a tight text map** from `shape`: the one-line **intent**; the
   **structure** (clusters by role + relationships, e.g. `core → callers → tests`);
   the **reading order** (`narrative`, numbered with file:line); the **hotspots**.
2. **A visual artifact** — render `shape` + `findings` into a self-contained HTML
   page via the **Artifact tool** (load the `artifact-design` skill / house style:
   Fraunces + Spline Sans, warm neutrals, one terracotta accent, render-on-first-
   paint, no external assets). Lay it out as a map: each `structure` cluster a box,
   `relationships` as arrows between them, findings pinned on their file's box and
   colored by severity (high/med/low) and shaped by `kind` (bug ● / judgment ◆ /
   intent-question ?), with the reading-order walk alongside. Give its URL to the user.

## 7 — Adjudication: bring the human into the decisions (default: what matters)
Separate facts from judgment:
- **Objective bugs** (`kind:"bug"`, verified): state them as facts, grouped by
  severity (file:line · why · suggestedFix). High/med bugs are also decisions below.
- **Decisions** (`kind` judgment / intent-question, or `needsDecision:true`): walk the
  user through them with `AskUserQuestion`, **batched** (group several per call; don't
  fire one prompt per finding). For each, show the workflow's prepared
  `decision.question`, its `decision.options`, and `decision.recommendation`. Let the
  user pick: **fix now / accept (with reason) / defer / dismiss (false-positive or
  intentional)**. Default scope = adjudicate judgment + intent-question + high/med;
  **list nits and low bugs** without prompting (offer "want to triage these too?").
- **Author mode:** record every accept/dismiss with the user's reason as
  *"author: intentional because …"* — this rationale goes into the artifact so the
  eventual reviewer sees it. Frame findings as "a reviewer will likely raise this".
- **Reviewer mode:** the user's picks become the review — what's REQUEST CHANGES vs
  nit vs dropped.

## 8 — The user owns the verdict
Treat `verdictSuggested` as a *starting point only*. The final verdict reflects the
user's adjudication (plus the hard gates: a failed invariant gate or unmet mandatory
requirement still can't be APPROVE — CONTRACT §4.8). State it as **their** decision,
not the bot's.

## 9 — Output & (reviewer) post-back
Write the CONTRACT §6 report to `.workflows/review-<slug>.md` and print it inline:
the Change Map, the verdict (the user's), adjudicated findings with their dispositions
and reasons, the *Evidence / checks run* table, residual risks from `coverage`, and a
link to the visual artifact.
- **Reviewer mode:** offer to post the findings the user kept as **inline PR review
  comments** (`gh pr review` / `gh api`). **Never post without explicit confirmation**;
  show exactly what will be posted first, and post only what they approve.
- **Author mode:** no posting — the annotated artifact + report is the handoff to
  whoever reviews next.

Review the code; do not fix it. If asked to fix, hand specific items to `/execute`.

Target (PR number/URL, branch, optional `quick`/`thorough`, or empty for current branch): $ARGUMENTS
