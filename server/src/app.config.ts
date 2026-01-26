import { defineServer, defineRoom, monitor, playground } from "colyseus";

/**
 * Import your Room files
 */
import { Part1Room } from "./rooms/Part1Room";
import { Part2Room } from "./rooms/Part2Room";
import { Part3Room } from "./rooms/Part3Room";
import { Part4Room } from "./rooms/Part4Room";

const server = defineServer({
    rooms: {
        part1_room: defineRoom(Part1Room),
        part2_room: defineRoom(Part2Room),
        part3_room: defineRoom(Part3Room),
        part4_room: defineRoom(Part4Room),
    },

    express: (app) => {
        /**
         * Bind your custom express routes here:
         */
        app.get("/hello", (req, res) => {
            res.send("It's time to kick ass and chew bubblegum!");
        });

        if (process.env.NODE_ENV !== "production") {
            app.use("/", playground());
        }

        /**
         * Bind @colyseus/monitor
         * It is recommended to protect this route with a password.
         * Read more: https://docs.colyseus.io/tools/monitor/
         */
        app.use("/monitor", monitor());
    },
});

export default server;