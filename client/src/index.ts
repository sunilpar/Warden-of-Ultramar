/**
 * Phaser Game Entry Point
 * =======================
 * Creates the Phaser game with two scenes:
 *   - LobbyScene: the safe-zone / start screen. Players spawn here on
 *     page load, roam freely, and click the "Play" polygon to join the
 *     room's gameplay map.
 *   - GameScene: the main game (map1 / map2). Players arrive here when
 *     they click "Play" in the lobby; they're sent back to the lobby on
 *     death (server-authoritative teleport).
 *
 * Both scenes share the SAME Colyseus room connection - LobbyScene
 * opens it on create(), and passes the room+client to GameScene when
 * the player presses "Play" (no duplicate socket). On death, GameScene
 * hands the room back to LobbyScene.
 */
import Phaser from "phaser";
import { LobbyScene } from "./scenes/LobbyScene";
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
  scene: [LobbyScene, new GameScene({ key: "game" })],
};

const game = new Phaser.Game(config);
