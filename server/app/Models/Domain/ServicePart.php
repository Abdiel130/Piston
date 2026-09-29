<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class ServicePart extends Model
{
    use SyncsOffline;

    protected $table = 'service_parts';

    protected $guarded = ['rev'];
}
