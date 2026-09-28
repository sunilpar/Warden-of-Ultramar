/**
 * Player System
 * =============
 * Processes player input and moves players each tick.
 * Handles: normalized diagonal movement, boundary clamping, obstacle collision.
 *
 * Per-map scoping: each PlayerSystem instance is bound to ONE map
 * (`targetMapId`) and processes only the players whose `currentMapId`
 * matches. The room runs two systems side-by-side: one for the lobby,
 * one for the room's current gameplay map. This keeps movement +
 * collision resolution isolated to the right map per player.
 */

import { RoomState } from "../schema/RoomState";
import { InputData } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import type { MapId } from "../config/mapRegistry";
import { MapSystem } from "./MapSystem";

export class PlayerSystem {
  constructor(
    private state: RoomState,
    private mapSystem: MapSystem,
    private targetMapId: MapId,
  ) {}

  update(dt: number): void {
    this.state.players.forEach((player) => {
      // Skip players that aren't on this system's map (lobby players
      // are processed by the lobby's PlayerSystem, not this one).
      if (player.currentMapId !== this.targetMapId) return;
      // Skip movement while in hit-stun (pausedUntil).
      if (false) {
        // hit-stun removed
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

        // Resolve tile collisions (O(1) grid lookup).
        // MUST match the client's prediction in client/src/maps/layeredMapData.ts:
        // a CIRCLE of radius PLAYER_COLLISION_RADIUS (= 10). The server used to
        // resolve as an AABB (hw=9, hh=20) which produced different results in
        // narrow gaps and let the player get stuck. Circle vs circle is consistent
        // across server + client prediction.
        const resolved = this.mapSystem.resolveTileCollision(
          player.x,
          player.y,
          GAME_CONFIG.PLAYER.COLLISION_RADIUS,
        );
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
