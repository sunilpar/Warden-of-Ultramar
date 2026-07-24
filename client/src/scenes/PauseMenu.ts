/**
 * Pause Menu Scene
 * =================
 * An overlay scene that runs on top of GameScene when the player presses ESC.
 * Shows a transparent black overlay with a centered menu panel containing:
 *   - Resume: closes the pause menu
 *   - Reload: reloads the browser
 *   - Quit: reloads the browser
 *
 * THEME COLORS:
 *   - Gold accent: #efbf68
 *   - Dark red: #7a2127
 *   - Background: semi-transparent black
 */

import Phaser from "phaser";

export class PauseMenu extends Phaser.Scene {
  constructor() {
    super({ key: "PauseMenu" });
  }

  create() {
    const { width, height } = this.cameras.main;

    // ---- Transparent black overlay ----
    this.add
      .rectangle(0, 0, width, height, 0x000000, 0.7)
      .setOrigin(0)
      .setDepth(0);

    // ---- Menu panel ----
    const panelW = 280;
    const panelH = 320;
    const panelX = width / 2;
    const panelY = height / 2;

    this.add
      .rectangle(panelX, panelY, panelW, panelH, 0x1a1a1a, 0.95)
      .setStrokeStyle(2, 0xefbf68, 1)
      .setDepth(1);

    // ---- Title ----
    this.add
      .text(panelX, panelY - panelH / 2 + 35, "PAUSED", {
        color: "#efbf68",
        fontSize: "28px",
        fontFamily: "Georgia",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(2);

    // Decorative line under title
    this.add
      .rectangle(panelX, panelY - panelH / 2 + 60, 200, 2, 0xefbf68, 0.5)
      .setDepth(2);

    // ---- Buttons ----
    const buttonW = 200;
    const buttonH = 44;
    const buttonSpacing = 14;
    const startY = panelY - 20;

    const buttons = [
      { label: "Resume", action: "resume", color: 0x7a2127 },
      { label: "Reload", action: "reload", color: 0x333333 },
      { label: "Quit", action: "quit", color: 0x333333 },
    ];

    buttons.forEach((btn, i) => {
      const y = startY + i * (buttonH + buttonSpacing);

      // Button background
      const bg = this.add
        .rectangle(panelX, y, buttonW, buttonH, btn.color, 0.9)
        .setStrokeStyle(1, 0xefbf68, 0.6)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });

      // Button label
      const text = this.add
        .text(panelX, y, btn.label, {
          color: "#efbf68",
          fontSize: "16px",
          fontFamily: "Georgia",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setDepth(3);

      // Hover effect
      bg.on("pointerover", () => {
        bg.setFillStyle(0xefbf68, 0.9);
        text.setColor("#1a1a1a");
      });
      bg.on("pointerout", () => {
        bg.setFillStyle(btn.color, 0.9);
        text.setColor("#efbf68");
      });

      // Click handler
      bg.on("pointerdown", () => {
        this.handleAction(btn.action);
      });
    });

    // ESC also resumes
    this.input.keyboard?.once("keydown-ESC", () => {
      this.handleAction("resume");
    });

    // Hint text
    this.add
      .text(panelX, panelY + panelH / 2 - 25, "Press ESC to resume", {
        color: "#888888",
        fontSize: "10px",
        fontFamily: "Georgia",
      })
      .setOrigin(0.5)
      .setDepth(2);
  }

  private handleAction(action: string) {
    switch (action) {
      case "resume":
        this.scene.stop();
        this.scene.resume("GameScene");
        break;
      case "reload":
      case "quit":
        window.location.reload();
        break;
    }
  }
}
