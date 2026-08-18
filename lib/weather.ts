// Weather data from Open-Meteo (free, no API key required)
// Uses WMO weather codes: https://open-meteo.com/en/docs

export interface WeatherData {
  temperature: number;       // current °C
  tempMax: number;           // today's high
  tempMin: number;           // today's low
  weatherCode: number;       // WMO code
  windspeed: number;         // km/h
  description: string;
  emoji: string;
}

interface WMOEntry { description: string; emoji: string }

const WMO_CODES: Record<number, WMOEntry> = {
  0:  { description: 'Clear sky',          emoji: '☀️' },
  1:  { description: 'Mainly clear',       emoji: '🌤️' },
  2:  { description: 'Partly cloudy',      emoji: '⛅' },
  3:  { description: 'Overcast',           emoji: '☁️' },
  45: { description: 'Foggy',              emoji: '🌫️' },
  48: { description: 'Icy fog',            emoji: '🌫️' },
  51: { description: 'Light drizzle',      emoji: '🌦️' },
  53: { description: 'Moderate drizzle',   emoji: '🌦️' },
  55: { description: 'Dense drizzle',      emoji: '🌧️' },
  61: { description: 'Slight rain',        emoji: '🌧️' },
  63: { description: 'Moderate rain',      emoji: '🌧️' },
  65: { description: 'Heavy rain',         emoji: '🌧️' },
  71: { description: 'Light snow',         emoji: '🌨️' },
  73: { description: 'Moderate snow',      emoji: '❄️' },
  75: { description: 'Heavy snow',         emoji: '❄️' },
  77: { description: 'Snow grains',        emoji: '🌨️' },
  80: { description: 'Slight showers',     emoji: '🌦️' },
  81: { description: 'Moderate showers',   emoji: '🌧️' },
  82: { description: 'Violent showers',    emoji: '⛈️' },
  85: { description: 'Snow showers',       emoji: '🌨️' },
  86: { description: 'Heavy snow showers', emoji: '❄️' },
  95: { description: 'Thunderstorm',       emoji: '⛈️' },
  96: { description: 'Thunderstorm+hail',  emoji: '⛈️' },
  99: { description: 'Severe thunderstorm',emoji: '⛈️' },
};

export function getWMOInfo(code: number): WMOEntry {
  // Find exact match or nearest lower code
  if (WMO_CODES[code]) return WMO_CODES[code];
  const keys = Object.keys(WMO_CODES).map(Number).sort((a, b) => b - a);
  const nearest = keys.find(k => k <= code);
  return nearest ? WMO_CODES[nearest] : { description: 'Unknown', emoji: '🌡️' };
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current_weather=true` +
    `&daily=temperature_2m_max,temperature_2m_min,weathercode` +
    `&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
  const data = await res.json();

  const code = data.current_weather.weathercode as number;
  const { description, emoji } = getWMOInfo(code);

  return {
    temperature: Math.round(data.current_weather.temperature),
    tempMax:     Math.round(data.daily.temperature_2m_max[0]),
    tempMin:     Math.round(data.daily.temperature_2m_min[0]),
    weatherCode: code,
    windspeed:   Math.round(data.current_weather.windspeed),
    description,
    emoji,
  };
}
