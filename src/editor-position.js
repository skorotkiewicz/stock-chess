const CASTLING_PIECES = [
  ['K', 'white', 'e1', 'h1'],
  ['Q', 'white', 'e1', 'a1'],
  ['k', 'black', 'e8', 'h8'],
  ['q', 'black', 'e8', 'a8'],
];

export function buildEditorFen(placement, turn, existingCastling, pieces) {
  const hasPiece = (key, color, role) => {
    const piece = pieces.get(key);
    return piece && piece.color === color && piece.role === role;
  };
  const castling = CASTLING_PIECES
    .filter(([right, color, king, rook]) => existingCastling.includes(right) &&
      hasPiece(king, color, 'king') && hasPiece(rook, color, 'rook'))
    .map(([right]) => right)
    .join('');

  return `${placement} ${turn} ${castling || '-'} - 0 1`;
}
