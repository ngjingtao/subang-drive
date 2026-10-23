#!/usr/bin/env node
/**
 * Build-time map extractor for Subang Drive.
 *
 * Downloads raw OpenStreetMap data around USJ 3 / Subang Jaya and converts it
 * into a compact, game-ready JSON file (metres, origin at the map pin).
 *
 * Usage:
 *   node scripts/build-map.mjs            # uses cached tiles if present
 *   node scripts/build-map.mjs --refresh  # re-download all tiles from the OSM API
 *
 * The target area is 7.2 x 7.2 km around the pin (~5x the previous area).
 * It is fetched as a 3 x 3 grid of small OSM API requests to stay under the
 * API's per-request node limit, then merged/deduplicated.
 *
 * Map data © OpenStreetMap contributors, ODbL 1.0.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CACHE_DIR = path.join(__dirname, '.cache', 'tiles')
const OUT = path.join(ROOT, 'public', 'data', 'subang-jaya.json')

const PIN = { lat: 3.0448217, lon: 101.5589111 }
const LAT0 = PIN.lat
const LON0 = PIN.lon
const M_PER_DEG_LAT = 110574
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180)

// 7.2 x 7.2 km target box, about 5x the previous 3.2 km box.
const TARGET_SPAN = 7200
const BBOX = {
  minLon: LON0 - TARGET_SPAN / 2 / M_PER_DEG_LON,
  maxLon: LON0 + TARGET_SPAN / 2 / M_PER_DEG_LON,
  minLat: LAT0 - TARGET_SPAN / 2 / M_PER_DEG_LAT,
  maxLat: LAT0 + TARGET_SPAN / 2 / M_PER_DEG_LAT,
}
const TILE_GRID = 3

/** local metre coords: +x east, -z north (three.js style) */
const sx = (lon) => (lon - LON0) * M_PER_DEG_LON
const sz = (lat) => -(lat - LAT0) * M_PER_DEG_LAT

const attr = (raw, name) => {
  const m = raw.match(new RegExp(`${name}="([^"]*)"`))
  return m ? m[1] : undefined
}

function parseTags(body) {
  const tags = {}
  for (const m of body.matchAll(/<tag k="([^"]+)" v="([^"]*)"\/>/g)) tags[m[1]] = m[2]
  return tags
}

function parseOsm(xml) {
  const nodes = new Map()
  for (const m of xml.matchAll(/<node\b([^>]*)>/g)) {
    const raw = m[1]
    const id = attr(raw, 'id')
    const lat = parseFloat(attr(raw, 'lat'))
    const lon = parseFloat(attr(raw, 'lon'))
    if (id && Number.isFinite(lat) && Number.isFinite(lon)) nodes.set(id, [lon, lat])
  }

  const taggedNodes = []
  for (const m of xml.matchAll(/<node\b([^>]*)>([\s\S]*?)<\/node>/g)) {
    const raw = m[1]
    const body = m[2]
    const tags = parseTags(body)
    if (!Object.keys(tags).length) continue
    const id = attr(raw, 'id')
    const lat = parseFloat(attr(raw, 'lat'))
    const lon = parseFloat(attr(raw, 'lon'))
    if (id && Number.isFinite(lat) && Number.isFinite(lon)) taggedNodes.push({ id, lon, lat, tags })
  }

  const ways = []
  for (const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const body = m[2]
    const tags = parseTags(body)
    if (!Object.keys(tags).length) continue
    const refs = [...body.matchAll(/<nd\s+ref="(\d+)"/g)].map((r) => r[1])
    if (refs.length < 2) continue
    const coords = []
    for (const ref of refs) {
      const p = nodes.get(ref)
      if (p) coords.push(p)
    }
    if (coords.length < 2) continue
    ways.push({ id: attr(m[1], 'id'), tags, coords, refs })
  }

  return { nodes, ways, taggedNodes }
}

const ROAD_WIDTH = {
  motorway: 14, trunk: 12.5, primary: 11, secondary: 9, tertiary: 8,
  unclassified: 6.5, residential: 6.2, service: 4.5, living_street: 5.5,
  motorway_link: 7, trunk_link: 6.8, primary_link: 6.5, secondary_link: 6,
  tertiary_link: 5.5, raceway: 9, road: 6.5,
}

