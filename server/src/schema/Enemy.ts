/**
 * Enemy Schema
 * ============
 * The synced state for a single enemy.
 *
 * Stat model mirrors the player (see Player.ts):
 *   1. BASE stats      — level-grown values (maxHealth, baseMoveSpeed, attack)
 *   2. MULTIPLIERS     — transient (speedMultiplier, damageMultiplier,
 *                        incomingDamageMultiplier). Default 1.0.
 *   3. EFFECTIVE stats — computed = base * multiplier (moveSpeed is synced so
 *                        the client can interpolate/render).
 *
 * Level determines base damage, move speed, hp, skill cooldowns, etc. Skills
 * are drawn from a shared pool (same SkillId space as the player) and gated
 * by per-skill cooldowns tracked server-side.
 */
import { Schema, type } from "@colyseus/schema";
import { type SkillId, getSkillHitFeedback } from "../config/skillDefs";
import { ENEMY_STATS, type EnemyTypeId } from "../config/enemyStats";

export class Enemy extends Schema {
  // ---- Identity (synced) ----
  /** Enemy type id (e.g. "tyranid"). Client uses this to pick the sprite. */
  @type("string") typeId: EnemyTypeId = "tyranid";
  /** Display title. */
  @type("string") title: string = "";
  /** Description. */
  @type("string") description: string = "";

  // ---- Position (synced) ----
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") tick: number = 0;

  // ---- Level (synced) — drives damage, move speed, hp, skill cooldowns ----
  @type("number") level: number = 1;

  // ---- Health (synced) ----
  @type("number") maxHealth: number = 0;
  @type("number") currentHealth: number = 0;

  // ---- Shield (synced) — absorbs damage before health. 0 for now. ----
  @type("number") shield: number = 0;

  // ---- Movement (synced) — effective speed (base * speedMultiplier) ----
  @type("number") moveSpeed: number = 0;

  // ---- Combat (synced) ----
  @type("number") attack: number = 0;
  /** Defence, fraction 0..1 (0.1 = take 10% less damage). Ignored on crits. */
  @type("number") defence: number = 0;
  /** Crit chance, fraction 0..1 (0.2 = 20%). */
  @type("number") critRate: number = 0;
  /** Crit damage multiplier (1.5 = 150% of base damage). */
  @type("number") critDamage: number = 1.5;
  /** XP awarded when this enemy is killed. */
  @type("number") xpReward: number = 0;

  // ---- Facing (synced) — true = facing right, false = facing left.
  //      The tyranid sprite faces LEFT by default; the client flips when
  //      this is true. Synced so all clients render the same facing. ----
  @type("boolean") facingRight: boolean = false;

  // ---- Visual state (synced) ----
  /** Server timestamp (ms) until which the enemy flashes white (recent hit). */
  @type("number") hitFlashUntil: number = 0;
  /** Last damage taken (for floating damage numbers on client). */
  @type("number") lastHitDamage: number = 0;
  /** Whether the last hit was a critical hit. */
  @type("boolean") lastHitCrit: boolean = false;
  /** Monotonic counter — increments every time damage is taken (so client can detect new hits). */
  @type("number") hitSeq: number = 0;
  /** True while the enemy is playing its attack animation. */
  @type("boolean") attacking: boolean = false;
  /** Server timestamp (ms) until which the attack animation is considered active. */
  @type("number") attackingUntil: number = 0;

  /** Server timestamp (ms) until which the enemy is bleeding (DoT). */
  @type("number") bleedUntil: number = 0;

  // ---- Base stats (NOT synced — server-authoritative source of truth) ----
  baseMoveSpeed: number = 0;

  // ---- Debuff / buff multipliers (NOT synced; server-only) ----
  speedMultiplier: number = 1.0;
  damageMultiplier: number = 1.0;
  incomingDamageMultiplier: number = 1.0;

  // ---- AI / skill state (NOT synced; server-only) ----
  /** Collision radius (used by tile resolution). */
  collisionRadius: number = 9;
  /** Skills this enemy may cast (copied from config). */
  skillPool: SkillId[] = [];
  /**
   * Remaining cooldown in SECONDS for each skill. When <= 0 the skill is
   * ready. Set back to the skill's cooldown after it is used.
   */
  skillCooldownsRemaining: Map<SkillId, number> = new Map();

  /** Server timestamp (ms) until which the enemy is paused (hit-stun). */
  pausedUntil: number = 0;
  /** Server timestamp (ms) until which the enemy can attack again. */
  attackCooldownUntil: number = 0;
  /** Bleed damage per second (server-only; applied while bleedUntil > now). */
  bleedDps: number = 0;
  /** Attacker who applied the bleed (for XP credit on kill). */
  bleedAttackerId: string = "";
  /** Accumulator for 0.5-second bleed ticks. */
  bleedTickAccum: number = 0;

  /** Tracks total damage dealt by each player (sessionId -> damage). */
  damageTrackers: Map<string, number> = new Map();
  // ============================================================
  // LIFECYCLE
  // ============================================================

