import { Enemy } from "../schema/Enemy";
import { GAME_CONFIG } from "../config/game";
export class EnemySystem {
    constructor(state, mapSystem) {
        this.state = state;
        this.mapSystem = mapSystem;
        this.projectileSystem = null;
        this.clawSystem = null;
        this.slamSystem = null;
        this.healSystem = null;
        this.dashSystem = null;
        this.shockSystem = null;
        this.vortexSystem = null;
        this.pulseSystem = null;
        /** Per-enemy next-allowed-skill-trigger timestamp (tau pacing). */
        this.nextSkillTriggerAt = new Map();
        /** Pending slam casts (delayed until after attack animation). */
        this.pendingSlams = [];
    }
    /** Inject the ProjectileSystem (called by the room after both are created). */
    setProjectileSystem(ps) {
        this.projectileSystem = ps;
    }
    /** Inject the ClawSystem (called by the room after both are created). */
    setClawSystem(cs) {
        this.clawSystem = cs;
    }
    /** Inject the SlamSystem (called by the room after both are created). */
    setSlamSystem(ss) {
        this.slamSystem = ss;
    }
    /** Inject the HealSystem (called by the room after both are created). */
    setHealSystem(hs) {
        this.healSystem = hs;
    }
    setDashSystem(ds) {
        this.dashSystem = ds;
    }
    /** Inject the ShockSystem (called by the room after both are created). */
    setShockSystem(ss) {
        this.shockSystem = ss;
    }
    /** Inject the VortexSystem (called by the room after both are created). */
    setVortexSystem(vs) {
        this.vortexSystem = vs;
    }
    /** Inject the PulseSystem (called by the room after both are created). */
    setPulseSystem(ps) {
        this.pulseSystem = ps;
    }
    update(dt) {
        // Process pending slam casts (delayed after attack animation).
        const now = Date.now();
        const ready = this.pendingSlams.filter((s) => s.castAt <= now);
        this.pendingSlams = this.pendingSlams.filter((s) => s.castAt > now);
        for (const s of ready) {
            if (this.slamSystem) {
                this.slamSystem.castSlam(s.ownerId, "enemy", s.x, s.y, s.angle, s.level, s.attack, s.damageMultiplier, s.critRate, s.critDamage);
            }
        }
        this.state.enemies.forEach((enemy) => {
            enemy.tickShield(dt);
            enemy.tickCooldowns(dt);
            enemy.tickBleed(dt);
            switch (enemy.typeId) {
                case "tyranid":
                    this.updateTyranid(enemy, dt);
                    break;
                case "orck":
                    this.updateOrck(enemy, dt);
                    break;
                case "tau":
                    this.updateTau(enemy, dt);
                    break;
                case "mechanicus":
                    this.updateMechanicus(enemy, dt);
                    break;
                case "caster":
                    this.updateCaster(enemy, dt);
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
        const isPaused = false; // hit-stun removed
        const target = this.findNearestPlayer(enemy);
        if (!target) {
            enemy.attacking = false;
            this.wander(enemy, _dt);
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
        // Use BASE claw range (lvl 1: 60px) as the effective attack range.
        const BASE_CLAW_RANGE = 60;
        const EFFECTIVE_RANGE = BASE_CLAW_RANGE;
        // Attack animation flag: only true if attackingUntil > now (reuse 'now' from above)
        enemy.attacking = now < enemy.attackingUntil;
        if (dist <= EFFECTIVE_RANGE) {
            // In range: stop moving, attempt to use skill.
            this.tryUseSkill(enemy, target);
        }
        else {
            // Out of range: move toward target, don't attempt skills.
            this.moveToward(enemy, target.x, target.y, _dt);
        }
    }
    // ============================================================
    // ORCK
    // ============================================================
    /** Orck: same melee chase AI as the tyranid. Finds the nearest player,
     *  moves toward them, and plays the attack animation when in range.
     *  Orcks unlock slam at level 1 and claw at level 5+ (see potentialSkills). */
    updateOrck(enemy, _dt) {
        const now = Date.now();
        const isPaused = false; // hit-stun removed
        const target = this.findNearestPlayer(enemy);
        if (!target) {
            enemy.attacking = false;
            this.wander(enemy, _dt);
            return;
        }
        enemy.facingRight = target.x > enemy.x;
        if (isPaused) {
            enemy.attacking = false;
            return;
        }
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ATTACK_RANGE = 100;
        enemy.attacking = now < enemy.attackingUntil;
        if (dist <= ATTACK_RANGE) {
            this.tryUseSkill(enemy, target);
        }
        else {
            this.moveToward(enemy, target.x, target.y, _dt);
        }
    }
    // ============================================================
    // TAU (ranged)
    // ============================================================
    /** Tau stop-range: holds position at ~300px and fires. */
    static { this.TAU_ATTACK_RANGE = 300; }
    /** Tau skill trigger interval: at most one skill attempt per second. */
    static { this.TAU_TRIGGER_INTERVAL_MS = 1000; }
    /** Tau AI: ranged unit. Advances until ~300px, holds position, and only
     *  fires when the target is in line of sight (raycast). Backs away when
     *  the player gets too close. */
    updateTau(enemy, _dt) {
        const now = Date.now();
        const target = this.findNearestPlayer(enemy);
        if (!target) {
            enemy.attacking = false;
            this.wander(enemy, _dt);
            return;
        }
        enemy.facingRight = target.x > enemy.x;
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        enemy.attacking = now < enemy.attackingUntil;
        // Too close: back away (ranged unit keeps distance).
        if (dist < 160) {
            const away = Math.atan2(-dy, -dx);
            this.moveToward(enemy, enemy.x + Math.cos(away) * 40, enemy.y + Math.sin(away) * 40, _dt);
            return;
        }
        if (dist <= EnemySystem.TAU_ATTACK_RANGE) {
            // In range — but ONLY attempt skills with line of sight.
            if (this.hasLineOfSight(enemy.x, enemy.y, target.x, target.y)) {
                this.tryUseTauSkill(enemy, target, now);
            }
        }
        else {
            // Out of range: advance toward target.
            this.moveToward(enemy, target.x, target.y, _dt);
        }
    }
    /**
     * Tau skill attempt with a fixed 1-second trigger interval (independent
     * of per-skill cooldowns — it throttles how often ANY skill fires).
     */
    tryUseTauSkill(enemy, target, now) {
        const id = enemy.__id;
        if (!id)
            return;
        const nextAt = this.nextSkillTriggerAt.get(id) ?? 0;
        if (now < nextAt)
            return;
        if (enemy.skillPool.length === 0)
            return;
        const skill = enemy.skillPool[Math.floor(Math.random() * enemy.skillPool.length)];
        if (!enemy.isSkillReady(skill))
            return;
        this.useSkill(enemy, skill, target);
        this.nextSkillTriggerAt.set(id, now + EnemySystem.TAU_TRIGGER_INTERVAL_MS);
    }
    /**
     * Cheap line-of-sight check: raymarch the segment enemy -> target against
     * the collision grid, sampling every ~16px. Returns true if unobstructed.
     */
    hasLineOfSight(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        if (dist < 1)
            return true;
        const stepSize = 16;
        const steps = Math.ceil(dist / stepSize);
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const px = x1 + dx * t;
            const py = y1 + dy * t;
            const res = this.mapSystem.resolveTileCollision(px, py, 2);
            if (Math.hypot(res.x - px, res.y - py) > 0.5)
                return false; // wall hit
        }
        return true;
    }
    // ============================================================
    // MECHANICUS (support caster: shock / heal / vortex)
    // ============================================================
    /** Mechanicus stop-range: matches the shock skill's base range (200px). */
    static { this.MECH_ATTACK_RANGE = 200; }
    /** Mechanicus skill trigger interval: at most one skill attempt per second. */
    static { this.MECH_TRIGGER_INTERVAL_MS = 1000; }
    /** Mechanicus AI: mid-range support caster. Advances until shock range,
     *  holds position, backs away when the player closes in, and cycles its
     *  skill pool (shock primary, heal secondary, vortex third) with line of
     *  sight. */
    updateMechanicus(enemy, _dt) {
        const now = Date.now();
        const target = this.findNearestPlayer(enemy);
        if (!target) {
            enemy.attacking = false;
            this.wander(enemy, _dt);
            return;
        }
        enemy.facingRight = target.x > enemy.x;
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        enemy.attacking = now < enemy.attackingUntil;
        // Too close: back away (ranged unit keeps distance).
        if (dist < 120) {
            const away = Math.atan2(-dy, -dx);
            this.moveToward(enemy, enemy.x + Math.cos(away) * 40, enemy.y + Math.sin(away) * 40, _dt);
            return;
        }
        if (dist <= EnemySystem.MECH_ATTACK_RANGE) {
            // In range — but ONLY attempt skills with line of sight.
            if (this.hasLineOfSight(enemy.x, enemy.y, target.x, target.y)) {
                this.tryUseMechanicusSkill(enemy, target, now);
            }
        }
        else {
            // Out of range: advance toward target.
            this.moveToward(enemy, target.x, target.y, _dt);
        }
    }
    /**
     * Mechanicus skill attempt with a fixed 1-second trigger interval
     * (reuses the tau-style random-pick + throttle pacing).
     */
    tryUseMechanicusSkill(enemy, target, now) {
        const id = enemy.__id;
        if (!id)
            return;
        const nextAt = this.nextSkillTriggerAt.get(id) ?? 0;
        if (now < nextAt)
            return;
        if (enemy.skillPool.length === 0)
            return;
        const skill = enemy.skillPool[Math.floor(Math.random() * enemy.skillPool.length)];
        if (!enemy.isSkillReady(skill))
            return;
        this.useSkill(enemy, skill, target);
        this.nextSkillTriggerAt.set(id, now + EnemySystem.MECH_TRIGGER_INTERVAL_MS);
    }
    // ============================================================
    // CASTER (close-combat caster: vortex / heal / pulse)
    // ============================================================
    /** Caster close-combat skill range. */
    static { this.CASTER_ATTACK_RANGE = 100; }
    /** Within this radius of the target the caster surges +30% speed. */
    static { this.CASTER_SURGE_RADIUS = 200; }
    /** Speed multiplier applied while inside the surge radius. */
    static { this.CASTER_SURGE_MULT = 1.3; }
    /** Caster skill trigger interval: at most one skill attempt per second. */
    static { this.CASTER_TRIGGER_INTERVAL_MS = 1000; }
    /**
     * Caster AI: close-combat caster. Chases like a tyranid; once the target
     * is within 200px it surges +30% move speed and closes to melee range to
     * unleash vortex/pulse. Heals itself (or allies) via its skill pool.
     */
    updateCaster(enemy, _dt) {
        const now = Date.now();
        const target = this.findNearestPlayer(enemy);
        if (!target) {
            enemy.attacking = false;
            enemy.speedMultiplier = 1; // no surge while wandering
            this.wander(enemy, _dt);
            return;
        }
        enemy.facingRight = target.x > enemy.x;
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        enemy.attacking = now < enemy.attackingUntil;
        // Surge: +30% move speed while the target is within 200px.
        enemy.speedMultiplier =
            dist <= EnemySystem.CASTER_SURGE_RADIUS
                ? EnemySystem.CASTER_SURGE_MULT
                : 1;
        if (dist <= EnemySystem.CASTER_ATTACK_RANGE) {
            this.tryUseCasterSkill(enemy, target, now);
        }
        else {
            // Out of range: charge toward the target (with surge if close).
            this.moveToward(enemy, target.x, target.y, _dt);
        }
    }
    /**
     * Caster skill attempt with a fixed 1-second trigger interval
     * (reuses the tau/mechanicus random-pick + throttle pacing).
     */
    tryUseCasterSkill(enemy, target, now) {
        const id = enemy.__id;
        if (!id)
            return;
        const nextAt = this.nextSkillTriggerAt.get(id) ?? 0;
        if (now < nextAt)
            return;
        if (enemy.skillPool.length === 0)
            return;
        const skill = enemy.skillPool[Math.floor(Math.random() * enemy.skillPool.length)];
        if (!enemy.isSkillReady(skill))
            return;
        this.useSkill(enemy, skill, target);
        this.nextSkillTriggerAt.set(id, now + EnemySystem.CASTER_TRIGGER_INTERVAL_MS);
    }
    // ============================================================
    // SHARED AI HELPERS
    // ============================================================
    /** Find the nearest alive player within the enemy's aggro radius.
     *  Returns null if no player is close enough (enemy will wander). */
    findNearestPlayer(enemy) {
        let nearest = null;
        let nearestDistSq = Infinity;
        const aggroSq = enemy.aggroRadius * enemy.aggroRadius;
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
        // Only hunt if the nearest player is inside the aggro radius.
        if (nearest && nearestDistSq > aggroSq)
            return null;
        return nearest;
    }
    /**
     * Wander behavior for when no player is in aggro range: pick a random
     * nearby point (up to ~150px away) and walk toward it for a random
     * 1-3 second duration. Keeps idle enemies from looking frozen.
     */
    wander(enemy, dt) {
        const now = Date.now();
        if (now >= enemy.wanderUntil) {
            // Choose a new random wander target + duration.
            const angle = Math.random() * Math.PI * 2;
            const dist = 50 + Math.random() * 100; // 50-150px
            enemy.wanderX = enemy.x + Math.cos(angle) * dist;
            enemy.wanderY = enemy.y + Math.sin(angle) * dist;
            enemy.wanderUntil = now + 1000 + Math.random() * 2000; // 1-3s
        }
        // Face the wander direction (uses same "facingRight" convention).
        enemy.facingRight = enemy.wanderX > enemy.x;
        this.moveToward(enemy, enemy.wanderX, enemy.wanderY, dt);
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
        // Loot card mods: only apply when casting the card's own skill.
        const cardCrit = enemy.critRate + enemy.cardCritRateBonus(skill);
        const cardCritDmg = enemy.critDamage + enemy.cardCritDamageBonus(skill);
        const cardDmgMult = enemy.cardDamageBonus(skill) * enemy.cardUniqueDamageMult(skill);
        const cardRadiusMult = enemy.cardRadiusMult(skill);
        // Trigger attack animation EVERY time a skill is used.
        // Keep the flag true for 350ms (one full attack animation cycle).
        const now = Date.now();
        const atkDur = enemy.typeId === "orck"
            ? 500
            : enemy.typeId === "tau"
                ? 400
                : enemy.typeId === "mechanicus"
                    ? 400
                    : enemy.typeId === "caster"
                        ? 500
                        : 350;
        enemy.attackingUntil = now + atkDur;
        enemy.attacking = true;
        if (skill === "bolter" && this.projectileSystem) {
            this.projectileSystem.castBolter(this.enemyOwnerId(enemy), "enemy", enemy.x, enemy.y, angle, enemy.attack, this.enemySkillLevel(enemy, skill), enemy.damageMultiplier * cardDmgMult, cardCrit, cardCritDmg);
        }
        else if (skill === "claw" && this.clawSystem) {
            this.clawSystem.castClaw(this.enemyOwnerId(enemy), "enemy", enemy.x, enemy.y, angle, enemy.attack, this.enemySkillLevel(enemy, skill), enemy.damageMultiplier * cardDmgMult, enemy.collisionRadius, cardCrit, cardCritDmg);
        }
        else if (skill === "slam" && this.slamSystem) {
            // Delay the slam hitbox until after the attack animation completes.
            // Orck attack anim = 5 frames @ 10fps = 500ms; add small extra delay.
            this.pendingSlams.push({
                ownerId: this.enemyOwnerId(enemy),
                x: enemy.x,
                y: enemy.y,
                angle,
                level: this.enemySkillLevel(enemy, skill),
                castAt: now + 500,
                attack: enemy.attack,
                damageMultiplier: enemy.damageMultiplier * cardDmgMult,
                critRate: cardCrit,
                critDamage: cardCritDmg,
            });
        }
        else if (skill === "heal" && this.healSystem) {
            this.healSystem.castEnemyHeal(enemy, this.enemySkillLevel(enemy, skill));
        }
        else if (skill === "shock" && this.shockSystem) {
            this.shockSystem.castEnemyShock(enemy, this.enemySkillLevel(enemy, skill), cardCrit, cardCritDmg, angle);
        }
        else if (skill === "dash" && this.dashSystem) {
            // Enemy dashes AWAY from the target (evasion). Add some randomness.
            const escapeAngle = angle + Math.PI + (Math.random() - 0.5) * 0.8;
            this.dashSystem.castEnemyDash(enemy, this.enemySkillLevel(enemy, skill), escapeAngle, cardCrit, cardCritDmg);
        }
        else if (skill === "vortex" && this.vortexSystem) {
            this.vortexSystem.castVortex(this.enemyOwnerId(enemy), "enemy", enemy.x, enemy.y, angle, this.enemySkillLevel(enemy, skill), enemy.attack, enemy.damageMultiplier, cardCrit, cardCritDmg, cardRadiusMult, cardDmgMult);
        }
        else if (skill === "shield") {
            // Self-buff: instantly restore the shield to full capacity.
            if (enemy.maxShield > 0 && enemy.shield < enemy.maxShield) {
                enemy.shield = enemy.maxShield;
                enemy.shieldRechargeAt = 0;
            }
        }
        else if (skill === "pulse" && this.pulseSystem) {
            this.pulseSystem.castEnemyPulse(enemy, this.enemySkillLevel(enemy, skill), cardCrit, cardCritDmg, cardRadiusMult, cardDmgMult);
        }
        enemy.startCooldown(skill);
    }
    /** Derive a stable owner id for an enemy. */
    enemyOwnerId(enemy) {
        return enemy.__id ?? `enemy_${enemy.typeId}`;
    }
    /** Enemy skill level — read from the per-enemy skillLevels map (1 if unset). */
    enemySkillLevel(enemy, skill) {
        return enemy.skillLevels.get(skill) ?? 1;
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
    /**
     * Clean up all skill entities (slams, pending casts) owned by a
     * dead enemy so they despawn immediately when the caster dies.
     */
    cleanupOnEnemyDeath(ownerId) {
        this.nextSkillTriggerAt.delete(ownerId);
        // Cancel any pending slam casts that haven't fired yet.
        this.pendingSlams = this.pendingSlams.filter((s) => s.ownerId !== ownerId);
        // Remove in-flight slams owned by this enemy.
        const slamIds = [];
        this.state.slams.forEach((slam, sid) => {
            if (slam.ownerId === ownerId)
                slamIds.push(sid);
        });
        for (const sid of slamIds)
            this.state.slams.delete(sid);
        // Remove in-flight projectiles owned by this enemy.
        const projIds = [];
        this.state.projectiles.forEach((proj, pid) => {
            if (proj.ownerId === ownerId)
                projIds.push(pid);
        });
        for (const pid of projIds)
            this.state.projectiles.delete(pid);
    }
}
