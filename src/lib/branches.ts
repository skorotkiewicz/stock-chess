export interface Branch {
  id: string;
  name: string;
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
    this.headers = { ...headers };
    this.items = [{ id: 'main', name: 'Main', moves: [...moves], analysis: new Map() }];
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
    const branch: Branch = {
      id: `variation-${number}`,
      name: `Variation ${number}`,
      moves: [...parent.moves.slice(0, forkPly), move],
      analysis: new Map([...parent.analysis].filter(([ply]) => ply <= forkPly)),
    };
    this.items.push(branch);
    this.activeId = branch.id;
    this.viewedPly = branch.moves.length;
    return { created: true, branch, parent, forkPly };
  }
}
