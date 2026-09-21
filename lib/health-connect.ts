export {
  HEALTH_CONNECT_PERMISSION_DENIED_MESSAGE,
  HEALTH_CONNECT_UNAVAILABLE_ANDROID_MESSAGE,
  HEALTH_CONNECT_UNAVAILABLE_WEB_MESSAGE,
  formatActiveCalories,
  formatDistanceKm,
  formatSteps,
  type HealthConnectSnapshot,
} from '@/lib/health-connect-shared';

import {
  HEALTH_CONNECT_UNAVAILABLE_WEB_MESSAGE,
  type HealthConnectSnapshot,
} from '@/lib/health-connect-shared';

export const canOpenHealthConnectSettings = false;

export async function loadHealthConnectSnapshot(): Promise<HealthConnectSnapshot> {
  return {
    kind: 'unavailable',
    message: HEALTH_CONNECT_UNAVAILABLE_WEB_MESSAGE,
  };
}

export async function connectHealthConnect(): Promise<HealthConnectSnapshot> {
  return loadHealthConnectSnapshot();
}

export async function syncHealthConnect(): Promise<HealthConnectSnapshot> {
  return loadHealthConnectSnapshot();
}

export function openHealthConnectPermissionSettings(): boolean {
  return false;
}
