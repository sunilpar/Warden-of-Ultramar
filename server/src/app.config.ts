import { defineServer, defineRoom, monitor, playground } from "colyseus";

/**
 * Import your Room files
 */
import { GameRoom } from "./rooms/GameRoom";

const server = defineServer({
    rooms: {
        game_room: defineRoom(GameRoom),
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