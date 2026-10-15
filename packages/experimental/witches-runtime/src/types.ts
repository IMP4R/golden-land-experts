/** Shared types for the witches runtime. @module @deepseek-ai/dsh-experimental-witches-runtime/types */

/** Cheap or expensive witch route. */
export type WitchRouteKind = 'cheap' | 'expensive'

/** One complete provider/model pair. */
export interface WitchRoute {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Durable dual-route settings for a witch. */
export interface WitchModelRoutes {
  /** Default execution route for the witch, children, experts, and Memory Broker. */
  cheap: WitchRoute
  /** Explicit high-cost route; never a silent fallback from cheap. */
  expensive: WitchRoute
  /** Which stored route the witch itself assembles next. */
  active: WitchRouteKind
}

/** One Memory Broker capsule. */
export interface MemoryCapsule {
  /** Human-message id this capsule answers. */
  humanMessageId: string
  /** Compact selected memory. Empty string is a valid result. */
  text: string
  /** Source URIs or record ids cited in the capsule. */
  sources: readonly string[]
}

/** Expert operating mode. */
export type ExpertMode = 'context' | 'consult' | 'execute'

/** Passport for one shared expert. */
export interface ExpertPassport {
  /** Stable expert id, kebab-case. */
  id: string
  /** Human-readable competence. */
  title: string
  /** Domain this expert owns. */
  scope: string
  /** Tool profile name, or empty for inherited tools. */
  tools: string
}

/** Plugin configuration. */
export interface Config {
  /** Maximum heuristic tokens admitted into one Memory Broker call. */
  brokerInputTokens: number
  /** Maximum heuristic tokens the capsule may occupy. */
  brokerOutputTokens: number
  /** Cheap route used when settings have not stored dual routes yet. */
  cheapProvider: string
  /** Cheap model used when settings have not stored dual routes yet. */
  cheapModel: string
  /** Expensive route used when settings have not stored dual routes yet. */
  expensiveProvider: string
  /** Expensive model used when settings have not stored dual routes yet. */
  expensiveModel: string
  /** Shared experts available to every witch. */
  experts: ExpertPassport[]
}