  /**
   * Initialize this enemy from its type config at the given level.
   * Applies level-based growth to base stats.
   */
  init(typeId: EnemyTypeId, level: number): void {
    const cfg = ENEMY_STATS[typeId];
    if (!cfg) throw new Error(`Unknown enemy type: ${typeId}`);

    this.typeId = typeId;
    this.title = cfg.title;
    this.description = cfg.description;
    this.level = level;

    // Base stats grown by level (level 1 = base; each extra level adds growth)
    const extraLevels = Math.max(0, level - 1);
    this.maxHealth = cfg.maxHealth + cfg.growth.maxHealth * extraLevels;
    this.currentHealth = this.maxHealth;
    this.baseMoveSpeed = cfg.moveSpeed + cfg.growth.moveSpeed * extraLevels;
    this.attack = cfg.attack + cfg.growth.attack * extraLevels;
    this.shield = cfg.shield;
    this.defence = cfg.defence ?? 0;
    this.critRate = cfg.critRate ?? 0;
    this.critDamage = cfg.critDamage ?? 1.5;
    this.xpReward = cfg.xpReward;
    this.collisionRadius = cfg.collisionRadius;

    // Skill pool + reset cooldowns (ready immediately)
    this.skillPool = [...cfg.skillPool];
    this.skillCooldownsRemaining = new Map();
    for (const skill of this.skillPool) {
      this.skillCooldownsRemaining.set(skill, 0);
    }

    // Reset transient multipliers
    this.speedMultiplier = 1.0;
    this.damageMultiplier = 1.0;
    this.incomingDamageMultiplier = 1.0;

    // Reset visual / AI state
    this.hitFlashUntil = 0;
    this.attacking = false;
    this.attackingUntil = 0;
    this.pausedUntil = 0;
    this.attackCooldownUntil = 0;
    this.bleedUntil = 0;
    this.bleedDps = 0;
    this.damageTrackers.clear();

    this.recalcDerivedStats();
  }

  // ============================================================
  // DERIVED-STAT RECOMPUTE
  // ============================================================

  /**
   * Recompute effective stats from base + multipliers. Call whenever a base
   * stat or multiplier changes. moveSpeed is synced; attack currently has no
   * multiplier but the hook is here for symmetry with the player.
   */
  recalcDerivedStats(): void {
    this.moveSpeed = this.baseMoveSpeed * this.speedMultiplier;
  }

  // ============================================================
  // HEALTH / SHIELD
  // ============================================================

  /**
   * Apply damage to the enemy. Shield absorbs first, then health.
   * Respects incomingDamageMultiplier. Returns actual damage applied
   * (shield + health).
   */
  takeDamage(
    rawDamage: number,
    sourceSkillId?: SkillId,
    attackerId?: string,
    isCrit: boolean = false,
  ): number {
    // Defence reduces incoming damage, but is ignored on critical hits.
    const mitigated = isCrit ? rawDamage : rawDamage * (1.0 - this.defence);
    let dmg = mitigated * this.incomingDamageMultiplier;
    // Shield absorbs first
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
    }
    this.currentHealth = Math.max(0, this.currentHealth - dmg);

    // Track damage contribution for XP rewards.
    if (attackerId) {
      this.damageTrackers.set(
        attackerId,
        (this.damageTrackers.get(attackerId) ?? 0) + dmg,
      );
    }

    // Hit feedback: white flash + brief hit-stun pause.
    // Duration scales with skill power (e.g. slam > claw > bolter).
    const fbMs = sourceSkillId ? getSkillHitFeedback(sourceSkillId) : 120;
    const now = Date.now();
    this.hitFlashUntil = Math.max(this.hitFlashUntil, now + fbMs);
    this.pausedUntil = Math.max(this.pausedUntil, now + fbMs);

    // Record last hit for client-side damage numbers.
    this.lastHitDamage = Math.round(dmg);
    this.lastHitCrit = isCrit;
    this.hitSeq += 1;
    return mitigated * this.incomingDamageMultiplier;
  }

  /** Heal the enemy (clamped to maxHealth). Returns amount healed. */
  heal(amount: number): number {
    const before = this.currentHealth;
    this.currentHealth = Math.min(this.maxHealth, before + amount);
    return this.currentHealth - before;
  }

  get isDead(): boolean {
    return this.currentHealth <= 0;
  }

  // ============================================================
  // SKILL COOLDOWNS
  // ============================================================

  /**
   * Advance bleed DoT: apply bleedDps * dt damage while active.
   * Returns true if the enemy died from bleed this tick.
   */
  tickBleed(dt: number): boolean {
    if (this.bleedUntil <= 0) {
      this.bleedTickAccum = 0;
      return false;
    }
    const now = Date.now();
    if (now >= this.bleedUntil) {
      this.bleedUntil = 0;
      this.bleedDps = 0;
      this.bleedTickAccum = 0;
      return false;
    }
    // Tick bleed damage twice per second (every 0.5s)
    this.bleedTickAccum += dt;
    if (this.bleedTickAccum >= 0.5) {
      this.bleedTickAccum -= 0.5;
      this.takeDamage(this.bleedDps, "claw", this.bleedAttackerId);
      return this.isDead;
    }
    return false;
  }

  /** Inflict bleed: set dps + extend/until timestamp. */
  applyBleed(dps: number, durationSec: number, attackerId?: string): void {
    this.bleedDps = dps;
    this.bleedUntil = Date.now() + durationSec * 1000;
    this.bleedTickAccum = 0;
    if (attackerId) this.bleedAttackerId = attackerId;
  }

  /** Advance all skill cooldowns by `dt` seconds (clamped at 0). */
  tickCooldowns(dt: number): void {
    for (const [skill, cd] of this.skillCooldownsRemaining) {
      this.skillCooldownsRemaining.set(skill, Math.max(0, cd - dt));
    }
  }

  /** True if the given skill is off cooldown. */
  isSkillReady(skill: SkillId): boolean {
    return (this.skillCooldownsRemaining.get(skill) ?? 0) <= 0;
  }

  /** Put a skill on cooldown based on its configured cooldown duration. */
  startCooldown(skill: SkillId): void {
    const cfg = ENEMY_STATS[this.typeId];
    const cd = cfg.skillCooldown[skill] ?? 0;
    this.skillCooldownsRemaining.set(skill, cd);
  }
}
