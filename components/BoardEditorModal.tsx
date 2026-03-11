import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { OCRTile, WordResult } from "../utils/ocr";

// ── Types ─────────────────────────────────────────────────────────────────────

type CellSource = "ocr" | "manual";
type CellState = { letter: string; source: CellSource };
type CellKey = string; // `${col},${row}`

export type BoardCell = { letter: string; col: number; row: number };
export type StoredBoardWord = {
  word: string;
  direction: "horizontal" | "vertical";
  startCol: number;
  startRow: number;
};

export function ocrToBoard(
  tiles: OCRTile[],
  words: WordResult[]
): { tiles: BoardCell[]; words: StoredBoardWord[] } {
  const { cells } = initGrid(tiles, words);
  const boardTiles: BoardCell[] = [];
  for (const [k, v] of cells) {
    const [col, row] = k.split(",").map(Number);
    boardTiles.push({ letter: v.letter, col, row });
  }
  return { tiles: boardTiles, words: deriveWordsFromGrid(cells) };
}

function deriveWordsFromGrid(cells: Map<CellKey, CellState>): StoredBoardWord[] {
  const words: StoredBoardWord[] = [];

  // Collect all occupied positions
  const occupied = new Map<string, string>(); // "col,row" -> letter
  for (const [k, v] of cells) occupied.set(k, v.letter);

  // Horizontal: group cells by row, sort by col, find runs of 2+
  const byRow = new Map<number, number[]>();
  for (const k of occupied.keys()) {
    const [c, r] = k.split(",").map(Number);
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(c);
  }
  for (const [row, cols] of byRow) {
    const sorted = [...cols].sort((a, b) => a - b);
    let run: number[] = [sorted[0]];
    for (let i = 1; i <= sorted.length; i++) {
      if (i < sorted.length && sorted[i] === sorted[i - 1] + 1) {
        run.push(sorted[i]);
      } else {
        if (run.length >= 2) {
          words.push({
            word: run.map((c) => occupied.get(`${c},${row}`)!).join(""),
            direction: "horizontal",
            startCol: run[0],
            startRow: row,
          });
        }
        if (i < sorted.length) run = [sorted[i]];
      }
    }
  }

  // Vertical: group cells by col, sort by row, find runs of 2+
  const byCol = new Map<number, number[]>();
  for (const k of occupied.keys()) {
    const [c, r] = k.split(",").map(Number);
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(r);
  }
  for (const [col, rows] of byCol) {
    const sorted = [...rows].sort((a, b) => a - b);
    let run: number[] = [sorted[0]];
    for (let i = 1; i <= sorted.length; i++) {
      if (i < sorted.length && sorted[i] === sorted[i - 1] + 1) {
        run.push(sorted[i]);
      } else {
        if (run.length >= 2) {
          words.push({
            word: run.map((r) => occupied.get(`${col},${r}`)!).join(""),
            direction: "vertical",
            startCol: col,
            startRow: run[0],
          });
        }
        if (i < sorted.length) run = [sorted[i]];
      }
    }
  }

  return words;
}

// ── Grid initialisation ────────────────────────────────────────────────────────
// Uses word chains as hard constraints rather than pixel→grid rounding.
// BFS propagates exact grid offsets (+1 col per right-neighbour, +1 row per
// bottom-neighbour) through the word graph.  Tiles not connected through any
// word are re-anchored using the pixel transform of the main connected group.

