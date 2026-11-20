# JavaScript Reverse-Engineering Domain

Apply this module when the task concerns a web front end, a JavaScript bundle, a Node.js service, browser runtime behavior, request signing, or JavaScript-driven application logic.

## Analysis surfaces

- **Entry and routing** — page URLs, route transitions, workers, service workers, and dynamically loaded chunks.
- **Network behavior** — request construction, parameter provenance, headers, cookies, signing inputs, response transforms, retries, and error paths.
- **Bundle structure** — modules, chunk boundaries, source maps, bundler runtime, string tables, and lazy-loaded code.
- **Runtime evidence** — breakpoints, call stacks, DOM and storage state, event timing, and controlled local reproductions.
- **Crypto and encoding chains** — locate the first transformation, trace inputs through intermediate representations, and verify with fixed test vectors where possible.
- **Node-side counterparts** — local scripts, SSR paths, build tooling, and reproduction harnesses.

## Method

1. Start from observed behavior, not from random deobfuscation.
2. Build a map from entry point to the smallest function that produces the observable output.
3. Capture a minimal evidence set before changing the environment.
4. Prefer stable runtime probes and deterministic local reproductions over one-off manual edits.
5. Record exact URLs, bundle hashes, versions, and timestamps so findings remain reproducible.

## Boundaries

- Keep work on targets the user owns or is authorized to analyze.
- Do not turn credential theft, payment fraud, unauthorized access, or evasion of a live access-control system into a deliverable.
- When a specific technique crosses that boundary, explain the boundary and continue with static structure, defensive validation, or a synthetic local model.
