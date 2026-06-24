export const meta = {
  name: 'profile-probe',
  description: 'Measure the profile-digest win: N fan-out agents each carrying either the FULL ~8k synthetic profile or a compact digest. Isolates the per-agent profile-injection cost (the agents do trivial work — no file reads). Run twice (args {mode:"full"} and {mode:"digest"}), analyze with tools/analyze-cache.mjs, compare.',
  phases: [{ title: 'Fanout', detail: 'N agents, each carrying the profile context for this arm' }],
}
// Sandbox: args is a JSON STRING (CONTRACT §4.2). No Date/Math.random.
const A = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {})
const mode = (A && A.mode) || 'digest'   // 'full' (today: full profile per fan-out agent) | 'digest' (proposed)
const N = (A && A.n) || 8                 // fan-out width (≈ a typical auto-scale review)

// A synthetic ~8k-token repo profile — stands for a RICH repo-profile.md (roster,
// invariants, conventions, commands, tools, architecture). Deterministic (index-based).
const section = (title, n, mk) => `## ${title}\n` + Array.from({ length: n }, (_, i) => mk(i)).join('\n')
const PROFILE = [
  '# Repo profile — AcmeWarehouse monorepo (the "ground truth" injected into every agent)',
  section('Specialist roster', 8, i => `- agent-${i} (${['Explore', 'oracle', 'verifier', 'uiux', 'general-purpose'][i % 5]}): owns subsystem ${i}; spawn when files under pkg/${i}/ change; scope pkg/${i}/**; ownsChecks: lint:${i}, test:${i}`),
  section('Invariants', 30, i => `- INV-${i}: every pallet/route/slot operation must preserve capacity-${i} and respect the one-way-aisle rule across docks; blast radius pkg/${i}; gate test: npm test -- inv-${i} (must stay green before merge)`),
  section('Conventions', 100, i => `- convention ${i}: prefer Result<T,E> over throw in service-${i}; db migrations live in db/migrations and MUST be reversible; name handlers handle${i}X; errors flow through the central reporter; mirror the existing pattern at src/service-${i}/handler.ts and its test`),
  section('Canonical commands', 10, i => `- group ${i}: build=turbo build; test=vitest run pkg/${i}; testScoped=vitest run pkg/${i} -t; lint=eslint pkg/${i}; typecheck=tsc -p pkg/${i}/tsconfig.json`),
  section('Services & MCP tools', 12, i => `- tool ${i}: mcp-service-${i} provides ${['db', 'browser', 'sim', 'tracker'][i % 4]} evidence; load with ToolSearch("select:mcp-service-${i}") before use; never guess what it would return`),
  section('Architecture notes', 80, i => `- note ${i}: subsystem ${i} communicates with ${i + 1} over the event bus; the sim harness seeds fixtures from fixtures/${i}.json; the nightly soak cycle exercises module ${i}; performance budget for hot path ${i} is 5ms p99`),
].join('\n\n')

// The proposed compact digest — the orientation every fan-out agent actually needs.
const DIGEST = [
  '# Repo orientation (digest)',
  'AcmeWarehouse — TypeScript monorepo (turbo). Prefer Result<T,E> over throw; db migrations in db/migrations must be reversible; mirror the nearest-neighbour handler + its test rather than inventing a pattern.',
  'Commands: build=turbo build · test (scoped)=vitest run <pkg> · lint=eslint <pkg> · typecheck=tsc -p <pkg>.',
  'Hard invariants (do not break): pallet/route/slot operations preserve capacity and respect the one-way-aisle rule — each has a gate test that must stay green.',
  'Use the repo MCP tools (db / browser / sim / tracker) for real evidence; read the in-scope files end-to-end and mirror their conventions.',
].join('\n')

const ctx = mode === 'full' ? PROFILE : DIGEST
const make = (i) => `${ctx}\n\n────────\nYou are fan-out reviewer #${i}. Output only the number ${i} and nothing else. Do not use any tools.`

log(`profile-probe mode=${mode} n=${N} — context ~${Math.round(ctx.length / 4)} tokens (profile ~${Math.round(PROFILE.length / 4)}, digest ~${Math.round(DIGEST.length / 4)})`)

// N fan-out agents, each carrying this arm's context. (No warm phase needed: we proved
// sibling agents don't share user-message cache, so each writes its own profile anyway —
// which is exactly the cost the digest reduces.)
phase('Fanout')
await parallel(Array.from({ length: N }, (_, i) => () => agent(make(i + 1), { label: `${mode}-${i + 1}`, phase: 'Fanout', effort: 'low' })))

return { mode, n: N, profileChars: PROFILE.length, digestChars: DIGEST.length }
