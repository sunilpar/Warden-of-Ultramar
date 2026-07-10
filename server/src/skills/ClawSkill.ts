/**
 * Claw Skill — Melee Cone Attack
 * ==============================
 * Instant damage in a cone arc in front of the caster.
 * Used by: tyranid (enemy). Future melee enemies can share it.
 *
 * BEHAVIOR:
 *   - activate(): create ONE SkillEffect at the caster's position with
 *     the caster's facing direction. Damage is applied ONCE on first update.
 *   - update(): apply cone damage the first tick (processed=false),
 *     then keep the effect alive briefly (LIFETIME) so the client can
 *     show the slash animation, then despawn.
 *
 * COLLISION: coneCollision() (range + half-angle).
 */

import { getSkillConfig } from "../config/skills";
import { SkillEffect } from "../schema/SkillEffect";
import { coneCollision } from "../utils/collision";
import { ISkill, SkillActivationResult, SkillContext, CasterInfo } from "./ISkill";
import { applyDamage } from "./damage";

/** How long the slash visual stays in the world (ms). */
const CLAW_LIFETIME_MS = 500;

interface ClawData {
  processed: boolean;
  spawnTime: number;
}

export class ClawSkill implements ISkill {
  readonly config = getSkillConfig("claw");

  activate(caster: CasterInfo, ctx: SkillContext): SkillActivationResult {
    const effect = new SkillEffect();
    effect.skillId = this.config.id;
    effect.x = caster.x;
    effect.y = caster.y;
    effect.directionX = caster.targetDirX;
    effect.directionY = caster.targetDirY;
    effect.radius = this.config.range ?? 0;
    effect.ownerId = caster.ownerId;
    effect.isPlayer = caster.isPlayer;
    effect.data = JSON.stringify(<ClawData>{
      processed: false,
      spawnTime: 0, // set on first update via ctx.gameTime; we stash in ctx-less form below
    });

    ctx.spawn(effect);
    return { triggered: true };
  }

  update(
    _effectId: string,
    effect: SkillEffect,
    _dt: number,
    currentTime: number,
    ctx: SkillContext,
  ): boolean {
    const data = JSON.parse(effect.data) as ClawData;

    // Apply cone damage once
    if (!data.processed) {
      data.processed = true;
      const range = this.config.range ?? 50;
      const halfAngle = this.config.halfAngle ?? Math.PI / 4;

      const damage = this.config.baseDamage;

      // Damage players (if caster is enemy) — cone check
      if (!effect.isPlayer) {
        ctx.forEachPlayer((player, _id) => {
          if (player.isDead) return;
          // generous: add player collision radius to range
          const hit = coneCollision(
            effect.x, effect.y,
            effect.directionX, effect.directionY,
            range, halfAngle,
            player.x, player.y,
            20, // PLAYER.COLLISION_RADIUS
          );
          if (hit) {
            applyDamage(player, damage, false, effect.ownerId, ctx);
          }
        });
      } else {
        // Player-cast claw would hit enemies
        ctx.forEachEnemy((enemy, _id) => {
          if (enemy.isDead) return;
          const hit = coneCollision(
            effect.x, effect.y,
            effect.directionX, effect.directionY,
            range, halfAngle,
            enemy.x, enemy.y,
            20,
          );
          if (hit) {
            applyDamage(enemy, damage, true, effect.ownerId, ctx);
          }
        });
      }

      data.spawnTime = currentTime;
      effect.data = JSON.stringify(data);
    }

    // Despawn after lifetime
    return currentTime - data.spawnTime >= CLAW_LIFETIME_MS;
  }
}