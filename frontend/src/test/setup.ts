import '@testing-library/jest-dom';

// Mock pdfjs-dist globally
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 5,
      getPage: vi.fn((num: number) =>
        Promise.resolve({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 800 * scale,
            height: 600 * scale,
          }),
          render: ({ canvasContext, viewport }: { canvasContext: unknown; viewport: unknown }) => ({
            promise: Promise.resolve(),
            cancel: vi.fn(),
          }),
        })
      ),
    }),
  })),
}));

// Mock the pdf.worker import
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'mock-worker-url',
}));

// Ensure crypto.randomUUID is available
let uuidCounter = 0;
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...globalThis.crypto,
      randomUUID: () => `test-uuid-${++uuidCounter}`,
    },
    writable: true,
  });
}

// Mock canvas context for PDF rendering tests
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  putImageData: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0) })),
  scale: vi.fn(),
  translate: vi.fn(),
  transform: vi.fn(),
  setTransform: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  canvas: { width: 800, height: 600 },
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// Mock toDataURL for thumbnails
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,mockImageData');

// Mock SVG methods not available in jsdom
if (typeof SVGElement !== 'undefined') {
  SVGElement.prototype.setPointerCapture = vi.fn();
  SVGElement.prototype.releasePointerCapture = vi.fn();
  // getBoundingClientRect default for SVG elements
  const origGetBCR = Element.prototype.getBoundingClientRect;
  SVGElement.prototype.getBoundingClientRect = function () {
    const result = origGetBCR.call(this);
    // jsdom returns all zeros; provide sensible defaults for SVGs
    if (result.width === 0 && result.height === 0) {
      return { x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, toJSON: () => ({}) } as DOMRect;
    }
    return result;
  };
}
