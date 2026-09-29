<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class IssueServiceLink extends Model
{
    use SyncsOffline;

    protected $table = 'issue_service_links';

    protected $guarded = ['rev'];
}
