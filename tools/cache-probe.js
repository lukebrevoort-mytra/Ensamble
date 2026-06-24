export const meta = {
  name: 'cache-probe',
  description: 'A/B probe: does moving a large identical block to the FRONT of the prompt convert it from uncached to cache_read? Proves whether the CONTRACT §4.3 brief reorder actually pays off. Run twice (args {order:"old"} and {order:"new"}) then analyze with tools/analyze-cache.mjs.',
  phases: [
    { title: 'Warm', detail: 'one awaited agent to populate the cache' },
    { title: 'Wave', detail: 'concurrent agents sharing the same big block — do they read it from cache?' },
  ],
}
// Sandbox: args arrives as a JSON STRING (CONTRACT §4.2) — parse it. No Date/Math.random.
const A = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {})
const order = (A && A.order) || 'new'   // 'new' = big block first (cacheable prefix); 'old' = varying line first

// A big block, byte-identical for every agent in this run, standing in for the
// profile+recon preamble. Deterministic (index-based, no Math.random).
const BLOCK = Array.from({ length: 140 }, (_, i) =>
  `L${i}: repo invariant ${i} — every pallet move preserves slot capacity, every route respects the one-way aisle rule, and the sim must stay green before any merge to the trunk.`
).join('\n')

// old: a per-agent VARYING line FIRST → the shared block is stranded after the prefix break.
// new: the big block FIRST → it forms a stable cacheable prefix; the varying line trails it.
const make = (i) => order === 'old'
  ? `You are probe specialist #${i} (unique preamble ${i}).\n\n${BLOCK}\n\nOutput only the number ${i} and nothing else. Do not use any tools.`
  : `${BLOCK}\n\n────────\nYou are probe specialist #${i}. Output only the number ${i} and nothing else. Do not use any tools.`

log(`cache-probe order=${order} — block ~${Math.round(BLOCK.length / 4)} tokens`)

// Warm: one agent, AWAITED, so its cache write lands before the wave starts.
phase('Warm')
await agent(make(0), { label: `${order}-warm`, phase: 'Warm', effort: 'low' })

// Wave: concurrent agents with the same block. If the block is a cacheable prefix (new),
// they should read it from the warm agent's cache entry; if it's stranded (old), they won't.
phase('Wave')
await parallel([1, 2, 3].map((i) => () => agent(make(i), { label: `${order}-${i}`, phase: 'Wave', effort: 'low' })))

return { order, blockChars: BLOCK.length, agents: 4 }
