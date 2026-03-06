
export type OCRTile = {
  letter: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Object URL of the processed 128×128 image fed to the matcher — caller must revoke. */
  debugUrl: string;
  /** Data URL of the template the tile was matched against — no cleanup needed. */
  matchedTemplateUrl: string;
  /** Top 5 template matches so near-misses are visible in the UI. */
  topMatches: { letter: string; confidence: number }[];
};

export type OCRResult = {
  tiles: OCRTile[];
  /** Object URL of annotated debug image — caller must revoke. */
  debugImageUrl: string;
  /** How many templates were loaded. 0 means Tesseract fallback was used. */
  templateCount: number;
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

function detectTileRects(gray: Uint8Array, w: number, h: number): TileRect[] {
  const thresh = otsu(gray);
  console.log('[TileDetect] Otsu threshold:', thresh);

  // Mark dark pixels (letter strokes are the darkest thing on a tile)
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) dark[i] = gray[i] < thresh ? 255 : 0;

  const blobs = connectedComponents(dark, w, h);
  console.log('[TileDetect] Raw dark blobs:', blobs.length);

  // Filter to letter-sized blobs:
  //   - height between 1/60 and 1/6 of image width  (covers a huge range of zoom levels)
  //   - width at least 15% of height  (excludes single-pixel vertical lines)
  //   - width at most 2.5× height     (excludes wide horizontal smears)
  //   - fill factor > 5%              (excludes very sparse noise)
  //   - area < 8% of image            (excludes large background blobs)
  const minH = Math.max(4, w / 60);
  const maxH = w / 6;
  const maxArea = w * h * 0.08;

  const letterBlobs = blobs.filter(b => {
    const bh = b.y1 - b.y0 + 1, bw = b.x1 - b.x0 + 1;
    if (bh < minH || bh > maxH) return false;
    if (bw < bh * 0.15 || bw > bh * 2.5) return false;
    if (b.area < bw * bh * 0.05) return false;
    if (b.area > maxArea) return false;
    return true;
  });

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

  // Expand each letter blob centre → tile boundary, then verify the surrounding
  // region is mostly cream/white. Shadows and inter-tile gaps are mid-gray or
  // darker and will fail this check.
  const expanded: TileRect[] = [];
  for (const b of coreBlobs) {
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const rect: TileRect = {
      x0: Math.max(0, Math.round(cx - half)),
      y0: Math.max(0, Math.round(cy - half)),
      x1: Math.min(w - 1, Math.round(cx + half)),
      y1: Math.min(h - 1, Math.round(cy + half)),
    };

    // Sample the background brightness: count pixels lighter than 160
    // (cream tile background is typically 180-255; shadows are below 150).
    // We exclude the inner letter region so the dark strokes don't skew the count.
    const innerMargin = Math.round(tileSize * 0.15);
    let lightPixels = 0, totalPixels = 0;
    for (let py = rect.y0; py <= rect.y1; py++) {
      for (let px = rect.x0; px <= rect.x1; px++) {
        // Skip the very centre where the letter lives
        if (
          px >= rect.x0 + innerMargin && px <= rect.x1 - innerMargin &&
          py >= rect.y0 + innerMargin && py <= rect.y1 - innerMargin
        ) continue;
        totalPixels++;
        if (gray[py * w + px] > 160) lightPixels++;
      }
    }
    // Require at least 55% of the border region to be light
    if (totalPixels > 0 && lightPixels / totalPixels >= 0.55) {
      expanded.push(rect);
    }
  }

  // NMS: remove duplicate boxes caused by multi-blob letters (e.g. 'i' dot + stroke)
  const deduped = nms(expanded);
  console.log('[TileDetect] Tiles after NMS:', deduped.length);

  // Isolation filter: every real tile should have at least one neighbour within
  // 2.5× the tile size (tiles are adjacent on the board). Blobs further away
  // than that are false positives — shadows, table edges, background marks, etc.
  if (deduped.length > 1) {
    const centers = deduped.map(t => ({ x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2 }));
    const maxDist = tileSize * 2.5;
    const filtered = deduped.filter((_, i) => {
      const c = centers[i];
      return centers.some((n, j) => {
        if (j === i) return false;
        const dx = c.x - n.x, dy = c.y - n.y;
        return Math.sqrt(dx * dx + dy * dy) <= maxDist;
      });
    });
    console.log('[TileDetect] Tiles after isolation filter:', filtered.length);
    return filtered;
  }

  return deduped;
}

