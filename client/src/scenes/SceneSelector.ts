import Phaser from "phaser";

export class SceneSelector extends Phaser.Scene {
  parts: { [key: string]: { label: string; sceneKey: string } } = {
    "1": { label: "Start Game", sceneKey: "game" },
    "2": { label: "Quit Game", sceneKey: "game" },
  };

  constructor() {
    super({ key: "selector", active: true });
  }

  preload() {
    this.cameras.main.setBackgroundColor(0x000000);

    // Character & enemy sprites
    this.load.image("ship_0001", "assets/Dark_Angel_low_res.png");
    this.load.image("map1", "assets/map1up.png");
    this.load.image("game_menu", "assets/menu_final.png");
    this.load.image("elder", "assets/eldar.png");
    this.load.image("deathbox", "assets/deathbox_lowres.png");
    this.load.image("orck", "assets/orck.png");

    // Card system assets
    this.load.image("hud_bg", "assets/hud.png");
    this.load.image("card_base", "assets/cards/base.png");
    this.load.image("card_locked", "assets/cards/lockedBack.png");
    this.load.image("card_skill_boltgun", "assets/cards/skillCards/boltGun.png");
    this.load.image("card_skill_pulse", "assets/cards/skillCards/pulse.png");
    this.load.image("card_skill_heal", "assets/cards/skillCards/hpIncrease.png");

    // ---- Map 1 sprite sheets (JSON-driven) ----
    // Tile sprite sheet: 2 rows x 4 cols, 64x64 each
    // Frame 0 = player spawn, 1-2 = basic tiles, 3 = exit, 4-7 = special
    this.load.spritesheet("map1_tiles", "assets/maps/map1/MapTilesSpriteSheet64.png", {
      frameWidth: 64,
      frameHeight: 64,
    });

    // Obstacle/enemy spawn sprite sheet: 4 rows x 4 cols, 128x128 each
    // Frames 0-11 = obstacles, Frames 12-15 = enemy spawn points
    this.load.spritesheet("map1_obstacles", "assets/maps/map1/MapObsSpriteSheet128.png", {
      frameWidth: 128,
      frameHeight: 128,
    });

    // Tyranid sprite sheet: 2 rows x 4 cols, each frame 64x64
    this.load.spritesheet("tyranid_sheet", "assets/spriteSheetTRI64.png", {
      frameWidth: 64,
      frameHeight: 64,
    });

    // Character sprite sheet (4x4 grid, each frame 64x64)
    this.load.spritesheet("character_sheet", "assets/CharacterSpriteSheet64.png", {
      frameWidth: 64,
      frameHeight: 64,
    });
  }

  create() {
    if (window.location.hash) {
      this.runScene(window.location.hash.substring(1));
      return;
    }

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

    for (let partNum in this.parts) {
      const index = parseInt(partNum) - 1;
      const entry = this.parts[partNum];

      this.add
        .text(100, 286 + 278 * index, entry.label, textStyle)
        .setInteractive()
        .setPadding(6)
        .setShadow(3, 3, "#000000", 4, true, true)
        .on("pointerdown", () => {
          this.runScene(entry.sceneKey);
        });
    }
  }

  runScene(key: string) {
    this.game.scene.switch("selector", key);
  }
}