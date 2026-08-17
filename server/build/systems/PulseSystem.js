import { SkillCast } from "../schema/SkillCast";
import { applyCrit, pulseDamage, pulseRadius, pulseShockChance, } from "../config/skillDefs";
const PULSE_SHOCK_DURATION_MS = 10000; // 10 seconds
export class PulseSystem {
    constructor(state) {
        this.state = state;
        this.nextId = 1;
    }
    /**
     * Cast pulse for a player.
     * Returns true if the pulse was applied.
     */
    castPlayerPulse(player, sessionId, skillLevel, critRate, critDamage, cardRadiusMult = 1, cardDamageMult = 1) {
        if (skillLevel <= 0)
            return false;
        const damage = pulseDamage(skillLevel) * cardDamageMult;
        const radius = pulseRadius(skillLevel) * cardRadiusMult;
        const shockChance = pulseShockChance(skillLevel);
        const now = Date.now();
        // Damage all enemies in radius
        this.state.enemies.forEach((enemy) => {
            if (enemy.isDead)
                return;
            const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
            if (dist <= radius) {
                const { damage: finalDamage, isCrit } = applyCrit(damage, critRate, critDamage);
                enemy.takeDamage(finalDamage, "pulse", sessionId, isCrit);
                // Shock chance
                if (shockChance > 0 && Math.random() < shockChance) {
                    enemy.shockUntil = now + PULSE_SHOCK_DURATION_MS;
                    enemy.recalcDerivedStats();
                }
            }
        });
        // Spawn VFX via SkillCast
        this.spawnPulseVfx(player.x, player.y, radius, skillLevel, "player");
        return true;
    }
    /**
     * Cast pulse for an enemy (AI usage).
     */
    castEnemyPulse(enemy, skillLevel = 1, critRate = 0, critDamage = 1.5, cardRadiusMult = 1, cardDamageMult = 1) {
        const damage = pulseDamage(skillLevel) * cardDamageMult;
        const radius = pulseRadius(skillLevel) * cardRadiusMult;
        const shockChance = pulseShockChance(skillLevel);
        const now = Date.now();
        // Damage all players in radius
        this.state.players.forEach((p) => {
            if (p.isDead)
                return;
            const dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
            if (dist <= radius) {
                const { damage: finalDamage, isCrit } = applyCrit(damage, critRate, critDamage);
                p.takeDamage(finalDamage, "pulse", undefined, isCrit);
                if (shockChance > 0 && Math.random() < shockChance) {
                    p.shockUntil = now + PULSE_SHOCK_DURATION_MS;
                    p.recalcDerivedStats();
                }
            }
        });
        this.spawnPulseVfx(enemy.x, enemy.y, radius, skillLevel, "enemy");
        return true;
    }
    /** Spawn a pulse VFX via the SkillCast collection. */
    spawnPulseVfx(x, y, radius, level, faction) {
        const cast = new SkillCast();
        cast.x = x;
        cast.y = y;
        cast.skillId = "pulse";
        cast.faction = faction;
        cast.range = radius;
        cast.level = level;
        cast.tier = level >= 6 ? "big" : "small";
        cast.angle = 0;
        const id = `pulse_${this.nextId++}_${Date.now()}`;
        this.state.skillCasts.set(id, cast);
        // Auto-remove after 600ms (client animation)
        setTimeout(() => {
            this.state.skillCasts.delete(id);
        }, 600);
    }
}
