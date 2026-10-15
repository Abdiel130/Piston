import { describe, expect, it } from 'vitest';
import { photoTakenAt, readExifDate, shrinkImage } from './photo-prep';

/**
 * Un JPEG mínimo: SOI, APP1 con EXIF (IFD0 → sub-IFD EXIF → una fecha) y SOS.
 * Basta para el parser; no es una imagen que se pueda pintar.
 */
function jpegWithExif(date: string, little = true, tag = 0x9003): ArrayBuffer {
  const tiff = new DataView(new ArrayBuffer(64));
  const u16 = (at: number, value: number) => tiff.setUint16(at, value, little);
  const u32 = (at: number, value: number) => tiff.setUint32(at, value, little);

  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  u16(2, 0x2a);
  u32(4, 8);
  // IFD0: una entrada, el puntero al sub-IFD de EXIF en 26.
  u16(8, 1);
  u16(10, 0x8769);
  u16(12, 4);
  u32(14, 1);
  u32(18, 26);
  u32(22, 0);
  // Sub-IFD EXIF: la fecha, texto de 20 bytes en 44.
  u16(26, 1);
  u16(28, tag);
  u16(30, 2);
  u32(32, 20);
  u32(36, 44);
  u32(40, 0);
  [...date].forEach((char, i) => tiff.setUint8(44 + i, char.charCodeAt(0)));

  const exif = new TextEncoder().encode('Exif\0\0');
  const app1Length = 2 + exif.length + tiff.byteLength;
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, app1Length >> 8, app1Length & 0xff,
    ...exif,
    ...new Uint8Array(tiff.buffer),
    0xff, 0xda, 0x00, 0x02,
  ]);
  return bytes.buffer;
}

const local = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
  new Date(y, mo - 1, d, h, mi, s).toISOString();

describe('readExifDate', () => {
  it('lee DateTimeOriginal en hora local, en ambos órdenes de bytes', () => {
    expect(readExifDate(jpegWithExif('2024:05:02 10:30:00'))).toBe(local(2024, 5, 2, 10, 30, 0));
    expect(readExifDate(jpegWithExif('2019:12:31 23:59:58', false))).toBe(local(2019, 12, 31, 23, 59, 58));
  });

  it('usa DateTimeDigitized si no hay original', () => {
    expect(readExifDate(jpegWithExif('2023:01:15 08:00:00', true, 0x9004))).toBe(local(2023, 1, 15, 8, 0, 0));
  });

  it('nulo sin EXIF, con fecha vacía o si no es JPEG', () => {
    expect(readExifDate(jpegWithExif('0000:00:00 00:00:00'))).toBeNull();
    expect(readExifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer)).toBeNull();
    expect(readExifDate(new TextEncoder().encode('%PDF-1.7').buffer)).toBeNull();
  });
});

describe('photoTakenAt', () => {
  it('prefiere el EXIF a la fecha del archivo', async () => {
    const file = new File([jpegWithExif('2024:05:02 10:30:00')], 'a.jpg', { type: 'image/jpeg', lastModified: 0 });
    expect(await photoTakenAt(file)).toBe(local(2024, 5, 2, 10, 30, 0));
  });

  it('sin EXIF usa la fecha del archivo', async () => {
    const when = Date.UTC(2022, 6, 1, 12, 0, 0);
    const file = new File(['png'], 'a.png', { type: 'image/png', lastModified: when });
    expect(await photoTakenAt(file)).toBe(new Date(when).toISOString());
  });
});

describe('shrinkImage', () => {
  it('deja intacto lo que no puede pintar', async () => {
    const file = new File(['%PDF'], 'poliza.pdf', { type: 'application/pdf' });
    expect(await shrinkImage(file)).toEqual({ file, width: null, height: null });
  });
});
