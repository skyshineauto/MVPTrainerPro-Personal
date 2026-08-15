import { supabase } from "./supabase";

const BRANDING_BUCKET = "app-assets";
const META_KEY = "mvp_trainer_ui";
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_SECONDS = 24 * 60 * 60;

export const APP_BRANDING_CHANGED_EVENT = "mvp:app-branding-weather-changed";

export type WeatherIconKind =
  | "clear"
  | "partly_cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm";

export type WeatherLocation = {
  id: number | null;
  query: string;
  city: string;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  displayName: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type AppBrandingWeatherSettings = {
  headerLogoPath: string | null;
  headerLogoName: string | null;
  weatherLocation: WeatherLocation | null;
};

export type CurrentWeatherSnapshot = {
  apparentTemperatureF: number;
  weatherCode: number;
  condition: string;
  icon: WeatherIconKind;
  isDay: boolean;
  timezone: string;
  fetchedAt: number;
};

type OpenMeteoGeoResult = {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  country?: string;
  country_code?: string;
  admin1?: string;
};

type OpenMeteoGeocodingResponse = {
  results?: OpenMeteoGeoResult[];
  error?: boolean;
  reason?: string;
};

type OpenMeteoWeatherResponse = {
  timezone?: string;
  current?: {
    apparent_temperature?: number;
    weather_code?: number;
    is_day?: number;
  };
  error?: boolean;
  reason?: string;
};

const US_STATE_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA",
  Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
  Wyoming: "WY", "District of Columbia": "DC",
};

function defaultSettings(): AppBrandingWeatherSettings {
  return {
    headerLogoPath: null,
    headerLogoName: null,
    weatherLocation: null,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeLocation(value: any): WeatherLocation | null {
  if (!value || typeof value !== "object") return null;
  if (!isFiniteNumber(Number(value.latitude)) || !isFiniteNumber(Number(value.longitude))) return null;
  const city = String(value.city || "").trim();
  const displayName = String(value.displayName || city).trim();
  const timezone = String(value.timezone || "UTC").trim() || "UTC";
  if (!city || !displayName) return null;

  return {
    id: value.id != null && Number.isFinite(Number(value.id)) ? Number(value.id) : null,
    query: String(value.query || displayName),
    city,
    region: value.region != null ? String(value.region) : null,
    country: value.country != null ? String(value.country) : null,
    countryCode: value.countryCode != null ? String(value.countryCode) : null,
    displayName,
    latitude: Number(value.latitude),
    longitude: Number(value.longitude),
    timezone,
  };
}

function normalizeSettings(value: any): AppBrandingWeatherSettings {
  const fallback = defaultSettings();
  if (!value || typeof value !== "object") return fallback;
  return {
    headerLogoPath:
      typeof value.headerLogoPath === "string" && value.headerLogoPath.trim()
        ? value.headerLogoPath.trim()
        : null,
    headerLogoName:
      typeof value.headerLogoName === "string" && value.headerLogoName.trim()
        ? value.headerLogoName.trim()
        : null,
    weatherLocation: normalizeLocation(value.weatherLocation),
  };
}

async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before changing app branding or weather settings.");
  return data.user;
}

async function writeSettings(
  nextSettings: AppBrandingWeatherSettings
): Promise<AppBrandingWeatherSettings> {
  const user = await currentUser();
  const metadata = user.user_metadata && typeof user.user_metadata === "object"
    ? user.user_metadata
    : {};

  const { error } = await supabase.auth.updateUser({
    data: {
      ...metadata,
      [META_KEY]: nextSettings,
    },
  });

  if (error) throw error;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(APP_BRANDING_CHANGED_EVENT));
  }
  return nextSettings;
}

export async function getAppBrandingWeatherSettings(): Promise<AppBrandingWeatherSettings> {
  const user = await currentUser();
  return normalizeSettings(user.user_metadata?.[META_KEY]);
}

