/**
 * Player Schema
 * =============
 * The synced state for a single player.
 *
 * STAT MODEL
 * ----------
 * Stats are split into three layers so debuffs/buffs can be applied
 * cleanly without losing the player's "true" progression values:
 *
 *   1. BASE stats      — the permanent, level-grown values
 *                        (maxHealth, baseMoveSpeed, attack, critRate, ...).
 *   2. MULTIPLIERS     — transient modifiers from buffs/debuffs
 *                        (speedMultiplier, damageMultiplier, ...).
 *                        Default to 1.0 (no change). A 40% slow debuff
 *                        sets speedMultiplier = 0.6 for its duration.
 *   3. EFFECTIVE stats — computed = base * multiplier; what the simulation
 *                        and combat actually use
 *                        (moveSpeed is synced so the client can predict).
 *
 * Only the fields marked @type are sent to clients; inputQueue is local.
 */
import { Schema, type, MapSchema } from "@colyseus/schema";
import { PLAYER_STATS } from "../config/playerStats";
import { type SkillId, getSkillHitFeedback } from "../config/skillDefs";

export interface InputData {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  tick?: number;
}

export class Player extends Schema {
  // ---- Position (synced) ----
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") tick: number = 0;

  // ---- Health (synced) ----
  @type("number") maxHealth: number = PLAYER_STATS.BASE.MAX_HEALTH;
  @type("number") currentHealth: number = PLAYER_STATS.BASE.MAX_HEALTH;

  // ---- Movement (synced) ----
  /** Effective move speed in px/sec (already includes multipliers). */
  @type("number") moveSpeed: number = PLAYER_STATS.BASE.MOVE_SPEED;

  // ---- Combat (synced) ----
  @type("number") attack: number = PLAYER_STATS.BASE.ATTACK;
  /** Crit chance, fraction 0..1 (0.1 = 10%). */
  @type("number") critRate: number = PLAYER_STATS.BASE.CRIT_RATE;
  /** Crit damage multiplier (1.5 = 150% of base damage). */
  @type("number") critDamage: number = PLAYER_STATS.BASE.CRIT_DAMAGE;

  // ---- Progression (synced) ----
  @type("number") level: number = 1;
  @type("number") currentXp: number = 0;
  @type("number") xpToLevelUp: number = PLAYER_STATS.LEVELING.LEVEL_1_XP;

  // ---- Base stats (NOT synced — server-authoritative source of truth) ----
  /** Permanent base move speed before debuffs/buffs. */
  baseMoveSpeed: number = PLAYER_STATS.BASE.MOVE_SPEED;

  // ---- Debuff / buff multipliers (NOT synced; server-only) ----
  /** Movement multiplier (1.0 = normal). A 40% slow = 0.6. */
  speedMultiplier: number = 1.0;
  /** Outgoing damage multiplier (1.0 = normal). */
  damageMultiplier: number = 1.0;
  /** Incoming damage multiplier (1.0 = normal). <1 = damage reduction. */
  incomingDamageMultiplier: number = 1.0;

  // ---- Input queue (local — never synced) ----
  inputQueue: InputData[] = [];

  // ---- Skill levels (synced) — per-skill level owned by this player.
  //      Drives damage, color tiers, chain count, card art tier. Keys are
  //      SkillId strings; values are the skill level (1..MAX_SKILL_LEVEL). ----
  @type({ map: "number" }) skillLevels = new MapSchema<number>();

  /** Server timestamp (ms) when the bolter comes off cooldown (for HUD fill). */
  @type("number") bolterCooldownEndsAt: number = 0;
  /** Server timestamp (ms) when slam comes off cooldown (for client HUD). */
  @type("number") slamCooldownEndsAt: number = 0;
  /** Server timestamp (ms) when claw comes off cooldown (for client HUD). */
  @type("number") clawCooldownEndsAt: number = 0;

  /** Server timestamp (ms) until which the player flashes white (hit feedback). */
  @type("number") hitFlashUntil: number = 0;
  /** Server timestamp (ms) until which the player is frozen (hit-stun). */
  pausedUntil: number = 0;

