/**
 * Client-Side Prediction & Reconciliation
 * =========================================
 * Keeps the locally predicted player position in sync with the
 * authoritative server position, without the rubber-banding the old
 * code had.
 *
 * WHY THE OLD CODE RUBBER-BANDED
 * ------------------------------
 * The old client compared its CURRENT predicted position against the
 * server's CURRENT position and hard-snapped whenever they differed by
 * more than 32px. Two problems:
 *
 *  1. The server position always trails the client prediction by the
 *     network latency (the client predicts immediately; the server only
 *     learns about an input when its packet arrives). That gap grows
 *     LINEARLY with movement speed - which is exactly why the problem
 *     only appeared once the player moved faster.
 *
 *  2. Errors below 32px were never corrected at all, so they
 *     accumulated until they crossed the threshold and then snapped all
 *     at once.
 *
 * THE FIX (standard "reconcile against the last acknowledged input")
 * ------------------------------------------------------------------
 * Every input carries a monotonically increasing tick number, and the
 * server echoes back the tick of the last input it consumed
 * (`player.tick`). The server's position therefore corresponds to a
 * KNOWN point on the client's prediction timeline.
 *
 * The client compares the server position against ITS OWN prediction
 * for that same tick. The residual is then the true simulation
 * divergence with the latency component removed. We fold that residual
 * back into the prediction, so client and server agree exactly and the
 * error never accumulates.
 *
 * A large residual (respawn / teleport / map change) still snaps
 * immediately, which is correct - those are genuine discontinuities.
 */

/** Tunables for the local-player reconciliation. */
export const RECONCILE_CONFIG = {
  /**
   * Residual larger than this (px) means a genuine discontinuity
   * (respawn, teleport, map change) -> snap instead of correcting.
   */
  SNAP_THRESHOLD: 48,
  /**
   * How many past input ticks to remember. The client only needs to
   * look back as far as the network latency (~100ms = ~6 ticks); 150
   * gives a very generous margin for a bad connection.
   */
  HISTORY_LENGTH: 150,
} as const;

interface PredictionSample {
  tick: number;
  x: number;
  y: number;
}

/**
 * Global, monotonically increasing input sequence number.
 *
 * The LobbyScene and the GameScene are separate Phaser scenes but they
 * share the SAME room and the SAME server-side Player. If each scene
 * kept its own counter, the tick numbers would collide (the lobby's
 * tick 50 and the game's tick 50 are different inputs) and the
 * server's acknowledgement would become ambiguous after a lobby -> map
 * transition. A single global sequence keeps the ack unambiguous.
 */
let globalInputTick = 0;

/** Returns the next input sequence number. */
export function nextInputTick(): number {
  globalInputTick += 1;
  return globalInputTick;
}

export class MovementPredictor {
  /** Predicted positions for recent input ticks, oldest first. */
  private history: PredictionSample[] = [];
  /** The last input tick the server acknowledged. */
  private lastAckTick = -1;
  /** Last authoritative server position we saw (to detect changes). */
  private lastServerX = Number.NaN;
  private lastServerY = Number.NaN;

  constructor(
    private readonly historyLength: number = RECONCILE_CONFIG.HISTORY_LENGTH,
  ) {}

  /** Forget all history (scene change, respawn, map transition). */
  reset(): void {
    this.history.length = 0;
    this.lastAckTick = -1;
    this.lastServerX = Number.NaN;
    this.lastServerY = Number.NaN;
  }

  /**
   * Record the predicted position produced by applying input `tick`.
   * Called once per client tick, right after the movement was applied.
   */
  record(tick: number, x: number, y: number): void {
    this.history.push({ tick, x, y });
    if (this.history.length > this.historyLength) {
      this.history.splice(0, this.history.length - this.historyLength);
    }
  }

  /**
   * Reconcile the prediction against an authoritative server position
   * that corresponds to input tick `ackTick`.
   *
   * Returns the corrected current position.
   */
  reconcile(
    serverX: number,
    serverY: number,
    ackTick: number,
    currentX: number,
    currentY: number,
  ): { x: number; y: number; snapped: boolean } {
    const serverMoved =
      serverX !== this.lastServerX || serverY !== this.lastServerY;
    const ackAdvanced = ackTick !== this.lastAckTick;

    // No new information: the server has not moved and has not
    // acknowledged a new input. Leave the prediction alone.
    if (!serverMoved && !ackAdvanced) {
      return { x: currentX, y: currentY, snapped: false };
    }

    this.lastAckTick = ackTick;
    this.lastServerX = serverX;
    this.lastServerY = serverY;

    // Find our own prediction for the tick the server acknowledges.
    let refIndex = -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].tick === ackTick) {
        refIndex = i;
        break;
      }
    }

    if (refIndex < 0) {
      // No common reference point (e.g. we just joined, or the server
      // acknowledged a tick we have already trimmed). The server position
      // is then behind our prediction by the latency gap, so the raw
      // difference is NOT an error - only a genuine discontinuity (far
      // beyond any plausible latency) is actionable.
      const dx = serverX - currentX;
      const dy = serverY - currentY;
      if (Math.hypot(dx, dy) > RECONCILE_CONFIG.SNAP_THRESHOLD) {
        this.reset();
        return { x: serverX, y: serverY, snapped: true };
      }
      return { x: currentX, y: currentY, snapped: false };
    }

    // The TRUE divergence: server truth vs our prediction for the SAME
    // tick. The latency component cancels out.
    const residualX = serverX - this.history[refIndex].x;
    const residualY = serverY - this.history[refIndex].y;

    if (
      Math.abs(residualX) > RECONCILE_CONFIG.SNAP_THRESHOLD ||
      Math.abs(residualY) > RECONCILE_CONFIG.SNAP_THRESHOLD
    ) {
      // Genuine discontinuity (respawn / teleport / map change): the
      // server position wins and the prediction restarts from it.
      this.reset();
      return { x: serverX, y: serverY, snapped: true };
    }

    // Fold the residual into the prediction: shift our current position
    // and every recorded position after the ack point, so the whole
    // timeline stays consistent with the server.
    for (let i = refIndex + 1; i < this.history.length; i++) {
      this.history[i].x += residualX;
      this.history[i].y += residualY;
    }

    return {
      x: currentX + residualX,
      y: currentY + residualY,
      snapped: false,
    };
  }
}
