// A settled report is work for a new turn, not passive next-step context.

/** Queues one plugin-attributed report and wakes even an idle parent. */
export function deliverReport(parent, message) {
  parent.followup(message)
}
