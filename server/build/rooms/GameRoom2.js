/**
 * Game Room
 * =========
 * The authoritative server room. Handles:
 *   - Player join/leave
 *   - Movement input (message type 0)
 *   - Skill cast (message type 1)
 *   - Skill upgrade (message type 2)
 *   - Fixed timestep simulation (60 ticks/sec)
 *   - Enemy AI + projectile simulation
 *
 * MESSAGE TYPES:
 *   0: Movement input { left, right, up, down, tick }
 *   1: Cast skill     { skill: SkillId, angle: number }
 *   2: Upgrade skill  { skill: SkillId }
 *   3: Viewport rect   { x, y, w, h } (camera world view)
 */
import { Room } from "colyseus";
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { MapSystem2 } from "../systems/MapSystem2";
import { PlayerSystem } from "../systems/PlayerSystem";
import { EnemySystem } from "../systems/EnemySystem";
import { ProjectileSystem } from "../systems/ProjectileSystem";
import { ClawSystem } from "../systems/ClawSystem";
import { LAYERED_MAP_2 } from "../config/layeredMap2";
import { SKILL_DEFS, MAX_SKILL_LEVEL } from "../config/skillDefs";
export class GameRoom2 extends Room {
    constructor() {
        super(...arguments);
        this.state = new RoomState();
        this.fixedTimeStep = GAME_CONFIG.FIXED_TIME_STEP_MS;
        this.spawnedZones = new Set();
        this.viewports = new Map();
        // ============================================================
        // MESSAGE HANDLERS
        // ============================================================
        this.messages = {
            // Movement input
            0: (client, input) => {
                const player = this.state.players.get(client.sessionId);
                if (player)
                    player.inputQueue.push(input);
            },
            // Cast a skill (player -> server). { skill, angle }
            1: (client, msg) => {
                const player = this.state.players.get(client.sessionId);
                if (!player || player.isDead)
                    return;
                const skill = msg.skill;
                const level = player.getSkillLevel(skill);
                if (level <= 0)
                    return; // skill not owned
                if (!player.isSkillReady(skill))
                    return; // on cooldown
                if (skill === "bolter") {
                    const fired = this.projectileSystem.castBolter(client.sessionId, "player", player.x, player.y, msg.angle, player.attack, level, player.damageMultiplier);
                    if (fired) {
                        player.startSkillCooldown(skill, SKILL_DEFS.bolter.cooldown);
                    }
                }
                else if (skill === "claw") {
                    this.clawSystem.castClaw(client.sessionId, "player", player.x, player.y, msg.angle, player.attack, level, player.damageMultiplier);
                    player.startSkillCooldown(skill, SKILL_DEFS.claw.cooldown);
                }
            },
            // Upgrade a skill (debug "0" key). { skill }
            2: (client, msg) => {
                const player = this.state.players.get(client.sessionId);
                if (!player)
                    return;
                const skill = msg.skill;
                const cur = player.getSkillLevel(skill);
                if (cur <= 0) {
                    // Learn it at level 1 if not owned
                    player.setSkillLevel(skill, 1);
                }
                else if (cur < MAX_SKILL_LEVEL) {
                    player.upgradeSkill(skill);
                }
            },
            // Viewport rect { x, y, w, h } — the client's camera world view.
            3: (client, msg) => {
                this.viewports.set(client.sessionId, msg);
            },
        };
    }
    onCreate(_options) {
        this.mapSystem = new MapSystem2();
        this.playerSystem = new PlayerSystem(this.state, this.mapSystem);
        this.enemySystem = new EnemySystem(this.state, this.mapSystem);
        this.projectileSystem = new ProjectileSystem(this.state, this.mapSystem);
        this.clawSystem = new ClawSystem(this.state);
        // Cross-link: enemies can fire projectiles + claws.
        this.enemySystem.setProjectileSystem(this.projectileSystem);
        this.enemySystem.setClawSystem(this.clawSystem);
        // Fixed timestep simulation loop
        let elapsedTime = 0;
        this.setSimulationInterval((deltaTime) => {
            elapsedTime += deltaTime;
            while (elapsedTime >= this.fixedTimeStep) {
                elapsedTime -= this.fixedTimeStep;
                this.fixedTick(this.fixedTimeStep);
            }
        });
        console.log("GameRoom2 created with Map2", `${LAYERED_MAP_2.cols}x${LAYERED_MAP_2.rows} tiles`);
    }
    //core cycle
    fixedTick(timeStepMs) {
        const dt = timeStepMs / 1000;
        this.playerSystem.update(dt);
        this.enemySystem.update(dt);
        this.projectileSystem.update(dt);
        this.clawSystem.update(dt);
        // Tick player skill cooldowns + bleed DoT
        this.state.players.forEach((p) => {
            p.tickSkillCooldowns(dt);
            p.tickBleed(dt);
        });
        // Clean up dead enemies
        this.cleanupDeadEnemies();
        // Viewport-activated spawning
        this.checkSpawnZones();
    }
    /**
     * Spawn one enemy at the center of each spawn zone the FIRST time any
     * player's viewport touches it. Each zone spawns exactly once.
     */
    checkSpawnZones() {
        const zones = LAYERED_MAP_2.enemySpawnZones;
        if (zones.length === 0 || this.viewports.size === 0)
            return;
        for (let i = 0; i < zones.length; i++) {
            if (this.spawnedZones.has(i))
                continue;
            const z = zones[i];
            let touched = false;
            for (const vp of this.viewports.values()) {
                if (vp.x < z.x + z.width &&
                    vp.x + vp.w > z.x &&
                    vp.y < z.y + z.height &&
                    vp.y + vp.h > z.y) {
                    touched = true;
                    break;
                }
            }
            if (touched) {
                this.enemySystem.spawn("tyranid", z.x + z.width / 2, z.y + z.height / 2, GAME_CONFIG.ENEMY.DEFAULT_LEVEL);
                this.spawnedZones.add(i);
            }
        }
    }
    /** Remove dead enemies from state. */
    cleanupDeadEnemies() {
        const dead = [];
        this.state.enemies.forEach((enemy, id) => {
            if (enemy.isDead)
                dead.push(id);
        });
        for (const id of dead)
            this.state.enemies.delete(id);
    }
    // ============================================================
    // CONNECTION LIFECYCLE
    // ============================================================
    onJoin(client, _options) {
        console.log("Player joined GameRoom2:", client.sessionId);
        const player = new Player();
        player.initBaseStats();
        // Give the joining player the bolter at level 1 (slot 1 default).
        player.setSkillLevel("bolter", 1);
        player.setSkillLevel("claw", 1);
        const spawn = this.mapSystem.getSpawnPoint();
        player.x = spawn.x;
        player.y = spawn.y;
        this.state.players.set(client.sessionId, player);
    }
    onLeave(client, _code) {
        console.log("Player left GameRoom2:", client.sessionId);
        this.state.players.delete(client.sessionId);
        this.viewports.delete(client.sessionId);
    }
    onDispose() {
        console.log("GameRoom2 disposed:", this.roomId);
    }
}
