/**
 * Game Room
 * =========
 * The authoritative server room. Handles:
 *   - Player join/leave
 *   - Receiving movement input (message type 0)
 *   - Fixed timestep simulation (60 ticks/sec)
 *   - Enemy AI update
 *
 * MESSAGE TYPES:
 *   0: Movement input { left, right, up, down, tick }
 */

import { Room, Client } from "colyseus";
import { RoomState } from "../schema/RoomState";
import { Player, InputData } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { MapSystem } from "../systems/MapSystem";
import { PlayerSystem } from "../systems/PlayerSystem";
import { EnemySystem } from "../systems/EnemySystem";
import { LAYERED_MAP } from "../config/layeredMap";

export class GameRoom extends Room {
  state = new RoomState();
  fixedTimeStep = GAME_CONFIG.FIXED_TIME_STEP_MS;

  private mapSystem!: MapSystem;
  private playerSystem!: PlayerSystem;
  private enemySystem!: EnemySystem;

  onCreate(_options: any) {
    this.mapSystem = new MapSystem();
    this.playerSystem = new PlayerSystem(this.state, this.mapSystem);
    this.enemySystem = new EnemySystem(this.state, this.mapSystem);

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
      "GameRoom created with layered map:",
      `${LAYERED_MAP.cols}x${LAYERED_MAP.rows} tiles`,
    );
  }

  //core cycle
  fixedTick(timeStepMs: number) {
    const dt = timeStepMs / 1000;
    this.playerSystem.update(dt);
    this.enemySystem.update(dt);
  }

  /** Spawn a single Tyranid at the center of the first enemy spawn zone. */
  private spawnInitialEnemy(): void {
    const zones = LAYERED_MAP.enemySpawnZones;
    if (zones.length === 0) return;
    const z = zones[0];
    const x = z.x + z.width / 2;
    const y = z.y + z.height / 2;
    this.enemySystem.spawn(
      "tyranid",
      x,
      y,
      GAME_CONFIG.ENEMY.DEFAULT_LEVEL,
    );
  }

  // ============================================================
  // MESSAGE HANDLERS
  // ============================================================

  messages = {
    0: (client: Client, input: InputData) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.inputQueue.push(input);
    },
  };

  // ============================================================
  // CONNECTION LIFECYCLE
  // ============================================================

  onJoin(client: Client, _options: any) {
    console.log("Player joined:", client.sessionId);

    const player = new Player();
    player.initBaseStats();
    const spawn = this.mapSystem.getSpawnPoint();
    player.x = spawn.x;
    player.y = spawn.y;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, _code: number) {
    console.log("Player left:", client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("GameRoom disposed:", this.roomId);
  }
}
