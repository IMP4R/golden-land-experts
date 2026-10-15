/**
 * CPython subprocess implementation of the code-execution seam. It keeps one
 * interpreter per agent session so sequential programs can reuse Python values.
 * Interpreter globals remain in memory only until the session or DSH process ends.
 *
 * The seam's contract is preserved rather than relaxed:
 *
 *  - Runs stay isolated from one another. Isolation here is per SESSION, not
 *    per run: two sessions never share an interpreter, which is the boundary
 *    the harness actually owns (`ctx.agents` roots). Within one session the
 *    shared namespace IS the feature, so it is documented, not accidental.
 *  - Disposal terminates and awaits every live interpreter; no orphan process
 *    outlives the plugin.
 *  - Results keep the seam's shape: a completion value when it crosses the
 *    lossless-JSON boundary, ordered logs, and a structured failure.
 *
 * @module @deepseek-ai/dsh-code-runtime-persistent
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { CodeRuntime, DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from '@deepseek-ai/dsh-code-runtime'
import type {
  CodeBindingFunction,
  CodeBindingNamespace,
  CodeJsonValue,
  CodeRunFailure,
  CodeRunRequest,
  CodeRunResult,
} from '@deepseek-ai/dsh-code-runtime'

/** Where the Python-side bootstrap lives, resolved beside this bundle. */
const BOOTSTRAP = fileURLToPath(new URL('../py/kernel.py', import.meta.url))

/**
 * The binding channel: fd 3 of the kernel process.
 *
 * A separate descriptor rather than a frame type on stdout, because stdout is
 * where the program itself can write and where the kernel writes replies;
 * mixing a third traffic class into it would make the framing depend on the
 * program behaving.
 */
const PROTOCOL_FD = 3

/** The portable identifier subset every backend enforces on a binding global. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One request frame written to the kernel's stdin. */
interface KernelRequest {
  readonly id: number
  readonly program: string
  readonly bindings: readonly KernelBinding[]
}

/** One binding as the kernel needs it: the global name and its callable members. */
interface KernelBinding {
  readonly global: string
  readonly names: readonly string[]
}

/** One reply frame read from the kernel's stdout. */
interface KernelReply {
  readonly id: number
  readonly ok: boolean
  readonly value?: unknown
  readonly logs?: readonly string[]
  readonly code?: string
  readonly message?: string
}

/** The caller waiting on one program's reply. */
interface Inflight {
  readonly resolve: (reply: KernelReply) => void
  readonly reject: (error: Error) => void
}

/** One binding call arrived from the kernel, awaiting the host's answer. */
interface BindingCall {
  readonly global: string
  readonly name: string
  /**
   * The call's arguments, in order.
   *
   * The seam types a binding as a single-argument function, so the host passes
   * the first argument through and refuses a call that supplies more than one:
   * silently forwarding an array would hand the tool a value it never declared.
   */
  readonly args: readonly unknown[]
}

/** A live interpreter plus its framing state. */
interface Kernel {
  readonly child: ChildProcessWithoutNullStreams
  /** Bytes read but not yet terminated by a newline. */
  buffer: string
  /** Binding-channel bytes read but not yet terminated by a newline. */
  callBuffer: string
  /** Replies that arrived before their pending caller registered. */
  readonly pending: KernelReply[]
  /** The single in-flight run; the interpreter executes one program at a time. */
  current: Inflight | undefined
  /** The bindings of the in-flight run, the only names a call may address. */
  live: Map<string, CodeBindingNamespace> | undefined
  /** Caller-owned execution context for the in-flight run, if one was supplied. */
  context?: unknown
  /** Set once the process has exited, so later runs fail instead of hanging. */
  dead?: string
}

/** Resolve the interpreter binary; `DSH_PYTHON` allows a deployment override. */
function pythonBin(): string {
  const configured = process.env.DSH_PYTHON
  return configured !== undefined && configured.trim().length > 0 ? configured.trim() : 'python3'
}

/**
 * Map a Python-side failure to the seam's failure taxonomy.
 * @param reply - the kernel's error reply.
 * @returns the structured failure the consumer expects.
 */
function failureOf(reply: KernelReply): CodeRunFailure {
  const message = reply.message ?? 'the program failed'
  // The seam's taxonomy is closed. A program that raises IS an exception, and a
  // syntax error is the same class with a compiler message: the consumer feeds
  // `message` back to the model either way, so splitting them would invent a
  // kind no consumer understands.
  return { kind: 'exception', message }
}