  /** Server timestamp (ms) until which the player is bleeding (DoT). */
  @type("number") bleedUntil: number = 0;

  // ---- Skill cooldowns (NOT synced; server-only) — remaining seconds
  //      before each skill can be cast again. ----
  skillCooldowns: Map<SkillId, number> = new Map();
  /** Bleed damage per second (server-only; applied while bleedUntil > now). */
  bleedDps: number = 0;

  // ============================================================
  // LIFECYCLE
  // ============================================================

  /** Re-sync the level-1 base stats onto this player. Call on spawn. */
  initBaseStats(): void {
    this.maxHealth = PLAYER_STATS.BASE.MAX_HEALTH;
    this.currentHealth = this.maxHealth;
    this.baseMoveSpeed = PLAYER_STATS.BASE.MOVE_SPEED;
    this.moveSpeed = this.baseMoveSpeed;
    this.attack = PLAYER_STATS.BASE.ATTACK;
    this.critRate = PLAYER_STATS.BASE.CRIT_RATE;
    this.critDamage = PLAYER_STATS.BASE.CRIT_DAMAGE;
    this.level = 1;
    this.currentXp = 0;
    this.xpToLevelUp = PLAYER_STATS.LEVELING.LEVEL_1_XP;
    // Reset transient multipliers
    this.speedMultiplier = 1.0;
    this.damageMultiplier = 1.0;
    this.incomingDamageMultiplier = 1.0;
  }

  // ============================================================
  // DERIVED-STAT RECOMPUTE
  // ============================================================

  /**
   * Recompute effective stats from base + multipliers.
   * Call this whenever a base stat or a multiplier changes
   * (e.g. applying/removing a debuff, leveling up).
   */
  recalcDerivedStats(): void {
    this.moveSpeed = this.baseMoveSpeed * this.speedMultiplier;
    // attack / critRate / critDamage currently have no multiplier in the
    // base design; if buffs/debuffs to those are added later, fold them
    // in here in the same pattern (e.g. attack * damageMultiplier).
  }

  // ============================================================
  // HEALTH
  // ============================================================

  /** Apply damage to the player (respects incomingDamageMultiplier).
   *  sourceSkillId controls the hit-feedback duration (flash + pause). */
  takeDamage(rawDamage: number, sourceSkillId?: SkillId): number {
    const dmg = rawDamage * this.incomingDamageMultiplier;
    this.currentHealth = Math.max(0, this.currentHealth - dmg);
    // Hit feedback: white flash + hit-stun, duration per skill.
    if (sourceSkillId) {
      const fbMs = getSkillHitFeedback(sourceSkillId);
      const now = Date.now();
      this.hitFlashUntil = Math.max(this.hitFlashUntil, now + fbMs);
      this.pausedUntil = Math.max(this.pausedUntil, now + fbMs);
    }
    return dmg;
  }

  /** Heal the player (clamped to maxHealth). Returns amount healed. */
  heal(amount: number): number {
    const before = this.currentHealth;
    this.currentHealth = Math.min(this.maxHealth, before + amount);
    return this.currentHealth - before;
  }

  get isDead(): boolean {
    return this.currentHealth <= 0;
  }

  // ============================================================
  // XP / LEVEL
  // ============================================================

  /**
   * Add XP, leveling up as many times as needed.
   * Applies per-level stat growth + level-up heal.
   * Returns the number of levels gained.
   */
  addXp(amount: number): number {
    this.currentXp += amount;
    let levelsGained = 0;
    while (this.currentXp >= this.xpToLevelUp) {
      this.currentXp -= this.xpToLevelUp;
      this.levelUp();
      levelsGained++;
    }
    return levelsGained;
  }

