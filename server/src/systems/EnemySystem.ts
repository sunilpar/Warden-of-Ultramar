/**
 * Enemy System
 * ============
 * Drives enemy AI each tick: targeting, movement, and skill use.
 *
 * SKILL USE
 *   Each tick: roll a random chance; on success pick a random skill from the
 *   enemy's pool. If it is on cooldown, the roll is wasted. If ready, the
 *   skill fires via the ProjectileSystem (for projectile skills like bolter)
 *   and starts its cooldown. Skills are SHARED with the player.
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { GAME_CONFIG } from "../config/game";
import {
  ENEMY_STATS,
  type EnemyTypeId,
  type SkillId,
} from "../config/enemyStats";
import { SKILL_DEFS } from "../config/skillDefs";
import type { ProjectileSystem } from "./ProjectileSystem";
import type { ClawSystem } from "./ClawSystem";
import { SlamSystem } from "./SlamSystem";
import type { HealSystem } from "./HealSystem";

/** Collision resolver signature (shared by MapSystem / MapSystem2). */
export interface CollisionResolver {
  resolveTileCollision(
    x: number,
    y: number,
    radius: number,
  ): { x: number; y: number };
  readonly width: number;
  readonly height: number;
}

export class EnemySystem {
  private projectileSystem: ProjectileSystem | null = null;
  private clawSystem: ClawSystem | null = null;
  private slamSystem: SlamSystem | null = null;
  private healSystem: HealSystem | null = null;

  /** Pending slam casts (delayed until after attack animation). */
  private pendingSlams: {
    ownerId: string;
    x: number;
    y: number;
    angle: number;
    level: number;
    castAt: number;
    attack: number;
    damageMultiplier: number;
    critRate: number;
    critDamage: number;
  }[] = [];

  constructor(
    private state: RoomState,
    private mapSystem: CollisionResolver,
  ) {}

  /** Inject the ProjectileSystem (called by the room after both are created). */
  setProjectileSystem(ps: ProjectileSystem): void {
    this.projectileSystem = ps;
  }

  /** Inject the ClawSystem (called by the room after both are created). */
  setClawSystem(cs: ClawSystem): void {
    this.clawSystem = cs;
  }

  /** Inject the SlamSystem (called by the room after both are created). */
  setSlamSystem(ss: SlamSystem): void {
    this.slamSystem = ss;
  }

  /** Inject the HealSystem (called by the room after both are created). */
  setHealSystem(hs: HealSystem): void {
    this.healSystem = hs;
  }

  update(dt: number): void {
    // Process pending slam casts (delayed after attack animation).
    const now = Date.now();
    const ready = this.pendingSlams.filter((s) => s.castAt <= now);
    this.pendingSlams = this.pendingSlams.filter((s) => s.castAt > now);
    for (const s of ready) {
      if (this.slamSystem) {
        this.slamSystem.castSlam(
          s.ownerId,
          "enemy",
          s.x,
          s.y,
          s.angle,
          s.level,
          s.attack,
          s.damageMultiplier,
          s.critRate,
          s.critDamage,
        );
      }
    }

    this.state.enemies.forEach((enemy) => {
      enemy.tickCooldowns(dt);
      enemy.tickBleed(dt);
      switch (enemy.typeId) {
        case "tyranid":
          this.updateTyranid(enemy, dt);
          break;
        case "orck":
          this.updateOrck(enemy, dt);
          break;
        default:
          break;
      }
    });
  }

  // ============================================================
  // TYRANID
  // ============================================================

