<?php

namespace App\Models\Domain;

use App\Models\Concerns\SyncsOffline;
use Illuminate\Database\Eloquent\Model;

class VehicleAlbum extends Model
{
    use SyncsOffline;

    protected $table = 'vehicle_albums';

    protected $guarded = ['rev'];
}
