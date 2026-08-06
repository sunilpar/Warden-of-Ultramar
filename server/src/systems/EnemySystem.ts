/**
 * Enemy System
 * ============
 * Drives enemy AI each tick: targeting, movement, and skill use.
 *
 * DESIGN
 *   - update() iterates every enemy and dispatches to a per-type handler
 *     (e.g. updateTyranid). Add a new handler for each new enemy type.
 *   - Behaviour is split into reusable helpers so each enemy can compose it:
 *       findNearestPlayer()  — targeting (shared utility)
 *       moveToward()         — movement (shared utility)
 *       tryUseSkill()        — skill selection (shared utility)
 *   - Movement uses the SAME formula as the player (normalized direction *
 *     effective speed * dt) so the base speed of 60 px/sec == 1px/tick, and
 *     percentage buffs via speedMultiplier are handled identically.
 *   - Collisions are resolved against the map grid using a resolver fn
 *     passed in (works for both Map1 and Map2).
 *
 * SKILL USE
 *   Each tick: roll a random chance; on success pick a random skill from the
 *   enemy's pool. If it is on cooldown, the roll is wasted (re-rolled next
 *   tick). If ready, the skill is "used" (placeholder) and goes on cooldown.
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { GAME_CONFIG } from "../config/game";
import type { EnemyTypeId, SkillId } from "../config/enemyStats";

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
  constructor(
    private state: RoomState,
    private mapSystem: CollisionResolver,
  ) {}

  update(dt: number): void {
    this.state.enemies.forEach((enemy) => {
      // Tick down all skill cooldowns regardless of behaviour
      enemy.tickCooldowns(dt);

      switch (enemy.typeId) {
        case "tyranid":
          this.updateTyranid(enemy, dt);
          break;
        // Add new enemy types here with their own update handler.
        default:
          // Unknown type — stay still
          break;
      }
    });
  }

  // ============================================================
  // TYRANID
  // ============================================================

  /**
   * Tyranid behaviour: find the nearest player and move toward them.
   * Skills are not implemented yet (tryUseSkill is a no-op placeholder).
   */
  private updateTyranid(enemy: Enemy, _dt: number): void {
    const target = this.findNearestPlayer(enemy);
    if (!target) return;

    // Update facing (sprite faces LEFT by default)
    enemy.facingRight = target.x > enemy.x;

    this.moveToward(enemy, target.x, target.y, _dt);

    // Skills: attempt randomly each tick (logic wired up later)
    this.tryUseSkill(enemy);
  }

  // ============================================================
  // SHARED AI HELPERS
  // ============================================================

  /**
   * Find the nearest alive player to this enemy. Returns null if none.
   * This is a shared utility used by any enemy that targets players.
   */
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
   * Move an enemy toward a target point. Uses the same normalized-direction
   * * effectiveSpeed * dt formula as the player, so base speed 60 == 1px/tick
   * and percentage buffs (speedMultiplier) are applied via recalcDerivedStats.
   * Resolves tile collisions and clamps to map bounds.
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

    // Recompute effective speed each tick (so buffs/debuffs apply immediately)
    enemy.recalcDerivedStats();
    const speed = enemy.moveSpeed;

    enemy.x += dx * speed * dt;
    enemy.y += dy * speed * dt;

    // Clamp to map boundaries
    enemy.x = Math.max(0, Math.min(this.mapSystem.width, enemy.x));
    enemy.y = Math.max(0, Math.min(this.mapSystem.height, enemy.y));

    // Resolve tile collisions
    const resolved = this.mapSystem.resolveTileCollision(
      enemy.x,
      enemy.y,
      enemy.collisionRadius,
    );
    enemy.x = resolved.x;
    enemy.y = resolved.y;
  }

  /**
   * Attempt to use a skill this tick. Each tick rolls a random chance; on
   * success picks a RANDOM skill from the pool. If that skill is on cooldown,
   * the roll is wasted (the enemy does nothing this tick and will re-roll
   * next tick). If ready, the skill fires (placeholder) and starts cooldown.
   *
   * Skill EFFECTS (damage, projectiles, etc.) are NOT implemented yet — this
   * just consumes the cooldown cycle so the gating logic is in place.
   */
  private tryUseSkill(enemy: Enemy): void {
    const chance = GAME_CONFIG.ENEMY.SKILL_ATTEMPT_CHANCE;
    if (Math.random() > chance) return; // no attempt this tick

    if (enemy.skillPool.length === 0) return;

    const skill: SkillId =
      enemy.skillPool[Math.floor(Math.random() * enemy.skillPool.length)];

    if (!enemy.isSkillReady(skill)) {
      // On cooldown — roll wasted, re-roll next tick
      return;
    }

    // Skill is ready — fire it (placeholder) and start its cooldown.
    this.useSkill(enemy, skill);
  }

  /**
   * Actually execute a skill. Placeholder for now — real skill logic will be
   * wired up later per skill. Centralized here so each skill's effect can be
   * added in one place (and shared between enemies and the player).
   */
  private useSkill(enemy: Enemy, skill: SkillId): void {
    // TODO: implement per-skill effects (claw melee, bolter projectile, ...)
    void enemy;
    void skill;
    enemy.startCooldown(skill);
  }

  // ============================================================
  // SPAWNING
  // ============================================================

  /**
   * Spawn one enemy of the given type at a position and level.
   * Returns the created enemy's id (its key in the enemies map).
   */
  spawn(typeId: EnemyTypeId, x: number, y: number, level: number): string {
    const enemy = new Enemy();
    enemy.init(typeId, level);
    enemy.x = x;
    enemy.y = y;
    const id = `enemy_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    this.state.enemies.set(id, enemy);
    return id;
  }

  /** Remove a dead enemy by id. */
  remove(id: string): void {
    this.state.enemies.delete(id);
  }
}