  /** Advance exactly one level: grow stats + bump the XP threshold. */
  private levelUp(): void {
    this.level += 1;
    const g = PLAYER_STATS.LEVELING.GROWTH;
    this.maxHealth += g.MAX_HEALTH;
    this.attack += g.ATTACK;
    this.critRate += g.CRIT_RATE;
    this.critDamage += g.CRIT_DAMAGE;
    this.baseMoveSpeed += g.MOVE_SPEED;
    // Recompute the XP required for the NEXT level
    this.xpToLevelUp = PLAYER_STATS.LEVELING.xpForNextLevel(this.level);
    // Heal on level up
    this.heal(this.maxHealth * PLAYER_STATS.LEVELING.HEAL_ON_LEVEL_UP);
    this.recalcDerivedStats();
  }

  // ============================================================
  // DEATH / RESPAWN
  // ============================================================

  /**
   * Mark the player as dead: halve current XP and set HP to 0.
   * Called by the game loop when currentHealth reaches 0.
   */
  die(): void {
    this.currentHealth = 0;
    // Death penalty: halve current XP.
    this.currentXp = Math.floor(this.currentXp / 2);
  }

  /**
   * Respawn: reset to full health, reset XP/level to base stats,
   * and reset all skills to their defaults.
   * Called when the player presses the Respawn button.
   */
  respawn(): void {
    this.initBaseStats();
    // Reset skills to level 1 defaults
    this.skillLevels.clear();
    this.skillLevels.set("bolter", 1);
    this.skillLevels.set("claw", 1);
    this.skillLevels.set("slam", 1);
    this.skillCooldowns.clear();
    // Clear bleed
    this.bleedUntil = 0;
    this.bleedDps = 0;
  }

  // ============================================================
  // SKILLS
  // ============================================================

  /** Get a skill's level (0 if not owned/learned). */
  getSkillLevel(skill: SkillId): number {
    return this.skillLevels.get(skill) ?? 0;
  }

  /** Set a skill's level (clamped to >=1). */
  setSkillLevel(skill: SkillId, level: number): void {
    this.skillLevels.set(skill, Math.max(1, Math.floor(level)));
  }

  /** Advance a skill's level by 1 (for the "0" upgrade key). */
  upgradeSkill(skill: SkillId): void {
    this.setSkillLevel(skill, this.getSkillLevel(skill) + 1);
  }

  /** Advance ALL owned skills by 1 (used by the debug upgrade key). */
  upgradeAllSkills(): void {
    this.skillLevels.forEach((_lvl, skill) => {
      this.skillLevels.set(skill as SkillId, (_lvl ?? 0) + 1);
    });
  }

  /** True if a skill is off cooldown. */
  isSkillReady(skill: SkillId): boolean {
    return (this.skillCooldowns.get(skill) ?? 0) <= 0;
  }

  /** Put a skill on cooldown (seconds). Also stamps the synced end-time
   *  for the bolter so the client HUD can render a fill animation. */
  startSkillCooldown(skill: SkillId, cooldown: number): void {
    this.skillCooldowns.set(skill, cooldown);
    const endsAt = Date.now() + cooldown * 1000;
    if (skill === "bolter") {
      this.bolterCooldownEndsAt = endsAt;
    } else if (skill === "slam") {
      this.slamCooldownEndsAt = endsAt;
    } else if (skill === "claw") {
      this.clawCooldownEndsAt = endsAt;
    }
  }

  /** Advance all skill cooldowns by dt seconds (clamped at 0). */
  tickSkillCooldowns(dt: number): void {
    for (const [skill, cd] of this.skillCooldowns) {
      this.skillCooldowns.set(skill, Math.max(0, cd - dt));
    }
  }

  /**
   * Advance bleed DoT: apply bleedDps * dt damage while active.
   * Returns true if the player died from bleed this tick.
   */
  tickBleed(dt: number): boolean {
    if (this.bleedUntil <= 0) return false;
    const now = Date.now();
    if (now >= this.bleedUntil) {
      this.bleedUntil = 0;
      this.bleedDps = 0;
      return false;
    }
    this.takeDamage(this.bleedDps * dt);
    return this.isDead;
  }

  /** Inflict bleed: set dps + until timestamp. */
  applyBleed(dps: number, durationSec: number): void {
    this.bleedDps = dps;
    this.bleedUntil = Date.now() + durationSec * 1000;
  }
}
