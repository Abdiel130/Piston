import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';

export interface BackendHealthResponse {
  status: string;
  project: string;
  version: string;
  laravel_version: string;
  php_version: string;
  database: {
    status: string;
    driver: string;
    error: string | null;
  };
  timestamp: string;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:8088/api';

  checkHealth(): Observable<BackendHealthResponse | null> {
    return this.http.get<BackendHealthResponse>(`${this.apiUrl}/health`).pipe(
      catchError((error) => {
        console.warn('Backend API connection check failed:', error);
        return of(null);
      })
    );
  }
}
