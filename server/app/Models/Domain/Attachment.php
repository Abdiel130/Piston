<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class Attachment extends Model
{
    use SyncsOffline;

    protected $table = 'attachments';

    protected $guarded = ['rev'];
}
