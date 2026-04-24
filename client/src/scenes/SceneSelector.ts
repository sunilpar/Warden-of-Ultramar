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
    this.load.image("map1", "assets/map1.jpg");
    this.load.image("game_menu", "assets/game_menu.gif");
  }

  create() {
    // automatically navigate to hash scene if provided
    if (window.location.hash) {
      this.runScene(window.location.hash.substring(1));
      return;
    }

    // show animated game menu GIF as background, filling the whole screen
    this.add
      .image(this.cameras.main.centerX, this.cameras.main.centerY, "game_menu")
      .setDisplaySize(this.cameras.main.width, this.cameras.main.height);

    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      color: "#B8860B",
      fontSize: "32px",
      fontFamily: "Arial",
      stroke: "#000000",
      strokeThickness: 2,
    };

    for (let partNum in this.parts) {
      const index = parseInt(partNum) - 1;
      const label = this.parts[partNum];

      this.add
        .text(130, 150 + 70 * index, `Part ${partNum}: ${label}`, textStyle)
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
