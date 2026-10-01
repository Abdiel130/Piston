<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class Trip extends Model
{
    use SyncsOffline;

    protected $table = 'trips';

    protected $guarded = ['rev'];
}
