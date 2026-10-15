// Type declarations for the parts of tesseract.js (v7) and its WebAssembly core that the OCR worker uses.

declare module 'tesseract.js/src/constants/PSM' {
  const PSM: Record<'OSD_ONLY' | 'AUTO_OSD' | 'AUTO_ONLY' | 'AUTO' | 'SINGLE_COLUMN' | 'SINGLE_BLOCK_VERT_TEXT' | 'SINGLE_BLOCK' | 'SINGLE_LINE' | 'SINGLE_WORD' | 'CIRCLE_WORD' | 'SINGLE_CHAR' | 'SPARSE_TEXT' | 'SPARSE_TEXT_OSD' | 'RAW_LINE', string>;
  export = PSM;
}

declare module 'tesseract.js/src/constants/OEM' {
  const OEM: Record<'TESSERACT_ONLY' | 'LSTM_ONLY' | 'TESSERACT_LSTM_COMBINED' | 'DEFAULT', number>;
  export = OEM;
}

declare module 'tesseract.js-core/tesseract-core-simd-lstm.js' {
  const factory: (module: Record<string, unknown>) => Promise<unknown>;
  export = factory;
}

declare module 'tesseract.js-core/tesseract-core-lstm.js' {
  const factory: (module: Record<string, unknown>) => Promise<unknown>;
  export = factory;
}

declare module 'bmp-js' {
  export function decode(buf: Buffer): { width: number; height: number; data: Buffer };
  export function encode(img: { width: number; height: number; data: Buffer }): { data: Buffer };
}
