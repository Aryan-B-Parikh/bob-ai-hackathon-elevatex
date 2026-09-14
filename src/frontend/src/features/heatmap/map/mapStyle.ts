import type { StyleSpecification } from "maplibre-gl";
import { defaultMapProvider } from "./MapProvider";

/**
 * PortFlow SBX — Map Style Generator
 * Generates restrained, theme-responsive MapLibre style specifications.
 * Works 100% locally and offline without requiring user API keys.
 */
export function createMaritimeMapStyle(theme: "dark" | "light"): StyleSpecification {
  const tileSource = defaultMapProvider.getTileSource(theme);

  const isDark = theme === "dark";

  return {
    version: 8,
    name: isDark ? "PortFlow SBX Dark Maritime" : "PortFlow SBX Light Maritime",
    sources: {
      [tileSource.id]: {
        type: "raster",
        tiles: [tileSource.tileUrl],
        tileSize: tileSource.tileSize,
        attribution: tileSource.attribution,
        maxzoom: tileSource.maxZoom,
        minzoom: tileSource.minZoom,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          // Dark: near-black charcoal (#090D10). Light: soft slate grey (#EAEFF2)
          "background-color": isDark ? "#090D10" : "#EAEFF2",
        },
      },
      {
        id: "maritime-base-raster",
        type: "raster",
        source: tileSource.id,
        minzoom: 0,
        maxzoom: 19,
        paint: isDark
          ? {
              // Charcoal / Near-black cartography: muted contrast, desaturated
              "raster-opacity": 0.85,
              "raster-brightness-min": 0.04,
              "raster-brightness-max": 0.76,
              "raster-contrast": 0.18,
              "raster-saturation": -0.35,
            }
          : {
              // Clean enterprise light cartography: soft grey land, muted water
              "raster-opacity": 0.88,
              "raster-brightness-min": 0.06,
              "raster-brightness-max": 0.96,
              "raster-contrast": -0.04,
              "raster-saturation": -0.25,
            },
      },
    ],
  };
}
