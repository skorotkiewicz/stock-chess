import { engine } from './engine.ts';

export function stockfishHealth(): Response {
	const ready = engine.isReady;
	return Response.json(
		{ status: ready ? 'ok' : 'starting', engine: 'Stockfish 19', ready },
		{ status: ready ? 200 : 503 },
	);
}
