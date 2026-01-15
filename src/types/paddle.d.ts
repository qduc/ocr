declare module '@paddlejs-models/ocr' {
  export function init(options?: any): Promise<void>;
  export function recognize(image: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement, options?: any): Promise<{
    text: string[];
    points: number[][][];
  }>;
}

declare module '@paddlejs/paddlejs-core' {
  export const runner: any;
}

declare module '@paddlejs/paddlejs-backend-webgl' {
  export const register: any;
}
