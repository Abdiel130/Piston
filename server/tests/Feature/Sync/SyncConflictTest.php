<?php

namespace Tests\Feature\Sync;

use App\Models\Domain\FuelEntry;
use App\Models\Domain\Vehicle;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Concurrencia optimista: cada mutación trae el `rev` y la fila que vio el
 * cliente. Dos "dispositivos" se simulan mandando mutaciones con la misma base.
 */
class SyncConflictTest extends TestCase
{
    use RefreshDatabase, SyncTestHelpers;

    /** Crea un vehículo y devuelve su id, la fila que vio el cliente y su `rev`. */
    private function seededVehicle(array $overrides = []): array
    {
        $id = (string) Str::uuid7();
        $payload = $this->vehicle(['license_plate' => 'ABC-123', 'notes' => 'original', ...$overrides]);

        $response = $this->push([$this->versioned('vehicles', $id, 'insert', $payload, 0, null)])->assertOk();

        return [$id, $response->json('data.applied.0.row'), $response->json('data.applied.0.rev')];
    }

    private function versioned(
        string $table,
        string $id,
        string $op,
        ?array $payload,
        int $baseRev,
        ?array $base,
        ?string $resolve = null,
    ): array {
        return array_filter(
            ['table' => $table, 'id' => $id, 'op' => $op, 'payload' => $payload,
                'base_rev' => $baseRev, 'base' => $base, 'resolve' => $resolve],
            fn ($value, $key) => $value !== null || in_array($key, ['payload', 'base_rev'], true),
            ARRAY_FILTER_USE_BOTH,
        );
    }

