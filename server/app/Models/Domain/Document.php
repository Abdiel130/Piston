<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class Document extends Model
{
    use SyncsOffline;

    protected $table = 'documents';

    protected $guarded = ['rev'];
}
