import { defineConfig, RenderRoute, ServerRoute } from "@octanejs/vite-plugin";
import { health } from "./src/server/health.ts";
import { stockfishMove } from "./src/server/stockfish-move.ts";
import { stockfishEval } from "./src/server/stockfish-eval.ts";
import { stockfishHealth } from "./src/server/stockfish-health.ts";

export default defineConfig({
	router: {
		routes: [
			new RenderRoute({ path: "/", entry: ["App", "/src/App.tsrx"] }),
			new ServerRoute({ path: "/api/stockfish/move", methods: ["POST"], handler: stockfishMove }),
			new ServerRoute({ path: "/api/stockfish/eval", methods: ["POST"], handler: stockfishEval }),
			new ServerRoute({ path: "/api/stockfish/health", handler: stockfishHealth }),
			new ServerRoute({ path: "/api/health", handler: health }),
		],
	},
});