const AREA_RULES = [
  ['amenity', 'school', 'school'],
  ['amenity', 'university', 'school'],
  ['amenity', 'college', 'school'],
  ['amenity', 'kindergarten', 'school'],
  ['amenity', 'fuel', 'fuel'],
  ['amenity', 'place_of_worship', 'worship'],
  ['amenity', 'hospital', 'hospital'],
  ['leisure', 'stadium', 'stadium'],
  ['leisure', 'sports_centre', 'sports'],
  ['landuse', 'residential', 'residential'],
  ['landuse', 'commercial', 'commercial'],
  ['landuse', 'retail', 'retail'],
  ['landuse', 'industrial', 'industrial'],
  ['landuse', 'construction', 'construction'],
  ['landuse', 'greenfield', 'greenfield'],
  ['landuse', 'brownfield', 'brownfield'],
  ['landuse', 'grass', 'grass'],
  ['landuse', 'forest', 'wood'],
  ['landuse', 'cemetery', 'cemetery'],
  ['landuse', 'recreation_ground', 'park'],
  ['landuse', 'meadow', 'grass'],
  ['leisure', 'park', 'park'],
  ['leisure', 'garden', 'park'],
  ['leisure', 'pitch', 'pitch'],
  ['leisure', 'playground', 'playground'],
  ['leisure', 'swimming_pool', 'water'],
  ['leisure', 'recreation_ground', 'park'],
  ['natural', 'water', 'water'],
  ['natural', 'wood', 'wood'],
  ['natural', 'scrub', 'scrub'],
  ['natural', 'grassland', 'grass'],
  ['natural', 'heath', 'grass'],
  ['natural', 'bare_rock', 'construction'],
  ['amenity', 'parking', 'parking'],
]

function signedArea(pts) {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  }
  return a / 2
}

function pointLineDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  if (!l2) return Math.hypot(px - ax, pz - az)
  let t = ((px - ax) * dx + (pz - az) * dz) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

function distanceToLine(px, pz, line) {
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const d = pointLineDistance(px, pz, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1])
    if (d < best) best = d
  }
  return best
}

const BUILDING_HEIGHT = {
  house: 6, semidetached_house: 6.5, detached: 7, terrace: 6.2, apartments: 18,
  residential: 12, commercial: 12, retail: 8, industrial: 8, warehouse: 9,
  school: 10, university: 12, mosque: 9, church: 9, temple: 9, kindergarten: 6,
  hospital: 16, hotel: 22, office: 20, stadium: 15, roof: 4.5, garage: 3.2,
  guardhouse: 3.2, yes: 7, construction: 6, manufacture: 8, service: 4,
}

const POI_AMENITY = new Set([
  'fuel', 'school', 'university', 'college', 'kindergarten',
  'hospital', 'clinic', 'police', 'fire_station', 'marketplace',
  'bus_station', 'bank', 'restaurant', 'cafe', 'place_of_worship',
  'community_centre', 'library', 'post_office', 'townhall', 'pharmacy',
])

function poiKind(tags) {
  if (tags.amenity === 'fuel') return 'fuel'
  if (tags.amenity === 'place_of_worship') return tags.religion === 'muslim' ? 'mosque' : 'worship'
  if (POI_AMENITY.has(tags.amenity)) {
    if (['school', 'university', 'college', 'kindergarten'].includes(tags.amenity)) return 'school'
    if (tags.amenity === 'clinic') return 'hospital'
    return tags.amenity
  }
  if (tags.building === 'school' || tags.building === 'kindergarten' || tags.building === 'university' || tags.building === 'college') return 'school'
  if (tags.building === 'mosque' || tags.building === 'musalla') return 'mosque'
  if (tags.building === 'hospital') return 'hospital'
  if (tags.leisure === 'stadium') return 'stadium'
  if (tags.leisure === 'sports_centre') return 'sports'
  if (tags.shop === 'supermarket' || tags.shop === 'department_store') return 'supermarket'
  if (tags.man_made === 'works' || (tags.building === 'industrial' && (tags.name || tags.operator))) return 'factory'
  if (tags.building === 'retail' && tags.name) return 'shop'
  return ''
}

function poiName(tags) {
  return tags.name || tags.brand || tags.operator || ''
}

