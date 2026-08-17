/**
 * Map Modifiers System
 * ====================
 * Modifiers are per-map gameplay alterations that affect players and/or
 * enemies. Each modifier defines:
 *
 *   - id          Unique identifier string
 *   - title       Display name (sent to client via room metadata)
 *   - description Human-readable description
 *   - applyPlayer Called once when a player joins/respawns.
 *   - applyEnemy  Called once when an enemy spawns.
 *   - xpRewardMultiplier  Multiplier for enemy xpReward (default 1.0)
 *   - lootRarityBonus      Flat bonus to loot rarity roll (default 0)
 *
 * The room owns a list of active ModifierIds. On player join/respawn and
 * enemy spawn, the room iterates the active modifiers and calls the
 * relevant apply function.
 */
// ============================================================
// Modifier Definitions
// ============================================================
export const MODIFIER_DEFS = {
    swift_movement: {
        id: "swift_movement",
        title: "Swift Movement",
        description: "All entities move 30% faster.",
        applyPlayer: (p) => {
            p.speedMultiplier *= 1.3;
            p.recalcDerivedStats();
        },
        applyEnemy: (e) => {
            e.speedMultiplier *= 1.3;
            e.recalcDerivedStats();
        },
    },
    veteran_enemies: {
        id: "veteran_enemies",
        title: "Veteran Enemies",
        description: "Enemies have +50% HP and +25% ATK, but reward 50% more XP.",
        applyEnemy: (e) => {
            e.maxHealth = Math.round(e.maxHealth * 1.5);
            e.currentHealth = e.maxHealth;
            e.attack = Math.round(e.attack * 1.25);
        },
        xpRewardMultiplier: 1.5,
    },
    rich_loot: {
        id: "rich_loot",
        title: "Rich Loot",
        description: "Enemies reward double XP and have improved loot rarity.",
        xpRewardMultiplier: 2.0,
        lootRarityBonus: 2,
    },
    glass_cannon: {
        id: "glass_cannon",
        title: "Glass Cannon",
        description: "Players deal 2x damage but have 50% less health.",
        applyPlayer: (p) => {
            p.damageMultiplier *= 2.0;
            p.maxHealth = Math.round(p.maxHealth * 0.5);
            p.currentHealth = Math.min(p.currentHealth, p.maxHealth);
        },
    },
    regeneration: {
        id: "regeneration",
        title: "Regeneration",
        description: "Players regenerate 5 HP per second.",
    },
};
// ============================================================
// Helper Functions
// ============================================================
export function applyPlayerModifiers(player, activeIds) {
    for (const id of activeIds) {
        const def = MODIFIER_DEFS[id];
        if (def?.applyPlayer) {
            def.applyPlayer(player);
        }
    }
}
export function applyEnemyModifiers(enemy, activeIds) {
    for (const id of activeIds) {
        const def = MODIFIER_DEFS[id];
        if (def?.applyEnemy) {
            def.applyEnemy(enemy);
        }
        if (def?.xpRewardMultiplier) {
            enemy.xpReward = Math.round(enemy.xpReward * def.xpRewardMultiplier);
        }
    }
}
export function getLootRarityBonus(activeIds) {
    let bonus = 0;
    for (const id of activeIds) {
        const def = MODIFIER_DEFS[id];
        if (def?.lootRarityBonus) {
            bonus += def.lootRarityBonus;
        }
    }
    return bonus;
}
export function getModifierInfo(activeIds) {
    return activeIds.map((id) => {
        const def = MODIFIER_DEFS[id];
        return {
            id: def.id,
            title: def.title,
            description: def.description,
        };
    });
}
// ============================================================
// Per-Map Modifier Configuration
// ============================================================
export const MAP_MODIFIERS = {
    game_room: [],
    game_room_2: ["swift_movement"],
};
export const MAP_INFO = {
    game_room: {
        name: "Sector 1: Outskirts",
        description: "The entrance to the hive. Tyranids and Orcks roam freely.",
    },
    game_room_2: {
        name: "Sector 2: Deep Hive",
        description: "The tunnels deepen. Swift movement is afoot.",
    },
};
