export interface AutocompleteDeviceResult {
  id: string;
  name: string;
  description?: string;
}

interface HomeyZone {
  name?: unknown;
  parent?: unknown;
}

function getZonePath(zoneId: unknown, zones: Record<string, HomeyZone>): string | null {
  if (typeof zoneId !== "string" || zoneId === "") {
    return null;
  }

  const zoneNames: string[] = [];
  let currentZoneId: string | null = zoneId;

  while (currentZoneId) {
    const zone: HomeyZone | undefined = zones[currentZoneId];
    if (!zone || typeof zone.name !== "string") {
      break;
    }

    zoneNames.unshift(zone.name);
    currentZoneId = typeof zone.parent === "string" ? zone.parent : null;
  }

  if (zoneNames[0] === "Home") {
    zoneNames.shift();
  }

  return zoneNames.length > 0 ? zoneNames.join(" / ") : null;
}

export async function autocompleteDevices(
  homeyAPI: any,
  query: string
): Promise<AutocompleteDeviceResult[]> {
  if (!homeyAPI) {
    return [];
  }

  try {
    const [devices, zones] = await Promise.all([
      homeyAPI.devices.getDevices(),
      homeyAPI.zones?.getZones?.().catch(() => ({} as Record<string, HomeyZone>))
        ?? ({} as Record<string, HomeyZone>),
    ]);
    const normalizedQuery = query.trim().toLowerCase();

    return Object.values(devices)
      .filter((device: any) => device?.capabilities?.includes("dim") && device?.class === "light")
      .map((device: any) => {
        const description = getZonePath(device?.zone, zones);
        const deviceName = typeof device?.name === "string" ? device.name : "";
        return {
          id: device?.id,
          name: description ? `${description} / ${deviceName}` : deviceName,
          description: description ?? undefined,
        };
      })
      .filter((device) => Boolean(device.id && device.name))
      .filter((device) => {
        if (normalizedQuery === "") {
          return true;
        }

        return device.name.toLowerCase().includes(normalizedQuery)
          || device.description?.toLowerCase().includes(normalizedQuery);
      })
      .sort((a, b) => {
        const roomCompare = (a.description ?? "").localeCompare(b.description ?? "");
        if (roomCompare !== 0) {
          return roomCompare;
        }

        return a.name.localeCompare(b.name);
      }) as AutocompleteDeviceResult[];
  } catch {
    return [];
  }
}