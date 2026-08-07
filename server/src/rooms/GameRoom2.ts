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
 */

import { Room, Client } from "colyseus";
import { RoomState } from "../schema/RoomState";
import { Player, InputData } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { MapSystem2 } from "../systems/MapSystem2";
import { PlayerSystem } from "../systems/PlayerSystem";
import { EnemySystem } from "../systems/EnemySystem";
import { ProjectileSystem } from "../systems/ProjectileSystem";
import { LAYERED_MAP_2 } from "../config/layeredMap2";
import { SKILL_DEFS, MAX_SKILL_LEVEL, type SkillId } from "../config/skillDefs";

export class GameRoom2 extends Room {
  state = new RoomState();
  fixedTimeStep = GAME_CONFIG.FIXED_TIME_STEP_MS;

  private mapSystem!: MapSystem2;
  private playerSystem!: PlayerSystem;
  private enemySystem!: EnemySystem;
  private projectileSystem!: ProjectileSystem;

  onCreate(_options: any) {
    this.mapSystem = new MapSystem2();
    this.playerSystem = new PlayerSystem(this.state, this.mapSystem as any);
    this.enemySystem = new EnemySystem(this.state, this.mapSystem);
    this.projectileSystem = new ProjectileSystem(this.state, this.mapSystem as any);
    // Cross-link: enemies can fire projectiles.
    this.enemySystem.setProjectileSystem(this.projectileSystem);

    // Spawn one Tyranid for now (from the first enemy spawn zone).
    this.spawnInitialEnemy();

    // Fixed timestep simulation loop
    let elapsedTime = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;
      while (elapsedTime >= this.fixedTimeStep) {
        elapsedTime -= this.fixedTimeStep;
        this.fixedTick(this.fixedTimeStep);
      }
    });

    console.log(
      "GameRoom2 created with Map2",
      `${LAYERED_MAP_2.cols}x${LAYERED_MAP_2.rows} tiles`,
    );
  }

  //core cycle
  fixedTick(timeStepMs: number) {
    const dt = timeStepMs / 1000;
    this.playerSystem.update(dt);
    this.enemySystem.update(dt);
    this.projectileSystem.update(dt);
    // Tick player skill cooldowns
    this.state.players.forEach((p) => p.tickSkillCooldowns(dt));
    // Clean up dead enemies
    this.cleanupDeadEnemies();
  }

  /** Spawn a single Tyranid at the center of the first enemy spawn zone. */
  private spawnInitialEnemy(): void {
    const zones = LAYERED_MAP_2.enemySpawnZones;
    if (zones.length === 0) return;
    const z = zones[0];
    this.enemySystem.spawn(
      "tyranid",
      z.x + z.width / 2,
      z.y + z.height / 2,
      GAME_CONFIG.ENEMY.DEFAULT_LEVEL,
    );
  }

  /** Remove dead enemies from state. */
  private cleanupDeadEnemies(): void {
    const dead: string[] = [];
    this.state.enemies.forEach((enemy, id) => {
      if (enemy.isDead) dead.push(id);
    });
    for (const id of dead) this.state.enemies.delete(id);
  }

  // ============================================================
  // MESSAGE HANDLERS
  // ============================================================

  messages = {
    // Movement input
    0: (client: Client, input: InputData) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.inputQueue.push(input);
    },

    // Cast a skill (player -> server). { skill, angle }
    1: (client: Client, msg: { skill: SkillId; angle: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      const skill = msg.skill;
      const level = player.getSkillLevel(skill);
      if (level <= 0) return; // skill not owned
      if (!player.isSkillReady(skill)) return; // on cooldown

      if (skill === "bolter") {
        const fired = this.projectileSystem.castBolter(
          client.sessionId,
          "player",
          player.x,
          player.y,
          msg.angle,
          player.attack,
          level,
          player.damageMultiplier,
        );
        if (fired) {
          player.startSkillCooldown(skill, SKILL_DEFS.bolter.cooldown);
        }
      }
      // TODO: other skills wired up later.
    },

    // Upgrade a skill (debug "0" key). { skill }
    2: (client: Client, msg: { skill: SkillId }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const skill = msg.skill;
      const cur = player.getSkillLevel(skill);
      if (cur <= 0) {
        // Learn it at level 1 if not owned
        player.setSkillLevel(skill, 1);
      } else if (cur < MAX_SKILL_LEVEL) {
        player.upgradeSkill(skill);
      }
    },
  };

  // ============================================================
  // CONNECTION LIFECYCLE
  // ============================================================

  onJoin(client: Client, _options: any) {
    console.log("Player joined GameRoom2:", client.sessionId);

    const player = new Player();
    player.initBaseStats();
    // Give the joining player the bolter at level 1 (slot 1 default).
    player.setSkillLevel("bolter", 1);
    const spawn = this.mapSystem.getSpawnPoint();
    player.x = spawn.x;
    player.y = spawn.y;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, _code: number) {
    console.log("Player left GameRoom2:", client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("GameRoom2 disposed:", this.roomId);
  }
}
