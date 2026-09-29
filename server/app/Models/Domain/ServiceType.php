<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class ServiceType extends Model
{
    use SyncsOffline;

    protected $table = 'service_types';

    protected $guarded = ['rev'];
}
