import type { Context } from '@octanejs/app-core';
import { canonicalizeFen, engine } from './engine.ts';

export async function stockfishMove({ request }: Context): Promise<Response> {
	try {
		const data = (await request.json().catch(() => ({}))) as Record<string, unknown>;
		let fen: string;
		try {
			fen = canonicalizeFen(data.fen);
		} catch (err) {
			return Response.json({ error: (err as Error).message }, { status: 400 });
		}

		const level = typeof data.level === 'number' && Number.isInteger(data.level)
			? Math.max(1, Math.min(5, data.level))
			: 3;

		const result = await engine.query(fen, { level, signal: request.signal });
		return Response.json(result);
	} catch (err) {
		const message = (err as Error).message || 'Internal server error';
		if ((err as Error).name === 'AbortError') {
			return Response.json({ error: 'Request aborted' }, { status: 499 });
		}
		if (message.includes('queue is full')) {
			return Response.json({ error: message }, { status: 503 });
		}
		return Response.json({ error: message }, { status: 500 });
	}
}