function initGrid(tiles: OCRTile[], words: WordResult[]): {
  cells: Map<CellKey, CellState>;
  cols: number;
  rows: number;
} {
  if (tiles.length === 0) return { cells: new Map(), cols: 3, rows: 3 };

  // ── Build bidirectional neighbour map from word chains ──────────────────────
  type Nbr = { tile: OCRTile; dCol: number; dRow: number };
  const nbrs = new Map<OCRTile, Nbr[]>();
  for (const t of tiles) nbrs.set(t, []);

  for (const word of words) {
    for (let i = 0; i + 1 < word.tiles.length; i++) {
      const a = word.tiles[i], b = word.tiles[i + 1];
      const [dc, dr] = word.direction === "horizontal" ? [1, 0] : [0, 1];
      nbrs.get(a)!.push({ tile: b, dCol: dc,  dRow: dr  });
      nbrs.get(b)!.push({ tile: a, dCol: -dc, dRow: -dr });
    }
  }

  // ── BFS: assign relative grid positions within each connected component ──────
  const pos = new Map<OCRTile, { col: number; row: number }>();
  const components: OCRTile[][] = [];
  const queue: OCRTile[] = [];

  for (const start of tiles) {
    if (pos.has(start)) continue;
    const comp: OCRTile[] = [];
    pos.set(start, { col: 0, row: 0 });
    queue.push(start);
    while (queue.length) {
      const t = queue.shift()!;
      comp.push(t);
      const { col, row } = pos.get(t)!;
      for (const { tile: n, dCol, dRow } of nbrs.get(t)!) {
        if (!pos.has(n)) {
          pos.set(n, { col: col + dCol, row: row + dRow });
          queue.push(n);
        }
      }
    }
    components.push(comp);
  }

  // ── Compute pixel spacing from word chains for re-anchoring ─────────────────
  const median = (arr: number[]) => {
    if (!arr.length) return 0;
    return [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  };
  const hSp: number[] = [], vSp: number[] = [];
  for (const word of words) {
    for (let i = 1; i < word.tiles.length; i++) {
      const a = word.tiles[i - 1], b = word.tiles[i];
      const ax = (a.bbox.x0 + a.bbox.x1) / 2, ay = (a.bbox.y0 + a.bbox.y1) / 2;
      const bx = (b.bbox.x0 + b.bbox.x1) / 2, by = (b.bbox.y0 + b.bbox.y1) / 2;
      if (word.direction === "horizontal") hSp.push(Math.abs(bx - ax));
      else vSp.push(Math.abs(by - ay));
    }
  }
  const bboxSize = median(tiles.map(t => ((t.bbox.x1 - t.bbox.x0) + (t.bbox.y1 - t.bbox.y0)) / 2));
  const tsH = median(hSp) || median(vSp) || bboxSize;
  const tsV = median(vSp) || tsH;

  // ── Re-anchor secondary components against the largest (main) component ──────
  const main = components.reduce((a, b) => a.length >= b.length ? a : b);

  // Pixel origin = average of (cx - col*tsH, cy - row*tsV) across main component
  let sumOX = 0, sumOY = 0;
  for (const t of main) {
    const { col, row } = pos.get(t)!;
    sumOX += (t.bbox.x0 + t.bbox.x1) / 2 - col * tsH;
    sumOY += (t.bbox.y0 + t.bbox.y1) / 2 - row * tsV;
  }
  const originX = sumOX / main.length;
  const originY = sumOY / main.length;

  for (const comp of components) {
    if (comp === main) continue;
    // Use the component's anchor tile (pos = 0,0) to find its offset in main's grid
    const anchor = comp[0];
    const acx = (anchor.bbox.x0 + anchor.bbox.x1) / 2;
    const acy = (anchor.bbox.y0 + anchor.bbox.y1) / 2;
    const offCol = Math.round((acx - originX) / tsH);
    const offRow = Math.round((acy - originY) / tsV);
    for (const t of comp) {
      const { col, row } = pos.get(t)!;
      pos.set(t, { col: col + offCol, row: row + offRow });
    }
  }

  // ── Normalise to min=1 (1-tile border padding on every edge) ────────────────
  let minCol = Infinity, minRow = Infinity;
  for (const { col, row } of pos.values()) {
    if (col < minCol) minCol = col;
    if (row < minRow) minRow = row;
  }

  const cells = new Map<CellKey, CellState>();
  for (const [tile, { col, row }] of pos) {
    cells.set(`${col - minCol + 1},${row - minRow + 1}`, { letter: tile.letter, source: "ocr" });
  }

  const allCols = [...cells.keys()].map(k => parseInt(k.split(",")[0]));
  const allRows = [...cells.keys()].map(k => parseInt(k.split(",")[1]));
  return { cells, cols: Math.max(...allCols) + 2, rows: Math.max(...allRows) + 2 };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CELL = 44;  // px per grid cell
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// ── Component ─────────────────────────────────────────────────────────────────

export function BoardEditorModal({
  visible,
  onClose,
  tiles,
  words,
  initialCells,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  tiles: OCRTile[];
  words: WordResult[];
  initialCells?: BoardCell[];
  onSave: (cells: BoardCell[], words: StoredBoardWord[]) => void;
}) {
  const [cells, setCells] = useState<Map<CellKey, CellState>>(new Map());
  const [gridCols, setGridCols] = useState(3);
  const [gridRows, setGridRows] = useState(3);
  const [selecting, setSelecting] = useState<{ col: number; row: number } | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (initialCells && initialCells.length > 0) {
      const c = new Map<CellKey, CellState>();
      for (const cell of initialCells) {
        c.set(`${cell.col},${cell.row}`, { letter: cell.letter, source: "ocr" });
      }
      const allCols = initialCells.map((c) => c.col);
      const allRows = initialCells.map((c) => c.row);
      setCells(c);
      setGridCols(Math.max(...allCols) + 2);
      setGridRows(Math.max(...allRows) + 2);
    } else {
      const { cells: c, cols, rows } = initGrid(tiles, words);
      setCells(c);
      setGridCols(cols);
      setGridRows(rows);
    }
    setSelecting(null);
  }, [visible, tiles, words, initialCells]);

  // ── Cell press ───────────────────────────────────────────────────────────────

  function handleCellPress(col: number, row: number) {
    setSelecting((prev) =>
      prev?.col === col && prev?.row === row ? null : { col, row }
    );
  }

  // ── Letter selection ─────────────────────────────────────────────────────────
  // Places the letter, then expands the grid if the cell was on any border.

  function handleLetterSelect(letter: string) {
    if (!selecting) return;
    const { col, row } = selecting;

    const onLeft   = col === 0;
    const onRight  = col === gridCols - 1;
    const onTop    = row === 0;
    const onBottom = row === gridRows - 1;

    setCells((prev) => {
      const next = new Map<CellKey, CellState>();
      for (const [k, v] of prev) {
        let [c, r] = k.split(",").map(Number);
        if (onLeft) c += 1;
        if (onTop)  r += 1;
        next.set(`${c},${r}`, v);
      }
      // Place the new tile (adjusted for any shift applied above)
      next.set(`${onLeft ? col + 1 : col},${onTop ? row + 1 : row}`, {
        letter,
        source: "manual",
      });
      return next;
    });

    if (onLeft || onRight)   setGridCols((c) => c + 1);
    if (onTop  || onBottom)  setGridRows((r) => r + 1);
    setSelecting(null);
  }

  // ── Clear cell ───────────────────────────────────────────────────────────────

  function handleClearCell() {
    if (!selecting) return;
    const key = `${selecting.col},${selecting.row}`;
    setCells((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setSelecting(null);
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  function handleSave() {
    const result: BoardCell[] = [];
    for (const [k, v] of cells) {
      const [col, row] = k.split(",").map(Number);
      result.push({ letter: v.letter, col, row });
    }
    const derivedWords = deriveWordsFromGrid(cells);
    onSave(result, derivedWords);
    onClose();
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#fff" }}>

        {/* Header */}
        <View style={{
          flexDirection: "row", justifyContent: "space-between", alignItems: "center",
          padding: 16, borderBottomWidth: 1, borderBottomColor: "#eee",
        }}>
          <Text style={{ fontSize: 18, fontWeight: "700" }}>Edit Board</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={onClose}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "#ddd" }}
            >
              <Text style={{ color: "#444" }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: "#1a73e8" }}
            >
              <Text style={{ color: "#fff", fontWeight: "600" }}>Save</Text>
            </Pressable>
          </View>
        </View>

        {/* Legend */}
        <View style={{ flexDirection: "row", gap: 16, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 14, height: 14, backgroundColor: "#FFF8E1", borderWidth: 1, borderColor: "#F9A825", borderRadius: 2 }} />
            <Text style={{ fontSize: 11, color: "#666" }}>OCR detected</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 14, height: 14, backgroundColor: "#E8F5E9", borderWidth: 1, borderColor: "#388E3C", borderRadius: 2 }} />
            <Text style={{ fontSize: 11, color: "#666" }}>Manually added</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 14, height: 14, backgroundColor: "#fafafa", borderWidth: 1, borderColor: "#ddd", borderRadius: 2 }} />
            <Text style={{ fontSize: 11, color: "#666" }}>Empty (tap to add)</Text>
          </View>
        </View>

        {/* Grid — horizontally + vertically scrollable */}
        <ScrollView horizontal style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 8 }}>
            {Array.from({ length: gridRows }, (_, row) => (
              <View key={row} style={{ flexDirection: "row" }}>
                {Array.from({ length: gridCols }, (_, col) => {
                  const cell = cells.get(`${col},${row}`);
                  const isSelected = selecting?.col === col && selecting?.row === row;

                  const bg = isSelected
                    ? "#E3F2FD"
                    : cell?.source === "ocr"
                    ? "#FFF8E1"
                    : cell?.source === "manual"
                    ? "#E8F5E9"
                    : "#fafafa";

                  const borderColor = isSelected
                    ? "#1a73e8"
                    : cell?.source === "ocr"
                    ? "#F9A825"
                    : cell?.source === "manual"
                    ? "#388E3C"
                    : "#e0e0e0";

                  return (
                    <Pressable
                      key={col}
                      onPress={() => handleCellPress(col, row)}
                      style={{
                        width: CELL, height: CELL,
                        margin: 1,
                        borderRadius: 5,
                        borderWidth: isSelected ? 2 : 1,
                        borderColor,
                        backgroundColor: bg,
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      {cell && (
                        <Text style={{ fontSize: 20, fontWeight: "700", color: "#222" }}>
                          {cell.letter}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </ScrollView>

        {/* Letter picker — shown when a cell is selected */}
        {selecting && (
          <View style={{
            borderTopWidth: 1, borderTopColor: "#e0e0e0",
            backgroundColor: "#fff", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 16,
          }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Text style={{ fontSize: 13, color: "#555" }}>
                {cells.get(`${selecting.col},${selecting.row}`)
                  ? `Change letter at (${selecting.col}, ${selecting.row})`
                  : `Add tile at (${selecting.col}, ${selecting.row})`}
              </Text>
              <Pressable onPress={() => setSelecting(null)} style={{ padding: 4 }}>
                <Text style={{ fontSize: 16, color: "#888" }}>✕</Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
              {LETTERS.map((l) => (
                <Pressable
                  key={l}
                  onPress={() => handleLetterSelect(l)}
                  style={{
                    width: 38, height: 38,
                    backgroundColor: "#f5f5f5",
                    borderRadius: 5,
                    borderWidth: 1, borderColor: "#ddd",
                    justifyContent: "center", alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "700", fontSize: 15 }}>{l}</Text>
                </Pressable>
              ))}

              {/* Clear tile button — only shown if cell has a tile */}
              {cells.get(`${selecting.col},${selecting.row}`) && (
                <Pressable
                  onPress={handleClearCell}
                  style={{
                    width: 38, height: 38,
                    backgroundColor: "#FFEBEE",
                    borderRadius: 5,
                    borderWidth: 1, borderColor: "#FFCDD2",
                    justifyContent: "center", alignItems: "center",
                  }}
                >
                  <Text style={{ fontSize: 16, color: "#C62828" }}>✕</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}
