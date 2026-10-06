/**
 * Party Unit Frame HUD
 * --------------------
 * A fixed top-left overlay (200px below the top edge) that shows one stacked
 * frame per player currently in the lobby / active game session.
 *
 * Each frame visually mirrors the floating HP bar from `systems/nameLabel.ts`:
 *   - Player name above the bar
 *   - HP fill (green > 50%, orange > 25%, red below) with white shield overlay
 *   - No opaque plate - the bar + name float over the world
 *
 * Live updates: the scene's update() loop should call
 * `partyHud.upsertPlayers(states)` every frame to push current HP/shield from
 * `currentPlayerState` (local) and `sprite.data` (remote).
 *
 * Visibility rule: only renders when there are 2 or more players in the
 * current session (per the multiplayer party-frame spec).
 */
import Phaser from "phaser";

// --- Layout (tunable) -------------------------------------------------
// All HP bar dimensions are exposed so the visual can be tweaked
// without touching the rest of the file. Just change the values
// below and reload.

// Outer frame (the rectangular plate each player frame sits inside).
const FRAME_W = 260;          // overall frame width (px)
const FRAME_H = 40;           // overall frame height (px)
const FRAME_GAP = 4;          // vertical gap between stacked frames
const PADDING_X = 0;

// Vertical position: just below the hitbox toggle `[F3] Hitboxes: OFF`
// (rendered at (10, 32) with ~18px height in GameScene).
const HITBOX_TOGGLE_BOTTOM = 60; // y of the top edge of frame[0]

// HP bar (independent from FRAME_W so you can make the bar narrower
// than the outer plate, with room for a skull/name on the left).
const HP_BAR_W = 200;         // <-- tweak me: HP bar width (px)
const HP_BAR_H = 12;          // <-- tweak me: HP bar height (px)
const HP_BAR_X = 0;
const HP_BAR_Y = 20;          // <-- tweak me: y offset from frame's top edge

const HUD_DEPTH = 200;        // Phaser draw order
const NAME_FONT_PX = 12;      // <-- tweak me: name text size (px)
const SKULL_FONT_PX = 14;     // <-- tweak me: skull glyph size (px)

// --- Colors (mirror statsHud.ts + nameLabel.ts) -----------------------
const HP_BACK_COLOR = 0x1a0000;
const HP_HIGH_COLOR = 0x4dd24d;
const HP_MID_COLOR = 0xffaa00;
const HP_LOW_COLOR = 0xff3333;
const SHIELD_OVERLAY_COLOR = 0xffffff;
const SHIELD_OVERLAY_ALPHA = 0.6;
const NAME_COLOR = "#ffffff";
const DEAD_NAME_COLOR = "#888888";

// --- Skull glyph (Unicode - no extra asset needed) --------------------
const SKULL_GLYPH = "\u2620";

// --- Public types -----------------------------------------------------
export interface PartyPlayerSnapshot {
  id: string;
  displayName: string;
  title?: string;
  currentHealth: number;
  maxHealth: number;
  shield: number;
  maxShield: number;
  isDead: boolean;
  nameColor?: string;
}

export interface PartyHudBindOptions {
  includePlayer?: (player: any) => boolean;
}

export interface PartyHudRefs {
  container: Phaser.GameObjects.Container | null;
  upsertPlayer(snapshot: PartyPlayerSnapshot): void;
  /** Batch upsert: pushes live state for every frame, then re-layouts once. */
  upsertPlayers(snapshots: PartyPlayerSnapshot[]): void;
  removePlayer(id: string): void;
  bindRoom(room: unknown, options?: PartyHudBindOptions): void;
  unbindRoom(): void;
  destroy(): void;
}

interface PartyFrame {
  id: string;
  container: Phaser.GameObjects.Container;
  nameText: Phaser.GameObjects.Text;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  shieldFill: Phaser.GameObjects.Rectangle;
  skull: Phaser.GameObjects.Text;
  lastName: string;
  cleanups: Array<() => void>;
}

