import { getPreferenceValues } from "@raycast/api";

interface Preferences {
  downloadDirectory: string;
  autoSync: boolean;
  showNotifications: boolean;
}

export function getPreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}
