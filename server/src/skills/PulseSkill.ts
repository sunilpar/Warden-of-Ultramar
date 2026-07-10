/**
 * Pulse Skill — Instant Area-of-Effect
 * ====================================
 * Damages all enemies/players within a radius around the caster instantly.
 * Used by: player. (Future: elder-type enemies.)
 *
 * BEHAVIOR:
 *   - activate(): damage applied IMMEDIATELY here (AoE is instant), then
 *     spawn a short-lived visual ring effect for the client animation.
 *   - update(): just counts down lifetime then despawns the visual.
 *
 * WHY INSTANT: An expanding shockwave that grows over time would need
 * per-tick collision re-checks and "already hit" tracking per target.
 * For gameplay feel, a single instant hit + a visual ring is simpler,
 * deterministic, and matches the original implementation.
 */

import { getSkillConfig } from "../config/skills";
import { SkillEffect } from "../schema/SkillEffect";
import { pointInRange } from "../utils/collision";
import { ISkill, SkillActivationResult, SkillContext, CasterInfo } from "./ISkill";
import { applyDamage } from "./damage";

const PULSE_VISUAL_LIFETIME_MS = 400;

interface PulseData {
  spawnTime: number;
}

export class PulseSkill implements ISkill {
  readonly config = getSkillConfig("pulse");

  activate(caster: CasterInfo, ctx: SkillContext): SkillActivationResult {
    const radius = this.config.radius ?? 100;
    const damage = this.config.baseDamage;

    // ---- Apply AoE damage immediately ----
    if (caster.isPlayer) {
      ctx.forEachEnemy((enemy, _id) => {
        if (enemy.isDead) return;
        if (pointInRange(caster.x, caster.y, enemy.x, enemy.y, radius)) {
          applyDamage(enemy, damage, true, caster.ownerId, ctx);
        }
      });
    } else {
      // Enemy-cast pulse hits players
      ctx.forEachPlayer((player, _id) => {
        if (player.isDead) return;
        if (pointInRange(caster.x, caster.y, player.x, player.y, radius)) {
          applyDamage(player, damage, false, caster.ownerId, ctx);
        }
      });
    }

    // ---- Spawn a short-lived visual effect for the client ----
    const effect = new SkillEffect();
    effect.skillId = this.config.id;
    effect.x = caster.x;
    effect.y = caster.y;
    effect.directionX = 0;
    effect.directionY = 0;
    effect.radius = radius;
    effect.ownerId = caster.ownerId;
    effect.isPlayer = caster.isPlayer;
    effect.data = JSON.stringify(<PulseData>{ spawnTime: 0 });

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
    const data = JSON.parse(effect.data) as PulseData;
    if (data.spawnTime === 0) data.spawnTime = currentTime;
    effect.data = JSON.stringify(data);

    return currentTime - data.spawnTime >= PULSE_VISUAL_LIFETIME_MS;
  }
}