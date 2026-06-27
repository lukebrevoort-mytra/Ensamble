---
description: Daily repo health check (preventative) — scan what changed since the last pulse (or survey the whole repo), take its vitals, fan out specialists, adversarially verify the bugs, and synthesize a deduped morning briefing: a health score, the one thing worth your attention, and net-new vs still-open vs resolved. Runs headless on a schedule; also on demand.
---

You are the **thin launcher** for the Pulse workflow — Ensemble's daily **health
check**. You don't assess the code yourself; you gather repo context + the last run's
state, call the Workflow, and turn its structured briefing into a five-second morning
read. Pulse is the **async sibling of `/review`** (CONTRACT §4.10): `/review` brackets
its sweep with a human at runtime; Pulse runs **while you sleep**, so it must NOT hand
down a verdict — it prepares a briefing you read, and your triage (dismiss / fix) is the
loop. This command instructing you to call `Workflow` is its opt-in — launch without
re-asking permission.

> **The "single setup" is the profile you already have.** Pulse needs nothing beyond
> `repo-profile.md` (written once by `/ensemble-install`). That profile is what makes the
> same workflow assess a sim-heavy repo and a data-UI repo differently — the moat.

> **Headless = the point.** A scheduled instance (a hosted runner / cron / CI) runs this
> *same* workflow non-interactively: it loads the prior state from a store, calls
> `Workflow({name:"pulse", …})`, persists the new state, and delivers the briefing
> (a Slack message, a hosted dashboard) so an engineer wakes up to it. Steps 1–3 + the
> state-persist in step 5 are exactly what that runner does; the workflow is identical —
> only *who provides the prior state and where the briefing lands* differs (§6).

