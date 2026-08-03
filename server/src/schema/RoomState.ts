/**
 * Room State Schema
 * =================
 * The top-level state object that gets synced to all clients.
 * Colyseus automatically detects changes to @type fields and
 * sends only the changed values to clients (bandwidth optimization).
 */

import { Schema, type, MapSchema } from "@colyseus/schema";
import { Player } from "./Player";

export class RoomState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
