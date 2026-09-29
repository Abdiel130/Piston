<?php

use App\Exceptions\ApiExceptionRenderer;
use App\Http\Middleware\AssignRequestId;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

/** Toda respuesta de la API (y de quien pida JSON) usa el sobre estándar. */
$isApi = fn (Request $request): bool => $request->is('api/*') || $request->expectsJson();

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        // Sin la ruta pública `/up` de Laravel: la salud se consulta en
        // /api/health, que solo responde a localhost.
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Global y al principio: el id tiene que existir antes que cualquier log.
        $middleware->prepend(AssignRequestId::class);
    })
    ->withExceptions(function (Exceptions $exceptions) use ($isApi): void {
        $exceptions->shouldRenderJsonWhen($isApi);

        $exceptions->render(function (Throwable $error, Request $request) use ($isApi) {
            if ($isApi($request)) {
                return app(ApiExceptionRenderer::class)->render($error, $request)->toResponse($request);
            }
        });
    })->create();
