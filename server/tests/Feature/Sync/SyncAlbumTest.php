<?php

namespace Tests\Feature\Sync;

use App\Models\Domain\Attachment;
use App\Models\Domain\VehicleAlbum;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SyncAlbumTest extends TestCase
{
    use RefreshDatabase, SyncTestHelpers;

    /** @return array<string, mixed> */
    private function album(string $vehicleId, array $overrides = []): array
    {
        return [
            'vehicle_id' => $vehicleId,
            'name' => 'Restauración',
            'description' => 'Pintura y vestiduras',
            'cover_attachment_id' => null,
            'sort_order' => 0,
            'client_updated_at' => now()->toISOString(),
            ...$overrides,
        ];
    }

    /** @return array<string, mixed> */
    private function photo(string $ownerType, string $ownerId, array $overrides = []): array
    {
        return [
            'owner_type' => $ownerType,
            'owner_id' => $ownerId,
            'kind' => 'photo',
            'file_name' => 'frente.jpg',
            'mime_type' => 'image/jpeg',
            'size_bytes' => 1024,
            'width' => 2560,
            'height' => 1920,
            'taken_at' => '2024-05-02T10:30:00.000Z',
            'client_updated_at' => now()->toISOString(),
            ...$overrides,
        ];
    }

    public function test_album_with_photos_round_trips(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $album = $this->mutation('vehicle_albums', $this->album($vehicle['id']));
        $photo = $this->mutation('attachments', $this->photo('album', $album['id']));
        $cover = $this->mutation('vehicle_albums', $this->album($vehicle['id'], [
            'cover_attachment_id' => $photo['id'],
            'client_updated_at' => now()->addSecond()->toISOString(),
        ]), 'update', $album['id']);

        $this->push([$vehicle, $album, $photo, $cover])
            ->assertOk()
            ->assertJsonCount(4, 'data.applied')
            ->assertJsonCount(0, 'data.rejected');

        $this->assertSame($photo['id'], VehicleAlbum::find($album['id'])->cover_attachment_id);
        $this->assertSame('album', Attachment::find($photo['id'])->owner_type);

        $pulled = $this->pull()->assertOk();
        $this->assertSame($album['id'], $pulled->json('data.changes.vehicle_albums.0.id'));
        $this->assertSame('2024-05-02', substr($pulled->json('data.changes.attachments.0.taken_at'), 0, 10));
    }

    public function test_photo_moves_between_album_and_vehicle(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $album = $this->mutation('vehicle_albums', $this->album($vehicle['id']));
        $photo = $this->mutation('attachments', $this->photo('album', $album['id']));
        $this->push([$vehicle, $album, $photo])->assertOk()->assertJsonCount(3, 'data.applied');

        $this->push([
            $this->mutation('attachments', $this->photo('vehicle', $vehicle['id'], [
                'client_updated_at' => now()->addSecond()->toISOString(),
            ]), 'update', $photo['id']),
        ])->assertOk()->assertJsonCount(1, 'data.applied');

        $moved = Attachment::find($photo['id']);
        $this->assertSame('vehicle', $moved->owner_type);
        $this->assertSame($vehicle['id'], $moved->owner_id);
    }

    public function test_photo_cannot_go_to_an_album_of_another_account(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $foreign = $this->mutation('vehicle_albums', $this->album($vehicle['id']));
        $this->push([$vehicle, $foreign])->assertOk()->assertJsonCount(2, 'data.applied');

        Sanctum::actingAs(User::factory()->create());

        $this->push([$this->mutation('attachments', $this->photo('album', $foreign['id']))])
            ->assertOk()
            ->assertJsonCount(0, 'data.applied')
            ->assertJsonCount(1, 'data.rejected');
    }
}
