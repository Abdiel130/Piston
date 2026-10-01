<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class ServiceRecord extends Model
{
    use SyncsOffline;

    protected $table = 'service_records';

    protected $guarded = ['rev'];
}
