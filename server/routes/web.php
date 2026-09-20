<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json([
    'project' => 'Piston API',
    'docs' => url('/api/health'),
]));