  /** Tyranid: find nearest player, move toward them, try skills.
   *  Stops ATTACK_RANGE_PX before the target and plays the attack animation. */
  private updateTyranid(enemy: Enemy, _dt: number): void {
    const now = Date.now();
    const isPaused = false; // hit-stun removed

    const target = this.findNearestPlayer(enemy);
    if (!target) {
      enemy.attacking = false;
      return;
    }

    enemy.facingRight = target.x > enemy.x;

    if (isPaused) {
      // Hit-stun: don't move or attack while paused.
      enemy.attacking = false;
      return;
    }

    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Use BASE claw range (lvl 1: 60px) as the effective attack range.
    const BASE_CLAW_RANGE = 60;
    const EFFECTIVE_RANGE = BASE_CLAW_RANGE;
    // Attack animation flag: only true if attackingUntil > now (reuse 'now' from above)
    enemy.attacking = now < enemy.attackingUntil;

    if (dist <= EFFECTIVE_RANGE) {
      // In range: stop moving, attempt to use skill.
      this.tryUseSkill(enemy, target);
    } else {
      // Out of range: move toward target, don't attempt skills.
      this.moveToward(enemy, target.x, target.y, _dt);
    }
  }

  // ============================================================
  // ORCK
  // ============================================================

  /** Orck: same melee chase AI as the tyranid. Finds the nearest player,
   *  moves toward them, and plays the attack animation when in range.
   *  Orcks have an empty skill pool so tryUseSkill is a no-op. */
  private updateOrck(enemy: Enemy, _dt: number): void {
    const now = Date.now();
    const isPaused = false; // hit-stun removed

    const target = this.findNearestPlayer(enemy);
    if (!target) {
      enemy.attacking = false;
      return;
    }

    enemy.facingRight = target.x > enemy.x;

    if (isPaused) {
      enemy.attacking = false;
      return;
    }

    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ATTACK_RANGE = 100;
    enemy.attacking = now < enemy.attackingUntil;

    if (dist <= ATTACK_RANGE) {
      this.tryUseSkill(enemy, target);
    } else {
      this.moveToward(enemy, target.x, target.y, _dt);
    }
  }

  // ============================================================
  // SHARED AI HELPERS
  // ============================================================

