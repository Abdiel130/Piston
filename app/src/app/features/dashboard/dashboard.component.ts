import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DexieDbService } from '../../core/services/dexie-db.service';
import { ApiService, BackendHealthResponse } from '../../core/services/api.service';
import { Vehicle, FuelLog, MaintenanceItem, GasStationPrice } from '../../core/models/vehicle.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  private dexieDb = inject(DexieDbService);
  private apiService = inject(ApiService);

  // Backend Health State
  backendHealth = signal<BackendHealthResponse | null>(null);
  isBackendChecking = signal<boolean>(true);

  // Vehicle & Data Signals
  activeVehicle = signal<Vehicle | null>(null);
  fuelLogs = signal<FuelLog[]>([]);
  maintenanceItems = signal<MaintenanceItem[]>([]);
  gasStations = signal<GasStationPrice[]>([]);
  isOfflineActive = signal<boolean>(true);

  // Interactive Fuel Gauge Simulator Inputs
  tankCapacity = signal<number>(51);
  totalSegments = signal<number>(8); // 8 rayitas
  startSegments = signal<number>(2); // 2 rayitas iniciales
  amountPaid = signal<number>(600);
  pricePerLiter = signal<number>(24.10);
  tripDistance = signal<number>(310);
  odometerReading = signal<number>(48960);
  selectedStation = signal<string>('Mobil Blvd. Universidad');

  // Computed Values for Fuel Calculation
  calculatedLiters = computed(() => {
    const price = this.pricePerLiter();
    const paid = this.amountPaid();
    return price > 0 ? parseFloat((paid / price).toFixed(2)) : 0;
  });

  initialLitersEstimated = computed(() => {
    const capacity = this.tankCapacity();
    const segments = this.startSegments();
    const total = this.totalSegments();
    return total > 0 ? parseFloat(((segments / total) * capacity).toFixed(2)) : 0;
  });

  finalLitersEstimated = computed(() => {
    const initial = this.initialLitersEstimated();
    const added = this.calculatedLiters();
    const capacity = this.tankCapacity();
    const total = initial + added;
    return parseFloat(Math.min(total, capacity).toFixed(2));
  });

  finalSegmentsEstimated = computed(() => {
    const finalLiters = this.finalLitersEstimated();
    const capacity = this.tankCapacity();
    const totalSegments = this.totalSegments();
    if (capacity <= 0) return 0;
    const ratio = finalLiters / capacity;
    return Math.min(totalSegments, Math.round(ratio * totalSegments));
  });

  estimatedEfficiency = computed(() => {
    const distance = this.tripDistance();
    const liters = this.calculatedLiters();
    return liters > 0 ? parseFloat((distance / liters).toFixed(2)) : 0;
  });

  costPerKm = computed(() => {
    const distance = this.tripDistance();
    const paid = this.amountPaid();
    return distance > 0 ? parseFloat((paid / distance).toFixed(2)) : 0;
  });

  // Segments array for rendering fuel bars
  gaugeSegments = computed(() => {
    const total = this.totalSegments();
    return Array.from({ length: total }, (_, i) => i + 1);
  });

  async ngOnInit(): Promise<void> {
    await this.loadLocalData();
    this.checkBackend();
  }

  async loadLocalData(): Promise<void> {
    try {
      const vehicles = await this.dexieDb.vehicles.toArray();
      if (vehicles.length > 0) {
        this.activeVehicle.set(vehicles[0]);
        this.tankCapacity.set(vehicles[0].tankCapacityLiters);
      }

      const logs = await this.dexieDb.fuelLogs.reverse().limit(5).toArray();
      this.fuelLogs.set(logs);

      const items = await this.dexieDb.maintenanceLogs.toArray();
      this.maintenanceItems.set(items);

      const stations = await this.dexieDb.gasStations.toArray();
      this.gasStations.set(stations);
    } catch (err) {
      console.error('Error loading Dexie data:', err);
    }
  }

  checkBackend(): void {
    this.isBackendChecking.set(true);
    this.apiService.checkHealth().subscribe((health) => {
      this.backendHealth.set(health);
      this.isBackendChecking.set(false);
    });
  }

  setStartSegments(level: number): void {
    this.startSegments.set(level);
  }

  async recordFuelEntry(): Promise<void> {
    const vehicle = this.activeVehicle();
    const newEntry: FuelLog = {
      vehicleId: vehicle?.id || 1,
      date: new Date().toISOString().split('T')[0],
      odometer: this.odometerReading(),
      startSegments: this.startSegments(),
      endSegments: this.finalSegmentsEstimated(),
      totalSegments: this.totalSegments(),
      tankCapacityLiters: this.tankCapacity(),
      amountPaid: this.amountPaid(),
      pricePerLiter: this.pricePerLiter(),
      litersCalculated: this.calculatedLiters(),
      estimatedRemainingBefore: this.initialLitersEstimated(),
      estimatedRemainingAfter: this.finalLitersEstimated(),
      distanceTraveled: this.tripDistance(),
      estimatedKmPerLiter: this.estimatedEfficiency(),
      gasStationName: this.selectedStation(),
      city: 'Mi Ciudad'
    };

    // Save directly to IndexedDB via Dexie.js!
    await this.dexieDb.fuelLogs.add(newEntry);
    await this.loadLocalData();

    // Increment odometer slightly for convenience
    this.odometerReading.update((curr) => curr + this.tripDistance());
  }

  getHealthStatusColor(status: 'optimal' | 'warning' | 'urgent'): string {
    switch (status) {
      case 'optimal': return 'var(--color-success)';
      case 'warning': return 'var(--color-warning)';
      case 'urgent': return 'var(--color-danger)';
    }
  }
}
