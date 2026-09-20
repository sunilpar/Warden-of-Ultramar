/**
 * Entity Renderer System
 * ======================
 * Per-tick visual update for synced entities:
 *   - local player hit-flash / dash alpha
 *   - remote player interpolation + walk/idle animation
 *   - enemy interpolation + facing + idle/attack animation + hit flash
 *   - enemy floating HP bar follow / fill / shield overlay / level text
 *   - live hitbox debug overlay (F3)
 *
 * This is the ONLY place that consumes the `serverX`/`serverY` data keys
 * written by the Colyseus onChange listeners in GameScene.
 */
import Phaser from "phaser";

export interface EntityRendererScene {
  room: any;
  currentPlayer: Phaser.GameObjects.Sprite;
  currentPlayerState: any;
  playerEntities: { [sessionId: string]: Phaser.GameObjects.Sprite };
  enemyEntities: { [id: string]: Phaser.GameObjects.Sprite };
  enemyHpBars: { [id: string]: Phaser.GameObjects.Container };
  projectileEntities: { [id: string]: Phaser.GameObjects.Sprite };
  clawEntities: { [id: string]: Phaser.GameObjects.Sprite };
  debugEntityHitboxes: Phaser.GameObjects.Graphics | null;
  showHitboxes: boolean;
}

/** Tint local player on hit (blue when shielded, white otherwise). */
function updateLocalPlayerFlash(scene: EntityRendererScene, now: number): void {
  const p = scene.currentPlayer;
  if (!p) return;
  // Client-authoritative flash (set in GameScene on hitSeq change).
  const flashUntil = p.data.get("clientFlashUntil") as number;
  const flashShielded = p.data.get("flashShielded") as boolean;
  const localShock = p.data.get("shockUntil") as number;
  if (flashUntil && now < flashUntil) {
    p.setTintFill(flashShielded ? 0x33b5ff : 0xffffff);
  } else if (localShock && now < localShock) {
    p.setTint(0xb266ff);
  } else {
    p.clearTint();
  }
}

/** Dash invincibility: semi-transparent while invincible. */
function updateLocalPlayerAlpha(scene: EntityRendererScene, now: number): void {
  const p = scene.currentPlayer;
  if (!p) return;
  const invUntil = p.data.get("invincibleUntil") as number;
  if (invUntil && now < invUntil) p.setAlpha(0.4);
  else p.setAlpha(1);
}

/** Interpolate remote players toward their server position + anims. */
function updateRemotePlayers(scene: EntityRendererScene): void {
  const now = Date.now();
  for (const sessionId in scene.playerEntities) {
    if (scene.room && sessionId === scene.room.sessionId) continue;

    const entity = scene.playerEntities[sessionId];
    const serverX = entity.data.get("serverX") as number;
    const serverY = entity.data.get("serverY") as number;

    if (serverX !== undefined && serverY !== undefined) {
      const dx = serverX - entity.x;
      const dy = serverY - entity.y;
      const dist = Math.hypot(dx, dy);

      entity.x = Phaser.Math.Linear(entity.x, serverX, 0.2);
      entity.y = Phaser.Math.Linear(entity.y, serverY, 0.2);

      // Facing is derived client-side from the position delta because the
      // Player schema does not sync facing direction.
      const moving = dist > 1.5;
      let direction = entity.data.get("lastDirection") as string;
      if (direction !== "left" && direction !== "right") direction = "left";

      if (moving && Math.abs(dx) > 1) {
        direction = dx > 0 ? "right" : "left";
      }
      entity.setData("lastDirection", direction);

      if (moving) {
        const animKey =
          direction === "right" ? "player_walk_right" : "player_walk_left";
        const currentAnim = entity.anims.currentAnim;
        if (!currentAnim || currentAnim.key !== animKey) {
          entity.anims.play(animKey);
        }
        entity.setFlipX(false);
      } else {
        const currentAnim = entity.anims.currentAnim;
        if (!currentAnim || currentAnim.key !== "player_idle") {
          entity.anims.play("player_idle");
        }
        entity.setFlipX(direction === "right");
      }
    }

    const flashUntil = entity.data.get("clientFlashUntil") as number;
    const flashShielded = entity.data.get("flashShielded") as boolean;
    if (flashUntil && now < flashUntil) {
      entity.setTintFill(flashShielded ? 0x33b5ff : 0xffffff);
    } else {
      entity.clearTint();
    }
  }
}

