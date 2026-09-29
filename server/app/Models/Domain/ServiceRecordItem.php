<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class ServiceRecordItem extends Model
{
    use SyncsOffline;

    protected $table = 'service_record_items';

    protected $guarded = ['rev'];
}
