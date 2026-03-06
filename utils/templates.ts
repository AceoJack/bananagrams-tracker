import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

export const TEMPLATE_SIZE = 128;
/** Size of the normalised letter patch used for matching — smaller = faster, still discriminating. */
const NORM_SIZE = 64;

export type TemplateMap = Map<string, Uint8Array>; // letter → binary pixel array

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const COLLECTION = 'templates';

let cache: TemplateMap | null = null;
let dataUrlCache: Map<string, string> | null = null;

// ── Base64 helpers ────────────────────────────────────────────────────────────

function pixelsToBase64(pixels: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < pixels.length; i++) binary += String.fromCharCode(pixels[i]);
  return btoa(binary);
}

function base64ToPixels(b64: string): Uint8Array {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

// ── Normalisation (mirrors cropTile pipeline in ocr.ts) ──────────────────────

function otsuThreshold(gray: Uint8Array): number {
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
  return Math.max(60, Math.min(200, t));
}

// ── Template photo processing ─────────────────────────────────────────────────

/**
 * Process a reference tile photo into a normalised 128×128 binary pixel array.
 * Automatically crops to the central 80% to strip edge shadows.
 * Returns the pixel array and a preview object URL (caller must revoke when done).
 */
export async function processTemplatePhoto(
  photo: Blob,
): Promise<{ pixels: Uint8Array; previewUrl: string }> {
  const SIZE = TEMPLATE_SIZE;
  const PAD = 18;
  const bitmap = await createImageBitmap(photo);

  // Central 80% crop — strips the shadow band at tile edges
  const cropFactor = 0.80;
  const cropSide = Math.min(bitmap.width, bitmap.height) * cropFactor;
  const sx = (bitmap.width - cropSide) / 2;
  const sy = (bitmap.height - cropSide) / 2;

  const scale = Math.min((SIZE - PAD * 2) / cropSide, (SIZE - PAD * 2) / cropSide);
  const dw = Math.round(cropSide * scale);
  const dh = Math.round(cropSide * scale);
  const dx = Math.round((SIZE - dw) / 2);
  const dy = Math.round((SIZE - dh) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bitmap, sx, sy, cropSide, cropSide, dx, dy, dw, dh);

  // Grayscale + Otsu threshold → clean black-on-white
  const imgData = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = imgData.data;
  const gray = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    gray[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  }
  const thresh = otsuThreshold(gray);

  const pixels = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = gray[i] < thresh ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
    pixels[i] = v;
  }
  ctx.putImageData(imgData, 0, 0);

  const previewUrl = await new Promise<string>((res) =>
    canvas.toBlob((b) => res(URL.createObjectURL(b!)), 'image/png'),
  );

  return { pixels, previewUrl };
}

// ── Firestore storage ─────────────────────────────────────────────────────────

/**
 * Upload a processed template to Firestore.
 * Stores the pixel array as base64 (~22KB per letter, well within Firestore limits).
 */
export async function uploadTemplate(letter: string, pixels: Uint8Array): Promise<void> {
  const db = getFirebaseDb();
  await setDoc(doc(db, COLLECTION, letter.toUpperCase()), {
    pixels: pixelsToBase64(pixels),
    updatedAt: new Date(),
  });
  cache = null; // invalidate so next load picks up the new template
}

/** Returns which letters already have templates saved in Firestore. */
export async function getUploadedLetters(): Promise<Set<string>> {
  try {
    const snapshot = await getDocs(collection(getFirebaseDb(), COLLECTION));
    return new Set(
      snapshot.docs
        .map((d) => d.id.toUpperCase())
        .filter((l) => LETTERS.includes(l)),
    );
  } catch (e: any) {
    console.warn('[Templates] Could not load from Firestore:', e?.code ?? e);
    return new Set();
  }
}

/** Load all templates from Firestore into the in-memory cache. */
export async function loadTemplates(): Promise<TemplateMap> {
  if (cache) return cache;

  const map: TemplateMap = new Map();

  try {
    const snapshot = await getDocs(collection(getFirebaseDb(), COLLECTION));
    for (const docSnap of snapshot.docs) {
      const letter = docSnap.id.toUpperCase();
      const b64 = docSnap.data().pixels as string | undefined;
      if (b64 && LETTERS.includes(letter)) {
        map.set(letter, base64ToPixels(b64));
      }
    }
  } catch (e: any) {
    console.warn('[Templates] loadTemplates failed:', e?.code ?? e);
  }

  cache = map;
  console.log(`[Templates] Loaded ${map.size}/26`);
  return map;
}

