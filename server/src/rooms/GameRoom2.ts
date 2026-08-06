/**
 * Game Room 2 (Map2)
 * ==================
 * Same as GameRoom but uses the Map2 layered map for authoritative
 * collision and spawn. Registered as "game_room_2".
 */
import { Room, Client } from "colyseus";
import { RoomState } from "../schema/RoomState";
import { Player, InputData } from "../schema/Player";
import { GAME_CONFIG } from "../config/game";
import { MapSystem2 } from "../systems/MapSystem2";
import { PlayerSystem } from "../systems/PlayerSystem";
import { EnemySystem } from "../systems/EnemySystem";
import { LAYERED_MAP_2 } from "../config/layeredMap2";

export class GameRoom2 extends Room {
  state = new RoomState();
  fixedTimeStep = GAME_CONFIG.FIXED_TIME_STEP_MS;

  private mapSystem!: MapSystem2;
  private playerSystem!: PlayerSystem;
  private enemySystem!: EnemySystem;

  onCreate(_options: any) {
    this.mapSystem = new MapSystem2();
    this.playerSystem = new PlayerSystem(this.state, this.mapSystem as any);
    this.enemySystem = new EnemySystem(this.state, this.mapSystem as any);

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

    console.log("GameRoom2 created with Map2");
  }

  fixedTick(timeStepMs: number) {
    const dt = timeStepMs / 1000;
    this.playerSystem.update(dt);
    this.enemySystem.update(dt);
  }

  /** Spawn a single Tyranid at the center of the first enemy spawn zone. */
  private spawnInitialEnemy(): void {
    const zones = LAYERED_MAP_2.enemySpawnZones;
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

  messages = {
    0: (client: Client, input: InputData) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.inputQueue.push(input);
    },
  };

  onJoin(client: Client, _options: any) {
    console.log("Player joined GameRoom2:", client.sessionId);
    const player = new Player();
    player.initBaseStats();
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
