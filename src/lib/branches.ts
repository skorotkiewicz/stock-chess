import { Chess } from 'chess.js';

export interface Branch {
  id: string;
  name: string;
  parentId: string | null;
  forkPly: number;
  moves: string[];
  analysis: Map<number, { data: any; fen: string }>;
}

export class BranchState {
  rootFen: string;
  headers: Record<string, string>;
  items: Branch[];
  activeId: string;
  viewedPly: number;
  nextVariation: number;

  constructor(rootFen: string, moves: string[] = [], headers: Record<string, string> = {}) {
    this.rootFen = rootFen;
    // Standard PGN headers: imported values win, sane defaults otherwise.
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    this.headers = {
      Event: '?', Site: '?', Date: date, Round: '?',
      White: 'White', Black: 'Black', Result: '*',
      ...headers,
    };
    this.items = [{
      id: 'main', name: 'Main', parentId: null, forkPly: 0,
      moves: [...moves], analysis: new Map(),
    }];
    this.activeId = 'main';
    this.viewedPly = moves.length;
    this.nextVariation = 1;
  }

  get active(): Branch {
    return this.items.find((branch) => branch.id === this.activeId)!;
  }

  get isReviewing() {
    return this.viewedPly < this.active.moves.length;
  }

  view(ply: number) {
    if (!Number.isInteger(ply) || ply < 0 || ply > this.active.moves.length) {
      throw new RangeError('Invalid branch ply');
    }
    this.viewedPly = ply;
  }

  select(id: string) {
    const branch = this.items.find((item) => item.id === id);
    if (!branch) throw new Error(`Unknown branch: ${id}`);
    this.activeId = id;
    this.viewedPly = branch.moves.length;
    return branch;
  }

  takeback(count = 1) {
    if (this.isReviewing) return false;
    const length = Math.max(0, this.active.moves.length - count);
    this.active.moves.length = length;
    this.viewedPly = length;
    for (const ply of this.active.analysis.keys()) {
      if (ply > length) this.active.analysis.delete(ply);
    }
    return true;
  }

  append(move: string) {
    if (!this.isReviewing) {
      this.active.moves.push(move);
      this.viewedPly = this.active.moves.length;
      return { created: false, branch: this.active };
    }

    const parent = this.active;
    const forkPly = this.viewedPly;
    const number = this.nextVariation++;

    // A fork from a variation's shared prefix belongs to the ancestor line
    // that owns those moves; climb until the attach point is inside the
    // ancestor's own segment.
    let attach = parent;
    while (attach.parentId !== null && forkPly <= attach.forkPly) {
      attach = this.items.find((item) => item.id === attach.parentId)!;
    }

    const branch: Branch = {
      id: `variation-${number}`,
      name: `Variation ${number}`,
      parentId: attach.id,
      forkPly,
      moves: [...attach.moves.slice(0, forkPly), move],
      analysis: new Map([...attach.analysis].filter(([ply]) => ply <= forkPly)),
    };
    this.items.push(branch);
    this.activeId = branch.id;
    this.viewedPly = branch.moves.length;
    return { created: true, branch, parent, forkPly };
  }

  // Full PGN of the variation tree: main line, with branches as nested
  // parenthesized variations hanging off the move they fork from.
  toPgn(): string {
    const children = new Map<string, Branch[]>();
    for (const branch of this.items) {
      if (branch.parentId === null) continue;
      const key = `${branch.parentId}:${branch.forkPly}`;
      const list = children.get(key);
      if (list) list.push(branch);
      else children.set(key, [branch]);
    }

    const replay = (moves: string[]): string[] => {
      const game = new Chess(this.rootFen);
      const sans: string[] = [];
      for (const uci of moves) {
        try {
          const move = game.move({
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: uci.slice(4, 5) || undefined,
          });
          if (!move) break;
          sans.push(move.san);
        } catch {
          break;
        }
      }
      return sans;
    };

    const emit = (branch: Branch, sans: string[], startPly: number, out: string[]) => {
      for (let i = startPly; i < branch.moves.length && i < sans.length; i++) {
        const number = Math.floor(i / 2) + 1;
        if (i % 2 === 0) out.push(`${number}. ${sans[i]}`);
        else if (i === startPly) out.push(`${number}... ${sans[i]}`);
        else out.push(sans[i]);

        const kids = children.get(`${branch.id}:${i + 1}`);
        if (kids) {
          for (const kid of kids) {
            const variation: string[] = [];
            emit(kid, replay(kid.moves), kid.forkPly, variation);
            if (variation.length) out.push(`(${variation.join(' ')})`);
          }
        }
      }
    };

    const main = this.items[0];
    const body: string[] = [];
    emit(main, replay(main.moves), 0, body);

    const headerLines: string[] = [];
    const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
    for (const key of order) {
      if (this.headers[key]) headerLines.push(`[${key} "${this.headers[key]}"]`);
    }
    for (const [key, value] of Object.entries(this.headers)) {
      if (!order.includes(key) && value) headerLines.push(`[${key} "${value}"]`);
    }

    return `${headerLines.join('\n')}\n\n${body.join(' ') || '*'}`;
  }
}

