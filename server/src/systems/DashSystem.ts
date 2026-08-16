/**
 * Dash System
 * ===========
 * Evasion skill: instantly moves the caster toward a target position (mouse),
 * granting brief invincibility during the dash. At L6+, an ice blast AoE
 * triggers at the landing position, dealing ice damage in a small radius.
 *
 * The dash is INSTANT (no travel time) — the caster is teleported to the
 * destination, made invincible for a brief window, and a VFX SkillCast is
 * spawned for the client to render the dash trail + emerge effect.
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { SkillCast } from "../schema/SkillCast";
import {
  applyCrit,
  dashRange,
  dashHasIceBlast,
  dashIceBlastDamage,
  dashIceBlastRadius,
} from "../config/skillDefs";

/** Duration of invincibility after a dash (ms). Covers the dash + brief recovery. */
const DASH_INVINCIBLE_MS = 300;

export class DashSystem {
  private nextId = 1;

  constructor(private state: RoomState) {}

  // ============================================================
  // PLAYER DASH
  // ============================================================

  /**
   * Cast dash for a player. Instantly moves the player toward the aim angle
   * by dashRange(level), grants invincibility, and spawns VFX.
   * At L6+, triggers ice blast at the landing position.
   * Returns true if the dash was applied.
   */
  castPlayerDash(
    player: Player,
    sessionId: string,
    skillLevel: number,
    angle: number,
    critRate: number,
    critDamage: number,
  ): boolean {
    if (skillLevel <= 0) return false;

    const range = dashRange(skillLevel);
    const now = Date.now();

    // Record start position for VFX trail
    const startX = player.x;
    const startY = player.y;

    // Calculate destination (clamped by range toward the aim angle)
    const destX = player.x + Math.cos(angle) * range;
    const destY = player.y + Math.sin(angle) * range;

    // Move the player instantly
    player.x = destX;
    player.y = destY;

    // Grant invincibility
    player.invincibleUntil = now + DASH_INVINCIBLE_MS;

    // Spawn dash VFX (trail from start to dest)
    this.spawnDashVfx(startX, startY, destX, destY, skillLevel, angle, "player");

    // Ice blast at L6+
    if (dashHasIceBlast(skillLevel)) {
      this.doIceBlast(destX, destY, skillLevel, "player", sessionId, critRate, critDamage);
    }

    return true;
  }

  // ============================================================
  // ENEMY DASH
  // ============================================================

  /**
   * Cast dash for an enemy (AI usage). Same mechanics as player dash.
   * Enemies dash away from their target (evasion) or toward a random direction.
   */
  castEnemyDash(
    enemy: Enemy,
    skillLevel: number = 1,
    angle: number,
    critRate: number = 0,
    critDamage: number = 1.5,
  ): boolean {
    if (skillLevel <= 0) return false;

    const range = dashRange(skillLevel);
    const now = Date.now();

    const startX = enemy.x;
    const startY = enemy.y;

    const destX = enemy.x + Math.cos(angle) * range;
    const destY = enemy.y + Math.sin(angle) * range;

    enemy.x = destX;
    enemy.y = destY;
    enemy.invincibleUntil = now + DASH_INVINCIBLE_MS;

    this.spawnDashVfx(startX, startY, destX, destY, skillLevel, angle, "enemy");

    if (dashHasIceBlast(skillLevel)) {
      this.doIceBlastEnemy(destX, destY, skillLevel, critRate, critDamage);
    }

    return true;
  }

  // ============================================================
  // ICE BLAST (L6+)
  // ============================================================

  /**
   * Ice blast: small-radius AoE ice damage at the landing position.
   * Damages enemies (when cast by player) or players (when cast by enemy).
   */
  private doIceBlast(
    x: number,
    y: number,
    skillLevel: number,
    faction: string,
    attackerId: string,
    critRate: number,
    critDamage: number,
  ): void {
    const damage = dashIceBlastDamage(skillLevel);
    const radius = dashIceBlastRadius(skillLevel);
    if (damage <= 0 || radius <= 0) return;

    this.state.enemies.forEach((enemy) => {
      if (enemy.isDead) return;
      const dist = Math.hypot(enemy.x - x, enemy.y - y);
      if (dist <= radius) {
        const { damage: finalDamage, isCrit } = applyCrit(damage, critRate, critDamage);
        enemy.takeDamage(finalDamage, "dash", attackerId, isCrit);
      }
    });

    // Spawn ice blast VFX
    this.spawnIceBlastVfx(x, y, radius, skillLevel, faction);
  }

  /** Ice blast for enemy cast (damages players). */
  private doIceBlastEnemy(
    x: number,
    y: number,
    skillLevel: number,
    critRate: number,
    critDamage: number,
  ): void {
    const damage = dashIceBlastDamage(skillLevel);
    const radius = dashIceBlastRadius(skillLevel);
    if (damage <= 0 || radius <= 0) return;

    this.state.players.forEach((p) => {
      if (p.isDead) return;
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist <= radius) {
        const { damage: finalDamage, isCrit } = applyCrit(damage, critRate, critDamage);
        p.takeDamage(finalDamage, "dash", undefined, isCrit);
      }
    });

    this.spawnIceBlastVfx(x, y, radius, skillLevel, "enemy");
  }

  // ============================================================
  // VFX SPAWNING
  // ============================================================

  /** Spawn a dash trail VFX SkillCast (from start to end position). */
  private spawnDashVfx(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    level: number,
    angle: number,
    faction: string,
  ): void {
    const cast = new SkillCast();
    cast.skillId = "dash";
    cast.x = endX;
    cast.y = endY;
    cast.faction = faction;
    cast.level = level;
    cast.tier = level >= 6 ? "big" : "small";
    cast.angle = angle;
    cast.range = Math.hypot(endX - startX, endY - startY);
    // Store start position in the cast for the trail rendering
    (cast as any).startX = startX;
    (cast as any).startY = startY;

    const id = `dash_${this.nextId++}_${Date.now()}`;
    this.state.skillCasts.set(id, cast);
    setTimeout(() => {
      this.state.skillCasts.delete(id);
    }, 500);
  }

  /** Spawn an ice blast VFX SkillCast at the landing position. */
  private spawnIceBlastVfx(
    x: number,
    y: number,
    radius: number,
    level: number,
    faction: string,
  ): void {
    const cast = new SkillCast();
    cast.skillId = "dash_ice";
    cast.x = x;
    cast.y = y;
    cast.faction = faction;
    cast.level = level;
    cast.tier = level >= 6 ? "big" : "small";
    cast.angle = 0;
    cast.range = radius;

    const id = `dash_ice_${this.nextId++}_${Date.now()}`;
    this.state.skillCasts.set(id, cast);
    setTimeout(() => {
      this.state.skillCasts.delete(id);
    }, 600);
  }
}
