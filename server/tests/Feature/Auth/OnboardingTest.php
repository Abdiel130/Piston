<?php

namespace Tests\Feature\Auth;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OnboardingTest extends TestCase
{
    use AuthTestHelpers, RefreshDatabase;

    public function test_progress_is_saved_with_its_draft(): void
    {
        $this->makeUser();
        $token = $this->login()->json('data.access_token');

        $this->authed($token)->putJson('/api/me/onboarding', [
            'step' => 'tank',
            'draft' => ['vehicle' => ['make' => 'Mazda', 'gauge_total_segments' => 8]],
            'updated_at' => '2026-09-28T10:00:00.000Z',
        ])->assertOk()->assertJsonPath('data.onboarding.step', 'tank');

        $this->authed($token)->getJson('/api/me')
            ->assertJsonPath('data.onboarding.step', 'tank')
            ->assertJsonPath('data.onboarding.draft.vehicle.make', 'Mazda')
            ->assertJsonPath('data.onboarding.updated_at', '2026-09-28T10:00:00.000Z');
    }

    public function test_older_write_is_ignored_and_current_state_returned(): void
    {
        $this->makeUser();
        $token = $this->login()->json('data.access_token');

        $this->authed($token)->putJson('/api/me/onboarding', [
            'step' => 'purchase', 'draft' => ['n' => 2], 'updated_at' => '2026-09-28T10:05:00Z',
        ]);

        $this->authed($token)->putJson('/api/me/onboarding', [
            'step' => 'vehicle', 'draft' => ['n' => 1], 'updated_at' => '2026-09-28T10:00:00Z',
        ])->assertOk()->assertJsonPath('data.onboarding.step', 'purchase')->assertJsonPath('data.onboarding.draft.n', 2);
    }

    public function test_complete_is_final(): void
    {
        $this->makeUser();
        $token = $this->login()->json('data.access_token');

        $this->authed($token)->postJson('/api/me/onboarding/complete')
            ->assertOk()
            ->assertJsonPath('data.onboarding.step', 'done')
            ->assertJsonPath('data.onboarding.draft', null);

        $this->authed($token)->putJson('/api/me/onboarding', [
            'step' => 'vehicle', 'draft' => [], 'updated_at' => '2099-01-01T00:00:00Z',
        ])->assertOk()->assertJsonPath('data.onboarding.step', 'done');
    }

    public function test_done_cannot_be_set_through_update(): void
    {
        $this->makeUser();
        $token = $this->login()->json('data.access_token');

        $this->authed($token)->putJson('/api/me/onboarding', [
            'step' => 'done', 'draft' => null, 'updated_at' => '2026-09-28T10:00:00Z',
        ])->assertUnprocessable();
    }
}
