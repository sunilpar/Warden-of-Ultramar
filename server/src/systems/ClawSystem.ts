/**
 * Claw System
 * ===========
 * Implements the claw skill: an instant cone-shaped melee attack in the
 * caster's aim direction. Damage is applied immediately at cast time
 * (hit-scan, no projectile). A transient SkillCast VFX entity is spawned
 * so the client can render the slash animation.
 *
 * FACTION RULES (same as bolter)
 *   - "player" claws damage ENEMIES only.
 *   - "enemy"  claws damage PLAYERS + OTHER ENEMIES (never the caster).
 *
 * TIERS (by skill level)
 *   small (1-3): short range, narrow cone.
 *   mid   (4-7): longer range, wider cone.
 *   big   (8-10): longest range, widest cone, inflicts BLEED (DoT).
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { SkillCast } from "../schema/SkillCast";
import {
  CLAW_DEF,
  clawTier,
  clawInflictsBleed,
  computeSkillDamage,
  type SkillId,
} from "../config/skillDefs";

export type ClawFaction = "player" | "enemy";

/** How long (ms) a SkillCast VFX entity lives before the server removes it. */
const SKILL_CAST_TTL_MS = 350;

export class ClawSystem {
  private nextId = 1;
  /** Timestamps (ms) at which each skillCast id should be removed. */
  private expiry = new Map<string, number>();

  constructor(private state: RoomState) {}

  /** Advance TTLs and remove expired SkillCast VFX entities. */
  update(_dt: number): void {
    const now = Date.now();
    for (const [id, expires] of this.expiry) {
      if (now >= expires) {
        this.state.skillCasts.delete(id);
        this.expiry.delete(id);
      }
    }
  }

  /**
   * Cast the claw skill. Applies cone damage immediately (hit-scan), inflicts
   * bleed at tier "big", and spawns a SkillCast VFX entity for the client.
   *
   * Always returns true (claw has no "miss" condition; the cone always swipes).
   */
  castClaw(
    ownerId: string,
    faction: ClawFaction,
    x: number,
    y: number,
    angle: number,
    attack: number,
    skillLevel: number,
    damageMultiplier: number,
  ): boolean {
    const tier = clawTier(skillLevel);
    const halfAngle = CLAW_DEF.coneHalfAngle(skillLevel);
    const range = CLAW_DEF.range(skillLevel);
    const damage = computeSkillDamage(
      "claw" as SkillId,
      attack,
      skillLevel,
      damageMultiplier,
    );
    const bleed = clawInflictsBleed(skillLevel);

    // --- Apply damage to targets inside the cone (faction-aware) ---
    if (faction === "player") {
      this.state.enemies.forEach((enemy, id) => {
        if (id === ownerId || enemy.isDead) return;
        if (this.inCone(x, y, angle, halfAngle, range, enemy.x, enemy.y)) {
          enemy.takeDamage(damage);
          if (bleed) {
            enemy.applyBleed(CLAW_DEF.bleedDps(skillLevel), CLAW_DEF.bleedDuration(skillLevel));
          }
        }
      });
    } else {
      // Enemy claw: hits players + other enemies (never caster).
      this.state.players.forEach((player, id) => {
        if (id === ownerId || player.isDead) return;
        if (this.inCone(x, y, angle, halfAngle, range, player.x, player.y)) {
          player.takeDamage(damage);
          if (bleed) {
            player.applyBleed(CLAW_DEF.bleedDps(skillLevel), CLAW_DEF.bleedDuration(skillLevel));
          }
        }
      });
      this.state.enemies.forEach((enemy, id) => {
        if (id === ownerId || enemy.isDead) return;
        if (this.inCone(x, y, angle, halfAngle, range, enemy.x, enemy.y)) {
          enemy.takeDamage(damage);
          if (bleed) {
            enemy.applyBleed(CLAW_DEF.bleedDps(skillLevel), CLAW_DEF.bleedDuration(skillLevel));
          }
        }
      });
    }

    // --- Spawn the transient SkillCast VFX entity ---
    const cast = new SkillCast();
    cast.x = x;
    cast.y = y;
    cast.skillId = "claw";
    cast.angle = angle;
    cast.level = skillLevel;
    cast.tier = tier;
    cast.faction = faction;
    const id = `cast_${this.nextId++}_${Date.now()}`;
    this.state.skillCasts.set(id, cast);
    this.expiry.set(id, Date.now() + SKILL_CAST_TTL_MS);

    return true;
  }

  /**
   * Point-in-cone test. The cone originates at (ox,oy), points along `angle`,
   * has half-angle `halfAngle` (radians) and reaches `range` px.
   */
  private inCone(
    ox: number,
    oy: number,
    angle: number,
    halfAngle: number,
    range: number,
    px: number,
    py: number,
  ): boolean {
    const dx = px - ox;
    const dy = py - oy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > range) return false;
    if (dist < 0.0001) return true; // caster on top of target
    const pointAngle = Math.atan2(dy, dx);
    let delta = pointAngle - angle;
    // Normalize delta to [-PI, PI]
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    return Math.abs(delta) <= halfAngle;
  }
}
