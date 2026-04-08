
export type OCRTile = {
  letter: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Object URL of the processed 128×128 image fed to the matcher — caller must revoke. */
  debugUrl: string;
};

export type WordResult = {
  word: string;
  direction: 'horizontal' | 'vertical';
  tiles: OCRTile[];
};

export type OCRResult = {
  tiles: OCRTile[];
  words: WordResult[];
  /** Object URL of annotated debug image — caller must revoke. */
  debugImageUrl: string;
};

// ── Canvas helpers ────────────────────────────────────────────────────────────

function makeCanvas(w: number, h: number) {
  const canvas: any =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D };
}

async function canvasToBlob(canvas: any): Promise<Blob> {
  if (typeof canvas.convertToBlob === 'function')
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return new Promise((res) => canvas.toBlob((b: Blob) => res(b), 'image/jpeg', 0.92));
}

// PNG is lossless — mandatory for binary tile images fed to Tesseract.
// JPEG ringing artefacts around strokes cause Tesseract to fail on otherwise clear tiles.
async function canvasToPngBlob(canvas: any): Promise<Blob> {
  if (typeof canvas.convertToBlob === 'function')
    return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((res) => canvas.toBlob((b: Blob) => res(b!), 'image/png'));
}

// ── Otsu threshold ────────────────────────────────────────────────────────────

function otsu(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const n = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sumB = 0, maxV = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB || wB === n) continue;
    const wF = n - wB;
    sumB += i * hist[i];
    const d = sumB / wB - (sum - sumB) / wF;
    const v = wB * wF * d * d;
    if (v > maxV) { maxV = v; t = i; }
  }
  // Clamp to a sane range to guard against degenerate images
  return Math.max(60, Math.min(200, t));
}

// ── Connected components (DFS, 4-connectivity) ────────────────────────────────

type BlobRect = { x0: number; y0: number; x1: number; y1: number; area: number };

function connectedComponents(binary: Uint8Array, w: number, h: number): BlobRect[] {
  const visited = new Uint8Array(w * h);
  const blobs: BlobRect[] = [];

  for (let i0 = 0; i0 < w * h; i0++) {
    if (!binary[i0] || visited[i0]) continue;
    let x0 = i0 % w, y0 = Math.floor(i0 / w);
    let x1 = x0, y1 = y0, area = 0;
    const stk = [i0];
    visited[i0] = 1;

    while (stk.length) {
      const idx = stk.pop()!;
      const y = Math.floor(idx / w), x = idx % w;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      area++;
      if (x > 0   && binary[idx - 1] && !visited[idx - 1]) { visited[idx - 1] = 1; stk.push(idx - 1); }
      if (x < w-1 && binary[idx + 1] && !visited[idx + 1]) { visited[idx + 1] = 1; stk.push(idx + 1); }
      if (y > 0   && binary[idx - w] && !visited[idx - w]) { visited[idx - w] = 1; stk.push(idx - w); }
      if (y < h-1 && binary[idx + w] && !visited[idx + w]) { visited[idx + w] = 1; stk.push(idx + w); }
    }
    blobs.push({ x0, y0, x1, y1, area });
  }
  return blobs;
}

// ── Tile rect detection ───────────────────────────────────────────────────────
// Strategy: find dark blobs (letter strokes), estimate tile size from letter
// heights, then expand each letter bbox to its tile boundary.

type TileRect = { x0: number; y0: number; x1: number; y1: number };

function iou(a: TileRect, b: TileRect): number {
  const ix0 = Math.max(a.x0, b.x0), iy0 = Math.max(a.y0, b.y0);
  const ix1 = Math.min(a.x1, b.x1), iy1 = Math.min(a.y1, b.y1);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  const inter = (ix1 - ix0) * (iy1 - iy0);
  return inter / ((a.x1-a.x0)*(a.y1-a.y0) + (b.x1-b.x0)*(b.y1-b.y0) - inter);
}

function nms(boxes: TileRect[]): TileRect[] {
  // Sort largest-first so we prefer bigger (more complete) tile boxes
  const sorted = [...boxes].sort(
    (a, b) => (b.x1-b.x0)*(b.y1-b.y0) - (a.x1-a.x0)*(a.y1-a.y0)
  );
  const keep = new Array(sorted.length).fill(true);
  for (let i = 0; i < sorted.length; i++) {
    if (!keep[i]) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      if (!keep[j]) continue;
      if (iou(sorted[i], sorted[j]) > 0.3) keep[j] = false;
    }
  }
  return sorted.filter((_, i) => keep[i]);
}

// Maximum value each RGB channel can be for a pixel to count as ink.
// Bananagram letters are printed in near-black ink (R≈G≈B≈10-25).
// Keeping this low means shadows, cream backgrounds, and table surfaces
// are all ignored — only the actual letter strokes get marked as dark.
const INK_MAX = 60;

