<?php

namespace Tests\Feature\Sync;

use App\Models\Domain\FuelEntry;
use App\Models\Domain\Vehicle;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SyncPushTest extends TestCase
{
    use RefreshDatabase, SyncTestHelpers;

    public function test_insert_is_applied_with_a_server_rev_and_owned_by_the_caller(): void
    {
        $user = $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());

        $response = $this->push([$vehicle])->assertOk();

        $response->assertJsonPath('data.applied.0.id', $vehicle['id'])
            ->assertJsonPath('data.applied.0.stale', false)
            ->assertJsonCount(0, 'data.rejected');
        $this->assertGreaterThan(0, $response->json('data.applied.0.rev'));
        $this->assertSame($response->json('data.applied.0.rev'), $response->json('data.server_rev'));
        $this->assertSame($user->id, Vehicle::find($vehicle['id'])->user_id);
    }

    public function test_replaying_the_same_batch_is_idempotent(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());

        $this->push([$vehicle])->assertOk();
        $this->push([$vehicle])->assertOk()->assertJsonCount(1, 'data.applied')->assertJsonCount(0, 'data.rejected');

        $this->assertSame(1, Vehicle::withTrashed()->count());
    }

    public function test_one_invalid_row_is_rejected_alone_and_the_rest_is_applied(): void
    {
        $this->actingUser();
        $good = $this->mutation('vehicles', $this->vehicle());
        $bad = $this->mutation('vehicles', $this->vehicle(['year' => 'nope', 'vehicle_type' => 'rocket']));

        $response = $this->push([$bad, $good])->assertOk();

        $response->assertJsonCount(1, 'data.applied')
            ->assertJsonPath('data.applied.0.id', $good['id'])
            ->assertJsonPath('data.rejected.0.id', $bad['id'])
            ->assertJsonPath('data.rejected.0.code', 'validation_failed');
        $this->assertArrayHasKey('year', $response->json('data.rejected.0.errors'));
        $this->assertArrayHasKey('vehicle_type', $response->json('data.rejected.0.errors'));
    }

    public function test_decimal_overflow_is_a_validation_rejection_not_a_server_error(): void
    {
        $this->actingUser();

        $this->push([$this->mutation('vehicles', $this->vehicle(['tank_capacity_l' => 100000]))])
            ->assertOk()
            ->assertJsonPath('data.rejected.0.code', 'validation_failed');
    }

    public function test_binary_float_drift_in_a_decimal_is_rounded_not_rejected(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle(['tank_capacity_l' => 0.1 + 0.2]));

        $this->push([$vehicle])->assertOk()->assertJsonCount(0, 'data.rejected');

        $this->assertSame(0.3, Vehicle::find($vehicle['id'])->tank_capacity_l);
    }

    public function test_real_extra_decimals_are_still_rejected(): void
    {
        $this->actingUser();

        $this->push([$this->mutation('vehicles', $this->vehicle(['tank_capacity_l' => 41.555]))])
            ->assertOk()
            ->assertJsonPath('data.rejected.0.code', 'validation_failed');
    }

    public function test_child_without_parent_is_rejected_as_parent_missing(): void
    {
        $this->actingUser();

        $this->push([$this->mutation('fuel_entries', $this->fuelEntry((string) Str::uuid7()))])
            ->assertOk()
            ->assertJsonPath('data.rejected.0.code', 'parent_missing');
    }

    public function test_parent_and_child_in_the_same_batch_are_applied(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());

        $this->push([$vehicle, $this->mutation('fuel_entries', $this->fuelEntry($vehicle['id']))])
            ->assertOk()
            ->assertJsonCount(2, 'data.applied');
    }

    public function test_older_write_does_not_overwrite_a_newer_one(): void
    {
        $this->actingUser();
        $id = (string) Str::uuid7();
        $newer = now();

        $this->push([$this->mutation('vehicles', $this->vehicle([
            'model' => 'Sentra', 'client_updated_at' => $newer->toISOString(),
        ]), id: $id)])->assertOk();

        $this->push([$this->mutation('vehicles', $this->vehicle([
            'model' => 'Versa', 'client_updated_at' => $newer->copy()->subMinute()->toISOString(),
        ]), 'update', $id)])
            ->assertOk()
            ->assertJsonPath('data.applied.0.stale', true);

        $this->assertSame('Sentra', Vehicle::find($id)->model);
    }

    public function test_delete_leaves_a_tombstone_and_later_edits_do_not_resurrect_it(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $this->push([$vehicle])->assertOk();

        $this->push([['table' => 'vehicles', 'id' => $vehicle['id'], 'op' => 'delete', 'payload' => null]])
            ->assertOk()
            ->assertJsonPath('data.applied.0.stale', false);
        $this->assertTrue(Vehicle::withTrashed()->find($vehicle['id'])->trashed());

        $this->push([$this->mutation('vehicles', $this->vehicle([
            'client_updated_at' => now()->addHour()->toISOString(),
        ]), 'update', $vehicle['id'])])->assertJsonPath('data.applied.0.stale', true);
        $this->assertTrue(Vehicle::withTrashed()->find($vehicle['id'])->trashed());
    }

    public function test_deleting_something_the_server_never_saw_is_a_no_op(): void
    {
        $this->actingUser();

        $this->push([['table' => 'vehicles', 'id' => (string) Str::uuid7(), 'op' => 'delete', 'payload' => null]])
            ->assertOk()
            ->assertJsonCount(1, 'data.applied')
            ->assertJsonPath('data.applied.0.rev', 0);
    }

    public function test_rows_of_another_account_cannot_be_touched_or_referenced(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $this->push([$vehicle])->assertOk();

        Sanctum::actingAs(User::factory()->create());

        $this->push([
            $this->mutation('vehicles', $this->vehicle(['model' => 'Hackeado']), 'update', $vehicle['id']),
            $this->mutation('fuel_entries', $this->fuelEntry($vehicle['id'])),
        ])
            ->assertOk()
            ->assertJsonPath('data.rejected.0.code', 'forbidden')
            ->assertJsonPath('data.rejected.1.code', 'forbidden');

        $this->assertSame('Versa', Vehicle::find($vehicle['id'])->model);
        $this->assertSame(0, FuelEntry::count());
    }

    public function test_unique_violation_is_a_conflict_rejection(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $point = ['vehicle_id' => $vehicle['id'], 'segment' => 4, 'liters' => 20];

        $this->push([
            $vehicle,
            $this->mutation('gauge_calibration_points', $point),
            $this->mutation('gauge_calibration_points', $point),
        ])
            ->assertOk()
            ->assertJsonCount(2, 'data.applied')
            ->assertJsonPath('data.rejected.0.code', 'conflict');
    }

    public function test_unknown_table_is_rejected(): void
    {
        $this->actingUser();

        $this->push([$this->mutation('users', ['name' => 'x'])])
            ->assertOk()
            ->assertJsonPath('data.rejected.0.code', 'unknown_table');
    }

    public function test_batch_over_the_limit_is_payload_too_large(): void
    {
        $this->actingUser();
        $mutations = array_fill(0, 501, $this->mutation('vehicles', $this->vehicle()));

        $this->push($mutations)->assertStatus(413)->assertJsonPath('code', 'payload_too_large');
    }

    public function test_requires_authentication(): void
    {
        $this->push([])->assertUnauthorized();
        $this->pull()->assertUnauthorized();
    }

    public function test_response_carries_the_client_request_id(): void
    {
        $this->actingUser();
        $requestId = (string) Str::uuid7();

        $this->withHeaders(['X-Request-Id' => $requestId])
            ->postJson('/api/sync', ['mutations' => []])
            ->assertOk()
            ->assertHeader('X-Request-Id', $requestId)
            ->assertJsonPath('meta.request_id', $requestId);
    }
}