// ── Morphological dilation ────────────────────────────────────────────────────
// Expands each dark pixel by 1px using a plus-shaped structuring element.
// Thickens thin strokes (especially 'I') so Tesseract's LSTM can read them
// without distorting broader letter shapes.

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
): Promise<{ blob: Blob; pixels: Uint8Array; thresh: number; darkRatio: number }> {
  const SIZE = 128;
  const PAD = 18;

  const fullW = Math.max(1, rect.x1 - rect.x0);
  const fullH = Math.max(1, rect.y1 - rect.y0);

  // Inset by 15% per side to strip the dark tile border before thresholding.
  const insetX = Math.round(fullW * 0.15);
  const insetY = Math.round(fullH * 0.15);
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
      if (darkCount / (SIZE * SIZE) <= 0.30) break;
      thresh = Math.min(245, thresh + 15);
    }
  }

  // Initial dark mask
  const dark = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    dark[i] = tileGray[i] < thresh ? 255 : 0;
  }

  // Keep only the largest connected dark region (the letter), then dilate by
  // 1px to thicken thin strokes (helps 'I' especially) before Tesseract reads it.
  const letterMask = dilateMask(largestDarkComponent(dark, SIZE, SIZE), SIZE);

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

// ── Debug image ───────────────────────────────────────────────────────────────

async function buildDebugImage(
  srcCanvas: any, w: number, h: number,
  detected: TileRect[], tiles: OCRTile[]
): Promise<string> {
  // Always use a real HTMLCanvasElement here so fillText works reliably
  const dbg = document.createElement('canvas');
  dbg.width = w; dbg.height = h;
  const ctx = dbg.getContext('2d')!;
  ctx.drawImage(srcCanvas, 0, 0);

  // Draw every detected rect, coloured by whether a letter was found
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

export async function runOCR(image: Blob): Promise<OCRResult> {
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
  const tileRects = detectTileRects(gray, W, H);
  console.log('[OCR] tile rects detected:', tileRects.length);

  if (tileRects.length === 0) {
    const debugImageUrl = await buildDebugImage(srcCanvas, W, H, [], []);
    return { tiles: [], debugImageUrl, templateCount: 0 };
  }

  // ── Tesseract: one worker, PSM 10 (single character), LSTM only ──────────────
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
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        tessedit_pageseg_mode: '10',   // single character
        tessedit_ocr_engine_mode: '1', // LSTM only
      });
    }

    const parseLetter = (result: any): { letter: string; confidence: number } => {
      const pageConfidence: number = result.data?.confidence ?? 0;
      const symbols: any[] = result.data?.symbols ?? [];
      const validSymbols = symbols.filter((s: any) => /^[A-Z]$/.test(s.text));

      if (validSymbols.length > 0) {
        const best = validSymbols.reduce((a: any, b: any) =>
          b.confidence > a.confidence ? b : a,
        );
        return {
          letter: best.text,
          confidence: Math.round(best.confidence > 0 ? best.confidence : pageConfidence),
        };
      }

      const raw = (result.data?.text ?? '').trim().replace(/[^A-Za-z]/g, '').toUpperCase();
      if (raw.length > 0) {
        return {
          letter: raw[0],
          confidence: Math.round(
            pageConfidence > 0 ? pageConfidence : (result.data?.words?.[0]?.confidence ?? 0),
          ),
        };
      }

      return { letter: '', confidence: 0 };
    };

    for (let i = 0; i < tileRects.length; i++) {
      const rect = tileRects[i];

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
            if (retryParsed.confidence > best.parsed.confidence) {
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
          if (pParsed.confidence > best.parsed.confidence) {
            best = { parsed: pParsed, crop: pCrop };
            console.log(`[OCR] tile ${i + 1}: percentile ${p}% → ${pParsed.letter} (${pParsed.confidence}%)`);
          }
          if (best.parsed.confidence >= 50) break;
        }

        parsed = best.parsed;
        crop = best.crop;
      }

      if (parsed.confidence < 50) {
        console.log(`[OCR] tile ${i + 1}: best → ${parsed.letter || '?'} (${parsed.confidence}%)`);
      }

      const debugUrl = URL.createObjectURL(crop.blob);
      tiles.push({
        letter: parsed.letter || '?',
        confidence: parsed.confidence,
        bbox: rect,
        debugUrl,
        matchedTemplateUrl: '',
        topMatches: [],
      });
      console.log(`[OCR] tile ${i + 1}/${tileRects.length}: ${parsed.letter || '?'} (${parsed.confidence}%)`);
    }
  } finally {
    try { await worker.terminate(); } catch {}
  }

  // 5. Build annotated debug image
  const debugImageUrl = await buildDebugImage(srcCanvas, W, H, tileRects, tiles);

  console.log(`[OCR] done — ${tiles.length} letters from ${tileRects.length} detected tiles`);
  return { tiles, debugImageUrl, templateCount: 0 };
}