function detectTileRects(rgba: Uint8ClampedArray, w: number, h: number): TileRect[] {
  // Mark ink pixels: all three channels must be <= INK_MAX.
  // This is much more selective than Otsu and doesn't get thrown off by
  // uneven lighting, shadows, or the cream tile background.
  // ── Pixel value distribution diagnostic ─────────────────────────────────
  // Logs how many pixels fall below each brightness bracket so we can see
  // where the actual ink lives vs shadows vs background.
  const brackets = [20, 30, 40, 50, 60, 80, 100, 128];
  const counts = new Array(brackets.length).fill(0);
  let minVal = 255;
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); // max channel
    if (v < minVal) minVal = v;
    for (let b = 0; b < brackets.length; b++) {
      if (v <= brackets[b]) { counts[b]++; break; }
    }
  }
  console.log('[TileDetect] Darkest pixel max-channel:', minVal);
  console.log('[TileDetect] Pixel distribution (max-channel ≤ threshold):',
    brackets.map((t, i) => `≤${t}: ${counts.slice(0, i + 1).reduce((a, b) => a + b, 0)}`).join('  '));

  const dark = new Uint8Array(w * h);
  let inkPixels = 0;
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (r <= INK_MAX && g <= INK_MAX && b <= INK_MAX) {
      dark[i] = 255;
      inkPixels++;
    }
  }
  console.log(`[TileDetect] Ink pixels (RGB<=${INK_MAX}): ${inkPixels} / ${w * h} (${(inkPixels / (w * h) * 100).toFixed(2)}%)`);

  const blobs = connectedComponents(dark, w, h);
  console.log('[TileDetect] Raw dark blobs:', blobs.length);

  // Filter to letter-sized blobs:
  //   - height between 1/80 and 1/6 of image width
  //     (lowered from 1/60 → 1/80 so glare-split letter fragments aren't dropped)
  //   - width at least 6% of height
  //     (lowered from 15% → 6% so thin strokes like 'I' aren't rejected)
  //   - width at most 2.5× height     (excludes wide horizontal smears)
  //   - fill factor > 3%              (relaxed from 5% for thin strokes)
  //   - area < 8% of image            (excludes large background blobs)
  const minH = Math.max(4, w / 80);
  const maxH = w / 6;
  const maxArea = w * h * 0.08;

  let rejTooShort = 0, rejTooTall = 0, rejAspect = 0, rejFill = 0, rejArea = 0;
  const letterBlobs = blobs.filter(b => {
    const bh = b.y1 - b.y0 + 1, bw = b.x1 - b.x0 + 1;
    if (bh < minH) { rejTooShort++; return false; }
    if (bh > maxH) { rejTooTall++; return false; }
    if (bw < bh * 0.06 || bw > bh * 2.5) { rejAspect++; return false; }
    if (b.area < bw * bh * 0.03) { rejFill++; return false; }
    if (b.area > maxArea) { rejArea++; return false; }
    return true;
  });
  console.log(`[TileDetect] Letter blob filter: ${blobs.length} → ${letterBlobs.length} kept`,
    `| dropped: tooShort=${rejTooShort} tooTall=${rejTooTall} aspect=${rejAspect} fill=${rejFill} area=${rejArea}`);
  console.log(`[TileDetect] Size window: minH=${minH.toFixed(1)} maxH=${maxH.toFixed(1)}`);

  if (letterBlobs.length === 0) {
    console.warn('[TileDetect] No letter-sized blobs found — check lighting/contrast');
    return [];
  }

  // Estimate tile size from the median letter-blob height
  // Bananagram letters fill roughly 60% of the tile height
  const heights = letterBlobs.map(b => b.y1 - b.y0 + 1).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)];
  const tileSize = Math.round(medH / 0.60);
  const half = tileSize / 2;

  console.log('[TileDetect] Letter blobs:', letterBlobs.length,
    '| median letter height:', medH, '| estimated tile size:', tileSize);

  // Only keep blobs with height within 40% of the median (removes outliers)
  const coreBlobs = letterBlobs.filter(b => {
    const bh = b.y1 - b.y0 + 1;
    return bh > medH * 0.6 && bh < medH * 1.4;
  });
  console.log(`[TileDetect] Core blobs (within 40% of median height): ${letterBlobs.length} → ${coreBlobs.length}`);

  // Expand each letter blob centre → tile boundary.
  // Background brightness check removed: our selective INK_MAX threshold already
  // ensures only genuine ink blobs reach this point, so the check was a net
  // negative — it was rejecting real tiles in shadowed areas.
  const expanded: TileRect[] = coreBlobs.map(b => {
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    return {
      x0: Math.max(0, Math.round(cx - half)),
      y0: Math.max(0, Math.round(cy - half)),
      x1: Math.min(w - 1, Math.round(cx + half)),
      y1: Math.min(h - 1, Math.round(cy + half)),
    };
  });
  console.log(`[TileDetect] Expanded tile rects: ${expanded.length}`);

  // NMS: remove duplicate boxes caused by multi-blob letters (e.g. 'i' dot + stroke)
  const deduped = nms(expanded);
  console.log('[TileDetect] Tiles after NMS:', deduped.length);

  // Isolation filter: every real tile should have at least one neighbour within
  // 2.5× the tile size (tiles are adjacent on the board). Blobs further away
  // than that are false positives — shadows, table edges, background marks, etc.
  let postIsolation = deduped;
  if (deduped.length > 1) {
    const centers = deduped.map(t => ({ x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2 }));
    const maxDist = tileSize * 2.5;
    postIsolation = deduped.filter((_, i) => {
      const c = centers[i];
      return centers.some((n, j) => {
        if (j === i) return false;
        const dx = c.x - n.x, dy = c.y - n.y;
        return Math.sqrt(dx * dx + dy * dy) <= maxDist;
      });
    });
    console.log('[TileDetect] Tiles after isolation filter:', postIsolation.length);
  }

  // ── Centroid outlier filter ───────────────────────────────────────────────
  // False positives in the background often survive the isolation filter when
  // two of them happen to be near each other. This pass finds the centre of mass
  // of the surviving tiles and drops any tile whose distance from that centre
  // exceeds 3× the median distance — i.e. genuine outliers from the main cluster.
  if (postIsolation.length > 3) {
    const cs = postIsolation.map(t => ({ x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2 }));
    const cx = cs.reduce((s, c) => s + c.x, 0) / cs.length;
    const cy = cs.reduce((s, c) => s + c.y, 0) / cs.length;
    const dists = cs.map(c => Math.sqrt((c.x - cx) ** 2 + (c.y - cy) ** 2));
    const sortedDists = [...dists].sort((a, b) => a - b);
    const medDist = sortedDists[Math.floor(sortedDists.length / 2)];
    // Threshold: at least 4 tile-widths from centre, or 3× median — whichever is larger.
    // The tileSize floor prevents over-trimming on small/compact boards.
    const threshold = Math.max(tileSize * 4, medDist * 3);
    const centroidFiltered = postIsolation.filter((_, i) => dists[i] <= threshold);
    console.log(`[TileDetect] Tiles after centroid filter: ${postIsolation.length} → ${centroidFiltered.length}`,
      `| centre=(${cx.toFixed(0)},${cy.toFixed(0)}) medDist=${medDist.toFixed(0)} threshold=${threshold.toFixed(0)}`);
    return centroidFiltered;
  }

  return postIsolation;
}

