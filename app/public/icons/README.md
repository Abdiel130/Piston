# Iconos

Un directorio por recurso, y dentro un PNG por tamaño:

```
icons/
  app/        Icono de la aplicación (manifest, instalación, apple-touch-icon)
    72.png  96.png  128.png  144.png  152.png  192.png  384.png  512.png
```

Cuando haya un segundo recurso (un shortcut con icono propio, un badge de
notificación) va en su propia carpeta —`icons/badge/`, `icons/fuel/`— con la
misma convención de nombre por tamaño.

## Por qué varios PNG y no un SVG

El manifest de una PWA exige mapas de bits con `sizes` declarado: Android,
iOS y Windows eligen el archivo por tamaño en lugar de reescalar. Un SVG
sirve para la interfaz, pero no para el icono instalado.

Los tamaños no son redundantes entre sí: cada uno se dibuja con el trazo
ajustado a su rejilla. Reducir el de 512 a 72 emborrona la aguja del medidor.

Los de 192 y 512 se declaran además como `maskable`: el glifo cabe dentro del
80% central para que Android pueda recortarlo en círculo o squircle sin comerse
el dibujo.

## Regenerarlos

`tools/generate-icons.py` los produce todos desde la misma definición vectorial.
No hay dependencias: escribe el PNG a mano con `zlib` y supersampling 4x.

```bash
python3 tools/generate-icons.py
```
