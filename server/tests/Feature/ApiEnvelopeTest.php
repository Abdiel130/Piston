<?php

namespace Tests\Feature;

use App\Exceptions\ApiException;
use App\Http\Responses\ApiCode;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

class ApiEnvelopeTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Route::middleware('api')->prefix('api/_test')->group(function () {
            Route::get('boom', fn () => throw new RuntimeException('SQLSTATE[08006] host=piston-db user=piston_user'));
            Route::get('domain', fn () => throw ApiException::of(ApiCode::Conflict, 'El vehículo ya existe.'));
            Route::post('validate', fn () => request()->validate(['plate' => ['required']]));
        });
    }

    public function test_success_envelope_has_a_fixed_shape(): void
    {
        $response = $this->getJson('/api/health')
            ->assertOk()
            ->assertExactJsonStructure([
                'success', 'code', 'message',
                'data' => ['status', 'service', 'version', 'database'],
                'meta' => ['request_id', 'timestamp'],
            ])
            ->assertJsonPath('success', true)
            ->assertJsonPath('code', 'ok');

        $this->assertTrue(Str::isUuid($response->json('meta.request_id')));
        $this->assertSame($response->json('meta.request_id'), $response->headers->get('X-Request-Id'));
    }

    public function test_health_does_not_reveal_the_stack(): void
    {
        $body = $this->getJson('/api/health')->getContent();

        foreach (['php_version', 'laravel_version', 'driver', PHP_VERSION, app()->version()] as $leak) {
            $this->assertStringNotContainsString($leak, $body);
        }
    }

    public function test_unhandled_exception_hides_its_message_even_with_debug_on(): void
    {
        config(['app.debug' => true]);

        $response = $this->getJson('/api/_test/boom')
            ->assertStatus(500)
            ->assertJsonPath('success', false)
            ->assertJsonPath('code', 'server_error')
            ->assertJsonPath('data', null);

        $body = $response->getContent();
        foreach (['SQLSTATE', 'piston-db', 'RuntimeException', 'trace', 'file', 'line'] as $leak) {
            $this->assertStringNotContainsString($leak, $body);
        }
    }

    public function test_api_exception_answers_with_its_own_code(): void
    {
        $this->getJson('/api/_test/domain')
            ->assertStatus(409)
            ->assertJsonPath('code', 'conflict')
            ->assertJsonPath('message', 'El vehículo ya existe.');
    }

    public function test_validation_errors_go_in_errors(): void
    {
        $this->postJson('/api/_test/validate')
            ->assertUnprocessable()
            ->assertJsonPath('success', false)
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonValidationErrors('plate');
    }

    public function test_framework_errors_use_the_envelope(): void
    {
        $this->getJson('/api/no-existe')
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found')
            ->assertHeader('X-Request-Id');

        $this->deleteJson('/api/me')
            ->assertStatus(405)
            ->assertJsonPath('code', 'method_not_allowed');
    }

    public function test_client_request_id_is_reused_only_if_it_is_a_uuid(): void
    {
        $id = (string) Str::uuid7();

        $this->getJson('/api/health', ['X-Request-Id' => $id])->assertJsonPath('meta.request_id', $id);

        $forged = $this->getJson('/api/health', ['X-Request-Id' => "x\n[CRITICAL] falso"]);
        $this->assertTrue(Str::isUuid($forged->json('meta.request_id')));
    }

    public function test_throttling_says_when_to_retry(): void
    {
        for ($i = 0; $i < 30; $i++) {
            $this->withHeaders(['X-Piston-Client' => 'test'])->postJson('/api/auth/refresh');
        }

        $response = $this->withHeaders(['X-Piston-Client' => 'test'])->postJson('/api/auth/refresh')
            ->assertTooManyRequests()
            ->assertJsonPath('code', 'too_many_requests')
            ->assertHeader('Retry-After');

        $this->assertIsInt($response->json('meta.retry_after'));
    }

    public function test_health_only_answers_to_loopback(): void
    {
        $this->getJson('/api/health')->assertOk();
        $this->withServerVariables(['REMOTE_ADDR' => '::1'])->getJson('/api/health')->assertOk();

        // El bridge de Docker, la LAN o internet: para ellos la ruta no existe.
        foreach (['172.18.0.1', '192.168.1.20', '8.8.8.8'] as $address) {
            $this->withServerVariables(['REMOTE_ADDR' => $address])
                ->getJson('/api/health')
                ->assertNotFound()
                ->assertJsonPath('code', 'not_found')
                ->assertJsonPath('data', null);
        }
    }

    public function test_health_rejects_proxied_requests_even_from_loopback(): void
    {
        // Un proxy inverso en el mismo host se conecta desde 127.0.0.1; lo que
        // lo delata es que reenvía headers.
        foreach (['X-Forwarded-For' => '127.0.0.1', 'Forwarded' => 'for=127.0.0.1', 'X-Real-IP' => '127.0.0.1'] as $header => $value) {
            $this->getJson('/api/health', [$header => $value])->assertNotFound();
        }
    }

    public function test_laravel_default_up_route_is_gone(): void
    {
        $this->get('/up')->assertNotFound();
    }
}