// ── Morphological operations ──────────────────────────────────────────────────

function dilateMask(mask: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (
        mask[y * size + x] ||
        (x > 0        && mask[y * size + (x - 1)]) ||
        (x < size - 1 && mask[y * size + (x + 1)]) ||
        (y > 0        && mask[(y - 1) * size + x]) ||
        (y < size - 1 && mask[(y + 1) * size + x])
      ) {
        out[y * size + x] = 255;
      }
    }
  }
  return out;
}

// Shrinks dark regions by 1px. Applied after dilation to create morphological
// closing: fills tiny threshold gaps without net-thickening strokes.
// Prevents dilation from closing the loops of P, B, R, D.
function erodeMask(mask: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (
        mask[y * size + x] &&
        mask[y * size + (x - 1)] &&
        mask[y * size + (x + 1)] &&
        mask[(y - 1) * size + x] &&
        mask[(y + 1) * size + x]
      ) {
        out[y * size + x] = 255;
      }
    }
  }
  return out;
}

// ── Largest connected dark component ─────────────────────────────────────────
// Returns a mask where only the pixels of the largest dark (255) connected
// component are set to 255; all other pixels are 0.
// Used to strip edge noise / shadow specks, leaving just the letter strokes.

function largestDarkComponent(dark: Uint8Array, w: number, h: number): Uint8Array {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  let label = 0;

  for (let i0 = 0; i0 < w * h; i0++) {
    if (!dark[i0] || labels[i0] >= 0) continue;
    const stk: number[] = [i0];
    labels[i0] = label;
    let size = 0;
    while (stk.length) {
      const idx = stk.pop()!;
      size++;
      const y = Math.floor(idx / w), x = idx % w;
      if (x > 0   && dark[idx - 1] && labels[idx - 1] < 0) { labels[idx - 1] = label; stk.push(idx - 1); }
      if (x < w-1 && dark[idx + 1] && labels[idx + 1] < 0) { labels[idx + 1] = label; stk.push(idx + 1); }
      if (y > 0   && dark[idx - w] && labels[idx - w] < 0) { labels[idx - w] = label; stk.push(idx - w); }
      if (y < h-1 && dark[idx + w] && labels[idx + w] < 0) { labels[idx + w] = label; stk.push(idx + w); }
    }
    sizes.push(size);
    label++;
  }

  const out = new Uint8Array(w * h);
  if (label === 0) return out;

  let maxLabel = 0;
  for (let i = 1; i < sizes.length; i++) {
    if (sizes[i] > sizes[maxLabel]) maxLabel = i;
  }
  for (let i = 0; i < w * h; i++) {
    if (labels[i] === maxLabel) out[i] = 255;
  }
  return out;
}

