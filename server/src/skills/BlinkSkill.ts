/**
 * Blink Skill - Shadow Step
 * ==========================
 * Teleports the caster 100px in their facing direction.
 * Invincible DURING the brief travel, then vulnerable again.
 *
 * The invincibility duration = effect duration so update() always
 * gets a chance to remove invincibility before despawning.
 */

import { getSkillConfig } from "../config/skills";
import { SkillEffect } from "../schema/SkillEffect";
import { ISkill, SkillActivationResult, SkillContext, CasterInfo } from "./ISkill";

const BLINK_DISTANCE = 100;
const BLINK_DURATION_MS = 400; // invincibility + effect both last this long

export class BlinkSkill implements ISkill {
  readonly config = getSkillConfig("blink");

  activate(caster: CasterInfo, ctx: SkillContext): SkillActivationResult {
    const distance = this.config.radius ?? BLINK_DISTANCE;

    // Determine facing direction
    let dirX = caster.targetDirX;
    let dirY = caster.targetDirY;
    if (dirX === 0 && dirY === 0) {
      dirX = 1;
      dirY = 0;
    }

    const newX = caster.x + dirX * distance;
    const newY = caster.y + dirY * distance;

    const clampedX = Math.max(20, Math.min(ctx.mapWidth - 20, newX));
    const clampedY = Math.max(20, Math.min(ctx.mapHeight - 20, newY));

    // Teleport + invincibility at the same time
    if (caster.isPlayer) {
      const player = ctx.getPlayer(caster.ownerId);
      if (player) {
        player.x = ctx.pointBlocked(clampedX, clampedY) ? caster.x : clampedX;
        player.y = ctx.pointBlocked(clampedX, clampedY) ? caster.y : clampedY;
        player.isInvincible = true;
      }
    } else {
      const enemy = ctx.getEnemy(caster.ownerId);
      if (enemy) {
        enemy.x = ctx.pointBlocked(clampedX, clampedY) ? caster.x : clampedX;
        enemy.y = ctx.pointBlocked(clampedX, clampedY) ? caster.y : clampedY;
        enemy.isInvincible = true;
      }
    }

    const effect = new SkillEffect();
    effect.skillId = this.config.id;
    effect.x = clampedX;
    effect.y = clampedY;
    effect.directionX = dirX;
    effect.directionY = dirY;
    effect.ownerId = caster.ownerId;
    effect.isPlayer = caster.isPlayer;
    effect.data = JSON.stringify({ spawnTime: 0 });

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
    const data = JSON.parse(effect.data);
    if (data.spawnTime === 0) {
      data.spawnTime = currentTime;
      effect.data = JSON.stringify(data);
    }

    const elapsed = currentTime - data.spawnTime;

    // Time's up: remove invincibility THEN despawn
    if (elapsed >= BLINK_DURATION_MS) {
      if (effect.isPlayer) {
        const player = ctx.getPlayer(effect.ownerId);
        if (player) player.isInvincible = false;
      } else {
        const enemy = ctx.getEnemy(effect.ownerId);
        if (enemy) enemy.isInvincible = false;
      }
      return true; // despawn
    }
    return false;
  }
}
