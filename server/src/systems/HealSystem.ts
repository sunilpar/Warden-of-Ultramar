/**
 * Heal System
 * ===========
 * Handles the heal skill for both players and enemies.
 *
 * L1-4: Self-only heal. Recharged by kills (5 kills per use).
 * L5-10: AoE heal — heals all players AND enemies in a radius.
 *         Cooldown-based (10s). Heal amount frozen at L4 value.
 *
 * VFX is synced via the SkillCast collection (skillId = "heal").
 * The client renders a green flash for self-heal or a green circle for AoE.
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { SkillCast } from "../schema/SkillCast";
import {
  SKILL_DEFS,
  healAmount,
  healPercent,
  healRadius,
} from "../config/skillDefs";
import type { SkillId } from "../config/skillDefs";

export class HealSystem {
  private nextId = 1;

  constructor(private state: RoomState) {}

  /**
   * Cast heal for a player.
   * Returns true if the heal was applied.
   */
  castPlayerHeal(player: Player, sessionId: string): boolean {
    const level = player.getSkillLevel("heal");
    if (level <= 0) return false;
    if (!player.isSkillReady("heal")) return false;

    const def = SKILL_DEFS.heal;
    const amount = healAmount(level);
    const radius = healRadius(level);
    const pct = healPercent(level);

    if (level >= def.aoeUnlockLevel) {
      // AoE heal: heal all players + enemies in radius
      this.state.players.forEach((p) => {
        if (p.isDead) return;
        const dist = Math.hypot(p.x - player.x, p.y - player.y);
        if (dist <= radius) {
          const healAmt = pct > 0 ? Math.round(p.maxHealth * pct) : amount;
          p.heal(healAmt);
        }
      });
      this.state.enemies.forEach((e) => {
        if (e.isDead) return;
        const dist = Math.hypot(e.x - player.x, e.y - player.y);
        if (dist <= radius) {
          const healAmt = pct > 0 ? Math.round(e.maxHealth * pct) : amount;
          e.heal(healAmt);
        }
      });
      // Cooldown-based
      player.startSkillCooldown("heal", def.cooldown);
      // VFX: AoE circle
      this.spawnHealVfx(player.x, player.y, radius, "player");
    } else {
      // Self-only heal
      player.heal(amount);
      // Kill-charge: consume readiness, reset kills
      player.healReady = false;
      player.healKills = 0;
      // VFX: green flash on self
      this.spawnHealVfx(player.x, player.y, 0, "player");
    }

    return true;
  }

  /**
   * Cast heal for an enemy (AI usage).
   * Enemies always use AoE mode if level >= 5, otherwise self-heal.
   */
  castEnemyHeal(enemy: Enemy, level: number = 1): boolean {
    const def = SKILL_DEFS.heal;
    const amount = healAmount(level);
    const radius = healRadius(level);
    const pct = healPercent(level);

    if (level >= def.aoeUnlockLevel) {
      this.state.players.forEach((p) => {
        if (p.isDead) return;
        const dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
        if (dist <= radius) {
          const healAmt = pct > 0 ? Math.round(p.maxHealth * pct) : amount;
          p.heal(healAmt);
        }
      });
      this.state.enemies.forEach((e) => {
        if (e.isDead) return;
        const dist = Math.hypot(e.x - enemy.x, e.y - enemy.y);
        if (dist <= radius) {
          const healAmt = pct > 0 ? Math.round(e.maxHealth * pct) : amount;
          e.heal(healAmt);
        }
      });
      this.spawnHealVfx(enemy.x, enemy.y, radius, "enemy");
    } else {
      enemy.heal(amount);
      this.spawnHealVfx(enemy.x, enemy.y, 0, "enemy");
    }

    return true;
  }

  /** Spawn a heal VFX via the SkillCast collection. */
  private spawnHealVfx(x: number, y: number, radius: number, faction: string): void {
    const cast = new SkillCast();
    cast.x = x;
    cast.y = y;
    cast.skillId = "heal";
    cast.faction = faction;
    cast.range = radius; // 0 = self-heal flash, >0 = AoE circle
    cast.level = 1;
    cast.tier = "small";
    cast.angle = 0;
    const id = `heal_${this.nextId++}_${Date.now()}`;
    this.state.skillCasts.set(id, cast);
    // Auto-remove after 800ms (client animation duration)
    setTimeout(() => {
      this.state.skillCasts.delete(id);
    }, 800);
  }
}
