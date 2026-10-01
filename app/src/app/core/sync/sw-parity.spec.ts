import { describe, expect, it } from 'vitest';
import { TABLE_ORDER } from '../models';
import { DAILY_TAG, OUTBOX_TAG, serviceWorkerUrl } from './background-sync';
import { TABLE_LABEL } from './describe';

/**
 * El service worker (`public/piston-sw-sync.js`) es JavaScript suelto que no
 * pasa por el build, así que copia a mano el orden de las tablas, sus nombres
 * y los tags de Background Sync. Esta prueba falla si alguna copia se
 * desalinea de la de la app.
 */

// Vitest corre en Node; sin depender de @types/node.
declare const process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string } };

const WORKER = process.getBuiltinModule('node:fs').readFileSync('public/piston-sw-sync.js', 'utf8');

/** El valor literal de `const <name> = ...;` en el worker. */
function workerConst(name: string): unknown {
  const match = new RegExp(`const ${name} = ([\\s\\S]*?);\\n`).exec(WORKER);
  if (!match) throw new Error(`El worker ya no declara ${name}.`);
  return new Function(`return (${match[1]});`)();
}

describe('service worker y app comparten las mismas listas', () => {
  it('mismo orden de tablas', () => {
    expect(workerConst('ORDER')).toEqual([...TABLE_ORDER]);
  });

  it('mismos nombres de tabla para el historial', () => {
    expect(workerConst('LABEL')).toEqual({ ...TABLE_LABEL });
  });

  it('mismos tags de Background Sync', () => {
    expect(workerConst('OUTBOX_TAG')).toBe(OUTBOX_TAG);
    expect(workerConst('DAILY_TAG')).toBe(DAILY_TAG);
  });

  it('el worker usa la base de la API que le pasa la app', () => {
    expect(serviceWorkerUrl('')).toBe('piston-sw.js');

    const devUrl = new URL(serviceWorkerUrl('http://192.168.1.5:8088'), 'http://192.168.1.5:4300/');
    expect(workerApi(devUrl)).toBe('http://192.168.1.5:8088/api');
    expect(workerApi(new URL('piston-sw.js', 'https://piston.app/'))).toBe('https://piston.app/api');
  });
});

/** Lo que calcula el worker como base de la API cuando se registra con `location`. */
function workerApi(location: URL): string {
  const declaration = /const API = .*;/.exec(WORKER)![0];
  return new Function('self', `${declaration} return API;`)({ location }) as string;
}
