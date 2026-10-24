/**
 * Hand-picked destinations around USJ / Subang Jaya.
 * x/z are the same local metre coordinates used by the map data.
 * Home is 27, Jalan Pinggiran USJ 1/18; Nido uses the Google Maps pin.
 */
export const DESTINATIONS = [
  {
    id: 'home',
    name: 'Home',
    sub: '27, Jalan Pinggiran USJ 1/18',
    icon: '🏠',
    x: 0,
    z: 0,
    color: '#e8a23a',
  },
  {
    id: 'nido',
    name: 'Nido Child Care',
    sub: 'The Nido Early Learning & Childcare Centre',
    icon: '🧸',
    x: 3154.9,
    z: 1495.8,
    routeX: 3165.3,
    routeZ: 1496,
    arriveRadius: 15,
    color: '#e2557f',
  },
  {
    id: 'playground',
    name: 'USJ 3 Playground',
    sub: 'Taman USJ 3',
    icon: '🌳',
    x: -178.1,
    z: 595.5,
    color: '#45a06b',
  },
  {
    id: 'usj9park',
    name: 'USJ 9 Park',
    sub: 'USJ 9',
    icon: '🌳',
    x: 2794.9,
    z: 886.5,
    color: '#3f8f9e',
  },
  {
    id: 'sunway',
    name: 'Sunway Medical Centre',
    sub: '5, Jalan Lagoon Selatan',
    icon: '🏥',
    x: 5574.9,
    z: -1586.2,
    routeX: 5575.7,
    routeZ: -1549.4,
    arriveRadius: 25,
    color: '#e34b4b',
  },
]
