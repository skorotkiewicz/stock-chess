import { Chess } from 'chess.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function describePly(rootFen, ply) {
  const fields = rootFen.split(' ');
  const offset = fields[1] === 'b' ? 1 : 0;
  const absolutePly = ply + offset;
  return {
    color: absolutePly % 2 === 0 ? 'white' : 'black',
    number: Number(fields[5]) + Math.floor(absolutePly / 2),
  };
}

function escapeHeader(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}

export class BranchState {
  constructor(rootFen, moves = [], headers = {}) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    this.rootFen = rootFen;
    this.headers = {
      Event: '?', Site: '?', Date: date, Round: '?',
      White: 'White', Black: 'Black', Result: '*',
      ...headers,
    };
    if (rootFen !== START_FEN && !this.headers.FEN) {
      this.headers.SetUp = this.headers.SetUp ?? '1';
      this.headers.FEN = rootFen;
    }
    this.items = [{
      id: 'main', name: 'Main', parentId: null, forkPly: 0,
      moves: [...moves], analysis: new Map(),
    }];
    this.activeId = 'main';
    this.viewedPly = moves.length;
    this.nextVariation = 1;
  }

  get active() {
    return this.items.find((branch) => branch.id === this.activeId);
  }

  get isReviewing() {
    return this.viewedPly < this.active.moves.length;
  }

  view(ply) {
    if (!Number.isInteger(ply) || ply < 0 || ply > this.active.moves.length) {
      throw new RangeError('Invalid branch ply');
    }
    this.viewedPly = ply;
  }

  select(id) {
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

  append(move) {
    if (!this.isReviewing) {
      this.active.moves.push(move);
      this.viewedPly = this.active.moves.length;
      return { created: false, branch: this.active };
    }

    const parent = this.active;
    const forkPly = this.viewedPly;
    const number = this.nextVariation++;
    let attach = parent;
    while (attach.parentId !== null && forkPly <= attach.forkPly) {
      attach = this.items.find((item) => item.id === attach.parentId);
    }

    const branch = {
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

  toPgn() {
    const children = new Map();
    for (const branch of this.items) {
      if (branch.parentId === null) continue;
      const key = `${branch.parentId}:${branch.forkPly}`;
      const list = children.get(key);
      if (list) list.push(branch);
      else children.set(key, [branch]);
    }

    const replay = (moves) => {
      const game = new Chess(this.rootFen);
      const sans = [];
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

    const emit = (branch, sans, startPly, out) => {
      for (let i = startPly; i < branch.moves.length && i < sans.length; i++) {
        const { color, number } = describePly(this.rootFen, i);
        if (color === 'white') out.push(`${number}. ${sans[i]}`);
        else if (i === startPly) out.push(`${number}... ${sans[i]}`);
        else out.push(sans[i]);

        for (const child of children.get(`${branch.id}:${i}`) || []) {
          const variation = [];
          emit(child, replay(child.moves), child.forkPly, variation);
          if (variation.length) out.push(`(${variation.join(' ')})`);
        }
      }
    };

    const body = [];
    emit(this.items[0], replay(this.items[0].moves), 0, body);

    const headerLines = [];
    const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
    for (const key of order) {
      if (this.headers[key]) headerLines.push(`[${key} "${escapeHeader(this.headers[key])}"]`);
    }
    for (const [key, value] of Object.entries(this.headers)) {
      if (!order.includes(key) && value) headerLines.push(`[${key} "${escapeHeader(value)}"]`);
    }

    const result = this.headers.Result || '*';
    return `${headerLines.join('\n')}\n\n${body.length ? `${body.join(' ')} ${result}` : result}`;
  }
}

function replayUcis(rootFen, sans, prefix = []) {
  const game = new Chess(rootFen);
  for (const uci of prefix) {
    try {
      game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined,
      });
    } catch {
      return null;
    }
  }

  const ucis = [];
  for (const san of sans) {
    try {
      const move = game.move(san);
      if (!move) return null;
      ucis.push(`${move.from}${move.to}${move.promotion || ''}`);
    } catch {
      return null;
    }
  }
  return ucis;
}

export function parseVariationPgn(pgn) {
  const headers = {};
  let movetext = pgn.replace(/\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g, (_match, key, value) => {
    headers[key] = value.replace(/\\(["\\])/g, '$1');
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

  let rootFen;
  try {
    rootFen = headers.FEN ? new Chess(headers.FEN).fen() : new Chess().fen();
  } catch {
    return null;
  }

  const root = { san: [], variations: [] };
  const stack = [{ line: root, atPly: 0, ply: 0 }];

  for (const token of movetext.split(/\s+/)) {
    if (!token) continue;
    const frame = stack.at(-1);
    if (token === '(') {
      stack.push({ line: { san: [], variations: [] }, atPly: Math.max(0, frame.ply - 1), ply: 0 });
    } else if (token === ')') {
      if (stack.length === 1) return null;
      const finished = stack.pop();
      if (!finished.line.san.length) return null;
      stack.at(-1).line.variations.push({ atPly: finished.atPly, line: finished.line });
    } else if (token === '*' || /^(1-0|0-1|1\/2-1\/2)$/.test(token)) {
      continue;
    } else {
      const san = token.replace(/^\d+\.+/, '').replace(/[?!]+$/, '');
      if (san && !/^\.+$/.test(san)) {
        frame.line.san.push(san);
        frame.ply += 1;
      }
    }
  }

  if (stack.length !== 1 || !root.san.length) return null;
  const mainUcis = replayUcis(rootFen, root.san);
  if (!mainUcis?.length) return null;

  const branches = new BranchState(rootFen, mainUcis, headers);
  const addVariation = (parentId, atPly, line) => {
    const source = branches.items.find((branch) => branch.id === parentId);
    if (!source || !line.san.length) return false;
    const ucis = replayUcis(rootFen, line.san, source.moves.slice(0, atPly));
    if (!ucis?.length) return false;
    let attach = source;
    while (attach.parentId !== null && atPly <= attach.forkPly) {
      attach = branches.items.find((branch) => branch.id === attach.parentId);
    }
    const number = branches.nextVariation++;
    const id = `variation-${number}`;
    branches.items.push({
      id,
      name: `Variation ${number}`,
      parentId: attach.id,
      forkPly: atPly,
      moves: [...attach.moves.slice(0, atPly), ...ucis],
      analysis: new Map(),
    });
    for (const variation of line.variations) {
      if (!addVariation(id, atPly + variation.atPly, variation.line)) return false;
    }
    return true;
  };

  for (const variation of root.variations) {
    if (!addVariation('main', variation.atPly, variation.line)) return null;
  }
  return branches;
}
