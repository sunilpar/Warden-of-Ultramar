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
 * SHIELD
 *   The shield is an equippable item (equipped by default). It absorbs
 *   damage before health. When broken (reaches 0) it begins recharging
 *   after a recovery delay. Shield amount grows with the shield SLOT level
 *   (SHIELD_LEVEL), not with a castable skill.
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

  // ---- Shield (synced) — absorbs damage before health ----
  /** Current shield value (drains as it absorbs damage, recharges after a delay). */
  @type("number") shield: number = 0;
  /** Maximum shield capacity (drives the HUD meter). Grows with shield slot level. */
  @type("number") maxShield: number = 0;
  /**
   * Shield recharge state for the client HUD:
   *   0  = active (shield > 0, absorbing)
   *   1  = broken / recharging (waiting out the recovery delay or refilling)
   * The client uses this to hide the low-shield vignette once the shield is
   * fully broken (shield === 0 and not yet recharging).
   */
  @type("number") shieldState: number = 0;

  // ---- Movement (synced) ----
  /** Effective move speed in px/sec (already includes multipliers). */
  @type("number") moveSpeed: number = PLAYER_STATS.BASE.MOVE_SPEED;

  // ---- Combat (synced) ----
  @type("number") attack: number = PLAYER_STATS.BASE.ATTACK;
  /** Crit chance, fraction 0..1 (0.1 = 10%). */
  @type("number") critRate: number = PLAYER_STATS.BASE.CRIT_RATE;
  /** Crit damage multiplier (1.5 = 150% of base damage). */
  @type("number") critDamage: number = PLAYER_STATS.BASE.CRIT_DAMAGE;
  /** Defence, fraction 0..1 (0.2 = take 20% less damage). Ignored on crits. */
  @type("number") defence: number = PLAYER_STATS.BASE.DEFENCE;

  // ---- Shock status (synced) ----
  /** Server timestamp (ms) until which the player is shocked (takes more damage, slowed). */
  @type("number") shockUntil: number = 0;

  // ---- Dash invincibility (synced) ----
  /** Server timestamp (ms) until which the player is invincible (dash i-frames). */
  @type("number") invincibleUntil: number = 0;

  // ---- Progression (synced) ----
  @type("number") level: number = 1;
  @type("number") currentXp: number = 0;
  @type("number") xpToLevelUp: number = PLAYER_STATS.LEVELING.LEVEL_1_XP;
  /** Unspent skill points (1 per level-up). Spend on stat or card upgrades. */
  @type("number") skillPoints: number = 0;

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
  /** Server timestamp (ms) when pulse comes off cooldown (for client HUD). */
  @type("number") pulseCooldownEndsAt: number = 0;
  /** Server timestamp (ms) when shock comes off cooldown (for client HUD). */
  @type("number") shockCooldownEndsAt: number = 0;
  /** Server timestamp (ms) when heal comes off cooldown (for client HUD, L5+). */
  @type("number") healCooldownEndsAt: number = 0;
  /** Server timestamp (ms) when dash comes off cooldown (for client HUD). */
  @type("number") dashCooldownEndsAt: number = 0;
  /** Server timestamp (ms) when vortex comes off cooldown (for client HUD). */
  @type("number") vortexCooldownEndsAt: number = 0;
  /** Kill count towards next heal charge (L1-4 mode). Resets to 0 at killsToRecharge. */
  @type("number") healKills: number = 0;
  /** True if heal is ready to cast (for client HUD display). */
  @type("boolean") healReady: boolean = true;

  /** Server timestamp (ms) until which the player flashes white (hit feedback). */
  @type("number") hitFlashUntil: number = 0;
  /** Last damage taken (for floating damage numbers on client). */
  @type("number") lastHitDamage: number = 0;
  /** Whether the last hit was a critical hit. */
  @type("boolean") lastHitCrit: boolean = false;
  /** True if the last hit taken was absorbed by shield (drives blue flash). */
  @type("boolean") lastHitShielded: boolean = false;
  /** Monotonic counter — increments every time damage is taken (so client can detect new hits). */
  @type("number") hitSeq: number = 0;
  /** Server timestamp (ms) until which the player is frozen (hit-stun). */
  pausedUntil: number = 0;
  /** Hitbox half-width (rectangle, synced for debug overlay). */
  @type("number") hitboxW: number = 9;
  /** Hitbox half-height (rectangle, synced for debug overlay). */
  @type("number") hitboxH: number = 20;

  /** Server timestamp (ms) until which the player is bleeding (DoT). */
  @type("number") bleedUntil: number = 0;

  // ---- Skill cooldowns (NOT synced; server-only) — remaining seconds
  //      before each skill can be cast again. ----
  skillCooldowns: Map<SkillId, number> = new Map();
  /** Bleed damage per second (server-only; applied while bleedUntil > now). */
  bleedDps: number = 0;
  /** Damage per bleed tick (10% of claw damage). */
  bleedTickDamage: number = 0;
  /** Whether the bleed is a critical bleed (from crit claw hit). */
  bleedIsCrit: boolean = false;
  bleedTickAccum: number = 0;

  // ---- Shield internals ----
  /** Shield STAT level (controls shield amount). +20 shield per stat level.
   *  Grows automatically with player level (levelUp increments this). */
  @type("number") shieldStatLevel: number = 1;
  /** Shield CARD/SLOT level (controls recovery delay). Lower delay per level.
   *  Upgraded via the C-tab / message 6 (stat === "shield"). */
  @type("number") shieldCardLevel: number = 1;
  /**
   * Server timestamp (ms) at which the broken shield begins recharging.
   * Set to (now + recoveryDelay) whenever the shield breaks or takes a hit
   * while at 0. While Date.now() < this value, no recharge happens.
   */
  shieldRechargeAt: number = 0;

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
    this.defence = PLAYER_STATS.BASE.DEFENCE;
    this.level = 1;
    this.currentXp = 0;
    this.xpToLevelUp = PLAYER_STATS.LEVELING.LEVEL_1_XP;
    this.skillPoints = 0;
    // Reset transient multipliers
    this.speedMultiplier = 1.0;
    this.damageMultiplier = 1.0;
    this.incomingDamageMultiplier = 1.0;
    // Reset heal state
    this.healKills = 0;
    this.healReady = true;
    this.healCooldownEndsAt = 0;
    // Default shield: stat level 1 (controls amount), card level 1 (controls recovery)
    this.shieldStatLevel = 1;
    this.shieldCardLevel = 1;
    this.recomputeShield();
    this.invincibleUntil = 0;
  }

  // ============================================================
  // SHIELD
  // ============================================================

  /**
   * Recompute shield from the separate stat (amount) and card (recovery) levels.
   * - maxShield = SHIELD_STAT.BASE_AMOUNT + (shieldStatLevel - 1) * SHIELD_STAT.AMOUNT_PER_LEVEL
   * - Recovery delay = SHIELD_CARD.BASE_DELAY - (shieldCardLevel - 1) * REDUCTION
   * Called on spawn, respawn, and levelUp.
   */
  recomputeShield(): void {
    const S = PLAYER_STATS.SHIELD_STAT;
    this.maxShield =
      S.BASE_AMOUNT + (this.shieldStatLevel - 1) * S.AMOUNT_PER_LEVEL;
    this.shield = this.maxShield;
    this.shieldRechargeAt = 0;
    this.shieldState = 0;
  }

  /** Recovery delay (seconds) for the current shield CARD/SLOT level. */
  shieldRecoveryDelay(): number {
    const S = PLAYER_STATS.SHIELD_CARD;
    return Math.max(
      S.MIN_RECOVERY_DELAY,
      S.BASE_RECOVERY_DELAY -
        S.RECOVERY_DELAY_REDUCTION_PER_LEVEL * (this.shieldCardLevel - 1),
    );
  }

  /**
   * Advance shield recovery by `dt` seconds (called each fixedTick).
   * While the shield is at 0, wait out the recovery delay; then recharge a
   * fraction of maxShield per second until full. Once full, mark active.
   */
  tickShield(dt: number): void {
    if (this.shieldStatLevel <= 0 || this.maxShield <= 0) return;
    // Already full — active.
    if (this.shield >= this.maxShield) {
      this.shield = this.maxShield;
      this.shieldState = 0;
      return;
    }
    const now = Date.now();
    // Waiting out the recovery delay (broken shield).
    if (now < this.shieldRechargeAt) {
      this.shieldState = 1;
      return;
    }
    // Recharging.
    this.shieldState = 1;
    const recharge =
      this.maxShield * PLAYER_STATS.SHIELD_CARD.RECHARGE_RATE * dt;
    this.shield = Math.min(this.maxShield, this.shield + recharge);
    if (this.shield >= this.maxShield) {
      this.shield = this.maxShield;
      this.shieldState = 0; // fully recharged -> active again
    }
  }

  /** Spend a skill point to upgrade the shield CARD/SLOT (faster recovery).
   *  Does NOT affect shield amount â€” shield amount is stat-based (grows with level). */
  /** Max shield card/slot level (recovery can't be upgraded past this). */
  static readonly MAX_SHIELD_CARD_LEVEL = 10;

  upgradeShieldSlot(): void {
    if (this.shieldCardLevel >= Player.MAX_SHIELD_CARD_LEVEL) return;
    this.shieldCardLevel += 1;
    this.recomputeShield();
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
    let speed = this.speedMultiplier;
    // Shock slows movement by 50%.
    if (Date.now() < this.shockUntil) speed *= 0.5;
    this.moveSpeed = this.baseMoveSpeed * speed;
  }

  // ============================================================
  // HEALTH
  // ============================================================

  /** Apply damage to the player (respects incomingDamageMultiplier).
   *  Shield absorbs first, then health. sourceSkillId controls the
   *  hit-feedback duration (flash + pause). */
  takeDamage(
    rawDamage: number,
    sourceSkillId?: SkillId,
    _attackerId?: string,
    isCrit: boolean = false,
  ): number {
    if (Date.now() < this.invincibleUntil) return 0;
    // Defence reduces incoming damage. Crits bypass only 50% of defence.
    // Shock reduces defence by 20% (can go negative = bonus damage).
    const isShocked = Date.now() < this.shockUntil;
    const shockMod = isShocked ? -0.2 : 0.0;
    const effectiveDefence =
      (isCrit ? this.defence * 0.5 : this.defence) + shockMod;
    const mitigated = rawDamage * (1.0 - effectiveDefence);
    let dmg = mitigated * this.incomingDamageMultiplier;
    let shielded = false;
    let totalShieldAbsorbed = 0;
    // Shield absorbs first.
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      if (absorbed > 0) {
        shielded = true;
        totalShieldAbsorbed = absorbed;
      }
      this.shield -= absorbed;
      dmg -= absorbed;
      // ANY damage to the shield re-arms the recovery delay. The shield only
      // starts regenerating after the full delay passes with no new damage.
      if (absorbed > 0) {
        this.shieldRechargeAt = Date.now() + this.shieldRecoveryDelay() * 1000;
        this.shieldState = 1;
      }
      if (this.shield <= 0) {
        this.shield = 0;
      }
    } else {
      // No shield: keep the recovery delay armed from the last break so a
      // steady stream of hits doesn't begin recharging mid-combat.
      if (this.shieldCardLevel > 0 && this.shieldRechargeAt < Date.now()) {
        this.shieldRechargeAt = Date.now() + this.shieldRecoveryDelay() * 1000;
      }
    }
    this.currentHealth = Math.max(0, this.currentHealth - dmg);
    // Hit feedback: white flash + hit-stun — ALWAYS show on damage.
    const fbMs = Math.max(
      150,
      sourceSkillId ? getSkillHitFeedback(sourceSkillId) : 100,
    );
    const now = Date.now();
    this.hitFlashUntil = Math.max(this.hitFlashUntil, now + fbMs);
    // Hit-stun removed — only flash, no movement freeze.
    // Record last hit for client-side damage numbers.
    const finalDmg = mitigated * this.incomingDamageMultiplier;
    this.lastHitDamage = Math.round(finalDmg);
    this.lastHitCrit = isCrit;
    this.lastHitShielded = shielded;
    (this as any).lastShieldDamage = totalShieldAbsorbed;
    (this as any).lastHpDamage = finalDmg - totalShieldAbsorbed;
    this.hitSeq += 1;
    return finalDmg;
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
    this.skillPoints += 1;
    const g = PLAYER_STATS.LEVELING.GROWTH;
    this.maxHealth += g.MAX_HEALTH;
    this.attack += g.ATTACK;
    this.critRate += g.CRIT_RATE;
    this.critDamage += g.CRIT_DAMAGE;
    this.baseMoveSpeed += g.MOVE_SPEED;
    // Recompute the XP required for the NEXT level
    this.xpToLevelUp = PLAYER_STATS.LEVELING.xpForNextLevel(this.level);
    // Shield stat grows with each level (+20 shield per level)
    this.shieldStatLevel += 1;
    this.recomputeShield();
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
    this.skillLevels.set("shock", 1);
    this.skillLevels.set("claw", 1);
    this.skillLevels.set("heal", 1);
    this.skillLevels.set("pulse", 1);
    this.skillLevels.set("dash", 1);
    this.skillCooldowns.clear();
    // Clear bleed
    this.bleedUntil = 0;
    this.bleedDps = 0;
    this.invincibleUntil = 0;
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

  /** True if a skill is off cooldown / ready to cast. */
  isSkillReady(skill: SkillId): boolean {
    if (skill === "heal") return this.healReady;
    return (this.skillCooldowns.get(skill) ?? 0) <= 0;
  }

  /** Put a skill on cooldown (seconds). Also stamps the synced end-time
   *  for the bolter so the client HUD can render a fill animation. */
  startSkillCooldown(skill: SkillId, cooldown: number): void {
    if (skill === "heal") {
      this.healReady = false;
      this.healCooldownEndsAt = Date.now() + cooldown * 1000;
      this.skillCooldowns.set("heal", cooldown);
      return;
    }
    this.skillCooldowns.set(skill, cooldown);
    const endsAt = Date.now() + cooldown * 1000;
    if (skill === "bolter") {
      this.bolterCooldownEndsAt = endsAt;
    } else if (skill === "slam") {
      this.slamCooldownEndsAt = endsAt;
    } else if (skill === "claw") {
      this.clawCooldownEndsAt = endsAt;
    } else if (skill === "pulse") {
      this.pulseCooldownEndsAt = endsAt;
    } else if (skill === "shock") {
      this.shockCooldownEndsAt = endsAt;
    } else if (skill === "dash") {
      this.dashCooldownEndsAt = endsAt;
    } else if (skill === "vortex") {
      this.vortexCooldownEndsAt = endsAt;
    }
  }

  /** Tick heal cooldown (called each fixedTick). When cooldown expires, heal becomes ready again. */
  tickHealCooldown(dt: number): void {
    const healLvl = this.getSkillLevel("heal");
    if (healLvl <= 0) return;
    const cd = this.skillCooldowns.get("heal") ?? 0;
    if (cd > 0) {
      const newCd = Math.max(0, cd - dt);
      this.skillCooldowns.set("heal", newCd);
      if (newCd <= 0) {
        this.healReady = true;
        this.healCooldownEndsAt = 0;
      }
    }
  }

  /** Register a kill towards the heal charge (L1-4 mode). */
  addHealKill(): void {
    const healLvl = this.getSkillLevel("heal");
    if (healLvl <= 0 || healLvl >= 5) return;
    this.healKills += 1;
    if (this.healKills >= 5) {
      this.healReady = true;
      this.healKills = 0;
    }
  }

  /** Advance all skill cooldowns by dt seconds (clamped at 0). */
  tickSkillCooldowns(dt: number): void {
    for (const [skill, cd] of this.skillCooldowns) {
      this.skillCooldowns.set(skill, Math.max(0, cd - dt));
    }
  }

  /**
   * Advance bleed DoT: apply bleedTickDamage every 0.5s while active.
   * Returns true if the player died from bleed this tick.
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
      this.bleedTickDamage = 0;
      this.bleedTickAccum = 0;
      return false;
    }
    // Tick bleed damage twice per second (every 0.5s).
    // BLEED BYPASSES SHIELD â€” damages HP directly.
    this.bleedTickAccum += dt;
    if (this.bleedTickAccum >= 0.5) {
      this.bleedTickAccum -= 0.5;
      this.currentHealth = Math.max(
        0,
        this.currentHealth - this.bleedTickDamage,
      );
      this.lastHitCrit = this.bleedIsCrit;
      this.lastHitShielded = false;
      (this as any).lastShieldDamage = 0;
      (this as any).lastHpDamage = this.bleedTickDamage;
      this.lastHitDamage = this.bleedTickDamage;
      this.hitSeq += 1;
      this.hitFlashUntil = Math.max(this.hitFlashUntil, Date.now() + 100);
      return this.isDead;
    }
    return false;
  }

  /** Inflict bleed: set tick damage + crit status + until timestamp. */
  applyBleed(
    tickDamage: number,
    durationSec: number,
    _attackerId?: string,
    isCritBleed?: boolean,
  ): void {
    this.bleedTickDamage = tickDamage;
    this.bleedDps = tickDamage * 2; // backwards compat
    this.bleedIsCrit = isCritBleed ?? false;
    this.bleedUntil = Date.now() + durationSec * 1000;
    this.bleedTickAccum = 0;
  }
}
