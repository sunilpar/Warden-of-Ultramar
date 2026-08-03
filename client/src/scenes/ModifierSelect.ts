/**
 * Modifier Select Scene
 * ======================
 * Overlay popup (like PauseMenu) shown when player reaches map exit.
 * Shows 2 mod choices. Player picks ONE → sent to server via message 8.
 */

import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";

export class ModifierSelect extends Phaser.Scene {
  private room!: Room<any>;
  private sessionId!: string;

  constructor() {
    super({ key: "ModifierSelect" });
  }

  init(data: { room: Room<any>; sessionId: string }) {
    this.room = data.room;
    this.sessionId = data.sessionId;
  }

  create() {
    const { width, height } = this.cameras.main;

    // Read 2 pending mod choices from room state
    const player = this.room.state.players.get(this.sessionId);
    const choices: { id: string; label: string; description: string }[] = [];
    if (player && player.pendingModChoices) {
      for (const md of player.pendingModChoices) {
        choices.push({ id: md.id, label: md.label, description: md.description });
      }
    }

    // Dim overlay
    this.add.rectangle(0, 0, width, height, 0x000000, 0.7).setOrigin(0).setDepth(0);

    // Panel
    const panelW = 540;
    const panelH = 380;
    const panelX = width / 2;
    const panelY = height / 2;

    this.add
      .rectangle(panelX, panelY, panelW, panelH, 0x1a1a1a, 0.95)
      .setStrokeStyle(2, 0xefbf68, 1)
      .setDepth(1);

    // Title
    this.add
      .text(panelX, panelY - panelH / 2 + 35, "CHOOSE A MODIFIER", {
        color: "#efbf68",
        fontSize: "24px",
        fontFamily: "Georgia",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(2);

    this.add.rectangle(panelX, panelY - panelH / 2 + 60, 400, 2, 0xefbf68, 0.5).setDepth(2);

    // Mod cards
    const cardW = 230;
    const cardH = 210;
    const cardSpacing = 24;
    const totalW = choices.length * cardW + (choices.length - 1) * cardSpacing;
    const startX = panelX - totalW / 2 + cardW / 2;
    const cardY = panelY + 20;

    choices.forEach((mod, i) => {
      const cx = startX + i * (cardW + cardSpacing);

      const bg = this.add
        .rectangle(cx, cardY, cardW, cardH, 0x2a1a1a, 0.95)
        .setStrokeStyle(2, 0xefbf68, 0.7)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });

      const labelText = this.add
        .text(cx, cardY - 60, mod.label, {
          color: "#efbf68",
          fontSize: "16px",
          fontFamily: "Georgia",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 3,
          align: "center",
          wordWrap: { width: cardW - 20 },
        })
        .setOrigin(0.5)
        .setDepth(3);

      this.add.rectangle(cx, cardY - 20, cardW - 30, 1, 0xefbf68, 0.3).setDepth(3);

      const descText = this.add
        .text(cx, cardY + 35, mod.description, {
          color: "#cccccc",
          fontSize: "13px",
          fontFamily: "Georgia",
          align: "center",
          wordWrap: { width: cardW - 24 },
          stroke: "#000000",
          strokeThickness: 1,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(3);

      const hint = this.add
        .text(cx, cardY + cardH / 2 - 20, "CLICK TO TAKE", {
          color: "#7a2127",
          fontSize: "11px",
          fontFamily: "Georgia",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(3);

      bg.on("pointerover", () => {
        bg.setFillStyle(0x7a2127, 0.95);
        bg.setStrokeStyle(3, 0xefbf68, 1);
        labelText.setColor("#ffffff");
        hint.setColor("#efbf68");
      });
      bg.on("pointerout", () => {
        bg.setFillStyle(0x2a1a1a, 0.95);
        bg.setStrokeStyle(2, 0xefbf68, 0.7);
        labelText.setColor("#efbf68");
        hint.setColor("#7a2127");
      });

      bg.on("pointerdown", () => {
        this.room.send(8, { modId: mod.id });
        this.scene.stop();
      });
    });

    // Hint
    this.add
      .text(panelX, panelY + panelH / 2 - 22, "Select one modifier to proceed", {
        color: "#888888",
        fontSize: "11px",
        fontFamily: "Georgia",
      })
      .setOrigin(0.5)
      .setDepth(2);
  }
}
