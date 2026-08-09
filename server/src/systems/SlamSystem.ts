/**
 * Slam System
 * ===========
 * Implements the slam skill: a moving rectangular hitbox that travels in a
 * fixed direction, damaging anything in its path and knocking them back.
 * The hitbox does NOT despawn on hit - it persists until it finishes
 * travelling its full range or hits a wall.
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { Slam, type SlamFaction } from "../schema/Slam";
import { SLAM_DEF } from "../config/skillDefs";
import type { CollisionResolver } from "./EnemySystem";

export class SlamSystem {
  private nextId = 1;

  constructor(
    private state: RoomState,
    private mapSystem: CollisionResolver,
  ) {}

  /** Advance all active slams: move, check wall collision, apply damage. */
  update(dt: number): void {
    const toRemove: string[] = [];

    this.state.slams.forEach((slam, id) => {
      // Move
      const stepX = slam.vx * dt;
      const stepY = slam.vy * dt;
      slam.x += stepX;
      slam.y += stepY;
      slam.remainingRange -= Math.hypot(stepX, stepY);

      // Out of range -> remove
      if (slam.remainingRange <= 0) {
        toRemove.push(id);
        return;
      }

      // Wall collision -> stop and remove
      if (this.hitsWall(slam)) {
        toRemove.push(id);
        return;
      }

      // Apply damage to targets in the hitbox (with per-target cooldown)
      this.checkHits(slam, dt);
    });

    for (const id of toRemove) this.state.slams.delete(id);
  }

  // ============================================================
  // CASTING
  // ============================================================

  castSlam(
    ownerId: string,
    faction: SlamFaction,
    x: number,
    y: number,
    angle: number,
    skillLevel: number,
  ): boolean {
    const range = SLAM_DEF.range(skillLevel);
    const vx = Math.cos(angle) * SLAM_DEF.speed;
    const vy = Math.sin(angle) * SLAM_DEF.speed;

    const slam = new Slam();
    slam.skillId = "slam";
    slam.x = x;
    slam.y = y;
    slam.vx = vx;
    slam.vy = vy;
    slam.angle = angle;
    slam.level = skillLevel;
    slam.faction = faction;
    slam.ownerId = ownerId;
    slam.remainingRange = range;
    slam.halfWidth = SLAM_DEF.halfWidth;
    slam.halfHeight = SLAM_DEF.halfHeight;
    slam.damage = 200; // base slam damage

    const id = `slam_${this.nextId++}_${Date.now()}`;
    this.state.slams.set(id, slam);
    return true;
  }

  // ============================================================
  // HIT DETECTION
  // ============================================================

  /** Check if any targets overlap the slam's rectangular hitbox. */
  private checkHits(slam: Slam, dt: number): void {
    // Decrement per-target hit cooldowns
    for (const [tid, cd] of slam.hitCooldowns) {
      const newCd = cd - dt;
      if (newCd <= 0) {
        slam.hitCooldowns.delete(tid);
      } else {
        slam.hitCooldowns.set(tid, newCd);
      }
    }

    if (slam.faction === "player") {
      this.state.enemies.forEach((enemy, id) => {
        if (id === slam.ownerId || enemy.isDead) return;
        if (slam.hitCooldowns.has(id)) return;
        if (this.rectContains(slam, enemy.x, enemy.y, enemy.collisionRadius)) {
          enemy.takeDamage(slam.damage);
          this.knockback(enemy, slam.angle);
          slam.hitCooldowns.set(id, SLAM_DEF.hitInterval);
        }
      });
    } else {
      // Enemy slam: hits players + other enemies (never caster)
      this.state.players.forEach((player, id) => {
        if (id === slam.ownerId || player.isDead) return;
        if (slam.hitCooldowns.has(id)) return;
        if (this.rectContains(slam, player.x, player.y, 10)) {
          player.takeDamage(slam.damage);
          this.knockbackPlayer(player, slam.angle);
          slam.hitCooldowns.set(id, SLAM_DEF.hitInterval);
        }
      });
      this.state.enemies.forEach((enemy, id) => {
        if (id === slam.ownerId || enemy.isDead) return;
        if (slam.hitCooldowns.has(id)) return;
        if (this.rectContains(slam, enemy.x, enemy.y, enemy.collisionRadius)) {
          enemy.takeDamage(slam.damage);
          this.knockback(enemy, slam.angle);
          slam.hitCooldowns.set(id, SLAM_DEF.hitInterval);
        }
      });
    }
  }

  /**
   * Point-in-rectangle test. The rectangle is centered at (slam.x, slam.y),
   * oriented along slam.angle. halfHeight = along travel dir, halfWidth =
   * perpendicular. We transform the point into the rectangle's local space.
   */
  private rectContains(
    slam: Slam,
    px: number,
    py: number,
    targetRadius: number,
  ): boolean {
    const cos = Math.cos(-slam.angle);
    const sin = Math.sin(-slam.angle);
    const dx = px - slam.x;
    const dy = py - slam.y;
    // Local coordinates (localX along travel, localY perpendicular)
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    return (
      Math.abs(localX) <= slam.halfHeight + targetRadius &&
      Math.abs(localY) <= slam.halfWidth + targetRadius
    );
  }

  /** Knock back an enemy in the slam's travel direction. */
  private knockback(enemy: Enemy, angle: number): void {
    const force = 40;
    enemy.x += Math.cos(angle) * force;
    enemy.y += Math.sin(angle) * force;
    enemy.x = Math.max(0, Math.min(this.mapSystem.width, enemy.x));
    enemy.y = Math.max(0, Math.min(this.mapSystem.height, enemy.y));
    const resolved = this.mapSystem.resolveTileCollision(
      enemy.x,
      enemy.y,
      enemy.collisionRadius,
    );
    enemy.x = resolved.x;
    enemy.y = resolved.y;
  }

  /** Knock back a player in the slam's travel direction. */
  private knockbackPlayer(player: Player, angle: number): void {
    const force = 40;
    player.x += Math.cos(angle) * force;
    player.y += Math.sin(angle) * force;
    player.x = Math.max(0, Math.min(this.mapSystem.width, player.x));
    player.y = Math.max(0, Math.min(this.mapSystem.height, player.y));
    const resolved = this.mapSystem.resolveTileCollision(player.x, player.y, 10);
    player.x = resolved.x;
    player.y = resolved.y;
  }

  /** True if the slam center is inside a solid tile. */
  private hitsWall(slam: Slam): boolean {
    const res = this.mapSystem.resolveTileCollision(slam.x, slam.y, slam.halfHeight);
    return Math.hypot(res.x - slam.x, res.y - slam.y) > 0.01;
  }
}
