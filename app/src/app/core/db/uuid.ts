/**
 * UUIDv7 (RFC 9562) generado en el cliente.
 *
 * Por qué v7 y no v4: los 48 bits altos son el timestamp en milisegundos, así
 * que los ids salen ordenados por tiempo. Eso le da a Postgres inserciones
 * casi secuenciales en el índice B-tree —en vez del desorden de un v4— y al
 * cliente un orden cronológico gratis sin leer `created_at`.
 *
 * Por qué generarlo aquí y no en el servidor: un registro creado sin conexión
 * necesita su id DEFINITIVO desde el primer instante. Si el servidor asignara
 * la clave al sincronizar, habría que reescribir todas las relaciones que ya
 * apuntan a ella (la carga que referencia al vehículo, la foto que referencia
 * a la carga), y eso es exactamente la clase de mapeo que rompe un sync.
 *
 *   | 48 bits unix_ts_ms | 4 ver | 12 rand_a | 2 var | 62 rand_b |
 */

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

/** Última marca de tiempo usada, para garantizar monotonía dentro del mismo ms. */
let lastTimestamp = -1;
let lastCounter = 0;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Genera un UUIDv7.
 *
 * Dos ids creados en el mismo milisegundo siguen saliendo ordenados: `rand_a`
 * se usa como contador incremental en lugar de sortearse de nuevo. Sin esto,
 * dos cargas registradas en el mismo instante quedarían en orden arbitrario.
 */
export function uuidV7(): string {
  const now = Date.now();

  if (now === lastTimestamp) {
    lastCounter += 1;
    // 12 bits desbordados: el siguiente ms empieza limpio. Es inalcanzable en
    // la práctica (4096 registros en un milisegundo), pero desbordar en
    // silencio produciría ids duplicados.
    if (lastCounter > 0xfff) {
      lastCounter = 0xfff;
    }
  } else {
    lastTimestamp = now;
    lastCounter = randomBytes(2)[0] & 0x0f; // arranque bajo: deja espacio para contar
  }

  const bytes = new Uint8Array(16);

  // 48 bits de timestamp. Date.now() cabe en 2^48 hasta el año 10889.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Versión 7 en el nibble alto + 12 bits de contador.
  bytes[6] = 0x70 | ((lastCounter >>> 8) & 0x0f);
  bytes[7] = lastCounter & 0xff;

  const rand = randomBytes(8);
  // Variante RFC 4122 (10xx) en los dos bits altos.
  bytes[8] = (rand[0] & 0x3f) | 0x80;
  for (let i = 1; i < 8; i += 1) {
    bytes[8 + i] = rand[i];
  }

  return (
    HEX[bytes[0]] + HEX[bytes[1]] + HEX[bytes[2]] + HEX[bytes[3]] + '-' +
    HEX[bytes[4]] + HEX[bytes[5]] + '-' +
    HEX[bytes[6]] + HEX[bytes[7]] + '-' +
    HEX[bytes[8]] + HEX[bytes[9]] + '-' +
    HEX[bytes[10]] + HEX[bytes[11]] + HEX[bytes[12]] + HEX[bytes[13]] + HEX[bytes[14]] + HEX[bytes[15]]
  );
}

/** Extrae el instante de creación embebido en un UUIDv7. */
export function uuidV7Timestamp(uuid: string): Date {
  const hex = uuid.replace(/-/g, '').slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}

/** Valida forma y versión. Útil al aceptar ids que llegan del servidor. */
export function isUuidV7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