/** Texture key -> [idleAnim, attackAnim] for every enemy type. */
const ENEMY_ANIMS: Record<string, [string, string]> = {
  tau_sheet: ["tau_idle", "tau_attack"],
  mechanicus_sheet: ["mechanicus_idle", "mechanicus_attack"],
  caster_sheet: ["caster_idle", "caster_attack"],
  orck_sheet: ["orck_idle", "orck_attack"],
  tyranid_sheet: ["tri_idle", "tri_attack"],
};

/** Interpolate enemies toward their server position + facing + anims + HP bar. */
function updateEnemies(scene: EntityRendererScene, now: number): void {
  for (const enemyId in scene.enemyEntities) {
    const entity = scene.enemyEntities[enemyId];
    const serverX = entity.data.get("serverX") as number;
    const serverY = entity.data.get("serverY") as number;

    // Smoother interpolation (higher factor = snappier).
    if (serverX !== undefined && serverY !== undefined) {
      entity.x = Phaser.Math.Linear(entity.x, serverX, 0.35);
      entity.y = Phaser.Math.Linear(entity.y, serverY, 0.35);
    }

    // Facing: sprite faces LEFT by default; flip horizontally when right.
    const facingRight = entity.data.get("facingRight") as boolean;
    entity.setFlipX(!!facingRight);

    // Animation: attack when attacking, otherwise idle (shown for move+stand).
    const attacking = entity.data.get("attacking") as boolean;
    const [idleKey, atkKey] = ENEMY_ANIMS[entity.texture.key] ??
      ENEMY_ANIMS.tyranid_sheet;
    const eAnim = entity.anims.currentAnim;
    if (attacking) {
      if (!eAnim || eAnim.key !== atkKey) entity.anims.play(atkKey);
    } else {
      if (!eAnim || eAnim.key !== idleKey) entity.anims.play(idleKey);
    }

    // Client-authoritative hit flash (white; blue when shield absorbed).
    const flashUntil = entity.data.get("clientFlashUntil") as number;
    const flashShielded = entity.data.get("flashShielded") as boolean;
    const shockUntil = entity.data.get("shockUntil") as number;
    if (flashUntil && now < flashUntil) {
      entity.setTintFill(flashShielded ? 0x33b5ff : 0xffffff);
    } else if (shockUntil && now < shockUntil) {
      entity.setTint(0xb266ff);
    } else {
      entity.clearTint();
    }

    // Invincibility opacity (dash)
    const enemyInvUntil = entity.data.get("invincibleUntil") as number;
    if (enemyInvUntil && now < enemyInvUntil) entity.setAlpha(0.4);
    else entity.setAlpha(1);

    // ---- Floating HP bar ----
    const hpBar = scene.enemyHpBars[enemyId];
    if (hpBar) {
      hpBar.setPosition(entity.x, entity.y);
      const fill = hpBar.getAt(1) as Phaser.GameObjects.Rectangle;
      const shieldFillEl = hpBar.getAt(2) as Phaser.GameObjects.Rectangle;
      const lvText = hpBar.getAt(3) as Phaser.GameObjects.Text;
      const hp = entity.data.get("hp") as number;
      const maxHp = entity.data.get("maxHp") as number;
      if (fill && maxHp > 0) {
        fill.scaleX = Math.max(0, hp / maxHp);
      }
      // Shield overlay: hidden when the enemy has no shield.
      if (shieldFillEl) {
        const sh = entity.data.get("shield") as number;
        const maxSh = entity.data.get("maxShield") as number;
        if (maxSh > 0 && sh > 0) {
          shieldFillEl.setVisible(true);
          shieldFillEl.scaleX = Math.max(0, sh / maxSh);
        } else {
          shieldFillEl.setVisible(false);
        }
      }
      if (lvText) {
        const lv = entity.data.get("level") as number;
        const newText = String(lv ?? 1);
        if (lvText.text !== newText) lvText.setText(newText);
      }
    }
  }
}

