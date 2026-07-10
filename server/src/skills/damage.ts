/**
 * Skill Damage Helpers
 * ====================
 * Shared logic used by multiple skills to apply damage consistently:
 *   - friendly fire prevention (player effects hit enemies, not players)
 *   - death handling (clamp hp, set isDead, award kills to the caster)
 *
 * Keeping this here means every skill applies death/kill logic the
 * exact same way, so we never get "this skill kills but doesn't count".
 */

import type { SkillContext } from "./ISkill";

/**
 * Apply damage to a single target respecting death state.
 * Caller has ALREADY decided this target should be hit (collision passed).
 *
 * @param target - schema object (player or enemy) with hp/maxHp/isDead
 * @param amount - damage to subtract
 * @param casterIsPlayer - if true and target is a player, ignore (no friendly fire)
 * @param casterOwnerId  - used to award kills
 * @param ctx            - for kill tracking
 */
export function applyDamage(
  target: any,
  amount: number,
  casterIsPlayer: boolean,
  casterOwnerId: string,
  ctx: SkillContext,
): void {
  if (!target || target.isDead) return;

  // Friendly fire: player-cast effects never damage players
  if (casterIsPlayer && target.killsSinceLastHeal !== undefined) {
    // target is a player (has killsSinceLastHeal) -> skip
    return;
  }

  target.hp -= amount;
  if (target.hp <= 0) {
    target.hp = 0;
    target.isDead = true;

    // Award kill to the casting player (for heal-card cooldown)
    if (casterIsPlayer) {
      const caster = ctx.getPlayer(casterOwnerId);
      if (caster) caster.killsSinceLastHeal++;
    }
  }
}

/**
 * Convenience: apply damage to many targets in one call.
 */
export function applyDamageToMany(
  targets: { target: any }[],
  amount: number,
  casterIsPlayer: boolean,
  casterOwnerId: string,
  ctx: SkillContext,
): void {
  for (const { target } of targets) {
    applyDamage(target, amount, casterIsPlayer, casterOwnerId, ctx);
  }
}