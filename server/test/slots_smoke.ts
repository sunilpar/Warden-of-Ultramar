// Smoke test for the slot-based card HUD model.
import { Player, NUM_CARD_SLOTS } from "../src/schema/Player";
import { CardInstance } from "../src/schema/CardInstance";

function mkCard(skill: string, level: number, rarity = "common", mods: string[] = []): CardInstance {
  const c = new CardInstance();
  c.skill = skill;
  c.level = level;
  c.rarity = rarity;
  for (const m of mods) c.modIds.push(m);
  return c;
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log("PASS: " + name); }
  else { fail++; console.log("FAIL: " + name); }
}

// --- Setup: fresh player with starter cards ---
const p = new Player();
p.initBaseStats();
const starters = ["shock", "pulse", "dash", "heal", "vortex"];
for (let i = 0; i < NUM_CARD_SLOTS; i++) {
  p.setSlotCard(i, mkCard(starters[i], 1));
}

// --- Bug 3: replace slam->claw... setup: slot 0 = slam ---
p.clearSlotCard(0);
p.setSlotCard(0, mkCard("slam", 3, "rare", ["inc_crit_rate", "inc_atk_damage"]));
check("slot 0 holds slam L3 rare", p.slotCard(0)!.skill === "slam" && p.slotCard(0)!.level === 3);

// Equip claw into slot 0: old slam must come back (to be dropped), claw in slot.
const oldSlam = p.setSlotCard(0, mkCard("claw", 2));
check("BUG3: replacing slam with claw returns the slam card", !!oldSlam && oldSlam.skill === "slam" && oldSlam.level === 3 && oldSlam.rarity === "rare");
check("BUG3: slot 0 now holds claw", p.slotCard(0)!.skill === "claw");
check("BUG3: slam skill level now 0 (unequipped)", p.getSkillLevel("slam") === 0);
check("BUG3: claw skill level 2", p.getSkillLevel("claw") === 2);

// --- Bug 2: equip into EMPTY slot must drop nothing ---
p.clearSlotCard(4); // slot 4 empty now
check("slot 4 is empty", !p.hasSlotCard(4));
const oldFromEmpty = p.setSlotCard(4, mkCard("bolter", 1));
check("BUG2: equipping into empty slot returns null (nothing dropped)", oldFromEmpty === null);
check("BUG2: slot 4 holds bolter", p.slotCard(4)!.skill === "bolter");

// --- Bug 1: duplicates allowed; each slot independent mods ---
p.setSlotCard(1, mkCard("claw", 2)); // slot 1 = claw too
check("BUG1: two claw cards equipped simultaneously",
  p.slotCard(0)!.skill === "claw" && p.slotCard(1)!.skill === "claw");
check("BUG1: both claw slots cast-able (skill level 2)", p.getSkillLevel("claw") === 2);

// Per-slot mods independent: slot 0 claw has crit-rate mods, slot 1 plain.
p.setSlotCard(0, mkCard("claw", 2, "epic", ["inc_crit_rate", "inc_crit_rate", "inc_crit_damage"]));
check("BUG1: slot 0 mods give +20% crit rate", Math.abs(p.slotCritRateBonus(0) - 0.2) < 1e-9);
check("BUG1: slot 1 mods give 0 crit rate", p.slotCritRateBonus(1) === 0);
check("BUG1: slot 0 crit dmg +20%", Math.abs(p.slotCritDamageBonus(0) - 0.2) < 1e-9);

// Skill level derived = max across slots
p.setSlotCard(2, mkCard("claw", 7));
check("skill level = max across duplicate slots (7)", p.getSkillLevel("claw") === 7);

// --- Empty-slot drop is a no-op (message 10 path checks hasSlotCard) ---
check("hasSlotCard(3) before", p.hasSlotCard(3));
p.clearSlotCard(3);
check("cleared slot 3", !p.hasSlotCard(3));

// --- Sync shape: ArraySchema of 5 with null holes ---
check("equippedSlots length 5", p.equippedSlots.length === NUM_CARD_SLOTS);
check("equippedSlots[3] is empty sentinel", !p.equippedSlots[3] || !p.equippedSlots[3].skill);
check("equippedSlots[0] survives", p.equippedSlots[0]!.skill === "claw");

// --- Death wipes ---
p.respawn();
check("respawn empties all slots", p.equippedSlots.every((c) => !c || !c.skill));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
