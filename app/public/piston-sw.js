/*
 * Service worker de Piston.
 *
 * El de Angular (ngsw-worker.js) no admite lógica propia, así que este archivo
 * lo envuelve: primero carga el de Angular (caché y actualizaciones), después
 * la subida de pendientes en segundo plano y las notificaciones de avisos del
 * vehículo (usa el Dexie que carga la subida).
 */
importScripts('./ngsw-worker.js');
importScripts('./piston-sw-sync.js');
importScripts('./piston-sw-alerts.js');
