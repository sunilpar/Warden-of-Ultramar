/**
 * Phaser Game Entry Point
 * =======================
 * Creates the Phaser game with two scenes:
 *   - SceneSelector: the start screen with "Start Game" button
 *   - GameScene: the main game where you control a character on map1
 */

import Phaser from "phaser";
import { SceneSelector } from "./scenes/SceneSelector";
import { GameScene } from "./scenes/GameScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  // Design resolution — the game logic/HUD stays in these coordinates.
  // FIT + CENTER_BOTH scales the canvas to fill the player's whole
  // screen while preserving the aspect ratio.
  width: 1080,
  height: 720,
  backgroundColor: "#117c13",
  parent: "phaser-example",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    expandParent: true,
  },
  physics: {
    default: "arcade",
  },
  pixelArt: true,
  disableContextMenu: true,
  scene: [
    SceneSelector,
    new GameScene({ key: "game" }),
    new GameScene({ key: "game2" }),
  ],
};

const game = new Phaser.Game(config);
