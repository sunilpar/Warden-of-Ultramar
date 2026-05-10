import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

export interface InputData {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  tick?: number;
}

export class Player extends Schema {
  @type("number") x: number;
  @type("number") y: number;
  @type("number") tick: number;
  @type("number") hp: number = 1000;
  @type("number") maxHp: number = 1000;
  @type("number") speed: number = 2;
  @type("boolean") isDead: boolean = false;
  inputQueue: InputData[] = [];
}

export class Enemy extends Schema {
  @type("number") x: number;
  @type("number") y: number;
  @type("number") hp: number = 100;
  @type("number") maxHp: number = 100;
  @type("number") attack: number = 1;
}

export class MyRoomState extends Schema {
  @type("number") mapWidth: number;
  @type("number") mapHeight: number;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();
}

export class Part4Room extends Room {
  state = new MyRoomState();
  fixedTimeStep = 1000 / 60;

  enemyIdCounter = 0;
  enemySpawnCounter = 0;
  enemySpawnInterval = 180; // spawn every 3 seconds (180 ticks at 60fps)
  maxEnemies = 20;
  enemySpeed = 1.0;
  collisionDistance = 24; // pixels for hitbox overlap

  messages = {
    0: (client: Client, input: InputData) => {
      // handle player input
      const player = this.state.players.get(client.sessionId);

      // enqueue input to user input buffer.
      player.inputQueue.push(input);
    },
    1: (client: Client) => {
      // handle respawn request
      const player = this.state.players.get(client.sessionId);
      if (player && player.isDead) {
        player.hp = player.maxHp;
        player.isDead = false;
        player.x = Math.random() * this.state.mapWidth;
        player.y = Math.random() * this.state.mapHeight;
        player.inputQueue = [];
      }
    },
  };

  onCreate(options: any) {
    // set map dimensions
    this.state.mapWidth = 800;
    this.state.mapHeight = 600;

    let elapsedTime = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;

      while (elapsedTime >= this.fixedTimeStep) {
        elapsedTime -= this.fixedTimeStep;
        this.fixedTick(this.fixedTimeStep);
      }
    });
  }

  fixedTick(timeStep: number) {
    const velocity = 2;

    // Process player inputs
    this.state.players.forEach((player) => {
      if (player.isDead) return;

      let input: InputData;

      // dequeue player inputs
      while ((input = player.inputQueue.shift())) {
        if (input.left) {
          player.x -= velocity;
        } else if (input.right) {
          player.x += velocity;
        }

        if (input.up) {
          player.y -= velocity;
        } else if (input.down) {
          player.y += velocity;
        }

        // Clamp to map bounds
        player.x = Math.max(0, Math.min(this.state.mapWidth, player.x));
        player.y = Math.max(0, Math.min(this.state.mapHeight, player.y));

        player.tick = input.tick;
      }
    });

    // Spawn enemies periodically
    this.enemySpawnCounter++;
    if (
      this.enemySpawnCounter >= this.enemySpawnInterval &&
      this.state.enemies.size < this.maxEnemies
    ) {
      this.enemySpawnCounter = 0;
      this.spawnEnemy();
    }

    // Move enemies toward nearest alive player
    this.state.enemies.forEach((enemy) => {
      let nearestPlayer: Player = null;
      let nearestDist = Infinity;

      this.state.players.forEach((player) => {
        if (player.isDead) return;
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPlayer = player;
        }
      });

      if (nearestPlayer) {
        const dx = nearestPlayer.x - enemy.x;
        const dy = nearestPlayer.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          enemy.x += (dx / dist) * this.enemySpeed;
          enemy.y += (dy / dist) * this.enemySpeed;
        }
      }
    });

    // Check collision between enemies and players - deal damage every tick
    this.state.enemies.forEach((enemy) => {
      this.state.players.forEach((player) => {
        if (player.isDead) return;

        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.collisionDistance) {
          player.hp -= enemy.attack;
          if (player.hp <= 0) {
            player.hp = 0;
            player.isDead = true;
          }
        }
      });
    });
  }

  spawnEnemy() {
    const enemy = new Enemy();
    // Spawn at random position along the edges of the map
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: // top
        enemy.x = Math.random() * this.state.mapWidth;
        enemy.y = 0;
        break;
      case 1: // bottom
        enemy.x = Math.random() * this.state.mapWidth;
        enemy.y = this.state.mapHeight;
        break;
      case 2: // left
        enemy.x = 0;
        enemy.y = Math.random() * this.state.mapHeight;
        break;
      case 3: // right
        enemy.x = this.state.mapWidth;
        enemy.y = Math.random() * this.state.mapHeight;
        break;
    }

    const enemyId = `enemy_${this.enemyIdCounter++}`;
    this.state.enemies.set(enemyId, enemy);
  }

  onJoin(client: Client, options: any) {
    console.log("Joined!", {
      roomId: this.roomId,
      sessionId: client.sessionId,
    });

    const player = new Player();
    player.x = Math.random() * this.state.mapWidth;
    player.y = Math.random() * this.state.mapHeight;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, code: number) {
    console.log("Left!", { roomId: this.roomId, sessionId: client.sessionId });
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("Disposing room", this.roomId, "...");
  }
}
