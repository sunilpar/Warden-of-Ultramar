/**
 * Dash System
 * ===========
 * Evasion skill: instantly moves the caster toward a target position (mouse),
 * granting brief invincibility during the dash. At L6+, an ice blast AoE
 * triggers at the landing position, dealing ice damage in a small radius.
 *
 * The dash is INSTANT (no travel time) — the caster is teleported to the
 * destination, made invincible for a brief window, and a VFX SkillCast is
 * spawned for the client to render the dash trail + emerge effect.
 *
 * WALL-AWARE DASH (clipping fix)
 * -------------------------------
 * The dash used to teleport the caster to the raw destination, straight
 * THROUGH walls — a confirmed clipping bug (you could dash out of the map
 * or through a wall and end up inside a solid tile). The destination is
 * now swept against the collision grid: the dash stops at the first
 * solid tile along the path, exactly like a swept-circle move.
 */
import { GAME_CONFIG } from "../config/game";
import { SkillCast } from "../schema/SkillCast";
import { applyCrit, dashRange, dashHasIceBlast, dashIceBlastDamage, dashIceBlastRadius, } from "../config/skillDefs";
/** Duration of invincibility after a dash (ms). Covers the dash + brief recovery. */
const DASH_INVINCIBLE_MS = 300;
export class DashSystem {
    constructor(state, mapSystem) {
        this.state = state;
        this.nextId = 1;
        /** Optional map system used to stop dashes at walls. */
        this.mapSystem = null;
        if (mapSystem)
            this.mapSystem = mapSystem;
    }
    /** Inject the map system (used when the dash system is created first
     *  and the map system afterwards). */
    setMapSystem(mapSystem) {
        this.mapSystem = mapSystem;
    }
    /**
     * Clamp a dash destination so it never ends up inside a wall.
     * Sweeps the straight line from the start to the raw destination and
     * stops at the first solid tile.
     */
    resolveDashDestination(startX, startY, rawX, rawY, radius) {
        if (!this.mapSystem) {
            return { x: rawX, y: rawY };
        }
        const coverage = this.mapSystem.sweepCoverage(startX, startY, rawX, rawY, radius);
        const x = startX + (rawX - startX) * coverage;
        const y = startY + (rawY - startY) * coverage;
        return {
            x: Math.max(0, Math.min(this.mapSystem.width, x)),
            y: Math.max(0, Math.min(this.mapSystem.height, y)),
        };
    }
    // ============================================================
    // PLAYER DASH
    // ============================================================
    /**
     * Cast dash for a player. Instantly moves the player toward the aim angle
     * by dashRange(level), grants invincibility, and spawns VFX.
     * At L6+, triggers ice blast at the landing position.
     * Returns true if the dash was applied.
     */
    castPlayerDash(player, sessionId, skillLevel, angle, critRate, critDamage) {
        if (skillLevel <= 0)
            return false;
        const range = dashRange(skillLevel);
        const now = Date.now();
        // Record start position for VFX trail
        const startX = player.x;
        const startY = player.y;
        // Calculate destination (clamped by range toward the aim angle)
        const rawX = player.x + Math.cos(angle) * range;
        const rawY = player.y + Math.sin(angle) * range;
        // Stop the dash at the first wall along the path (clipping fix).
        const dest = this.resolveDashDestination(player.x, player.y, rawX, rawY, GAME_CONFIG.PLAYER.COLLISION_RADIUS);
        const destX = dest.x;
        const destY = dest.y;
        // Move the player instantly
        player.x = destX;
        player.y = destY;
        // Grant invincibility
        player.invincibleUntil = now + DASH_INVINCIBLE_MS;
        // Spawn dash VFX (trail from start to dest)
        this.spawnDashVfx(startX, startY, destX, destY, skillLevel, angle, "player");
        // Ice blast at L6+
        if (dashHasIceBlast(skillLevel)) {
            this.doIceBlast(destX, destY, skillLevel, "player", sessionId, critRate, critDamage);
        }
        return true;
    }
    // ============================================================
    // ENEMY DASH
    // ============================================================
    /**
     * Cast dash for an enemy (AI usage). Same mechanics as player dash.
     * Enemies dash away from their target (evasion) or toward a random direction.
     */
    castEnemyDash(enemy, skillLevel = 1, angle, critRate = 0, critDamage = 1.5) {
        if (skillLevel <= 0)
            return false;
        const range = dashRange(skillLevel);
        const now = Date.now();
        const startX = enemy.x;
        const startY = enemy.y;
        const rawX = enemy.x + Math.cos(angle) * range;
        const rawY = enemy.y + Math.sin(angle) * range;
        // Stop the dash at the first wall along the path (clipping fix).
        const dest = this.resolveDashDestination(enemy.x, enemy.y, rawX, rawY, enemy.collisionRadius);
        const destX = dest.x;
        const destY = dest.y;
        enemy.x = destX;
        enemy.y = destY;
        enemy.invincibleUntil = now + DASH_INVINCIBLE_MS;
        this.spawnDashVfx(startX, startY, destX, destY, skillLevel, angle, "enemy");
        if (dashHasIceBlast(skillLevel)) {
            this.doIceBlastEnemy(destX, destY, skillLevel, critRate, critDamage);
        }
        return true;
    }
    // ============================================================
    // ICE BLAST (L6+)
    // ============================================================
    /**
     * Ice blast: small-radius AoE ice damage at the landing position.
     * Damages enemies (when cast by player) or players (when cast by enemy).
     */
    doIceBlast(x, y, skillLevel, faction, attackerId, critRate, critDamage) {
        const damage = dashIceBlastDamage(skillLevel);
        const radius = dashIceBlastRadius(skillLevel);
        if (damage <= 0 || radius <= 0)
            return;
        this.state.enemies.forEach((enemy) => {
            if (enemy.isDead)
                return;
            const dist = Math.hypot(enemy.x - x, enemy.y - y);
            if (dist <= radius) {
                const { damage: finalDamage, isCrit } = applyCrit(damage, critRate, critDamage);
                enemy.takeDamage(finalDamage, "dash", attackerId, isCrit);
            }
        });
        // Spawn ice blast VFX
        this.spawnIceBlastVfx(x, y, radius, skillLevel, faction);
    }
    /** Ice blast for enemy cast (damages players). */
    doIceBlastEnemy(x, y, skillLevel, critRate, critDamage) {
        const damage = dashIceBlastDamage(skillLevel);
        const radius = dashIceBlastRadius(skillLevel);
        if (damage <= 0 || radius <= 0)
            return;
        this.state.players.forEach((p) => {
            if (p.isDead)
                return;
            const dist = Math.hypot(p.x - x, p.y - y);
            if (dist <= radius) {
                const { damage: finalDamage, isCrit } = applyCrit(damage, critRate, critDamage);
                p.takeDamage(finalDamage, "dash", undefined, isCrit);
            }
        });
        this.spawnIceBlastVfx(x, y, radius, skillLevel, "enemy");
    }
    // ============================================================
    // VFX SPAWNING
    // ============================================================
    /** Spawn a dash trail VFX SkillCast (from start to end position). */
    spawnDashVfx(startX, startY, endX, endY, level, angle, faction) {
        const cast = new SkillCast();
        cast.skillId = "dash";
        cast.x = endX;
        cast.y = endY;
        cast.faction = faction;
        cast.level = level;
        cast.tier = level >= 6 ? "big" : "small";
        cast.angle = angle;
        cast.range = Math.hypot(endX - startX, endY - startY);
        // Store start position in the cast for the trail rendering
        cast.startX = startX;
        cast.startY = startY;
        const id = `dash_${this.nextId++}_${Date.now()}`;
        this.state.skillCasts.set(id, cast);
        setTimeout(() => {
            this.state.skillCasts.delete(id);
        }, 500);
    }
    /** Spawn an ice blast VFX SkillCast at the landing position. */
    spawnIceBlastVfx(x, y, radius, level, faction) {
        const cast = new SkillCast();
        cast.skillId = "dash_ice";
        cast.x = x;
        cast.y = y;
        cast.faction = faction;
        cast.level = level;
        cast.tier = level >= 6 ? "big" : "small";
        cast.angle = 0;
        cast.range = radius;
        const id = `dash_ice_${this.nextId++}_${Date.now()}`;
        this.state.skillCasts.set(id, cast);
        setTimeout(() => {
            this.state.skillCasts.delete(id);
        }, 600);
    }
}
