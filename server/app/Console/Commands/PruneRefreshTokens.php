<?php

namespace App\Console\Commands;

use App\Models\RefreshToken;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * Los tokens revocados se conservan unos días porque son los que permiten
 * detectar un reuso. Pasado ese margen ya no aportan nada.
 */
#[Signature('piston:auth:prune {--days=7 : Días que se conservan los revocados}')]
#[Description('Borra refresh tokens expirados o revocados hace tiempo')]
class PruneRefreshTokens extends Command
{
    public function handle(): int
    {
        $cutoff = now()->subDays((int) $this->option('days'));

        $deleted = RefreshToken::query()
            ->where(fn ($query) => $query
                ->where('expires_at', '<', now())
                ->orWhere('revoked_at', '<', $cutoff))
            ->delete();

        $this->components->info("Refresh tokens borrados: {$deleted}");

        return self::SUCCESS;
    }
}
