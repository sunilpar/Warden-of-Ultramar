/**
 * Skill Damage Helpers
 * ====================
 * Shared logic used by skills to apply damage consistently:
 *   - friendly fire prevention
 *   - death handling
 *   - modifier damage scaling
 */

import type { SkillContext } from "./ISkill";

export function applyDamage(
  target: any,
  amount: number,
  casterIsPlayer: boolean,
  casterOwnerId: string,
  ctx: SkillContext,
): void {
  if (!target || target.isDead) return;
  if (target.isInvincible) return;

  // Friendly fire: player-cast effects never damage players
  if (casterIsPlayer && target.killsSinceLastHeal !== undefined) {
    return;
  }

  // Modifier damage scaling
  let scaledAmount = amount;
  if (casterIsPlayer && ctx._playerSkillDamageMult) {
    scaledAmount = amount * ctx._playerSkillDamageMult;
  } else if (!casterIsPlayer && ctx._enemySkillDamageMult) {
    scaledAmount = amount * ctx._enemySkillDamageMult;
  }

  target.hp -= scaledAmount;
  if (target.hp <= 0) {
    target.hp = 0;
    target.isDead = true;
    if (casterIsPlayer) {
      const caster = ctx.getPlayer(casterOwnerId);
      if (caster) caster.killsSinceLastHeal++;
    }
  }
}

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
