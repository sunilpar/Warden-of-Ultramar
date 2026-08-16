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
import { SkillCast } from "../schema/SkillCast";
import {
  CLAW_DEF,
  clawTier,
  clawInflictsBleed,
  computeSkillDamage,
  applyCrit,
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
    casterRadius: number = 10,
    critRate: number = 0,
    critDamage: number = 1.5,
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
        if (this.inCone(x, y, angle, halfAngle, range, enemy.x, enemy.y, Math.max(enemy.hitboxW, enemy.hitboxH))) {
          const c = applyCrit(damage, critRate, critDamage);
          enemy.takeDamage(c.damage, "claw", ownerId, c.isCrit);
          if (bleed) {
            enemy.applyBleed(Math.round(c.damage * 0.1), CLAW_DEF.bleedDuration(skillLevel), ownerId, c.isCrit);
          }
        }
      });
    } else {
      // Enemy claw: hits players + other enemies (never caster).
      this.state.players.forEach((player, id) => {
        if (id === ownerId || player.isDead) return;
        if (this.inCone(x, y, angle, halfAngle, range, player.x, player.y, Math.max(player.hitboxW, player.hitboxH))) {
          const c2 = applyCrit(damage, critRate, critDamage);
          player.takeDamage(c2.damage, "claw", undefined, c2.isCrit);
          if (bleed) {
            player.applyBleed(Math.round(c2.damage * 0.1), CLAW_DEF.bleedDuration(skillLevel), undefined, c2.isCrit);
          }
        }
      });
      this.state.enemies.forEach((enemy, id) => {
        if (id === ownerId || enemy.isDead) return;
        if (this.inCone(x, y, angle, halfAngle, range, enemy.x, enemy.y, Math.max(enemy.hitboxW, enemy.hitboxH))) {
          const c = applyCrit(damage, critRate, critDamage);
          enemy.takeDamage(c.damage, "claw", ownerId, c.isCrit);
          if (bleed) {
            enemy.applyBleed(Math.round(c.damage * 0.1), CLAW_DEF.bleedDuration(skillLevel), ownerId, c.isCrit);
          }
        }
      });
    }

    // --- Spawn the transient SkillCast VFX entity ---
    // Offset from caster center to the edge of the caster hitbox in the aim direction.
    const vfxX = x + Math.cos(angle) * casterRadius;
    const vfxY = y + Math.sin(angle) * casterRadius;
    const cast = new SkillCast();
    cast.x = vfxX;
    cast.y = vfxY;
    cast.skillId = "claw";
    cast.angle = angle;
    cast.level = skillLevel;
    cast.tier = tier;
    cast.faction = faction;
    cast.range = range;
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
    targetRadius?: number,
  ): boolean {
    // Expand range by target radius so edge-of-cone hits feel fair
    const effectiveRange = targetRadius ? range + targetRadius : range;
    const dx = px - ox;
    const dy = py - oy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > effectiveRange) return false;
    if (dist < 0.0001) return true; // caster on top of target
    const pointAngle = Math.atan2(dy, dx);
    let delta = pointAngle - angle;
    // Normalize delta to [-PI, PI]
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    // Expand half-angle slightly by target radius for fairness
    const effectiveHalfAngle = targetRadius
      ? halfAngle + Math.atan2(targetRadius, Math.max(dist, 1))
      : halfAngle;
    return Math.abs(delta) <= effectiveHalfAngle;
  }
}
