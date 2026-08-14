/**
 * Vortex System
 * =============
 * Implements the vortex skill: a zone centred on the caster that pulls
 * entities toward its centre.
 *
 * Phases:
 *   1. "pull" — all enemies/players in radius are dragged toward the centre.
 *               Collision stops them (they get stuck in walls).
 *   2. "explode" — (L5+) AoE damage to all entities near the centre, then
 *               the vortex lingers briefly so the client can show the blast.
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { Vortex, type VortexFaction } from "../schema/Vortex";
import {
  VORTEX_DEF,
  vortexRadius,
  vortexPullForce,
  vortexHasExplosion,
  vortexExplosionDamage,
  vortexExplosionRadius,
  vortexColorTier,
  applyCrit,
} from "../config/skillDefs";
import type { CollisionResolver } from "./EnemySystem";

/** How long the explode phase lingers for client VFX (seconds). */
const EXPLODE_HOLD = 0.5;

export class VortexSystem {
  private nextId = 1;

  constructor(
    private state: RoomState,
    private mapSystem: CollisionResolver,
  ) {}

  /** Advance all active vortexes. */
  update(dt: number): void {
    const toRemove: string[] = [];

    this.state.vortexes.forEach((vortex, id) => {
      if (vortex.phase === "pull") {
        this.updatePull(vortex, dt);
      }

      if (vortex.phase === "explode") {
        vortex.explodeTimer -= dt;
        if (vortex.explodeTimer <= 0) {
          toRemove.push(id);
        }
      }
    });

    for (const id of toRemove) this.state.vortexes.delete(id);
  }

  // ============================================================
  // PHASE UPDATES
  // ============================================================

  /** Pull phase: drag all entities in radius toward the centre. */
  private updatePull(vortex: Vortex, dt: number): void {
    vortex.pullTimer -= dt;

    const radius = vortex.radius;
    const forceStep = vortex.pullForce * dt;
    const cx = vortex.x;
    const cy = vortex.y;

    if (vortex.faction === "player") {
      // Pull enemies + other players
      this.state.enemies.forEach((enemy, eid) => {
        if (enemy.isDead) return;
        this.pullEntity(enemy, eid, cx, cy, radius, forceStep, vortex, "enemy");
      });
      this.state.players.forEach((player, pid) => {
        if (pid === vortex.ownerId || player.isDead) return;
        this.pullEntity(player, pid, cx, cy, radius, forceStep, vortex, "player");
      });
    } else {
      // Enemy vortex: pulls players + other enemies
      this.state.players.forEach((player, pid) => {
        if (pid === vortex.ownerId || player.isDead) return;
        this.pullEntity(player, pid, cx, cy, radius, forceStep, vortex, "player");
      });
      this.state.enemies.forEach((enemy, eid) => {
        if (eid === vortex.ownerId || enemy.isDead) return;
        this.pullEntity(enemy, eid, cx, cy, radius, forceStep, vortex, "enemy");
      });
    }

    if (vortex.pullTimer <= 0) {
      // Transition: enter explode phase (damage now if unlocked).
      vortex.phase = "explode";
      vortex.explodeTimer = EXPLODE_HOLD;
      if (vortex.hasExplosion) {
        this.doExplosion(vortex);
      }
    }
  }

  /**
   * Pull a single entity toward the vortex centre.
   * Uses collision resolution so entities get stuck against walls.
   */
  private pullEntity(
    entity: Player | Enemy,
    entityId: string,
    cx: number,
    cy: number,
    radius: number,
    forceStep: number,
    vortex: Vortex,
    type: "player" | "enemy",
  ): void {
    const dx = cx - entity.x;
    const dy = cy - entity.y;
    const dist = Math.hypot(dx, dy);
    if (dist > radius || dist < 1) {
      if (dist <= radius) vortex.pulledEntities.add(entityId);
      return;
    }

    vortex.pulledEntities.add(entityId);

    // Normalised direction toward centre
    const nx = dx / dist;
    const ny = dy / dist;

    // Move toward centre
    entity.x += nx * forceStep;
    entity.y += ny * forceStep;

    // Clamp to map bounds
    entity.x = Math.max(0, Math.min(this.mapSystem.width, entity.x));
    entity.y = Math.max(0, Math.min(this.mapSystem.height, entity.y));

    // Resolve collision — entity gets stuck if blocked by a wall
    const collisionRadius = type === "player" ? 10 : (entity as Enemy).collisionRadius;
    const resolved = this.mapSystem.resolveTileCollision(
      entity.x,
      entity.y,
      collisionRadius,
    );
    entity.x = resolved.x;
    entity.y = resolved.y;
  }

