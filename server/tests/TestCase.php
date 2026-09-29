<?php

namespace Tests;

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    /**
     * Seguro contra vaciar la base de desarrollo.
     *
     * RefreshDatabase hace migrate:fresh. Si una variable del contenedor le gana
     * a phpunit.xml (ya pasó), los tests apuntarían a `piston` y la borrarían
     * sin avisar. Se comprueba aquí, antes de que corra ningún trait.
     */
    public function createApplication(): Application
    {
        $app = parent::createApplication();

        $connection = $app['config']->get('database.default');
        $database = $app['config']->get("database.connections.{$connection}.database");

        if ($database !== 'piston_test') {
            throw new RuntimeException(
                "Los tests se niegan a correr contra la base [{$database}]: solo usan piston_test.",
            );
        }

        return $app;
    }
}
