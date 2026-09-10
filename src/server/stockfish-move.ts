import type { Context } from '@octanejs/app-core';
import { engine } from './engine.ts';

export async function stockfishMove({ request }: Context): Promise<Response> {
	try {
		const data = (await request.json().catch(() => ({}))) as { fen?: string; level?: number };
		if (!data.fen) {
			return Response.json({ error: 'Missing fen parameter' }, { status: 400 });
		}
		const result = await engine.query(data.fen, { level: data.level });
		return Response.json(result);
	} catch (err) {
		return Response.json({ error: (err as Error).message }, { status: 500 });
	}
}
