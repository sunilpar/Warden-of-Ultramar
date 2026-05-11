/**
 * Ork AI — Tactical Ranged Shooter
 * ==================================
 * The Ork is a ranged rifle enemy with three behavior phases:
 *
 *   APPROACHING: Moving toward the nearest player
 *   AIMING:      Stopped, waiting briefly before shooting (deliberate feel)
 *   STRAFING:    After shooting, strafes sideways to reposition
 *
 * DESIGN GOALS:
 *   - Tactical feel (not spammy)
 *   - Long cooldown between shots (2.5 seconds)
 *   - Single powerful bullet (rifle/sniper feel)
 *   - Brief strafe after shooting (avoids being a sitting duck)
 *   - No random movement — every action is intentional
 *
 * STATE MACHINE:
 *   APPROACHING → (in range) → AIMING → (cooldown done) → [FIRE] → STRAFING
 *       ↑                                                          ↓
 *       ←←←←←←←←←←←←←← (strafe done, not in range) ←←←←←←←←←←←←
 *                                      
 *                                 ↓ or still in range:
 *                           back to AIMING (shoot again)
 */

import { Enemy } from "../schema/Enemy";
import { Player } from "../schema/Player";
import { Bullet } from "../schema/Bullet";
import { ORK_CONFIG } from "../config/enemies";
import { ORK_RIFLE_WEAPON } from "../config/weapons";
import { moveTowardTarget, moveInDirection } from "../utils/movement";
import { normalizeVector, distanceSq } from "../utils/math";
import { clampToMap } from "../utils/movement";

/**
 * Ork behavior phases (state machine states).
 */
export type OrkPhase = "approaching" | "aiming" | "strafing";

/**
 * Runtime state for a single Ork enemy.
 * NOT synced to clients — server-only AI memory.
 */
export class OrkRuntimeState {
  /** Current behavior phase */
  phase: OrkPhase = "approaching";

  /** Timestamp of last shot fired (milliseconds) */
  lastShootTime: number = -ORK_CONFIG.attackCooldown; // can shoot immediately on first aim

  /** Timestamp when current strafe started */
  strafeStartTime: number = 0;

  /** Direction of strafing: 1 = right, -1 = left (perpendicular to target) */
  strafeDirection: number = 1;

  /** Timestamp when we entered aiming phase */
  aimStartTime: number = 0;
}

/**
 * Result of Ork AI update — tells the system if a bullet was fired.
 */
export interface OrkAIResult {
  /** Whether the Ork fired a bullet this tick */
  firedBullet: boolean;
  /** The bullet to spawn (if firedBullet is true) */
  bullet: Bullet | null;
}

/**
 * Update the Ork's AI for this tick.
 *
 * @param enemy - The enemy schema object
 * @param state - The runtime AI state
 * @param findNearestPlayer - Function to find nearest alive player
 * @param dt - Delta time in seconds
 * @param currentTime - Current game time in milliseconds
 * @returns OrkAIResult - whether a bullet was fired
 */
export function updateOrkAI(
  enemy: Enemy,
  state: OrkRuntimeState,
  findNearestPlayer: (x: number, y: number) => { player: Player; distSq: number } | null,
  dt: number,
  currentTime: number
): OrkAIResult {
  // Don't do anything if dead
  if (enemy.isDead) {
    return { firedBullet: false, bullet: null };
  }

  // Find nearest alive player
  const nearest = findNearestPlayer(enemy.x, enemy.y);
  if (!nearest) {
    return { firedBullet: false, bullet: null };
  }

  const { player: target } = nearest;
  const distSq = distanceSq(enemy.x, enemy.y, target.x, target.y);
  const shootingRangeSq = ORK_CONFIG.shootingRange * ORK_CONFIG.shootingRange;

  // Process current phase
  switch (state.phase) {
    // ========================================
    // APPROACHING: Move toward target until in shooting range
    // ========================================
    case "approaching": {
      if (distSq <= shootingRangeSq) {
        // In range! Switch to aiming
        state.phase = "aiming";
        state.aimStartTime = currentTime;
      } else {
        // Not in range — keep moving toward target
        const newPos = moveTowardTarget(
          enemy.x, enemy.y,
          target.x, target.y,
          ORK_CONFIG.speed,
          dt
        );
        enemy.x = newPos.x;
        enemy.y = newPos.y;
      }
      break;
    }

    // ========================================
    // AIMING: Stopped, waiting for cooldown, then fire
    // ========================================
    case "aiming": {
      // Check if cooldown has expired — if so, FIRE!
      const timeSinceLastShot = currentTime - state.lastShootTime;
      if (timeSinceLastShot >= ORK_CONFIG.attackCooldown) {
        // Fire a bullet toward the target
        const bullet = createOrkBullet(enemy, target);

        // Update state
        state.lastShootTime = currentTime;

        // Switch to strafing after shooting
        state.phase = "strafing";
        state.strafeStartTime = currentTime;
        // Pick strafe direction: use a deterministic alternation instead of random
        state.strafeDirection = state.strafeDirection === 1 ? -1 : 1;

        return { firedBullet: true, bullet };
      }
      // Otherwise: stay still and wait for cooldown (deliberate aiming feel)
      break;
    }

    // ========================================
    // STRAFING: Sidestep after shooting, then re-evaluate
    // ========================================
    case "strafing": {
      const strafeElapsed = currentTime - state.strafeStartTime;

      // Calculate perpendicular direction to target (for strafing)
      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;

      // Strafe perpendicular to target direction
      const newPos = moveInDirection(
        enemy.x, enemy.y,
        -dy * state.strafeDirection, // perpendicular X
        dx * state.strafeDirection,  // perpendicular Y
        ORK_CONFIG.strafeSpeed,
        dt
      );
      enemy.x = newPos.x;
      enemy.y = newPos.y;

      // Check if strafe duration is over
      if (strafeElapsed >= ORK_CONFIG.strafeDuration) {
        if (distSq <= shootingRangeSq) {
          // Still in range — aim and shoot again
          state.phase = "aiming";
          state.aimStartTime = currentTime;
        } else {
          // Target moved away — approach again
          state.phase = "approaching";
        }
      }
      break;
    }
  }

  // Clamp enemy position to map bounds
  const clamped = clampToMap(enemy.x, enemy.y);
  enemy.x = clamped.x;
  enemy.y = clamped.y;

  return { firedBullet: false, bullet: null };
}

/**
 * Create a rifle bullet aimed at the target.
 * Uses normalized direction for consistent speed.
 */
function createOrkBullet(enemy: Enemy, target: Player): Bullet {
  const bullet = new Bullet();
  bullet.x = enemy.x;
  bullet.y = enemy.y;
  bullet.damage = ORK_RIFLE_WEAPON.damage;
  bullet.ownerId = ""; // will be set by the caller with enemy ID

  // Calculate normalized direction toward target
  const dir = normalizeVector(target.x - enemy.x, target.y - enemy.y);
  bullet.directionX = dir.x;
  bullet.directionY = dir.y;

  return bullet;
}

/**
 * Create a fresh runtime state for a new Ork.
 */
export function createOrkRuntimeState(): OrkRuntimeState {
  return new OrkRuntimeState();
}