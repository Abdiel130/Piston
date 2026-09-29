<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class FuelStation extends Model
{
    use SyncsOffline;

    protected $table = 'fuel_stations';

    protected $guarded = ['rev'];
}
