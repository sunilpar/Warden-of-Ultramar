/**
 * Player System (Per-Player)
 * ===========================
 * Handles player movement, collision, and modifier-based speed.
 */

import { RoomState } from "../schema/RoomState";
import { Player, InputData } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { MapSystem } from "./MapSystem";
import { StatusSystem } from "./StatusSystem";
import { MODIFIER_POOL } from "../config/modifiers";

const ALL_MODS_BY_ID: Record<string, typeof MODIFIER_POOL[number]> = {};
for (const m of MODIFIER_POOL) ALL_MODS_BY_ID[m.id] = m;

export class PlayerSystem {
  private state: RoomState;
  private mapSystem: MapSystem;

  constructor(state: RoomState, mapSystem: MapSystem) {
    this.state = state;
    this.mapSystem = mapSystem;
  }

  update(dt: number): void {
    this.state.players.forEach((player, sessionId) => {
      if (player.isDead) return;
      if (player.isChoosingMod) {
        player.inputQueue.length = 0;
        return;
      }
      if (StatusSystem.isStunned(player)) {
        player.inputQueue.length = 0;
        return;
      }

      const slowMultiplier = StatusSystem.getSlowMultiplier(player);
      const modSpeedMult = this.getPlayerSpeedMult(player);
      const effectiveSpeed = player.speed * slowMultiplier * modSpeedMult;

      let inputsProcessed = 0;
      let input: InputData | undefined;
      while ((input = player.inputQueue.shift()) !== undefined) {
        if (inputsProcessed >= GAME_CONFIG.MAX_INPUTS_PER_TICK) break;

        let dirX = 0;
        let dirY = 0;
        if (input.left) dirX -= 1;
        if (input.right) dirX += 1;
        if (input.up) dirY -= 1;
        if (input.down) dirY += 1;
        const length = Math.sqrt(dirX * dirX + dirY * dirY);
        if (length > 0) {
          dirX /= length;
          dirY /= length;
        }

        player.x += dirX * effectiveSpeed * dt;
        player.y += dirY * effectiveSpeed * dt;

        // Clamp to this player's map boundaries
        const mapW = this.mapSystem.getMapWidth(sessionId);
        const mapH = this.mapSystem.getMapHeight(sessionId);
        player.x = Math.max(0, Math.min(mapW, player.x));
        player.y = Math.max(0, Math.min(mapH, player.y));

        // Resolve obstacle collisions on this player's map
        const hitBlocker = this.mapSystem.checkAllBlockingCollision(
          sessionId,
          player.x,
          player.y,
          GAME_CONFIG.PLAYER.COLLISION_RADIUS,
        );
        if (hitBlocker) {
          const resolved = this.mapSystem.resolveBlockingCollision(
            sessionId,
            player.x,
            player.y,
            GAME_CONFIG.PLAYER.COLLISION_RADIUS,
            hitBlocker,
          );
          player.x = resolved.x;
          player.y = resolved.y;
        }

        if (input.tick !== undefined) {
          player.tick = input.tick;
        }
        inputsProcessed++;
      }
      player.inputQueue.length = 0;
    });
  }

  private getPlayerSpeedMult(player: Player): number {
    let mult = 1;
    for (const md of player.activeMods) {
      const mod = ALL_MODS_BY_ID[md.id];
      if (mod && mod.playerSpeedMult) mult *= mod.playerSpeedMult;
    }
    return mult;
  }
}
