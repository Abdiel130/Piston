<?php

namespace App\Http\Responses;

use Symfony\Component\HttpFoundation\Response;

/**
 * Catálogo de resultados de la API.
 *
 * El cliente decide por `code`, nunca por el texto ni solo por el status HTTP:
 * dos 401 distintos (access vencido vs. refresh inválido) exigen reacciones
 * distintas. Cada caso sabe su status y su mensaje por defecto, así que para
 * agregar un resultado nuevo basta con agregar un caso aquí.
 */
enum ApiCode: string
{
    // ── Éxito ──────────────────────────────────────────────────────────────
    case Ok = 'ok';
    case Created = 'created';

    // ── Errores del cliente ────────────────────────────────────────────────
    case BadRequest = 'bad_request';
    case ValidationFailed = 'validation_failed';
    case InvalidCredentials = 'invalid_credentials';
    case Unauthenticated = 'unauthenticated';
    case RefreshInvalid = 'refresh_invalid';
    case RefreshRace = 'refresh_race';
    case ClientHeaderMissing = 'client_header_missing';
    case Forbidden = 'forbidden';
    case NotFound = 'not_found';
    case MethodNotAllowed = 'method_not_allowed';
    case Conflict = 'conflict';
    case PayloadTooLarge = 'payload_too_large';
    case TooManyRequests = 'too_many_requests';

    // ── Rechazos del sync (por mutación) ───────────────────────────────────
    case ParentMissing = 'parent_missing';
    case UnknownTable = 'unknown_table';

    // ── Errores del servidor ───────────────────────────────────────────────
    case ServerError = 'server_error';
    case ServiceUnavailable = 'service_unavailable';

    public function status(): int
    {
        return match ($this) {
            self::Ok => Response::HTTP_OK,
            self::Created => Response::HTTP_CREATED,
            self::BadRequest => Response::HTTP_BAD_REQUEST,
            self::ValidationFailed, self::InvalidCredentials => Response::HTTP_UNPROCESSABLE_ENTITY,
            self::Unauthenticated, self::RefreshInvalid => Response::HTTP_UNAUTHORIZED,
            self::ClientHeaderMissing, self::Forbidden => Response::HTTP_FORBIDDEN,
            self::NotFound => Response::HTTP_NOT_FOUND,
            self::MethodNotAllowed => Response::HTTP_METHOD_NOT_ALLOWED,
            self::RefreshRace, self::Conflict, self::ParentMissing => Response::HTTP_CONFLICT,
            self::UnknownTable => Response::HTTP_BAD_REQUEST,
            self::PayloadTooLarge => Response::HTTP_REQUEST_ENTITY_TOO_LARGE,
            self::TooManyRequests => Response::HTTP_TOO_MANY_REQUESTS,
            self::ServerError => Response::HTTP_INTERNAL_SERVER_ERROR,
            self::ServiceUnavailable => Response::HTTP_SERVICE_UNAVAILABLE,
        };
    }

    /** Mensaje para humanos cuando quien responde no da uno más específico. */
    public function message(): string
    {
        return match ($this) {
            self::Ok => 'Listo.',
            self::Created => 'Creado.',
            self::BadRequest => 'La petición no es válida.',
            self::ValidationFailed => 'Hay datos que corregir.',
            self::InvalidCredentials => 'El correo o la contraseña no son correctos.',
            self::Unauthenticated => 'Sesión no válida o expirada.',
            self::RefreshInvalid => 'No hay sesión que renovar.',
            self::RefreshRace => 'La sesión se acaba de renovar; reintenta.',
            self::ClientHeaderMissing => 'Cliente no reconocido.',
            self::Forbidden => 'No tienes permiso para esto.',
            self::NotFound => 'No existe.',
            self::MethodNotAllowed => 'Método no permitido.',
            self::Conflict => 'El recurso cambió; vuelve a intentarlo.',
            self::PayloadTooLarge => 'El envío es demasiado grande.',
            self::TooManyRequests => 'Demasiadas peticiones. Espera un momento.',
            self::ParentMissing => 'El registro del que depende todavía no existe en el servidor.',
            self::UnknownTable => 'El servidor no reconoce ese tipo de registro.',
            self::ServerError => 'Algo falló en el servidor.',
            self::ServiceUnavailable => 'El servicio no está disponible por ahora.',
        };
    }

    public function isSuccess(): bool
    {
        return $this->status() < Response::HTTP_BAD_REQUEST;
    }

    /** El código genérico que corresponde a un status HTTP sin más contexto. */
    public static function fromStatus(int $status): self
    {
        return match (true) {
            $status === Response::HTTP_UNAUTHORIZED => self::Unauthenticated,
            $status === Response::HTTP_FORBIDDEN => self::Forbidden,
            $status === Response::HTTP_NOT_FOUND => self::NotFound,
            $status === Response::HTTP_METHOD_NOT_ALLOWED => self::MethodNotAllowed,
            $status === Response::HTTP_CONFLICT => self::Conflict,
            $status === Response::HTTP_REQUEST_ENTITY_TOO_LARGE => self::PayloadTooLarge,
            $status === Response::HTTP_UNPROCESSABLE_ENTITY => self::ValidationFailed,
            $status === Response::HTTP_TOO_MANY_REQUESTS => self::TooManyRequests,
            $status === Response::HTTP_SERVICE_UNAVAILABLE => self::ServiceUnavailable,
            $status >= 500 => self::ServerError,
            $status >= 400 => self::BadRequest,
            $status === Response::HTTP_CREATED => self::Created,
            default => self::Ok,
        };
    }
}
