import { SkillCast } from "../schema/SkillCast";
import { SKILL_DEFS, healPercent, healRadius, } from "../config/skillDefs";
export class HealSystem {
    constructor(state) {
        this.state = state;
        this.nextId = 1;
    }
    /**
     * Cast heal for a player.
     * Returns true if the heal was applied.
     */
    castPlayerHeal(player, slot) {
        const card = player.slotCard(slot);
        if (!card || card.skill !== "heal")
            return false;
        const level = Math.max(1, Math.floor(card.level || 1));
        if (!player.isSlotReady(slot))
            return false;
        const def = SKILL_DEFS.heal;
        const pct = healPercent(level);
        const radius = healRadius(level);
        if (level >= def.aoeUnlockLevel) {
            // AoE heal: heal all players + enemies in radius
            this.state.players.forEach((p) => {
                if (p.isDead)
                    return;
                const dist = Math.hypot(p.x - player.x, p.y - player.y);
                if (dist <= radius) {
                    p.heal(Math.round(p.maxHealth * pct));
                }
            });
            this.state.enemies.forEach((e) => {
                if (e.isDead)
                    return;
                const dist = Math.hypot(e.x - player.x, e.y - player.y);
                if (dist <= radius) {
                    e.heal(Math.round(e.maxHealth * pct));
                }
            });
            // VFX: AoE circle (cooldown applied by the room, per slot)
            this.spawnHealVfx(player.x, player.y, radius, "player");
        }
        else {
            // Self-only heal (percentage of max HP)
            player.heal(Math.round(player.maxHealth * pct));
            // VFX: green flash on self (charge consumed by the room, per slot)
            this.spawnHealVfx(player.x, player.y, 0, "player");
        }
        return true;
    }
    /**
     * Cast heal for an enemy (AI usage).
     * Enemies always use AoE mode if level >= aoeUnlockLevel, otherwise self-heal.
     */
    castEnemyHeal(enemy, level = 1) {
        const def = SKILL_DEFS.heal;
        const pct = healPercent(level);
        const radius = healRadius(level);
        if (level >= def.aoeUnlockLevel) {
            this.state.players.forEach((p) => {
                if (p.isDead)
                    return;
                const dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
                if (dist <= radius) {
                    p.heal(Math.round(p.maxHealth * pct));
                }
            });
            this.state.enemies.forEach((e) => {
                if (e.isDead)
                    return;
                const dist = Math.hypot(e.x - enemy.x, e.y - enemy.y);
                if (dist <= radius) {
                    e.heal(Math.round(e.maxHealth * pct));
                }
            });
            this.spawnHealVfx(enemy.x, enemy.y, radius, "enemy");
        }
        else {
            enemy.heal(Math.round(enemy.maxHealth * pct));
            this.spawnHealVfx(enemy.x, enemy.y, 0, "enemy");
        }
        return true;
    }
    /** Spawn a heal VFX via the SkillCast collection. */
    spawnHealVfx(x, y, radius, faction) {
        const cast = new SkillCast();
        cast.x = x;
        cast.y = y;
        cast.skillId = "heal";
        cast.faction = faction;
        cast.range = radius; // 0 = self-heal flash, >0 = AoE circle
        cast.level = 1;
        cast.tier = "small";
        cast.angle = 0;
        const id = `heal_${this.nextId++}_${Date.now()}`;
        this.state.skillCasts.set(id, cast);
        // Auto-remove after 800ms (client animation duration)
        setTimeout(() => {
            this.state.skillCasts.delete(id);
        }, 800);
    }
}
