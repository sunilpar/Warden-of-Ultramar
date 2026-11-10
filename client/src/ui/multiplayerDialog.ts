/**
 * Multiplayer Lobby Code Dialog
 * =============================
 * Modal that opens when the player clicks the "MULTIPLYER" polygon in
 * the lobby. Two views inside one panel:
 *
 *   1. MAIN      - Three big buttons: "CREATE LOBBY" / "JOIN LOBBY" /
 *                  "PLAY SOLO". Plus "LEAVE LOBBY" + the current code
 *                  when the caller reports they are already in a code
 *                  lobby.
 *   2. JOINING   - Single-line input + JOIN + error slot + BACK.
 *
 * BOTH flows are automatic - there is no second "confirm" step:
 *   - CREATE LOBBY -> the server mints the lobby, the dialog copies the
 *                     6-char code to the clipboard, closes itself and
 *                     the caller joins the brand-new lobby straight
 *                     away. The creator never has to "enter" their own
 *                     lobby.
 *   - JOIN LOBBY   -> the moment the 6-character code is complete the
 *                     lookup + join fire on their own. The JOIN button
 *                     stays on screen as a manual retry.
 *
 * Out-of-band dismissal:
 *   - Click anywhere outside the panel -> hide().
 *   - Press Escape -> hide().
 */
import Phaser from "phaser";

export type LobbyDialogView = "main" | "joining";

export interface MultiplayerDialogCallbacks {
  /**
   * Called when the player picks CREATE LOBBY. The caller should
   * POST /api/lobby/create and on success call `onCreated(code, roomId)`
   * - the dialog then puts the creator straight into that lobby (it
   * copies the code, closes itself and fires onCreateConfirmed).
   * On failure call showError(msg) to surface the failure.
   */
  onCreate: (
    onCreated: (code: string, roomId: string) => void,
    showError: (msg: string) => void,
  ) => void;
  /**
   * Called with the freshly created lobby's code + roomId. The dialog
   * has already closed itself by then; the caller is responsible for
   * actually joining the room.
   */
  onCreateConfirmed: (code: string, roomId: string) => void;
  onJoin: (code: string, showError: (msg: string) => void) => void;
  onLeave: () => void;
  onSoloPlay: () => void;
  inCodeLobby: boolean;
  currentCode?: string;
}

export interface MultiplayerDialogRefs {
  root: Phaser.GameObjects.Container;
  show: (callbacks: MultiplayerDialogCallbacks) => void;
  hide: () => void;
  isVisible: () => boolean;
}

const PANEL_W = 480;
const PANEL_H = 320;