// --- Factory ----------------------------------------------------------
export function createPartyHud(scene: Phaser.Scene): PartyHudRefs {
  const frames = new Map<string, PartyFrame>();
  const order: string[] = [];

  function createFrame(id: string): PartyFrame {
    const container = scene.add
      .container(PADDING_X, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH);

    const nameText = scene.add
      .text(HP_BAR_X, 3, "", {
        color: NAME_COLOR,
        fontSize: NAME_FONT_PX + "px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);

    const skull = scene.add
      .text(HP_BAR_X, HP_BAR_Y - 16, SKULL_GLYPH, {
        color: "#dddddd",
        fontSize: SKULL_FONT_PX + "px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);
    skull.setVisible(false);

    const barX = HP_BAR_X;
    const barY = HP_BAR_Y;
    const barW = HP_BAR_W;
    const hpBg = scene.add
      .rectangle(barX, barY, barW, HP_BAR_H, HP_BACK_COLOR, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);
    const hpFill = scene.add
      .rectangle(barX, barY, barW, HP_BAR_H, HP_HIGH_COLOR, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 2);
    const shieldFill = scene.add
      .rectangle(barX, barY, barW, HP_BAR_H, SHIELD_OVERLAY_COLOR, SHIELD_OVERLAY_ALPHA)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 3);
    shieldFill.setVisible(false);

    container.add([nameText, skull, hpBg, hpFill, shieldFill]);
    container.setVisible(false);

    return {
      id,
      container,
      nameText,
      hpBg,
      hpFill,
      shieldFill,
      skull,
      lastName: "",
      cleanups: [],
    };
  }

  function relayout(): void {
    // Positioned just below the hitbox toggle button (top edge).
    // Frames stack downward.
    const N = order.length;
    order.forEach((id, idx) => {
      const f = frames.get(id);
      if (!f) return;
      const y = HITBOX_TOGGLE_BOTTOM + idx * (FRAME_H + FRAME_GAP);
      f.container.setY(y);
    });
    const show = N >= 2;
    frames.forEach((f) => f.container.setVisible(show));
  }

  function refreshFrame(frame: PartyFrame, snap: PartyPlayerSnapshot): void {
    if (frame.lastName !== snap.displayName) {
      frame.nameText.setText(snap.displayName);
      frame.lastName = snap.displayName;
    }
    if (snap.nameColor) frame.nameText.setColor(snap.nameColor);

    if (snap.isDead || snap.currentHealth <= 0) {
      frame.hpFill.scaleX = 0;
      frame.shieldFill.setVisible(false);
      frame.skull.setVisible(true);
      frame.nameText.setColor(DEAD_NAME_COLOR);
      return;
    }

    frame.skull.setVisible(false);
    frame.nameText.setColor(snap.nameColor ?? NAME_COLOR);

    const safeMaxHp = Math.max(1, snap.maxHealth | 0);
    const ratio = Math.max(0, Math.min(1, (snap.currentHealth | 0) / safeMaxHp));
    frame.hpFill.scaleX = ratio;
    frame.hpFill.fillColor =
      ratio > 0.5 ? HP_HIGH_COLOR : ratio > 0.25 ? HP_MID_COLOR : HP_LOW_COLOR;

    const safeMaxSh = Math.max(1, snap.maxShield | 0);
    if (snap.maxShield > 0 && snap.shield > 0) {
      if (!frame.shieldFill.visible) frame.shieldFill.setVisible(true);
      frame.shieldFill.scaleX = Math.max(0, Math.min(1, snap.shield / safeMaxSh));
    } else if (frame.shieldFill.visible) {
      frame.shieldFill.setVisible(false);
    }

  }

  function upsertPlayer(snapshot: PartyPlayerSnapshot): void {
    let frame = frames.get(snapshot.id);
    if (!frame) {
      frame = createFrame(snapshot.id);
      frames.set(snapshot.id, frame);
      order.push(snapshot.id);
    }
    refreshFrame(frame, snapshot);
  }

  function upsertPlayers(snapshots: PartyPlayerSnapshot[]): void {
    for (let i = 0; i < snapshots.length; i++) upsertPlayer(snapshots[i]);
    relayout();
  }

  function removePlayer(id: string): void {
    const frame = frames.get(id);
    if (!frame) return;

    frame.cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        /* swallow */
      }
    });
    frame.cleanups.length = 0;

    scene.tweens.add({
      targets: frame.container,
      alpha: 0,
      x: -20,
      duration: 150,
      onComplete: () => {
        frame.container.destroy(true);
      },
    });

    frames.delete(id);
    const idx = order.indexOf(id);
    if (idx >= 0) order.splice(idx, 1);
    relayout();
  }

  let roomUnbind: Array<() => void> = [];

  function toSnapshot(player: any, id: string): PartyPlayerSnapshot {
    return {
      id,
      displayName: player.displayName ?? "",
      title: player.title ?? "",
      currentHealth: player.currentHealth ?? 0,
      maxHealth: player.maxHealth ?? 1,
      shield: player.shield ?? 0,
      maxShield: player.maxShield ?? 0,
      isDead: !!(player.isDead ?? (player.currentHealth ?? 0) <= 0),
    };
  }

  function attachPlayerListeners(player: any, sessionId: string): void {
    const frame = frames.get(sessionId);
    if (!frame) return;

    const fields = [
      "displayName",
      "title",
      "currentHealth",
      "maxHealth",
      "shield",
      "maxShield",
      "isDead",
    ];

    for (const f of fields) {
      const cb = () => {
        upsertPlayer(toSnapshot(player, sessionId));
      };
      if (typeof player.onChange === "function") {
        player.onChange(f, cb);
      } else if (typeof player.listen === "function") {
        player.listen(f, cb);
      }
      frame.cleanups.push(() => {
        try {
          if (typeof player.removeListener === "function")
            player.removeListener(f, cb);
          else if (typeof player.unbind === "function") player.unbind(f, cb);
          else if (typeof player.removeAllListeners === "function")
            player.removeAllListeners();
        } catch {
          /* swallow */
        }
      });
    }
  }

  function bindRoom(room: any, options?: PartyHudBindOptions): void {
    unbindRoom();
    if (!room || !room.state || !room.state.players) {
      console.warn("[partyHud] bindRoom: no room / no players");
      return;
    }

    const includePlayer = options?.includePlayer ?? (() => true);
    const players: any = room.state.players;
    const frameCleanups: Map<string, () => void> = new Map();

    const onAdd = (player: any, sessionId: string) => {
      if (!includePlayer(player)) return;
      upsertPlayer(toSnapshot(player, sessionId));
      attachPlayerListeners(player, sessionId);
      frameCleanups.set(sessionId, () => {
        if (!includePlayer(player)) removePlayer(sessionId);
      });
    };
    const onRemove = (_player: any, sessionId: string) => {
      frameCleanups.delete(sessionId);
      removePlayer(sessionId);
    };

    if (typeof players.onAdd === "function") players.onAdd(onAdd);
    if (typeof players.onRemove === "function") players.onRemove(onRemove);

    if (typeof players.forEach === "function") {
      let count = 0;
      players.forEach((p: any, id: string) => {
        count++;
        onAdd(p, id);
      });
      console.log("[partyHud] bindRoom: iterated " + count + " player(s)");
    } else {
      console.warn("[partyHud] bindRoom: players.forEach is not available");
    }

    roomUnbind.push(() => {
      try {
        players.onAdd?.remove?.(onAdd);
      } catch {
        /* swallow */
      }
      try {
        players.onRemove?.remove?.(onRemove);
      } catch {
        /* swallow */
      }
      frameCleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          /* swallow */
        }
      });
      frameCleanups.clear();
    });
  }

  function unbindRoom(): void {
    roomUnbind.forEach((fn) => {
      try {
        fn();
      } catch {
        /* swallow */
      }
    });
    roomUnbind = [];
    [...order].forEach((id) => removePlayer(id));
  }

  function destroy(): void {
    unbindRoom();
    frames.forEach((f) => {
      f.cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          /* swallow */
        }
      });
      f.container.destroy(true);
    });
    frames.clear();
    order.length = 0;
  }

  return {
    container: null,
    upsertPlayer,
    upsertPlayers,
    removePlayer,
    bindRoom,
    unbindRoom,
    destroy,
  };
}
