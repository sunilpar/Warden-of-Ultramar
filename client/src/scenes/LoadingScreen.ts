/**
 * Loading Screen Overlay Scene
 * =============================
 * Fades to black, shows loadingScreen.png centered (cover-fit, not stretched),
 * swaps the map underneath the black, then fades back in.
 */

import Phaser from "phaser";

export class LoadingScreen extends Phaser.Scene {
  private blackOverlay!: Phaser.GameObjects.Rectangle;
  private loadingImage!: Phaser.GameObjects.Image;

  constructor() {
    super({ key: "LoadingScreen" });
  }

  create() {
    const { width, height } = this.cameras.main;

    // Loading image: cover-fit (fills screen without stretching)
    const tex = this.textures.get("loading_screen").getSourceImage();
    const imgW = tex.width as number;
    const imgH = tex.height as number;
    const scale = Math.max(width / imgW, height / imgH);

    this.loadingImage = this.add
      .image(width / 2, height / 2, "loading_screen")
      .setDisplaySize(imgW * scale, imgH * scale)
      .setDepth(1)
      .setAlpha(0);

    // Black overlay (fades 0 -> 1 -> 0)
    this.blackOverlay = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0)
      .setDepth(2);

    // Phase 1: Fade to black (300ms)
    this.tweens.add({
      targets: this.blackOverlay,
      alpha: 1,
      duration: 300,
      ease: "Quad.easeIn",
      onComplete: () => {
        // Screen is black — show loading image
        this.loadingImage.setAlpha(1);

        // Phase 2: Hold (show loading art 700ms)
        this.time.delayedCall(700, () => {
          // Tell GameScene to swap the map NOW (hidden behind black)
          const gameScene = this.scene.get("game") as any;
          if (gameScene && typeof gameScene.onLoadingScreenReady === "function") {
            gameScene.onLoadingScreenReady();
          }

          // Phase 3: Fade out loading image + black (400ms)
          this.tweens.add({
            targets: this.loadingImage,
            alpha: 0,
            duration: 200,
          });
          this.tweens.add({
            targets: this.blackOverlay,
            alpha: 0,
            duration: 400,
            ease: "Quad.easeOut",
            onComplete: () => {
              this.scene.stop();
            },
          });
        });
      },
    });
  }
}
