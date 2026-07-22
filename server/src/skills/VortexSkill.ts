/**
 * Vortex Skill — Gravitational Pull
 * ==================================
 * Pulls all enemies (or players if enemy-cast) toward the caster over
 * the duration of the effect. No damage — purely positional control.
 *
 * BEHAVIOR:
 *   - activate(): spawn a long-lived visual effect (the vortex swirl).
 *   - update(): each tick, move all in-range targets toward the caster
 *     by a pull speed. Despawn when the duration expires.
 *
 * RADIUS: 2x the pulse skill (200 vs 100) for a massive pull zone.
 */

import { getSkillConfig } from "../config/skills";
import { SkillEffect } from "../schema/SkillEffect";
import { pointInRange } from "../utils/collision";
import { ISkill, SkillActivationResult, SkillContext, CasterInfo } from "./ISkill";

const VORTEX_DURATION_MS = 1500;
const VORTEX_PULL_SPEED = 250; // pixels per second

interface VortexData {
  spawnTime: number;
}

export class VortexSkill implements ISkill {
  readonly config = getSkillConfig("vortex");

  activate(caster: CasterInfo, ctx: SkillContext): SkillActivationResult {
    const radius = this.config.radius ?? 200;

    const effect = new SkillEffect();
    effect.skillId = this.config.id;
    effect.x = caster.x;
    effect.y = caster.y;
    effect.directionX = 0;
    effect.directionY = 0;
    effect.radius = radius;
    effect.ownerId = caster.ownerId;
    effect.isPlayer = caster.isPlayer;
    effect.data = JSON.stringify(<VortexData>{ spawnTime: 0 });

    ctx.spawn(effect);
    return { triggered: true };
  }

  update(
    _effectId: string,
    effect: SkillEffect,
    dt: number,
    currentTime: number,
    ctx: SkillContext,
  ): boolean {
    const data = JSON.parse(effect.data) as VortexData;
    if (data.spawnTime === 0) data.spawnTime = currentTime;
    effect.data = JSON.stringify(data);

    // Check if duration expired
    if (currentTime - data.spawnTime >= VORTEX_DURATION_MS) {
      return true; // despawn
    }

    // Keep the vortex centered on its position (where the caster was)
    const cx = effect.x;
    const cy = effect.y;
    const radius = effect.radius;
    const pull = VORTEX_PULL_SPEED * dt;

    // Pull targets toward the center
    if (effect.isPlayer) {
      // Player-cast: pull enemies
      ctx.forEachEnemy((enemy, _id) => {
        if (enemy.isDead) return;
        if (!pointInRange(cx, cy, enemy.x, enemy.y, radius)) return;

        const dx = cx - enemy.x;
        const dy = cy - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 1) return; // already at center

        const moveX = (dx / dist) * Math.min(pull, dist);
        const moveY = (dy / dist) * Math.min(pull, dist);
        enemy.x += moveX;
        enemy.y += moveY;
      });
    } else {
      // Enemy-cast: pull players
      ctx.forEachPlayer((player, _id) => {
        if (player.isDead) return;
        if (!pointInRange(cx, cy, player.x, player.y, radius)) return;

        const dx = cx - player.x;
        const dy = cy - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 1) return;

        const moveX = (dx / dist) * Math.min(pull, dist);
        const moveY = (dy / dist) * Math.min(pull, dist);
        player.x += moveX;
        player.y += moveY;
      });
    }

    return false;
  }
}
