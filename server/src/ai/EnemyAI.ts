/**
 * Generic Enemy AI — Skill-Based Chase Behavior
 * ==============================================
 * A single AI behavior that works for ANY enemy config:
 *   1. Find the nearest alive player
 *   2. Move toward them until within the enemy's first skill range
 *   3. Trigger the skill via SkillSystem (cooldown handled there)
 *
 * WHY ONE GENERIC AI: With the new skill system, enemy attack logic
 * (damage, range, cooldown) all lives in the skill. The enemy just
 * decides WHEN to get close and WHEN to trigger. That decision is the
 * same for melee (claw) and ranged (future bolter) enemies — move into
 * range, then fire the skill. We don't need separate ElderAI/OrkAI.
 *
 * ENEMY CONFIG: We read enemy.skills[0] as the primary skill and use
 * its `range` to decide the stop distance. If a future enemy has many
 * skills, you can extend this with a small priority picker.
 */

import { Enemy } from "../schema/Enemy";
import { Player } from "../schema/Player";
import { getSkillConfig } from "../config/skills";
import { getEnemyConfig } from "../config/enemies";
import { moveTowardTarget } from "../utils/movement";

/**
 * Runtime AI state for a single enemy.
 * Server-only; NOT synced to clients.
 */
export class EnemyRuntimeState {
  /** Timestamp of last attempted skill use (ms). Cooldown is enforced by SkillSystem. */
  lastSkillAttemptTime: number = 0;
}

/**
 * Update an enemy's AI for this tick.
 *
 * @returns the skill id the enemy wants to trigger this tick (or null),
 *          plus the aim direction toward the target.
 */
export function updateEnemyAI(
  enemy: Enemy,
  state: EnemyRuntimeState,
  findNearestPlayer: (x: number, y: number) => { player: Player; distSq: number } | null,
  dt: number,
  _currentTime: number,
): { skillId: string | null; targetDirX: number; targetDirY: number } {
  if (enemy.isDead) return { skillId: null, targetDirX: 0, targetDirY: 0 };

  // No skills -> can't attack, but still chase
  const primarySkillId = enemy.skills[0];
  if (!primarySkillId) {
    return { skillId: null, targetDirX: 0, targetDirY: 0 };
  }

  const skillCfg = getSkillConfig(primarySkillId);
  const enemyCfg = getEnemyConfig(enemy.enemyType);

  // Find nearest alive player
  const nearest = findNearestPlayer(enemy.x, enemy.y);
  if (!nearest) return { skillId: null, targetDirX: 0, targetDirY: 0 };

  const { player: target } = nearest;

  // Direction to target
  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const dirX = dist > 0 ? dx / dist : 0;
  const dirY = dist > 0 ? dy / dist : 1;

  // Range we want to be within to use the skill.
  // - melee (claw): use skill.range + a small buffer + player radius
  // - projectile: use a "shooting range" feel = a few times the player radius
  // - aoe: stand roughly at the radius
  let desiredRange: number;
  if (skillCfg.type === "melee" && skillCfg.range) {
    desiredRange = skillCfg.range + 20 + 5; // +player radius +buffer
  } else if (skillCfg.type === "projectile") {
    // Stop fairly close so the shot is likely to hit, but not on top of player
    desiredRange = 250;
  } else if (skillCfg.type === "aoe" && skillCfg.radius) {
    desiredRange = skillCfg.radius * 0.8;
  } else {
    desiredRange = 60;
  }

  // Move toward target until within desired range
  if (dist > desiredRange) {
    const newPos = moveTowardTarget(
      enemy.x, enemy.y,
      target.x, target.y,
      enemyCfg.speed,
      dt,
    );
    enemy.x = newPos.x;
    enemy.y = newPos.y;
  }

  // In range -> signal that we want to use the skill
  if (dist <= desiredRange + 10) {
    return { skillId: primarySkillId, targetDirX: dirX, targetDirY: dirY };
  }

  return { skillId: null, targetDirX: dirX, targetDirY: dirY };
}

/** Create a fresh runtime state for a new enemy. */
export function createEnemyRuntimeState(): EnemyRuntimeState {
  return new EnemyRuntimeState();
}