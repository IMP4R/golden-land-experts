import { DurableHistory, registerDurableHistory } from './history.js'

export const name = 'witches-durable-history'
export const inject = ['sessions', 'tools']
export const provide = 'witches-durable-history'

/** Provide the durable history service and its agent-scoped tools. */
export function apply(ctx, config) {
  const store = new DurableHistory(config?.root)
  ctx.effect(() => ctx.provide('witches-durable-history', store), 'witches-durable-history: service')
  registerDurableHistory(ctx, store)
}
