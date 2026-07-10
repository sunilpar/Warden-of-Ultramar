/**
 * Bolter Shot Skill — Ranged Projectile
 * ======================================
 * Fires a fast-moving projectile in the aim direction.
 * Used by: player. (Future: ork-type enemies.)
 *
 * BEHAVIOR:
 *   - activate(): spawn one projectile at the caster's EDGE (offset toward
 *     the aim direction so it doesn't instantly collide with the caster).
 *   - update(): move it, check wall collision, check entity collision,
 *     apply damage on first hit, despawn on hit/lifetime/out-of-bounds.
 *
 * COLLISION: circle vs circle (enemy/player) + circle vs obstacle (walls).
 * MULTI-HIT FIX: the projectile marks itself "hit" on first contact.
 */

import { getSkillConfig } from "../config/skills";
import { SkillEffect } from "../schema/SkillEffect";
import { circleCollision } from "../utils/collision";
import { ISkill, SkillActivationResult, SkillContext, CasterInfo } from "./ISkill";
import { applyDamage } from "./damage";

const BULLET_COLLISION_RADIUS = 12;
const PLAYER_COLLISION_RADIUS = 20;
const OUT_OF_BOUNDS_MARGIN = 50;

interface BolterData {
  spawnTime: number;
  speed: number;
  lifetime: number;
  hasHit: boolean;
}

export class BolterShotSkill implements ISkill {
  readonly config = getSkillConfig("boltershot");

  activate(caster: CasterInfo, ctx: SkillContext): SkillActivationResult {
    // If no aim direction, don't fire
    if (caster.targetDirX === 0 && caster.targetDirY === 0) {
      return { triggered: false };
    }

    const speed = this.config.bulletSpeed ?? 1000;
    const lifetime = this.config.lifetime ?? 3000;

    const effect = new SkillEffect();
    effect.skillId = this.config.id;
    // startFrom "edge": offset a bit along aim so it clears the caster hitbox
    const offset = caster.isPlayer ? PLAYER_COLLISION_RADIUS : 20;
    effect.x = caster.x + caster.targetDirX * offset;
    effect.y = caster.y + caster.targetDirY * offset;
    effect.directionX = caster.targetDirX;
    effect.directionY = caster.targetDirY;
    effect.radius = BULLET_COLLISION_RADIUS;
    effect.ownerId = caster.ownerId;
    effect.isPlayer = caster.isPlayer;
    effect.data = JSON.stringify(<BolterData>{
      spawnTime: 0, // filled on first update
      speed,
      lifetime,
      hasHit: false,
    });

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
    const data = JSON.parse(effect.data) as BolterData;
    if (data.spawnTime === 0) data.spawnTime = currentTime;

    // Already hit something -> despawn
    if (data.hasHit) return true;

    // Move
    const speed = data.speed;
    effect.x += effect.directionX * speed * dt;
    effect.y += effect.directionY * speed * dt;

    // Out of bounds
    if (
      effect.x < -OUT_OF_BOUNDS_MARGIN ||
      effect.x > ctx.mapWidth + OUT_OF_BOUNDS_MARGIN ||
      effect.y < -OUT_OF_BOUNDS_MARGIN ||
      effect.y > ctx.mapHeight + OUT_OF_BOUNDS_MARGIN
    ) {
      return true;
    }

    // Wall collision
    if (ctx.pointBlocked(effect.x, effect.y)) {
      data.hasHit = true;
      effect.data = JSON.stringify(data);
      return true;
    }

    const damage = this.config.baseDamage;

    // Entity collision
    if (effect.isPlayer) {
      // Player bullet -> enemies
      let hitSomething = false;
      ctx.forEachEnemy((enemy, _id) => {
        if (hitSomething || enemy.isDead) return;
        const enemyRadius = 20; // generic; enemies define their own collision
        const hit = circleCollision(
          effect.x, effect.y, BULLET_COLLISION_RADIUS,
          enemy.x, enemy.y, enemyRadius,
        );
        if (hit) {
          applyDamage(enemy, damage, true, effect.ownerId, ctx);
          data.hasHit = true;
          hitSomething = true;
        }
      });
    } else {
      // Enemy bullet -> players
      let hitSomething = false;
      ctx.forEachPlayer((player, _id) => {
        if (hitSomething || player.isDead) return;
        const hit = circleCollision(
          effect.x, effect.y, BULLET_COLLISION_RADIUS,
          player.x, player.y, PLAYER_COLLISION_RADIUS,
        );
        if (hit) {
          applyDamage(player, damage, false, effect.ownerId, ctx);
          data.hasHit = true;
          hitSomething = true;
        }
      });
    }

    effect.data = JSON.stringify(data);

    // Lifetime expiry
    if (currentTime - data.spawnTime >= data.lifetime) return true;

    return data.hasHit;
  }
}