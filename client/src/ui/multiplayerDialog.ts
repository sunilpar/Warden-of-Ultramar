/**
 * Multiplayer Lobby Code Dialog
 * =============================
 * Modal that opens when the player clicks the "MULTIPLYER" polygon in
 * the lobby. Three views inside one panel:
 *
 *   1. MAIN      - Two big buttons: "CREATE LOBBY" / "JOIN LOBBY".
 *                  Also shows a "LEAVE LOBBY" button + the current
 *                  code when the caller reports they are already in
 *                  a code lobby.
 *   2. CREATED   - The freshly minted 6-char code in giant monospace,
 *                  with explicit COPY CODE + ENTER LOBBY buttons.
 *                  The code stays visible until the user clicks
 *                  ENTER LOBBY (overlay-click is disabled here so
 *                  they cant accidentally dismiss it).
 *   3. JOINING   - Single-line input + JOIN + error slot + BACK.
 *
 * Out-of-band dismissal:
 *   - Click anywhere outside the panel -> hide() (main view only).
 *   - Press Escape -> hide() (main view only).
 */
import Phaser from "phaser";
import { BACKEND_HTTP_URL } from "../backend";

export type LobbyDialogView = "main" | "created" | "joining";

export interface MultiplayerDialogCallbacks {
  /**
   * Called when the player picks CREATE LOBBY. The caller should
   * POST /api/lobby/create and on success call
   * showCreated(code, roomId) to flip the panel to the success view
   * (with the code + roomId for later use). On failure call
   * showError(msg) to surface the failure.
   *
   * The caller should NOT join the room yet - the panel stays open
   * in the "created" view until the user explicitly clicks
   * ENTER LOBBY, which fires onCreateConfirmed.
   */
  onCreate: (
    showCreated: (code: string, roomId: string) => void,
    showError: (msg: string) => void,
  ) => void;
  /**
   * Called when the player clicks ENTER LOBBY in the created view.
   * The dialog has already been hidden; the caller is responsible
   * for actually joining the room (typically via swapToRoom(roomId)).
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
  showCreated: (code: string, roomId: string) => void;
  setError: (msg: string | null) => void;
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

  const createdLabel = scene.add
    .text(W / 2, panelY + 64, "YOUR LOBBY CODE", {
      color: "#cccccc",
      fontSize: "12px",
      fontFamily: "monospace",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0);
  // The code itself - big, no quotes, easy to read.
  const createdCode = scene.add
    .text(W / 2, panelY + 100, "------", {
      color: "#66bb6a",
      fontSize: "36px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 4,
    })
    .setOrigin(0.5)
    .setScrollFactor(0);
  // Status text - flashes "COPIED" / "COPY FAILED" briefly.
  const createdCopiedHint = scene.add
    .text(W / 2, panelY + 150, "", {
      color: "#66bb6a",
      fontSize: "12px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0);
  // Explicit COPY CODE button.
  const copyCodeBtn = scene.add
    .text(W / 2, panelY + 180, "[ COPY CODE ]", {
      color: "#4fc3f7",
      fontSize: "14px",
      fontFamily: "monospace",
      fontStyle: "bold",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  const createdShareHint = scene.add
    .text(
      W / 2,
      panelY + 210,
      "Share it with a friend, then click ENTER LOBBY.",
      {
        color: "#cccccc",
        fontSize: "11px",
        fontFamily: "monospace",
        stroke: "#000000",
        strokeThickness: 2,
        wordWrap: { width: PANEL_W - 40 },
        align: "center",
      },
    )
    .setOrigin(0.5)
    .setScrollFactor(0);
  // ENTER LOBBY - the explicit commit. Replaces the old CLOSE.
  const createdCloseBtn = scene.add
    .text(W / 2, panelY + 260, "[ ENTER LOBBY ]", {
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

  const syncFromDom = () => {
    const v = domInput.value.toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (v !== domInput.value) domInput.value = v;
    inputDisplay.setText(v);
  };
  domInput.addEventListener("input", syncFromDom);
  domInput.addEventListener("focus", () => drawInputBox(true));
  domInput.addEventListener("blur", () => drawInputBox(false));

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
    panelBg,
    titleText,
    createBtn,
    joinBtn,
    soloBtn,
    currentCodeLabel,
    currentCodeValue,
    leaveBtn,
    createdLabel,
    createdCode,
    createdCopiedHint,
    copyCodeBtn,
    createdShareHint,
    createdCloseBtn,
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
  // Code + roomId stashed when the caller hands them in via
  // showCreated(). ENTER LOBBY uses these to call onCreateConfirmed.
  let pendingCode: string = "";
  let pendingRoomId: string = "";

  // Briefly show a status text under the COPY CODE button. Used by
  // the auto-copy on view open AND by explicit [COPY CODE] clicks.
  let copyStatusTimer: Phaser.Time.TimerEvent | null = null;
  function flashCopyStatus(msg: string, ok: boolean = true) {
    createdCopiedHint.setText(msg);
    createdCopiedHint.setColor(ok ? "#66bb6a" : "#ff5555");
    createdCopiedHint.setVisible(true);
    if (copyStatusTimer) {
      copyStatusTimer.remove(false);
      copyStatusTimer = null;
    }
    copyStatusTimer = scene.time.delayedCall(1500, () => {
      createdCopiedHint.setText("COPIED TO CLIPBOARD");
      createdCopiedHint.setColor("#66bb6a");
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
    createdLabel.setVisible(false);
    createdCode.setVisible(false);
    createdCopiedHint.setVisible(false);
    copyCodeBtn.setVisible(false);
    createdShareHint.setVisible(false);
    createdCloseBtn.setVisible(false);
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

  function setCreatedView(code: string, roomId: string) {
    createBtn.setVisible(false);
    joinBtn.setVisible(false);
    soloBtn.setVisible(false);
    currentCodeLabel.setVisible(false);
    currentCodeValue.setVisible(false);
    leaveBtn.setVisible(false);
    createdLabel.setVisible(true);
    createdCode.setVisible(true);
    // No quotes - the code IS alphanumeric, no need to surround it.
    createdCode.setText(code);
    createdCode.setFontSize(36);
    createdCopiedHint.setText("COPIED TO CLIPBOARD");
    createdCopiedHint.setVisible(true);
    copyCodeBtn.setVisible(true);
    createdShareHint.setVisible(true);
    createdCloseBtn.setVisible(true);
    joinLabel.setVisible(false);
    inputBox.setVisible(false);
    inputDisplay.setVisible(false);
    joinErrorText.setVisible(false);
    joinConfirmBtn.setVisible(false);
    joinBackBtn.setVisible(false);
    // Stash for ENTER LOBBY click.
    pendingCode = code;
    pendingRoomId = roomId;
    // Auto-copy on view open. The user can still click [COPY CODE]
    // to re-copy if the auto-copy failed (clipboard permission denied).
    flashCopyStatus("COPIED TO CLIPBOARD");
    copyToClipboard(code);
  }

  function setJoiningView() {
    createBtn.setVisible(false);
    joinBtn.setVisible(false);
    soloBtn.setVisible(false);
    currentCodeLabel.setVisible(false);
    currentCodeValue.setVisible(false);
    leaveBtn.setVisible(false);
    createdLabel.setVisible(false);
    createdCode.setVisible(false);
    createdCopiedHint.setVisible(false);
    copyCodeBtn.setVisible(false);
    createdShareHint.setVisible(false);
    createdCloseBtn.setVisible(false);
    joinLabel.setVisible(true);
    inputBox.setVisible(true);
    inputDisplay.setVisible(true);
    inputDisplay.setText("");
    joinErrorText.setVisible(true);
    joinErrorText.setText("");
    joinConfirmBtn.setVisible(true);
    joinBackBtn.setVisible(true);
    domInput.value = "";
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
  // Overlay click closes the dialog ONLY in the "main" view. In
  // "created" we disable overlay-click so the code stays visible
  // until the user explicitly clicks ENTER LOBBY (no accidental
  // dismissals that lose the code).
  overlay.on("pointerdown", () => {
    if (activeView === "main") hide();
  });

  copyCodeBtn.on("pointerdown", () => {
    if (!pendingCode) return;
    try {
      copyToClipboard(pendingCode);
      flashCopyStatus("COPIED TO CLIPBOARD");
    } catch (e) {
      flashCopyStatus("COPY FAILED", false);
    }
  });

  createBtn.on("pointerdown", () => {
    if (!activeCallbacks) return;
    activeView = "created";
    // Flip to a placeholder so the panel layout is right while we
    // wait for the server. The real code + roomId are passed in
    // via showCreated() when the fetch resolves.
    setMainViewForLobby(false);
    createdLabel.setVisible(true);
    createdCode.setVisible(true);
    createdCode.setText("------");
    createdCopiedHint.setVisible(false);
    copyCodeBtn.setVisible(false);
    createdShareHint.setVisible(false);
    createdCloseBtn.setVisible(false);
    activeCallbacks.onCreate(
      (code, roomId) => {
        setCreatedView(code, roomId);
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

  createdCloseBtn.on("pointerdown", () => {
    // ENTER LOBBY - hide the dialog and ask the caller to actually
    // join the room. Doing it in two steps (dialog first, then
    // join) means the code stays visible until the user explicitly
    // confirms, instead of vanishing mid-click.
    if (!activeCallbacks) return;
    const code = pendingCode;
    const roomId = pendingRoomId;
    hide();
    if (code && roomId) {
      try {
        activeCallbacks.onCreateConfirmed(code, roomId);
      } catch (e) {
        console.error("[multiplayerDialog] onCreateConfirmed threw:", e);
      }
    }
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
    joinErrorText.setText("Looking up lobby...");
    joinErrorText.setColor("#cccccc");
    activeCallbacks.onJoin(code, (msg) => {
      joinErrorText.setText(msg);
      joinErrorText.setColor("#ff5555");
    });
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
    pendingCode = "";
    pendingRoomId = "";
    setMainViewForLobby(callbacks.inCodeLobby, callbacks.currentCode);
    hintText.setText("[ESC] or click outside to close");
    hintText.setColor("#888888");
    root.setVisible(true);
  }

  function showCreated(code: string, roomId: string) {
    activeView = "created";
    setCreatedView(code, roomId);
  }

  function setError(msg: string | null) {
    joinErrorText.setText(msg || "");
    joinErrorText.setColor(msg ? "#ff5555" : "#cccccc");
  }

  return {
    root,
    show,
    hide,
    isVisible: () => root.visible,
    showCreated,
    setError,
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
