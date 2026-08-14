/**
 * Pulse System
 * ============
 * Lightning damage in a circle around the caster. Ignores walls.
 * L5+: chance to inflict shock (reduces defence by 20%, slows by 50%).
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { SkillCast } from "../schema/SkillCast";
import {
  applyCrit,
  pulseDamage,
  pulseRadius,
  pulseShockChance,
} from "../config/skillDefs";
import type { SkillId } from "../config/skillDefs";

const PULSE_SHOCK_DURATION_MS = 10000; // 10 seconds

export class PulseSystem {
  private nextId = 1;

  constructor(private state: RoomState) {}

  /**
   * Cast pulse for a player.
   * Returns true if the pulse was applied.
   */
  castPlayerPulse(
    player: Player,
    sessionId: string,
    skillLevel: number,
    critRate: number,
    critDamage: number,
  ): boolean {
    if (skillLevel <= 0) return false;

    const damage = pulseDamage(skillLevel);
    const radius = pulseRadius(skillLevel);
    const shockChance = pulseShockChance(skillLevel);
    const now = Date.now();

    // Damage all enemies in radius
    this.state.enemies.forEach((enemy) => {
      if (enemy.isDead) return;
      const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
      if (dist <= radius) {
        const { damage: finalDamage, isCrit } = applyCrit(
          damage,
          critRate,
          critDamage,
        );
        enemy.takeDamage(finalDamage, "pulse", sessionId, isCrit);
        // Shock chance
        if (shockChance > 0 && Math.random() < shockChance) {
          enemy.shockUntil = now + PULSE_SHOCK_DURATION_MS;
          enemy.recalcDerivedStats();
        }
      }
    });

    // Spawn VFX via SkillCast
    this.spawnPulseVfx(player.x, player.y, radius, skillLevel, "player");
    return true;
  }

  /**
   * Cast pulse for an enemy (AI usage).
   */
  castEnemyPulse(
    enemy: Enemy,
    skillLevel: number = 1,
    critRate: number = 0,
    critDamage: number = 1.5,
  ): boolean {
    const damage = pulseDamage(skillLevel);
    const radius = pulseRadius(skillLevel);
    const shockChance = pulseShockChance(skillLevel);
    const now = Date.now();

    // Damage all players in radius
    this.state.players.forEach((p) => {
      if (p.isDead) return;
      const dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
      if (dist <= radius) {
        const { damage: finalDamage, isCrit } = applyCrit(
          damage,
          critRate,
          critDamage,
        );
        p.takeDamage(finalDamage, "pulse", undefined, isCrit);
        if (shockChance > 0 && Math.random() < shockChance) {
          p.shockUntil = now + PULSE_SHOCK_DURATION_MS;
          p.recalcDerivedStats();
        }
      }
    });

    this.spawnPulseVfx(enemy.x, enemy.y, radius, skillLevel, "enemy");
    return true;
  }

  /** Spawn a pulse VFX via the SkillCast collection. */
  private spawnPulseVfx(
    x: number,
    y: number,
    radius: number,
    level: number,
    faction: string,
  ): void {
    const cast = new SkillCast();
    cast.x = x;
    cast.y = y;
    cast.skillId = "pulse";
    cast.faction = faction;
    cast.range = radius;
    cast.level = level;
    cast.tier = level >= 6 ? "big" : "small";
    cast.angle = 0;
    const id = `pulse_${this.nextId++}_${Date.now()}`;
    this.state.skillCasts.set(id, cast);
    // Auto-remove after 600ms (client animation)
    setTimeout(() => {
      this.state.skillCasts.delete(id);
    }, 600);
  }
}
