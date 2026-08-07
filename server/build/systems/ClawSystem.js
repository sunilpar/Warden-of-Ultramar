import { SkillCast } from "../schema/SkillCast";
import { CLAW_DEF, clawTier, clawInflictsBleed, computeSkillDamage, } from "../config/skillDefs";
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
    castClaw(ownerId, faction, x, y, angle, attack, skillLevel, damageMultiplier) {
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
                if (this.inCone(x, y, angle, halfAngle, range, enemy.x, enemy.y)) {
                    enemy.takeDamage(damage);
                    if (bleed) {
                        enemy.applyBleed(CLAW_DEF.bleedDps(skillLevel), CLAW_DEF.bleedDuration(skillLevel));
                    }
                }
            });
        }
        else {
            // Enemy claw: hits players + other enemies (never caster).
            this.state.players.forEach((player, id) => {
                if (id === ownerId || player.isDead)
                    return;
                if (this.inCone(x, y, angle, halfAngle, range, player.x, player.y)) {
                    player.takeDamage(damage);
                    if (bleed) {
                        player.applyBleed(CLAW_DEF.bleedDps(skillLevel), CLAW_DEF.bleedDuration(skillLevel));
                    }
                }
            });
            this.state.enemies.forEach((enemy, id) => {
                if (id === ownerId || enemy.isDead)
                    return;
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
    inCone(ox, oy, angle, halfAngle, range, px, py) {
        const dx = px - ox;
        const dy = py - oy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range)
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
        return Math.abs(delta) <= halfAngle;
    }
}
