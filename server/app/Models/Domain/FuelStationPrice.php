<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class FuelStationPrice extends Model
{
    use SyncsOffline;

    protected $table = 'fuel_station_prices';

    protected $guarded = ['rev'];
}
