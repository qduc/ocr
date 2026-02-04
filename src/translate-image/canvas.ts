export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

export const createCanvas = (width: number, height: number): CanvasLike => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('Canvas creation is not available.');
};

export const getContext2d = (canvas: CanvasLike): CanvasRenderingContext2D => {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is not available.');
  }
  return context;
};