// ── Per-tile crop → Blob ──────────────────────────────────────────────────────
// Returns null if the crop looks invalid (mostly black = shadow / bad detect).

async function cropTile(
  srcCanvas: any,
  rect: TileRect,
  thresholdOverride?: number,
  percentile?: number,
  inset = 0.15,
  erode = false,
): Promise<{ blob: Blob; pixels: Uint8Array; thresh: number; darkRatio: number }> {
  const SIZE = 128;
  const PAD = 18;

  const fullW = Math.max(1, rect.x1 - rect.x0);
  const fullH = Math.max(1, rect.y1 - rect.y0);

  // Inset per side to strip the dark tile border before thresholding.
  const insetX = Math.round(fullW * inset);
  const insetY = Math.round(fullH * inset);
  const sx = rect.x0 + insetX;
  const sy = rect.y0 + insetY;
  const sw = Math.max(1, fullW - insetX * 2);
  const sh = Math.max(1, fullH - insetY * 2);

  const scale = Math.min((SIZE - PAD * 2) / sw, (SIZE - PAD * 2) / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const dx = Math.round((SIZE - dw) / 2);
  const dy = Math.round((SIZE - dh) / 2);

  const { canvas, ctx } = makeCanvas(SIZE, SIZE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(srcCanvas, sx, sy, sw, sh, dx, dy, dw, dh);

  const imgData = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = imgData.data;

  // Grayscale
  const tileGray = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    tileGray[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  }

  // Threshold selection:
  //  1. percentile mode — mark the darkest N% of pixels as dark regardless of
  //     absolute brightness. Robust against shadowed/low-contrast tiles because
  //     it always finds exactly the darkest region.
  //  2. explicit override — used by the threshold-sweep retry loop.
  //  3. adaptive Otsu — raise in steps while too many pixels are dark.
  let thresh: number;
  if (percentile !== undefined) {
    const sorted = new Uint8Array(tileGray).sort();
    thresh = sorted[Math.floor(sorted.length * percentile / 100)];
    thresh = Math.max(40, Math.min(220, thresh));
  } else if (thresholdOverride !== undefined) {
    thresh = Math.max(60, Math.min(245, thresholdOverride));
  } else {
    thresh = Math.max(120, Math.min(220, otsu(tileGray)));
    for (let attempt = 0; attempt < 6; attempt++) {
      let darkCount = 0;
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (tileGray[i] < thresh) darkCount++;
      }
      // Cap at 22%: thick letters (B, P, R) legitimately use ~15-20% of the
      // tile area; anything above 22% means shadow ink is contaminating the mask.
      if (darkCount / (SIZE * SIZE) <= 0.22) break;
      thresh = Math.min(245, thresh + 15);
    }
  }

  // Initial dark mask
  const dark = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    dark[i] = tileGray[i] < thresh ? 255 : 0;
  }

  // Dilate 1px to connect thin strokes, then optionally erode (closing).
  // We no longer call largestDarkComponent here — for thin-stroked letters like
  // R and P the vertical stroke, bowl, and leg can be slightly disconnected after
  // thresholding. Keeping only the largest component was discarding the other
  // strokes, leaving Tesseract with just a vertical bar → 0% confidence.
  // Since we're operating on a single tightly-cropped tile there's minimal
  // background noise to worry about.
  const dilated = dilateMask(dark, SIZE);
  const letterMask = erode ? erodeMask(dilated, SIZE) : dilated;

  // Write clean binary image back to canvas and measure inner dark ratio
  // so the retry loop can detect a still-corrupted mask.
  const M = 16;
  let darkInner = 0;
  const pixels = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = letterMask[i] ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
    pixels[i] = v;
    const y = Math.floor(i / SIZE), x = i % SIZE;
    if (v === 0 && x >= M && x < SIZE - M && y >= M && y < SIZE - M) darkInner++;
  }
  ctx.putImageData(imgData, 0, 0);

  const innerTotal = (SIZE - M * 2) * (SIZE - M * 2);
  const darkRatio = darkInner / innerTotal;

  return { blob: await canvasToPngBlob(canvas), pixels, thresh, darkRatio };
}

