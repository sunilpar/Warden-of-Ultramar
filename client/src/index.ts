import Phaser from "phaser";

import { SceneSelector } from "./scenes/SceneSelector";
import { Part1Scene } from "./scenes/Part1Scene";
import { Part2Scene } from "./scenes/Part2Scene";
import { Part3Scene } from "./scenes/Part3Scene";
import { Part4Scene } from "./scenes/Part4Scene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  // 1. Add the Scale property
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: "phaser-example",
    width: "100%",
    height: "100%",
  },
  fps: {
    target: 60,
    forceSetTimeOut: true,
    smoothStep: false,
  },
  backgroundColor: "#117c13",
  physics: {
    default: "arcade",
  },
  pixelArt: true,
  scene: [SceneSelector, Part1Scene, Part2Scene, Part3Scene, Part4Scene],
};

const game = new Phaser.Game(config);

/**
 * Create FPS selector
 */

// current fps label
const fpsInput = document.querySelector<HTMLInputElement>("input#fps");
const fpsValueLabel = document.querySelector<HTMLSpanElement>("#fps-value");
fpsValueLabel.innerText = fpsInput.value;

fpsInput.oninput = function (event: InputEvent) {
  const value = (event.target as HTMLInputElement).value;
  fpsValueLabel.innerText = value;

  // destroy previous loop
  game.loop.destroy();

  // create new loop
  game.loop = new Phaser.Core.TimeStep(game, {
    target: parseInt(value),
    forceSetTimeOut: true,
    smoothStep: false,
  });

  // start new loop
  game.loop.start(game.step.bind(game));
};