/**
 * Read a thrown value as a message.
 * @param error - the caught value.
 * @returns its message when it is an Error, its rendering otherwise.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Reject malformed binding globals or typed-error declarations.
 *
 * These are Service Definition contract misuse, so they throw rather than
 * resolving with a failure — the same split the shipped worker backend makes.
 * The rules come from the seam's shared constants, not from this backend's
 * idea of them: a namespace list valid on one backend must be valid on all.
 * @param request - the run's request.
 * @returns the namespaces, keyed by global, in declaration order.
 */
function validateBindings(request: CodeRunRequest): Map<string, CodeBindingNamespace> {
  const bindings = new Map<string, CodeBindingNamespace>()
  for (const namespace of request.bindings) {
    if (!IDENTIFIER.test(namespace.global) || PORTABLE_RESERVED_WORDS.has(namespace.global)) {
      throw new Error(`code-runtime-persistent: binding global ${JSON.stringify(namespace.global)} is not a usable identifier`)
    }
    if (RESERVED_BINDING_GLOBALS.has(namespace.global)) {
      throw new Error(`code-runtime-persistent: reserved binding global ${JSON.stringify(namespace.global)}`)
    }
    if (bindings.has(namespace.global)) {
      throw new Error(`code-runtime-persistent: duplicate binding global ${JSON.stringify(namespace.global)}`)
    }
    bindings.set(namespace.global, namespace)
  }

  const errorClassNames = new Set<string>()
  for (const namespace of request.bindings) {
    const descriptor = namespace.errorClass
    if (descriptor === undefined) continue
    if (!IDENTIFIER.test(descriptor.name) || PORTABLE_RESERVED_WORDS.has(descriptor.name)) {
      throw new Error(`code-runtime-persistent: binding error class ${JSON.stringify(descriptor.name)} is not a usable identifier`)
    }
    if (RESERVED_BINDING_GLOBALS.has(descriptor.name)) {
      throw new Error(`code-runtime-persistent: reserved binding global ${JSON.stringify(descriptor.name)}`)
    }
    if (bindings.has(descriptor.name) || errorClassNames.has(descriptor.name)) {
      throw new Error(`code-runtime-persistent: duplicate injected global ${JSON.stringify(descriptor.name)}`)
    }
    const member = descriptor.memberNameProperty
    if (member.length === 0 || RESERVED_ERROR_MEMBERS.has(member) || DUNDER_MEMBER.test(member)) {
      throw new Error(`code-runtime-persistent: binding error member property ${JSON.stringify(member)} is not usable`)
    }
    errorClassNames.add(descriptor.name)
  }
  return bindings
}

/**
 * The runtime's validated configuration.
 *
 * `runTimeoutMs` is load-bearing rather than a tuning knob: a persistent
 * interpreter cannot be interrupted by dropping the process the way a one-shot
 * backend can, so a runaway loop would wedge the session until the deadline
 * kills it.
 */
export interface Config {
  /** Milliseconds one program may run before its interpreter is killed. */
  runTimeoutMs?: number
}

export class PersistentCodeRuntime extends CodeRuntime {
  static Config = z.object({
    runTimeoutMs: z.number().default(120_000),
  }) as z<Config>

  static override apply(ctx: Context, config: Config) {
    return new PersistentCodeRuntime(ctx, config)
  }

  /** Identifier the consumer switches on to generate language-specific SDK text. */
  readonly language = 'python'

  /** Substrate descriptor; diagnostics only, never a security claim. */
  readonly isolation = 'persistent-process'

