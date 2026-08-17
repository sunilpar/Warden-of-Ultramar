import { Vortex } from "../schema/Vortex";
import { VORTEX_DEF, vortexRadius, vortexPullForce, vortexHasExplosion, vortexExplosionDamage, vortexExplosionRadius, vortexColorTier, applyCrit, } from "../config/skillDefs";
/** How long the explode phase lingers for client VFX (seconds). */
const EXPLODE_HOLD = 0.5;
export class VortexSystem {
    constructor(state, mapSystem) {
        this.state = state;
        this.mapSystem = mapSystem;
        this.nextId = 1;
    }
    /** Advance all active vortexes. */
    update(dt) {
        const toRemove = [];
        this.state.vortexes.forEach((vortex, id) => {
            if (vortex.phase === "pull") {
                this.updatePull(vortex, dt);
            }
            if (vortex.phase === "explode") {
                vortex.explodeTimer -= dt;
                if (vortex.explodeTimer <= 0) {
                    toRemove.push(id);
                }
            }
        });
        for (const id of toRemove)
            this.state.vortexes.delete(id);
    }
    // ============================================================
    // PHASE UPDATES
    // ============================================================
    /** Pull phase: drag all entities in radius toward the centre. */
    updatePull(vortex, dt) {
        vortex.pullTimer -= dt;
        const radius = vortex.radius;
        const forceStep = vortex.pullForce * dt;
        const cx = vortex.x;
        const cy = vortex.y;
        if (vortex.faction === "player") {
            // Pull enemies + other players
            this.state.enemies.forEach((enemy, eid) => {
                if (enemy.isDead)
                    return;
                this.pullEntity(enemy, eid, cx, cy, radius, forceStep, vortex, "enemy");
            });
            this.state.players.forEach((player, pid) => {
                if (pid === vortex.ownerId || player.isDead)
                    return;
                this.pullEntity(player, pid, cx, cy, radius, forceStep, vortex, "player");
            });
        }
        else {
            // Enemy vortex: pulls players + other enemies
            this.state.players.forEach((player, pid) => {
                if (pid === vortex.ownerId || player.isDead)
                    return;
                this.pullEntity(player, pid, cx, cy, radius, forceStep, vortex, "player");
            });
            this.state.enemies.forEach((enemy, eid) => {
                if (eid === vortex.ownerId || enemy.isDead)
                    return;
                this.pullEntity(enemy, eid, cx, cy, radius, forceStep, vortex, "enemy");
            });
        }
        if (vortex.pullTimer <= 0) {
            // Transition: enter explode phase (damage now if unlocked).
            vortex.phase = "explode";
            vortex.explodeTimer = EXPLODE_HOLD;
            if (vortex.hasExplosion) {
                this.doExplosion(vortex);
            }
        }
    }
    /**
     * Pull a single entity toward the vortex centre.
     * Uses collision resolution so entities get stuck against walls.
     */
    pullEntity(entity, entityId, cx, cy, radius, forceStep, vortex, type) {
        const dx = cx - entity.x;
        const dy = cy - entity.y;
        const dist = Math.hypot(dx, dy);
        if (dist > radius || dist < 1) {
            if (dist <= radius)
                vortex.pulledEntities.add(entityId);
            return;
        }
        vortex.pulledEntities.add(entityId);
        // Normalised direction toward centre
        const nx = dx / dist;
        const ny = dy / dist;
        // Move toward centre
        entity.x += nx * forceStep;
        entity.y += ny * forceStep;
        // Clamp to map bounds
        entity.x = Math.max(0, Math.min(this.mapSystem.width, entity.x));
        entity.y = Math.max(0, Math.min(this.mapSystem.height, entity.y));
        // Resolve collision — entity gets stuck if blocked by a wall
        const collisionRadius = type === "player" ? 10 : entity.collisionRadius;
        const resolved = this.mapSystem.resolveTileCollision(entity.x, entity.y, collisionRadius);
        entity.x = resolved.x;
        entity.y = resolved.y;
    }
    /** Explosion: deal AoE damage to all entities near the centre. */
    doExplosion(vortex) {
        if (vortex.explosionDamage <= 0 || vortex.explosionRadius <= 0)
            return;
        const radius = vortex.explosionRadius;
        const cx = vortex.x;
        const cy = vortex.y;
        if (vortex.faction === "player") {
            this.state.enemies.forEach((enemy) => {
                if (enemy.isDead)
                    return;
                const dist = Math.hypot(enemy.x - cx, enemy.y - cy);
                if (dist <= radius) {
                    const c = applyCrit(vortex.explosionDamage, vortex.critRate, vortex.critDamage);
                    enemy.takeDamage(c.damage, "vortex", vortex.ownerId, c.isCrit);
                }
            });
            this.state.players.forEach((player, pid) => {
                if (pid === vortex.ownerId || player.isDead)
                    return;
                const dist = Math.hypot(player.x - cx, player.y - cy);
                if (dist <= radius) {
                    const c = applyCrit(vortex.explosionDamage, vortex.critRate, vortex.critDamage);
                    player.takeDamage(c.damage, "vortex", undefined, c.isCrit);
                }
            });
        }
        else {
            this.state.players.forEach((player) => {
                if (player.isDead)
                    return;
                const dist = Math.hypot(player.x - cx, player.y - cy);
                if (dist <= radius) {
                    const c = applyCrit(vortex.explosionDamage, vortex.critRate, vortex.critDamage);
                    player.takeDamage(c.damage, "vortex", undefined, c.isCrit);
                }
            });
            this.state.enemies.forEach((enemy, eid) => {
                if (eid === vortex.ownerId || enemy.isDead)
                    return;
                const dist = Math.hypot(enemy.x - cx, enemy.y - cy);
                if (dist <= radius) {
                    const c = applyCrit(vortex.explosionDamage, vortex.critRate, vortex.critDamage);
                    enemy.takeDamage(c.damage, "vortex", vortex.ownerId, c.isCrit);
                }
            });
        }
    }
    // ============================================================
    // CASTING
    // ============================================================
    castVortex(ownerId, faction, x, y, _angle, skillLevel, _casterAttack = 100, _casterDamageMultiplier = 1.0, critRate = 0, critDamage = 1.5, cardRadiusMult = 1, cardDamageMult = 1) {
        const radius = vortexRadius(skillLevel) * cardRadiusMult;
        const pullForce = vortexPullForce(skillLevel);
        const hasExplosion = vortexHasExplosion(skillLevel);
        const explosionDmg = vortexExplosionDamage(skillLevel) * cardDamageMult;
        const explosionRad = vortexExplosionRadius(skillLevel) * cardRadiusMult;
        const tier = vortexColorTier(skillLevel);
        const vortex = new Vortex();
        vortex.skillId = "vortex";
        vortex.level = skillLevel;
        vortex.faction = faction;
        vortex.ownerId = ownerId;
        vortex.radius = radius;
        vortex.pullForce = pullForce;
        vortex.pullTimer = VORTEX_DEF.pullDuration;
        vortex.colorTier = tier;
        vortex.critRate = critRate;
        vortex.critDamage = critDamage;
        vortex.hasExplosion = hasExplosion;
        vortex.explosionDamage = explosionDmg;
        vortex.explosionRadius = explosionRad;
        // Always activates instantly at the caster's position
        vortex.phase = "pull";
        vortex.x = x;
        vortex.y = y;
        const id = `vortex_${this.nextId++}_${Date.now()}`;
        this.state.vortexes.set(id, vortex);
        return true;
    }
}
