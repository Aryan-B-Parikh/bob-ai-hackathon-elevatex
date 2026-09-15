/**
 * PortFlow SBX — Map Configuration
 * Geographic bounds, operational coordinates, and restrained congestion thresholds.
 */

export const MAP_CONFIG = {
  // San Pedro Bay Geography & Terminals Center (POLB & POLA)
  center: [-118.21, 33.745] as [number, number],
  defaultZoom: 12.2,
  minZoom: 10,
  maxZoom: 17,

  // Geographical bounds constraint around San Pedro Bay to keep operators focused
  maxBounds: [
    [-118.45, 33.60], // Southwest coordinate
    [-117.95, 33.88], // Northeast coordinate
  ] as [[number, number], [number, number]],

  // Restrained 4-Tier Semantic Congestion Thresholds (Phase 2.5)
  thresholds: {
    low: {
      max: 40,
      label: "Low (Nominal)",
      color: "#2F6F86", // Muted steel/ocean blue
      bgLight: "#E8F1F5",
      bgDark: "rgba(47, 111, 134, 0.20)",
    },
    moderate: {
      max: 60,
      label: "Elevated",
      color: "#B7791F", // Muted amber
      bgLight: "#FBF3E3",
      bgDark: "rgba(183, 121, 31, 0.20)",
    },
    high: {
      max: 80,
      label: "High",
      color: "#C26E4A", // Warm terracotta
      bgLight: "rgba(194, 110, 74, 0.15)",
      bgDark: "rgba(194, 110, 74, 0.22)",
    },
    critical: {
      max: 100,
      label: "Critical (Severe)",
      color: "#B94A48", // Muted red
      bgLight: "#F9E9E8",
      bgDark: "rgba(185, 74, 72, 0.24)",
    },
  },

  // Navigation Fairways & Anchorage Queues
  fairwayLine: {
    color: "#3B6F8F",
    dashArray: [3, 3],
  },
};
