export type OCRWord = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
};

async function preprocessBlobForOCR(
  blob: Blob,
  maxDim = 2000,
  contrast = 1.4,
  quality = 0.92
): Promise<Blob> {
  // create ImageBitmap from blob for reliable resizing
  const img = await createImageBitmap(blob);

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  // prefer OffscreenCanvas when available
  const canvas: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = (canvas.getContext('2d') as CanvasRenderingContext2D);

  // apply simple filters while drawing
  try {
    ctx.filter = `grayscale(1) contrast(${contrast})`;
  } catch (e) {
    // some environments don't support ctx.filter; fall back to no filter
  }
  ctx.drawImage(img, 0, 0, w, h);

  // Simple global thresholding to increase contrast for OCR (fast, client-side)
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    let sum = 0;
    // compute luminance mean
    for (let i = 0; i < data.length; i += 4) {
      // using standard luma coefficients
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += l;
    }
    const mean = sum / (data.length / 4);

    // threshold a bit below mean to favor dark text on light background
    const threshold = Math.max(80, mean - 10);

    for (let i = 0; i < data.length; i += 4) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = l < threshold ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      // keep alpha as-is
    }
    ctx.putImageData(imgData, 0, 0);
  } catch (e) {
    // getImageData may fail in some OffscreenCanvas contexts; ignore and continue
    console.warn('Preprocessing: getImageData failed, skipping threshold step', e);
  }

  // export to blob (jpeg for smaller size; grayscale makes it compact)
  if (typeof (canvas as OffscreenCanvas).convertToBlob === 'function') {
    return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality });
  }

  return await new Promise<Blob>((res) => {
    (canvas as HTMLCanvasElement).toBlob((b) => res(b as Blob), 'image/jpeg', quality);
  });
}

export async function runOCRFromBlob(image: Blob) {
  // quick debug info
  console.log('OCR input blob:', { type: image.type, size: image.size });

  // preprocess image to improve OCR accuracy
  const preprocessed = await preprocessBlobForOCR(image);
  console.log('OCR preprocessed blob size:', preprocessed.size);

  // Open a preview of the preprocessed image in a new tab so the developer can inspect what OCR sees.
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    try {
      const previewUrl = URL.createObjectURL(preprocessed);
      window.open(previewUrl);
      // Revoke after a little while to allow inspection but avoid leaking memory/URLs.
      setTimeout(() => URL.revokeObjectURL(previewUrl), 30_000);
    } catch (e) {
      console.warn('Could not open preprocessed image preview', e);
    }
  }

  // dynamically import tesseract and create a worker (robust to differing exports/versions)
  const tesseractModule: any = await import('tesseract.js');
  const createWorkerAny: any =
    tesseractModule.createWorker ?? tesseractModule.default?.createWorker ?? tesseractModule;

  if (typeof createWorkerAny !== 'function') {
    throw new Error('tesseract.js: createWorker not found');
  }

  // createWorker may return a worker or a promise of a worker depending on version; handle both
  // Do NOT pass functions (like a logger) into createWorker options — they are cloned to the Worker
  // and functions cannot be serialized. Create worker without logger to avoid DataCloneError.
  const maybeWorker = createWorkerAny();
  const worker: any = maybeWorker && typeof maybeWorker.then === 'function' ? await maybeWorker : maybeWorker;

  try {
    // Some tesseract.js builds expose a worker with load/loadLanguage/initialize; others may not.
    // Detect available methods and only call what exists. If the worker doesn't provide recognize,
    // fall back to the high-level `recognize` API from the module.
    const has = {
      load: typeof worker.load === 'function',
      loadLanguage: typeof worker.loadLanguage === 'function',
      initialize: typeof worker.initialize === 'function',
      setParameters: typeof worker.setParameters === 'function',
      recognize: typeof worker.recognize === 'function',
    };

    if (has.load) await worker.load();
    if (has.loadLanguage) await worker.loadLanguage('eng');
    if (has.initialize) await worker.initialize('eng');

    if (has.setParameters) {
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        user_defined_dpi: '300',
        tessedit_pageseg_mode: '6',
      });
    }

    let result: any;
    if (has.recognize) {
      // preferred: worker.recognize
      result = await worker.recognize(preprocessed);
    } else {
      // fallback: use top-level Tesseract.recognize which accepts an URL or blob
      console.warn('worker.recognize not available, falling back to Tesseract.recognize');
      const TesseractAny: any = tesseractModule.default ?? tesseractModule;
      const url = URL.createObjectURL(preprocessed);
      try {
        if (typeof TesseractAny.recognize === 'function') {
          result = await TesseractAny.recognize(url, 'eng', {
            // pass minimal options; avoid functions here
            // logger: (m: any) => console.log('tesseract', m),
          });
        } else {
          throw new Error('Tesseract.recognize not available in imported module');
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    const rawText = result.data?.text ?? '';

    const rawWords = (((result.data as any)?.words ?? []) as any[]).filter((w) => w?.text && w?.bbox);

    console.log('tesseract result summary:', {
      textLength: rawText.length,
      wordCount: rawWords.length,
      confidences: rawWords.slice(0, 10).map((w) => w.confidence),
    });

    const words: OCRWord[] = rawWords.map((w) => ({
      text: String(w.text ?? '').trim(),
      bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
      confidence: Number(w.confidence ?? 0),
    }));

    return { rawText, words };
  } finally {
    try {
      await worker.terminate();
    } catch (e) {
      console.warn('Failed to terminate tesseract worker', e);
    }
  }
}