  private readonly kernels = new Map<string, Kernel>()
  private readonly runTimeoutMs: number
  /** Set by teardown; every later run fails instead of spawning after disposal. */
  private disposed = false

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.runTimeoutMs = config.runTimeoutMs ?? 120_000
    ctx.effect(() => () => this.teardown(), 'persistent code-runtime teardown')
  }

  /**
   * Read the session that owns one run, using the seam's own scope key.
   *
   * The scope is the agent, so its session id is the session. A request
   * without one shares the deployment-wide kernel, which is correct for a
   * headless caller with no session at all.
   * @param ctx - the scoped context the run was requested from.
   * @returns the kernel key.
   */
  private kernelKey(ctx: Context): string {
    const scope = scopeOf(ctx) as { session?: { id?: string }; id?: string } | undefined
    const agent = (ctx as Context & { agent?: { id?: string; session?: { id?: string } } }).agent
    return String(agent?.session?.id ?? agent?.id ?? scope?.session?.id ?? scope?.id ?? 'default')
  }

  /**
   * Start one interpreter for a session, or return the live one.
   * @param key - the session's kernel key.
   * @returns the live kernel.
   */
  private ensureKernel(key: string): Kernel {
    const existing = this.kernels.get(key)
    if (existing !== undefined) return existing
    const child = spawn(pythonBin(), ['-u', BOOTSTRAP], {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
    const kernel: Kernel = { child, buffer: '', callBuffer: '', pending: [], current: undefined, live: undefined }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onData(kernel, chunk))
    // fd 3 carries binding calls out of the program. The extra pipe is typed as
    // a duplex union because Node cannot know which half fd 3 is from `stdio`
    // alone; here it is a Socket, which is both, so each half is asserted once.
    const channel = this.channelOf(kernel)
    if (channel !== undefined) channel.on('data', (chunk: string) => this.onCallData(kernel, chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.ctx.logger?.warn?.(`code-runtime-persistent: kernel stderr: ${String(chunk).trim()}`)
    })
    child.on('exit', (code, signal) => {
      const reason = `interpreter exited (code ${String(code)}, signal ${String(signal)})`
      kernel.dead = reason
      if (kernel.current !== undefined) {
        kernel.current.reject(new Error(reason))
        kernel.current = undefined
      }
    })
    this.kernels.set(key, kernel)
    return kernel
  }

  /** Frame kernel stdout into replies. */
  private onData(kernel: Kernel, chunk: string): void {
    kernel.buffer += chunk
    let index = kernel.buffer.indexOf('\n')
    while (index >= 0) {
      const line = kernel.buffer.slice(0, index)
      kernel.buffer = kernel.buffer.slice(index + 1)
      if (line.trim().length > 0) this.onReply(kernel, line)
      index = kernel.buffer.indexOf('\n')
    }
  }

  /** Deliver one decoded reply to its caller. */
  private onReply(kernel: Kernel, line: string): void {
    let reply: KernelReply
    try {
      reply = JSON.parse(line) as KernelReply
    } catch {
      this.ctx.logger?.warn?.('code-runtime-persistent: unparseable kernel reply dropped')
      return
    }
    if (kernel.current !== undefined) {
      const settle = kernel.current
      kernel.current = undefined
      settle.resolve(reply)
      return
    }
    kernel.pending.push(reply)
  }

  /** Frame the binding channel into calls. */
  private onCallData(kernel: Kernel, chunk: string): void {
    kernel.callBuffer += chunk
    let index = kernel.callBuffer.indexOf('\n')
    while (index >= 0) {
      const line = kernel.callBuffer.slice(0, index)
      kernel.callBuffer = kernel.callBuffer.slice(index + 1)
      if (line.trim().length > 0) this.onCall(kernel, line)
      index = kernel.callBuffer.indexOf('\n')
    }
  }

  /**
   * Answer one binding call.
   *
   * The call is only ever a request for a function the CURRENT run declared, so
   * it is looked up in that run's namespaces rather than in anything the
   * process happens to hold. A call that does not resolve is answered with a
   * rejection instead of being dropped: the program is blocked on this reply, so
   * silence would hang it until the run deadline.
   * @param kernel - the interpreter that called.
   * @param line - the raw `call` frame.
   */
  private onCall(kernel: Kernel, line: string): void {
    let call: BindingCall
    try {
      call = JSON.parse(line) as BindingCall
    } catch {
      this.replyCall(kernel, false, undefined, 'code-runtime-persistent: malformed binding call')
      return
    }
    const fn: CodeBindingFunction | undefined = kernel.live?.get(call.global)?.functions[call.name]
    if (fn === undefined) {
      this.replyCall(kernel, false, undefined, `code-runtime-persistent: no binding ${call.global}.${call.name} in this run`)
      return
    }
    if (call.args.length > 1) {
      this.replyCall(kernel, false, undefined, `code-runtime-persistent: ${call.global}.${call.name} takes one argument`)
      return
    }
    // The promise is settled once, by whichever of the two paths runs first;
    // an implementation that threw synchronously would otherwise never reply.
    void Promise.resolve()
      .then(() => fn(call.args[0], kernel.context))
      .then(
        value => this.replyCall(kernel, true, value, undefined),
        (error: unknown) => this.replyCall(kernel, false, undefined, messageOf(error)),
      )
  }

  /** Write one binding reply back to the waiting program. */
  private replyCall(kernel: Kernel, ok: boolean, value: CodeJsonValue | undefined, message: string | undefined): void {
    if (kernel.dead !== undefined) return
    const frame = ok ? { type: 'reply', ok: true, value } : { type: 'reply', ok: false, message }
    this.channelOf(kernel)?.write(`${JSON.stringify(frame)}\n`, 'utf8')
  }

  /**
   * The kernel's binding channel, as the duplex it is.
   *
   * `stdio[3]` is typed as `Readable | Writable` because Node cannot tell which
   * half an extra descriptor is; a spawned pipe is a Socket with both halves, so
   * the two narrowings are named here once instead of at each use.
   * @param kernel - the interpreter.
   * @returns the channel, or undefined when the descriptor is absent.
   */
  private channelOf(kernel: Kernel): (NodeJS.ReadableStream & NodeJS.WritableStream) | undefined {
    const channel = kernel.child.stdio[PROTOCOL_FD]
    if (channel === null || channel === undefined) return undefined
    const stream = channel as unknown as NodeJS.ReadableStream & NodeJS.WritableStream
    stream.setEncoding?.('utf8')
    return stream
  }

  /** Stop one interpreter and forget it. */
  private kill(key: string): void {
    const kernel = this.kernels.get(key)
    if (kernel === undefined) return
    this.kernels.delete(key)
    this.signal(kernel)
  }

  /** Terminate one interpreter's process group, ignoring an already-dead child. */
  private signal(kernel: Kernel): void {
    if (!kernel.child.killed) kernel.child.kill('SIGKILL')
  }

  /**
   * Dispose to quiescence: refuse later runs, fail every in-flight one, and
   * AWAIT each interpreter's exit so no Python process outlives the fiber.
   *
   * A persistent substrate makes this load-bearing in a way a one-shot backend
   * does not: a leaked kernel is a live process holding a session's namespace.
   * It is public because the plugin lifecycle is not the only owner — a test,
   * a CLI, or an embedding host that built the runtime directly must be able to
   * end it without reaching into the fiber that created it.
   */
  async dispose(): Promise<void> {
    await this.teardown()
  }

  private async teardown(): Promise<void> {
    this.disposed = true
    const kernels = [...this.kernels.values()]
    this.kernels.clear()
    for (const kernel of kernels) {
      if (kernel.current !== undefined) {
        const inflight = kernel.current
        kernel.current = undefined
        inflight.reject(new Error('code runtime disposed'))
      }
      this.signal(kernel)
    }
    await Promise.all(kernels.map(kernel => new Promise<void>((resolve) => {
      if (kernel.child.exitCode !== null || kernel.child.signalCode !== null) {
        resolve()
        return
      }
      kernel.child.once('exit', () => resolve())
    })))
  }

  /**
   * Execute one program in the session's interpreter.
   *
   * Values assigned by the program remain in the interpreter's namespace, so a
   * later program in the same session reads them back. The completion value is
   * the program's `return`, exactly as the seam specifies.
   * @param request - the program, its bindings, and the abort signal.
   * @returns the run's completion value, ordered logs, and failure (if any).
   */
  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    if (this.disposed) {
      return { logs: [], error: { kind: 'abort', message: 'code runtime disposed' } }
    }
    const key = this.kernelKey(this.ctx)
    const kernel = this.ensureKernel(key)
    if (kernel.dead !== undefined) {
      return { logs: [], error: { kind: 'worker-exit', message: kernel.dead } }
    }
    if (kernel.current !== undefined) {
      return {
        logs: [],
        error: {
          kind: 'exception',
          message: 'this session already has a program running; the interpreter runs one at a time',
        },
      }
    }

    const bindings = validateBindings(request)

    const id = Date.now() % 1_000_000_037
    const frame: KernelRequest = {
      id,
      program: request.program,
      bindings: [...bindings].map(([global, namespace]) => ({ global, names: Object.keys(namespace.functions) })),
    }

    const reply = await new Promise<KernelReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (kernel.current !== undefined) {
          kernel.current = undefined
          this.kill(key)
          reject(new Error(`program exceeded ${String(this.runTimeoutMs)}ms; interpreter killed`))
        }
      }, this.runTimeoutMs)
      // Registered in ONE assignment, before the write: a reply that lands
      // between two assignments would find no caller and be parked as pending,
      // hanging this run until its deadline.
      kernel.current = {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      }
      // The run's namespaces become the only names a binding call may address,
      // and they stop being live when the run settles: a stale namespace would
      // let a later program's call reach a previous run's closure.
      kernel.live = bindings
      kernel.context = request.context
      kernel.child.stdin.write(`${JSON.stringify(frame)}\n`, 'utf8')
    }).catch((error: unknown): KernelReply => ({
      id,
      ok: false,
      code: 'exception',
      message: messageOf(error),
    }))
    kernel.live = undefined
    kernel.context = undefined

    if (!reply.ok) return { logs: [...(reply.logs ?? [])], error: failureOf(reply) }
    return {
      logs: [...(reply.logs ?? [])],
      ...reply.value === undefined ? {} : { value: reply.value as CodeJsonValue },
    }
  }
}

export { PersistentCodeRuntime as default }