// ── Word detection ────────────────────────────────────────────────────────────
// Finds words by direct bbox-proximity chaining — no row/column grouping.
// For each tile we find its closest right-neighbour (horizontal) and closest
// bottom-neighbour (vertical) based purely on whether the bounding boxes are
// close and overlapping in the perpendicular axis.  Following those links
// produces chains that become words.

export function detectWords(tiles: OCRTile[]): WordResult[] {
  if (tiles.length === 0) return [];

  // Median tile size — used to scale the gap and overlap tolerances.
  const sizes = tiles.map(t => ((t.bbox.x1 - t.bbox.x0) + (t.bbox.y1 - t.bbox.y0)) / 2);
  const tileSize = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)];

  const gapTol     = tileSize * 0.75; // max edge-to-edge gap to be "touching"
  const overlapMin = tileSize * 0.25; // min perpendicular overlap required

  // Returns the nearest tile that is directly to the right of `tile` and
  // overlaps it vertically, or null if none is close enough.
  const rightOf = (tile: OCRTile): OCRTile | null => {
    let best: OCRTile | null = null;
    let bestGap = gapTol;
    for (const other of tiles) {
      if (other === tile) continue;
      if (other.bbox.x0 <= tile.bbox.x0) continue;           // must be to the right
      const gap = other.bbox.x0 - tile.bbox.x1;
      if (gap >= bestGap) continue;                           // not the closest
      const yOverlap = Math.min(tile.bbox.y1, other.bbox.y1) - Math.max(tile.bbox.y0, other.bbox.y0);
      if (yOverlap < overlapMin) continue;                    // must share vertical space
      best = other; bestGap = gap;
    }
    return best;
  };

  // Returns the nearest tile directly below `tile` that overlaps it horizontally.
  const below = (tile: OCRTile): OCRTile | null => {
    let best: OCRTile | null = null;
    let bestGap = gapTol;
    for (const other of tiles) {
      if (other === tile) continue;
      if (other.bbox.y0 <= tile.bbox.y0) continue;           // must be below
      const gap = other.bbox.y0 - tile.bbox.y1;
      if (gap >= bestGap) continue;
      const xOverlap = Math.min(tile.bbox.x1, other.bbox.x1) - Math.max(tile.bbox.x0, other.bbox.x0);
      if (xOverlap < overlapMin) continue;                    // must share horizontal space
      best = other; bestGap = gap;
    }
    return best;
  };

  const words: WordResult[] = [];

  // ── Horizontal chains ─────────────────────────────────────────────────────
  // Build the set of tiles that have a left-neighbour — they are not word starts.
  const hasLeftNeighbour = new Set<OCRTile>();
  for (const t of tiles) { const r = rightOf(t); if (r) hasLeftNeighbour.add(r); }

  for (const start of tiles) {
    if (hasLeftNeighbour.has(start)) continue; // middle/end of a word
    const run: OCRTile[] = [start];
    let cur = start;
    for (;;) { const next = rightOf(cur); if (!next) break; run.push(next); cur = next; }
    if (run.length >= 2)
      words.push({ word: run.map(t => t.letter).join(''), direction: 'horizontal', tiles: run });
  }

  // ── Vertical chains ───────────────────────────────────────────────────────
  const hasTopNeighbour = new Set<OCRTile>();
  for (const t of tiles) { const b = below(t); if (b) hasTopNeighbour.add(b); }

  for (const start of tiles) {
    if (hasTopNeighbour.has(start)) continue;
    const run: OCRTile[] = [start];
    let cur = start;
    for (;;) { const next = below(cur); if (!next) break; run.push(next); cur = next; }
    if (run.length >= 2)
      words.push({ word: run.map(t => t.letter).join(''), direction: 'vertical', tiles: run });
  }

  console.log('[Words]', words.map(w => `${w.word}(${w.direction[0]})`).join(' '));
  return words;

}

// ── Debug image ───────────────────────────────────────────────────────────────

