/**
 * Player System
 * ==============
 * Handles all player-related logic each tick:
 *   - Processing queued inputs
 *   - Normalized movement (fixes diagonal speed)
 *   - Delta-time based movement
 *   - Input rate limiting (prevents lag exploits)
 *   - Map boundary clamping
 *
 * SERVER AUTHORITY: This system is the ONLY thing that moves players.
 * The client sends inputs, but this system decides the actual position.
 * This prevents speed hacks, teleportation, and wall clipping.
 *
 * WHY A SEPARATE SYSTEM: Keeping player logic isolated means:
 *   - Easy to modify movement without touching other code
 *   - Easy to test (just feed inputs, check positions)
 *   - Clear single responsibility
 */

import { RoomState } from "../schema/RoomState";
import { Player, InputData } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { inputToMovement, clampToMap } from "../utils/movement";

export class PlayerSystem {
  /** Reference to the shared game state */
  private state: RoomState;

  constructor(state: RoomState) {
    this.state = state;
  }

  /**
   * Process all player inputs for this tick.
   *
   * HOW IT WORKS:
   *   1. For each player, grab their queued inputs
   *   2. Limit how many we process (prevents lag exploit)
   *   3. Convert input to normalized movement vector
   *   4. Apply movement with delta time
   *   5. Clamp to map boundaries
   *
   * @param dt - Delta time in seconds (fixed timestep / 1000)
   */
  update(dt: number): void {
    this.state.players.forEach((player) => {
      // Skip dead players
      if (player.isDead) return;

      // Process limited inputs per tick
      // WHY: A lagging client might queue 100+ inputs.
      // Without limiting, they'd teleport when lag clears.
      let inputsProcessed = 0;

      let input: InputData | undefined;
      while ((input = player.inputQueue.shift()) !== undefined) {
        // Rate limit: stop processing if we've hit the cap
        if (inputsProcessed >= GAME_CONFIG.MAX_INPUTS_PER_TICK) {
          break;
        }

        // Convert input to normalized movement and apply
        const movement = inputToMovement(
          input.left, input.right,
          input.up, input.down,
          player.speed,
          dt
        );

        // Apply movement
        player.x += movement.x;
        player.y += movement.y;

        // Clamp to map boundaries
        const clamped = clampToMap(player.x, player.y);
        player.x = clamped.x;
        player.y = clamped.y;

        // Store last processed tick (for client prediction)
        if (input.tick !== undefined) {
          player.tick = input.tick;
        }

        inputsProcessed++;
      }

      // IMPORTANT: Clear any remaining inputs beyond the cap.
      // WHY: If we don't, old inputs accumulate and cause delayed movement.
      // The player loses those inputs, but that's the price of lag.
      if (player.inputQueue.length > 0) {
        player.inputQueue.length = 0;
      }
    });
  }
}