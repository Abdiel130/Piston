<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class Issue extends Model
{
    use SyncsOffline;

    protected $table = 'issues';

    protected $guarded = ['rev'];
}
