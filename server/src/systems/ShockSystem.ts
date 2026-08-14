/**
 * Shock System
 * ============
 * Chain lightning skill. Finds enemies in a cone, damages them, and
 * chains to nearby enemies with damage falloff.
 *
 * Level scaling:
 *   Targets: L1=1, L2=2, L3=2, L4=3, L5=3, L6=4, L7=4, L8=5, L9=5, L10=5
 *   Chains: L1-4=0, L5=1, L6=1, L7=2, L8=2, L9=3, L10=3
 *   Damage: +10% at L2,4,6,8,10
 *   Range: +30px at L1,3,5,7,9
 */
import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { ShockCast } from "../schema/ShockCast";
import {
  applyCrit,
  shockDamage,
  shockRange,
  shockTargets,
  shockChains,
  shockChainRadius,
  SHOCK,
} from "../config/skillDefs";

const SEGMENT_TTL_MS = 1200;

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  delay: number;
}

export class ShockSystem {
  private nextId = 1;

  constructor(private state: RoomState) {}

  castPlayerShock(
    player: Player,
    sessionId: string,
    skillLevel: number,
    critRate: number,
    critDamage: number,
    aimAngle: number,
  ): boolean {
    if (skillLevel <= 0) return false;

    const dmg = shockDamage(skillLevel);
    const range = shockRange(skillLevel);
    const maxTargets = shockTargets(skillLevel);
    const maxChains = shockChains(skillLevel);
    const chainRadius = shockChainRadius(skillLevel);
    const halfAngle = SHOCK.coneHalfAngle;

    const inCone = this.findEnemiesInCone(
      player.x,
      player.y,
      aimAngle,
      range,
      halfAngle,
    );
    const targets = inCone.slice(0, maxTargets);

    // If no enemies found, still show VFX traveling to the edge of the cone
    if (targets.length === 0) {
      const edgeX = player.x + Math.cos(aimAngle) * range;
      const edgeY = player.y + Math.sin(aimAngle) * range;
      this.spawnShockVfx(
        player.x,
        player.y,
        skillLevel,
        "player",
        [{ x1: player.x, y1: player.y, x2: edgeX, y2: edgeY, delay: 0 }],
        aimAngle,
      );
      return false;
    }

    const segments: Seg[] = [];
    const hitSet = new Set<Enemy>();
    let delay = 0;

    for (const enemy of targets) {
      const { damage: finalDamage, isCrit } = applyCrit(
        dmg,
        critRate,
        critDamage,
      );
      enemy.takeDamage(finalDamage, "shock", sessionId, isCrit);
      hitSet.add(enemy);
      segments.push({
        x1: player.x,
        y1: player.y,
        x2: enemy.x,
        y2: enemy.y,
        delay,
      });
      delay += 80;
    }

    if (maxChains > 0) {
      let currentSources = targets;
      let chainDamageMul = SHOCK.chainDamageFalloff;
      for (let chain = 0; chain < maxChains; chain++) {
        const nextTargets: Enemy[] = [];
        for (const source of currentSources) {
          const nearby = this.findNearestEnemies(
            source.x,
            source.y,
            chainRadius,
            hitSet,
          );
          if (nearby.length > 0) {
            const ct = nearby[0];
            const chainDmg = dmg * chainDamageMul;
            const { damage: finalDamage, isCrit } = applyCrit(
              chainDmg,
              critRate,
              critDamage,
            );
            ct.takeDamage(finalDamage, "shock", sessionId, isCrit);
            hitSet.add(ct);
            nextTargets.push(ct);
            segments.push({
              x1: source.x,
              y1: source.y,
              x2: ct.x,
              y2: ct.y,
              delay,
            });
            delay += 60;
          }
        }
        currentSources = nextTargets;
        chainDamageMul *= SHOCK.chainDamageFalloff;
        if (currentSources.length === 0) break;
      }
    }

    this.spawnShockVfx(
      player.x,
      player.y,
      skillLevel,
      "player",
      segments,
      aimAngle,
    );
    return true;
  }

