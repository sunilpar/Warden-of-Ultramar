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
  @type("string") enemyType: string = "elder"; // "elder" or "ork"
}

export class Bullet extends Schema {
  @type("number") x: number;
  @type("number") y: number;
  @type("number") dx: number;
  @type("number") dy: number;
  @type("number") damage: number = 1;
}

export class MyRoomState extends Schema {
  @type("number") mapWidth: number;
  @type("number") mapHeight: number;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();
  @type({ map: Bullet }) bullets = new MapSchema<Bullet>();
}

// Track per-enemy state (not synced)
interface OrkState {
  phase: "moving" | "shooting" | "dodging";
  shootCooldown: number;
  dodgeCooldown: number;
  dodgeDirection: number; // -1 or 1
}

export class Part4Room extends Room {
  state = new MyRoomState();
  fixedTimeStep = 1000 / 60;

  enemyIdCounter = 0;
  bulletIdCounter = 0;
  enemySpawnCounter = 0;
  orkSpawnCounter = 0;

  // Elder settings
  maxElders = 5;
  elderSpawnInterval = 300; // every 5 seconds
  elderSpeed = 1.0;
  elderMoveThreshold = 0.9; // 85% chance to move per tick (chaotic movement)
  collisionDistance = 24;

  // Ork settings
  maxOrks = 3;
  orkSpawnInterval = 300; // every 5 seconds
  orkSpeed = 0.8;
  orkMoveThreshold = 0.9; // 90% chance to move per tick
  orkShootInterval = 6; // shoot every 4 ticks
  orkDodgeDuration = 3; // dodge for 3 ticks
  orkRange = 400; // stop and shoot at this distance
  bulletSpeed = 2.0;
  bulletCollisionDistance = 12;

  // Per-enemy runtime state
  orkStates: { [enemyId: string]: OrkState } = {};

