<?php

namespace Tests\Feature\Sync;

use App\Models\User;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

trait SyncTestHelpers
{
    protected function actingUser(): User
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        return $user;
    }

    /** @param  list<array<string, mixed>>  $mutations */
    protected function push(array $mutations): TestResponse
    {
        return $this->postJson('/api/sync', ['mutations' => $mutations]);
    }

    protected function pull(int $since = 0, ?int $limit = null): TestResponse
    {
        $query = http_build_query(array_filter(['since' => $since, 'limit' => $limit], fn ($v) => $v !== null));

        return $this->getJson("/api/sync?{$query}");
    }

    /** @return array<string, mixed> */
    protected function vehicle(array $overrides = []): array
    {
        return [
            'nickname' => null,
            'make' => 'Nissan',
            'model' => 'Versa',
            'year' => 2020,
            'vehicle_type' => 'car',
            'tank_capacity_l' => 41,
            'gauge_total_segments' => 8,
            'current_odometer_km' => 48650,
            'status' => 'active',
            'is_primary' => true,
            'user_id' => null,
            'rev' => 0,
            'client_updated_at' => now()->toISOString(),
            ...$overrides,
        ];
    }

    /** @return array<string, mixed> */
    protected function fuelEntry(string $vehicleId, array $overrides = []): array
    {
        return [
            'vehicle_id' => $vehicleId,
            'filled_at' => now()->toISOString(),
            'odometer_km' => 48700,
            'fuel_grade' => 'regular',
            'input_mode' => 'by_liters',
            'liters' => 30.5,
            'client_updated_at' => now()->toISOString(),
            ...$overrides,
        ];
    }

    /** @return array{table: string, id: string, op: string, payload: array<string, mixed>|null} */
    protected function mutation(string $table, array $payload, string $op = 'insert', ?string $id = null): array
    {
        return ['table' => $table, 'id' => $id ?? (string) Str::uuid7(), 'op' => $op, 'payload' => $payload];
    }
}
