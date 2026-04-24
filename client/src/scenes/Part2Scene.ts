/**
 * ---------------------------
 * Phaser + Colyseus - Part 2.
 * ---------------------------
 * - Connecting with the room
 * - Sending inputs at the user's framerate
 * - Update each player's positions WITH interpolation
 */

import Phaser from "phaser";
import { Room, Client, getStateCallbacks, Callbacks } from "@colyseus/sdk";
import { BACKEND_URL } from "../backend";

// Import server types for strong-typing Colyseus SDK
import type server from "../../../server/src/app.config";
import type { Part2Room } from "../../../server/src/rooms/Part2Room";

export class Part2Scene extends Phaser.Scene {
  client = new Client<typeof server>(BACKEND_URL);
  room: Room<Part2Room>;

  currentPlayer: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  playerEntities: {
    [sessionId: string]: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  } = {};

  debugFPS: Phaser.GameObjects.Text;

  wasdKeys: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
  };

  inputPayload = {
    left: false,
    right: false,
    up: false,
    down: false,
  };

  constructor() {
    super({ key: "part2" });
  }

  async create() {
    this.wasdKeys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
    }) as any;
    this.debugFPS = this.add.text(4, 4, "", { color: "#ff0000" });

    this.add
      .image(this.cameras.main.centerX, this.cameras.main.centerY, "map1")
      .setDisplaySize(this.cameras.main.width, this.cameras.main.height);

    // connect with the room
    await this.connect();

    const callbacks = Callbacks.get(this.room);

    callbacks.onAdd("players", (player, sessionId) => {
      const entity = this.physics.add.image(player.x, player.y, "ship_0001");
      this.playerEntities[sessionId] = entity;

      // listening for server updates
      callbacks.onChange(player, () => {
        //
        // do not update local position immediately
        // we're going to LERP them during the render loop.
        //
        entity.setData("serverX", player.x);
        entity.setData("serverY", player.y);
      });
    });

    // remove local reference when entity is removed from the server
    callbacks.onRemove("players", (player, sessionId) => {
      const entity = this.playerEntities[sessionId];
      if (entity) {
        entity.destroy();
        delete this.playerEntities[sessionId];
      }
    });

    // this.cameras.main.startFollow(this.ship, true, 0.2, 0.2);
    // this.cameras.main.setZoom(1);
    this.cameras.main.setBounds(0, 0, 800, 600);
  }

  async connect() {
    // add connection status text
    const connectionStatusText = this.add
      .text(0, 0, "Trying to connect with the server...")
      .setStyle({ color: "#ff0000" })
      .setPadding(4);

    try {
      this.room = await this.client.joinOrCreate("part2_room", {});

      // connection successful!
      connectionStatusText.destroy();
    } catch (e) {
      // couldn't connect
      connectionStatusText.text = "Could not connect with the server.";
    }
  }

  update(time: number, delta: number): void {
    // skip loop if not connected yet.
    if (!this.room) {
      return;
    }

    // send input to the server (WASD)
    this.inputPayload.left = this.wasdKeys.left.isDown;
    this.inputPayload.right = this.wasdKeys.right.isDown;
    this.inputPayload.up = this.wasdKeys.up.isDown;
    this.inputPayload.down = this.wasdKeys.down.isDown;
    this.room.send(0, this.inputPayload);

    for (let sessionId in this.playerEntities) {
      // interpolate all player entities
      const entity = this.playerEntities[sessionId];
      const { serverX, serverY } = entity.data.values;

      entity.x = Phaser.Math.Linear(entity.x, serverX, 0.2);
      entity.y = Phaser.Math.Linear(entity.y, serverY, 0.2);

      // entity.x = Phaser.Math.Linear(entity.x, serverX, 0.2);
      // entity.y = Phaser.Math.Linear(entity.y, serverY, 0.2);
    }

    this.debugFPS.text = `Frame rate: ${this.game.loop.actualFps}`;
  }

  fixedTick(time, delta) {}
}
