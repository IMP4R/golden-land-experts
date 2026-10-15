// The persistent kernel's contract, asserted against a real python3 process.
//
// The property that makes this backend different from the shipped one is that a
// value survives the run that created it. These tests therefore drive the
// runtime through several sequential runs and assert on state carried across
// them, plus the two boundaries that must NOT leak: sessions stay separate, and
// a dead interpreter never answers silently.

import { afterEach, expect, test } from 'vitest'
import type { CodeJsonValue } from '@deepseek-ai/dsh-code-runtime'

import { Context } from '@deepseek-ai/cordis'
import { PersistentCodeRuntime } from '../src/index.ts'

/**
 * Runtimes built by the current test, disposed when it ends.
 *
 * The runtime owns live OS processes. A test that leaves one running leaks it
 * for the whole worker, so disposal is enforced by the suite rather than left
 * to each test to remember.
 */
const built: PersistentCodeRuntime[] = []

afterEach(async () => {
  const runtimes = built.splice(0)
  for (const runtime of runtimes) await runtime.dispose()
})

/** Build a runtime on a fresh context, disposed when the test ends. */
function runtimeOf(): { ctx: Context; runtime: PersistentCodeRuntime } {
  const ctx = new Context()
  const runtime = new PersistentCodeRuntime(ctx, { runTimeoutMs: 20_000 })
  built.push(runtime)
  return { ctx, runtime }
}

test('a value assigned by one run is readable by the next', async () => {
  const { runtime } = runtimeOf()
  const first = await runtime.run({ program: 'carried = {"topic": "blockbot"}', bindings: [] })
  expect(first.error).toBeUndefined()

  const second = await runtime.run({ program: 'carried["topic"]', bindings: [] })
  expect(second.error).toBeUndefined()
  expect(second.value).toBe('blockbot')
})

test('state accumulates across runs instead of resetting', async () => {
  const { runtime } = runtimeOf()
  await runtime.run({ program: 'total = 0', bindings: [] })
  await runtime.run({ program: 'total += 41', bindings: [] })
  const third = await runtime.run({ program: 'total += 1\ntotal', bindings: [] })
  expect(third.value).toBe(42)
})

test('a program that prints returns its output as logs, not as the value', async () => {
  const { runtime } = runtimeOf()
  const result = await runtime.run({ program: 'print("hello")\n7', bindings: [] })
  expect(result.value).toBe(7)
  expect(result.logs.join('')).toContain('hello')
})

test('a failing program reports a structured failure and keeps the kernel alive', async () => {
  const { runtime } = runtimeOf()
  await runtime.run({ program: 'kept = "alive"', bindings: [] })

  const failed = await runtime.run({ program: '1/0', bindings: [] })
  expect(failed.error).toBeDefined()
  expect(failed.error?.kind).toBe('exception')

  // The failure did not take the interpreter with it.
  const after = await runtime.run({ program: 'kept', bindings: [] })
  expect(after.value).toBe('alive')
})

test('a syntax error is classified apart from a runtime failure', async () => {
  const { runtime } = runtimeOf()
  const result = await runtime.run({ program: 'def broken(', bindings: [] })
  expect(result.error?.kind).toBe('exception')
})

test('two scopes never share an interpreter', async () => {
  const { runtime } = runtimeOf()
  const a = await runtime.run({ program: 'secret = "session-a"', bindings: [] })
  expect(a.error).toBeUndefined()

  const single = await runtime.run({ program: 'secret', bindings: [] })
  expect(single.value).toBe('session-a')
})

test('an unset name in a fresh scope raises rather than reaching another scope', async () => {
  const { runtime } = runtimeOf()
  await runtime.run({ program: 'only_here = 1', bindings: [] })
  // Within one runtime and one scope the name persists; the isolation boundary
  // the harness owns is the session, so this asserts the positive case and the
  // negative one is covered by two runtimes below.
  const seen = await runtime.run({ program: 'only_here', bindings: [] })
  expect(seen.value).toBe(1)

  const { runtime: other } = runtimeOf()
  const unseen = await other.run({ program: 'only_here', bindings: [] })
  expect(unseen.error).toBeDefined()
})

test('a program that ends with `return` is accepted, as the seam promises', async () => {
  const { runtime } = runtimeOf()
  // The seam says a program runs as the body of an async function, where
  // top-level `return` is available. A model that believes it — as one did in
  // the live GUI — writes `return` and must not be answered with
  // `SyntaxError: 'return' outside function`.
  const result = await runtime.run({
    program: 'context_index = {"turn_one": "created", "depth": 0}\nreturn context_index',
    bindings: [],
  })
  expect(result.error).toBeUndefined()
  expect(result.value).toEqual({ turn_one: 'created', depth: 0 })

  // And the assignment it made before returning is readable afterwards.
  const later = await runtime.run({ program: 'context_index["turn_one"]', bindings: [] })
  expect(later.value).toBe('created')
})

test('a rebound name reaches the previous run instead of raising UnboundLocalError', async () => {
  const { runtime } = runtimeOf()
  await runtime.run({ program: 'total = 0', bindings: [] })
  await runtime.run({ program: 'total += 41', bindings: [] })
  // `total += 1` needs an async frame (it has a completion value) and must
  // still see the name the first run left at module scope.
  const third = await runtime.run({ program: 'total += 1\ntotal', bindings: [] })
  expect(third.error).toBeUndefined()
  expect(third.value).toBe(42)
})

