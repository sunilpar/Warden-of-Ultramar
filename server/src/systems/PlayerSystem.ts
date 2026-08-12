/**
 * Player System
 * =============
 * Processes player input and moves players each tick.
 * Handles: normalized diagonal movement, boundary clamping, obstacle collision.
 */

import { RoomState } from "../schema/RoomState";
import { InputData } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { MapSystem } from "./MapSystem";

export class PlayerSystem {
  constructor(
    private state: RoomState,
    private mapSystem: MapSystem,
  ) {}

  update(dt: number): void {
    this.state.players.forEach((player) => {
      // Skip movement while in hit-stun (pausedUntil).
      if (false) { // hit-stun removed
        player.inputQueue.length = 0;
        return;
      }
      let inputsProcessed = 0;
      let input: InputData | undefined;

      while ((input = player.inputQueue.shift()) !== undefined) {
        if (inputsProcessed >= GAME_CONFIG.MAX_INPUTS_PER_TICK) break;

        // Build direction vector from input
        let dirX = 0;
        let dirY = 0;
        if (input.left) dirX -= 1;
        if (input.right) dirX += 1;
        if (input.up) dirY -= 1;
        if (input.down) dirY += 1;

        // Normalize so diagonal movement is same speed as cardinal
        const length = Math.sqrt(dirX * dirX + dirY * dirY);
        if (length > 0) {
          dirX /= length;
          dirY /= length;
        }

        // Apply movement using the player's EFFECTIVE move speed
        // (base * speedMultiplier), so debuffs/buffs take effect
        // immediately. Recompute each tick in case a debuff changed.
        player.recalcDerivedStats();
        const speed = player.moveSpeed;
        player.x += dirX * speed * dt;
        player.y += dirY * speed * dt;

        // Clamp to map boundaries
        player.x = Math.max(0, Math.min(this.mapSystem.width, player.x));
        player.y = Math.max(0, Math.min(this.mapSystem.height, player.y));

        // Resolve tile collisions (O(1) grid lookup)
        const resolved = this.mapSystem.resolveRectTileCollision(player.x, player.y, player.hitboxW, player.hitboxH);
        player.x = resolved.x;
        player.y = resolved.y;

        if (input.tick !== undefined) {
          player.tick = input.tick;
        }
        inputsProcessed++;
      }
      player.inputQueue.length = 0;
    });
  }
}
