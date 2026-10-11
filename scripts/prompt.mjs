// The decision prompt core is shared verbatim by every provider — same role,
// same reasoning rules, same candidate-description explanation. The only
// per-provider addition is the output requirement on top (Jev's choice schema
// enforces the output shape by itself, so it appends nothing).
export const DECISION_INSTRUCTIONS = `Choose one cell from criteria to reveal.
Numbers count mines in the eight neighboring cells, including diagonals.
Flags mark confirmed mines.
Prefer a cell that is provably safe; otherwise choose one with the lowest estimated mine probability.
If several cells are equally safe, any of them is acceptable.`;