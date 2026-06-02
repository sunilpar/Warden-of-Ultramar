/**
 * Elder AI — Melee Chase Behavior
 * ================================
 * The Elder is a simple melee enemy that:
 *   1. Finds the nearest alive player
 *   2. Moves steadily toward them
 *   3. Attacks on contact with a cooldown
 *
 * DESIGN GOALS:
 *   - Feels heavy and steady (not jittery)
 *   - No random movement — always moves toward target
 *   - Attack has a proper cooldown (not every tick)
 *   - Clean state machine for easy understanding
 *
 * WHY NO RANDOM: The old code used Math.random() every frame to
 * decide if the Elder moves. This created chaotic, jittery movement.
 * Now the Elder always moves toward its target — steady and threatening.
 */

import { Enemy } from "../schema/Enemy";
import { Player } from "../schema/Player";
import { ELDER_CONFIG } from "../config/enemies";
import { CLAW_WEAPON } from "../config/weapons";
import { moveTowardTarget } from "../utils/movement";
import { circleCollision } from "../utils/collision";

/**
 * Runtime state for a single Elder enemy.
 * This is NOT synced to clients — it's server-only AI memory.
 */
export class ElderRuntimeState {
  /** Timestamp of last melee attack (milliseconds since game start) */
  lastAttackTime: number = 0;
}

/**
 * Update the Elder's AI for this tick.
 *
 * @param enemy - The enemy schema object (position, hp, etc.)
 * @param state - The runtime AI state (cooldowns, memory)
 * @param findNearestPlayer - Function to find nearest alive player
 * @param dt - Delta time in seconds
 * @param currentTime - Current game time in milliseconds
 * @returns { attacked: boolean, target: Player | null } - whether an attack happened and who was targeted
 */
export function updateElderAI(
  enemy: Enemy,
  state: ElderRuntimeState,
  findNearestPlayer: (x: number, y: number) => { player: Player; distSq: number } | null,
  dt: number,
  currentTime: number
): { attacked: boolean; target: Player | null; directionX: number; directionY: number } {
  // Don't do anything if dead
  if (enemy.isDead) {
    return { attacked: false, target: null, directionX: 0, directionY: 0 };
  }

  // Find nearest alive player
  const nearest = findNearestPlayer(enemy.x, enemy.y);
  if (!nearest) {
    return { attacked: false, target: null, directionX: 0, directionY: 0 };
  }

  const { player: target } = nearest;

  // Calculate distance and direction to target
  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const dirX = dist > 0 ? dx / dist : 0;
  const dirY = dist > 0 ? dy / dist : 1;

  // Stop distance: claw range + player radius + 5px buffer
  // This prevents the enemy from walking through the player
  const STOP_DISTANCE = CLAW_WEAPON.range + 20 + 5; // claw range + player radius + buffer

  // Only move if NOT within stop distance
  if (dist > STOP_DISTANCE) {
    const newPos = moveTowardTarget(
      enemy.x, enemy.y,
      target.x, target.y,
      ELDER_CONFIG.speed,
      dt
    );
    enemy.x = newPos.x;
    enemy.y = newPos.y;
  }

  // Check if in claw range (use claw weapon range + player collision radius)
  const inClawRange = dist <= (CLAW_WEAPON.range + 20 + 5);

  // Attack if in range AND cooldown has expired
  if (inClawRange && currentTime - state.lastAttackTime >= CLAW_WEAPON.cooldown) {
    state.lastAttackTime = currentTime;
    return { attacked: true, target, directionX: dirX, directionY: dirY };
  }

  return { attacked: false, target: null, directionX: 0, directionY: 0 };
}

/**
 * Create a fresh runtime state for a new Elder.
 */
export function createElderRuntimeState(): ElderRuntimeState {
  return new ElderRuntimeState();
}