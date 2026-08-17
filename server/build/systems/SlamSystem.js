import { Slam } from "../schema/Slam";
import { SLAM_DEF, applyCrit, computeSkillDamage } from "../config/skillDefs";
export class SlamSystem {
    constructor(state, mapSystem) {
        this.state = state;
        this.mapSystem = mapSystem;
        this.nextId = 1;
    }
    /** Advance all active slams: move, check wall collision, apply damage. */
    update(dt) {
        const toRemove = [];
        this.state.slams.forEach((slam, id) => {
            // Move
            const stepX = slam.vx * dt;
            const stepY = slam.vy * dt;
            slam.x += stepX;
            slam.y += stepY;
            slam.remainingRange -= Math.hypot(stepX, stepY);
            // Out of range -> remove
            if (slam.remainingRange <= 0) {
                toRemove.push(id);
                return;
            }
            // Wall collision -> stop and remove
            if (this.hitsWall(slam)) {
                toRemove.push(id);
                return;
            }
            // Apply damage to targets in the hitbox (with per-target cooldown)
            this.checkHits(slam, dt);
        });
        for (const id of toRemove)
            this.state.slams.delete(id);
    }
    // ============================================================
    // CASTING
    // ============================================================
    castSlam(ownerId, faction, x, y, angle, skillLevel, casterAttack = 100, casterDamageMultiplier = 1.0, critRate = 0, critDamage = 1.5) {
        const range = SLAM_DEF.range(skillLevel);
        const vx = Math.cos(angle) * SLAM_DEF.speed;
        const vy = Math.sin(angle) * SLAM_DEF.speed;
        const slam = new Slam();
        slam.skillId = "slam";
        slam.x = x;
        slam.y = y;
        slam.vx = vx;
        slam.vy = vy;
        slam.angle = angle;
        slam.level = skillLevel;
        slam.faction = faction;
        slam.ownerId = ownerId;
        slam.remainingRange = range;
        // halfWidth/halfHeight scale with skill level (+10% per level from L3+)
        const hw = typeof SLAM_DEF.halfWidth === "function"
            ? SLAM_DEF.halfWidth(skillLevel)
            : SLAM_DEF.halfWidth;
        const hh = typeof SLAM_DEF.halfHeight === "function"
            ? SLAM_DEF.halfHeight(skillLevel)
            : SLAM_DEF.halfHeight;
        slam.halfWidth = hw;
        slam.halfHeight = hh;
        slam.damage = computeSkillDamage("slam", casterAttack, skillLevel, casterDamageMultiplier);
        // bypass walls at L5+
        slam.bypassWalls =
            typeof SLAM_DEF.bypassWalls === "function"
                ? SLAM_DEF.bypassWalls(skillLevel)
                : false;
        slam.critRate = critRate;
        slam.critDamage = critDamage;
        const id = `slam_${this.nextId++}_${Date.now()}`;
        this.state.slams.set(id, slam);
        return true;
    }
    // ============================================================
    // HIT DETECTION
    // ============================================================
    /** Check if any targets overlap the slam's rectangular hitbox. */
    checkHits(slam, dt) {
        // Decrement per-target hit cooldowns
        for (const [tid, cd] of slam.hitCooldowns) {
            const newCd = cd - dt;
            if (newCd <= 0) {
                slam.hitCooldowns.delete(tid);
            }
            else {
                slam.hitCooldowns.set(tid, newCd);
            }
        }
        if (slam.faction === "player") {
            this.state.enemies.forEach((enemy, id) => {
                if (id === slam.ownerId || enemy.isDead)
                    return;
                if (slam.hitCooldowns.has(id))
                    return;
                if (this.rectContains(slam, enemy.x, enemy.y, Math.max(enemy.hitboxW, enemy.hitboxH))) {
                    const c = applyCrit(slam.damage, slam.critRate, slam.critDamage);
                    enemy.takeDamage(c.damage, "slam", slam.ownerId, c.isCrit);
                    slam.hitCooldowns.set(id, SLAM_DEF.hitInterval);
                }
            });
        }
        else {
            // Enemy slam: hits players + other enemies (never caster)
            this.state.players.forEach((player, id) => {
                if (id === slam.ownerId || player.isDead)
                    return;
                if (slam.hitCooldowns.has(id))
                    return;
                if (this.rectContains(slam, player.x, player.y, Math.max(player.hitboxW, player.hitboxH))) {
                    const c2 = applyCrit(slam.damage, slam.critRate, slam.critDamage);
                    player.takeDamage(c2.damage, "slam", undefined, c2.isCrit);
                    slam.hitCooldowns.set(id, SLAM_DEF.hitInterval);
                }
            });
            this.state.enemies.forEach((enemy, id) => {
                if (id === slam.ownerId || enemy.isDead)
                    return;
                if (slam.hitCooldowns.has(id))
                    return;
                if (this.rectContains(slam, enemy.x, enemy.y, Math.max(enemy.hitboxW, enemy.hitboxH))) {
                    const c = applyCrit(slam.damage, slam.critRate, slam.critDamage);
                    enemy.takeDamage(c.damage, "slam", slam.ownerId, c.isCrit);
                    slam.hitCooldowns.set(id, SLAM_DEF.hitInterval);
                }
            });
        }
    }
    /**
     * Point-in-rectangle test. The rectangle is centered at (slam.x, slam.y),
     * oriented along slam.angle. halfHeight = along travel dir, halfWidth =
     * perpendicular. We transform the point into the rectangle's local space.
     */
    rectContains(slam, px, py, targetRadius) {
        const cos = Math.cos(-slam.angle);
        const sin = Math.sin(-slam.angle);
        const dx = px - slam.x;
        const dy = py - slam.y;
        // Local coordinates (localX along travel, localY perpendicular)
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;
        return (Math.abs(localX) <= slam.halfHeight + targetRadius &&
            Math.abs(localY) <= slam.halfWidth + targetRadius);
    }
    /** True if the slam center is inside a solid tile (unless bypassWalls). */
    hitsWall(slam) {
        // L5+ slams bypass walls
        if (slam.bypassWalls)
            return false;
        const res = this.mapSystem.resolveTileCollision(slam.x, slam.y, slam.halfHeight);
        return Math.hypot(res.x - slam.x, res.y - slam.y) > 0.01;
    }
}