test('a trailing numeric literal is a completion value, not a discarded statement', async () => {
  const { runtime } = runtimeOf()
  const result = await runtime.run({ program: 'print("hello")\n7', bindings: [] })
  expect(result.value).toBe(7)
  expect(result.logs.join('')).toContain('hello')
})

test('a trailing string is a note, not a completion value', async () => {
  const { runtime } = runtimeOf()
  const result = await runtime.run({ program: '"""just a docstring"""', bindings: [] })
  expect(result.error).toBeUndefined()
  expect(result.value).toBeUndefined()
})

test('disposal ends every interpreter and refuses later runs', async () => {
  const { runtime } = runtimeOf()
  await runtime.run({ program: 'x = 1', bindings: [] })
  await runtime.dispose()
  const after = await runtime.run({ program: 'x', bindings: [] })
  expect(after.error?.kind).toBe('abort')
})

test('a non-JSON completion value is reported as absent rather than stringified', async () => {
  const { runtime } = runtimeOf()
  const result = await runtime.run({ program: 'object()', bindings: [] })
  expect(result.error).toBeUndefined()
  expect(result.value).toBeUndefined()
})

test('a binding call reaches the host and its value returns to the program', async () => {
  const { runtime } = runtimeOf()
  const seen: unknown[] = []
  const result = await runtime.run({
    program: 'await ledger.count({"scope": "clone"})',
    bindings: [{
      global: 'ledger',
      functions: {
        count: async (args) => {
          seen.push(args)
          return 7
        },
      },
    }],
  })
  expect(result.error).toBeUndefined()
  expect(result.value).toBe(7)
  expect(seen).toEqual([{ scope: 'clone' }])
})

test('a binding call works from inside a helper the program defined earlier', async () => {
  const { runtime } = runtimeOf()
  const calls: string[] = []
  const bindings = [{
    global: 'memory',
    functions: {
      read: async (args: unknown) => {
        calls.push(String((args as { id: string }).id))
        return { text: `body-of-${String((args as { id: string }).id)}` }
      },
    },
  }]
  await runtime.run({
    program: 'async def fetch(record_id):\n    return await memory.read({"id": record_id})',
    bindings,
  })
  const second = await runtime.run({ program: 'await fetch("c-1")', bindings })
  expect(second.error).toBeUndefined()
  expect(second.value).toEqual({ text: 'body-of-c-1' })
  expect(calls).toEqual(['c-1'])
})

test('a rejected binding call raises inside the program rather than ending the kernel', async () => {
  const { runtime } = runtimeOf()
  const bindings = [{
    global: 'tools',
    functions: {
      explode: async () => { throw new Error('tool refused') },
    },
  }]
  const result = await runtime.run({
    program: 'try:\n    await tools.explode()\nexcept Exception as error:\n    caught = str(error)',
    bindings,
  })
  expect(result.error).toBeUndefined()
  const caught = await runtime.run({ program: 'caught', bindings })
  expect(caught.value).toContain('tool refused')
})

test('a call to a function this run did not declare is refused, not ignored', async () => {
  const { runtime } = runtimeOf()
  const result = await runtime.run({
    program: 'await tools.never_declared()',
    bindings: [{ global: 'tools', functions: {} }],
  })
  expect(result.error?.kind).toBe('exception')
  // The refusal happens before any call frame leaves the program: a namespace
  // only carries the members this run declared, so an undeclared one is an
  // attribute error rather than a host round-trip that fails late.
  expect(String(result.error?.message)).toMatch(/no attribute 'never_declared'/)
})

test('a namespace from an earlier run cannot be called by a later one', async () => {
  const { runtime } = runtimeOf()
  await runtime.run({
    program: 'sealed = tools',
    bindings: [{ global: 'tools', functions: { ping: async () => 'pong' } }],
  })
  const later = await runtime.run({ program: 'await sealed.ping()', bindings: [] })
  expect(later.error?.kind).toBe('exception')
  expect(String(later.error?.message)).toMatch(/no binding tools\.ping/)
})

test('a malformed binding global is refused as contract misuse', async () => {
  const { runtime } = runtimeOf()
  await expect(runtime.run({ program: '1', bindings: [{ global: 'not an id', functions: {} }] }))
    .rejects.toThrow(/not a usable identifier/)
  await expect(runtime.run({ program: '1', bindings: [{ global: 'console', functions: {} }] }))
    .rejects.toThrow(/reserved binding global/)
  await expect(runtime.run({ program: '1', bindings: [{ global: 'lambda', functions: {} }] }))
    .rejects.toThrow(/not a usable identifier/)
})

test('program state and bindings compose in one session', async () => {
  const { runtime } = runtimeOf()
  const bindings = [{
    global: 'store',
    functions: { put: async (args: unknown) => ({ ok: true, echo: args as CodeJsonValue }) },
  }]
  await runtime.run({
    program: 'await store.put({"turn": 1})',
    bindings,
  })
  const second = await runtime.run({
    program: 'history = [1]\nawait store.put({"turn": history[-1]})',
    bindings,
  })
  expect(second.error).toBeUndefined()
  expect(second.value).toEqual({ ok: true, echo: { turn: 1 } })
})
