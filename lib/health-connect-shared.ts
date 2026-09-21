export type HealthConnectSnapshot =
  | { kind: 'unavailable'; message: string }
  | { kind: 'disconnected' }
  | { kind: 'denied'; message: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'connected';
      steps: number;
      distanceKm: number;
      activeCaloriesKcal: number;
    };

export const HEALTH_CONNECT_PERMISSION_DENIED_MESSAGE =
  'Health Connect permission is required to import steps, distance, and active calories. Try again, or open Health Connect settings to grant access.';

export const HEALTH_CONNECT_UNAVAILABLE_ANDROID_MESSAGE =
  'Health Connect is not available on this device.';

export const HEALTH_CONNECT_UNAVAILABLE_WEB_MESSAGE =
  'Health Connect is only available on Android.';

export function formatSteps(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function formatDistanceKm(value: number): string {
  return `${value.toFixed(1)} km`;
}

export function formatActiveCalories(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} kcal`;
}
