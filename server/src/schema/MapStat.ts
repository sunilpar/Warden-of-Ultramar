/**
 * MapStat Schema (synced)
 * =======================
 * A single active "map stat" carried over from a previous map.
 * Lives on RoomState.activeMapStats; expires when durationMaps hits 0.
 *
 * The client mirrors this struct purely for display (chip + tooltip);
 * the actual effects are applied server-side by querying this list.
 */
import { Schema, type } from "@colyseus/schema";

export class MapStat extends Schema {
  /** Stable id "<good>-but-<bad>" (good + bad names kebab-cased). */
  @type("string") defId: string = "";
  /** Display name of the player-buff component (e.g. "Furious"). */
  @type("string") goodName: string = "";
  /** Display name of the enemy-buff component (e.g. "Tanky"). */
  @type("string") badName: string = "";
  /** Effect id for the good component (see mapStats.StatEffect). */
  @type("string") goodEffect: string = "";
  /** Effect id for the bad component (see mapStats.StatEffect). */
  @type("string") badEffect: string = "";
  /** Rolled value of the good component (fraction or weight unit). */
  @type("number") goodValue: number = 0;
  /** Rolled value of the bad component (fraction or weight unit). */
  @type("number") badValue: number = 0;
  /** Maps remaining. 1 = expires on next transition. */
  @type("number") durationMaps: number = 0;
}
