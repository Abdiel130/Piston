<?php

namespace Tests\Feature\Sync;

use App\Models\Domain\Document;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SyncDocumentTest extends TestCase
{
    use RefreshDatabase, SyncTestHelpers;

    /** @return array<string, mixed> */
    private function insurance(string $vehicleId, array $overrides = []): array
    {
        return [
            'vehicle_id' => $vehicleId,
            'type' => 'insurance',
            'issuer' => 'Qualitas',
            'reference' => '123-456',
            'issued_at' => '2025-11-01',
            'expires_at' => '2026-11-01',
            'contact_phone' => '800 800 2880',
            'assistance_phone' => '800 288 6700',
            'insured_number' => 'A-0042',
            'policy_item' => '1',
            'renewed_by_id' => null,
            'client_updated_at' => now()->toISOString(),
            ...$overrides,
        ];
    }

    public function test_renewal_in_the_same_batch_links_the_previous_policy(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $previous = $this->mutation('documents', $this->insurance($vehicle['id']));
        $next = $this->mutation('documents', $this->insurance($vehicle['id'], [
            'issued_at' => '2026-11-01', 'expires_at' => '2027-11-01',
        ]));
        $link = $this->mutation('documents', $this->insurance($vehicle['id'], [
            'renewed_by_id' => $next['id'],
            'client_updated_at' => now()->addSecond()->toISOString(),
        ]), 'update', $previous['id']);

        $this->push([$vehicle, $previous, $next, $link])
            ->assertOk()
            ->assertJsonCount(4, 'data.applied')
            ->assertJsonCount(0, 'data.rejected');

        $saved = Document::find($previous['id']);
        $this->assertSame($next['id'], $saved->renewed_by_id);
        $this->assertSame('800 800 2880', $saved->contact_phone);
        $this->assertSame('A-0042', $saved->insured_number);
        $this->assertSame('1', $saved->policy_item);
    }

    public function test_renewal_pointing_to_a_missing_document_is_rejected(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());

        $this->push([
            $vehicle,
            $this->mutation('documents', $this->insurance($vehicle['id'], [
                'renewed_by_id' => (string) Str::uuid7(),
            ])),
        ])
            ->assertOk()
            ->assertJsonPath('data.rejected.0.code', 'parent_missing');
    }

    public function test_renewal_cannot_point_to_a_document_of_another_account(): void
    {
        $this->actingUser();
        $vehicle = $this->mutation('vehicles', $this->vehicle());
        $foreign = $this->mutation('documents', $this->insurance($vehicle['id']));
        $this->push([$vehicle, $foreign])->assertOk()->assertJsonCount(2, 'data.applied');

        Sanctum::actingAs(User::factory()->create());
        $own = $this->mutation('vehicles', $this->vehicle());

        $this->push([
            $own,
            $this->mutation('documents', $this->insurance($own['id'], ['renewed_by_id' => $foreign['id']])),
        ])
            ->assertOk()
            ->assertJsonCount(1, 'data.applied')
            ->assertJsonCount(1, 'data.rejected');

        $this->assertSame(0, Document::where('vehicle_id', $own['id'])->count());
    }
}
