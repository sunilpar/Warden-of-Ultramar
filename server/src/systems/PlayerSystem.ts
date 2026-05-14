/**
 * Player System
 * ==============
 * Handles all player-related logic each tick:
 *   - Processing queued inputs
 *   - Normalized movement (fixes diagonal speed)
 *   - Delta-time based movement
 *   - Input rate limiting (prevents lag exploits)
 *   - Map boundary clamping
 *   - Obstacle collision resolution
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
import { MapSystem } from "./MapSystem";

export class PlayerSystem {
  /** Reference to the shared game state */
  private state: RoomState;
  /** Reference to the map system (for obstacle collision + dynamic bounds) */
  private mapSystem: MapSystem;

  constructor(state: RoomState, mapSystem: MapSystem) {
    this.state = state;
    this.mapSystem = mapSystem;
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
   *   6. Resolve obstacle collisions (push out of walls)
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

        // Clamp to map boundaries (use actual map size from MapSystem)
        const clamped = clampToMap(
          player.x, player.y,
          this.mapSystem.mapWidth, this.mapSystem.mapHeight
        );
        player.x = clamped.x;
        player.y = clamped.y;

        // Resolve obstacle + enemy spawn zone collisions
        // WHY: After movement + clamp, the player might be inside an obstacle
        // or enemy spawn zone. We push them out along the shortest axis.
        const hitBlocker = this.mapSystem.checkAllBlockingCollision(
          player.x, player.y,
          GAME_CONFIG.PLAYER.COLLISION_RADIUS
        );
        if (hitBlocker) {
          const resolved = this.mapSystem.resolveBlockingCollision(
            player.x, player.y,
            GAME_CONFIG.PLAYER.COLLISION_RADIUS,
            hitBlocker
          );
          player.x = resolved.x;
          player.y = resolved.y;
        }

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