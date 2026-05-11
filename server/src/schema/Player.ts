/**
 * Player Schema
 * =============
 * Defines what player data gets synchronized to all clients.
 *
 * IMPORTANT: Only fields decorated with @type() are synced over the network.
 * Everything else stays server-side only.
 *
 * SERVER AUTHORITY: The server owns all of these values.
 * Clients can only SEND INPUT — the server decides position, HP, etc.
 * This prevents cheating (god mode, teleportation, etc.)
 */

import { Schema, type } from "@colyseus/schema";

/** Input data sent from client to server */
export interface InputData {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  tick?: number;
}

export class Player extends Schema {
  /** Current X position (server-authoritative) */
  @type("number") x: number = 0;

  /** Current Y position (server-authoritative) */
  @type("number") y: number = 0;

  /** Last processed input tick (used for client-side prediction) */
  @type("number") tick: number = 0;

  /** Current health points */
  @type("number") hp: number = 1000;

  /** Maximum health points */
  @type("number") maxHp: number = 1000;

  /** Movement speed in pixels per second */
  @type("number") speed: number = 120;

  /** Whether this player is dead */
  @type("boolean") isDead: boolean = false;

  /**
   * Input queue — NOT synced to clients.
   * The server processes these inputs and updates position.
   * This is how the server stays authoritative.
   */
  inputQueue: InputData[] = [];
}