function poiBrand(tags) {
  return tags.brand || tags.operator || ''
}

function buildingHeight(tags) {
  let h = parseFloat(tags.height)
  if (!Number.isFinite(h)) {
    const levels = parseFloat(tags['building:levels'])
    if (Number.isFinite(levels)) h = levels * 3.2 + 0.6
  }
  if (!Number.isFinite(h)) h = BUILDING_HEIGHT[tags.building] ?? 7
  const min = parseFloat(tags.min_height)
  const base = Number.isFinite(min) ? Math.max(0, min) : 0
  return {
    h: Math.max(2.5, Math.min(95, h)),
    base: Math.min(base, h - 1 > 0 ? h - 1 : 0),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tileBoxes() {
  const lonStep = (BBOX.maxLon - BBOX.minLon) / TILE_GRID
  const latStep = (BBOX.maxLat - BBOX.minLat) / TILE_GRID
  const pad = 0.00020
  const boxes = []
  for (let iz = 0; iz < TILE_GRID; iz++) {
    for (let ix = 0; ix < TILE_GRID; ix++) {
      boxes.push({
        ix,
        iz,
        minLon: BBOX.minLon + ix * lonStep - (ix > 0 ? pad : 0),
        maxLon: BBOX.minLon + (ix + 1) * lonStep + (ix < TILE_GRID - 1 ? pad : 0),
        minLat: BBOX.minLat + iz * latStep - (iz > 0 ? pad : 0),
        maxLat: BBOX.minLat + (iz + 1) * latStep + (iz < TILE_GRID - 1 ? pad : 0),
      })
    }
  }
  return boxes
}

async function fetchTile(box) {
  const bbox = `${box.minLon.toFixed(6)},${box.minLat.toFixed(6)},${box.maxLon.toFixed(6)},${box.maxLat.toFixed(6)}`
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SubangDrive/1.0 (fan driving game; map build)' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (!text.includes('<osm')) throw new Error('response is not OSM XML')
      return text
    } catch (err) {
      console.warn(`  tile ${box.ix},${box.iz} attempt ${attempt} failed: ${err.message}`)
      if (attempt === 4) throw err
      await sleep(1200 * attempt)
    }
  }
}

async function loadTiles() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const boxes = tileBoxes()
  const refresh = process.argv.includes('--refresh')
  let networkCalls = 0
  const mergedNodes = new Map()
  const mergedWays = new Map()
  const mergedTagged = new Map()

  for (const box of boxes) {
    const file = path.join(CACHE_DIR, `tile_${box.ix}_${box.iz}.osm`)
    let xml
    if (!refresh && fs.existsSync(file)) {
      xml = fs.readFileSync(file, 'utf8')
      console.log(`  cached tile ${box.ix},${box.iz}`)
    } else {
      console.log(`  downloading tile ${box.ix},${box.iz}…`)
      xml = await fetchTile(box)
      fs.writeFileSync(file, xml)
      networkCalls++
      await sleep(450)
    }
    const parsed = parseOsm(xml)
    for (const [id, coord] of parsed.nodes) mergedNodes.set(id, coord)
    for (const way of parsed.ways) mergedWays.set(way.id, way)
    for (const node of parsed.taggedNodes) mergedTagged.set(node.id, node)
  }
  console.log(`  ${boxes.length} tiles, ${networkCalls} downloaded`)
  return {
    nodes: mergedNodes,
    ways: [...mergedWays.values()],
    taggedNodes: [...mergedTagged.values()],
  }
}

console.log('Loading OSM tiles…')
const { nodes, ways, taggedNodes } = await loadTiles()

console.log('Parsing…')

const roads = []
const paths = []
const buildings = []
const areas = []
const trees = []
const signals = []
const busStops = []
const pois = []
const poiSeen = new Set()
const waterways = []

const ROAD_TYPES = new Set(Object.keys(ROAD_WIDTH))
const PATH_TYPES = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor'])
const WATERWAY_TYPES = new Set(['river', 'stream', 'canal', 'drain', 'ditch', 'brook'])

const roadNodeUse = new Map()
for (const way of ways) {
  if (!ROAD_TYPES.has(way.tags.highway)) continue
  for (const ref of way.refs) roadNodeUse.set(ref, (roadNodeUse.get(ref) || 0) + 1)
}