export function clearTemplateCache(): void {
  cache = null;
  dataUrlCache = null;
}

/**
 * Convert a stored pixel array back into a PNG data URL for display.
 * Synchronous — uses canvas.toDataURL() so no cleanup needed.
 */
export function templateToDataUrl(pixels: Uint8Array): string {
  const SIZE = TEMPLATE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    imgData.data[i * 4]     = pixels[i];
    imgData.data[i * 4 + 1] = pixels[i];
    imgData.data[i * 4 + 2] = pixels[i];
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Returns data URLs for all loaded templates, cached so they're only
 * generated once per session.
 */
export function getTemplateDataUrls(templates: TemplateMap): Map<string, string> {
  if (dataUrlCache) return dataUrlCache;
  dataUrlCache = new Map();
  for (const [letter, pixels] of templates) {
    dataUrlCache.set(letter, templateToDataUrl(pixels));
  }
  return dataUrlCache;
}

// ── Template matching ─────────────────────────────────────────────────────────

/**
 * Extract the tight bounding box of dark pixels (value < 128), add a small
 * border, then scale the result to NORM_SIZE × NORM_SIZE via nearest-neighbour.
 *
 * This removes all positional and scale variance so that NCC only measures
 * letter shape. Both the board tile crop and the stored template must go
 * through this before being compared.
 */
function normalizeLetter(pixels: Uint8Array, srcSize: number): Uint8Array {
  let x0 = srcSize, y0 = srcSize, x1 = -1, y1 = -1;
  for (let y = 0; y < srcSize; y++) {
    for (let x = 0; x < srcSize; x++) {
      if (pixels[y * srcSize + x] < 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  const out = new Uint8Array(NORM_SIZE * NORM_SIZE).fill(255);
  if (x1 < 0) return out; // no dark pixels — blank image

  // Add a proportional border around the letter
  const border = Math.max(2, Math.round(srcSize * 0.04));
  x0 = Math.max(0, x0 - border);
  y0 = Math.max(0, y0 - border);
  x1 = Math.min(srcSize - 1, x1 + border);
  y1 = Math.min(srcSize - 1, y1 + border);

  const sw = x1 - x0 + 1;
  const sh = y1 - y0 + 1;
  for (let ty = 0; ty < NORM_SIZE; ty++) {
    for (let tx = 0; tx < NORM_SIZE; tx++) {
      const sx = Math.min(srcSize - 1, x0 + Math.floor(tx * sw / NORM_SIZE));
      const sy = Math.min(srcSize - 1, y0 + Math.floor(ty * sh / NORM_SIZE));
      out[ty * NORM_SIZE + tx] = pixels[sy * srcSize + sx];
    }
  }
  return out;
}

/**
 * Normalised cross-correlation between two same-size pixel arrays.
 */
function ncc(a: Uint8Array, b: Uint8Array, size: number): number {
  let sumA = 0, sumB = 0;
  const n = size * size;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let num = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (varA < 1 || varB < 1) return 0;
  return num / Math.sqrt(varA * varB);
}

export type TileMatch = { letter: string; confidence: number };

/**
 * Match a tile's pixel array against all loaded templates.
 * Returns the best match plus the top 5 scores so callers can see near-misses.
 * Returns null if no templates are loaded.
 */
export function matchTile(
  tilePixels: Uint8Array,
  templates: TemplateMap,
): { letter: string; confidence: number; topMatches: TileMatch[] } | null {
  if (templates.size === 0) return null;

  // Normalise the tile to a tight letter crop before comparing.
  // This eliminates positional and scale variance that causes all NCC
  // scores to cluster together when comparing over the full 128×128.
  const normTile = normalizeLetter(tilePixels, TEMPLATE_SIZE);

  const scores: TileMatch[] = [];
  for (const [letter, templatePixels] of templates) {
    const normTemplate = normalizeLetter(templatePixels, TEMPLATE_SIZE);
    const score = ncc(normTile, normTemplate, NORM_SIZE);
    scores.push({ letter, confidence: Math.round(((score + 1) / 2) * 100) });
  }
  scores.sort((a, b) => b.confidence - a.confidence);

  return {
    letter: scores[0].letter,
    confidence: scores[0].confidence,
    topMatches: scores.slice(0, 5),
  };
}