  castEnemyShock(
    enemy: Enemy,
    skillLevel: number = 1,
    critRate: number = 0,
    critDamage: number = 1.5,
    aimAngle: number = 0,
  ): boolean {
    const dmg = shockDamage(skillLevel);
    const range = shockRange(skillLevel);
    const maxTargets = shockTargets(skillLevel);
    const halfAngle = SHOCK.coneHalfAngle;

    const inCone = this.findPlayersInCone(
      enemy.x,
      enemy.y,
      aimAngle,
      range,
      halfAngle,
    );
    const targets = inCone.slice(0, maxTargets);
    if (targets.length === 0) return false;

    const segments: Seg[] = [];
    let delay = 0;
    for (const p of targets) {
      const { damage: finalDamage, isCrit } = applyCrit(
        dmg,
        critRate,
        critDamage,
      );
      p.takeDamage(finalDamage, "shock", undefined, isCrit);
      segments.push({ x1: enemy.x, y1: enemy.y, x2: p.x, y2: p.y, delay });
      delay += 80;
    }

    this.spawnShockVfx(
      enemy.x,
      enemy.y,
      skillLevel,
      "enemy",
      segments,
      aimAngle,
    );
    return true;
  }

  private findEnemiesInCone(
    cx: number,
    cy: number,
    aimAngle: number,
    range: number,
    halfAngle: number,
  ): Enemy[] {
    const results: { enemy: Enemy; dist: number }[] = [];
    this.state.enemies.forEach((enemy) => {
      if (enemy.isDead) return;
      const dx = enemy.x - cx;
      const dy = enemy.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > range) return;
      const angle = Math.atan2(dy, dx);
      let diff = Math.abs(angle - aimAngle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff <= halfAngle) results.push({ enemy, dist });
    });
    results.sort((a, b) => a.dist - b.dist);
    return results.map((r) => r.enemy);
  }

  private findPlayersInCone(
    cx: number,
    cy: number,
    aimAngle: number,
    range: number,
    halfAngle: number,
  ): Player[] {
    const results: { player: Player; dist: number }[] = [];
    this.state.players.forEach((p) => {
      if (p.isDead) return;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > range) return;
      const angle = Math.atan2(dy, dx);
      let diff = Math.abs(angle - aimAngle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff <= halfAngle) results.push({ player: p, dist });
    });
    results.sort((a, b) => a.dist - b.dist);
    return results.map((r) => r.player);
  }

  private findNearestEnemies(
    cx: number,
    cy: number,
    radius: number,
    hitSet: Set<Enemy>,
  ): Enemy[] {
    const results: { enemy: Enemy; dist: number }[] = [];
    this.state.enemies.forEach((enemy) => {
      if (enemy.isDead) return;
      if (hitSet.has(enemy)) return;
      const dist = Math.hypot(enemy.x - cx, enemy.y - cy);
      if (dist <= radius) results.push({ enemy, dist });
    });
    results.sort((a, b) => a.dist - b.dist);
    return results.map((r) => r.enemy);
  }

  /** Spawn a shock VFX with segments encoded as a flat string. */
  private spawnShockVfx(
    x: number,
    y: number,
    level: number,
    faction: string,
    segments: Seg[],
    aimAngle: number,
  ): void {
    // Encode segments as "x1,y1,x2,y2,delay;..."
    const segStr = segments
      .map(
        (s) =>
          `${Math.round(s.x1)},${Math.round(s.y1)},${Math.round(s.x2)},${Math.round(s.y2)},${s.delay}`,
      )
      .join(";");

    const cast = new ShockCast();
    cast.x = x;
    cast.y = y;
    cast.level = level;
    cast.faction = faction;
    cast.aimAngle = aimAngle;
    cast.segments = segStr;

    const id = `shock_${this.nextId++}_${Date.now()}`;
    this.state.shockCasts.set(id, cast);
    setTimeout(() => {
      this.state.shockCasts.delete(id);
    }, SEGMENT_TTL_MS);
  }
}
