import Phaser from "phaser";

export class SceneSelector extends Phaser.Scene {
  parts = {
    "1": "Basic Player Movement",
    "2": "Interpolation",
    "3": "Client-predicted Input",
    "4": "Fixed Tickrate",
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
      strokeThickness: 2,
    };

    for (let partNum in this.parts) {
      const index = parseInt(partNum) - 1;
      const label = this.parts[partNum];

      this.add
        .text(85, 285 + 48 * index, `${label}`, textStyle)
        .setInteractive()
        .setPadding(6)
        .setShadow(3, 3, "#000000", 4, true, true)
        .on("pointerdown", () => {
          this.runScene(`part${partNum}`);
        });
    }
  }

  runScene(key: string) {
    this.game.scene.switch("selector", key);
  }
}
