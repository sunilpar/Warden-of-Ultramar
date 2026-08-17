import { ShockCast } from "../schema/ShockCast";
import { applyCrit, shockDamage, shockRange, shockTargets, shockChains, shockChainRadius, SHOCK, } from "../config/skillDefs";
const SEGMENT_TTL_MS = 1200;
export class ShockSystem {
    constructor(state, mapSystem = null) {
        this.state = state;
        this.mapSystem = mapSystem;
        this.nextId = 1;
    }
    /**
     * Raymarch along the line and return how far the lightning can travel
     * before hitting a wall. Returns a value from 0..1 where 1 = full distance.
     */
    raycastCoverage(x1, y1, x2, y2) {
        if (!this.mapSystem)
            return 1; // no collision system = allow all
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        if (dist < 1)
            return 1;
        const stepSize = 6; // check every 6px for accuracy
        const steps = Math.ceil(dist / stepSize);
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const px = x1 + dx * t;
            const py = y1 + dy * t;
            const res = this.mapSystem.resolveTileCollision(px, py, 2);
            if (Math.hypot(res.x - px, res.y - py) > 0.5) {
                // Wall hit — return how far we got
                return (i - 1) / steps;
            }
        }
        return 1; // full distance, no wall
    }
    castPlayerShock(player, sessionId, skillLevel, critRate, critDamage, aimAngle) {
        if (skillLevel <= 0)
            return false;
        const dmg = shockDamage(skillLevel);
        const range = shockRange(skillLevel);
        const maxTargets = shockTargets(skillLevel);
        const maxChains = shockChains(skillLevel);
        const chainRadius = shockChainRadius(skillLevel);
        const halfAngle = SHOCK.coneHalfAngle;
        const inCone = this.findEnemiesInCone(player.x, player.y, aimAngle, range, halfAngle);
        const targets = inCone.slice(0, maxTargets);
        // If no enemies found, still show VFX traveling to the edge of the cone
        if (targets.length === 0) {
            const edgeX = player.x + Math.cos(aimAngle) * range;
            const edgeY = player.y + Math.sin(aimAngle) * range;
            this.spawnShockVfx(player.x, player.y, skillLevel, "player", [{ x1: player.x, y1: player.y, x2: edgeX, y2: edgeY, delay: 0 }], aimAngle);
            return false;
        }
        const segments = [];
        const hitSet = new Set();
        let delay = 0;
        for (const enemy of targets) {
            const { damage: finalDamage, isCrit } = applyCrit(dmg, critRate, critDamage);
            enemy.takeDamage(finalDamage, "shock", sessionId, isCrit);
            hitSet.add(enemy);
            segments.push({
                x1: player.x,
                y1: player.y,
                x2: enemy.x,
                y2: enemy.y,
                delay,
            });
            delay += 80;
        }
        if (maxChains > 0) {
            let currentSources = targets;
            let chainDamageMul = SHOCK.chainDamageFalloff;
            for (let chain = 0; chain < maxChains; chain++) {
                const nextTargets = [];
                for (const source of currentSources) {
                    const nearby = this.findNearestEnemies(source.x, source.y, chainRadius, hitSet);
                    if (nearby.length > 0) {
                        const ct = nearby[0];
                        const chainDmg = dmg * chainDamageMul;
                        const { damage: finalDamage, isCrit } = applyCrit(chainDmg, critRate, critDamage);
                        ct.takeDamage(finalDamage, "shock", sessionId, isCrit);
                        hitSet.add(ct);
                        nextTargets.push(ct);
                        segments.push({
                            x1: source.x,
                            y1: source.y,
                            x2: ct.x,
                            y2: ct.y,
                            delay,
                        });
                        delay += 60;
                    }
                }
                currentSources = nextTargets;
                chainDamageMul *= SHOCK.chainDamageFalloff;
                if (currentSources.length === 0)
                    break;
            }
        }
        this.spawnShockVfx(player.x, player.y, skillLevel, "player", segments, aimAngle);
        return true;
    }
    castEnemyShock(enemy, skillLevel = 1, critRate = 0, critDamage = 1.5, aimAngle = 0) {
        const dmg = shockDamage(skillLevel);
        const range = shockRange(skillLevel);
        const maxTargets = shockTargets(skillLevel);
        const halfAngle = SHOCK.coneHalfAngle;
        const inCone = this.findPlayersInCone(enemy.x, enemy.y, aimAngle, range, halfAngle);
        const targets = inCone.slice(0, maxTargets);
        if (targets.length === 0)
            return false;
        const segments = [];
        let delay = 0;
        for (const p of targets) {
            const { damage: finalDamage, isCrit } = applyCrit(dmg, critRate, critDamage);
            p.takeDamage(finalDamage, "shock", undefined, isCrit);
            segments.push({ x1: enemy.x, y1: enemy.y, x2: p.x, y2: p.y, delay });
            delay += 80;
        }
        this.spawnShockVfx(enemy.x, enemy.y, skillLevel, "enemy", segments, aimAngle);
        return true;
    }
    findEnemiesInCone(cx, cy, aimAngle, range, halfAngle) {
        const results = [];
        this.state.enemies.forEach((enemy) => {
            if (enemy.isDead)
                return;
            const dx = enemy.x - cx;
            const dy = enemy.y - cy;
            const dist = Math.hypot(dx, dy);
            if (dist > range)
                return;
            const angle = Math.atan2(dy, dx);
            let diff = Math.abs(angle - aimAngle);
            if (diff > Math.PI)
                diff = 2 * Math.PI - diff;
            if (diff <= halfAngle) {
                // Wall check: must have line of sight to the enemy
                if (this.raycastCoverage(cx, cy, enemy.x, enemy.y) < 1)
                    return;
                results.push({ enemy, dist });
            }
        });
        results.sort((a, b) => a.dist - b.dist);
        return results.map((r) => r.enemy);
    }
    findPlayersInCone(cx, cy, aimAngle, range, halfAngle) {
        const results = [];
        this.state.players.forEach((p) => {
            if (p.isDead)
                return;
            const dx = p.x - cx;
            const dy = p.y - cy;
            const dist = Math.hypot(dx, dy);
            if (dist > range)
                return;
            const angle = Math.atan2(dy, dx);
            let diff = Math.abs(angle - aimAngle);
            if (diff > Math.PI)
                diff = 2 * Math.PI - diff;
            if (diff <= halfAngle) {
                if (this.raycastCoverage(cx, cy, p.x, p.y) < 1)
                    return;
                results.push({ player: p, dist });
            }
        });
        results.sort((a, b) => a.dist - b.dist);
        return results.map((r) => r.player);
    }
    findNearestEnemies(cx, cy, radius, hitSet) {
        const results = [];
        this.state.enemies.forEach((enemy) => {
            if (enemy.isDead)
                return;
            if (hitSet.has(enemy))
                return;
            const dist = Math.hypot(enemy.x - cx, enemy.y - cy);
            if (dist <= radius) {
                // Wall check for chains too
                if (this.raycastCoverage(cx, cy, enemy.x, enemy.y) < 1)
                    return;
                results.push({ enemy, dist });
            }
        });
        results.sort((a, b) => a.dist - b.dist);
        return results.map((r) => r.enemy);
    }
    /** Spawn a shock VFX with segments encoded as a flat string. */
    spawnShockVfx(x, y, level, faction, segments, aimAngle) {
        // Clip each segment to the wall hit point so the VFX stops at walls
        const clipped = segments.map((s) => {
            const coverage = this.raycastCoverage(s.x1, s.y1, s.x2, s.y2);
            return {
                x1: s.x1,
                y1: s.y1,
                x2: s.x1 + (s.x2 - s.x1) * coverage,
                y2: s.y1 + (s.y2 - s.y1) * coverage,
                delay: s.delay,
            };
        });
        const segStr = clipped
            .map((s) => `${Math.round(s.x1)},${Math.round(s.y1)},${Math.round(s.x2)},${Math.round(s.y2)},${s.delay}`)
            .join(";");
        const cast = new ShockCast();
        cast.x = x;
        cast.y = y;
        cast.level = level;
        cast.faction = faction;
        cast.aimAngle = aimAngle;
        cast.segments = segStr;
        const id = `shock_${this.nextId++}_${Date.now()}`;
        this.state.shockCasts.set(id, cast);
        setTimeout(() => {
            this.state.shockCasts.delete(id);
        }, SEGMENT_TTL_MS);
    }
}
