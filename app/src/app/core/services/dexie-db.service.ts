import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { Vehicle, FuelLog, MaintenanceItem, GasStationPrice } from '../models/vehicle.model';

@Injectable({
  providedIn: 'root'
})
export class DexieDbService extends Dexie {
  vehicles!: Table<Vehicle, number>;
  fuelLogs!: Table<FuelLog, number>;
  maintenanceLogs!: Table<MaintenanceItem, number>;
  gasStations!: Table<GasStationPrice, number>;

  constructor() {
    super('piston_local_db');

    // Define schema version 1
    this.version(1).stores({
      vehicles: '++id, make, model, year',
      fuelLogs: '++id, vehicleId, date, odometer',
      maintenanceLogs: '++id, vehicleId, category, nextDueKm',
      gasStations: '++id, brand, stationName'
    });

    this.on('populate', () => this.seedInitialData());
    this.open().then(() => this.ensureDataSeeded());
  }

  private async ensureDataSeeded(): Promise<void> {
    const vehicleCount = await this.vehicles.count();
    if (vehicleCount === 0) {
      await this.seedInitialData();
    }
  }

  private async seedInitialData(): Promise<void> {
    const vehicleId = await this.vehicles.add({
      make: 'Mazda',
      model: '3 Sedan Turbo',
      year: 2022,
      fuelType: 'Gasolina Premium',
      tankCapacityLiters: 51,
      totalGaugeSegments: 8, // 8 rayitas
      currentOdometer: 48650,
      licensePlate: 'PST-9421',
      notes: 'Uso personal diario, combustible recomendado 91+ octanos.'
    });

    await this.fuelLogs.bulkAdd([
      {
        vehicleId,
        date: '2026-09-02',
        odometer: 48200,
        startSegments: 2, // 2 rayitas (1/4 de tanque aprox 12.75 Lts)
        endSegments: 6,   // subió a 6 rayitas tras recarga de $600
        totalSegments: 8,
        tankCapacityLiters: 51,
        amountPaid: 600,
        pricePerLiter: 24.10,
        litersCalculated: 24.89,
        estimatedRemainingBefore: 12.75,
        estimatedRemainingAfter: 37.64,
        distanceTraveled: 420,
        estimatedKmPerLiter: 12.8,
        gasStationName: 'Mobil Blvd. Universidad',
        city: 'Mi Ciudad'
      },
      {
        vehicleId,
        date: '2026-09-08',
        odometer: 48650,
        startSegments: 2, // 2 rayitas
        endSegments: 8,   // Lleno
        totalSegments: 8,
        tankCapacityLiters: 51,
        amountPaid: 920,
        pricePerLiter: 23.95,
        litersCalculated: 38.41,
        estimatedRemainingBefore: 12.75,
        estimatedRemainingAfter: 51.0,
        distanceTraveled: 450,
        estimatedKmPerLiter: 13.1,
        gasStationName: 'Shell Constitución',
        city: 'Mi Ciudad'
      }
    ]);

    await this.maintenanceLogs.bulkAdd([
      {
        vehicleId,
        title: 'Aceite 5W-30 Full Sintético & Filtro OEM',
        category: 'Aceite y Filtros',
        cost: 1450,
        date: '2026-06-15',
        odometer: 41000,
        nextDueKm: 51000,
        status: 'optimal',
        notes: 'Filtro de aceite original Mazda y 4.8 cuartos de aceite sintético.'
      },
      {
        vehicleId,
        title: 'Filtro de Aire Motor y Filtro Antipolen Cabina',
        category: 'Aceite y Filtros',
        cost: 680,
        date: '2026-05-10',
        odometer: 40000,
        nextDueKm: 50000,
        status: 'warning',
        notes: 'Revisar estado de suciedad en próxima recarga.'
      },
      {
        vehicleId,
        title: 'Balatas Cerámicas Delanteras & Rectificado de Discos',
        category: 'Frenos',
        cost: 2100,
        date: '2026-03-20',
        odometer: 36500,
        nextDueKm: 65000,
        status: 'optimal',
        notes: 'Buen espesor de pastillas, sin chillidos.'
      }
    ]);

    await this.gasStations.bulkAdd([
      {
        stationName: 'Mobil Blvd. Universidad',
        brand: 'Mobil',
        address: 'Av. Universidad #1040',
        regularPrice: 23.49,
        premiumPrice: 24.10,
        dieselPrice: 24.80,
        lastUpdated: 'Hace 18 minutos',
        reportedByUser: 'Abdiel',
        distanceKm: 1.8
      },
      {
        stationName: 'Shell Constitución',
        brand: 'Shell',
        address: 'Blvd. de la Constitución #402',
        regularPrice: 23.65,
        premiumPrice: 23.95,
        dieselPrice: 24.90,
        lastUpdated: 'Hace 45 minutos',
        reportedByUser: 'Carlos M.',
        distanceKm: 2.4
      },
      {
        stationName: 'Pemex Servicio Central',
        brand: 'Pemex',
        address: 'Calle Hidalgo y 5 de Mayo',
        regularPrice: 23.35,
        premiumPrice: 24.45,
        dieselPrice: 24.75,
        lastUpdated: 'Hace 2 horas (Corregido)',
        reportedByUser: 'Elena R.',
        distanceKm: 3.1
      }
    ]);
  }
}
