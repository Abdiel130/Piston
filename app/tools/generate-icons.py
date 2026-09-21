#!/usr/bin/env python3
"""
Genera el icono de la aplicación en todos los tamaños que declara el manifest.

Fuente única del dibujo: la función shade(), que define el medidor con la aguja
en el naranja de ignición. Sin dependencias externas: escribe el PNG a mano con
zlib para no atar la generación de un asset a Pillow o ImageMagick.

    python3 tools/generate-icons.py

Los colores salen de src/styles.scss. Si cambia la paleta, cámbialos aquí.
"""
import math, struct, zlib
from pathlib import Path

# La salida es relativa a la raíz de `app/`, no al directorio de trabajo.
OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons' / 'app'
SIZES = (72, 96, 128, 144, 152, 192, 384, 512)


BG   = (14, 14, 16)        # --pst-surface-1
RING = (58, 58, 60)        # --pst-surface-4
ORNG = (255, 107, 44)      # --pst-ignition
WHITE= (255, 255, 255)

SS = 4  # supersampling

def shade(x, y, s):
    """Devuelve (r,g,b) para un punto en el lienzo de lado s. Coordenadas 0..1."""
    cx = cy = 0.5
    dx, dy = x - cx, y - cy
    r = math.hypot(dx, dy)

    # Zona segura de un icono maskable: el glifo vive dentro del 40% central.
    R_OUT, R_IN = 0.335, 0.265
    ang = math.degrees(math.atan2(-dy, dx))  # 0 = derecha, sentido antihorario

    # Arco del medidor: hueco de 90° abajo (de -45° a -135°).
    in_ring = R_IN <= r <= R_OUT
    in_gap = -135.0 <= ang <= -45.0

    if in_ring and not in_gap:
        # El arco se enciende de naranja en el tramo "lleno" (de 225° a 90°).
        a = ang if ang >= 0 else ang + 360.0     # 0..360
        filled = a >= 90.0                        # izquierda y arriba
        return ORNG if filled else RING

    # Aguja: apunta a las 2 en punto (45°), desde el centro.
    na = math.radians(52.0)
    nx, ny = math.cos(na), -math.sin(na)
    t = dx * nx + dy * ny                # proyección sobre la aguja
    perp = abs(dx * -ny + dy * nx)       # distancia perpendicular
    if 0.0 <= t <= 0.30 and perp <= 0.030 * (1.0 - t * 1.6):
        return ORNG

    # Cubo central.
    if r <= 0.075:
        return WHITE
    if r <= 0.095:
        return ORNG

    return BG

def render(size):
    px = bytearray()
    for py in range(size):
        px.append(0)  # filtro None por scanline
        for pxi in range(size):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = (pxi + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    c = shade(x, y, size)
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            n = SS * SS
            px += bytes((acc[0] // n, acc[1] // n, acc[2] // n, 255))
    return bytes(px)

def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

def png(size, path):
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    out = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(render(size), 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as fh:
        fh.write(out)
    return len(out)

OUT.mkdir(parents=True, exist_ok=True)
for size in SIZES:
    written = png(size, OUT / f'{size}.png')
    print(f'{size}.png  {written} bytes')
