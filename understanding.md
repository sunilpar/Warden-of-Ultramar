# Warden-of-Ultramar — Internal Architecture & Code Review

> A complete walk-through of how the project is wired together. Intended for the author to onboard themselves back into the codebase after time away, and to expose design smells that should be addressed before the game leaves prototype state.
>
> **Scope.** Server (`server/src/**`) is authoritative — Colyseus 0.17, fixed-timestep 60 Hz, Colyseus Schema for state replication. Client (`client/src/**`) is a Phaser 3 scene that renders state, predicts local movement, and forwards input. Communication is message-type integers over Colyseus (`room.send(N, payload)` / `room.onMessage` / `Callbacks.get(room)`).

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Project Layout](#2-project-layout)
3. [Server: The Authoritative Sim](#3-server-the-authoritative-sim)
   - 3.1 [GameRoom — the tick scheduler](#31-gameroom--the-tick-scheduler)
   - 3.2 [PlayerSystem — input → movement](#32-playersystem--input--movement)
   - 3.3 [EnemySystem — AI + skill use](#33-enemysystem--ai--skill-use)
   - 3.4 [ProjectileSystem — bolters](#34-projectilesystem--bolters)
   - 3.5 [ClawSystem — cone melee](#35-clawsystem--cone-melee)
   - 3.6 [SlamSystem — moving hitbox](#36-slamsystem--moving-hitbox)
   - 3.7 [VortexSystem — pull + explode](#37-vortexsystem--pull--explode)
   - 3.8 [PulseSystem — AoE blast](#38-pulsesystem--aoe-blast)
   - 3.9 [ShockSystem — chain lightning](#39-shocksystem--chain-lightning)
   - 3.10 [HealSystem — single target / AoE](#310-healsystem--single-target--aoe)
   - 3.11 [DashSystem — teleport + invuln](#311-dashsystem--teleport--invuln)
   - 3.12 [LootSystem — card spawn / drop](#312-lootsystem--card-spawn--drop)
   - 3.13 [MapSystem — collision](#313-mapsystem--collision)
   - 3.14 [Schemas — synced state](#314-schemas--synced-state)
   - 3.15 [Configs — tunables](#315-configs--tunables)
4. [Client: Phaser GameScene](#4-client-phaser-gamescene)
   - 4.1 [Lifecycle](#41-lifecycle)
   - 4.2 [Logical sections of `create()`](#42-logical-sections-of-create)
   - 4.3 [Message + callback wiring](#43-message--callback-wiring)
   - 4.4 [Input + drag-and-drop](#44-input--drag-and-drop)
   - 4.5 [Card HUD + inventory](#45-card-hud--inventory)
   - 4.6 [Rendering pipeline](#46-rendering-pipeline)
   - 4.7 [Fixed-timestep + interpolation](#47-fixed-timestep--interpolation)
   - 4.8 [Map loading](#48-map-loading)
5. [Map System (end-to-end)](#5-map-system-end-to-end)
6. [Player State (end-to-end)](#6-player-state-end-to-end)
7. [Collision (end-to-end)](#7-collision-end-to-end)
8. [Enemies (end-to-end)](#8-enemies-end-to-end)
9. [Loot (end-to-end)](#9-loot-end-to-end)
10. [GameScene Sections (visual map)](#10-gamescene-sections-visual-map)
11. [Critical Review & Industry Standards](#11-critical-review--industry-standards)
    - 11.1 [Architectural smells](#111-architectural-smells)
    - 11.2 [Code-quality smells](#112-code-quality-smells)
    - 11.3 [Network / state replication smells](#113-network--state-replication-smells)
    - 11.4 [Game-design smells](#114-game-design-smells)
    - 11.5 [How it *should* be done](#115-how-it-should-be-done)
12. [Glossary](#12-glossary)

---

## 1. High-Level Architecture

Warden-of-Ultramar is a small-scale action-RPG running in a browser tab. One **room** hosts a co-op party of players. The server simulates everything at 60 Hz fixed-timestep, replicates state through Colyseus, and the client renders / predicts.

```
┌────────────────────────────────────────────────────────────────────┐
│                           Browser (Phaser)                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  SceneSelector ──preloads assets──▶ GameScene                 │  │
│  │  GameScene                                                       │  │
│  │    • render layered map textures                                 │  │
│  │    • render entities (sprite + HP bar / VFX)                     │  │
│  │    • client-side prediction (move locally, snap on delta)        │  │
│  │    • drag-and-drop card UI + inventory                            │  │
│  │    • send input / cast / pickup messages to server               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│           ▲                                          │                │
│           │  Colyseus state listeners (onAdd/Change) │ room.send()    │
│           │                                          ▼                │
└────────────────────────────────────────────────────────────────────┘
            │                                       │
            │ WebSocket (wss)                        │
            ▼                                       │
┌────────────────────────────────────────────────────┴───────────────┐
│                       Colyseus Server (Node)                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  GameRoom (1 per party)                                         │  │
│  │    setSimulationInterval(dt=16.67) → fixedTick()                │  │
│  │    message handlers 0..19                                       │  │
│  │    onJoin / onLeave                                              │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  Systems (1 instance each, rebuilt per map)                │ │  │
│  │  │   MapSystem   PlayerSystem  EnemySystem                    │ │  │
│  │  │   LootSystem  ProjectileSystem                            │ │  │
│  │  │   ClawSystem  SlamSystem  VortexSystem                     │ │  │
│  │  │   PulseSystem ShockSystem DashSystem HealSystem            │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │                              │                                   │  │
│  │                              ▼                                   │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  RoomState (Colyseus Schema)                                │ │  │
│  │  │   players / enemies / projectiles / skillCasts / slams /    │ │  │
│  │  │   shockCasts / vortexes / groundCards / mapId / exitUnlocked │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

Key properties:

- **Server-authoritative** — clients can't lie about HP, position, or damage.
- **Fixed-timestep server, variable-timestep client** — server always 60 Hz; client interpolates with `Phaser.Math.Linear(.., 0.2)` for remotes and snaps at >32 px deltas for the local player.
- **State is a single `RoomState`** with strongly-typed Colyseus Schema maps; no JSON serialization.
- **No persistent storage** — rooms are ephemeral, players disappear when they disconnect.

---

## 2. Project Layout

```
Warden-of-Ultramar/
├── client/                 # Phaser + Vite, browser only
│   ├── src/
│   │   ├── index.ts                  # Phaser.Game bootstrap (FIT 1080×720)
│   │   ├── backend.ts                # ws://... endpoint discovery
│   │   ├── scenes/
│   │   │   ├── SceneSelector.ts      # start menu, preloads everything
│   │   │   └── GameScene.ts          # ~6,300 lines — THE scene
│   │   ├── config/
│   │   │   ├── skillDefs.ts          # card art tier helpers
│   │   │   ├── skills.ts             # legacy skill table (kept in sync)
│   │   │   └── modifiers.ts          # display metadata for room modifiers
│   │   └── maps/
│   │       ├── mapData.ts            # legacy MAP_1 (procedural + tiled)
│   │       ├── layeredMapData.ts     # PARSED map1, exports LAYERED_MAP
│   │       └── layeredMap2Data.ts    # PARSED map2, exports LAYERED_MAP_2
│   ├── public/assets/                # spritesheets, maps (Tiled JSON)
│   ├── index.html
│   ├── package.json                  # vite + phaser + colyseus.js
│   └── tsconfig.json
└── server/                 # Colyseus + Express, Node
    ├── src/
    │   ├── index.ts                  # server bootstrap
    │   ├── app.config.ts             # Colyseus + express config
    │   ├── rooms/GameRoom.ts         # ~1,030 lines — THE room
    │   ├── systems/                  # 12 *.ts files, one per concern
    │   ├── schema/                   # 11 *.ts files, all Colyseus Schema
    │   └── config/                   # tunables + map data
    │       ├── game.ts               #   GAME_CONFIG
    │       ├── enemyStats.ts         #   ENEMY_STATS table
    │       ├── playerStats.ts        #   PLAYER_STATS base + growth
    │       ├── skillDefs.ts          #   ALL skill formulas
    │       ├── loot.ts               #   PREFIX/SUFFIX/UNIQUE pools + CARD_DROP
    │       ├── lootTiers.ts          #   MOD_TIER_RANGES (1..5)
    │       ├── modifiers.ts          #   MODIFIER_DEFS
    │       ├── maps.ts               #   legacy JSON loader
    │       ├── layeredMap.ts         #   LAYERED_MAP (map1)
    │       ├── layeredMap2.ts        #   LAYERED_MAP_2 (map2)
    │       └── mapRegistry.ts        #   MAPS { map1, map2 } source of truth
    ├── test/                         # smoke tests
    ├── package.json                  # colyseus + express + ts-node-dev
    └── tsconfig.json
```

---

## 3. Server: The Authoritative Sim

### 3.1 GameRoom — the tick scheduler

`server/src/rooms/GameRoom.ts` is the single entry point. One Colyseus room holds one party.

**Lifecycle.**

```ts
class GameRoom extends Room {
  state = new RoomState();
  fixedTimeStep = 1000/60;

  async onCreate() {
    this.setMetadata(...);
    this.setSimulationInterval(dt => this.fixedTick(dt), this.fixedTimeStep);
    // register 20 message handlers (msg 0..19)
  }
}
```

**Per-tick order (`fixedTick`).** This is the contract every system relies on — the order matters because each phase reads what the previous phase wrote.

```
┌──────────────────────────────────────────────────────────────────────┐
│                          fixedTick(dt)                                 │
├──────────────────────────────────────────────────────────────────────┤
│  1. playerSystem.update(dt)         ← consumes inputQueue             │
│  2. enemySystem.update(dt)          ← AI, fires pendingSlams           │
│  3. projectileSystem.update(dt)     ← moves, wall/range/chains         │
│  4. clawSystem.update(dt)           ← expires SkillCast VFX            │
│  5. slamSystem.update(dt)           ← moves slams, per-target ticks    │
│  6. vortexSystem.update(dt)         ← pull phase, then explode hold    │
│  7. for each player: tickShield, tickSlotCooldowns, tickBleed, die()  │
│  8. cleanupDeadEnemies()            ← award XP, drop loot, onEnemyKill │
│  9. checkSpawnZones()               ← viewport-driven spawn            │
│ 10. checkMapExit()                  ← broadcast mapTransition if all  │
└──────────────────────────────────────────────────────────────────────┘
```

**Message handlers (`messages` object, indexed by integer id):**

| ID | Name | Payload | Effect |
|---|---|---|---|
| 0 | input | `{left,right,up,down,tick}` | Push onto `player.inputQueue` (max 5/tick) |
| 1 | cast | `{slot, angle}` | Read card in slot, dispatch to skill system |
| 2 | (unused) | – | – |
| 3 | viewport | `{x,y,w,h}` | Record player's camera bounds for spawning |
| 4 | respawn | `{}` | Reset stats on map1 death |
| 5 | (unused) | – | – |
| 6 | stat | `{stat}` | Spend skill point → upgrade a base stat or shield |
| 7 | upgrade card | `{slot}` | Bump the card in `slot` to next level |
| 8 | test skill point | `{}` | Debug +1 skill point |
| 9 | debug level up | `{}` | Debug +1 level |
| 10 | drop slot card | `{slot}` | → `GroundCard` at player feet |
| 11 | pickup to HUD | `{cardId, slot}` | Slot equipped, displaced card drops |
| 12 | drop ground card | `{cardId, x, y}` | Re-drops at coords |
| 13 | HUD reorder | `{from, to}` | Insert-shift swap of slots |
| 14 | HUD → inventory | `{slot, inv}` | Move HUD card into inventory slot |
| 15 | inventory → HUD | `{inv, slot}` | Equip from inventory |
| 16 | drop inventory | `{inv}` | Inventory card to ground |
| 17 | pickup to inv | `{cardId, inv}` | Ground card into inventory slot |
| 18 | inv reorder | `{from, to}` | Insert-shift in inventory |
| 19 | HUD ↔ inv swap | `{slot, inv}` | Swap a HUD card with an inventory card |

**`initMap(mapId)` is the bridge between maps.** Called once on create and again after a transition. It **rebuilds every system instance** and rebinds cross-system references:

```ts
this.mapSystem = new MapSystem(MAPS[mapId].data);
this.playerSystem = new PlayerSystem(this.state, this.mapSystem);
this.enemySystem = new EnemySystem(this.state);
this.projectileSystem = new ProjectileSystem(this.state, this.mapSystem);
this.clawSystem = new ClawSystem(this.state);
this.slamSystem = new SlamSystem(this.state, this.mapSystem);
this.vortexSystem = new VortexSystem(this.state, this.mapSystem);
this.healSystem = new HealSystem(this.state);
this.pulseSystem = new PulseSystem(this.state);
this.shockSystem = new ShockSystem(this.state, this.mapSystem);
this.dashSystem = new DashSystem(this.state);
this.lootSystem = new LootSystem(this.state);

// Cross-link enemies → {projectile, claw, slam, heal, shock, dash, vortex, pulse}
this.enemySystem.setProjectileSystem(this.projectileSystem);
this.enemySystem.setClawSystem(this.clawSystem);
// ... etc

// Clear all live collections
this.state.enemies.clear();
this.state.projectiles.clear();
this.state.skillCasts.clear();
this.state.slams.clear();
this.state.shockCasts.clear();
this.state.vortexes.clear();
this.state.groundCards.clear();
```

This is a clean pattern — no global state — but it's also **why every system has its own `setX` injection chain**, and why there's no DI.

**Spawn logic (`checkSpawnZones`).**

```ts
const target = 20 + Math.floor(this.getHighestPlayerLevel() / 2);
if (Date.now() < this.state.spawnGraceUntil) return;
for each zone in MAPS[mapId].data.enemySpawnZones:
  if spawnedZones.has(i) continue;
  if !any viewport overlaps zone continue;       // ← visibility-driven
  const level = this.getHighestPlayerLevel();
  const id = enemySystem.spawn(pickEnemyType(), zoneCenter, level);
  const e = state.enemies.get(id);
  applyEnemyModifiers(e, this.activeModifiers);
  this.refreshLootContext();
  const card = this.lootSystem.rollEnemyCard(e);
  if (card) e.card = card;
  this.spawnedZones.add(i);
```

**Pick enemy type distribution:** 40 % tyranid / 20 % tau / 15 % mechanicus / 15 % caster / 10 % orck (hard-coded in `GameRoom.pickEnemyType`).

**Elite spawn (`maybeSpawnElite`).** After `enemiesKilled ≥ ceil(target * 0.5)`, spawn one buffed enemy at a random zone:

```ts
const eliteLevel = maxPlayerLevel + ELITE.LEVEL_BONUS; // +4
enemy.makeElite(
  HP_SHIELD_BONUS = 0.2,    // +20 % HP/shield
  XP_MULTIPLIER  = 2.0,
  SIZE_MULTIPLIER = 1.6,
);
const card = lootSystem.rollEnemyCardForced(enemy); // skip 50 % gate
if (card) enemy.card = card;
```

Killing the elite sets `state.eliteAlive = false` and `state.exitUnlocked = true`. When every alive player stands on the exit rect → broadcast `mapTransition`.

**Message 1 (cast) is the most important handler.** It looks at the equipped card and dispatches:

```ts
const card = player.slotCard(slot);
switch (card.skill) {
  case "bolter":  projectileSystem.castBolter(sid,"player", x,y,angle,
                      attack, level, damageMult*slotDamageBonus(slot),
                      critRate+slotCritRateBonus(slot),
                      critDamage+slotCritDamageBonus(slot));
  case "claw":    clawSystem.castClaw(...);
  case "slam":    slamSystem.castSlam(...);
  case "vortex":  vortexSystem.castVortex(...);
  case "pulse":   pulseSystem.castPlayerPulse(...);
  case "shock":   shockSystem.castPlayerShock(...);
  case "dash":    dashSystem.castPlayerDash(...);
  case "heal":    healSystem.castPlayerHeal(player, slot);
  case "shield":  player.startSlotCooldown(slot, 1000); // stub
}
player.startSlotCooldown(slot, baseCooldown * (1 - slotCooldownReduction(slot)));
```

### 3.2 PlayerSystem — input → movement

`server/src/systems/PlayerSystem.ts` (very small, ~80 lines). Per-tick:

```ts
for (const player of state.players) {
  drainUpTo(player.inputQueue, MAX_INPUTS_PER_TICK = 5);
  for (const input of drained) {
    const dx = (input.right - input.left), dy = (input.down - input.up);
    const len = hypot(dx,dy) || 1;
    player.recalcDerivedStats();
    player.x += (dx/len) * player.moveSpeed * dt;
    player.y += (dy/len) * player.moveSpeed * dt;
    player.x = clamp(player.x, 0, map.width);
    player.y = clamp(player.y, 0, map.height);
    mapSystem.resolveRectTileCollision(player, hitboxW=9, hitboxH=20);
    player.tick = input.tick;
  }
  player.inputQueue.clear();
}
```

That's it. No prediction, no rollback — pure server authoritative. Clients predict locally for snappy movement (see [§4.7](#47-fixed-timestep--interpolation)).

### 3.3 EnemySystem — AI + skill use

`server/src/systems/EnemySystem.ts` (~750 lines). The most complex system. Per-tick:

```
update(dt):
  firePendingSlams(now)
  for each enemy:
    tickShield, tickCooldowns, tickBleed
    switch enemy.typeId:
      tyranid → updateTyranid
      orck    → updateOrck
      tau     → updateTau
      mechanicus → updateMechanicus
      caster  → updateCaster
```

**Type-specific behaviour:**

| Type | Range | Strategy | Notable |
|---|---|---|---|
| Tyranid | 60 px melee | walk in | claw spam |
| Orck | 100 px melee | walk in | slam queued 500 ms behind anim |
| Tau | 300–700 px | backs away < 160; LoS-gated 1 s | bolter + dash escape |
| Mechanicus | 200 px | backs away < 120; LoS-gated 1 s | bolter/shock/vortex |
| Caster | 100–500 px | ×1.3 surge < 200; closes to 100 | vortex/heal/pulse |

**`findNearestPlayer`** picks the closest alive player within `enemy.aggroRadius²` (squared for speed — a common pattern in this codebase).

**`tryUseSkill`** rolls 0.1 chance per tick, then picks a random skill from `skillPool` that is off cooldown. **`useSkill`** dispatches to the right system with the card's stat bonuses applied.

**`pendingSlams` pattern.** Orck slams need a 500 ms pre-fire so the hitbox lands at the apex of the animation, not the start. The AI queues `{castAt: now+500}` and `update()` fires them when due.

**Skill-pool building (`buildSkillPool`).** At `enemy.init(typeId, level)`:

```ts
unlockCount = min(potentialSkills.length, 1 + Math.floor(level/5));
// Distribute the enemy's `level` across unlocked skills + 1 shield slot,
// each capped at MAX_SKILL_LEVEL = 10, each ≥ 1.
```

### 3.4 ProjectileSystem — bolters

`server/src/systems/ProjectileSystem.ts`. Single skill: bolter (ranged hitscan-on-move).

```
update(dt):
  for each projectile:
    step = (vx,vy) * dt
    proj.x += step.x; proj.y += step.y
    proj.remainingRange -= hypot(step.x, step.y)
    if remainingRange <= 0 → despawn
    wall hit (single resolveTileCollision sample, radius=6) → despawn
    chain exhausted → despawn

castBolter(...):
  damage = attack * (1 + 0.2) * (1 + 0.1*(lvl-1)) * damageMult
  velocity = cos(angle) * bolterSpeed(lvl) // 520*1.02^(lvl-1)
  chainRemaining = bolterChainCount(lvl)    // 0/2/2/3/4 by L1/3/7/10
  hitSet = {ownerId}
```

Hit detection (`checkTargetHit`) does axis-aligned rect overlap with `enemy.hitboxW/hitboxH`. Player projectiles hit enemies only; enemy projectiles hit players + other enemies (never caster). Each bounce multiplies damage by 0.5 (chainDamageMultiplier).

### 3.5 ClawSystem — cone melee

`server/src/systems/ClawSystem.ts`. Instant hit + VFX entity.

```
castClaw(...):
  tier   = small(<4) | mid(<8) | big(≥8)
  halfAngle, range from CLAW_DEF
  damage  = computeSkillDamage("claw", attack, level, damageMult)
  for each eligible target:
    if inCone(target, angle, halfAngle, range) AND not hit already:
      applyCrit
      enemy.takeDamage(damage, "claw", ownerId, isCrit)
      if clawInflictsBleed(lvl): applyBleed(dmg*0.1, 10s)
  spawn SkillCast VFX at casterRadius offset, expiry 350 ms
```

The cone check (`inCone`) expands effective range by `targetRadius` for fairness so a big hitbox doesn't miss a cone at the edge.

### 3.6 SlamSystem — moving hitbox

`server/src/systems/SlamSystem.ts`. The only skill that creates a *moving* hitbox rather than an instant cone.

```
castSlam(...):
  range    = lvl≥6 ? 200 : 120
  velocity = cos(angle) * 300 px/s
  halfW/H  = base * 1.1^(lvl-2)    // grows from L3
  damage   = attack * (1+0) * (1+0.2*(lvl-1)) * damageMult
  bypassWalls = slamBypassesWalls(lvl)   // L5+

update(dt):
  for each slam:
    slam.x += cos(angle) * 300 * dt
    slam.y += sin(angle) * 300 * dt
    slam.remainingRange -= 300 * dt
    checkHits(slam, dt)   // per-target cooldown 0.5 s
    if wall AND !bypass → destroy
    if remainingRange <= 0 → destroy

checkHits:
  for each enemy/player:
    per-target hitCooldown -= dt
    if hitCooldown > 0 skip
    if rectContains(slam, target) → damage + reset hitCooldown to 0.5
```

Rect-vs-point rotated into slam-local frame (`cos(-angle), sin(-angle)`).

### 3.7 VortexSystem — pull + explode

`server/src/systems/VortexSystem.ts`. Centred zone with two phases.

```
castVortex(...):
  radius         = (120 + 12*(lvl-1)) * cardRadiusMult
  pullForce      = 100 + 20*(lvl-1)
  pullDuration   = 2 s
  hasExplosion   = lvl ≥ 5
  explosionDmg   = 300*(1+0.1*(lvl-5)) * cardDamageMult
  explosionRad   = (80 + 6*(lvl-5)) * cardRadiusMult

update(dt):
  for each vortex:
    if phase == "pull":
      pullTimer -= dt
      for each entity in radius:
        dx,dy = vortex→entity normalized
        entity.x += dx * pullForce * dt
        entity.y += dy * pullForce * dt
        clamp + resolveTileCollision  (entities get stuck on walls)
      if pullTimer <= 0:
        vortex.phase = "explode"
        vortex.explodeTimer = 0.5
        if hasExplosion: doExplosion
    if phase == "explode":
      explodeTimer -= dt
      if explodeTimer <= 0: destroy
```

Pull applies collision resolution so a vortex can drag entities into walls. Explosion uses pure distance check.

### 3.8 PulseSystem — AoE blast

`server/src/systems/PulseSystem.ts`. Pure distance check (ignores walls — "force pulse").

```
castPlayerPulse(...):
  damage = pulseDamage(lvl) * cardDamageMult     // 300 * (1+0.2*(lvl-1))
  radius = pulseRadius(lvl) * cardRadiusMult     // 100 + 8*(lvl-1)
  for each enemy within radius:
    applyCrit → takeDamage
    if shockChance = pulseShockChance(lvl) (0 below L5, 0.1*(lvl-5) capped 0.5):
      enemy.shockUntil = now + 10000
      enemy.recalcDerivedStats()
  spawn SkillCast VFX (TTL 600 ms)
```

### 3.9 ShockSystem — chain lightning

`server/src/systems/ShockSystem.ts`. The most geometry-heavy system.

```
castPlayerShock(...):
  damage = 200 * (1 + 0.2*floor(lvl/2))
  range  = 200 + 30*floor((lvl-1)/2)
  maxTargets by level [1,2,2,3,3,4,4,5,5,5]
  chains = shockChains(lvl)  // L5+ → 1, L7 → 2, L9 → 3

  // PRIMARY targets: closest within cone
  primaries = findEnemiesInCone(angle, halfAngle=0.6, range)  // wall-checked via raycastCoverage

  // CHAIN bounces: from each primary, search within chainRadius
  for each chain bounce:
    if chainIndex >= chains: stop
    next = closest within chainRadius not yet hit
    if !next: stop
    if raycastCoverage(prev, next, 6px steps) < 1: stop  // wall blocks
    deal damage *= chainDamageMultiplier(chainIndex)
    addSegment(prev, next, delay += 60 ms)
```

**`raycastCoverage`** samples `resolveTileCollision(px, py, 2)` every 6 px along a ray; returns `(i-1)/steps` on first wall hit. This is what lets shock "go around" obstacles by clipping each segment to its visible length.

The shock VFX encodes `segments` as a flat string `"x1,y1,x2,y2,delay;..."` and the client renders each segment with a delayed lightning bolt.

### 3.10 HealSystem — single target / AoE

```
castPlayerHeal(player, slot):
  card = player.slotCard(slot)
  if !card or card.skill != "heal": reject
  if !player.isSlotReady(slot): reject   // cooldown + kill charge gate for L1-5

  pct = healPercent(lvl) [0.3,0.35,0.4,0.45,0.5,0.45,0.5,0.5,0.55,0.6]
  amount = round(player.maxHealth * pct)

  if lvl < 6:                              // self
    player.heal(amount)
  else:                                    // AoE
    for each player within healRadius: player.heal(amount)
    for each enemy  within healRadius: enemy.heal(amount)
```

`healRadius(lvl) = 80 + (lvl-6)*20`. Enemy heal (`castEnemyHeal`) is identical but no kill-charge gate (just cooldown).

### 3.11 DashSystem — teleport + invuln

```
castPlayerDash(player, sid, level, angle, critRate, critDamage):
  range = 120 + 5*(lvl-1)     // clamped L5
  destX = x + cos(angle)*range
  destY = y + sin(angle)*range
  player.x = destX; player.y = destY
  player.invincibleUntil = now + 300 ms

  if dashHasIceBlast(lvl) (L6+):
    damage   = 100*(1+0.1*(lvl-6))
    radius   = 50 + 3*(lvl-6)
    for each enemy in radius: takeDamage
```

Enemy dash omits the ice blast entirely.

### 3.12 LootSystem — card spawn / drop

`server/src/systems/LootSystem.ts`. Three responsibilities:

1. **Spawn-time card roll** — `rollEnemyCard(enemy)` → `CardInstance` or `null`
2. **Cast-time mod application** — `applyCardMods(card, skill): CardStats`
3. **Death drop** — `dropOnDeath(enemy, nextId)` → `GroundCard`

**Rarity roll pipeline** (added in this conversation):

```
finalWeight(rarity) = max(0,
  baseWeight(rarity)                     // 30/25/20/15/10/25
  + RARITY_LEVEL_BONUS * max(0, level-1) // +2 per level, ALL rarities
  + GLOBAL_RARITY_BIAS[rarity]           // +20 to epic
  + ctx.rarityBias[rarity]               // room drop-rate mods (TODO)
)
// Sample uniformly from final weights.
```

The spawn gate (whether an enemy spawns *with* a card at all) is scaled by the room's `dropRate`:

```
effective = clamp(SPAWN_WITH_CARD * (1 + ctx.dropRate), 0, 1)
```

Elites skip the gate (`rollEnemyCardForced`). Uniques force pulse/vortex skills or fall back to legendary.

**Per-mod value roll** uses `tierForLevel(level)` = `floor(level/10)+1` clamped to `[1,5]` and picks uniformly inside `MOD_TIER_RANGES[modId][tier]`. Values are stored on the card so the same mod can roll different power across cards.

### 3.13 MapSystem — collision

`server/src/systems/MapSystem.ts`. Two collision routines:

**Circle (`resolveTileCollision(x, y, radius)`).** Used by enemies, projectiles, slams.

```
for each cell in 3×3 neighborhood of (x,y):
  closest = clamp point on cell rect to circle center
  d² = (closest.x-x)² + (closest.y-y)²
  if d² < radius²:
    // Push out
    d = sqrt(d²)
    if d == 0 (center inside cell):
      dLeft = x - cell.left; dRight = cell.right - x
      dTop  = y - cell.top;  dBot   = cell.bot - y
      min   = min(dLeft, dRight, dTop, dBot)
      // push along axis of least penetration
    else:
      push = (radius - d) / d
      x += (x-closest.x) * push
      y += (y-closest.y) * push
return {x, y}
```

**AABB (`resolveRectTileCollision(x, y, hw, hh)`).** Used by players.

```
for each cell overlapping the rect:
  overlapLeft   = cell.right  - (x-hw)
  overlapRight  = (x+hw)      - cell.left
  overlapTop    = cell.bot    - (y-hh)
  overlapBottom = (y+hh)      - cell.top
  minOverlap = min(positive overlap values)
  // push along axis of smallest positive overlap
return {x, y}
```

Both are O(1) on a small 3×3 / single-overlap neighborhood — fine for 60 Hz.

### 3.14 Schemas — synced state

`server/src/schema/*.ts` define Colyseus Schema classes. Every field marked `@type(...)` is serialized over the wire. Anything not marked is server-only.

| Schema | Purpose | Synced Fields | Local Fields |
|---|---|---|---|
| `RoomState` | top-level container | players, enemies, projectiles, skillCasts, slams, shockCasts, vortexes, groundCards, mapId, spawnGraceUntil, exitUnlocked, eliteAlive | — |
| `Player` | per-player | x,y,tick,maxHealth,currentHealth,shield,maxShield,shieldState,moveSpeed,attack,critRate,critDamage,defence,dropRate,shockUntil,invincibleUntil,level,currentXp,xpToLevelUp,skillPoints,skillLevels,slotCooldownEndsAt,slotHealKills,hitFlashUntil,lastHitDamage,lastHitCrit,lastHitShielded,hitSeq,bleedUntil,shieldStatLevel,equippedSlots,shieldCardLevel,inventorySlots,hitboxW/H,pausedUntil | inputQueue, baseMoveSpeed, speedMultiplier, damageMultiplier, incomingDamageMultiplier, slotCooldownRemaining, bleedDps, bleedTickDamage, bleedIsCrit, bleedTickAccum |
| `Enemy` | per-enemy | typeId,title,description,x,y,tick,level,maxHealth,currentHealth,shield,maxShield,shieldLevel,moveSpeed,attack,defence,critRate,critDamage,xpReward,isElite,facingRight,hitFlashUntil,lastHitDamage,lastHitCrit,hitSeq,attacking,attackingUntil,bleedUntil,shockUntil,invincibleUntil,hitboxW/H | baseMoveSpeed, speedMultiplier, damageMultiplier, incomingDamageMultiplier, collisionRadius, skillPool[], skillLevels, skillCooldownsRemaining, pausedUntil, attackCooldownUntil, bleedDps, bleedAttackerId, bleedTickDamage, bleedIsCrit, bleedTickAccum, damageTrackers, aggroRadius, wanderX/Y/Until |
| `CardInstance` | rolled card | skill,level,rarity,modIds[],modValues[],rollsWith | — |
| `GroundCard` | dropped card | skill,level,x,y,pickupLockUntil,card | — |
| `Projectile` | bolter in flight | x,y,skillId,level,colorTier,faction | vx,vy,damage,radius,remainingRange,chainRemaining,hitSet,ownerId,critRate,critDamage |
| `SkillCast` | transient VFX | x,y,skillId,angle,level,tier,faction,range | (TTL managed per-system) |
| `ShockCast` | lightning VFX | x,y,level,faction,aimAngle,segments | — |
| `Slam` | moving hitbox | x,y,skillId,level,faction,angle,remainingRange | vx,vy,damage,halfWidth,halfHeight,hitCooldowns,ownerId,bypassWalls,critRate,critDamage |
| `Vortex` | pull zone | x,y,skillId,level,faction,phase,radius,explosionRadius,colorTier | pullTimer,pullForce,explosionDamage,hasExplosion,explodeTimer,ownerId,critRate,critDamage,pulledEntities |

### 3.15 Configs — tunables

| File | Exports | Notes |
|---|---|---|
| `game.ts` | `GAME_CONFIG` | FIXED_TIME_STEP_MS, MAX_INPUTS_PER_TICK, PLAYER.SPEED=120, ELITE tunables |
| `playerStats.ts` | `PLAYER_STATS` | BASE MAX_HEALTH=1000, MOVE_SPEED=120, ATTACK=100, CRIT_RATE=0.1, CRIT_DAMAGE=1.5, DEFENCE=0; per-level growth |
| `enemyStats.ts` | `ENEMY_STATS`, `ENEMY_TYPE_LIST` | tyranid / orck / tau / mechanicus / caster |
| `skillDefs.ts` | `SKILL_DEFS` + helpers | damage formulas for all skills, `computeSkillDamage`, `applyCrit`, per-skill getters |
| `loot.ts` | `CARD_DROP`, `DROP_RATE`, pools | mod pools, rarity weights, drop rules, room drop rate |
| `lootTiers.ts` | `MOD_TIER_RANGES` | per-mod [min,max] by tier 1..5 |
| `modifiers.ts` | `MODIFIER_DEFS`, `MAP_MODIFIERS` | swift_movement, veteran_enemies, rich_loot, glass_cannon, regeneration |
| `maps.ts` | `registerMap`, `getMap` | legacy JSON loader (not currently used by the active path) |
| `layeredMap.ts` | `LAYERED_MAP` | map1 collision grid + zones |
| `layeredMap2.ts` | `LAYERED_MAP_2` | map2 collision grid + zones |
| `mapRegistry.ts` | `MAPS`, `DEFAULT_MAP` | single source of truth tying data + modifiers + info + next |

---

## 4. Client: Phaser GameScene

### 4.1 Lifecycle

`client/src/scenes/GameScene.ts` is ~6,300 lines — the entire game lives here. There is no `preload()` (everything is preloaded by `SceneSelector`).

```
async create():
  1. clear stale TS class fields (refs survive scene restart)
  2. bind WASD, mouse, SPACE, 1, 2
  3. default map = map1
  4. renderLayeredMap() + renderDebugHitboxes()
  5. createDebugHUD / StatsHUD / XpBar / MapInfo / CharacterScreen / InventoryScreen / SlotCards
  6. await connect()       (Colyseus room.join)
  7. correct map if late-joiner
  8. fade-in tween
  9. wire all Callbacks.get(room).onAdd/onChange/onRemove

update(time, delta):
  elapsedTime += delta
  while elapsedTime >= fixedTimeStep (16.67 ms):
    elapsedTime -= fixedTimeStep
    fixedTick()
    if cap exceeded: break    (cap = 5 catch-up ticks)
```

### 4.2 Logical sections of `create()`

| Section | Lines |
|---|---|
| Stale state reset | 846–925 |
| WASD keyboard bind | 928–933 |
| Mouse aim / pointerdown cast | 936–965 |
| `pointerup` / `pointerupoutside` | 968–977 |
| Keys 0/Space/1/2 | 982–1008 |
| Map defaults | 1011–1018 |
| Fade-in cover | 1021–1043 |
| Render map + debug hitboxes | 1046–1051 |
| Debug HUD | 1054 |
| Stats HUD (HP/shield/slots/vignettes) | 1057 |
| XP bar | 1059 |
| Map info button + tooltip | 1061 |
| Character screen | 1063 |
| Inventory screen | 1064 |
| `initSlotCards()` | 1066 |
| F3 bind | 1069–1071 |
| `await this.connect()` | 1074 |
| Late-joiner map correction | 1087–1118 |
| Fade-in tween | 1122–1134 |
| `room.onMessage("mapTransition")` | 1137–1139 |
| Callbacks.get(room).onAdd("players", ...) | 1147–1258 |
| Callbacks.onAdd("enemies", ...) | 1272–1423 |
| Callbacks.onAdd("projectiles", ...) | 1462–1492 |
| Callbacks.onAdd("skillCasts", ...) | 1511–1691 |
| Callbacks.onAdd("shockCasts", ...) | 1702–1758 |
| Callbacks.onAdd("groundCards", ...) | 1771–1781 |
| Callbacks.onAdd("slams", ...) | 1800–1828 |
| Callbacks.onAdd("vortexes", ...) | 1841–1929 |

### 4.3 Message + callback wiring

Only one named message:

```ts
room.onMessage("mapTransition", ({from, to}) => this.performMapSwap(to));
```

Everything else uses the Colyseus v0.17 callback API on collections:

```ts
const cb = Callbacks.get(this.room);
cb.onAdd("players", (player, sid) => { /* sprite, onChange */ });
cb.onChange(player, "x", (val, prev) => { /* snap >32 px, otherwise interpolated */ });
cb.onRemove("players", (player, sid) => { /* destroy sprite */ });
```

Each entity type has its own add/change/remove trio:

| Collection | What `onAdd` does | What `onChange` watches | What `onRemove` does |
|---|---|---|---|
| `players` | sprite from sheet, camera follow for local, HP/shield bars | x,y,moveSpeed,level,slots,inventory,cooldowns,hitFlash,shock,hitSeq | destroy sprite + bars |
| `enemies` | type-keyed sprite sheet, HP bar, elite gold border + label | x,y,facingRight,HP/shield/level,hitFlash,shock,hitSeq,hitbox,attacking | floating damage, blood VFX, destroy |
| `projectiles` | bolter sprite tinted by tier | position, rotation | destroy + bullet-hit VFX |
| `skillCasts` | key by `cast.skillId` → claw sprite / heal ring / pulse sprite / dash line / dash_ice shards | (mostly created from constructor data) | destroy VFX |
| `shockCasts` | parse `;`-separated segments, schedule with `time.delayedCall`, draw jagged lightning | (rare) | destroy |
| `groundCards` | small rarity-coloured box with skill name | re-position on schema x/y change | destroy, cancel pending pickup |
| `slams` | sprite from sheet, scale by level, rotated to aim angle, offset along aim | remainingRange → frame progression | destroy |
| `vortexes` | container with 3 spinning arms + pulsating core + outer ring | phase=="explode" → flash + shockwave + sparks + camera shake | remove spin, kill tweens, destroy |

### 4.4 Input + drag-and-drop

**Keyboard:** `wasdKeys` (lines 928–933). `0` debug level-up, `SPACE` casts slot 2, `1` slot 3, `2` slot 4, `F3` toggle hitboxes, `C` character screen, `I` inventory, `ESC` close panels, `9` test skill point.

**Mouse:**
- `pointermove` (936–945) → computes `aimAngle = atan2(pointer.worldY - player.y, pointer.worldX - player.x)`.
- `pointerdown` (946–965) → unless dragging a card, calls `castSlot(slotIdx, angle)`. Slot 0 = LMB, slot 1 = RMB.
- `pointerup` / `pointerupoutside` (968–977) → ends card drag / inventory drag / ground grab.
- `mouse.disableContextMenu()` (979).

**Three drag systems:**

1. **HUD card drag** — `beginCardDrag(2689)` / `updateCardDrag(2720)` / `endCardDrag(2752)`. Reorder (`send(13)`), drop to ground (`send(10)`), stash to inventory (`send(14)`).
2. **Inventory card drag** — `beginInvCardDrag(4719)` / `updateInvCardDrag(4730)` / `endInvCardDrag(4741)`. Reorder (`send(18)`), equip (`send(15)`), drop (`send(16)`).
3. **Ground card grab** — `beginGroundCardGrab(453)` / `updateGroundGrab(527)` / `endGroundGrab(540)`. Stash (`send(17)`), equip (`send(11)`), re-drop (`send(12)`). 96 px range gate.

### 4.5 Card HUD + inventory

5 HUD slots, fixed bindings: `SLOT_INPUTS = ["LMB", "RMB", "SPC", "1", "2"]`.

State:
- `slotCards: (SlotCard|null)[5]` — authoritative mirror of `currentPlayerState.equippedSlots`.
- `hudCards: (HudCardObj|null)[5]` — live game objects per slot.

**`syncSlotsFromServer(rebuildAlways)`** (line 2505) is the single source of truth — reads the server's equippedSlots, diffs, rebuilds only on difference.

**`updateSlotCooldowns()`** (line 2989) each tick: reads `slotCooldownEndsAt` + `slotHealKills` from sprite data, dims card art (`alpha = 0.45`), grows the cooldown fill rect anchored to bottom.

**Inventory:** 5 cols × 4 rows × 10 px gap = 20 slots. Slide-in panel toggled with `I`.

### 4.6 Rendering pipeline

**Map (layered).** `renderLayeredMap()` (line 5511). Both `baselayer` and `interactiveLayer` are blitted into runtime canvas textures (`layered_baselayer`, `layered_interactive`) using `textures.createCanvas()` + `drawImage()` from the `bigobs_tiles_32` spritesheet. Frame index = `(tileId - firstgid)`, then `% tilesetColumns` for col and `/ tilesetColumns` for row. `depth` 0 (baselayer) / 1 (interactive).

**Players.** `player_sheet` (8×3 grid, 64×64). Three anims: `player_idle` (row 0), `player_walk_left` (row 1), `player_walk_right` (row 2). Idle flipped via `setFlipX(facingRight)`. Remotes interpolated `Phaser.Math.Linear(x, serverX, 0.2)`.

**Enemies.** Type-keyed sheet + idle anim at add-time. Elite = ×1.6 size, gold border, "ELITE" text, depth 8 instead of 3. Interpolation factor 0.35.

**Projectiles.** Bolter sprite (depth 4, scale 0.4), tinted by tier (yellow/blue/purple), rotated along travel.

**Skill VFX:**

| Skill | VFX |
|---|---|
| Claw | sprite at outer edge of cone (offset by casterRadius + VFX_GAP), tinted red for enemy |
| Slam | sprite rotated to aim, scale `1.5 × 1.1^(level-2)`, per-tick frame by `travelled = 1 - remainingRange/totalRange` |
| Vortex | 3 spinning arms (16 ms spin loop), pulsating core + outer ring, explode phase → flash + shockwave + 10 sparks + camera shake |
| Pulse | sprite anim (4 cols × 2 rows), scale = `2r/64`, auto-destroys |
| Heal | self = green flash circle, AoE = expanding green ring |
| Dash | white line from start to end, fades 300 ms |
| Dash_ice | cyan ring + 6 radial shards |
| Shock | per-segment jagged lightning: glow + core + spark + 30 ms flicker redraw |

**Ground cards.** 84×20 dark box with rarity-coloured stroke, skill title centered, depth 2, hover-dwell tooltip (350 ms).

**Floating damage numbers.** Pooled `Text` objects — blue for shield-only hits, gold + larger for crits, white otherwise — rise 32 px and fade 700–900 ms.

**HP bars.**
- Enemy: container (depth 5) — black bg + red fill (orange for elite, gold border) + translucent white shield fill + level text + gold "ELITE" label.
- Player: HP fill (depth 102, origin (0,1)) anchored bottom-left, drains top→bottom; shield fill above it; stats text top-right.

**Hitbox overlay (F3).** `renderDebugHitboxes` (5603) draws RED=collision tiles, YELLOW=player spawn, CYAN=exit, MAGENTA=enemy zones, WHITE=map boundary (depth 10). `updateEntityHitboxes` (6073) redraws per-tick (depth 11): GREEN=player, RED=enemy, BLUE=bolter, ORANGE=claw cone, PURPLE=pulse, YELLOW-GREEN=shock cone, CYAN=slam rect, WHITE=dash, CYAN=dash_ice.

### 4.7 Fixed-timestep + interpolation

```
update(time, delta) → elapsedTime += delta
while elapsedTime >= fixedTimeStep (16.67 ms):
  elapsedTime -= fixedTimeStep
  fixedTick()
  if catchupCap exceeded: break   // 5 ticks/frame
```

`fixedTick()` does (in order):

1. F3 JustDown toggle
2. FPS counter
3. Read WASD → `inputPayload` → `room.send(0, {left,right,up,down,tick})`
4. Update local player anim
5. **Predict** local movement with the same formula as the server (normalize, advance by `moveSpeed * dt`, clamp, tile collision via `resolveTileCollision(x, y, 10, ...)`)
6. Map exit toast
7. Local tint (hit flash / shock / clear), dash opacity
8. **Interpolate remotes** `Linear(x, serverX, 0.2)`
9. Interpolate enemies factor 0.35 + flip + anim switch
10. Update enemy HP bars
11. Slam sprite frame progression
12. Death overlay edge
13. Vignettes
14. Slot cooldowns
15. Drag/grab updates
16. Spawn countdown toast
17. Elite HUD announce
18. Entity hitbox overlay
19. `sendViewport()` → `room.send(3, {x,y,w,h})`

### 4.8 Map loading

**The client does not receive the map over the wire.** Maps are bundled with the client:

```
client/src/maps/layeredMapData.ts        → LAYERED_MAP (parsed from map1_32bit.json at module load)
client/src/maps/layeredMap2Data.ts       → LAYERED_MAP_2 (parsed from map2_32bit.json at module load)
```

`MAP_CONFIGS` static map at line 816: `map1 → LAYERED_MAP`, `map2 → LAYERED_MAP_2`.

Selection flow:
1. Default `mapId = "map1"`, render `map1`.
2. After `connect()`, read `room.state.mapId`. If mismatch → destroy old textures, re-render.
3. On `room.onMessage("mapTransition", {from,to})` → `performMapSwap(to)` tears down all entities + textures, swaps map, snaps players, fades in.

---

## 5. Map System (end-to-end)

```
                          Tiled editor (JSON)
                                   │
                ┌──────────────────┴──────────────────┐
                ▼                                     ▼
   server/src/config/maps/map1_32bit.json    client/src/maps/map1_32bit.json
                │                                     │
                ▼                                     ▼
   buildLayeredMap() at module load        parseAndBuild() at module load
                │                                     │
                ▼                                     ▼
        LAYERED_MAP                          LAYERED_MAP
        collisionGrid:Uint8Array             collisionGrid:Uint8Array
        spawnPoint, exitPoint                resolveTileCollision()
        enemySpawnZones                      spawn, exit, zones
                │                                     │
                ▼                                     ▼
   new MapSystem(LAYERED_MAP)                LAYERED_MAP imported in GameScene
                │                                     │
                ▼                                     ▼
   playerSystem.resolveRectTileCollision    GameScene.fixedTick (predict)
   enemySystem.moveToward (circle)          resolveTileCollision(10, ...)
   projectile wall check                    (MUST match server exactly)
   slam.hitsWall
   shock.raycastCoverage
```

**Why both server and client parse the same JSON.** Both need to do collision — server for authority, client for prediction. The `resolveTileCollision` helper in `layeredMapData.ts` is duplicated/imported in `GameScene.ts` and must stay byte-identical to the server's `MapSystem.resolveTileCollision`. Today the *server's* one is in `MapSystem.ts` and the *client's* one is in `layeredMapData.ts`; both have the same 3×3 / closest-point-on-cell algorithm.

**Enemy spawn zones** are extracted from the Tiled object layer `enemy spawn` at module load. Spawning is **viewport-driven**: a zone only spawns when at least one player's camera overlaps it. Once spawned, the zone stays empty for the rest of the run.

**The map swap** is same-room: `room.send` never disconnects, no reconnect, no state loss. `performMapSwap(to)` on the client + `initMap(nextMapId)` on the server coordinate through the `"mapTransition"` broadcast.

---

## 6. Player State (end-to-end)

```
Client (WASD)                                          Server
    │                                                     │
    ▼                                                     │
inputPayload = {l,r,u,d,tick}                             │
room.send(0, payload) ──────────────────────────────────▶ │
                                                          ▼
                                                player.inputQueue.push(input)
                                                          │
                                                          ▼
                                              fixedTick → PlayerSystem.update
                                                drainUpTo(5)
                                                move with map collision
                                                stamp player.tick
                                                          │
                                                          ▼ (Colyseus auto-sync)
                                                  state.players changes
                                                          │
room.onChange(player, "x"|"y"|...) ◀──────────────────────┘
    if |delta| > 32: snap
    else: store serverX/Y for next interpolation tick
                                                          │
                                                          ▼
                                              next tick: GameScene.fixedTick
                                                Linear(x, serverX, 0.2)
                                                update sprite + anim
```

**Damage flow.** Any system calls `player.takeDamage(raw, skillId, attackerId, isCrit)`:

```ts
const isCrit = isCrit ?? false;
const def = (isCrit ? this.defence * 0.5 : this.defence) + (this.shockUntil > now ? -0.2 : 0);
let dmg = raw * (1 - def) * this.incomingDamageMultiplier;

// Shield absorbs first (re-arms recharge timer)
if (this.shield > 0) {
  const absorbed = Math.min(this.shield, dmg);
  this.shield -= absorbed;
  dmg -= absorbed;
  if (this.shield === 0) this.shieldState = "broken";
}

this.currentHealth -= dmg;
this.hitFlashUntil = max(this.hitFlashUntil, now + max(150, getSkillHitFeedback(skillId) ?? 100));
this.hitSeq++;
return dmg; // for XP credit
```

**XP / kill credit.** Each enemy tracks `damageTrackers: Map<sid, dmg>`. On death, `awardKillXp` gives 100 % to the max dealer, 50 % to others.

**Cooldown stamping.** `player.startSlotCooldown(slot, cd)`:

```ts
const reduction = this.slotCooldownReduction(slot);  // capped at 0.6
this.slotCooldownRemaining[slot] = cd * (1 - reduction);
this.slotCooldownEndsAt[slot] = now + 1000 * above;   // synced absolute
```

**Card pickup** (msg 11/17) gates on:
- `Date.now() < gc.pickupLockUntil` (500 ms drop grace)
- Reach distance (96 px for HUD pickup, 160 px for ground re-drop)

**Stat spend** (msg 6) caps defence at 0.95 and gives +500 HP, +20 atk, +0.02 def, +0.02 crit, +0.2 critDmg, +5% moveSpeed (with recalc).

---

## 7. Collision (end-to-end)

```
                          resolveTileCollision(x, y, radius, grid, cols, rows, tileSize)
                                                    │
                  ┌──────────────────┬──────────────┴───────────────┬──────────────────┐
                  ▼                  ▼                              ▼                  ▼
        MapSystem (server)  layeredMapData.ts (client)     VortexSystem (server)   ShockSystem raycast
        enemies             GameScene prediction          pull: entities dragged  chain blocked by walls
        projectiles         (shared helper, MUST match)   into walls
        slam wall check
```

**Algorithm.** For a circle of radius `r` centered at `(x,y)`:

1. Compute the 3×3 neighborhood of cells around `(x,y)`.
2. For each cell: compute the closest point on the cell rect to the circle center.
3. If the squared distance to the closest point is less than `r²`, push the circle out:
   - If the center is *inside* the cell → push along the axis of least penetration (min of `dLeft, dRight, dTop, dBottom`).
   - Else → push along `(closest - center) * (r-d)/d`.

This is the standard "smallest displacement" approach used in tile-based games. It's O(1) per call because the neighborhood is tiny.

**For players (AABB).** Same neighborhood, but uses min-overlap push along axis of least penetration on the *rect*.

**For shock (raycast).** Sample `resolveTileCollision(px,py,2)` every 6 px along the segment. Return `(i-1)/steps` on first wall hit, 1 otherwise. Used to clip the VFX segment to the visible length and to block chain bounces.

---

## 8. Enemies (end-to-end)

```
fixedTick → EnemySystem.update(dt)
  firePendingSlams(now)
  for each enemy:
    tickShield (30s recovery then 0.2*maxShield/s)
    tickCooldowns (clamp to ≥0)
    tickBleed (0.5s ticks, bypass shield)
    switch typeId:
      Tyranid:
        target = findNearestPlayer(aggroRadius²)
        if !target: wander(50-150px, 1-3s)
        face target
        if dist ≤ 60: tryUseSkill(0.1/tick)
        else: moveToward(target)
      Orck:    same as tyranid, dist ≤ 100, slam queued 500 ms ahead
      Tau:     dist < 160 → back away
               160 ≤ dist ≤ 300 → LoS check (16px raymarch) → tryUseTauSkill (1s throttle)
               else: wander or moveToward
      Mechanicus: similar to tau, dist < 120 retreat, 200 range attack
      Caster:  dist < 200 → speed × 1.3 surge
               dist ≤ 100 → vortex/pulse/heal
               else: moveToward
```

**Skill dispatch (`useSkill`).** Card stat bonuses apply here:

```ts
const dmgMult = enemy.cardDamageBonus(skill);      // 1 + Σ inc_atk_damage
const critR   = enemy.cardCritRateBonus(skill) + ...;
const radMult = enemy.cardRadiusMult(skill);        // wide_sweep → 2.0
const uniMult = enemy.cardUniqueDamageMult(skill);  // wide_sweep → 0.5

// aim = atan2 to target
// attackingUntil = type-specific (orck 500, tau/mech 400, caster 500, default 350)
switch skill:
  bolter → projectileSystem.castBolter(...)
  claw   → clawSystem.castClaw(...)
  slam   → pendingSlams.push({castAt: now+500, ...})
  heal   → healSystem.castEnemyHeal(...)
  shock  → shockSystem.castEnemyShock(...)
  dash   → dashSystem.castEnemyDash(...)
  vortex → vortexSystem.castVortex(...)
  shield → self-restore
  pulse  → pulseSystem.castEnemyPulse(...)
enemy.startCooldown(skill)
```

**Skill pool building.** At `enemy.init(typeId, level)`:

```ts
unlockCount = min(potentialSkills.length, 1 + floor(level/5));
// L1-4 → 1 skill
// L5-9 → 2 skills
// L10-14 → 3 skills
// Distribute `level` across unlocked skills + 1 shield slot,
// each capped at MAX_SKILL_LEVEL = 10, each ≥ 1.
```

**Loot drop on death.** `LootSystem.dropOnDeath(enemy, nextId)`:
- No card → null.
- Card rarity === "common" and `DROP_ONLY_UNCOMMON_PLUS` → null.
- Else → `new GroundCard` at `(enemy.x, enemy.y)` with `pickupLockUntil = now + 500`.

**Elite spawn.** When `enemiesKilled ≥ ceil(target * 0.5)`:
- Pick a random zone center.
- `eliteLevel = maxPlayerLevel + ELITE.LEVEL_BONUS (+4)`.
- `enemy.makeElite(0.2, 2.0, 1.6)` → +20 % HP/shield, ×2 XP, ×1.6 hitbox.
- Always carry a card (`rollEnemyCardForced`, no 50 % gate).
- Killing elite sets `exitUnlocked = true`.

---

## 9. Loot (end-to-end)

```
Spawn (every enemy, regular or elite):
  lootContext = { dropRate = max(player's Player.dropRate), rarityBias = {} }
  if Math.random() > spawnChance: no card      // gate, scaled by dropRate
  skill = uniform(enemy.skillPool - shield)
  rarity = weightedPick(CARD_DROP.RARITY_WEIGHTS + levelBonus + globalBias + roomBias)
  unique: force pulse/vortex, one wide_sweep; or fall back to legendary
  else: rollModCount mods from PREFIX/SUFFIX_POOL (max 2+2)
  attachModValues: rollModValue(id, tierForLevel(level)) per mod → modValues[]
  assignRollMode: 10% advantage / 10% disadvantage / 80% normal
  → CardInstance on enemy.card

Cast (every time the enemy uses that skill):
  damageMult = 1 + Σ card.modValues[i] for inc_atk_damage mods
  critRate += Σ card.modValues[i] for inc_crit_rate mods
  critDamage += Σ card.modValues[i] for inc_crit_damage mods
  radius *= (wide_sweep ? 2 : 1)
  damageMult *= (wide_sweep ? 0.5 : 1)
  cooldown *= (1 - Σ inc_cooldown mods, capped 0.6)

Death:
  LootSystem.dropOnDeath → GroundCard at enemy pos with 500 ms lock

Pickup (msg 11 / 17):
  range check (96 px)
  pickupLock check
  setSlotCard / setInventorySlot
  if displaced: → dropCardToGround (new GroundCard)
```

**Tier system.** `tierForLevel(level) = floor(level/10) + 1`, clamped `[1, 5]`. `MOD_TIER_RANGES[modId][tier]` gives `[min, max]`. `rollModValue(id, tier)` rolls uniform in range. This is what makes a "low-level legendary" still weak — same rarity, weak stats.

**Room drop rate (`DROP_RATE`).** Players have a `dropRate` stat (default 0). The room tracks the highest player's value and scales the spawn gate: `effective = clamp(0.5 * (1 + dropRate), 0, 1)`. A player with +100 % drop rate sees 100 % more cards spawn.

**Advantage / disadvantage (TODO).** `CardInstance.rollsWith` is set to `"advantage" | "disadvantage" | "normal"` at roll time. The numeric effect on mod values is *not* wired yet — this is a placeholder the UI can already read.

---

## 10. GameScene Sections (visual map)

The 6,300-line `GameScene.ts` is a single class. Here's what lives where:

```
GameScene (6,312 lines)
├── Static helpers / constants                 (lines 99–230)
│   • SLOT_CD_MS, RARITY_COLORS, RARITY_NAMES, MOD_LABELS, MOD_NAMES, CARD_CD_COLORS
│   • formatNumber, formatModLine
│   • HudCardObj / SlotCard interfaces
│   • MAP_CONFIGS, SLOT_INPUTS, INV_COLS / INV_ROWS / INV_SLOT_GAP
│
├── Ground card drag system                    (lines 230–600)
│   • beginGroundCardGrab / updateGroundGrab / endGroundGrab
│   • createGroundCardEntity
│
├── VFX helpers                                (lines 600–2000)
│   • drawLightningBolt, spawnBloodSplat, showDamageNumber
│   • showVortexExplosion
│   • createCharacterAnimations / createEnemyAnimations
│
├── create()                                   (lines 846–1942)
│   1. Stale state reset (846-925)
│   2. Input binds (928-1008)
│   3. Map defaults + late-joiner fix (1011-1118)
│   4. Fade-in tween (1122-1134)
│   5. mapTransition message (1137-1139)
│   6. Player / enemy / projectile / skillCast / shockCast / groundCard / slam / vortex listeners (1144-1942)
│
├── Card rendering + tooltips                  (lines 2000–3500)
│   • createCardObj / rebuildSlotCards / syncSlotsFromServer
│   • buildCardTooltipPanel / showBolterTooltip / hideBolterTooltip
│   • updateSlotCooldowns
│
├── HUD creation                               (lines 3000–4400)
│   • createStatsHUD / createXpBar / createMapInfoButton
│   • createCharacterScreen / createInventoryScreen
│   • createDebugHUD
│
├── Drag-and-drop                              (lines 2689–2900, 4719–4900)
│   • beginCardDrag / updateCardDrag / endCardDrag
│   • beginInvCardDrag / updateInvCardDrag / endInvCardDrag
│
├── Map rendering                              (lines 5510–5700)
│   • renderLayeredMap / renderDebugHitboxes
│   • updateEntityHitboxes
│
├── Per-tick (fixedTick)                       (lines 5720–6740)
│   • input read → send
│   • prediction
│   • interpolation
│   • VFX + UI updates
│
├── update()                                   (lines 6740–6800)
│   • elapsedTime accumulator + catch-up loop
```

**The file should be split.** See [§11.1](#111-architectural-smells).

---

## 11. Critical Review & Industry Standards

This section is the honest audit. The prototype works — you can run a co-op map clear with the elite, get cards, level up, swap maps. But the implementation has accumulated real problems that will block the project the moment you try to add the next feature.

### 11.1 Architectural smells

**1. `GameScene.ts` is 6,300 lines.** This is the single biggest problem.

*Symptom.* Everything — input, rendering, VFX, networking, HUD, drag-and-drop, tooltips, prediction, interpolation — lives in one Phaser scene class. Adding a feature means scrolling through thousands of lines of unrelated code.

*Why it's bad.*
- A single change risks breaking unrelated systems (no compile-time isolation between, say, inventory and projectile rendering).
- Onboarding a contributor means reading the entire file.
- Test surface is unbounded; you can't unit-test the drag handler without booting Phaser.
- Hot reload is slow; every keystroke recompiles ~6,000 lines.

*Industry standard.* Break `GameScene` into focused classes/modules:
- `InputController` (keyboard + mouse + drag dispatch)
- `EntityRenderer` (sprite pools, HP bars, damage numbers)
- `MapRenderer` (layered blit, debug hitboxes)
- `HudController` (stats, XP, character/inventory panels)
- `CardController` (HUD slots + inventory + drag-drop)
- `VfxController` (claw/pulse/vortex/shock/slam/dash)
- `NetworkBridge` (Callbacks.get + room.send)

Each becomes testable and reusable. Phaser's scene system supports multiple scenes (e.g., a `HudScene` running in parallel with `GameScene`).

**2. Systems know about each other through setter injection chains.**

*Symptom.* `EnemySystem` has 8 `setX` methods (`setProjectileSystem`, `setClawSystem`, `setSlamSystem`, `setHealSystem`, `setShockSystem`, `setDashSystem`, `setVortexSystem`, `setPulseSystem`). `initMap` in `GameRoom` is a wall of `setX` calls.

*Why it's bad.*
- Order matters and is undocumented; a missing `setX` produces silent runtime bugs (the enemy tries to call a method on `undefined`).
- Every new system requires editing `EnemySystem` + `GameRoom.initMap`.

*Industry standard.* Use a simple **DI container** or constructor injection:
```ts
class EnemySystem {
  constructor(private readonly state: RoomState,
              private readonly skills: SkillDispatcher) {}
}
```
where `SkillDispatcher` is a single object that owns all the projectile/claw/slam/etc. dispatch methods. Or pass each system through the constructor.

**3. `GameRoom.initMap` rebuilds every system instance per map.**

*Symptom.* Every time the party transitions, `new MapSystem`, `new PlayerSystem`, … are created. Cross-references are rebuilt. Collections are cleared.

*Why it's bad in principle, OK in practice.* The systems don't carry meaningful per-map state beyond references to `RoomState` (which is shared). Rebuilding is wasteful. But it's also *safe* — no leaks. The cost is at most a few hundred object allocations per transition (rare event).

*Industry standard.* Make systems **stateless** (or shared) so they survive map transitions. The current design conflated "fresh per-map" with "shared but stateful". Split the two.

**4. `RoomState` is a god object.**

*Symptom.* `RoomState` owns 8 collections + 4 scalars. Every system reads and writes through it.

*Why it's OK.* Colyseus requires it. This isn't a smell — it's the framework. Don't try to "fix" this; the smell is in the *systems*, not the state.

### 11.2 Code-quality smells

**5. Dead code: `MOD_EFFECTS` and `applyCardMods` in `LootSystem.ts`.**

*Symptom.* These are exported but have zero callers in `server/src`. The live runtime uses `Player.cardCritBonus()` etc. which read `card.modValues[i]` directly. The MOD_EFFECTS formulas are flat (e.g. `critRate: 0.1 * t`) and ignore the rolled value entirely.

*Status.* Partially fixed in this conversation (`applyCardMods` now prefers `modValues`). But the existence of `MOD_EFFECTS` as a public export is a footgun for future contributors who'll think it's authoritative.

*Industry standard.* Delete unused exports. Or if they're a useful fallback, move them into the file's private scope and document why.

**6. Duplicated collision logic.**

*Symptom.* `MapSystem.resolveTileCollision` (server) and `client/src/maps/layeredMapData.ts:resolveTileCollision` (client) implement the same algorithm. They MUST stay byte-identical.

*Why it's bad.* A change to one without the other is a silent desync (player predicts no collision, server blocks them, sprite snaps).

*Industry standard.* Extract to a shared package (`shared/src/collision.ts`) and import on both sides. TypeScript helps — the same code runs on Node and in the browser.

**7. Magic numbers everywhere.**

*Symptom.* The codebase has ~150 magic numbers scattered through systems:
- `clawInflictsBleed` checks `bleedUnlockLevel=10` in code (the skill def says `bleedUnlockLevel=5` — these disagree).
- `healKillThreshold(level) = level<=2 ? 4 : 3` is hard-coded in `Player.ts`, not derived from `HEAL_DEF`.
- `SLAM_DEF.hitInterval=0.5`, `PULSE_SHOCK_DURATION_MS=10000`, `EXPLODE_HOLD=0.5` — all system-local.
- `pickup range 96 px`, `drop range 160 px`, `500 ms lock` — in `GameRoom.ts` message handlers.

*Industry standard.* Move every tunable into the relevant `*Def` object in `config/skillDefs.ts` or `config/game.ts`. The system reads `SLAM.hitInterval`, not `0.5`. This is the cheapest refactor with the highest payoff.

**8. Type-unsafe maps everywhere.**

*Symptom.* `damageTrackers: Map<string, number>`, `skillLevels: Map<string, number>`, `skillCooldownsRemaining: Map<string, number>`, `hitSet: Set<string>` — all keyed by `string` for what should be typed IDs.

*Why it's bad.* `enemy.skillLevels.get("claw")` is fine, but `enemy.skillLevels.get("CLAW")` would silently return undefined. The string keys aren't validated.

*Industry standard.* Use `Map<SkillId, number>` (the `SkillId` type already exists). Use `Set<EnemyId>` / `Set<PlayerId>` — branded types prevent cross-key bugs.

**9. Inline schemas without documentation.**

*Symptom.* `Enemy.skillLevels: Map<string, number>` is server-local; `skillPool: string[]` is server-local too. None are in `@type` decorators, so they're invisible to the client. But `damageTrackers` is *also* server-local — which is correct, but the boundary is invisible from the schema alone.

*Industry standard.* Split each Schema into `@type(...)` (synced) vs plain fields (local) with section comments. Even better: keep local state in a separate `EnemyLocal` object outside the Schema.

**10. State-coupled rendering.**

*Symptom.* The client renders `state.groundCards`, `state.skillCasts`, `state.slams`, `state.vortexes`, `state.shockCasts`, `state.projectiles` — every transient entity is its own collection in `RoomState`. Each has its own `onAdd` / `onChange` / `onRemove` block in GameScene.

*Why it's bad.* Each transient collection costs bandwidth on every state tick (Colyseus patches all changes). Five separate collections = five patch roundtrips. A single "VFX" union type would be one roundtrip.

*Industry standard.* Use **ephemeral channels** for VFX (a separate `room.send` broadcast that's not synced through state). Colyseus supports this — send a one-off message with the VFX payload and the client renders without patching state.

**11. No `try/catch` around socket handlers.**

*Symptom.* A bug in any message handler crashes the room silently. There's no error logger, no graceful degradation.

*Industry standard.* Wrap every message handler in `try/catch`, log the error with `console.error` and the offending payload, return early. The room stays alive.

### 11.3 Network / state replication smells

**12. `player.dropRate` is `@type("number")` but never written.**

*Symptom.* Added in this conversation as a future hook. Gear/skills haven't been wired to bump it. The room's `getHighestPlayerDropRate` reads 0 from every player.

*Industry standard.* Either delete the field until you need it (YAGNI) or wire it now. Don't keep empty fields in the schema — every `@type` field adds a wire-cost byte.

**13. No client-side reconciliation.**

*Symptom.* The client predicts local movement but never reconciles against server. When the server disagrees (e.g., another player pushed you, or you hit a wall the client missed), the sprite "snaps" via `>32 px` check, which is jarring.

*Industry standard.* Implement server reconciliation:
1. Send input with `tick` number.
2. Server processes input + state, returns `tick` + resulting `(x, y)`.
3. Client keeps a history of `(input, predictedPosition)`.
4. On server ack, replay all inputs from `tick+1` forward against the authoritative `(x, y)`.

This is the standard pattern from Gabriel Gambetta's "Fast-Paced Multiplayer" articles.

**14. No lag compensation on hit detection.**

*Symptom.* `projectileSystem.checkTargetHit` and `clawSystem.inCone` check against current positions. On 100 ms RTT, the target has moved 6-12 px (at 60–120 px/s). Hits feel "off".

*Industry standard.* Implement **rewind**: when player A attacks player B, the server rewinds B's position by `(now - A's-input-time)` and checks the cone/rect there. Valve's lag compensation paper is the canonical reference.

**15. Bandwidth waste from `hitSeq` style counters.**

*Symptom.* `hitSeq` is a monotonic counter the client uses to detect new hits. Every hit increments it, and the change replicates. This is the right idea but it's done in five places (Player, Enemy) with no abstraction.

*Industry standard.* A single `EventBus` on the schema that publishes typed events (`{type: "damage", sourceId, targetId, value, isCrit}`). Subscribers filter by type. Cleaner than 5 hand-rolled counters.

**16. `pickupLockUntil` uses `Date.now()` not server tick.**

*Symptom.* The lock is `Date.now() + 500`, but server time and client time can drift. The server check (`if Date.now() < gc.pickupLockUntil`) is correct, but the client renders based on its own `Date.now()` and may show "locked" or "available" inconsistently with the server.

*Industry standard.* Use the server's `serverTime` (Colyseus exposes `room.serverTime`). Subtract latency for the client's lock display.

### 11.4 Game-design smells

**17. Card rarity weights sum to 125.** (`common 30 + uncommon 25 + unique 25 + rare 20 + epic 15 + legendary 10`).

*Status.* Addressed in this conversation — the weights are now **normalized** as a roll table, with the global +20 epic bias and +2/level scaling on top. Pre-conversation the weights were also wrong (legendary at 2 was basically impossible to roll).

*Remaining issue.* `unique: 25` is suspiciously high (5x legendary). The intent was probably "make uniques feel reachable", but as written, a level-10 enemy is ~75 % likely to roll non-unique, ~25 % unique — way too common. Drop unique to ~5-8.

**18. Heal L1-5 is kill-charged but the threshold table is hard-coded in Player.ts.**

*Symptom.* `healKillThreshold(level) = level<=2 ? 4 : 3` in `Player.ts:???`, not in `skillDefs.ts` HEAL block.

*Industry standard.* All skill tunables in one file. Currently `HEAL` def has `killsToRecharge: [4,4,3,3,3,3,3,3,3,3]` (per L1-10), which doesn't match.

**19. `clawInflictsBleed` checks L10 but `CLAW_DEF.bleedUnlockLevel=5`.**

*Symptom.* Real bug — claw bleed is intended at L5+ per `skillDefs.ts`, but the runtime check uses `bleedUnlockLevel=10`. Players expecting bleed at L5 get nothing.

*Industry standard.* The check should read the def: `if (lvl >= CLAW_DEF.bleedUnlockLevel)`. Currently it's a magic constant.

**20. No death-state on enemies — the server keeps them in state.**

*Symptom.* `Enemy.isDead` is checked by `cleanupDeadEnemies`, but the enemy stays in `state.enemies` until after the cleanup loop. Other systems (e.g., vortex pull) still try to affect a dead enemy.

*Industry standard.* Mark dead and skip in every system. Or remove from the collection immediately and let XP/drop happen in a post-tick hook.

**21. No save / persistence.**

*Symptom.* Disconnect = lose everything. No reconnect tokens, no character persistence.

*Industry standard.* Even a simple reconnect-with-token (Colyseus supports this) would dramatically improve feel.

### 11.5 How it *should* be done

For someone who wants to take this prototype to "real game" quality:

**Step 1: Split `GameScene.ts`.** The single highest-ROI refactor. Extract input, drag-drop, HUD, entity rendering, VFX, map rendering, and prediction into separate classes. Keep `GameScene` as a thin orchestrator (~300 lines).

**Step 2: Extract a `shared/` package.** `collision.ts`, `skillIds.ts`, `cardMods.ts`. Both server and client import. Eliminates the byte-identical collision duplication and gives a single source of truth for skill IDs.

**Step 3: Move magic numbers into defs.** Every tunable goes into `config/skillDefs.ts`, `config/loot.ts`, or `config/game.ts`. The systems become thin orchestrators of formulas.

**Step 4: Replace `MOD_EFFECTS` with the rolled-value path entirely.** Delete the legacy formula export. Document the tier system in a single place.

**Step 5: Replace `damageTrackers` and `hitSeq` with a typed event bus.** One Schema field (`eventLog: ArraySchema<LogEntry>`), append-only. Cleaner code, easier debugging.

**Step 6: Add server reconciliation + lag compensation.** Standard pattern, ~200 lines, dramatically improves hit feel.

**Step 7: Move VFX off the synced schema.** Use `room.send` broadcasts for transient effects (one-way, no patch). Saves bandwidth and simplifies client code.

**Step 8: Add `try/catch` + structured logging.** Every message handler, every system update. Use a simple `logger.error(err, ctx)` and pipe to console + (later) a file.

**Step 9: Write tests.** Start with pure logic: `lootTiers.ts` (range tables), `resolveTileCollision` (with a fixture grid), `rarityForModCount`, `skillMods`. These are 100 % pure functions with no I/O.

**Step 10: Adopt `strict` TypeScript.** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Catches the `string`-vs-`SkillId` and `undefined`-vs-`null` bugs that are everywhere right now.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **fixed timestep** | Updating the simulation at constant `dt = 1/60 s` regardless of frame rate. Industry standard for determinism. |
| **viewport-driven spawn** | Only spawning enemies inside the players' camera bounds. Saves CPU and gives the player agency. |
| **lag compensation** | Server rewinds entity positions to "what the attacker saw" when applying damage. |
| **client-side prediction** | Client applies the same input→movement formula locally so the player's sprite moves with zero perceived latency. |
| **reconciliation** | When the server's authoritative state differs from the predicted state, replay inputs forward from the server's snapshot. |
| **CardInstance** | A rolled card: skill + level + rarity + mods + rolled mod values + roll mode. |
| **GroundCard** | A `CardInstance` placed at world coords with a 500 ms pickup lock. |
| **tier** | A loot scaling band. Tier `n` covers enemy levels `[10*(n-1), 10*n - 1]`. Tier 5 caps at level 40+. |
| **mod** | A modifier on a card. Stored as a string id; rolled value is a parallel number. |
| **unique** | A special mod pool (currently just `wide_sweep`) that can only roll on pulse/vortex and replaces all other mods. |
| **dropRate** | A player stat that scales the spawn-with-card gate. |
| **elite** | The map's boss-spawned mid-fight buffed enemy. Killing it unlocks the exit. |
| **VFX gaps** | Per-skill visual offsets so the sprite doesn't render *on top of* the caster. |
| **raycastCoverage** | A 6-px-step wall check. Returns `(i-1)/steps` so VFX can be clipped to the visible length. |
| **pickupLockUntil** | Server timestamp after which a ground card can be picked up. 500 ms after drop. |
