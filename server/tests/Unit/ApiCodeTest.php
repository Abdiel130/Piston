<?php

namespace Tests\Unit;

use App\Http\Responses\ApiCode;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class ApiCodeTest extends TestCase
{
    /** @return iterable<string, array{ApiCode}> */
    public static function codes(): iterable
    {
        foreach (ApiCode::cases() as $code) {
            yield $code->value => [$code];
        }
    }

    #[DataProvider('codes')]
    public function test_every_code_has_a_valid_status_and_a_message(ApiCode $code): void
    {
        $this->assertGreaterThanOrEqual(200, $code->status());
        $this->assertLessThan(600, $code->status());
        $this->assertNotSame('', $code->message());
        $this->assertSame($code->status() < 400, $code->isSuccess());
    }

    public function test_status_maps_back_to_a_generic_code(): void
    {
        $this->assertSame(ApiCode::NotFound, ApiCode::fromStatus(404));
        $this->assertSame(ApiCode::ServerError, ApiCode::fromStatus(502));
        $this->assertSame(ApiCode::BadRequest, ApiCode::fromStatus(418));
        $this->assertSame(ApiCode::Ok, ApiCode::fromStatus(200));
    }
}
