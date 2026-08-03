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
  width: 1080,
  height: 720,
  backgroundColor: "#117c13",
  parent: "phaser-example",
  physics: {
    default: "arcade",
  },
  pixelArt: true,
  scene: [SceneSelector, GameScene],
};

const game = new Phaser.Game(config);
