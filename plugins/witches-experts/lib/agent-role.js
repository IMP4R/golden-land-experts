// ============================================================================
// Role and event origin: who is acting, and where the input came from.
// ============================================================================
// The Memory Broker was gated on `delegationDepth === 0`, which is a proxy for
// "this is the top-level witch" and stops being true the moment a witch herself
// runs under a supervisor. Depth says how deep a chain is; it does not say what
// the agent is FOR or whether an input is a human message.
//
// This module derives two independent answers from durable session metadata and
// the message itself, so each decision rests on its own evidence:
//
//   agentRole   — what the session is for: witch | expert | worker
//   eventOrigin — where the input came from: human | delegation | tool | system
//
// A delegated contract must never pass as human input, and an expert must not be
// treated as the human-facing witch. Depth remains available as context, never
// as the gate.
// ============================================================================

/** What a session is for. */
export const AGENT_ROLE = Object.freeze({ WITCH: 'witch', EXPERT: 'expert', WORKER: 'worker' })

/** Where one input came from. */
export const EVENT_ORIGIN = Object.freeze({ HUMAN: 'human', DELEGATION: 'delegation', TOOL: 'tool', SYSTEM: 'system' })

/**
 * Mark a session as an expert execution context.
 *
 * The role is declared by the dispatcher that creates the session rather than
 * inferred later, because only the creator knows why it exists.
 * @param options - agent options to stamp.
 * @param role - the role to declare.
 * @returns the same object, stamped.
 */
export function stampAgentRole(options, role) {
  return { ...options, agentRole: role }
}

/**
 * Resolve the role of the session behind one agent.
 *
 * A declared role wins. Otherwise a subagent-origin session is an expert, since
 * the dispatcher is the only creator of those, and anything else is the
 * human-facing witch.
 * @param agent - the acting agent.
 * @returns the resolved role.
 */
export function resolveAgentRole(agent) {
  const declared = agent?.options?.agentRole
  if (declared === AGENT_ROLE.WITCH || declared === AGENT_ROLE.EXPERT || declared === AGENT_ROLE.WORKER) {
    return declared
  }
  const header = agent?.session?.header
  if (header?.origin === 'subagent' || header?.parentSession !== undefined) return AGENT_ROLE.EXPERT
  return AGENT_ROLE.WITCH
}

/**
 * Classify where one message came from.
 *
 * Order matters: a plugin or tool message is never human even when it carries
 * `role: 'user'`, and a message handed down by a parent session is delegation
 * even though it arrives with the same `kind: 'user'` source as a typed prompt.
 * @param message - the candidate message.
 * @param agent - the agent the message was delivered to.
 * @returns the classified origin.
 */
export function classifyEventOrigin(message, agent) {
  const source = message?.source ?? {}
  if (source.kind === 'tool') return EVENT_ORIGIN.TOOL
  if (source.kind === 'plugin') return EVENT_ORIGIN.SYSTEM
  if (source.kind === 'subagent-report') return EVENT_ORIGIN.DELEGATION
  if (source.parentSessionId !== undefined) return EVENT_ORIGIN.DELEGATION
  if (source.kind !== 'user') return EVENT_ORIGIN.SYSTEM

  // An expert session receives its contract with the same `kind: 'user'` source
  // a typed prompt uses, so the session's own role identifies it.
  if (resolveAgentRole(agent) === AGENT_ROLE.EXPERT) return EVENT_ORIGIN.DELEGATION
  return EVENT_ORIGIN.HUMAN
}

/**
 * Whether the Memory Broker must run for this input.
 *
 * Exactly one authentic human message addressed to the witch gets one broker
 * run. Delegated contracts, tool results and injected reminders never do, and a
 * re-delivery of the same message id does not run it twice.
 * @param message - the candidate message.
 * @param agent - the agent the message was delivered to.
 * @returns whether to run the broker.
 */
export function shouldRunBroker(message, agent) {
  if (message === undefined || message === null) return false
  if (resolveAgentRole(agent) !== AGENT_ROLE.WITCH) return false
  return classifyEventOrigin(message, agent) === EVENT_ORIGIN.HUMAN
}

/**
 * Whether the runtime expert dispatcher may act on this input.
 *
 * The dispatcher belongs to the witch: an expert does not auto-spawn a second
 * expert for its own contract. Experts may still delegate narrower subtasks
 * through their own tools; what is forbidden is re-dispatching the same work.
 * @param message - the candidate message.
 * @param agent - the agent the message was delivered to.
 * @returns whether to consider a dispatch.
 */
export function shouldDispatchExpert(message, agent) {
  if (message === undefined || message === null) return false
  if (resolveAgentRole(agent) !== AGENT_ROLE.WITCH) return false
  return classifyEventOrigin(message, agent) === EVENT_ORIGIN.HUMAN
}

/**
 * Identity of one unit of work, used to keep one dispatcher per contract.
 *
 * `message.id` alone is not enough: the same human turn can be re-presented
 * after a rejection with a new message id, and a delegation carries its own.
 * Combining the task identity with the message id keeps one execution per
 * contract while still allowing a genuinely new message to dispatch.
 * @param message - the input message.
 * @param agent - the receiving agent.
 * @returns a stable key for deduplicating dispatch.
 */
export function taskIdentity(message, agent) {
  const messageId = message?.id ?? 'unknown'
  const sessionId = agent?.session?.header?.id ?? agent?.id ?? 'unknown'
  return `${sessionId}:${messageId}`
}