  messages = {
    0: (client: Client, input: InputData) => {
      const player = this.state.players.get(client.sessionId);
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

        player.x = Math.max(0, Math.min(this.state.mapWidth, player.x));
        player.y = Math.max(0, Math.min(this.state.mapHeight, player.y));

        player.tick = input.tick;
      }
    });

    // Count current enemies by type
    let elderCount = 0;
    let orkCount = 0;
    this.state.enemies.forEach((enemy) => {
      if (enemy.enemyType === "ork") orkCount++;
      else elderCount++;
    });

    // Spawn elders periodically
    this.enemySpawnCounter++;
    if (this.enemySpawnCounter >= this.elderSpawnInterval) {
      this.enemySpawnCounter = 0;
      if (elderCount < this.maxElders) {
        this.spawnEnemy("elder");
      }
    }

    // Spawn orks periodically
    this.orkSpawnCounter++;
    if (this.orkSpawnCounter >= this.orkSpawnInterval) {
      this.orkSpawnCounter = 0;
      if (orkCount < this.maxOrks) {
        this.spawnEnemy("ork");
      }
    }

    // Move enemies toward nearest alive player
    this.state.enemies.forEach((enemy, enemyId) => {
      const nearest = this.findNearestAlivePlayer(enemy.x, enemy.y);
      if (!nearest) return;

      const { player: nearestPlayer, dist: nearestDist } = nearest;
      const dx = nearestPlayer.x - enemy.x;
      const dy = nearestPlayer.y - enemy.y;

      if (enemy.enemyType === "ork") {
        this.updateOrk(enemy, enemyId, nearestPlayer, nearestDist, dx, dy);
      } else {
        // Elder: standard chase with chaotic movement
        if (Math.random() < this.elderMoveThreshold) {
          this.moveEnemyToward(enemy, dx, dy, nearestDist, this.elderSpeed);
        }
      }
    });

    // Check collision between melee enemies (elders) and players
    this.state.enemies.forEach((enemy) => {
      if (enemy.enemyType !== "elder") return;

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

    // Move bullets and check collision with players
    const bulletsToRemove: string[] = [];
    this.state.bullets.forEach((bullet, bulletId) => {
      bullet.x += bullet.dx * this.bulletSpeed;
      bullet.y += bullet.dy * this.bulletSpeed;

      // Remove if out of bounds
      if (
        bullet.x < -10 ||
        bullet.x > this.state.mapWidth + 10 ||
        bullet.y < -10 ||
        bullet.y > this.state.mapHeight + 10
      ) {
        bulletsToRemove.push(bulletId);
        return;
      }

      // Check collision with players
      this.state.players.forEach((player) => {
        if (player.isDead) return;

        const pdx = player.x - bullet.x;
        const pdy = player.y - bullet.y;
        const dist = Math.sqrt(pdx * pdx + pdy * pdy);

        if (dist < this.bulletCollisionDistance) {
          player.hp -= bullet.damage;
          if (player.hp <= 0) {
            player.hp = 0;
            player.isDead = true;
          }
          bulletsToRemove.push(bulletId);
        }
      });
    });

    // Remove hit/out-of-bounds bullets
    for (const bulletId of bulletsToRemove) {
      this.state.bullets.delete(bulletId);
    }
  }

  findNearestAlivePlayer(
    x: number,
    y: number,
  ): { player: Player; dist: number } | null {
    let nearestPlayer: Player = null;
    let nearestDist = Infinity;

    this.state.players.forEach((player) => {
      if (player.isDead) return;
      const dx = player.x - x;
      const dy = player.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPlayer = player;
      }
    });

    return nearestPlayer ? { player: nearestPlayer, dist: nearestDist } : null;
  }

  moveEnemyToward(
    enemy: Enemy,
    dx: number,
    dy: number,
    dist: number,
    speed: number,
  ) {
    if (dist > 0) {
      enemy.x += (dx / dist) * speed;
      enemy.y += (dy / dist) * speed;
    }
  }

  updateOrk(
    enemy: Enemy,
    enemyId: string,
    target: Player,
    dist: number,
    dx: number,
    dy: number,
  ) {
    // Initialize ork state if not exists
    if (!this.orkStates[enemyId]) {
      this.orkStates[enemyId] = {
        phase: "moving",
        shootCooldown: 0,
        dodgeCooldown: 0,
        dodgeDirection: Math.random() > 0.5 ? 1 : -1,
      };
    }

    const orkState = this.orkStates[enemyId];

    switch (orkState.phase) {
      case "moving":
        if (dist <= this.orkRange) {
          // In range - stop and start shooting
          orkState.phase = "shooting";
          orkState.shootCooldown = this.orkShootInterval;
        } else {
          // Not in range - follow player with chaotic movement
          if (Math.random() < this.orkMoveThreshold) {
            this.moveEnemyToward(enemy, dx, dy, dist, this.orkSpeed);
          }
        }
        break;

      case "shooting":
        orkState.shootCooldown--;

        if (orkState.shootCooldown <= 0) {
          // Fire bullet toward player
          if (dist > 0) {
            const bullet = new Bullet();
            bullet.x = enemy.x;
            bullet.y = enemy.y;
            bullet.dx = dx / dist;
            bullet.dy = dy / dist;
            bullet.damage = 1;

            const bulletId = `bullet_${this.bulletIdCounter++}`;
            this.state.bullets.set(bulletId, bullet);
          }

          // Transition to dodging
          orkState.phase = "dodging";
          orkState.dodgeCooldown = this.orkDodgeDuration;
          orkState.dodgeDirection = Math.random() > 0.5 ? 1 : -1;
        }
        break;

      case "dodging":
        orkState.dodgeCooldown--;

        // Dodge perpendicular to the direction toward player
        // dx, dy is toward player, so perpendicular is (-dy, dx)
        const perpX = -dy / (dist > 0 ? dist : 1);
        const perpY = dx / (dist > 0 ? dist : 1);

        if (Math.random() < this.orkMoveThreshold) {
          enemy.x += perpX * this.orkSpeed * orkState.dodgeDirection;
          enemy.y += perpY * this.orkSpeed * orkState.dodgeDirection;
        }

        if (orkState.dodgeCooldown <= 0) {
          // Check if still in range
          if (dist <= this.orkRange) {
            // Still in range - shoot again
            orkState.phase = "shooting";
            orkState.shootCooldown = this.orkShootInterval;
          } else {
            // Not in range anymore - go back to moving
            orkState.phase = "moving";
          }
        }
        break;
    }
  }

  spawnEnemy(type: "elder" | "ork") {
    const enemy = new Enemy();
    enemy.enemyType = type;

    if (type === "ork") {
      enemy.hp = 80;
      enemy.maxHp = 80;
      enemy.attack = 0; // ork uses bullets, not melee
    }

    // Spawn at random position along the edges of the map
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0:
        enemy.x = Math.random() * this.state.mapWidth;
        enemy.y = 0;
        break;
      case 1:
        enemy.x = Math.random() * this.state.mapWidth;
        enemy.y = this.state.mapHeight;
        break;
      case 2:
        enemy.x = 0;
        enemy.y = Math.random() * this.state.mapHeight;
        break;
      case 3:
        enemy.x = this.state.mapWidth;
        enemy.y = Math.random() * this.state.mapHeight;
        break;
    }

    const enemyId = `enemy_${this.enemyIdCounter++}`;
    this.state.enemies.set(enemyId, enemy);

    if (type === "ork") {
      this.orkStates[enemyId] = {
        phase: "moving",
        shootCooldown: 0,
        dodgeCooldown: 0,
        dodgeDirection: Math.random() > 0.5 ? 1 : -1,
      };
    }
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