/**
 * Redraw the live entity hitbox overlay (call each frame).
 * Only draws when showHitboxes is true (toggle F3).
 *
 * Colors:
 *   GREEN  (rect)    = player hitbox
 *   RED    (rect)    = enemy hitbox
 *   BLUE   (circle)  = bolter projectile hitbox (radius 6)
 *   ORANGE (cone)    = claw skill VFX hitbox
 *   PURPLE (circle)  = pulse skill VFX hitbox
 */
export function updateEntityHitboxes(scene: EntityRendererScene): void {
  const gfx = scene.debugEntityHitboxes;
  if (!gfx) return;
  gfx.clear();
  if (!scene.showHitboxes) return;

  // ---- Players (GREEN rectangles) ----
  gfx.lineStyle(1.5, 0x00ff00, 0.9);
  if (scene.currentPlayer) {
    const pw = (scene.currentPlayer.data.get("hitboxW") as number) ?? 10;
    const ph = (scene.currentPlayer.data.get("hitboxH") as number) ?? 10;
    gfx.strokeRect(
      scene.currentPlayer.x - pw,
      scene.currentPlayer.y - ph,
      pw * 2,
      ph * 2,
    );
  }
  for (const sessionId in scene.playerEntities) {
    if (scene.room && sessionId === scene.room.sessionId) continue;
    const sp = scene.playerEntities[sessionId];
    const pw = (sp.data.get("hitboxW") as number) ?? 10;
    const ph = (sp.data.get("hitboxH") as number) ?? 10;
    gfx.strokeRect(sp.x - pw, sp.y - ph, pw * 2, ph * 2);
  }

  // ---- Enemies (RED rectangles) ----
  gfx.lineStyle(1.5, 0xff0000, 0.9);
  for (const id in scene.enemyEntities) {
    const sp = scene.enemyEntities[id];
    const ew = (sp.data.get("hitboxW") as number) ?? 12;
    const eh = (sp.data.get("hitboxH") as number) ?? 12;
    gfx.strokeRect(sp.x - ew, sp.y - eh, ew * 2, eh * 2);
  }

  // ---- Bolter projectiles (BLUE circles) ----
  gfx.lineStyle(1.5, 0x00aaff, 0.9);
  for (const id in scene.projectileEntities) {
    const e = scene.projectileEntities[id];
    gfx.strokeCircle(e.x, e.y, 6);
  }

  // ---- Claw VFX (ORANGE cones) / Pulse VFX (PURPLE circles) ----
  for (const id in scene.clawEntities) {
    const e = scene.clawEntities[id];
    const castData = (e as any).castData as any;
    if (!castData) continue;
    const range = castData.range || 60;
    if (castData.skillId === "pulse") {
      gfx.lineStyle(1.5, 0xb266ff, 0.8);
      const cx = castData.x ?? e.x;
      const cy = castData.y ?? e.y;
      gfx.strokeCircle(cx, cy, castData.range || 80);
      continue;
    }
    gfx.lineStyle(1.5, 0xff8800, 0.8);
    const tier: string = castData.tier || "small";
    const halfAngle = tier === "big" ? 0.9 : tier === "mid" ? 0.7 : 0.5;
    const angle = castData.angle ?? e.rotation ?? 0;
    const cx = castData.x ?? e.x;
    const cy = castData.y ?? e.y;
    gfx.beginPath();
    gfx.moveTo(cx, cy);
    gfx.lineTo(cx + Math.cos(angle - halfAngle) * range, cy + Math.sin(angle - halfAngle) * range);
    gfx.moveTo(cx, cy);
    gfx.lineTo(cx + Math.cos(angle + halfAngle) * range, cy + Math.sin(angle + halfAngle) * range);
    gfx.strokePath();
    gfx.beginPath();
    gfx.arc(cx, cy, range, angle - halfAngle, angle + halfAngle);
    gfx.strokePath();
  }
}

/**
 * Per-tick visual update for ALL synced entities.
 * Call from GameScene.fixedTick() after local-player prediction.
 */
export function updateEntityVisuals(scene: EntityRendererScene): void {
  const now = Date.now();
  updateLocalPlayerFlash(scene, now);
  updateLocalPlayerAlpha(scene, now);
  updateRemotePlayers(scene);
  updateEnemies(scene, now);
  updateEntityHitboxes(scene);
}
