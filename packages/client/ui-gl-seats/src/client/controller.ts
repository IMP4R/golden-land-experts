/** Shared viewing state for the Golden Land sidebar seats. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** State shared by the sidebar seat and the temporary design details panel. */
export interface GlSeatsState {
  /** Whether the design panel currently shadows the native details occupant. */
  designOpen: boolean
}

/** Coordinates the two render entries without a module-level singleton. */
export class GlSeatsController {
  /** Snapshot bound by the renderer as `useGlSeats`. */
  readonly store: SnapshotStore<GlSeatsState> = createSnapshotStore({ designOpen: false })

  /** Publish the design panel's mounted state.
   * @param designOpen - whether the design panel owns the details slot.
   */
  setDesignOpen(designOpen: boolean): void {
    if (this.store.getSnapshot().designOpen === designOpen) return
    this.store.set({ designOpen })
  }
}
