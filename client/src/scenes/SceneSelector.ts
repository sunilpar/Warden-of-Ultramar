import Phaser from "phaser";

export class SceneSelector extends Phaser.Scene {
  // Maps button number → scene key
  parts: { [key: string]: { label: string; sceneKey: string } } = {
    // "1": { label: "Start Game", sceneKey: "part1" },
    "1": { label: "Start Game", sceneKey: "game" },
    "2": { label: "Quit Game", sceneKey: "game" },
  };

  constructor() {
    super({ key: "selector", active: true });
  }

  preload() {
    // update menu background color
    this.cameras.main.setBackgroundColor(0x000000);

    // preload demo assets
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

    // Map 1 assets
    this.load.image("map1_tiles", "assets/maps/map1/maptileBasic.png");
    this.load.image("map1_obstacle_big", "assets/maps/map1/mapObsticalBig.png");
    this.load.image("map1_obstacle_small", "assets/maps/map1/smallObstical.png");
    this.load.image("map1_spawn_player", "assets/maps/map1/playerSpawnPoint.png");
    this.load.image("map1_spawn_enemy1", "assets/maps/map1/enemyspawnPoint1.png");
    this.load.image("map1_spawn_enemy2", "assets/maps/map1/enemyswpanPoint2.png");
    this.load.image("map1_spawn_enemy3", "assets/maps/map1/enemyspawnpoint3.png");
    this.load.image("map1_exit", "assets/maps/map1/mapExitpoint.png");
  }

  create() {
    // automatically navigate to hash scene if provided
    if (window.location.hash) {
      this.runScene(window.location.hash.substring(1));
      return;
    }

    const bgVideo = this.add
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
