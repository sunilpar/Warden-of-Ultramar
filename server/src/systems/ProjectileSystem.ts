/**
 * Projectile System
 * =================
 * Advances all projectiles each tick and resolves collisions.
 *
 * BOLTER behaviour (implemented):
 *   - castBolter() spawns a bullet; shared by players and enemies.
 *   - Player bullets (faction "player") hit ENEMIES ONLY.
 *   - Enemy bullets  (faction "enemy")  hit PLAYERS + OTHER ENEMIES.
 *   - On hit: apply damage. If chainRemaining > 0, halve damage and let the
 *     bullet continue (same direction) to seek the next target.
 *   - Bullets despawn on: wall hit, max range, or no chain left after a hit.
 *
 * DAMAGE
 *   Computed at cast time from the caster's attack, the skill level, and the
 *   caster's damageMultiplier (so a +200% damage buff on the player applies).
 *   Chain hits halve the carried damage each bounce.
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { Projectile, type ProjectileFaction } from "../schema/Projectile";
import {
  BOLTER_DEF,
  SKILL_DEFS,
  computeSkillDamage,
  bolterColorTier,
  chainDamageMultiplier,
  type SkillId,
} from "../config/skillDefs";
import type { CollisionResolver } from "./EnemySystem";

export class ProjectileSystem {
  /** Counter for unique projectile ids. */
  private nextId = 1;

  constructor(
    private state: RoomState,
    private mapSystem: CollisionResolver,
  ) {}

  update(dt: number): void {
    const toRemove: string[] = [];

    this.state.projectiles.forEach((proj, id) => {
      // Move
      const stepX = proj.vx * dt;
      const stepY = proj.vy * dt;
      proj.x += stepX;
      proj.y += stepY;
      proj.remainingRange -= Math.hypot(stepX, stepY);

      // Out of range -> despawn
      if (proj.remainingRange <= 0) {
        toRemove.push(id);
        return;
      }

      // Wall collision -> despawn (no pierce through walls)
      if (this.hitsWall(proj)) {
        toRemove.push(id);
        return;
      }

      // Target collision (faction-aware)
      const hitId = this.checkTargetHit(proj);
      if (hitId !== null) {
        // Apply damage already computed on the projectile; for chains the
        // damage was halved when the chain continued.
        this.applyDamage(proj, hitId);
        proj.hitSet.add(hitId);

        if (proj.chainRemaining > 0) {
          // Chain: halve carried damage, keep going.
          proj.chainRemaining -= 1;
          proj.damage *= chainDamageMultiplier(1);
        } else {
          toRemove.push(id);
        }
      }
    });

    for (const id of toRemove) this.state.projectiles.delete(id);
  }

  // ============================================================
  // CASTING
  // ============================================================

  /**
   * Cast the bolter skill. Shared by players and enemies.
   * `ownerId` is the caster's id (never hit self). `faction` decides who can
   * be hit. `attack` + `damageMultiplier` come from the caster's stats.
   * `angle` is the aim direction in radians.
   *
   * Returns true if a projectile was spawned, false otherwise (e.g. bad aim).
   */
  castBolter(
    ownerId: string,
    faction: ProjectileFaction,
    x: number,
    y: number,
    angle: number,
    attack: number,
    skillLevel: number,
    damageMultiplier: number,
  ): boolean {
    const def = BOLTER_DEF;
    const vx = Math.cos(angle) * def.projectileSpeed;
    const vy = Math.sin(angle) * def.projectileSpeed;
    if (Math.hypot(vx, vy) < 0.0001) return false;

    const proj = new Projectile();
    proj.skillId = "bolter";
    proj.x = x;
    proj.y = y;
    proj.vx = vx;
    proj.vy = vy;
    proj.level = skillLevel;
    proj.colorTier = bolterColorTier(skillLevel);
    proj.faction = faction;
    proj.ownerId = ownerId;
    proj.radius = def.projectileRadius;
    proj.remainingRange = def.maxRange;
    proj.chainRemaining = def.chainCount(skillLevel);
    proj.damage = computeSkillDamage(
      "bolter",
      attack,
      skillLevel,
      damageMultiplier,
    );
    proj.hitSet = new Set([ownerId]); // never hit caster

    const id = `proj_${this.nextId++}_${Date.now()}`;
    this.state.projectiles.set(id, proj);
    return true;
  }

  /** Helper: skill cooldown for a given skill id. */
  skillCooldown(skill: SkillId): number {
    const def = (SKILL_DEFS as Record<string, { cooldown: number }>)[skill];
    return def ? def.cooldown : 0;
  }

  // ============================================================
  // COLLISION HELPERS
  // ============================================================

  /** True if the projectile center is inside a solid tile. */
  private hitsWall(proj: Projectile): boolean {
    // Sample the tile at the projectile center against the collision grid.
    const res = this.mapSystem.resolveTileCollision(proj.x, proj.y, proj.radius);
    // If resolution pushed the projectile, it was overlapping a wall.
    return Math.hypot(res.x - proj.x, res.y - proj.y) > 0.01;
  }

  /**
   * Find the first target the projectile overlaps, respecting faction rules.
   * Returns the target's id (player sessionId or enemy key) or null.
   */
  private checkTargetHit(proj: Projectile): string | null {
    const r = proj.radius;

    if (proj.faction === "player") {
      // Player bullets hit ENEMIES only
      let hit: string | null = null;
      this.state.enemies.forEach((enemy, id) => {
        if (hit !== null) return;
        if (proj.hitSet.has(id)) return;
        if (enemy.isDead) return;
        if (this.circleOverlap(proj.x, proj.y, r, enemy.x, enemy.y, enemy.collisionRadius)) {
          hit = id;
        }
      });
      return hit;
    }

    // Enemy bullets hit PLAYERS + OTHER ENEMIES (never caster)
    let hit: string | null = null;
    this.state.players.forEach((player, id) => {
      if (hit !== null) return;
      if (proj.hitSet.has(id)) return;
      if (player.isDead) return;
      if (this.circleOverlap(proj.x, proj.y, r, player.x, player.y, 10)) {
        hit = id;
      }
    });
    if (hit !== null) return hit;

    this.state.enemies.forEach((enemy, id) => {
      if (hit !== null) return;
      if (proj.hitSet.has(id)) return;
      if (enemy.isDead) return;
      if (this.circleOverlap(proj.x, proj.y, r, enemy.x, enemy.y, enemy.collisionRadius)) {
        hit = id;
      }
    });
    return hit;
  }

  /** Apply the projectile's damage to a target id (player or enemy). */
  private applyDamage(proj: Projectile, targetId: string): void {
    const player = this.state.players.get(targetId);
    if (player) {
      player.takeDamage(proj.damage, "bolter");
      return;
    }
    const enemy = this.state.enemies.get(targetId);
    if (enemy) {
      enemy.takeDamage(proj.damage, "bolter");
    }
  }

  /** Circle-vs-circle overlap test. */
  private circleOverlap(
    ax: number,
    ay: number,
    ar: number,
    bx: number,
    by: number,
    br: number,
  ): boolean {
    const rr = ar + br;
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy <= rr * rr;
  }
}
