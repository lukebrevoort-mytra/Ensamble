# Workflow Kit

Three software-development workflows — `/spec`, `/execute`, `/review` — built **on
Claude Code's native Workflow engine**. Thin slash-command launchers gather repo
context and fire deterministic, schema-validated workflow scripts that fan out
specialists, adversarially verify findings, and loop until the repo's mandatory
evidence exists. An installer tunes them to whatever repo they're dropped into.

## The idea

Native workflows give determinism, managed parallel fan-out, structured output, and
budget-scaled depth — but their scripts run in a **sandbox with no filesystem
access**, so naïve use loses repo context and forgets the repo's tools. This kit
closes that gap:

- **Portable scripts** (`workflows/*.js`) — the orchestration; identical in every repo.
- **A generated profile** (`repo-profile.md`) — what makes a repo *specific*: the
  specialist roster, invariants → gate-tests, **mandatory requirements**
  (tests/cycles/MCPs/screenshots), and the tools agents may use. Produced by an
  **install-time interview**.
- **Context injection** — the launcher reads the profile fresh and passes it in;
  every spawned agent re-orients on it + the in-scope files and is told which repo
  tools to use. **No naked subagents.** Agents (not the sandboxed script) do the
  live repo work: `git`, tests, MCP.
- **Mandatory-requirement gates as a loop** — `/execute` loops implement→verify
  until the required evidence exists; `/review` refuses APPROVE without it.

See `PLAN.md` for the architecture and `docs/architecture.html` for the visual map.

## Layout

```
workflow-kit/                  ← canonical source of truth
  CONTRACT.md                  shared orchestration guideline (the brief, schemas, gates)
  workflows/                   native workflow scripts — spec.js · execute.js · review.js
  commands/                    thin launchers — spec.md · execute.md · review.md + workflow-install.md
  templates/                   repo-profile.template.md (the install fills it in)
  docs/architecture.html       visual overview (open in a browser)
  PLAN.md                      living design doc
```

Installed per-repo by `/workflow-install`:

```
<repo>/.claude/                ← committed; shared with the team
  workflow-kit/  CONTRACT.md  repo-profile.md
  commands/      spec.md execute.md review.md
  workflows/     spec.js execute.js review.js     (resolve as Workflow({name:"…"}))
<repo>/.workflows/             ← gitignored scratch — recon.md · spec-*.md · review-*.md
```

## How a command runs

1. **Launcher** (main agent) reads `CONTRACT.md` + `repo-profile.md`, ensures recon
   is fresh, and resolves the target (idea / spec path / diff).
2. It calls `Workflow({ name, args })` with the repo context (`profile`, `recon`,
   `roster`, `invariants`, `tools`, `mandatoryRequirements`, …). The command
   instructing this call is what satisfies the Workflow tool's opt-in.
3. The **script** orchestrates — fan-out → pipeline → adversarial verify → gate
   checks — and returns a **structured object** (validated by JSON schema).
4. The **launcher** renders the `CONTRACT §6` report, saves the artifact, prints
   inline.

## The three workflows

| Command | Phases | Output |
|---|---|---|
| `/spec` | Scope → Gather (parallel explorers) → Draft → Critique | `.workflows/spec-<slug>.md` |
| `/execute` | Plan → **Implement→Verify loop** (until criteria + mandatory evidence pass) → Checks | task ledger + evidence |
| `/review` | Triage → Review (specialist fan-out) → Verify (adversarial) → Checks (+ mandatory gate) | `.workflows/review-<slug>.md` + verdict |

All three scale fan-out to task size and token budget (`quick` → `thorough`).

## Install

1. **Make `/workflow-install` available globally** (symlink recommended — stays in
   sync with this repo):
   ```
   ln -sf ~/work/mytra/workflow-kit/commands/workflow-install.md \
          ~/.claude/commands/workflow-install.md
   ```
2. **In a target repo**, run `/workflow-install`. It copies the portable layer +
   the workflow scripts, runs recon, reads the design docs, **interviews you
   (including this repo's mandatory requirements and which tools to use/avoid)**, and
   writes `repo-profile.md`. The repo then has `/spec`, `/execute`, `/review`.

## Usage

```
/workflow-install        # once per repo — install + tune to this repo
/spec     <idea|ticket>  # idea → implementation-ready spec
/execute  <spec path>    # spec → implement, looping until criteria + mandatory evidence pass
/review   [pr|branch]    # diff → risk-driven review with verdict + evidence
```

Re-running `/workflow-install` updates the portable layer (CONTRACT + commands +
scripts) without touching your `repo-profile.md`.
