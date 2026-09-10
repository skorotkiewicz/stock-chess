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
