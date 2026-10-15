import type { IsoDateTime } from '../models';

/** Una foto lista para guardarse: ya reducida, con medidas y fecha. */
export interface PreparedPhoto {
  readonly file: File;
  readonly width: number | null;
  readonly height: number | null;
  readonly takenAt: IsoDateTime | null;
}

/** Lado largo máximo al reducir. Se ve nítida a pantalla completa en un teléfono. */
export const PHOTO_MAX_SIDE = 2560;
export const PHOTO_QUALITY = 0.85;

/** El EXIF vive en los primeros KB del JPEG; no hace falta leer la foto entera. */
const EXIF_SCAN_BYTES = 128 * 1024;

/**
 * Prepara una foto de la galería: lee la fecha ANTES de reducirla (al
 * reencodar con canvas el EXIF se pierde) y luego la reduce.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const takenAt = await photoTakenAt(file);
  const shrunk = await shrinkImage(file);
  return { ...shrunk, takenAt };
}

/**
 * Cuándo se tomó: `DateTimeOriginal` del EXIF; si no hay, la fecha del
 * archivo (en Android suele ser la de captura). Nulo si tampoco hay esa.
 */
export async function photoTakenAt(file: File): Promise<IsoDateTime | null> {
  try {
    const exif = readExifDate(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
    if (exif) return exif;
  } catch {
    // Un EXIF roto no impide guardar la foto.
  }
  return file.lastModified > 0 ? new Date(file.lastModified).toISOString() : null;
}

/**
 * Reduce la foto a `maxSide` px de lado largo en JPEG. Si no es una imagen
 * que el navegador sepa pintar, o reducirla no ahorra nada, se queda la
 * original. `createImageBitmap` ya aplica la orientación del EXIF.
 */
export async function shrinkImage(
  file: File,
  maxSide = PHOTO_MAX_SIDE,
  quality = PHOTO_QUALITY,
): Promise<Omit<PreparedPhoto, 'takenAt'>> {
  const original = { file, width: null, height: null };
  if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.type) || typeof createImageBitmap !== 'function') {
    return original;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return original;
  }

  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const blob = await drawJpeg(bitmap, width, height, quality);
    if (!blob || (scale === 1 && blob.size >= file.size)) {
      return { file, width: bitmap.width, height: bitmap.height };
    }
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return { file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }), width, height };
  } catch {
    return original;
  } finally {
    bitmap.close();
  }
}

async function drawJpeg(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME = 0x0132;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;

/**
 * Fecha de captura de un JPEG, leída del EXIF. Mínimo a propósito: solo
 * recorre los segmentos hasta APP1, el IFD0 y el sub-IFD de EXIF.
 *
 * El EXIF guarda "AAAA:MM:DD HH:MM:SS" en hora local de la cámara, sin zona:
 * se interpreta en la zona del dispositivo, que casi siempre es la misma.
 */
export function readExifDate(buffer: ArrayBuffer): IsoDateTime | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00) return null;
    const length = view.getUint16(offset + 2);
    if (marker === 0xffe1 && ascii(view, offset + 4, 6) === 'Exif\0\0') {
      return readTiffDate(view, offset + 10);
    }
    if (marker === 0xffda) return null; // Empezó la imagen: ya no hay metadatos.
    offset += 2 + length;
  }
  return null;
}

function readTiffDate(view: DataView, tiff: number): IsoDateTime | null {
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const ifd0 = tiff + view.getUint32(tiff + 4, little);

  const main = readIfd(view, tiff, ifd0, little);
  const exifPointer = main.get(TAG_EXIF_IFD);
  const exif = exifPointer ? readIfd(view, tiff, tiff + exifPointer.value, little) : new Map<number, IfdEntry>();

  for (const [entries, tag] of [
    [exif, TAG_DATE_TIME_ORIGINAL],
    [exif, TAG_DATE_TIME_DIGITIZED],
    [main, TAG_DATE_TIME],
  ] as const) {
    const entry = entries.get(tag);
    if (entry) {
      const date = parseExifDate(ascii(view, tiff + entry.value, 19));
      if (date) return date;
    }
  }
  return null;
}

interface IfdEntry {
  /** El valor si cabe en 4 bytes; si no, el desplazamiento desde el inicio del TIFF. */
  readonly value: number;
}

function readIfd(view: DataView, tiff: number, at: number, little: boolean): Map<number, IfdEntry> {
  const entries = new Map<number, IfdEntry>();
  if (at + 2 > view.byteLength) return entries;
  const count = view.getUint16(at, little);
  for (let i = 0; i < count; i++) {
    const entry = at + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    entries.set(view.getUint16(entry, little), { value: view.getUint32(entry + 8, little) });
  }
  return entries;
}

function ascii(view: DataView, at: number, length: number): string {
  if (at < 0 || at + length > view.byteLength) return '';
  let text = '';
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(at + i));
  return text;
}

function parseExifDate(text: string): IsoDateTime | null {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  if (!y || !mo || !d) return null; // "0000:00:00 00:00:00" = sin fecha.
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