## 1 — Load the rules & profile
Read `.claude/ensemble/CONTRACT.md` (obey it all run). If
`.claude/ensemble/repo-profile.md` exists, read it as ground truth and parse:
`roster`, `invariants`, `tools`, `commands`, `mandatoryRequirements`, `phasePolicy`
(CONTRACT §4). Missing profile → empty values + flag the gap (Pulse still runs, but a
profile-less health check is generic — the value is in the repo's invariants/roster).
Then **distill a `profileDigest`** — a compact ~300–500-token orientation (stack · the
highest-signal conventions / "done" bar · the must-not-break invariants). Pass it
alongside the full `profile`: the workflow gives the digest to fan-out agents and the
full profile only to synthesis agents (CONTRACT §4.3). No profile → empty digest.

## 2 — Resolve scope, the delta window, and the prior state
Parse `$ARGUMENTS`:
- **scope** — empty/default = **`since`** (assess what changed since the last pulse — cheap,
  fresh, self-deduplicating); the word **`repo`** = a whole-repo **deep pass** (survey the
  hotspots — heavier; the weekly cadence).
- **scale** — `quick` / `thorough` / `audit` (else `auto`, derived from delta size).
- **cost** — `eco` / `max` → `costMode` (default `balanced`). Orthogonal to scale (CONTRACT
  §4.6): `eco` for the daily delta, `max` for the weekly deep pass is a sensible fleet default.

**Prior state (the dedup/trend seam).** Read `.workflows/pulse-state.json` if it exists →
`priorState = { score, openFindings, dismissed }`. None → this is the **first pulse**
(baseline; no trend yet). *(A headless runner loads this from its store instead.)*

**The delta window** (scope `since`): `prevSha = priorState.headSha`; then
`changedFiles = git diff --name-only <prevSha>...HEAD`. No prevSha (first run) → fall back
to the last day: `git log --since="24 hours ago" --name-only` (or merge-base with the
default branch). Build a human **`sinceLabel`** (e.g. `since yesterday (a1b2c3d)`).
For scope `repo`: `changedFiles = []` (the scan picks the hotspots itself).

Resolve a kebab **`runSlug`** (you may use today's date; the script cannot) and capture
**`git rev-parse --short HEAD`** — you'll store it as `headSha` for tomorrow's delta.

## 3 — Launch the native workflow
`Workflow({ name: "pulse", args })` (installed) or `Workflow({ scriptPath:
"<KIT>/workflows/pulse.js", args })` (not yet installed), with `args` =
```
{ profile, profileDigest, recon, scope, changedFiles, sinceLabel, commands, roster, invariants, tools, mandatoryRequirements, phasePolicy, scale, costMode, runSlug, priorState }
```
Let it run — it scans the delta/repo, takes vitals, fans out specialists, adversarially
refutes the bugs (so the briefing carries signal, not noise), and synthesizes the briefing.

## 4 — Render the briefing (glanceable first — this is a five-second morning read)
The workflow returns `{ score, scoreDelta, prevScore, isFirstRun, headline, state,
allClear, findings[], netNew[], stillOpen[], resolved[], vitals, mandatoryRequirements,
scan, newState, verifyStats, coverage }`.
1. **In chat — lead with the vitals, not a wall of findings:** the **score** with its
   delta arrow (`82 ↓3` / `91 ↑4` / `— first pulse`), then the one-sentence **state**,
   then **today's one thing** (`headline`: title · file · why it's first). Then a tight
   digest: **net-new** (●), **still-open** (○ — show "open N days" from `firstSeen`), and
   **resolved ✓** (celebrate fixes). List vitals (failed checks/gates, key metrics)
   compactly; on an `allClear` day say so plainly. Don't dump every finding — rank wins.
2. **A visual dashboard artifact** — render the return into a self-contained HTML page via
   the **Artifact tool** (load the `artifact-design` skill / house style: Fraunces + Spline
   Sans, warm neutrals, **one** accent — forest `#4f7a52` when healthy, terracotta `#c2502b`
   when it needs you — render-on-first-paint, no external assets). Lay it out as a morning
   dashboard: the **score** big with its delta; a small **trend sparkline** from the state
   `history`; the **headline** as the hero card; three columns **net-new / still-open /
   resolved** colored by severity (high/med/low); a **vitals strip** (checks ● gates ●
   metrics); and a quiet footer crediting the engine (fan-out across `coverage.lensesAssessed`
   + the verify ladder: `verifyStats.agentsSaved` verify-agents saved vs an always-panel pass).
   Give its URL to the user.

## 5 — Persist state + async triage (the human enters the loop here, on read)
- **Write `.workflows/pulse-state.json`:** merge `newState` with `headSha` (the sha from
  step 2) and append `{ slug: runSlug, score }` to a `history` array capped at ~14 entries
  (that's the trend sparkline). *(A headless runner persists `newState` to its store.)*
- **Triage (offer, never force) — this keeps the human owning decisions, just async:**
  - **Dismiss** a finding that's a false-positive / intentional → append its `key`
    (from the matching `findings[]` entry) to `newState.dismissed` and re-write the file,
    so Pulse **never nags it again**. Use `AskUserQuestion`, **batched**, only if there are
    findings worth triaging — never interrogate.
  - **Fix** — hand any finding to **`/execute`** (pass its title + file:line + suggestedFix),
    or just open it. Pulse reports health; it does not change code.
- Save the rendered briefing to `.workflows/pulse-<slug>.md` and print it inline.

## 6 — As a scheduled health check (the headless story, for the showcase)
The exact same `Workflow({name:"pulse"})` is what a hosted instance / cron / CI runs each
morning: load `priorState` from a store → call the workflow → persist `newState` → deliver
the briefing (a Slack ping, a hosted dashboard). The workflow is **substrate-agnostic** —
it's a pure sandboxed script; whatever can call it headlessly runs it. Suggested cadence:
a `since` pulse each weekday morning + a `repo` deep pass weekly. The dedup/trend state is
what turns a daily scan into a *health check you can actually live with* — day-2 shows
"net-new since yesterday," not the same list again.

Scope/flags ($ARGUMENTS): empty = since the last pulse · `repo` = whole-repo deep pass · optional `quick`/`thorough` and/or `eco`/`max`: $ARGUMENTS
