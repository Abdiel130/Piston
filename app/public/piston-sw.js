/*
 * Service worker de Piston.
 *
 * El de Angular (ngsw-worker.js) no admite lógica propia, así que este archivo
 * lo envuelve: primero carga el de Angular (caché y actualizaciones) y después
 * la subida de pendientes en segundo plano.
 */
importScripts('./ngsw-worker.js');
importScripts('./piston-sw-sync.js');
