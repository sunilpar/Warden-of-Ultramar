/**
 * Client-side input system.
 */
import Phaser from "phaser";

export interface InputBindings {
  wasdKeys: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
  };
  inputPayload: {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    tick?: number;
  };
}

export function bindKeyboard(scene: Phaser.Scene): InputBindings {
  const wasdKeys = scene.input.keyboard.addKeys({
    left: Phaser.Input.Keyboard.KeyCodes.A,
    right: Phaser.Input.Keyboard.KeyCodes.D,
    up: Phaser.Input.Keyboard.KeyCodes.W,
    down: Phaser.Input.Keyboard.KeyCodes.S,
  }) as any;
  scene.input.mouse?.disableContextMenu();
  return {
    wasdKeys,
    inputPayload: {
      left: false,
      right: false,
      up: false,
      down: false,
      tick: undefined,
    },
  };
}

export function updateAimAngle(
  pointer: Phaser.Input.Pointer,
  player: Phaser.GameObjects.GameObject | null,
  aimRef: { angle: number },
): void {
  if (!player) return;
  aimRef.angle = Math.atan2(
    pointer.worldY - (player as any).y,
    pointer.worldX - (player as any).x,
  );
}

export function slotIndexForPointer(pointer: Phaser.Input.Pointer): 0 | 1 {
  return pointer.rightButtonDown() ? 1 : 0;
}

export interface CastBlockers {
  dragCard: unknown;
  invDrag: unknown;
  groundGrab: unknown;
  pointerOverGroundCard: (p: Phaser.Input.Pointer) => boolean;
  pointerOverHudCard: (p: Phaser.Input.Pointer) => boolean;
}

export function isCastBlocked(
  pointer: Phaser.Input.Pointer,
  blockers: CastBlockers,
): boolean {
  if (blockers.dragCard || blockers.invDrag || blockers.groundGrab) return true;
  if (blockers.pointerOverGroundCard(pointer)) return true;
  if (blockers.pointerOverHudCard(pointer)) return true;
  return false;
}
