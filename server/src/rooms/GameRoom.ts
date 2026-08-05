/**
 * Game Room
 * =========
 * The authoritative server room. Handles:
 *   - Player join/leave
 *   - Receiving movement input (message type 0)
 *   - Fixed timestep simulation (60 ticks/sec)
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
import { LAYERED_MAP } from "../config/layeredMap";

export class GameRoom extends Room {
  state = new RoomState();
  fixedTimeStep = GAME_CONFIG.FIXED_TIME_STEP_MS;

  private mapSystem!: MapSystem;
  private playerSystem!: PlayerSystem;

  onCreate(_options: any) {
    this.mapSystem = new MapSystem();
    this.playerSystem = new PlayerSystem(this.state, this.mapSystem);

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

  fixedTick(timeStepMs: number) {
    const dt = timeStepMs / 1000;
    this.playerSystem.update(dt);
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