function addPoi(x, z, tags) {
  const kind = poiKind(tags)
  if (!kind) return
  const key = `${kind}:${Math.round(x / 25)}:${Math.round(z / 25)}`
  if (poiSeen.has(key)) return
  poiSeen.add(key)
  const poi = { x: round2(x), z: round2(z), k: kind }
  const name = poiName(tags)
  const brand = poiBrand(tags)
  if (name) poi.n = name
  if (brand && brand !== name) poi.br = brand
  pois.push(poi)
}



for (const way of ways) {
  const { tags, coords } = way
  const hw = tags.highway

  if (hw && ROAD_TYPES.has(hw)) {
    const pts = []
    let last = null
    for (const [lon, lat] of coords) {
      const x = sx(lon)
      const z = sz(lat)
      if (last && Math.hypot(x - last[0], z - last[1]) < 0.8) continue
      pts.push([round2(x), round2(z)])
      last = [x, z]
    }
    if (pts.length < 2) continue
    let width = ROAD_WIDTH[hw]
    const lanes = parseFloat(tags.lanes)
    if (Number.isFinite(lanes) && lanes > 0) width = Math.max(width * 0.75, lanes * 3.3 + 1)
    width = Math.min(19, width)
    if (hw === 'service' && tags.service === 'parking_aisle') width = 4
    roads.push({
      t: hw,
      w: round2(width),
      n: tags.name || '',
      ref: tags.ref || '',
      ow: tags.oneway === 'yes' || tags.oneway === 'true' || tags.oneway === '1',
      owb: tags.oneway === '-1',
      b: tags.bridge === 'yes' || tags.bridge === 'viaduct',
      tn: tags.tunnel === 'yes' || tags.layer === '-1',
      p: pts,
    })
    continue
  }

  if (hw && PATH_TYPES.has(hw)) {
    const pts = []
    let last = null
    for (const [lon, lat] of coords) {
      const x = sx(lon)
      const z = sz(lat)
      if (last && Math.hypot(x - last[0], z - last[1]) < 1.2) continue
      pts.push([round2(x), round2(z)])
      last = [x, z]
    }
    if (pts.length >= 2) paths.push({ t: hw, p: pts })
    continue
  }

  if (tags.waterway && WATERWAY_TYPES.has(tags.waterway)) {
    if (tags.tunnel === 'yes' || tags.culvert === 'yes') continue
    const pts = []
    let last = null
    for (const [lon, lat] of coords) {
      const x = sx(lon)
      const z = sz(lat)
      if (last && Math.hypot(x - last[0], z - last[1]) < 1.0) continue
      pts.push([round2(x), round2(z)])
      last = [x, z]
    }
    if (pts.length < 2) continue
    const fallback = { river: 18, stream: 4, canal: 8, drain: 2.2, ditch: 1.8, brook: 3.5 }[tags.waterway] || 3
    let width = parseFloat(tags.width)
    if (!Number.isFinite(width)) width = fallback
    width = Math.max(1.2, Math.min(30, width))
    waterways.push({ k: tags.waterway, w: round2(width), n: tags.name || '', p: pts })
    continue
  }

  if (tags.building && tags['building:part'] !== 'yes') {
    if (coords.length < 4) continue
    const first = coords[0]
    const last = coords[coords.length - 1]
    let ring = coords
    if (Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7) ring = coords.slice(0, -1)
    if (ring.length < 3) continue
    let pts = ring.map(([lon, lat]) => [round2(sx(lon)), round2(sz(lat))])
    // basic cleanup: drop consecutive duplicates
    pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.4)
    if (pts.length < 3) continue
    const area = Math.abs(signedArea(pts))
    if (area < 8) continue
    const { h, base } = buildingHeight(tags)
    const extra = {}
    if (tags.name) extra.n = tags.name
    if (tags.amenity) extra.a = tags.amenity
    else if (tags.shop) extra.a = tags.shop
    else if (tags.man_made) extra.a = tags.man_made
    if (tags.brand) extra.br = tags.brand
    if (tags.layer) {
      const layer = parseFloat(tags.layer)
      if (Number.isFinite(layer)) extra.l = layer
    }
    buildings.push({ h: round2(h), b: round2(base), k: tags.building, p: pts, ...extra })
    // A named building also carries a POI so schools, workshops and shops
    // can get an entrance sign even when their area polygon is missing.
    if (tags.name || tags.amenity || tags.shop || tags.man_made) {
      let cx = 0, cz = 0
      for (const [x, z] of pts) { cx += x; cz += z }
      addPoi(cx / pts.length, cz / pts.length, tags)
    }
    continue
  }

  // Closed area polygons
  if (coords.length >= 4) {
    let kind = null
    for (const [key, value, out] of AREA_RULES) {
      if (tags[key] === value) { kind = out; break }
    }
    if (kind) {
      const first = coords[0]
      const last = coords[coords.length - 1]
      if (Math.abs(first[0] - last[0]) > 1e-7 || Math.abs(first[1] - last[1]) > 1e-7) continue
      const pts = coords.slice(0, -1).map(([lon, lat]) => [round2(sx(lon)), round2(sz(lat))])
      if (pts.length < 3) continue
      const area = Math.abs(signedArea(pts))
      if (area < 25) continue
      const extra = {}
      if (tags.name) extra.n = tags.name
      if (tags.sport) extra.s = tags.sport
      if (tags.surface) extra.sf = tags.surface
      if (tags.amenity) extra.a = tags.amenity
      if (tags.man_made) extra.a = tags.man_made
      if (tags.water) extra.w = tags.water
      else if (tags.leisure === 'swimming_pool') extra.w = 'pool'
      areas.push({ k: kind, p: pts, ...extra })
      let acx = 0, acz = 0
      for (const [x, z] of pts) { acx += x; acz += z }
      addPoi(acx / pts.length, acz / pts.length, tags)
    }
  }

  if (tags.railway === 'rail' || tags.railway === 'light_rail') {
    const pts = coords.map(([lon, lat]) => [round2(sx(lon)), round2(sz(lat))])
    paths.push({ t: 'railway', p: pts })
  }
}