  /** Explosion: deal AoE damage to all entities near the centre. */
  private doExplosion(vortex: Vortex): void {
    if (vortex.explosionDamage <= 0 || vortex.explosionRadius <= 0) return;

    const radius = vortex.explosionRadius;
    const cx = vortex.x;
    const cy = vortex.y;

    if (vortex.faction === "player") {
      this.state.enemies.forEach((enemy) => {
        if (enemy.isDead) return;
        const dist = Math.hypot(enemy.x - cx, enemy.y - cy);
        if (dist <= radius) {
          const c = applyCrit(vortex.explosionDamage, vortex.critRate, vortex.critDamage);
          enemy.takeDamage(c.damage, "vortex", vortex.ownerId, c.isCrit);
        }
      });
      this.state.players.forEach((player, pid) => {
        if (pid === vortex.ownerId || player.isDead) return;
        const dist = Math.hypot(player.x - cx, player.y - cy);
        if (dist <= radius) {
          const c = applyCrit(vortex.explosionDamage, vortex.critRate, vortex.critDamage);
          player.takeDamage(c.damage, "vortex", undefined, c.isCrit);
        }
      });
    } else {
      this.state.players.forEach((player) => {
        if (player.isDead) return;
        const dist = Math.hypot(player.x - cx, player.y - cy);
        if (dist <= radius) {
          const c = applyCrit(vortex.explosionDamage, vortex.critRate, vortex.critDamage);
          player.takeDamage(c.damage, "vortex", undefined, c.isCrit);
        }
      });
      this.state.enemies.forEach((enemy, eid) => {
        if (eid === vortex.ownerId || enemy.isDead) return;
        const dist = Math.hypot(enemy.x - cx, enemy.y - cy);
        if (dist <= radius) {
          const c = applyCrit(vortex.explosionDamage, vortex.critRate, vortex.critDamage);
          enemy.takeDamage(c.damage, "vortex", vortex.ownerId, c.isCrit);
        }
      });
    }
  }

  // ============================================================
  // CASTING
  // ============================================================

  castVortex(
    ownerId: string,
    faction: VortexFaction,
    x: number,
    y: number,
    _angle: number,
    skillLevel: number,
    _casterAttack: number = 100,
    _casterDamageMultiplier: number = 1.0,
    critRate: number = 0,
    critDamage: number = 1.5,
  ): boolean {
    const radius = vortexRadius(skillLevel);
    const pullForce = vortexPullForce(skillLevel);
    const hasExplosion = vortexHasExplosion(skillLevel);
    const explosionDmg = vortexExplosionDamage(skillLevel);
    const explosionRad = vortexExplosionRadius(skillLevel);
    const tier = vortexColorTier(skillLevel);

    const vortex = new Vortex();
    vortex.skillId = "vortex";
    vortex.level = skillLevel;
    vortex.faction = faction;
    vortex.ownerId = ownerId;
    vortex.radius = radius;
    vortex.pullForce = pullForce;
    vortex.pullTimer = VORTEX_DEF.pullDuration;
    vortex.colorTier = tier;
    vortex.critRate = critRate;
    vortex.critDamage = critDamage;
    vortex.hasExplosion = hasExplosion;
    vortex.explosionDamage = explosionDmg;
    vortex.explosionRadius = explosionRad;

    // Always activates instantly at the caster's position
    vortex.phase = "pull";
    vortex.x = x;
    vortex.y = y;

    const id = `vortex_${this.nextId++}_${Date.now()}`;
    this.state.vortexes.set(id, vortex);
    return true;
  }
}