  /** Find the nearest alive player to this enemy. Returns null if none. */
  private findNearestPlayer(enemy: Enemy): Player | null {
    let nearest: Player | null = null;
    let nearestDistSq = Infinity;
    this.state.players.forEach((player) => {
      if (player.isDead) return;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = player;
      }
    });
    return nearest;
  }

  /**
   * Move an enemy toward a target point. Same normalized-direction *
   * effectiveSpeed * dt formula as the player, so base speed 60 == 1px/tick
   * and percentage buffs (speedMultiplier) apply via recalcDerivedStats.
   */
  private moveToward(
    enemy: Enemy,
    targetX: number,
    targetY: number,
    dt: number,
  ): void {
    let dx = targetX - enemy.x;
    let dy = targetY - enemy.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0.0001) {
      dx /= length;
      dy /= length;
    }
    enemy.recalcDerivedStats();
    const speed = enemy.moveSpeed;
    enemy.x += dx * speed * dt;
    enemy.y += dy * speed * dt;
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

  /**
   * Attempt to use a skill this tick. Random roll; on success pick a random
   * skill from the pool. If on cooldown, the roll is wasted. If ready, fire.
   */
  private tryUseSkill(enemy: Enemy, target: Player): void {
    const chance = GAME_CONFIG.ENEMY.SKILL_ATTEMPT_CHANCE;
    if (Math.random() > chance) return;
    if (enemy.skillPool.length === 0) return;
    const skill: SkillId =
      enemy.skillPool[Math.floor(Math.random() * enemy.skillPool.length)];
    if (!enemy.isSkillReady(skill)) return;
    this.useSkill(enemy, skill, target);
  }

  /**
   * Execute a skill for an enemy, aimed at the target. Dispatches to the
   * ProjectileSystem for projectile skills. Shared with the player.
   */
  private useSkill(enemy: Enemy, skill: SkillId, target: Player): void {
    const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    // Trigger attack animation EVERY time a skill is used.
    // Keep the flag true for 350ms (one full attack animation cycle).
    const now = Date.now();
    const atkDur = enemy.typeId === "orck" ? 500 : 350;
    enemy.attackingUntil = now + atkDur;
    enemy.attacking = true;
    if (skill === "bolter" && this.projectileSystem) {
      this.projectileSystem.castBolter(
        this.enemyOwnerId(enemy),
        "enemy",
        enemy.x,
        enemy.y,
        angle,
        enemy.attack,
        this.enemySkillLevel(enemy, skill),
        enemy.damageMultiplier,
        enemy.critRate,
        enemy.critDamage,
      );
    } else if (skill === "claw" && this.clawSystem) {
      this.clawSystem.castClaw(
        this.enemyOwnerId(enemy),
        "enemy",
        enemy.x,
        enemy.y,
        angle,
        enemy.attack,
        this.enemySkillLevel(enemy, skill),
        enemy.damageMultiplier,
        enemy.collisionRadius,
        enemy.critRate,
        enemy.critDamage,
      );
    } else if (skill === "slam" && this.slamSystem) {
      // Delay the slam hitbox until after the attack animation completes.
      // Orck attack anim = 5 frames @ 10fps = 500ms; add small extra delay.
      this.pendingSlams.push({
        ownerId: this.enemyOwnerId(enemy),
        x: enemy.x,
        y: enemy.y,
        angle,
        level: this.enemySkillLevel(enemy, skill),
        castAt: now + 500,
        attack: enemy.attack,
        damageMultiplier: enemy.damageMultiplier,
        critRate: enemy.critRate,
        critDamage: enemy.critDamage,
      });
    } else if (skill === "heal" && this.healSystem) {
      this.healSystem.castEnemyHeal(enemy, this.enemySkillLevel(enemy, skill));
    }
    enemy.startCooldown(skill);
  }

  /** Derive a stable owner id for an enemy. */
  private enemyOwnerId(enemy: Enemy): string {
    return (enemy as any).__id ?? `enemy_${enemy.typeId}`;
  }

  /** Enemy skill level (defaults to 1; real leveling wired later). */
  private enemySkillLevel(_enemy: Enemy, _skill: SkillId): number {
    return 1;
  }

  /** Cooldown lookup for a skill (kept for parity). */
  private skillCooldown(skill: SkillId): number {
    const def = (SKILL_DEFS as Record<string, { cooldown: number }>)[skill];
    return def ? def.cooldown : (ENEMY_STATS.tyranid.skillCooldown[skill] ?? 0);
  }

  // ============================================================
  // SPAWNING
  // ============================================================

  /** Spawn one enemy of the given type at a position and level. */
  spawn(typeId: EnemyTypeId, x: number, y: number, level: number): string {
    const enemy = new Enemy();
    enemy.init(typeId, level);
    enemy.x = x;
    enemy.y = y;
    const id = `enemy_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    (enemy as any).__id = id;
    this.state.enemies.set(id, enemy);
    return id;
  }

  /** Remove a dead enemy by id. */
  remove(id: string): void {
    this.state.enemies.delete(id);
  }

  /**
   * Clean up all skill entities (slams, pending casts) owned by a
   * dead enemy so they despawn immediately when the caster dies.
   */
  cleanupOnEnemyDeath(ownerId: string): void {
    // Cancel any pending slam casts that haven't fired yet.
    this.pendingSlams = this.pendingSlams.filter((s) => s.ownerId !== ownerId);
    // Remove in-flight slams owned by this enemy.
    const slamIds: string[] = [];
    this.state.slams.forEach((slam, sid) => {
      if (slam.ownerId === ownerId) slamIds.push(sid);
    });
    for (const sid of slamIds) this.state.slams.delete(sid);
    // Remove in-flight projectiles owned by this enemy.
    const projIds: string[] = [];
    this.state.projectiles.forEach((proj, pid) => {
      if (proj.ownerId === ownerId) projIds.push(pid);
    });
    for (const pid of projIds) this.state.projectiles.delete(pid);
  }
}
