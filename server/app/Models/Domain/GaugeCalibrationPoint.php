<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class GaugeCalibrationPoint extends Model
{
    use SyncsOffline;

    protected $table = 'gauge_calibration_points';

    protected $guarded = ['rev'];
}
