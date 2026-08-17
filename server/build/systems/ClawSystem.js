import { SkillCast } from "../schema/SkillCast";
import { CLAW_DEF, clawTier, clawInflictsBleed, computeSkillDamage, applyCrit, } from "../config/skillDefs";
/** How long (ms) a SkillCast VFX entity lives before the server removes it. */
const SKILL_CAST_TTL_MS = 350;
export class ClawSystem {
    constructor(state) {
        this.state = state;
        this.nextId = 1;
        /** Timestamps (ms) at which each skillCast id should be removed. */
        this.expiry = new Map();
    }
    /** Advance TTLs and remove expired SkillCast VFX entities. */
    update(_dt) {
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
    castClaw(ownerId, faction, x, y, angle, attack, skillLevel, damageMultiplier, casterRadius = 10, critRate = 0, critDamage = 1.5) {
        const tier = clawTier(skillLevel);
        const halfAngle = CLAW_DEF.coneHalfAngle(skillLevel);
        const range = CLAW_DEF.range(skillLevel);
        const damage = computeSkillDamage("claw", attack, skillLevel, damageMultiplier);
        const bleed = clawInflictsBleed(skillLevel);
        // --- Apply damage to targets inside the cone (faction-aware) ---
        if (faction === "player") {
            this.state.enemies.forEach((enemy, id) => {
                if (id === ownerId || enemy.isDead)
                    return;
                if (this.inCone(x, y, angle, halfAngle, range, enemy.x, enemy.y, Math.max(enemy.hitboxW, enemy.hitboxH))) {
                    const c = applyCrit(damage, critRate, critDamage);
                    enemy.takeDamage(c.damage, "claw", ownerId, c.isCrit);
                    if (bleed) {
                        enemy.applyBleed(Math.round(c.damage * 0.1), CLAW_DEF.bleedDuration(skillLevel), ownerId, c.isCrit);
                    }
                }
            });
        }
        else {
            // Enemy claw: hits players + other enemies (never caster).
            this.state.players.forEach((player, id) => {
                if (id === ownerId || player.isDead)
                    return;
                if (this.inCone(x, y, angle, halfAngle, range, player.x, player.y, Math.max(player.hitboxW, player.hitboxH))) {
                    const c2 = applyCrit(damage, critRate, critDamage);
                    player.takeDamage(c2.damage, "claw", undefined, c2.isCrit);
                    if (bleed) {
                        player.applyBleed(Math.round(c2.damage * 0.1), CLAW_DEF.bleedDuration(skillLevel), undefined, c2.isCrit);
                    }
                }
            });
            this.state.enemies.forEach((enemy, id) => {
                if (id === ownerId || enemy.isDead)
                    return;
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
    inCone(ox, oy, angle, halfAngle, range, px, py, targetRadius) {
        // Expand range by target radius so edge-of-cone hits feel fair
        const effectiveRange = targetRadius ? range + targetRadius : range;
        const dx = px - ox;
        const dy = py - oy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > effectiveRange)
            return false;
        if (dist < 0.0001)
            return true; // caster on top of target
        const pointAngle = Math.atan2(dy, dx);
        let delta = pointAngle - angle;
        // Normalize delta to [-PI, PI]
        while (delta > Math.PI)
            delta -= 2 * Math.PI;
        while (delta < -Math.PI)
            delta += 2 * Math.PI;
        // Expand half-angle slightly by target radius for fairness
        const effectiveHalfAngle = targetRadius
            ? halfAngle + Math.atan2(targetRadius, Math.max(dist, 1))
            : halfAngle;
        return Math.abs(delta) <= effectiveHalfAngle;
    }
}