export async function getHeaderLogoSignedUrl(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage
    .from(BRANDING_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data?.signedUrl || null;
}

function logoExtension(file: File) {
  const lower = file.name.toLowerCase();
  if (file.type === "image/webp" || lower.endsWith(".webp")) return "webp";
  if (file.type === "image/png" || lower.endsWith(".png")) return "png";
  return "";
}

function validateLogo(file: File) {
  const extension = logoExtension(file);
  if (!extension) throw new Error("Use a transparent PNG or WebP logo.");
  if (!(file.size > 0)) throw new Error("The selected logo file is empty.");
  if (file.size > MAX_LOGO_BYTES) throw new Error("Header logos must be 5 MB or smaller.");
  return extension;
}

export async function uploadHeaderLogo(file: File): Promise<AppBrandingWeatherSettings> {
  const extension = validateLogo(file);
  const user = await currentUser();
  const current = normalizeSettings(user.user_metadata?.[META_KEY]);
  const nextPath = `${user.id}/branding/header-logo-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BRANDING_BUCKET)
    .upload(nextPath, file, {
      cacheControl: "3600",
      contentType: extension === "webp" ? "image/webp" : "image/png",
      upsert: false,
    });

  if (uploadError) throw uploadError;

  try {
    const next = await writeSettings({
      ...current,
      headerLogoPath: nextPath,
      headerLogoName: file.name,
    });

    if (current.headerLogoPath && current.headerLogoPath !== nextPath) {
      const { error: removeError } = await supabase.storage
        .from(BRANDING_BUCKET)
        .remove([current.headerLogoPath]);
      if (removeError) console.warn("Old header logo could not be removed:", removeError);
    }

    return next;
  } catch (error) {
    await supabase.storage.from(BRANDING_BUCKET).remove([nextPath]).catch(() => undefined);
    throw error;
  }
}

export async function resetHeaderLogo(): Promise<AppBrandingWeatherSettings> {
  const current = await getAppBrandingWeatherSettings();
  const oldPath = current.headerLogoPath;
  const next = await writeSettings({
    ...current,
    headerLogoPath: null,
    headerLogoName: null,
  });

  if (oldPath) {
    const { error } = await supabase.storage.from(BRANDING_BUCKET).remove([oldPath]);
    if (error) console.warn("Header logo metadata was reset, but old Storage cleanup failed:", error);
  }

  return next;
}

function compactRegion(region: string | null, countryCode: string | null) {
  if (!region) return "";
  if ((countryCode || "").toUpperCase() === "US") return US_STATE_ABBR[region] || region;
  return region;
}

function geocodingResultToLocation(result: OpenMeteoGeoResult, query: string): WeatherLocation | null {
  const latitude = Number(result.latitude);
  const longitude = Number(result.longitude);
  const city = String(result.name || "").trim();
  if (!city || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const countryCode = result.country_code ? String(result.country_code).toUpperCase() : null;
  const region = result.admin1 ? String(result.admin1) : null;
  const shortRegion = compactRegion(region, countryCode);
  const displayName = shortRegion ? `${city}, ${shortRegion}` : city;

  return {
    id: result.id != null && Number.isFinite(Number(result.id)) ? Number(result.id) : null,
    query,
    city,
    region,
    country: result.country ? String(result.country) : null,
    countryCode,
    displayName,
    latitude,
    longitude,
    timezone: String(result.timezone || "UTC"),
  };
}

export async function searchWeatherLocations(query: string): Promise<WeatherLocation[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) throw new Error("Enter a city, state, or ZIP code.");

  const params = new URLSearchParams({
    name: trimmed,
    count: "6",
    language: "en",
    format: "json",
  });

  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`);
  const body = (await response.json()) as OpenMeteoGeocodingResponse;
  if (!response.ok || body.error) {
    throw new Error(body.reason || "Weather location lookup failed.");
  }

  return (body.results || [])
    .map((result) => geocodingResultToLocation(result, trimmed))
    .filter((result): result is WeatherLocation => Boolean(result));
}

export async function saveWeatherLocation(
  location: WeatherLocation
): Promise<AppBrandingWeatherSettings> {
  const current = await getAppBrandingWeatherSettings();
  return writeSettings({ ...current, weatherLocation: normalizeLocation(location) });
}

export async function clearWeatherLocation(): Promise<AppBrandingWeatherSettings> {
  const current = await getAppBrandingWeatherSettings();
  return writeSettings({ ...current, weatherLocation: null });
}

function weatherCondition(code: number, isDay: boolean): Pick<CurrentWeatherSnapshot, "condition" | "icon"> {
  if (code === 0) return { condition: isDay ? "Sunny" : "Clear", icon: "clear" };
  if (code === 1 || code === 2) return { condition: "Partly Cloudy", icon: "partly_cloudy" };
  if (code === 3) return { condition: "Cloudy", icon: "cloudy" };
  if (code === 45 || code === 48) return { condition: "Fog", icon: "fog" };
  if ([51, 53, 55, 56, 57].includes(code)) return { condition: "Drizzle", icon: "drizzle" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { condition: "Rain", icon: "rain" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { condition: "Snow", icon: "snow" };
  if ([95, 96, 99].includes(code)) return { condition: "Thunderstorm", icon: "storm" };
  return { condition: "Weather", icon: "cloudy" };
}

export async function fetchCurrentWeather(
  location: WeatherLocation
): Promise<CurrentWeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "apparent_temperature,weather_code,is_day",
    temperature_unit: "fahrenheit",
    timezone: "auto",
    forecast_days: "1",
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  const body = (await response.json()) as OpenMeteoWeatherResponse;
  if (!response.ok || body.error) {
    throw new Error(body.reason || "Current weather could not be loaded.");
  }

  const apparentTemperatureF = Number(body.current?.apparent_temperature);
  const weatherCode = Number(body.current?.weather_code);
  const isDay = Number(body.current?.is_day ?? 1) === 1;
  if (!Number.isFinite(apparentTemperatureF) || !Number.isFinite(weatherCode)) {
    throw new Error("Current weather data was incomplete.");
  }

  const condition = weatherCondition(weatherCode, isDay);
  return {
    apparentTemperatureF,
    weatherCode,
    condition: condition.condition,
    icon: condition.icon,
    isDay,
    timezone: String(body.timezone || location.timezone || "UTC"),
    fetchedAt: Date.now(),
  };
}

export function formatWeatherLocalTime(timezone: string, date = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone || "UTC",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  }
}
