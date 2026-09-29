<?php

namespace Tests\Feature\Sync;

use App\Models\Domain\ServiceType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SyncPullTest extends TestCase
{
    use RefreshDatabase, SyncTestHelpers;

    public function test_round_trip_returns_rows_with_client_types(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle(['tank_capacity_l' => 41.5]));
        $this->push([$vehicle, $this->mutation('fuel_entries', $this->fuelEntry($vehicle['id']))]);

        $response = $this->pull()->assertOk()->assertJsonPath('data.has_more', false);

        $row = $response->json('data.changes.vehicles.0');
        $this->assertSame($vehicle['id'], $row['id']);
        $this->assertSame(41.5, $row['tank_capacity_l']);
        $this->assertSame(2020, $row['year']);
        $this->assertTrue($row['is_primary']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/', $row['client_updated_at']);
        $this->assertSame(30.5, $response->json('data.changes.fuel_entries.0.liters'));
        $this->assertSame($response->json('data.changes.fuel_entries.0.rev'), $response->json('data.server_rev'));
    }

    public function test_since_returns_only_newer_changes_including_tombstones(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $this->push([$vehicle]);
        $cursor = $this->pull()->json('data.server_rev');

        $this->pull($cursor)->assertJsonPath('data.changes', [])->assertJsonPath('data.server_rev', $cursor);

        $this->push([['table' => 'vehicles', 'id' => $vehicle['id'], 'op' => 'delete', 'payload' => null]]);

        $this->assertNotNull($this->pull($cursor)->json('data.changes.vehicles.0.deleted_at'));
    }

    public function test_pages_are_cut_in_rev_order_across_tables(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $mutations = [$vehicle];
        for ($i = 0; $i < 4; $i++) {
            $mutations[] = $this->mutation('fuel_entries', $this->fuelEntry($vehicle['id']));
        }
        $this->push($mutations);

        $seen = [];
        $cursor = 0;
        do {
            $page = $this->pull($cursor, 2)->assertOk()->json('data');
            foreach ($page['changes'] as $rows) {
                array_push($seen, ...array_column($rows, 'id'));
            }
            $this->assertGreaterThan($cursor, $page['server_rev']);
            $cursor = $page['server_rev'];
        } while ($page['has_more']);

        $this->assertEqualsCanonicalizing(array_column($mutations, 'id'), $seen);
    }

    public function test_pull_is_scoped_to_the_account_but_includes_system_catalogs(): void
    {
        $this->actingUser();
        $this->push([$this->mutation('vehicles', $this->vehicle())]);
        ServiceType::query()->create(['name' => 'Cambio de aceite', 'is_system' => true, 'user_id' => null]);

        Sanctum::actingAs(User::factory()->create());

        $changes = $this->pull()->json('data.changes');
        $this->assertArrayNotHasKey('vehicles', $changes);
        $this->assertCount(1, $changes['service_types']);
    }

    public function test_child_tables_without_user_id_are_scoped_through_the_parent(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $this->push([$vehicle, $this->mutation('gauge_calibration_points', [
            'vehicle_id' => $vehicle['id'], 'segment' => 8, 'liters' => 41,
        ])]);
        $this->assertCount(1, $this->pull()->json('data.changes.gauge_calibration_points'));

        Sanctum::actingAs(User::factory()->create());
        $this->assertArrayNotHasKey('gauge_calibration_points', $this->pull()->json('data.changes'));
    }

    public function test_show_returns_the_server_version_or_404(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $this->push([$vehicle]);

        $this->getJson("/api/sync/vehicles/{$vehicle['id']}")->assertOk()->assertJsonPath('data.row.model', 'Versa');
        $this->getJson('/api/sync/vehicles/'.Str::uuid7())->assertNotFound();
        $this->getJson('/api/sync/nope/'.Str::uuid7())->assertStatus(400)->assertJsonPath('code', 'unknown_table');

        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/sync/vehicles/{$vehicle['id']}")->assertNotFound();
    }

    public function test_attachment_file_upload_is_verified_and_idempotent(): void
    {
        Storage::fake('local');
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $file = UploadedFile::fake()->createWithContent('ticket.jpg', 'foto-original');
        $attachment = $this->mutation('attachments', [
            'owner_type' => 'vehicle',
            'owner_id' => $vehicle['id'],
            'file_name' => 'ticket.jpg',
            'checksum' => hash_file('sha256', $file->getRealPath()),
            'upload_status' => 'uploaded',
            'storage_path' => '/etc/passwd',
        ]);
        $this->push([$vehicle, $attachment])->assertJsonCount(2, 'data.applied');

        $this->assertSame('pending', $this->pull()->json('data.changes.attachments.0.upload_status'));
        $this->assertNull($this->pull()->json('data.changes.attachments.0.storage_path'));

        $this->post("/api/attachments/{$attachment['id']}/file", ['file' => $file], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('data.upload_status', 'uploaded');
        $this->post("/api/attachments/{$attachment['id']}/file", ['file' => $file], ['Accept' => 'application/json'])
            ->assertOk();

        $this->post("/api/attachments/{$attachment['id']}/file", [
            'file' => UploadedFile::fake()->createWithContent('otra.jpg', 'otra-foto'),
        ], ['Accept' => 'application/json'])->assertUnprocessable();

        $this->post('/api/attachments/'.Str::uuid7().'/file', ['file' => $file], ['Accept' => 'application/json'])
            ->assertNotFound();
    }
}