interface ParsedLine {
  san: string[];
  variations: { atPly: number; line: ParsedLine }[];
}

function replayUcis(rootFen: string, sans: string[], prefix: string[] = []): string[] {
  const game = new Chess(rootFen);
  for (const uci of prefix) {
    try {
      game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
    } catch {
      break;
    }
  }
  const ucis: string[] = [];
  for (const san of sans) {
    try {
      const move = game.move(san);
      if (!move) break;
      ucis.push(`${move.from}${move.to}${move.promotion || ''}`);
    } catch {
      break;
    }
  }
  return ucis;
}

// Parses a PGN with (possibly nested) variations into a BranchState.
// Returns null when the input has no movetext or no legal moves.
export function parseVariationPgn(pgn: string): BranchState | null {
  const headers: Record<string, string> = {};
  let movetext = pgn.replace(/\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g, (_match, key: string, value: string) => {
    headers[key] = value.replace(/\\"/g, '"');
    return ' ';
  });
  movetext = movetext
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .trim();
  if (!movetext) return null;

  let rootFen: string;
  try {
    rootFen = headers.FEN ? new Chess(headers.FEN).fen() : new Chess().fen();
  } catch {
    rootFen = new Chess().fen();
  }

  const root: ParsedLine = { san: [], variations: [] };
  const stack: { line: ParsedLine; atPly: number; ply: number }[] = [{ line: root, atPly: 0, ply: 0 }];

  for (const token of movetext.split(/\s+/)) {
    if (!token) continue;
    const frame = stack[stack.length - 1];
    if (token === '(') {
      stack.push({ line: { san: [], variations: [] }, atPly: frame.ply, ply: 0 });
    } else if (token === ')') {
      if (stack.length > 1) {
        const finished = stack.pop()!;
        stack[stack.length - 1].line.variations.push({ atPly: finished.atPly, line: finished.line });
      }
    } else if (token === '*' || /^(1-0|0-1|1\/2-1\/2)$/.test(token)) {
      // Game result — ignore.
    } else {
      const san = token.replace(/^\d+\.+/, '').replace(/[?!]+$/, '');
      if (/[a-zA-Z]/.test(san)) {
        frame.line.san.push(san);
        frame.ply += 1;
      }
    }
  }

  if (!root.san.length && !root.variations.length) return null;
  const mainUcis = replayUcis(rootFen, root.san);
  if (!mainUcis.length && !root.variations.length) return null;

  const bs = new BranchState(rootFen, mainUcis, headers);
  bs.items[0].moves = mainUcis;
  bs.viewedPly = mainUcis.length;

  const addVariation = (parentId: string, atPly: number, line: ParsedLine) => {
    const source = bs.items.find((branch) => branch.id === parentId)!;
    const ucis = replayUcis(rootFen, line.san, source.moves.slice(0, atPly));
    // Same normalization as append: a fork inside a variation's shared
    // prefix belongs to the ancestor line that owns those moves.
    let attach = source;
    while (attach.parentId !== null && atPly <= attach.forkPly) {
      attach = bs.items.find((branch) => branch.id === attach.parentId)!;
    }
    const number = bs.nextVariation++;
    bs.items.push({
      id: `variation-${number}`,
      name: `Variation ${number}`,
      parentId: attach.id,
      forkPly: atPly,
      moves: [...attach.moves.slice(0, atPly), ...ucis],
      analysis: new Map(),
    });
    for (const sub of line.variations) addVariation(`variation-${number}`, atPly + sub.atPly, sub.line);
  };

  for (const variation of root.variations) addVariation('main', variation.atPly, variation.line);
  return bs;
}
