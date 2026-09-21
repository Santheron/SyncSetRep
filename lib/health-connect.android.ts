import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import type { Permission, RecordResult, RecordType } from 'react-native-health-connect';

type TimeRangeFilter = {
  operator: 'between';
  startTime: string;
  endTime: string;
};

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
  HEALTH_CONNECT_PERMISSION_DENIED_MESSAGE,
  HEALTH_CONNECT_UNAVAILABLE_ANDROID_MESSAGE,
  type HealthConnectSnapshot,
} from '@/lib/health-connect-shared';

export const canOpenHealthConnectSettings = true;

const READ_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'Distance' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
];

const REQUIRED_RECORD_TYPES = ['Steps', 'Distance', 'ActiveCaloriesBurned'] as const;

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function hasRequiredReadPermissions(
  granted: readonly { accessType?: string; recordType?: string }[],
): boolean {
  return REQUIRED_RECORD_TYPES.every((recordType) =>
    granted.some(
      (permission) => permission.accessType === 'read' && permission.recordType === recordType,
    ),
  );
}

function todayTimeRangeFilter(): TimeRangeFilter {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    operator: 'between',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

async function readAllRecords<T extends RecordType>(
  recordType: T,
  timeRangeFilter: TimeRangeFilter,
): Promise<RecordResult<T>[]> {
  const records: RecordResult<T>[] = [];
  let pageToken: string | undefined;

  do {
    const page = await readRecords(recordType, {
      timeRangeFilter,
      pageSize: 1000,
      pageToken,
    });
    records.push(...page.records);
    pageToken = page.pageToken;
  } while (pageToken);

  return records;
}

async function ensureAvailable(): Promise<HealthConnectSnapshot | { kind: 'available' }> {
  try {
    const initialized = await initialize();
    const status = await getSdkStatus();

    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE) {
      return {
        kind: 'unavailable',
        message: HEALTH_CONNECT_UNAVAILABLE_ANDROID_MESSAGE,
      };
    }

    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
      return {
        kind: 'unavailable',
        message:
          'Health Connect needs to be installed or updated on this phone before it can be used.',
      };
    }

    if (!initialized || status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
      return {
        kind: 'unavailable',
        message: HEALTH_CONNECT_UNAVAILABLE_ANDROID_MESSAGE,
      };
    }

    return { kind: 'available' };
  } catch (error) {
    return {
      kind: 'unavailable',
      message: toErrorMessage(error, HEALTH_CONNECT_UNAVAILABLE_ANDROID_MESSAGE),
    };
  }
}

async function readTodayTotals(): Promise<HealthConnectSnapshot> {
  try {
    const timeRangeFilter = todayTimeRangeFilter();
    const [stepRecords, distanceRecords, calorieRecords] = await Promise.all([
      readAllRecords('Steps', timeRangeFilter),
      readAllRecords('Distance', timeRangeFilter),
      readAllRecords('ActiveCaloriesBurned', timeRangeFilter),
    ]);

    const steps = stepRecords.reduce((total, record) => total + (record.count ?? 0), 0);
    const distanceKm = distanceRecords.reduce((total, record) => {
      const kilometers = record.distance?.inKilometers;
      if (typeof kilometers === 'number' && Number.isFinite(kilometers)) {
        return total + kilometers;
      }

      const meters = record.distance?.inMeters;
      if (typeof meters === 'number' && Number.isFinite(meters)) {
        return total + meters / 1000;
      }

      return total;
    }, 0);
    const activeCaloriesKcal = calorieRecords.reduce((total, record) => {
      const kilocalories = record.energy?.inKilocalories;
      if (typeof kilocalories === 'number' && Number.isFinite(kilocalories)) {
        return total + kilocalories;
      }

      const calories = record.energy?.inCalories;
      if (typeof calories === 'number' && Number.isFinite(calories)) {
        return total + calories / 1000;
      }

      return total;
    }, 0);

    return {
      kind: 'connected',
      steps,
      distanceKm,
      activeCaloriesKcal,
    };
  } catch (error) {
    return {
      kind: 'error',
      message: toErrorMessage(
        error,
        'Could not read today\'s Health Connect data. Try Sync Now, or grant permission in Health Connect settings.',
      ),
    };
  }
}

export async function loadHealthConnectSnapshot(): Promise<HealthConnectSnapshot> {
  const availability = await ensureAvailable();

  if (availability.kind !== 'available') {
    return availability;
  }

  try {
    const granted = await getGrantedPermissions();

    if (!hasRequiredReadPermissions(granted)) {
      return { kind: 'disconnected' };
    }

    return readTodayTotals();
  } catch (error) {
    return {
      kind: 'unavailable',
      message: toErrorMessage(error, HEALTH_CONNECT_UNAVAILABLE_ANDROID_MESSAGE),
    };
  }
}

export async function connectHealthConnect(): Promise<HealthConnectSnapshot> {
  const availability = await ensureAvailable();

  if (availability.kind !== 'available') {
    return availability;
  }

  try {
    const granted = await requestPermission(READ_PERMISSIONS);

    if (!hasRequiredReadPermissions(granted)) {
      return {
        kind: 'denied',
        message: HEALTH_CONNECT_PERMISSION_DENIED_MESSAGE,
      };
    }

    return readTodayTotals();
  } catch (error) {
    return {
      kind: 'denied',
      message: toErrorMessage(error, HEALTH_CONNECT_PERMISSION_DENIED_MESSAGE),
    };
  }
}

export async function syncHealthConnect(): Promise<HealthConnectSnapshot> {
  return loadHealthConnectSnapshot();
}

export function openHealthConnectPermissionSettings(): boolean {
  try {
    openHealthConnectSettings();
    return true;
  } catch {
    return false;
  }
}
