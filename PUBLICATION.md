# Golden Land — Experts

Current working-tree source snapshot of the isolated experts checkout, not the older September external plugin and not merely the history demo. Includes DSH tracked source, current plugins, expert runtime, persistent code runtime, overlay and added package source/tests. Uncommitted changes are part of the snapshot.

Upstream DSH/Cordis and dependencies belong to their original authors; LICENSE and THIRD_PARTY_NOTICES retained. No new license assigned. Credentials/runtime homes/sessions/provider configuration and private evidence are not included. No standalone installation or live acceptance claimed. Install dependencies and configure your own isolated profile. Built dependency artifacts are excluded; plugin lib JavaScript is original source and retained. Full app not rebuilt or deployed.

Base revision: ee17f2f80b842057a5e383fd68df6216be36e882

Modified credential copies:
- examples/headless-agent/tests/fixtures/session-telemetry-otel-driver.ts
- packages/credentials/credentials-local/tests/local.spec.ts
- packages/session/session-telemetry-otel/tests/loader-composition.e2e.ts

Excluded files:
- .agents/notes/implemented/CLAUDE.md
- .claude/skills
- CLAUDE.md
- docs/user/guide/providers-custom-form.png
- docs/user/guide/providers-custom-form.zh.png
- docs/user/guide/providers-models-page.png
- docs/user/guide/providers-models-page.zh.png
- examples/CLAUDE.md
- examples/acp-agent/tests/snapshots/agent-instructions/workspace/AGENTS.md
- examples/acp-agent/tests/snapshots/agent-instructions/workspace/nested/AGENTS.md
- examples/acp-agent/tests/snapshots/read-image-dimension/workspace/wide.png
- examples/acp-agent/tests/snapshots/read-image-text-route/workspace/red.png
- examples/acp-agent/tests/snapshots/read-image/workspace/red.png
- packages/CLAUDE.md
- packages/code-runtime/code-runtime-persistent/lib/index.js
- packages/code-runtime/code-runtime-persistent/lib/invariant.js
- packages/code-runtime/code-runtime-persistent/lib/tsconfig.tsbuildinfo
- packages/code-runtime/code-runtime-persistent/lib/types/index.d.ts
- packages/code-runtime/code-runtime-persistent/lib/types/index.d.ts.map
- packages/code-runtime/code-runtime-persistent/lib/types/index.js
- packages/code-runtime/code-runtime-persistent/lib/types/index.js.map
- packages/code-runtime/code-runtime-persistent/lib/types/invariant.d.ts
- packages/code-runtime/code-runtime-persistent/lib/types/invariant.d.ts.map
- packages/code-runtime/code-runtime-persistent/lib/types/invariant.js
- packages/code-runtime/code-runtime-persistent/lib/types/invariant.js.map
- packages/code-runtime/code-runtime-persistent/node_modules/.bin/cordis
- packages/code-runtime/code-runtime-persistent/py/__pycache__/kernel.cpython-314.pyc
- packages/experimental/witches-runtime/lib/index.js
- packages/experimental/witches-runtime/lib/invariant.js
- packages/experimental/witches-runtime/lib/tsconfig.tsbuildinfo
- packages/experimental/witches-runtime/lib/types/agent-cycle-provider.d.ts
- packages/experimental/witches-runtime/lib/types/agent-cycle-provider.d.ts.map
- packages/experimental/witches-runtime/lib/types/agent-cycle-provider.js
- packages/experimental/witches-runtime/lib/types/agent-cycle-provider.js.map
- packages/experimental/witches-runtime/lib/types/broker.d.ts
- packages/experimental/witches-runtime/lib/types/broker.d.ts.map
- packages/experimental/witches-runtime/lib/types/broker.js
- packages/experimental/witches-runtime/lib/types/broker.js.map
- packages/experimental/witches-runtime/lib/types/candidates.d.ts
- packages/experimental/witches-runtime/lib/types/candidates.d.ts.map
- packages/experimental/witches-runtime/lib/types/candidates.js
- packages/experimental/witches-runtime/lib/types/candidates.js.map
- packages/experimental/witches-runtime/lib/types/cycle-runner.d.ts
- packages/experimental/witches-runtime/lib/types/cycle-runner.d.ts.map
- packages/experimental/witches-runtime/lib/types/cycle-runner.js
- packages/experimental/witches-runtime/lib/types/cycle-runner.js.map
- packages/experimental/witches-runtime/lib/types/execution-cycle.d.ts
- packages/experimental/witches-runtime/lib/types/execution-cycle.d.ts.map
- packages/experimental/witches-runtime/lib/types/execution-cycle.js
- packages/experimental/witches-runtime/lib/types/execution-cycle.js.map
- packages/experimental/witches-runtime/lib/types/execution-guard.d.ts
- packages/experimental/witches-runtime/lib/types/execution-guard.d.ts.map
- packages/experimental/witches-runtime/lib/types/execution-guard.js
- packages/experimental/witches-runtime/lib/types/execution-guard.js.map
- packages/experimental/witches-runtime/lib/types/experts.d.ts
- packages/experimental/witches-runtime/lib/types/experts.d.ts.map
- packages/experimental/witches-runtime/lib/types/experts.js
- packages/experimental/witches-runtime/lib/types/experts.js.map
- packages/experimental/witches-runtime/lib/types/history.d.ts
- packages/experimental/witches-runtime/lib/types/history.d.ts.map
- packages/experimental/witches-runtime/lib/types/history.js
- packages/experimental/witches-runtime/lib/types/history.js.map
- packages/experimental/witches-runtime/lib/types/index.d.ts
- packages/experimental/witches-runtime/lib/types/index.d.ts.map
- packages/experimental/witches-runtime/lib/types/index.js
- packages/experimental/witches-runtime/lib/types/index.js.map
- packages/experimental/witches-runtime/lib/types/invariant.d.ts
- packages/experimental/witches-runtime/lib/types/invariant.d.ts.map
- packages/experimental/witches-runtime/lib/types/invariant.js
- packages/experimental/witches-runtime/lib/types/invariant.js.map
- packages/experimental/witches-runtime/lib/types/route-store.d.ts
- packages/experimental/witches-runtime/lib/types/route-store.d.ts.map
- packages/experimental/witches-runtime/lib/types/route-store.js
- packages/experimental/witches-runtime/lib/types/route-store.js.map
- packages/experimental/witches-runtime/lib/types/routes.d.ts
- packages/experimental/witches-runtime/lib/types/routes.d.ts.map
- packages/experimental/witches-runtime/lib/types/routes.js
- packages/experimental/witches-runtime/lib/types/routes.js.map
- packages/experimental/witches-runtime/lib/types/stage-result.d.ts
- packages/experimental/witches-runtime/lib/types/stage-result.d.ts.map
- packages/experimental/witches-runtime/lib/types/stage-result.js
- packages/experimental/witches-runtime/lib/types/stage-result.js.map
- packages/experimental/witches-runtime/lib/types/types.d.ts
- packages/experimental/witches-runtime/lib/types/types.d.ts.map
- packages/experimental/witches-runtime/lib/types/types.js
- packages/experimental/witches-runtime/lib/types/types.js.map
- packages/experimental/witches-runtime/lib/types/worker-scope.d.ts
- packages/experimental/witches-runtime/lib/types/worker-scope.d.ts.map
- packages/experimental/witches-runtime/lib/types/worker-scope.js
- packages/experimental/witches-runtime/lib/types/worker-scope.js.map
- packages/experimental/witches-runtime/node_modules/.bin/cordis
- packages/llm/llm-pi-ai/tests/fixtures/qr-code.png
- packages/skill/skill-badge/assets/dsh-badge.png
- vendor/CLAUDE.md
