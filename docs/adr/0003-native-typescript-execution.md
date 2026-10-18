# ADR 0003: Run TypeScript natively on Node.js

- Status: accepted
- Date: 2026-10-18

## Context

The API, scripts and shared package are written in TypeScript in strict mode. Since Node.js 23.6, Node strips type annotations natively; Node 24 is the current LTS line.

## Options

1. **Compile with `tsc` to `dist/`.** Classic setup with a build step and a watch process in development.
2. **Run with a loader (`tsx`, `ts-node`).** No build step, but an extra runtime dependency.
3. **Node native type stripping.** No build step and no dependency. Restricted to erasable syntax (no `enum`, no parameter properties, no namespaces) and requires explicit `.ts` import extensions.

## Decision

Option 3. `tsc` runs only as a type checker (`noEmit`, `erasableSyntaxOnly`, `allowImportingTsExtensions`). The shared package exports its TypeScript source directly; Vite and Vitest consume it unchanged. TypeScript is pinned to 6.0.x because `typescript-eslint` does not support TypeScript 7 yet.

## Consequences

- `node src/server.ts` is the start command in development and in production-like runs.
- Lambda handlers (later milestone) are bundled with a bundler anyway, so the restriction does not carry over.
- Code avoids non-erasable TypeScript features; the compiler enforces this.

## When to revisit

- If the API ran in a container image where startup time or file size mattered, a bundled JavaScript build would be added.
- If a dependency required non-erasable syntax in shared source, the shared package would get a build step.
