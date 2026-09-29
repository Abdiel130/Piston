<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class ExpenseCategory extends Model
{
    use SyncsOffline;

    protected $table = 'expense_categories';

    protected $guarded = ['rev'];
}