    public function test_untouched_row_is_applied_and_returns_the_saved_row(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();

        $response = $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'notes' => 'nuevo'], $rev, $base)])
            ->assertOk()
            ->assertJsonCount(0, 'data.rejected');

        $this->assertSame('nuevo', $response->json('data.applied.0.row.notes'));
        $this->assertGreaterThan($rev, $response->json('data.applied.0.rev'));
    }

    public function test_edits_on_different_fields_are_merged_without_intervention(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();

        // A cambia la placa; B, con la misma base, cambia las notas.
        $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'license_plate' => 'XYZ-999'], $rev, $base)])
            ->assertOk();
        $response = $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'notes' => 'de B'], $rev, $base)])
            ->assertOk()
            ->assertJsonCount(0, 'data.rejected')
            ->assertJsonPath('data.applied.0.merged', ['license_plate'])
            ->assertJsonPath('data.applied.0.row.license_plate', 'XYZ-999')
            ->assertJsonPath('data.applied.0.row.notes', 'de B');

        $vehicle = Vehicle::find($id);
        $this->assertSame('XYZ-999', $vehicle->license_plate);
        $this->assertSame('de B', $vehicle->notes);
        $this->assertSame($vehicle->rev, $response->json('data.applied.0.rev'));
    }

    public function test_same_field_with_different_values_is_a_conflict(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();

        $first = $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'license_plate' => 'AAA-111'], $rev, $base)]);
        $serverRev = $first->json('data.applied.0.rev');

        $this->push([$this->versioned('vehicles', $id, 'update', [
            ...$base, 'license_plate' => 'BBB-222', 'notes' => 'de B',
        ], $rev, $base)])
            ->assertOk()
            ->assertJsonCount(0, 'data.applied')
            ->assertJsonPath('data.rejected.0.code', 'conflict')
            ->assertJsonPath('data.rejected.0.conflict.kind', 'edit_edit')
            ->assertJsonPath('data.rejected.0.conflict.fields', ['license_plate'])
            ->assertJsonPath('data.rejected.0.conflict.server_row.license_plate', 'AAA-111')
            ->assertJsonPath('data.rejected.0.conflict.server_rev', $serverRev);

        // Nada de la mutación en conflicto se aplica, ni siquiera lo que no chocaba.
        $this->assertSame('original', Vehicle::find($id)->notes);
    }

    public function test_same_value_on_both_sides_is_not_a_conflict(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();

        $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'license_plate' => 'SAME-1'], $rev, $base)]);

        $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'license_plate' => 'SAME-1'], $rev, $base)])
            ->assertOk()
            ->assertJsonCount(0, 'data.rejected')
            ->assertJsonCount(1, 'data.applied');
    }

    public function test_numbers_and_dates_in_another_format_are_not_a_change(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle(['tank_capacity_l' => 41.5, 'purchase_date' => '2024-01-15']);

        $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'notes' => 'A'], $rev, $base)]);

        // Misma base, pero con los valores escritos de otra forma.
        $looseBase = [...$base, 'tank_capacity_l' => '41.50', 'purchase_date' => '2024-01-15'];
        $this->push([$this->versioned('vehicles', $id, 'update', [...$looseBase, 'license_plate' => 'B-1'], $rev, $looseBase)])
            ->assertOk()
            ->assertJsonCount(0, 'data.rejected');
    }

    public function test_editing_something_deleted_elsewhere_is_an_edit_delete_conflict(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();

        $this->push([$this->versioned('vehicles', $id, 'delete', $base, $rev, $base)])
            ->assertJsonPath('data.applied.0.stale', false);

        $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'notes' => 'editado offline'], $rev, $base)])
            ->assertOk()
            ->assertJsonPath('data.rejected.0.code', 'conflict')
            ->assertJsonPath('data.rejected.0.conflict.kind', 'edit_delete')
            ->assertJsonPath('data.rejected.0.conflict.fields', ['notes']);

        $this->assertTrue(Vehicle::withTrashed()->find($id)->trashed());
    }

    public function test_deleting_something_edited_elsewhere_is_an_edit_delete_conflict(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();

        $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'notes' => 'editado en A'], $rev, $base)]);

        $this->push([$this->versioned('vehicles', $id, 'delete', [...$base, 'deleted_at' => now()->toISOString()], $rev, $base)])
            ->assertOk()
            ->assertJsonPath('data.rejected.0.conflict.kind', 'edit_delete')
            ->assertJsonPath('data.rejected.0.conflict.fields', ['notes']);

        $this->assertFalse(Vehicle::withTrashed()->find($id)->trashed());
    }

    public function test_deleting_with_a_stale_base_but_no_other_change_is_applied(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();

        // Algo subió el rev sin cambiar campos (p. ej. un reenvío idéntico).
        Vehicle::find($id)->forceFill(['client_updated_at' => now()])->save();

        $this->push([$this->versioned('vehicles', $id, 'delete', $base, $rev, $base)])
            ->assertOk()
            ->assertJsonCount(0, 'data.rejected');

        $this->assertTrue(Vehicle::withTrashed()->find($id)->trashed());
    }

    public function test_child_of_a_deleted_parent_is_rejected_as_parent_deleted(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();
        $this->push([$this->versioned('vehicles', $id, 'delete', $base, $rev, $base)]);

        $this->push([$this->versioned('fuel_entries', (string) Str::uuid7(), 'insert', $this->fuelEntry($id), 0, null)])
            ->assertOk()
            ->assertJsonPath('data.rejected.0.code', 'parent_deleted')
            ->assertJsonPath('data.rejected.0.conflict.kind', 'create_in_deleted_parent')
            ->assertJsonPath('data.rejected.0.conflict.parent.table', 'vehicles')
            ->assertJsonPath('data.rejected.0.conflict.parent.id', $id)
            ->assertJsonPath('data.rejected.0.conflict.fields', ['vehicle_id']);

        $this->assertSame(0, FuelEntry::withTrashed()->count());
    }

    public function test_child_of_a_deleted_parent_is_rejected_without_base_rev_too(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();
        $this->push([$this->versioned('vehicles', $id, 'delete', $base, $rev, $base)]);

        $this->push([$this->mutation('fuel_entries', $this->fuelEntry($id))])
            ->assertJsonPath('data.rejected.0.code', 'parent_deleted');
    }

    public function test_restore_requires_the_explicit_flag_and_the_tombstone_rev(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();
        $deleted = $this->push([$this->versioned('vehicles', $id, 'delete', $base, $rev, $base)]);
        $tombstoneRev = $deleted->json('data.applied.0.rev');
        $mine = [...$base, 'notes' => 'mis cambios'];

        // Sin la bandera, aunque traiga el rev del tombstone, no resucita.
        $this->push([$this->versioned('vehicles', $id, 'update', $mine, $tombstoneRev, $base)])
            ->assertJsonPath('data.rejected.0.conflict.kind', 'edit_delete');

        // Con la bandera pero sobre un rev viejo, tampoco.
        $this->push([$this->versioned('vehicles', $id, 'insert', $mine, $rev, $base, 'restore')])
            ->assertJsonPath('data.rejected.0.conflict.kind', 'edit_delete');

        $this->push([$this->versioned('vehicles', $id, 'insert', $mine, $tombstoneRev, $base, 'restore')])
            ->assertOk()
            ->assertJsonCount(0, 'data.rejected')
            ->assertJsonPath('data.applied.0.row.deleted_at', null)
            ->assertJsonPath('data.applied.0.row.notes', 'mis cambios');

        $this->assertFalse(Vehicle::withTrashed()->find($id)->trashed());
    }

    public function test_keep_mine_after_a_conflict_is_applied(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();
        $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'license_plate' => 'AAA-111'], $rev, $base)]);

        $conflict = $this->push([$this->versioned('vehicles', $id, 'update', [...$base, 'license_plate' => 'BBB-222'], $rev, $base)])
            ->json('data.rejected.0.conflict');

        // "Conservar la mía": misma versión, ahora sobre lo que tiene el servidor.
        $serverRow = $conflict['server_row'];
        $this->push([$this->versioned('vehicles', $id, 'update', [...$serverRow, 'license_plate' => 'BBB-222'], $conflict['server_rev'], $serverRow)])
            ->assertOk()
            ->assertJsonCount(0, 'data.rejected');

        $this->assertSame('BBB-222', Vehicle::find($id)->license_plate);
    }

    public function test_replaying_an_insert_after_a_timeout_is_idempotent(): void
    {
        $this->actingUser();
        $id = (string) Str::uuid7();
        $insert = $this->versioned('vehicles', $id, 'insert', $this->vehicle(), 0, null);

        $this->push([$insert])->assertOk();
        $this->push([$insert])->assertOk()->assertJsonCount(0, 'data.rejected');

        $this->assertSame(1, Vehicle::withTrashed()->count());
    }

    public function test_the_device_clock_does_not_decide_the_winner(): void
    {
        $this->actingUser();
        [$id, $base, $rev] = $this->seededVehicle();

        // B tiene el reloj un día atrasado y edita después que A: no pierde.
        $this->push([$this->versioned('vehicles', $id, 'update', [
            ...$base, 'license_plate' => 'A-1', 'client_updated_at' => now()->addDay()->toISOString(),
        ], $rev, $base)]);
        $this->push([$this->versioned('vehicles', $id, 'update', [
            ...$base, 'notes' => 'B', 'client_updated_at' => now()->subDay()->toISOString(),
        ], $rev, $base)])->assertJsonCount(0, 'data.rejected');

        $vehicle = Vehicle::find($id);
        $this->assertSame('A-1', $vehicle->license_plate);
        $this->assertSame('B', $vehicle->notes);
    }

    public function test_mutations_without_base_rev_keep_last_write_wins(): void
    {
        $this->actingUser();
        $id = (string) Str::uuid7();
        $newer = now();

        $this->push([$this->mutation('vehicles', $this->vehicle([
            'model' => 'Sentra', 'client_updated_at' => $newer->toISOString(),
        ]), id: $id)]);

        $this->push([$this->mutation('vehicles', $this->vehicle([
            'model' => 'Versa', 'client_updated_at' => $newer->copy()->subMinute()->toISOString(),
        ]), 'update', $id)])
            ->assertJsonPath('data.applied.0.stale', true)
            ->assertJsonCount(0, 'data.rejected');

        $this->assertSame('Sentra', Vehicle::find($id)->model);
    }

    public function test_resolve_only_accepts_restore(): void
    {
        $this->actingUser();

        $this->push([$this->versioned('vehicles', (string) Str::uuid7(), 'insert', $this->vehicle(), 0, null, 'overwrite')])
            ->assertUnprocessable();
    }
}