// Road junctions: nodes shared by two or more drivable ways. These are used
// at runtime for the road guide and for allowing U-turns only at junctions.
const junctions = []
for (const [ref, count] of roadNodeUse) {
  if (count < 2) continue
  const p = nodes.get(ref)
  if (!p) continue
  junctions.push([round2(sx(p[0])), round2(sz(p[1]))])
}

// Node-level features: trees, traffic signals and bus stops.
for (const node of taggedNodes) {
  const { tags, lon, lat } = node
  const x = round2(sx(lon))
  const z = round2(sz(lat))
  if (tags.natural === 'tree') trees.push([x, z, 0.85 + ((Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * 100) % 1) * 0.6])
  if (tags.highway === 'traffic_signals') signals.push([x, z])
  if (tags.highway === 'bus_stop') busStops.push([x, z, tags.name || ''])
  addPoi(x, z, tags)
}

// Rough bounds of the extract in local metres.
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
const track = (x, z) => {
  if (x < minX) minX = x
  if (x > maxX) maxX = x
  if (z < minZ) minZ = z
  if (z > maxZ) maxZ = z
}
for (const r of roads) for (const p of r.p) track(p[0], p[1])
for (const b of buildings) for (const p of b.p) track(p[0], p[1])
for (const a of areas) for (const p of a.p) track(p[0], p[1])

// Pick a pleasant starting spot: a leafy, building-dense residential street
// near the pin. Keep everything in map JSON so the client never needs to guess.
const buildingCentroids = buildings.map((b) => {
  let cx = 0
  let cz = 0
  for (const [x, z] of b.p) { cx += x; cz += z }
  return [cx / b.p.length, cz / b.p.length]
})

// grid so spawn scoring does not become building x segment quadratic
const B_CELL = 60
const buildingGrid = new Map()
for (const [bx, bz] of buildingCentroids) {
  const k = `${Math.floor(bx / B_CELL)},${Math.floor(bz / B_CELL)}`
  let list = buildingGrid.get(k)
  if (!list) buildingGrid.set(k, (list = []))
  list.push([bx, bz])
}
function neighboursNear(x, z, radius = 60) {
  const r = Math.ceil(radius / B_CELL)
  const gx = Math.floor(x / B_CELL)
  const gz = Math.floor(z / B_CELL)
  let count = 0
  for (let ox = -r; ox <= r; ox++) {
    for (let oz = -r; oz <= r; oz++) {
      const list = buildingGrid.get(`${gx + ox},${gz + oz}`)
      if (!list) continue
      for (const [bx, bz] of list) {
        if (Math.hypot(bx - x, bz - z) < radius) count++
      }
    }
  }
  return count
}

