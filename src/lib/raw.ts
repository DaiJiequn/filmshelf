import { tiffToJpeg } from './image';

/** 相机 RAW / 哈苏 3FR、FFF 等：用 LibRaw（WebAssembly）解码，输出为 sRGB 的高质量 JPEG */
export const RAW_EXT = /\.(3fr|fff|arw|cr2|cr3|crw|dng|nef|nrw|orf|pef|raf|rw2|rwl|srw|iiq|erf|mrw|kdc|dcr|raw|x3f)$/i;
export const isRawFile = (f: File) => RAW_EXT.test(f.name);

async function decodeWithLibRaw(file: File): Promise<Blob> {
  const LibRaw = (await import('libraw-wasm')).default;
  const raw = new LibRaw();
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    await raw.open(buf, {
      useCameraWb: true, // 负片翻拍时各通道最终会被逐通道拉伸，这里只需要一个稳定的起点
      outputColor: 1, // sRGB
      outputBps: 8,
      noAutoBright: true, // 不要自动提亮，保留原始影调，交给底片处理
      userQual: 3,
    });
    const img = await raw.imageData();
    if (!img) throw new Error('解码失败');
    const { width, height, colors, data } = img as { width: number; height: number; colors: number; data: Uint8Array | Uint8ClampedArray };
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < width * height; i++, j += colors) {
      rgba[i * 4] = data[j]; rgba[i * 4 + 1] = data[j + (colors > 1 ? 1 : 0)]; rgba[i * 4 + 2] = data[j + (colors > 2 ? 2 : 0)]; rgba[i * 4 + 3] = 255;
    }
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('导出失败'))), 'image/jpeg', 0.95));
  } finally {
    raw.dispose?.();
  }
}

export async function rawToJpeg(file: File): Promise<Blob> {
  try {
    return await decodeWithLibRaw(file);
  } catch (e) {
    // 哈苏 Flextight 扫描仪的 .fff 本质是 TIFF 结构，LibRaw 读不了时再按 TIFF 试一次
    if (/\.(fff|3fr)$/i.test(file.name)) {
      try { return await tiffToJpeg(file); } catch { /* fall through */ }
    }
    throw e;
  }
}
