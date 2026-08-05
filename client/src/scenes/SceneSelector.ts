/**
 * Scene Selector (Start Screen)
 * =============================
 * Shows the menu background with "Start Game" text.
 * Clicking "Start Game" switches to the GameScene.
 */

import Phaser from "phaser";

export class SceneSelector extends Phaser.Scene {
  constructor() {
    super({ key: "selector", active: true });
  }

  preload() {
    // Start screen background
    this.load.image("game_menu", "assets/menu_final.png");
    // Loading screen shown during map transitions
    this.load.image("loading_screen", "assets/loading_up.png");

    // Character sprite sheet (4x4 grid, each frame 64x64)
    this.load.spritesheet(
      "character_sheet",
      "assets/CharacterSpriteSheet64.png",
      {
        frameWidth: 64,
        frameHeight: 64,
      },
    );

    // Map1 tile sprite sheet (2 rows x 4 cols, 64x64 each)
    this.load.spritesheet(
      "map1_tiles",
      "assets/maps/map1/MapTilesSpriteSheet64.png",
      {
        frameWidth: 64,
        frameHeight: 64,
      },
    );

    // Map1 obstacle sprite sheet (4 rows x 4 cols, 128x128 each)
    this.load.spritesheet(
      "map1_obstacles",
      "assets/maps/map1/MapObsSpriteSheet128.png",
      {
        frameWidth: 128,
        frameHeight: 128,
      },
    );

    // Tiled-export tileset for map1 (ALLNEWMAP64.png — 7 cols x 6 rows, 64px each)
    this.load.spritesheet(
      "map1_tiled_tiles",
      "assets/maps/map1/ALLNEWMAP64.png",
      {
        frameWidth: 64,
        frameHeight: 64,
      },
    );

    // Layered Tiled map tileset (BIGOBS64sym.png — 7 cols x 6 rows, 64px each)
    this.load.spritesheet(
      "bigobs_tiles",
      "assets/maps/map1/BIGOBS64sym.png",
      {
        frameWidth: 64,
        frameHeight: 64,
      },
    );
  }

  create() {
    // Draw the menu background stretched to fill the screen
    this.add
      .image(this.cameras.main.centerX, this.cameras.main.centerY, "game_menu")
      .setDisplaySize(this.cameras.main.width, this.cameras.main.height);

    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      color: "#efbf68",
      fontSize: "23px",
      fontFamily: "Georgia",
      stroke: "#000000",
      strokeThickness: 3,
    };

    // "Start Game" button
    this.add
      .text(100, 286, "Start Game", textStyle)
      .setInteractive()
      .setPadding(6)
      .setShadow(3, 3, "#000000", 4, true, true)
      .on("pointerdown", () => {
        this.game.scene.switch("selector", "game");
      });

    // "Quit Game" button (just reloads for now)
    this.add
      .text(100, 564, "Quit Game", textStyle)
      .setInteractive()
      .setPadding(6)
      .setShadow(3, 3, "#000000", 4, true, true)
      .on("pointerdown", () => {
        window.location.reload();
      });
  }
}
