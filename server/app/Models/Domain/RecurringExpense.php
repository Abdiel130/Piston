<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class RecurringExpense extends Model
{
    use SyncsOffline;

    protected $table = 'recurring_expenses';

    protected $guarded = ['rev'];
}
