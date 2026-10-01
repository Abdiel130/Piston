import type { IsoDate, IsoDateTime, Uuid } from './domain';
import type { FuelGrade, StickerColor, Transmission, VehicleType } from './enums';

/** Pasos del wizard de bienvenida, en orden. Mismos valores que el enum del backend. */
export type OnboardingStep = 'account' | 'vehicle' | 'tank' | 'purchase' | 'review' | 'done';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'account',
  'vehicle',
  'tank',
  'purchase',
  'review',
  'done',
];

/**
 * Lo que el usuario lleva escrito en el wizard.
 *
 * Todo opcional: se guarda campo a campo mientras escribe. La contraseña NUNCA
 * entra aquí; el borrador viaja al servidor y se guarda en claro.
 */
export interface OnboardingDraft {
  account?: {
    name?: string;
    currency?: string;
    distance_unit?: 'km' | 'mi';
    volume_unit?: 'L' | 'gal';
  };
  vehicle?: {
    make?: string;
    model?: string;
    year?: number | null;
    nickname?: string;
    vehicle_type?: VehicleType;
    transmission?: Transmission | null;
    license_plate?: string;
    emissions_sticker?: StickerColor;
    tank_capacity_l?: number | null;
    gauge_total_segments?: number;
    default_fuel_grade?: FuelGrade;
    purchase_date?: IsoDate | null;
    purchase_price?: number | null;
    purchase_odometer_km?: number | null;
    current_odometer_km?: number | null;
  };
}

export interface OnboardingState {
  readonly step: OnboardingStep;
  readonly draft: OnboardingDraft | null;
  /** Reloj del cliente que escribió por última vez. Base del last-write-wins. */
  readonly updated_at: IsoDateTime | null;
  readonly completed_at: IsoDateTime | null;
}

/** El usuario tal como lo devuelve `GET /api/me`. */
export interface AuthUser {
  readonly id: Uuid;
  readonly name: string;
  readonly email: string;
  readonly locale: string;
  readonly currency: string;
  readonly distance_unit: 'km' | 'mi';
  readonly volume_unit: 'L' | 'gal';
  readonly onboarding: OnboardingState;
}

/** Campos de perfil editables con `PATCH /api/me`. */
export type ProfilePatch = Partial<
  Pick<AuthUser, 'name' | 'locale' | 'currency' | 'distance_unit' | 'volume_unit'>
>;

/** Respuesta de login y refresh. El refresh token NO viene aquí: va en cookie. */
export interface AuthTokenResponse {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly expires_at: IsoDateTime;
  readonly user: AuthUser;
}

/**
 * Identidad local del dispositivo. CLIENT-ONLY.
 *
 * No es un secreto ni da acceso a nada en el servidor: solo dice "este
 * dispositivo es de esta cuenta". Con ella la app abre sin red; los tokens
 * viven en memoria (access) y en una cookie HttpOnly (refresh).
 */
export interface LocalSession {
  readonly key: typeof CURRENT;
  user: Omit<AuthUser, 'onboarding'>;
  last_login_at: IsoDateTime;
  /**
   * Cambios de perfil hechos en Ajustes que el servidor aún no confirma. Ya
   * están aplicados en `user`; se conservan aparte para reaplicarlos sobre lo
   * que traiga un refresh mientras no suban.
   */
  pending_profile?: ProfilePatch | null;
}

/** Copia local del wizard. CLIENT-ONLY. */
export interface LocalOnboarding extends OnboardingState {
  readonly key: typeof CURRENT;
  /** Hay cambios que el servidor todavía no conoce. */
  dirty: boolean;
  /** El perfil del paso "Cuenta" aún no se ha enviado a `PATCH /api/me`. */
  profile_dirty: boolean;
}

/** Clave de la única fila de `session` y de `onboarding`. */
export const CURRENT = 'current' as const;
