<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class Expense extends Model
{
    use SyncsOffline;

    protected $table = 'expenses';

    protected $guarded = ['rev'];
}
