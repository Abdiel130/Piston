<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class Vehicle extends Model
{
    use SyncsOffline;

    protected $table = 'vehicles';

    protected $guarded = ['rev'];
}
