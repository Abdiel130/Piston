import type { SyncFailureKind } from '../models';

export type DiagnosisAction = 'retry' | 'relogin' | 'discard' | 'wait' | 'resolve';

export interface Diagnosis {
  /** Causa en pocas palabras, para la fila de la lista. */
  readonly short: string;
  readonly title: string;
  /** Qué pasó, en lenguaje de persona. */
  readonly what: string;
  /** Cómo se soluciona. */
  readonly fix: string;
  /** Lo que resuelve esto solo, sin que el usuario haga nada. */
  readonly selfHealing: boolean;
  readonly actions: readonly DiagnosisAction[];
  readonly tone: 'warn' | 'bad';
}

/**
 * Qué decirle al usuario por cada tipo de fallo.
 *
 * La regla: si el problema es del servidor o de la red, el usuario no tiene
 * nada que corregir y hay que decírselo claro ("un Sincronizar lo arregla").
 * Si es del dato, hay que decir qué campo y qué hacer con él.
 */
export const DIAGNOSIS: Readonly<Record<SyncFailureKind, Diagnosis>> = {
  offline: {
    short: 'Sin conexión',
    title: 'El dispositivo no tiene conexión',
    what: 'El cambio está guardado en este dispositivo, pero no hay internet para enviarlo.',
    fix: 'No tienes que hacer nada. Se enviará solo en cuanto vuelva la señal.',
    selfHealing: true,
    actions: ['wait'],
    tone: 'warn',
  },
  server_unreachable: {
    short: 'Servidor no disponible',
    title: 'El servidor no respondió',
    what:
      'Hay internet, pero el servidor no contestó. Puede estar caído, reiniciándose o inaccesible desde esta red.',
    fix: 'Tus datos están a salvo aquí. Se reintentará solo; cuando el servidor vuelva, un Sincronizar lo resuelve.',
    selfHealing: true,
    actions: ['retry'],
    tone: 'warn',
  },
  timeout: {
    short: 'Tiempo agotado',
    title: 'El servidor tardó demasiado',
    what:
      'La petición salió pero no llegó respuesta a tiempo. Es seguro reintentar: si el servidor sí la aplicó, no se duplica.',
    fix: 'Se reintentará solo. Si se repite, revisa la conexión o busca el ID de solicitud en los logs.',
    selfHealing: true,
    actions: ['retry'],
    tone: 'warn',
  },
  server_error: {
    short: 'Error del servidor',
    title: 'Error interno del servidor (500)',
    what:
      'El servidor falló al procesar el envío. No es un problema de tus datos. El ID de solicitud y la hora exacta permiten encontrar la causa en los logs del servidor.',
    fix: 'Se reintentará solo. Casi siempre un Sincronizar lo resuelve; si persiste, busca el ID de solicitud en storage/logs/laravel.log.',
    selfHealing: true,
    actions: ['retry'],
    tone: 'bad',
  },
  unavailable: {
    short: 'Servidor caído',
    title: 'Servidor caído o en mantenimiento',
    what: 'El servidor respondió que no está disponible por ahora (502/503/504): un despliegue, un reinicio o una caída.',
    fix: 'No tienes que hacer nada. Se reintentará solo, y un Sincronizar cuando vuelva lo arregla todo.',
    selfHealing: true,
    actions: ['retry'],
    tone: 'warn',
  },
  rate_limited: {
    short: 'Demasiadas peticiones',
    title: 'El servidor pidió esperar',
    what: 'Se enviaron demasiadas peticiones en poco tiempo y el servidor pidió una pausa.',
    fix: 'Se reintentará solo en cuanto pase el tiempo indicado.',
    selfHealing: true,
    actions: ['wait'],
    tone: 'warn',
  },
  endpoint_missing: {
    short: 'Servidor desactualizado',
    title: 'El servidor no conoce esta ruta',
    what: 'El servidor respondió 404/501 a la sincronización: probablemente hay un despliegue en curso o una versión vieja.',
    fix: 'Se reintentará solo. Si dura mucho, hay que actualizar el servidor.',
    selfHealing: true,
    actions: ['retry'],
    tone: 'warn',
  },
  auth: {
    short: 'Sesión expirada',
    title: 'Tu sesión expiró',
    what: 'El cambio es válido, pero el servidor necesita que vuelvas a iniciar sesión para aceptarlo.',
    fix: 'Inicia sesión de nuevo. Todo lo pendiente se enviará en cuanto entres.',
    selfHealing: false,
    actions: ['relogin'],
    tone: 'warn',
  },
  validation: {
    short: 'Datos inválidos',
    title: 'El servidor rechazó los datos',
    what: 'Algún campo no cumple las reglas del servidor. Reintentar igual no cambia el resultado.',
    fix: 'Revisa los campos marcados abajo y corrige el registro. Si no se puede corregir, descarta el cambio.',
    selfHealing: false,
    actions: ['retry', 'discard'],
    tone: 'bad',
  },
  forbidden: {
    short: 'Sin permiso',
    title: 'Ese registro no es de tu cuenta',
    what: 'El servidor rechazó el cambio porque apunta a un registro de otra cuenta o de solo lectura.',
    fix: 'Descarta el cambio. Si crees que es un error, cierra sesión e inicia con la cuenta correcta.',
    selfHealing: false,
    actions: ['discard'],
    tone: 'bad',
  },
  conflict: {
    short: 'Duplicado',
    title: 'Ya existe un registro igual',
    what: 'El servidor ya tiene otro registro con esos mismos datos únicos (por ejemplo, dos veces el mismo plan de mantenimiento).',
    fix: 'Descarta este cambio; el registro que ya existe se conserva.',
    selfHealing: false,
    actions: ['discard', 'retry'],
    tone: 'bad',
  },
  parent_missing: {
    short: 'Esperando otro registro',
    title: 'Depende de un registro que no ha subido',
    what: 'Este cambio apunta a otro registro (por ejemplo, el vehículo de una carga) que el servidor todavía no tiene.',
    fix: 'Resuelve primero el registro del que depende. Este saldrá solo en cuanto aquel suba.',
    selfHealing: true,
    actions: ['retry', 'discard'],
    tone: 'warn',
  },
  edit_conflict: {
    short: 'Conflicto',
    title: 'Se cambió en otro dispositivo',
    what: 'Otro dispositivo cambió este mismo registro y las dos versiones chocan. Ninguna se descartó.',
    fix: 'Abre el conflicto y elige qué versión conservar, campo por campo si quieres.',
    selfHealing: false,
    actions: ['resolve'],
    tone: 'bad',
  },
  parent_deleted: {
    short: 'Su registro se borró',
    title: 'Lo registraste dentro de algo que se borró',
    what: 'El registro del que depende (por ejemplo, el vehículo de una carga) se borró en otro dispositivo.',
    fix: 'Restaura el registro del que depende o descarta este.',
    selfHealing: false,
    actions: ['resolve'],
    tone: 'bad',
  },
  payload_too_large: {
    short: 'Demasiado grande',
    title: 'El envío es demasiado grande',
    what: 'El servidor rechazó el tamaño del envío o del archivo.',
    fix: 'Si es una foto, descártala y súbela con menor resolución.',
    selfHealing: false,
    actions: ['discard'],
    tone: 'bad',
  },
  client_bug: {
    short: 'Error de la app',
    title: 'Error inesperado de la app',
    what: 'Algo falló dentro de la app al preparar el envío. No parece un problema del servidor ni de tus datos.',
    fix: 'Intenta Sincronizar. Si se repite, reporta el error con la hora exacta.',
    selfHealing: false,
    actions: ['retry', 'discard'],
    tone: 'bad',
  },
};