const spawnCandidates = []
for (const r of roads) {
  if (!r.n) continue
  if (!['residential', 'secondary', 'tertiary', 'unclassified'].includes(r.t)) continue
  for (let i = 0; i < r.p.length - 1; i++) {
    const a = r.p[i]
    const b = r.p[i + 1]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 60) continue
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    const d = Math.hypot(mx, mz)
    if (d > 550) continue
    const neighbours = neighboursNear(mx, mz, 60)
    const dx = (b[0] - a[0]) / len
    const dz = (b[1] - a[1]) / len
    // favour houses, a straight stretch and an eastbound view (sun behind)
    const score = neighbours * 2 + (r.t === 'residential' ? 12 : 0) + (dx > 0.3 ? 8 : 0) - Math.abs(d - 160) / 12
    spawnCandidates.push({ score, x: round2(mx), z: round2(mz), dx, dz, name: r.n, ref: r.ref || '', neighbours })
  }
}
spawnCandidates.sort((a, b) => b.score - a.score)
const spawn = spawnCandidates[0] || { x: 0, z: 0, dx: 0, dz: -1, name: 'Subang Jaya' }

// Road density grid for the minimap (1 px = 6 m) and off-road detection.
const GRID_SIZE = 8
const gridW = Math.ceil((maxX - minX) / GRID_SIZE) + 2
const gridH = Math.ceil((maxZ - minZ) / GRID_SIZE) + 2
const gridOrigin = { x: minX, z: minZ, size: GRID_SIZE, w: gridW, h: gridH }
const density = new Uint8Array(gridW * gridH)
for (const r of roads) {
  for (let i = 0; i < r.p.length - 1; i++) {
    const a = r.p[i]
    const b = r.p[i + 1]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const steps = Math.max(1, Math.ceil(len / 3))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const x = a[0] + (b[0] - a[0]) * t
      const z = a[1] + (b[1] - a[1]) * t
      const gx = Math.floor((x - minX) / GRID_SIZE)
      const gz = Math.floor((z - minZ) / GRID_SIZE)
      if (gx >= 0 && gz >= 0 && gx < gridW && gz < gridH) {
        density[gx + gz * gridW] = 1
        // widen by one cell so 6 m grid has a forgiving edge
        if (gx + 1 < gridW) density[gx + 1 + gz * gridW] = 1
        if (gx - 1 >= 0) density[gx - 1 + gz * gridW] = 1
      }
    }
  }
}

function round2(v) { return Math.round(v * 100) / 100 }

const out = {
  meta: {
    generated: new Date().toISOString(),
    source: 'OpenStreetMap © OpenStreetMap contributors (ODbL 1.0)',
    center: PIN,
    bbox: BBOX,
    bounds: { minX: Math.round(minX), maxX: Math.round(maxX), minZ: Math.round(minZ), maxZ: Math.round(maxZ) },
    attribution: 'Map data © OpenStreetMap contributors',
  },
  spawn,
  grid: { ...gridOrigin, density: Buffer.from(density).toString('base64') },
  roads,
  paths,
  buildings,
  areas,
  junctions,
  trees,
  signals,
  busStops: busStops.slice(0, 120),
  pois: pois.slice(0, 2000),
  waterways,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
const json = JSON.stringify(out)
fs.writeFileSync(OUT, json)
console.log('Wrote', path.relative(ROOT, OUT), (json.length / 1024 / 1024).toFixed(2), 'MB')
console.log(`  roads: ${roads.length}, buildings: ${buildings.length}, areas: ${areas.length}, paths: ${paths.length}`)
console.log(`  trees: ${trees.length}, junctions: ${junctions.length}, signals: ${signals.length}, bus stops: ${busStops.length}, POIs: ${pois.length}, waterways: ${waterways.length}`)
console.log(`  spawn: "${spawn.name}" at ${spawn.x.toFixed(0)},${spawn.z.toFixed(0)} (${spawn.neighbours ?? '?'} neighbours)`)
