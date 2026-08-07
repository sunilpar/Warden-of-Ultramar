import { Enemy } from "../schema/Enemy";
import { GAME_CONFIG } from "../config/game";
import { ENEMY_STATS } from "../config/enemyStats";
import { SKILL_DEFS } from "../config/skillDefs";
export class EnemySystem {
    constructor(state, mapSystem) {
        this.state = state;
        this.mapSystem = mapSystem;
        this.projectileSystem = null;
        this.clawSystem = null;
    }
    /** Inject the ProjectileSystem (called by the room after both are created). */
    setProjectileSystem(ps) {
        this.projectileSystem = ps;
    }
    /** Inject the ClawSystem (called by the room after both are created). */
    setClawSystem(cs) {
        this.clawSystem = cs;
    }
    update(dt) {
        this.state.enemies.forEach((enemy) => {
            enemy.tickCooldowns(dt);
            enemy.tickBleed(dt);
            switch (enemy.typeId) {
                case "tyranid":
                    this.updateTyranid(enemy, dt);
                    break;
                default:
                    break;
            }
        });
    }
    // ============================================================
    // TYRANID
    // ============================================================
    /** Tyranid: find nearest player, move toward them, try skills.
     *  Stops ATTACK_RANGE_PX before the target and plays the attack animation. */
    updateTyranid(enemy, _dt) {
        const now = Date.now();
        const isPaused = now < enemy.pausedUntil;
        const target = this.findNearestPlayer(enemy);
        if (!target) {
            enemy.attacking = false;
            return;
        }
        enemy.facingRight = target.x > enemy.x;
        if (isPaused) {
            // Hit-stun: don't move or attack while paused.
            enemy.attacking = false;
            return;
        }
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const STOP_RANGE = 10 + enemy.collisionRadius + 20; // 10px gap + target radius
        if (dist <= STOP_RANGE) {
            // In range: stop moving and play the attack animation.
            enemy.attacking = true;
        }
        else {
            enemy.attacking = false;
            this.moveToward(enemy, target.x, target.y, _dt);
        }
        this.tryUseSkill(enemy, target);
    }
    // ============================================================
    // SHARED AI HELPERS
    // ============================================================
    /** Find the nearest alive player to this enemy. Returns null if none. */
    findNearestPlayer(enemy) {
        let nearest = null;
        let nearestDistSq = Infinity;
        this.state.players.forEach((player) => {
            if (player.isDead)
                return;
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
     * Move an enemy toward a target point. Same normalized-direction *
     * effectiveSpeed * dt formula as the player, so base speed 60 == 1px/tick
     * and percentage buffs (speedMultiplier) apply via recalcDerivedStats.
     */
    moveToward(enemy, targetX, targetY, dt) {
        let dx = targetX - enemy.x;
        let dy = targetY - enemy.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0.0001) {
            dx /= length;
            dy /= length;
        }
        enemy.recalcDerivedStats();
        const speed = enemy.moveSpeed;
        enemy.x += dx * speed * dt;
        enemy.y += dy * speed * dt;
        enemy.x = Math.max(0, Math.min(this.mapSystem.width, enemy.x));
        enemy.y = Math.max(0, Math.min(this.mapSystem.height, enemy.y));
        const resolved = this.mapSystem.resolveTileCollision(enemy.x, enemy.y, enemy.collisionRadius);
        enemy.x = resolved.x;
        enemy.y = resolved.y;
    }
    /**
     * Attempt to use a skill this tick. Random roll; on success pick a random
     * skill from the pool. If on cooldown, the roll is wasted. If ready, fire.
     */
    tryUseSkill(enemy, target) {
        const chance = GAME_CONFIG.ENEMY.SKILL_ATTEMPT_CHANCE;
        if (Math.random() > chance)
            return;
        if (enemy.skillPool.length === 0)
            return;
        const skill = enemy.skillPool[Math.floor(Math.random() * enemy.skillPool.length)];
        if (!enemy.isSkillReady(skill))
            return;
        this.useSkill(enemy, skill, target);
    }
    /**
     * Execute a skill for an enemy, aimed at the target. Dispatches to the
     * ProjectileSystem for projectile skills. Shared with the player.
     */
    useSkill(enemy, skill, target) {
        const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
        if (skill === "bolter" && this.projectileSystem) {
            this.projectileSystem.castBolter(this.enemyOwnerId(enemy), "enemy", enemy.x, enemy.y, angle, enemy.attack, this.enemySkillLevel(enemy, skill), enemy.damageMultiplier);
        }
        else if (skill === "claw" && this.clawSystem) {
            this.clawSystem.castClaw(this.enemyOwnerId(enemy), "enemy", enemy.x, enemy.y, angle, enemy.attack, this.enemySkillLevel(enemy, skill), enemy.damageMultiplier);
        }
        enemy.startCooldown(skill);
    }
    /** Derive a stable owner id for an enemy. */
    enemyOwnerId(enemy) {
        return enemy.__id ?? `enemy_${enemy.typeId}`;
    }
    /** Enemy skill level (defaults to 1; real leveling wired later). */
    enemySkillLevel(_enemy, _skill) {
        return 1;
    }
    /** Cooldown lookup for a skill (kept for parity). */
    skillCooldown(skill) {
        const def = SKILL_DEFS[skill];
        return def ? def.cooldown : ENEMY_STATS.tyranid.skillCooldown[skill] ?? 0;
    }
    // ============================================================
    // SPAWNING
    // ============================================================
    /** Spawn one enemy of the given type at a position and level. */
    spawn(typeId, x, y, level) {
        const enemy = new Enemy();
        enemy.init(typeId, level);
        enemy.x = x;
        enemy.y = y;
        const id = `enemy_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        enemy.__id = id;
        this.state.enemies.set(id, enemy);
        return id;
    }
    /** Remove a dead enemy by id. */
    remove(id) {
        this.state.enemies.delete(id);
    }
}
