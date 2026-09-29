<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class Reminder extends Model
{
    use SyncsOffline;

    protected $table = 'reminders';

    protected $guarded = ['rev'];
}
