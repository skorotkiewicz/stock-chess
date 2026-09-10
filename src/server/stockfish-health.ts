import { engine } from './engine.ts';

export function stockfishHealth(): Response {
	return Response.json({ status: 'ok', engine: 'Stockfish 19', ready: engine.isReady });
}
