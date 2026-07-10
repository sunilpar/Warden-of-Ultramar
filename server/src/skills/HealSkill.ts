/**
 * Heal Skill — Self Restore
 * =========================
 * Restores the caster's HP. Player-only for now.
 *
 * BEHAVIOR:
 *   - activate(): heal the caster IMMEDIATELY, then spawn a short-lived
 *     visual effect so the client can play a heal aura animation.
 *   - update(): despawn the visual after a short lifetime.
 *
 * COOLDOWN: Heal uses a KILL-BASED cooldown (killsRequired), NOT time.
 * That logic lives in SkillSystem (it checks the caster's killsSinceLastHeal).
 * The activate() never heals more than maxHp.
 */

import { getSkillConfig } from "../config/skills";
import { SkillEffect } from "../schema/SkillEffect";
import { ISkill, SkillActivationResult, SkillContext, CasterInfo } from "./ISkill";

const HEAL_VISUAL_LIFETIME_MS = 600;

interface HealData {
  spawnTime: number;
}

export class HealSkill implements ISkill {
  readonly config = getSkillConfig("heal");

  activate(caster: CasterInfo, ctx: SkillContext): SkillActivationResult {
    const healAmount = this.config.healAmount ?? 300;

    // Heal the caster immediately (only players have this slot, but be safe)
    const casterPlayer = ctx.getPlayer(caster.ownerId);
    if (casterPlayer) {
      casterPlayer.hp = Math.min(casterPlayer.hp + healAmount, casterPlayer.maxHp);
      // Reset kill counter (the cost of using heal)
      casterPlayer.killsSinceLastHeal = 0;
    }

    // Spawn a short-lived visual effect for the client
    const effect = new SkillEffect();
    effect.skillId = this.config.id;
    effect.x = caster.x;
    effect.y = caster.y;
    effect.directionX = 0;
    effect.directionY = 0;
    effect.radius = 0;
    effect.ownerId = caster.ownerId;
    effect.isPlayer = caster.isPlayer;
    effect.data = JSON.stringify(<HealData>{ spawnTime: 0 });

    ctx.spawn(effect);
    return { triggered: true };
  }

  update(
    _effectId: string,
    effect: SkillEffect,
    _dt: number,
    currentTime: number,
    _ctx: SkillContext,
  ): boolean {
    const data = JSON.parse(effect.data) as HealData;
    if (data.spawnTime === 0) data.spawnTime = currentTime;
    effect.data = JSON.stringify(data);

    return currentTime - data.spawnTime >= HEAL_VISUAL_LIFETIME_MS;
  }
}