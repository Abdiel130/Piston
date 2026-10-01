<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class OdometerReading extends Model
{
    use SyncsOffline;

    protected $table = 'odometer_readings';

    protected $guarded = ['rev'];
}
