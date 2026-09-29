<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class MaintenanceSchedule extends Model
{
    use SyncsOffline;

    protected $table = 'maintenance_schedules';

    protected $guarded = ['rev'];
}
