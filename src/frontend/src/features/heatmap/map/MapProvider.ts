/**
 * PortFlow SBX — MapProvider Abstraction
 * 
 * Provides an isolated, keyless map source for hackathon and local demo use.
 * Does NOT require user registration, tokens, or external API keys.
 * Can be replaced in production with enterprise providers (e.g. MapTiler, self-hosted, PMTiles).
 */

export interface MapTileSourceConfig {
  id: string;
  name: string;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
  minZoom: number;
  tileSize: number;
}

export interface MapProvider {
  id: string;
  name: string;
  getTileSource: (theme: "dark" | "light") => MapTileSourceConfig;
  getAttribution: () => string;
}

/**
 * Standard Keyless OpenStreetMap Raster Provider
 * Complies with OSM tile usage policy for hackathon development & demo
 */
export const OpenStreetMapProvider: MapProvider = {
  id: "osm",
  name: "OpenStreetMap (Standard Keyless)",
  getTileSource: (theme: "dark" | "light") => {
    return {
      id: "osm-raster-source",
      name: "OpenStreetMap",
      tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noreferrer\">OpenStreetMap</a> contributors",
      maxZoom: 19,
      minZoom: 0,
      tileSize: 256,
    };
  },
  getAttribution: () => "&copy; OpenStreetMap contributors",
};

/**
 * Carto Raster Provider (Alternative Keyless Maritime Base)
 */
export const CartoMaritimeProvider: MapProvider = {
  id: "carto",
  name: "CARTO Maritime Cartography",
  getTileSource: (theme: "dark" | "light") => {
    const baseUrl =
      theme === "dark"
        ? "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
        : "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

    return {
      id: "carto-raster-source",
      name: "CARTO Basemaps",
      tileUrl: baseUrl,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noreferrer\">OpenStreetMap</a> contributors &copy; <a href=\"https://carto.com/attributions\" target=\"_blank\" rel=\"noreferrer\">CARTO</a>",
      maxZoom: 19,
      minZoom: 0,
      tileSize: 256,
    };
  },
  getAttribution: () => "&copy; OpenStreetMap contributors &copy; CARTO",
};

/**
 * Active default map provider for PortFlow SBX
 * CARTO maritime provides distinct muted dark and clean light styles without an API key.
 * If network fails, the map canvas renders a graceful offline navigational grid.
 */
export const defaultMapProvider: MapProvider = CartoMaritimeProvider;
