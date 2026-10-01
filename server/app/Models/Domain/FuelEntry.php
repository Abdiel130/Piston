<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class FuelEntry extends Model
{
    use SyncsOffline;

    protected $table = 'fuel_entries';

    protected $guarded = ['rev'];
}