async function buildDebugImage(
  srcCanvas: any, w: number, h: number,
  detected: TileRect[], tiles: OCRTile[], words: WordResult[]
): Promise<string> {
  // Always use a real HTMLCanvasElement here so fillText works reliably
  const dbg = document.createElement('canvas');
  dbg.width = w; dbg.height = h;
  const ctx = dbg.getContext('2d')!;
  ctx.drawImage(srcCanvas, 0, 0);

  // ── Word overlays (drawn first, behind tile boxes) ─────────────────────────
  // Horizontal words: blue  |  Vertical words: purple
  const PAD = 4;
  for (const word of words) {
    const isH = word.direction === 'horizontal';
    const stroke = isH ? '#1565c0' : '#7b1fa2';
    const fill   = isH ? 'rgba(21,101,192,0.13)' : 'rgba(123,31,162,0.13)';

    // Bounding box of all tiles in this word
    const wx0 = Math.min(...word.tiles.map(t => t.bbox.x0)) - PAD;
    const wy0 = Math.min(...word.tiles.map(t => t.bbox.y0)) - PAD;
    const wx1 = Math.max(...word.tiles.map(t => t.bbox.x1)) + PAD;
    const wy1 = Math.max(...word.tiles.map(t => t.bbox.y1)) + PAD;
    const ww = wx1 - wx0, wh = wy1 - wy0;
    const r = 6; // corner radius

    // Filled rounded rect
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(wx0, wy0, ww, wh, r);
    ctx.fill();

    // Stroked rounded rect
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(wx0, wy0, ww, wh, r);
    ctx.stroke();

    // Word label: positioned above (horizontal) or to the left (vertical)
    const tileH = word.tiles[0].bbox.y1 - word.tiles[0].bbox.y0;
    const fs = Math.max(9, Math.round(tileH * 0.32));
    ctx.font = `bold ${fs}px monospace`;
    ctx.fillStyle = stroke;
    if (isH) {
      ctx.fillText(word.word, wx0 + 2, wy0 - 3);
    } else {
      ctx.save();
      ctx.translate(wx0 - 3, wy1);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(word.word, 2, 0);
      ctx.restore();
    }
  }

  // ── Tile boxes (drawn on top of word overlays) ─────────────────────────────
  for (const rect of detected) {
    const match = tiles.find(t =>
      t.bbox.x0 === rect.x0 && t.bbox.y0 === rect.y0
    );
    const bw = rect.x1 - rect.x0, bh = rect.y1 - rect.y0;
    const color = !match ? '#ff4444'
      : match.confidence >= 80 ? '#00cc44'
      : match.confidence >= 50 ? '#ff9900'
      : '#ff4444';

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x0, rect.y0, bw, bh);

    if (match) {
      const fs = Math.max(10, Math.round(bh * 0.45));
      ctx.font = `bold ${fs}px monospace`;
      ctx.fillStyle = color;
      ctx.fillText(match.letter, rect.x0 + 2, rect.y1 - 3);
    }
  }

  return new Promise((res) =>
    dbg.toBlob((b) => res(URL.createObjectURL(b!)), 'image/jpeg', 0.92)
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export class OCRCancelledError extends Error {
  constructor() { super('OCR cancelled'); this.name = 'OCRCancelledError'; }
}

export async function runOCR(
  image: Blob,
  onProgress?: (identified: number, detected: number) => void,
  signal?: AbortSignal,
): Promise<OCRResult> {
  const checkCancelled = () => { if (signal?.aborted) throw new OCRCancelledError(); };
  console.log('[OCR] start — input blob size:', image.size);

  // 1. Decode + scale image (cap at 1200px to keep processing fast)
  const bitmap = await createImageBitmap(image);
  const MAX = 1200;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const W = Math.round(bitmap.width * scale);
  const H = Math.round(bitmap.height * scale);
  console.log('[OCR] scaled to', W, '×', H);

  const { canvas: srcCanvas, ctx: srcCtx } = makeCanvas(W, H);
  srcCtx.drawImage(bitmap, 0, 0, W, H);
  const imgData = srcCtx.getImageData(0, 0, W, H);

  // 2. Grayscale
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = Math.round(
      0.299 * imgData.data[i * 4] +
      0.587 * imgData.data[i * 4 + 1] +
      0.114 * imgData.data[i * 4 + 2]
    );
  }

  // 3. Find tile bounding boxes via letter-blob detection
  checkCancelled();
  const tileRects = detectTileRects(imgData.data, W, H);
  console.log('[OCR] tile rects detected:', tileRects.length);
  onProgress?.(0, tileRects.length);

  if (tileRects.length === 0) {
    const debugImageUrl = await buildDebugImage(srcCanvas, W, H, [], [], []);
    return { tiles: [], words: [], debugImageUrl };
  }

  // ── Tesseract: one worker, PSM 10 (single character), LSTM only ──────────────
  checkCancelled();
  const tesseractModule: any = await import('tesseract.js');
  const createWorker: any =
    tesseractModule.createWorker ?? tesseractModule.default?.createWorker;
  if (typeof createWorker !== 'function')
    throw new Error('tesseract.js: createWorker not found');

  const maybePromise = createWorker('eng');
  const worker: any = maybePromise?.then ? await maybePromise : maybePromise;

  const tiles: OCRTile[] = [];

  try {
    if (typeof worker.load === 'function') await worker.load();
    if (typeof worker.loadLanguage === 'function') await worker.loadLanguage('eng');
    if (typeof worker.initialize === 'function') await worker.initialize('eng');

    if (typeof worker.setParameters === 'function') {
      await worker.setParameters({
        // l, 1, | → remapped to 'I' (no-serif vertical bar on Bananagram tiles).
        // 0       → remapped to 'O' (perfect circle confused with digit zero).
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZl1|0',
        tessedit_pageseg_mode: '10',   // single character
        tessedit_ocr_engine_mode: '1', // LSTM only
      });
    }

    // Map visually-ambiguous Tesseract outputs back to the correct Bananagram letter.
    const REMAP: Record<string, string> = { l: 'I', '1': 'I', '|': 'I', '0': 'O' };
    const toLetter = (ch: string) => REMAP[ch] ?? ch.toUpperCase();

    const parseLetter = (result: any): { letter: string; confidence: number } => {
      const pageConfidence: number = result.data?.confidence ?? 0;
      const symbols: any[] = result.data?.symbols ?? [];
      const validSymbols = symbols.filter((s: any) => /^[A-Za-z1|0]$/.test(s.text));

      if (validSymbols.length > 0) {
        const best = validSymbols.reduce((a: any, b: any) =>
          b.confidence > a.confidence ? b : a,
        );
        return {
          letter: toLetter(best.text),
          confidence: Math.round(best.confidence > 0 ? best.confidence : pageConfidence),
        };
      }

      const raw = (result.data?.text ?? '').trim().replace(/[^A-Za-z1|0]/g, '');
      if (raw.length > 0) {
        return {
          letter: toLetter(raw[0]),
          confidence: Math.round(
            pageConfidence > 0 ? pageConfidence : (result.data?.words?.[0]?.confidence ?? 0),
          ),
        };
      }

      return { letter: '', confidence: 0 };
    };

    for (let i = 0; i < tileRects.length; i++) {
      checkCancelled();
      const rect = tileRects[i];

      // A crop whose inner region is >75% dark is a corrupted/all-black image.
      // Thick letters like R, P, B, M genuinely fill 60-70% of the inner region
      // after dilation — so 0.75 gives them room while still blocking truly black
      // images (which sit at ~0.90+) that Tesseract misreads as 'H' or 'M'.
      const DARK_RATIO_MAX = 0.75;
      const isBetterCrop = (
        candidate: { parsed: ReturnType<typeof parseLetter>; crop: Awaited<ReturnType<typeof cropTile>> },
        current:   { parsed: ReturnType<typeof parseLetter>; crop: Awaited<ReturnType<typeof cropTile>> },
      ) =>
        candidate.crop.darkRatio <= DARK_RATIO_MAX &&
        candidate.parsed.confidence > current.parsed.confidence;

      // First attempt with adaptive Otsu
      let crop = await cropTile(srcCanvas, rect);
      let parsed = parseLetter(await worker.recognize(crop.blob));

      // Phase 1: walk the threshold in alternating lower/higher steps, keeping
      // the best result. Stop early if confidence >= 50%.
      if (parsed.confidence < 50) {
        const STEP = 15;
        const MIN_THRESH = 60;
        const MAX_THRESH = 245;
        let lo = crop.thresh - STEP;
        let hi = crop.thresh + STEP;
        let best = { parsed, crop };

        while (best.parsed.confidence < 50 && (lo >= MIN_THRESH || hi <= MAX_THRESH)) {
          for (const t of [lo, hi]) {
            if (t < MIN_THRESH || t > MAX_THRESH) continue;
            const retryCrop = await cropTile(srcCanvas, rect, t);
            const retryParsed = parseLetter(await worker.recognize(retryCrop.blob));
            if (isBetterCrop({ parsed: retryParsed, crop: retryCrop }, best)) {
              best = { parsed: retryParsed, crop: retryCrop };
            }
            if (best.parsed.confidence >= 50) break;
          }
          lo -= STEP;
          hi += STEP;
        }

        parsed = best.parsed;
        crop = best.crop;
      }

      // Phase 2: if still below 50% (or mask is mostly black), fall back to
      // percentile thresholding — marks exactly the darkest N% of raw pixels
      // as dark, sidestepping Otsu failures caused by shadow-heavy crops.
      if (parsed.confidence < 50 || crop.darkRatio > 0.45) {
        let best = { parsed, crop };

        for (const p of [8, 12, 16, 20, 25, 6, 30]) {
          const pCrop = await cropTile(srcCanvas, rect, undefined, p);
          const pParsed = parseLetter(await worker.recognize(pCrop.blob));
          if (isBetterCrop({ parsed: pParsed, crop: pCrop }, best)) {
            best = { parsed: pParsed, crop: pCrop };
            console.log(`[OCR] tile ${i + 1}: percentile ${p}% → ${pParsed.letter} (${pParsed.confidence}%)`);
          }
          if (best.parsed.confidence >= 50) break;
        }

        parsed = best.parsed;
        crop = best.crop;
      }

      // Phase 3: if still below 70%, retry with progressively larger insets
      // (strips more border) and also try morphological closing (dilate+erode)
      // which prevents dilation from sealing loops on thick letters like P/B/R.
      if (parsed.confidence < 70) {
        let best = { parsed, crop };
        outer: for (const inset of [0.20, 0.25, 0.30]) {
          for (const erode of [false, true]) {
            const iCrop = await cropTile(srcCanvas, rect, undefined, undefined, inset, erode);
            const iParsed = parseLetter(await worker.recognize(iCrop.blob));
            if (isBetterCrop({ parsed: iParsed, crop: iCrop }, best)) {
              best = { parsed: iParsed, crop: iCrop };
              console.log(`[OCR] tile ${i + 1}: inset ${inset} erode=${erode} → ${iParsed.letter} (${iParsed.confidence}%)`);
            }
            if (best.parsed.confidence >= 70) break outer;
          }
        }
        parsed = best.parsed;
        crop = best.crop;
      }

      // Phase 4: if still 0% confidence, try PSM 8 (single word) without
      // whitelist — sometimes PSM 10 rejects complex multi-stroke letters
      // (R, P, B) entirely and PSM 8 gives Tesseract more flexibility.
      if (parsed.confidence === 0) {
        try {
          if (typeof worker.setParameters === 'function') {
            await worker.setParameters({
              tessedit_char_whitelist: '',
              tessedit_pageseg_mode: '8',
              tessedit_ocr_engine_mode: '1',
            });
          }
          const p4Crop = await cropTile(srcCanvas, rect);
          const p4Raw = await worker.recognize(p4Crop.blob);
          const p4Parsed = parseLetter(p4Raw);

          // Log the full raw Tesseract output so we can see exactly what it found
          console.log(`[OCR] tile ${i + 1} PSM8 raw:`,
            `text="${(p4Raw.data?.text ?? '').trim()}"`,
            `pageConf=${p4Raw.data?.confidence}`,
            `symbols=`, (p4Raw.data?.symbols ?? []).map((s: any) => `"${s.text}"@${s.confidence}%`),
            `darkRatio=${p4Crop.darkRatio.toFixed(2)}`,
            `thresh=${p4Crop.thresh}`,
          );

          if (p4Parsed.confidence > parsed.confidence) {
            parsed = p4Parsed;
            crop = p4Crop;
            console.log(`[OCR] tile ${i + 1}: PSM8 rescued → ${parsed.letter} (${parsed.confidence}%)`);
          }

          // Restore original parameters
          if (typeof worker.setParameters === 'function') {
            await worker.setParameters({
              tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZl1|0',
              tessedit_pageseg_mode: '10',
              tessedit_ocr_engine_mode: '1',
            });
          }
        } catch (e) {
          console.warn(`[OCR] tile ${i + 1}: PSM8 attempt failed`, e);
        }
      }

      if (parsed.confidence === 0) {
        // Log everything we know about this tile to help diagnose
        const rawResult = await worker.recognize(crop.blob);
        console.warn(`[OCR] tile ${i + 1}: FINAL 0% — full Tesseract dump:`,
          `text="${(rawResult.data?.text ?? '').trim()}"`,
          `pageConf=${rawResult.data?.confidence}`,
          `symbols=`, (rawResult.data?.symbols ?? []).map((s: any) => `"${s.text}"@${s.confidence}%`),
          `words=`, (rawResult.data?.words ?? []).map((w: any) => `"${w.text}"@${w.confidence}%`),
          `darkRatio=${crop.darkRatio.toFixed(2)}`,
          `thresh=${crop.thresh}`,
          `rect=${JSON.stringify(rect)}`,
        );
      } else if (parsed.confidence < 50) {
        console.log(`[OCR] tile ${i + 1}: best → ${parsed.letter || '?'} (${parsed.confidence}%)`);
      }

      // Final sanity check: if the best crop is still a corrupted black image,
      // zero out the result rather than emit a wrong letter with false confidence.
      if (crop.darkRatio > DARK_RATIO_MAX) {
        console.log(`[OCR] tile ${i + 1}: discarded — darkRatio ${crop.darkRatio.toFixed(2)} > ${DARK_RATIO_MAX} (black image)`);
        parsed = { letter: '?', confidence: 0 };
      }

      const debugUrl = URL.createObjectURL(crop.blob);
      tiles.push({
        letter: parsed.letter || '?',
        confidence: parsed.confidence,
        bbox: rect,
        debugUrl,
      });
      console.log(`[OCR] tile ${i + 1}/${tileRects.length}: ${parsed.letter || '?'} (${parsed.confidence}%)`);
      onProgress?.(i + 1, tileRects.length);
    }
  } finally {
    try { await worker.terminate(); } catch {}
  }

  // 5. Detect words from tile positions
  const words = detectWords(tiles);

  // 6. Build annotated debug image
  const debugImageUrl = await buildDebugImage(srcCanvas, W, H, tileRects, tiles, words);

  console.log(`[OCR] done — ${tiles.length} letters, ${words.length} words`);
  return { tiles, words, debugImageUrl };
}
