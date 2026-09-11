export interface Vehicle {
  id?: number;
  make: string;
  model: string;
  year: number;
  fuelType: 'Gasolina Regular' | 'Gasolina Premium' | 'Diésel' | 'Híbrido';
  tankCapacityLiters: number;
  totalGaugeSegments: number; // e.g. 8 rayitas (octavos) o 16
  currentOdometer: number;
  licensePlate?: string;
  notes?: string;
}

export interface FuelLog {
  id?: number;
  vehicleId: number;
  date: string;
  odometer: number;
  startSegments: number; // Rayitas antes de cargar
  endSegments: number;   // Rayitas después de cargar
  totalSegments: number; // Capacidad en rayitas (ej. 8)
  tankCapacityLiters: number;
  amountPaid: number;    // Monto pagado en $
  pricePerLiter: number; // Precio por litro $
  litersCalculated: number; // Litros derivados del monto / precio
  estimatedRemainingBefore: number; // Litros aproximados según rayitas iniciales
  estimatedRemainingAfter: number;  // Litros aproximados tras carga
  distanceTraveled?: number;        // Distancia recorrida desde última carga
  estimatedKmPerLiter?: number;     // Rendimiento km/L estimado sin tanque lleno
  gasStationName?: string;
  city?: string;
}

export interface MaintenanceItem {
  id?: number;
  vehicleId: number;
  title: string;
  category: 'Aceite y Filtros' | 'Frenos' | 'Suspensión' | 'Neumáticos' | 'Motor' | 'General';
  cost: number;
  date: string;
  odometer: number;
  nextDueKm: number;
  status: 'optimal' | 'warning' | 'urgent';
  notes?: string;
}

export interface GasStationPrice {
  id?: number;
  stationName: string;
  brand: string;
  address: string;
  regularPrice: number;
  premiumPrice: number;
  dieselPrice: number;
  lastUpdated: string;
  reportedByUser: string;
  distanceKm: number;
}
