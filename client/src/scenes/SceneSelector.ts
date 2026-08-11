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
    // Bottom-left HUD (HP bar + skill card slots)
    this.load.image("hud", "assets/hud.png");
    // Skill card spritesheet (9 cols x 4 rows, each 128x200)
    this.load.spritesheet(
      "card_sheet",
      "assets/cards/cardSpritesheet128_200.png",
      { frameWidth: 128, frameHeight: 200 },
    );
    // Character sprite sheet (4x4 grid, each frame 64x64)
    this.load.spritesheet(
      "character_sheet",
      "assets/CharacterSpriteSheet64.png",
      {
        frameWidth: 64,
        frameHeight: 64,
      },
    );
    // Tyranid enemy sprite sheet (64x64 frames).
    // Row 0 (frames 0-3) = idle/move animation (faces LEFT by default).
    // Row 1 (frames 4-7) = attack animation (faces LEFT by default).
    // When the enemy faces right, the client flips horizontally.
    this.load.spritesheet(
      "tyranid_sheet",
      "assets/spriteSheetTRI64.png",
      {
        frameWidth: 64,
        frameHeight: 64,
      },
    );
    // Orck enemy sprite sheet (256x256 frames).
    // Row 0 (frames 0-4) = walk animation (faces LEFT by default).
    // Row 1 (frames 5-9) = attack animation (faces LEFT by default).
    // When the enemy faces right, the client flips horizontally.
    this.load.spritesheet(
      "orck_sheet",
      "assets/skills/ocksSlamSheet.png",
      {
        frameWidth: 256,
        frameHeight: 256,
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
    // 32px Tiled map tileset (BIGOBS64sym.png, 14 cols x 12 rows, 32px each).
    // Same source image but loaded with 32px frames for the 32px maps.
    this.load.spritesheet(
      "bigobs_tiles_32",
      "assets/maps/map1/BIGOBS64sym.png",
      {
        frameWidth: 32,
        frameHeight: 32,
      },
    );
    // Bolter skill spritesheet (3 cols x 2 rows, 64x64 each).
    //   Row 0 (frames 0,1,2): bullet art per color tier (yellow/blue/purple).
    //   Row 1 (frames 3,4,5): muzzle flash animation frames.
    this.load.spritesheet(
      "bolter_sheet",
      "assets/skills/BolterSpriteSheet-0002.png",
      {
        frameWidth: 64,
        frameHeight: 64,
      },
    );
    // Claw skill spritesheet (4 cols x 3 rows, 64x64 each).
    //   Row 0 (frames 0-3): tier "small" (levels 1-3).
    //   Row 1 (frames 4-7): tier "mid" (levels 4-7).
    //   Row 2 (frames 8-11): tier "big" (levels 8-10).
    this.load.spritesheet(
      "claw_sheet",
      "assets/skills/clawSpritesheet-0003.png",
      {
        frameWidth: 64,
        frameHeight: 64,
      },
    );
    // Slam skill sprite sheet (64x64 frames, 2 rows).
    // Row 0 (frames 0-2) = base slam (levels 1-5): start, travel, impact.
    // Row 1 (frames 0-3) = upgraded slam (levels 6-10): start, travel1, travel2, impact.
    this.load.spritesheet(
      "slam_sheet",
      "assets/skills/slamSpritesheet.png",
      {
        frameWidth: 64,
        frameHeight: 64,
      },
    );

    // ---- Map info button icon ----
    this.load.image("map_info_icon", "assets/40k icon2.png");
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