export function createMultiplayerDialog(
  scene: Phaser.Scene,
): MultiplayerDialogRefs {
  const W = scene.cameras.main.width;
  const H = scene.cameras.main.height;

  const root = scene.add
    .container(0, 0)
    .setDepth(900)
    .setVisible(false)
    .setScrollFactor(0);

  const overlay = scene.add
    .rectangle(0, 0, W, H, 0x000000, 0.55)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: false });

  const panelX = Math.round((W - PANEL_W) / 2);
  const panelY = Math.round((H - PANEL_H) / 2);
  const panelBg = scene.add.graphics().setScrollFactor(0);
  panelBg.fillStyle(0x12121e, 0.97);
  panelBg.fillRoundedRect(panelX, panelY, PANEL_W, PANEL_H, 12);
  panelBg.lineStyle(2, 0x4a6a8a, 0.9);
  panelBg.strokeRoundedRect(panelX, panelY, PANEL_W, PANEL_H, 12);

  // CLICK BLOCKER - absorbs clicks INSIDE the panel so they never reach
  // the overlay. The overlay covers the whole screen, so without this
  // blocker a click on the panel background (the lobby code text, a
  // label, the empty space) would be treated as an "outside click" and
  // dismiss the dialog - losing the lobby code or the code the user
  // just typed. Same pattern as the character / inventory screens.
  // It is added to the container right after the overlay, so it sits
  // ABOVE the overlay but BELOW every button (buttons therefore still
  // receive their own clicks).
  const panelBlocker = scene.add
    .rectangle(
      panelX + PANEL_W / 2,
      panelY + PANEL_H / 2,
      PANEL_W,
      PANEL_H,
      0x000000,
      0,
    )
    .setOrigin(0.5, 0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: false });

  const titleText = scene.add
    .text(W / 2, panelY + 22, "MULTIPLYER", {
      color: "#ffffff",
      fontSize: "18px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5, 0)
    .setScrollFactor(0);

  const createBtn = scene.add
    .text(W / 2, panelY + 70, "[ CREATE LOBBY ]", {
      color: "#66bb6a",
      fontSize: "18px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  const joinBtn = scene.add
    .text(W / 2, panelY + 110, "[ JOIN LOBBY ]", {
      color: "#4fc3f7",
      fontSize: "18px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  const soloBtn = scene.add
    .text(W / 2, panelY + 150, "[ PLAY SOLO ]", {
      color: "#ffd54f",
      fontSize: "14px",
      fontFamily: "monospace",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });

  const currentCodeLabel = scene.add
    .text(W / 2, panelY + 64, "", {
      color: "#cccccc",
      fontSize: "12px",
      fontFamily: "monospace",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0);
  const currentCodeValue = scene.add
    .text(W / 2, panelY + 90, "", {
      color: "#ffffff",
      fontSize: "28px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 4,
    })
    .setOrigin(0.5)
    .setScrollFactor(0);
  const leaveBtn = scene.add
    .text(W / 2, panelY + 160, "[ LEAVE LOBBY ]", {
      color: "#ef5350",
      fontSize: "16px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });

  const joinLabel = scene.add
    .text(W / 2, panelY + 64, "ENTER 6-CHARACTER CODE", {
      color: "#cccccc",
      fontSize: "12px",
      fontFamily: "monospace",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0);

  const inputBox = scene.add.graphics().setScrollFactor(0);
  const drawInputBox = (focused: boolean) => {
    inputBox.clear();
    inputBox.fillStyle(0x000000, 0.6);
    inputBox.fillRoundedRect(W / 2 - 120, panelY + 88, 240, 40, 4);
    inputBox.lineStyle(2, focused ? 0x66bb6a : 0x4a6a8a, 1);
    inputBox.strokeRoundedRect(W / 2 - 120, panelY + 88, 240, 40, 4);
  };
  drawInputBox(false);
  const inputDisplay = scene.add
    .text(W / 2, panelY + 108, "", {
      color: "#ffffff",
      fontSize: "22px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0);

  // Hidden HTML input that captures real keyboard text editing.
  const domInput = document.createElement("input");
  domInput.type = "text";
  domInput.maxLength = 6;
  domInput.autocomplete = "off";
  domInput.spellcheck = false;
  domInput.style.position = "fixed";
  domInput.style.left = "50%";
  domInput.style.top = "-1000px";
  domInput.style.opacity = "0";
  domInput.style.pointerEvents = "none";
  domInput.value = "";
  document.body.appendChild(domInput);

  const joinErrorText = scene.add
    .text(W / 2, panelY + 144, "", {
      color: "#ff5555",
      fontSize: "12px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 2,
      wordWrap: { width: PANEL_W - 40 },
      align: "center",
    })
    .setOrigin(0.5)
    .setScrollFactor(0);
  const joinConfirmBtn = scene.add
    .text(W / 2, panelY + 195, "[ JOIN ]", {
      color: "#66bb6a",
      fontSize: "16px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  const joinBackBtn = scene.add
    .text(W / 2, panelY + 225, "[ BACK ]", {
      color: "#aaaaaa",
      fontSize: "12px",
      fontFamily: "monospace",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });

  const hintText = scene.add
    .text(
      W / 2,
      panelY + PANEL_H - 18,
      "[ESC] or click outside to close",
      {
        color: "#888888",
        fontSize: "10px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 2,
      },
    )
    .setOrigin(0.5)
    .setScrollFactor(0);

  root.add([
    overlay,
    panelBlocker,
    panelBg,
    titleText,
    createBtn,
    joinBtn,
    soloBtn,
    currentCodeLabel,
    currentCodeValue,
    leaveBtn,
    joinLabel,
    inputBox,
    inputDisplay,
    joinErrorText,
    joinConfirmBtn,
    joinBackBtn,
    hintText,
  ]);

  let activeView: LobbyDialogView = "main";
  let activeCallbacks: MultiplayerDialogCallbacks | null = null;
  /**
   * The code we already auto-submitted for. Guards against firing the
   * join twice for the same value (the DOM input fires an `input`
   * event per character, and a paste fires it once with everything).
   * Cleared on failure so the same code can be retried.
   */
  let autoJoinCode = "";

  const syncFromDom = () => {
    const v = domInput.value.toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (v !== domInput.value) domInput.value = v;
    inputDisplay.setText(v);
    // AUTO-JOIN: a complete 6-character code is all the player has to
    // type - the lookup + join fire the moment the last character
    // lands. No extra button press, no second step.
    if (/^[0-9A-Z]{6}$/.test(v) && v !== autoJoinCode) {
      autoJoinCode = v;
      submitJoin(v, true);
    }
  };
  domInput.addEventListener("input", syncFromDom);
  domInput.addEventListener("focus", () => drawInputBox(true));
  domInput.addEventListener("blur", () => drawInputBox(false));

  /**
   * Run the lobby lookup + join for a code. `automatic` marks the
   * auto-submitted path (different status wording only).
   */
  function submitJoin(code: string, automatic: boolean): void {
    if (!activeCallbacks) return;
    joinErrorText.setText(
      automatic ? "Joining lobby..." : "Looking up lobby...",
    );
    joinErrorText.setColor("#cccccc");
    activeCallbacks.onJoin(code, (msg) => {
      joinErrorText.setText(msg);
      joinErrorText.setColor("#ff5555");
      // Let the same code be tried again (the next input event fires
      // the auto-join once more).
      autoJoinCode = "";
    });
  }

  function setMainViewForLobby(inCodeLobby: boolean, currentCode?: string) {
    createBtn.setVisible(!inCodeLobby);
    joinBtn.setVisible(!inCodeLobby);
    soloBtn.setVisible(!inCodeLobby);
    currentCodeLabel.setVisible(inCodeLobby);
    currentCodeValue.setVisible(inCodeLobby);
    leaveBtn.setVisible(inCodeLobby);
    if (inCodeLobby) {
      currentCodeLabel.setText("CURRENT LOBBY CODE");
      currentCodeValue.setText(currentCode || "------");
    }
    joinLabel.setVisible(false);
    inputBox.setVisible(false);
    inputDisplay.setVisible(false);
    joinErrorText.setVisible(false);
    joinConfirmBtn.setVisible(false);
    joinBackBtn.setVisible(false);
    try {
      domInput.blur();
    } catch {
      /* ignore */
    }
  }

  function setJoiningView() {
    createBtn.setVisible(false);
    joinBtn.setVisible(false);
    soloBtn.setVisible(false);
    currentCodeLabel.setVisible(false);
    currentCodeValue.setVisible(false);
    leaveBtn.setVisible(false);
    joinLabel.setVisible(true);
    inputBox.setVisible(true);
    inputDisplay.setVisible(true);
    inputDisplay.setText("");
    joinErrorText.setVisible(true);
    joinErrorText.setText("");
    joinConfirmBtn.setVisible(true);
    joinBackBtn.setVisible(true);
    domInput.value = "";
    // A fresh attempt - the next complete code auto-joins again.
    autoJoinCode = "";
    scene.time.delayedCall(10, () => {
      try {
        domInput.focus({ preventScroll: true } as any);
      } catch {
        /* ignore */
      }
    });
  }

  function hide() {
    root.setVisible(false);
    try {
      domInput.blur();
    } catch {
      /* ignore */
    }
  }
  // Clicking outside the panel dismisses the dialog in EVERY view,
  // exactly like ESC does. The rule is "outside click == ESC".
  overlay.on("pointerdown", () => {
    hide();
  });

  createBtn.on("pointerdown", () => {
    if (!activeCallbacks) return;
    hintText.setText("Creating lobby...");
    hintText.setColor("#cccccc");
    activeCallbacks.onCreate(
      (code, roomId) => {
        // The lobby now exists on the server - put the creator
        // STRAIGHT into it. The code is copied to the clipboard so it
        // can be shared immediately (it also shows in the lobby's top
        // bar), and the dialog closes itself: there is no separate
        // "ENTER LOBBY" step.
        copyToClipboard(code);
        hide();
        activeView = "main";
        try {
          activeCallbacks?.onCreateConfirmed(code, roomId);
        } catch (e) {
          console.error("[multiplayerDialog] onCreateConfirmed threw:", e);
        }
      },
      (msg) => {
        activeView = "main";
        setMainViewForLobby(
          activeCallbacks?.inCodeLobby ?? false,
          activeCallbacks?.currentCode,
        );
        hintText.setText("ERROR: " + msg);
        hintText.setColor("#ff5555");
        scene.time.delayedCall(2400, () => {
          hintText.setText("[ESC] or click outside to close");
          hintText.setColor("#888888");
        });
      },
    );
  });

  joinBtn.on("pointerdown", () => {
    activeView = "joining";
    setJoiningView();
  });
  soloBtn.on("pointerdown", () => {
    if (!activeCallbacks) return;
    hide();
    activeCallbacks.onSoloPlay();
  });
  leaveBtn.on("pointerdown", () => {
    if (!activeCallbacks) return;
    hide();
    activeCallbacks.onLeave();
  });
  joinBackBtn.on("pointerdown", () => {
    activeView = "main";
    setMainViewForLobby(
      activeCallbacks?.inCodeLobby ?? false,
      activeCallbacks?.currentCode,
    );
  });
  joinConfirmBtn.on("pointerdown", () => {
    if (!activeCallbacks) return;
    const code = (domInput.value || "").toUpperCase().trim();
    if (!/^[0-9A-Z]{6}$/.test(code)) {
      joinErrorText.setText("Code must be 6 alphanumeric characters.");
      joinErrorText.setColor("#ff5555");
      return;
    }
    submitJoin(code, false);
  });

  domInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      joinConfirmBtn.emit("pointerdown");
    }
  });

  scene.input.keyboard?.on("keydown-ESC", () => {
    if (root.visible) hide();
  });

  function show(callbacks: MultiplayerDialogCallbacks) {
    activeCallbacks = callbacks;
    activeView = "main";
    autoJoinCode = "";
    setMainViewForLobby(callbacks.inCodeLobby, callbacks.currentCode);
    hintText.setText("[ESC] or click outside to close");
    hintText.setColor("#888888");
    root.setVisible(true);
  }

  return {
    root,
    show,
    hide,
    isVisible: () => root.visible,
  };
}

function copyToClipboard(text: string): void {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      navigator.clipboard.writeText(text).catch((e) => {
        console.warn("[multiplayerDialog] clipboard.writeText rejected:", e);
        fallbackCopy(text);
      });
      return;
    }
  } catch {
    /* fall through to fallback */
  }
  fallbackCopy(text);
}
function fallbackCopy(text: string): void {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (e) {
    console.warn("[multiplayerDialog] clipboard fallback failed:", e);
  }
}
