import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  roadTexture,
  grassTexture,
  pathTexture,
  glowTexture,
  makeLabelTexture,
} from './textures.js'

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return s - Math.floor(s)
}

const KIND_COLORS = {
  residential: '#7d8370',
  commercial: '#8a8780',
  retail: '#8e887e',
  industrial: '#8a8b86',
  construction: '#9a8c76',
  greenfield: '#6f8452',
  brownfield: '#8a7f6b',
  grass: '#6d8549',
  park: '#5d7c41',
  wood: '#4b6633',
  scrub: '#687a4c',
  cemetery: '#6c765a',
  pitch: '#557a3c',
  playground: '#a68a62',
  parking: '#5b5e5d',
  water: '#3b6b80',
  school: '#8ba076',
  fuel: '#b8b3a8',
  worship: '#aa9f87',
  hospital: '#b9c2b8',
  stadium: '#6f8a4d',
  sports: '#748e54',
}

const BUILDING_COLORS = [
  '#e7e1d5', '#f1eee7', '#dcd4c5', '#e6d5ba', '#cbd6d1', '#e6cabc',
  '#d7d9d4', '#c9c2b4', '#f0e4d0', '#d9c9a8', '#d0d9d5', '#bcc6ca',
  '#e9dbc8', '#d5c5b8', '#eee8dc', '#c6b9a7', '#ded3c8', '#bdb7ab',
  '#e5d2b8', '#d8d1c4', '#c9d0ca', '#ebdfce', '#d3c0b1', '#c3c8c5',
]
const ROOF_COLORS = [
  '#8f4c39', '#9e5641', '#7d4435', '#a75b43', '#6f625b', '#5e5851',
  '#7b4a3d', '#955a48', '#565450', '#83716a',
]

function buildingKindCode(kind, h) {
  if (['retail', 'commercial', 'shop', 'restaurant', 'office', 'hotel'].includes(kind)) return 1
  if (['apartments', 'residential'].includes(kind)) return 2
  if (['industrial', 'warehouse', 'manufacture', 'service', 'construction'].includes(kind)) return 3
  if (['school', 'university', 'mosque', 'musalla', 'church', 'temple', 'kindergarten', 'hospital', 'stadium', 'civic'].includes(kind)) return 4
  if (['house', 'terrace', 'detached', 'semidetached_house', 'bungalow', 'hut', 'yes'].includes(kind)) {
    return h > 10 ? 1 : 0
  }
  return 5
}


const ROAD_PRIORITY = {
  motorway: 6, trunk: 6, primary: 5, secondary: 4, tertiary: 3,
  unclassified: 2, residential: 1, service: 0, living_street: 1,
  motorway_link: 5, trunk_link: 5, primary_link: 4, secondary_link: 3, tertiary_link: 2,
  raceway: 1, road: 1,
}

function lanesFor(width) {
  const n = Math.max(2, Math.min(6, Math.round(width / 3.4)))
  if (n === 3) return 4
  if (n === 5) return 6
  return n
}

function makeShape(points) {
  const s = new THREE.Shape()
  points.forEach(([x, z], i) => {
    if (i === 0) s.moveTo(x, -z)
    else s.lineTo(x, -z)
  })
  s.closePath()
  return s
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

/* ------------------------------------------------------------------ */
/* road ribbons                                                        */
/* ------------------------------------------------------------------ */

function ribbon(points, width, y, uvScale = 12, extend = 0.6, heights = null) {
  const half = width / 2
  const n = points.length
  if (n < 2) return null

  const pts = points.map((p) => new THREE.Vector2(p[0], p[1]))
  const dirs = []
  for (let i = 0; i < n - 1; i++) dirs.push(pts[i + 1].clone().sub(pts[i]).normalize())

  const normals = []
  for (let i = 0; i < n; i++) {
    const dPrev = dirs[Math.max(0, i - 1)]
    const dNext = dirs[Math.min(n - 2, i)]
    const nPrev = new THREE.Vector2(-dPrev.y, dPrev.x)
    const nNext = new THREE.Vector2(-dNext.y, dNext.x)
    let nrm = nPrev.clone().add(nNext)
    if (nrm.lengthSq() < 1e-6) nrm.copy(nNext)
    else nrm.normalize()
    let scale = 1 / Math.max(0.35, Math.abs(nrm.dot(nNext)))
    scale = Math.min(scale, 2.0)
    normals.push(nrm.multiplyScalar(scale))
  }

  const positions = []
  const uvs = []
  const verts = []
  let dist = 0
  const distances = [0]
  for (let i = 1; i < n; i++) {
    dist += pts[i].distanceTo(pts[i - 1])
    distances.push(dist)
  }
  const total = dist
  // extend the ends a touch so T-junctions look joined
  const extStart = dirs[0].clone().multiplyScalar(-extend)
  const extEnd = dirs[n - 2].clone().multiplyScalar(extend)

  for (let i = 0; i < n; i++) {
    const p = pts[i].clone()
    if (i === 0) p.add(extStart)
    if (i === n - 1) p.add(extEnd)
    const nrm = normals[i]
    const h = heights ? heights[i] : y
    const hL = Array.isArray(h) ? h[0] : h
    const hR = Array.isArray(h) ? h[1] : h
    verts.push(
      [p.x + nrm.x * half, hL, p.y + nrm.y * half],
      [p.x - nrm.x * half, hR, p.y - nrm.y * half],
    )
  }

  for (let i = 0; i < n; i++) {
    const v = distances[i] / uvScale
    uvs.push(0, v, 1, v)
  }

  const indices = []
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  for (const v of verts) positions.push(v[0], v[1], v[2])

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  geo.userData = { length: total }
  return geo
}

function terrainEdgeHeights(points, width, offset, terrainAt) {
  const half = width / 2
  const n = points.length
  if (n < 2) return []
  const pts = points.map((p) => new THREE.Vector2(p[0], p[1]))
  const dirs = []
  for (let i = 0; i < n - 1; i++) dirs.push(pts[i + 1].clone().sub(pts[i]).normalize())
  const normals = []
  for (let i = 0; i < n; i++) {
    const dPrev = dirs[Math.max(0, i - 1)]
    const dNext = dirs[Math.min(n - 2, i)]
    const nPrev = new THREE.Vector2(-dPrev.y, dPrev.x)
    const nNext = new THREE.Vector2(-dNext.y, dNext.x)
    let nrm = nPrev.clone().add(nNext)
    if (nrm.lengthSq() < 1e-6) nrm.copy(nNext)
    else nrm.normalize()
    let scale = 1 / Math.max(0.35, Math.abs(nrm.dot(nNext)))
    scale = Math.min(scale, 2.0)
    normals.push(nrm.multiplyScalar(scale))
  }
  const extStart = dirs[0].clone().multiplyScalar(-0.4)
  const extEnd = dirs[n - 2].clone().multiplyScalar(0.4)
  const out = []
  for (let i = 0; i < n; i++) {
    const p = pts[i].clone()
    if (i === 0) p.add(extStart)
    if (i === n - 1) p.add(extEnd)
    const nrm = normals[i]
    out.push([
      terrainAt(p.x + nrm.x * half, p.y + nrm.y * half) + offset,
      terrainAt(p.x - nrm.x * half, p.y - nrm.y * half) + offset,
    ])
  }
  return out
}

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

function resamplePolyline(points, step = 6) {
  const out = [{ x: points[0][0], z: points[0][1], d: 0 }]
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 0.001) continue
    const n = Math.max(1, Math.ceil(len / step))
    for (let j = 1; j <= n; j++) {
      const t = j / n
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, d: total + len * t })
    }
    total += len
  }
  for (const p of out) p.t = total > 0 ? p.d / total : 0
  return { points: out, length: total }
}

function bridgeDeckHeight(road) {
  if (road.t === 'motorway') return 7.2
  if (road.t === 'trunk') return 6.6
  if (road.t === 'primary') return 5.6
  if (road.t === 'secondary' || road.t === 'tertiary') return 4.9
  return 4.2
}

function makeBridgeProfile(road) {
  const { points, length } = resamplePolyline(road.p, 6)
  const deck = bridgeDeckHeight(road)
  // The old profile only ramped UP from the first point, leaving the bridge
  // deck at full height at the far end (a half-bridge cut in mid-air).
  // Ramp up at the start and back down at the end with a flat deck between.
  const ramp = 0.25
  const heights = points.map((p) => {
    const up = Math.min(1, p.t / ramp)
    const down = Math.min(1, (1 - p.t) / ramp)
    return deck * Math.min(smoothstep(up), smoothstep(down))
  })
  const coords = points.map((p) => [p.x, p.z])
  return { points, coords, heights, deck, length }
}

function setGeometryColor(geo, color) {
  const c = new THREE.Color(color)
  const count = geo.attributes.position.count
  const arr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

/* ------------------------------------------------------------------ */
/* collision                                                           */
/* ------------------------------------------------------------------ */

class BuildingCollision {
  constructor(buildings, cell = 26, groundAt = () => 0) {
    this.cell = cell
    this.map = new Map()
    for (const b of buildings) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const [x, z] of b.p) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
      let cx = 0
      let cz = 0
      for (const [x, z] of b.p) { cx += x; cz += z }
      const base = groundAt(cx / b.p.length, cz / b.p.length)
      const box = { minX, maxX, minZ, maxZ, h: b.h, base, p: b.p }
      const x0 = Math.floor(minX / cell)
      const x1 = Math.floor(maxX / cell)
      const z0 = Math.floor(minZ / cell)
      const z1 = Math.floor(maxZ / cell)
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const k = `${gx},${gz}`
          let list = this.map.get(k)
          if (!list) this.map.set(k, (list = []))
          list.push(box)
        }
      }
    }
  }

  resolve(pos, radius, carBase = 0) {
    const gx = Math.floor(pos.x / this.cell)
    const gz = Math.floor(pos.z / this.cell)
    const boxes = this.map.get(`${gx},${gz}`)
    if (!boxes) return null
    for (const b of boxes) {
      // A car on a flyover is above the roofs of the buildings underneath.
      if (carBase > b.base + b.h + 0.2) continue
      // cheap reject first
      if (
        pos.x < b.minX - radius || pos.x > b.maxX + radius ||
        pos.z < b.minZ - radius || pos.z > b.maxZ + radius
      ) continue

      const inside = pointInPolygon(pos.x, pos.z, b.p)
      let bestD2 = Infinity
      let bx = 0
      let bz = 0
      const pts = b.p
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const ax = pts[j][0], az = pts[j][1]
        const cx = pts[i][0], cz = pts[i][1]
        const dx = cx - ax, dz = cz - az
        const len2 = dx * dx + dz * dz
        let t = len2 > 0 ? ((pos.x - ax) * dx + (pos.z - az) * dz) / len2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const qx = ax + dx * t
        const qz = az + dz * t
        const ddx = pos.x - qx
        const ddz = pos.z - qz
        const d2 = ddx * ddx + ddz * ddz
        if (d2 < bestD2) {
          bestD2 = d2
          bx = qx
          bz = qz
        }
      }

      if (inside) {
        const d = Math.sqrt(bestD2) || 0.0001
        const nx = (pos.x - bx) / d
        const nz = (pos.z - bz) / d
        const push = d + radius + 0.03
        return { x: -nx * push, z: -nz * push }
      }

      if (bestD2 < radius * radius) {
        const d = Math.sqrt(bestD2) || 0.0001
        const nx = (pos.x - bx) / d
        const nz = (pos.z - bz) / d
        const push = radius - d + 0.01
        return { x: nx * push, z: nz * push }
      }
    }
    return null
  }
}

class RoadInfo {
  constructor(data) {
    this.grid = data.grid
    this.size = data.grid.size
    this.minX = data.grid.x
    this.minZ = data.grid.z
    this.w = data.grid.w
    this.h = data.grid.h
    const raw = atob(data.grid.density)
    this.density = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) this.density[i] = raw.charCodeAt(i)

    // name grid: 10 m cells
    this.cell = 10
    this.nameW = Math.ceil((data.meta.bounds.maxX - data.meta.bounds.minX) / this.cell) + 2
    this.nameH = Math.ceil((data.meta.bounds.maxZ - data.meta.bounds.minZ) / this.cell) + 2
    this.nameOriginX = data.meta.bounds.minX
    this.nameOriginZ = data.meta.bounds.minZ
    this.names = ['']
    this.nameIndex = new Map([['', 0]])
    this.refs = ['']
    this.refIndex = new Map([['', 0]])
    this.roadClass = new Uint8Array(this.nameW * this.nameH)
    this.nameGrid = new Uint16Array(this.nameW * this.nameH)
    this.refGrid = new Uint16Array(this.nameW * this.nameH)

    for (const road of data.roads) {
      if (!road.n && !road.ref) continue
      let idx = this.nameIndex.get(road.n)
      if (idx === undefined) {
        idx = this.names.length
        this.names.push(road.n)
        this.nameIndex.set(road.n, idx)
      }
      let rIdx = this.refIndex.get(road.ref || '')
      if (rIdx === undefined) {
        rIdx = this.refs.length
        this.refs.push(road.ref || '')
        this.refIndex.set(road.ref || '', rIdx)
      }
      const priority = ROAD_PRIORITY[road.t] ?? 1
      const pad = Math.max(1, Math.ceil((road.w / 2 + 4) / this.cell))
      for (let i = 0; i < road.p.length - 1; i++) {
        const a = road.p[i]
        const b = road.p[i + 1]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        const steps = Math.max(1, Math.ceil(len / 5))
        for (let s = 0; s <= steps; s++) {
          const t = s / steps
          const x = a[0] + (b[0] - a[0]) * t
          const z = a[1] + (b[1] - a[1]) * t
          const cx = Math.floor((x - this.nameOriginX) / this.cell)
          const cz = Math.floor((z - this.nameOriginZ) / this.cell)
          for (let ox = -pad; ox <= pad; ox++) {
            for (let oz = -pad; oz <= pad; oz++) {
              const gx = cx + ox
              const gz = cz + oz
              if (gx < 0 || gz < 0 || gx >= this.nameW || gz >= this.nameH) continue
              const k = gx + gz * this.nameW
              if (this.roadClass[k] <= priority) {
                this.roadClass[k] = priority
                this.nameGrid[k] = idx
                this.refGrid[k] = rIdx
              }
            }
          }
        }
      }
    }
  }

  onRoad(x, z) {
    const gx = Math.floor((x - this.minX) / this.size)
    const gz = Math.floor((z - this.minZ) / this.size)
    if (gx < 0 || gz < 0 || gx >= this.w || gz >= this.h) return false
    return this.density[gx + gz * this.w] === 1
  }

  nameAt(x, z) {
    const gx = Math.floor((x - this.nameOriginX) / this.cell)
    const gz = Math.floor((z - this.nameOriginZ) / this.cell)
    if (gx < 0 || gz < 0 || gx >= this.nameW || gz >= this.nameH) return ''
    return this.names[this.nameGrid[gx + gz * this.nameW]] || ''
  }

  refAt(x, z) {
    const gx = Math.floor((x - this.nameOriginX) / this.cell)
    const gz = Math.floor((z - this.nameOriginZ) / this.cell)
    if (gx < 0 || gz < 0 || gx >= this.nameW || gz >= this.nameH) return ''
    return this.refs[this.refGrid[gx + gz * this.nameW]] || ''
  }

  infoAt(x, z) {
    return { onRoad: this.onRoad(x, z), name: this.nameAt(x, z), ref: this.refAt(x, z) }
  }
}

/* ------------------------------------------------------------------ */
/* building detail helpers                                             */
/* ------------------------------------------------------------------ */

function footprintFrame(points, front) {
  let fx = front ? front.x : 0
  let fz = front ? front.z : 0
  if (Math.hypot(fx, fz) < 0.1) {
    let best = 0
    fx = 1
    fz = 0
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const len = Math.hypot(dx, dz)
      if (len > best) {
        best = len
        // face normal, roof ridge will run parallel to the frontage
        fx = -dz / len
        fz = dx / len
      }
    }
  } else {
    const len = Math.hypot(fx, fz)
    fx /= len
    fz /= len
  }
  const ux = -fz
  const uz = fx
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (const [x, z] of points) {
    const uu = x * ux + z * uz
    const vv = x * fx + z * fz
    if (uu < u0) u0 = uu
    if (uu > u1) u1 = uu
    if (vv < v0) v0 = vv
    if (vv > v1) v1 = vv
  }
  return { fx, fz, ux, uz, u0, u1, v0, v1 }
}

function makeDetailBatch() {
  return { pos: [], col: [] }
}

let detailBaseY = 0

const BOX_CORNERS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
]
const BOX_FACES = [
  [0, 2, 1], [0, 3, 2],
  [4, 5, 6], [4, 6, 7],
  [0, 7, 3], [0, 4, 7],
  [1, 2, 6], [1, 6, 5],
  [0, 1, 5], [0, 5, 4],
  [3, 7, 6], [3, 6, 2],
]

function addDetailBox(batch, x, y, z, sx, sy, sz, yaw, hex) {
  const c = new THREE.Color(hex)
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const hx = sx / 2
  const hy = sy / 2
  const hz = sz / 2
  const pts = []
  const yy = y + detailBaseY
  for (const [sx0, sy0, sz0] of BOX_CORNERS) {
    const lx = sx0 * hx
    const lz = sz0 * hz
    pts.push([x + lx * cos + lz * sin, yy + sy0 * hy, z - lx * sin + lz * cos])
  }
  for (const [a, b, cIdx] of BOX_FACES) {
    for (const idx of [a, b, cIdx]) {
      const p = pts[idx]
      batch.pos.push(p[0], p[1], p[2])
      batch.col.push(c.r, c.g, c.b)
    }
  }
}


function addPitchedRoof(batch, b, frame, wallHex, roofHex, peak, baseY = 0) {
  const { fx, fz, ux, uz, u0, u1, v0, v1 } = frame
  const overhang = 0.34
  const uA = u0 - overhang
  const uB = u1 + overhang
  const vA = v0 - overhang
  const vB = v1 + overhang
  const vc = (vA + vB) / 2
  const yE = b.h - 0.01 + baseY
  const yR = b.h + peak + baseY
  const p = (uu, vv, y) => [ux * uu + fx * vv, y, uz * uu + fz * vv]
  const wall = new THREE.Color(wallHex)
  const roof = new THREE.Color(roofHex)
  const tri = (a, c, d, col) => {
    batch.pos.push(...a, ...c, ...d)
    for (let i = 0; i < 3; i++) batch.col.push(col.r, col.g, col.b)
  }

  const eaveBL = p(uA, vA, yE)
  const eaveBR = p(uB, vA, yE)
  const eaveFL = p(uA, vB, yE)
  const eaveFR = p(uB, vB, yE)
  const ridgeL = p(uA, vc, yR)
  const ridgeR = p(uB, vc, yR)

  tri(eaveFL, eaveFR, ridgeR, roof)
  tri(eaveFL, ridgeR, ridgeL, roof)
  tri(eaveBL, ridgeL, ridgeR, roof)
  tri(eaveBL, ridgeR, eaveBR, roof)
  tri(p(uA, vA, yE), p(uA, vB, yE), ridgeL, wall)
  tri(p(uB, vB, yE), p(uB, vA, yE), ridgeR, wall)
}

function addParkedCar(batch, world, uc, v, yaw, seed) {
  const cols = ['#e7e7e2', '#c9ccd0', '#2d3034', '#8f2f2d', '#3d5f7f', '#6c7073', '#d6d1c5']
  const body = cols[Math.floor(hash2(seed * 17.1, uc * 0.07) * cols.length)]
  const [x, y, z] = world(uc, v, 0.38)
  addDetailBox(batch, x, 0.38, z, 1.62, 0.52, 4.05, yaw, body)
  const [gx, gy, gz] = world(uc, v, 0.78)
  addDetailBox(batch, gx, 0.79, gz, 1.38, 0.42, 1.85, yaw, '#20262b')
  const [rx, ry, rz] = world(uc, v, 0.92)
  addDetailBox(batch, rx, 0.93, rz, 1.28, 0.08, 1.55, yaw, body)
  for (const du of [-0.72, 0.72]) {
    for (const dv of [-1.26, 1.26]) {
      const [wx, wy, wz] = world(uc + du, v + dv, 0.28)
      addDetailBox(batch, wx, 0.28, wz, 0.2, 0.46, 0.5, yaw, '#171a1c')
    }
  }
}

function addFrontYard(batch, b, frame, near, seed, allowCars = true) {
  const { fx, fz, ux, uz, u0, u1, v0, v1 } = frame
  if (!near) return
  const vc = (v0 + v1) / 2
  const yard = near.dist - near.width / 2 - (v1 - vc)
  if (!(yard > 0.8 && yard < 13)) return
  const frontage = u1 - u0
  if (frontage < 3.2 || frontage > 20) return
  const uc = (u0 + u1) / 2
  const yaw = Math.atan2(-uz, ux)
  const world = (uu, vv, y) => [ux * uu + fx * vv, y, uz * uu + fz * vv]

  const cw = Math.min(frontage - 0.45, 4.5)
  const cd = Math.min(yard - 0.7, 4.8)
  if (cw < 2.0 || cd < 1.3) return

  const canopyCols = ['#c9c3b6', '#bdb6a8', '#a25c48', '#8d4f3e', '#6a655e', '#9a5b48']
  const canopyCol = canopyCols[Math.floor(hash2(seed * 8.7, v1 * 0.11) * canopyCols.length)]
  const wallCols = ['#d8d2c6', '#cec7b9', '#c4bdb0', '#bdb5a8', '#d3cec3', '#b8ada0']
  const wallCol = wallCols[Math.floor(hash2(seed * 5.3, uc * 0.13) * wallCols.length)]

  // Car-port canopy, slim posts and a coloured fascia.
  const vCanopy = v1 + 0.06 + cd / 2
  const [cx, cy, cz] = world(uc, vCanopy, 3.02)
  addDetailBox(batch, cx, cy, cz, cw, 0.12, cd, yaw, canopyCol)
  const [fx1, , fz1] = world(uc - cw / 2 + 0.12, v1 + cd - 0.08, 1.5)
  const [fx2, , fz2] = world(uc + cw / 2 - 0.12, v1 + cd - 0.08, 1.5)
  addDetailBox(batch, fx1, 1.5, fz1, 0.1, 2.9, 0.1, yaw, '#484c4d')
  addDetailBox(batch, fx2, 1.5, fz2, 0.1, 2.9, 0.1, yaw, '#484c4d')
  const [fasciaX, fasciaY, fasciaZ] = world(uc, v1 + cd + 0.03, 2.97)
  addDetailBox(batch, fasciaX, fasciaY, fasciaZ, cw, 0.16, 0.07, yaw, '#68594d')

  // Concrete driveway from the porch to the road edge.
  const driveDepth = Math.min(yard - 0.25, cd + 1.0)
  const [dx, dy, dz] = world(uc, v1 + driveDepth / 2, 0.065)
  addDetailBox(batch, dx, dy, dz, cw + 0.2, 0.03, driveDepth, yaw, '#a49f96')

  // A parked Malaysian compact car in some porches.
  if (allowCars && cd > 3.25 && cw > 2.6 && hash2(seed * 31.7, uc * 0.19 + v1 * 0.07) > 0.47) {
    addParkedCar(batch, world, uc, v1 + cd * 0.56, yaw, seed)
  }

  // Low front boundary wall with a gate opening, gate and coping.
  const wallV = v1 + yard - 0.65
  const gate = Math.min(2.9, frontage * 0.46)
  const seg = (frontage - gate) / 2
  if (seg > 0.15) {
    const [w1x, w1y, w1z] = world(uc - gate / 2 - seg / 2, wallV, 0.50)
    const [w2x, w2y, w2z] = world(uc + gate / 2 + seg / 2, wallV, 0.50)
    addDetailBox(batch, w1x, w1y, w1z, seg, 1.0, 0.14, yaw, wallCol)
    addDetailBox(batch, w2x, w2y, w2z, seg, 1.0, 0.14, yaw, wallCol)
    addDetailBox(batch, w1x, 1.03, w1z, seg, 0.07, 0.2, yaw, '#6d6458')
    addDetailBox(batch, w2x, 1.03, w2z, seg, 0.07, 0.2, yaw, '#6d6458')
    const [p1x, p1y, p1z] = world(uc - gate / 2, wallV, 0.70)
    const [p2x, p2y, p2z] = world(uc + gate / 2, wallV, 0.70)
    addDetailBox(batch, p1x, p1y, p1z, 0.24, 1.4, 0.24, yaw, '#5b5b57')
    addDetailBox(batch, p2x, p2y, p2z, 0.24, 1.4, 0.24, yaw, '#5b5b57')
    // Slim dark metal gate across the opening. Open vertical bars keep the
    // street from becoming a wall of black garage doors.
    const gateW = gate - 0.24
    if (gateW > 1.0 && hash2(seed * 23.7, v1 * 0.31) > 0.10) {
      const [grx, gry, grz] = world(uc, wallV, 1.00)
      const [gpx, gpy, gpz] = world(uc, wallV, 0.18)
      addDetailBox(batch, grx, gry, grz, gateW, 0.065, 0.07, yaw, '#6d7270')
      addDetailBox(batch, gpx, gpy, gpz, gateW, 0.065, 0.07, yaw, '#6d7270')
      for (let i = 0; i < 4; i++) {
        const uu = uc - gateW / 2 + i * (gateW / 3)
        const [bx, by, bz] = world(uu, wallV, 0.59)
        addDetailBox(batch, bx, by, bz, 0.05, 0.84, 0.05, yaw, '#34393b')
      }
    }
  }

  // A small eave board on the front of the main roof.
  const [eaveX, eaveY, eaveZ] = world(uc, v1 + 0.4, b.h + 0.07)
  addDetailBox(batch, eaveX, eaveY, eaveZ, frontage + 0.15, 0.15, 0.1, yaw, '#d6cfc1')
}

function addShopFront(batch, frame, near, seed) {
  if (!near) return
  const { fx, fz, ux, uz, u0, u1, v1 } = frame
  const frontage = u1 - u0
  if (frontage < 3.0) return
  const uc = (u0 + u1) / 2
  const yaw = Math.atan2(-uz, ux)
  const world = (uu, vv, y) => [ux * uu + fx * vv, y, uz * uu + fz * vv]
  const colors = ['#a9473c', '#2f6d62', '#c6a843', '#405d88', '#76536d']
  const col = colors[Math.floor(hash2(uc, v1) * colors.length)]
  const depth = 1.55
  const [ax, ay, az] = world(uc, v1 + depth / 2, 3.12)
  addDetailBox(batch, ax, ay, az, frontage - 0.35, 0.12, depth, yaw, col)
  const [sx, sy, sz] = world(uc, v1 + 0.17, 3.85)
  addDetailBox(batch, sx, sy, sz, frontage - 0.5, 0.62, 0.1, yaw, '#e1dbcd')
  // A darker frame line under the sign board.
  addDetailBox(batch, sx, 3.48, sz, frontage - 0.5, 0.07, 0.12, yaw, '#4a4a46')
}

function addFootballField(batch, area) {
  if (area.p.length < 3) return
  const frame = footprintFrame(area.p, null)
  const { ux, uz, fx, fz, u0, u1, v0, v1 } = frame
  const uLen = u1 - u0
  const vLen = v1 - v0
  if (uLen < 5 || vLen < 3.5) return

  const sport = String(area.s || '').toLowerCase()
  const isSoccer = /soccer|football|futsal|hockey/.test(sport) || area.k === 'stadium'
  const isCourt = /basketball|tennis|badminton|sepak|volleyball|multi|baseball/.test(sport)
  if (!isSoccer && !isCourt && sport) return
  if (!isSoccer && !isCourt && !sport) {
    // An unnamed pitch is almost always a neighbourhood football/futsal field.
  }

  const lengthAlongU = uLen >= vLen
  const length = lengthAlongU ? uLen : vLen
  const width = lengthAlongU ? vLen : uLen
  if (length < 5 || width < 3) return
  const lx = lengthAlongU ? ux : fx
  const lz = lengthAlongU ? uz : fz
  const wx = lengthAlongU ? fx : ux
  const wz = lengthAlongU ? fz : uz
  const cx = ux * ((u0 + u1) / 2) + fx * ((v0 + v1) / 2)
  const cz = uz * ((u0 + u1) / 2) + fz * ((v0 + v1) / 2)
  const yaw = Math.atan2(-lz, lx)
  const local = (l, w, y) => [cx + lx * l + wx * w, y, cz + lz * l + wz * w]
  const boxLocal = (l, w, y, along, across, height, color) => {
    const [x, yy, z] = local(l, w, y)
    addDetailBox(batch, x, yy, z, along, height, across, yaw, color)
  }

  const courtCols = {
    basketball: '#a96f52',
    tennis: '#4f7f61',
    badminton: '#3f7064',
    multi: '#567f78',
    sepak_takraw: '#417b57',
    volleyball: '#ae8054',
    baseball: '#8a7d57',
    hockey: '#4f7b54',
  }
  const grass = isSoccer ? '#4d7b37' : (courtCols[sport.split(';')[0]] || '#557a3c')
  boxLocal(0, 0, 0.035, length - 0.6, width - 0.6, 0.025, grass)

  const inset = 0.85
  const halfL = length / 2 - inset
  const halfW = width / 2 - inset
  const lineTh = 0.12
  const lineY = 0.08
  const white = '#e8e7df'
  // boundary
  boxLocal(0, -halfW, lineY, halfL * 2, lineTh, 0.025, white)
  boxLocal(0, halfW, lineY, halfL * 2, lineTh, 0.025, white)
  boxLocal(-halfL, 0, lineY, lineTh, halfW * 2, 0.025, white)
  boxLocal(halfL, 0, lineY, lineTh, halfW * 2, 0.025, white)
  // halfway line
  boxLocal(0, 0, lineY, lineTh, halfW * 2, 0.025, white)

  if (isSoccer) {
    const centerR = Math.min(3.0, width * 0.18)
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2
      boxLocal(Math.cos(a) * centerR, Math.sin(a) * centerR, lineY, 0.38, 0.1, 0.025, white)
    }
    boxLocal(0, 0, lineY + 0.002, 0.28, 0.28, 0.025, white)
    const penDepth = Math.min(16.5, halfL * 0.42)
    const penHalf = Math.min(halfW * 0.62, 20.16 / 2)
    for (const side of [-1, 1]) {
      const end = side * halfL
      const back = end - side * penDepth
      boxLocal(back, 0, lineY, lineTh, penHalf * 2, 0.025, white)
      boxLocal((end + back) / 2, -penHalf, lineY, penDepth, lineTh, 0.025, white)
      boxLocal((end + back) / 2, penHalf, lineY, penDepth, lineTh, 0.025, white)
      // goal
      const goalHalf = sport.includes('futsal') ? 1.5 : 3.66
      boxLocal(end, -goalHalf, 1.24, 0.12, 0.12, 2.42, white)
      boxLocal(end, goalHalf, 1.24, 0.12, 0.12, 2.42, white)
      boxLocal(end, 0, 2.42, 0.12, goalHalf * 2, 0.12, white)
    }
    // low perimeter fence
    const fenceY = 0.62
    const fenceH = 1.06
    const fenceCol = '#4e5f4e'
    const fl = halfL + 1.2
    const fw = halfW + 1.2
    boxLocal(0, -fw, fenceY, fl * 2, 0.08, fenceH, fenceCol)
    boxLocal(0, fw, fenceY, fl * 2, 0.08, fenceH, fenceCol)
    boxLocal(-fl, 0, fenceY, 0.08, fw * 2, fenceH, fenceCol)
    boxLocal(fl, 0, fenceY, 0.08, fw * 2, fenceH, fenceCol)
    for (const [ll, ww] of [[-fl, -fw], [-fl, fw], [fl, -fw], [fl, fw]]) {
      boxLocal(ll, ww, 0.55, 0.18, 0.18, 1.2, fenceCol)
    }
  } else {
    // Simple court markings for basketball/tennis/badminton/multi courts.
    const centerCircleR = Math.min(1.8, width * 0.16)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      boxLocal(Math.cos(a) * centerCircleR, Math.sin(a) * centerCircleR, lineY, 0.22, 0.08, 0.025, white)
    }
  }
}

function cleanLabel(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function fuelBrandStyle(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('shell')) return { main: '#f4c400', accent: '#d71920', dark: '#1d1d1b', light: '#fff4b0' }
  if (n.includes('petronas')) return { main: '#00a19c', accent: '#0a3f3c', dark: '#092e2b', light: '#e0fbf4' }
  if (n.includes('bhp')) return { main: '#007a3d', accent: '#f4c400', dark: '#153b26', light: '#f8f0c0' }
  if (n.includes('caltex')) return { main: '#0a4f9e', accent: '#d71920', dark: '#082d57', light: '#e5efff' }
  if (n.includes('petron')) return { main: '#d71920', accent: '#f4c400', dark: '#3a0d0d', light: '#ffe6d9' }
  return { main: '#b53a30', accent: '#f0d28a', dark: '#33201b', light: '#f5e8d2' }
}

function signColorFor(kind) {
  if (kind === 'school') return { bg: '#164b8b', fg: '#ffffff', accent: '#ffd24a', sub: 'SEKOLAH' }
  if (kind === 'factory') return { bg: '#30383a', fg: '#f5f1e6', accent: '#f0a23a', sub: 'FACTORY' }
  if (kind === 'mosque' || kind === 'worship') return { bg: '#0d5a45', fg: '#ffffff', accent: '#f0d37a', sub: 'MASJID' }
  if (kind === 'hospital') return { bg: '#9a1d1d', fg: '#ffffff', accent: '#ffe0d6', sub: 'KLINIK' }
  if (kind === 'supermarket') return { bg: '#b21f2d', fg: '#ffffff', accent: '#ffe08a', sub: 'PASAR RAYA' }
  if (kind === 'pharmacy') return { bg: '#16764a', fg: '#ffffff', accent: '#f4d65a', sub: 'FARMASI' }
  if (kind === 'shop' || kind === 'retail') return { bg: '#244d73', fg: '#ffffff', accent: '#ffd166', sub: 'KEDAI' }
  if (kind === 'restaurant' || kind === 'cafe') return { bg: '#5a3528', fg: '#fff4dd', accent: '#f4b454', sub: 'RESTORAN' }
  return { bg: '#27343a', fg: '#ffffff', accent: '#ffc857', sub: 'SUBANG JAYA' }
}

function addParapet(batch, b, frame, wallHex) {
  const { fx, fz, ux, uz, u0, u1, v0, v1 } = frame
  const yaw = Math.atan2(-uz, ux)
  const y = b.h + 0.3
  const uc = (u0 + u1) / 2
  const vc = (v0 + v1) / 2
  const world = (uu, vv, yy) => [ux * uu + fx * vv, yy, uz * uu + fz * vv]
  const [ax, ay, az] = world(uc, v0 + 0.09, y)
  const [bx, by, bz] = world(uc, v1 - 0.09, y)
  const [cx, cy, cz] = world(u0 + 0.09, vc, y)
  const [dx, dy, dz] = world(u1 - 0.09, vc, y)
  addDetailBox(batch, ax, ay, az, u1 - u0, 0.6, 0.18, yaw, wallHex)
  addDetailBox(batch, bx, by, bz, u1 - u0, 0.6, 0.18, yaw, wallHex)
  addDetailBox(batch, cx, cy, cz, 0.18, 0.6, v1 - v0, yaw, wallHex)
  addDetailBox(batch, dx, dy, dz, 0.18, 0.6, v1 - v0, yaw, wallHex)
}

function findRoadOverlaps(buildings, roads, cell = 32) {
  // Some OSM structures (LRT stations, overhead bridges, toll canopies and a
  // few data errors) have footprints that cover a road. They must not be
  // treated as ground-level walls. Find them once at build time.
  const points = new Map()
  for (const road of roads) {
    if (road.b || road.tn || road.p.length < 2) continue
    for (let i = 0; i < road.p.length - 1; i++) {
      const [ax, az] = road.p[i]
      const [bx, bz] = road.p[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const steps = Math.max(1, Math.ceil(len / 5))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const x = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`
        let list = points.get(key)
        if (!list) points.set(key, (list = []))
        list.push([x, z])
      }
    }
  }
  const over = new Set()
  buildings.forEach((b, index) => {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [x, z] of b.p) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    outer: for (let gx = Math.floor(minX / cell); gx <= Math.floor(maxX / cell); gx++) {
      for (let gz = Math.floor(minZ / cell); gz <= Math.floor(maxZ / cell); gz++) {
        const list = points.get(`${gx},${gz}`)
        if (!list) continue
        for (const [x, z] of list) {
          if (pointInPolygon(x, z, b.p)) {
            over.add(index)
            break outer
          }
        }
      }
    }
  })
  return over
}

function terrainHeightAt(data, x, z) {
  const terrain = data.terrain
  if (!terrain || !terrain.heights) return 0
  const res = terrain.res
  const step = terrain.step
  const minX = terrain.minX
  const minZ = terrain.minZ
  const fx = (x - minX) / step
  const fz = (z - minZ) / step
  const ix = Math.max(0, Math.min(res - 1, Math.floor(fx)))
  const iz = Math.max(0, Math.min(res - 1, Math.floor(fz)))
  const tx = Math.max(0, Math.min(1, fx - ix))
  const tz = Math.max(0, Math.min(1, fz - iz))
  const i00 = iz * res + ix
  const i10 = iz * res + Math.min(res - 1, ix + 1)
  const i01 = Math.min(res - 1, iz + 1) * res + ix
  const i11 = Math.min(res - 1, iz + 1) * res + Math.min(res - 1, ix + 1)
  const a = terrain.heights[i00]
  const b = terrain.heights[i10]
  const c = terrain.heights[i01]
  const d = terrain.heights[i11]
  // The terrain mesh splits each cell into triangles (a,c,b) and (b,c,d).
  // Interpolate the same triangles here so roads, props and the car use the
  // exact visible ground surface instead of a bilinear height that can sit
  // below the rendered mesh on steeper parts of the DEM.
  if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz
  return b * (1 - tz) + c * (1 - tx) + d * (tx + tz - 1)
}

function createTerrainMesh(data, grass) {
  const terrain = data.terrain
  if (!terrain || !terrain.heights) {
    return new THREE.Mesh(
      new THREE.PlaneGeometry(40000, 40000),
      new THREE.MeshStandardMaterial({ map: grass, roughness: 1, color: 0xd8d8cf }),
    )
  }
  const res = terrain.res
  const step = terrain.step
  const minX = terrain.minX
  const minZ = terrain.minZ
  const positions = new Float32Array(res * res * 3)
  const uvs = new Float32Array(res * res * 2)
  const colors = new Float32Array(res * res * 3)
  const low = new THREE.Color('#d6ddc1')
  const high = new THREE.Color('#cfc8b4')
  const peak = new THREE.Color('#e2dccb')
  for (let iz = 0; iz < res; iz++) {
    for (let ix = 0; ix < res; ix++) {
      const i = iz * res + ix
      const x = minX + ix * step
      const z = minZ + iz * step
      const h = terrain.heights[i]
      positions[i * 3] = x
      positions[i * 3 + 1] = h
      positions[i * 3 + 2] = z
      uvs[i * 2] = (x - minX) / (res - 1)
      uvs[i * 2 + 1] = (z - minZ) / (res - 1)
      const t = Math.max(0, Math.min(1, h / 180))
      const col = h > 110 ? low.clone().lerp(peak, Math.min(1, (h - 110) / 100)) : low.clone().lerp(high, t * 0.55)
      colors[i * 3] = col.r
      colors[i * 3 + 1] = col.g
      colors[i * 3 + 2] = col.b
    }
  }
  const indices = []
  for (let iz = 0; iz < res - 1; iz++) {
    for (let ix = 0; ix < res - 1; ix++) {
      const a = iz * res + ix
      const b = a + 1
      const c = a + res
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 1, color: 0xffffff, side: THREE.DoubleSide }),
  )
  mesh.receiveShadow = true
  return mesh
}

function clipOuterRuns(points, radius = 4400) {
  const runs = []
  let cur = []
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i]
    const outside = Math.hypot(x, z) >= radius
    if (outside) {
      if (!cur.length && i > 0) cur.push(points[i - 1])
      cur.push(points[i])
    } else if (cur.length) {
      cur.push(points[i])
      if (cur.length >= 2) runs.push(cur)
      cur = []
    }
  }
  if (cur.length >= 2) runs.push(cur)
  return runs.map((run) => {
    const out = []
    for (const [x, z] of run) {
      if (!out.length || Math.hypot(x - out[out.length - 1][0], z - out[out.length - 1][1]) >= 6) {
        out.push([x, z])
      }
    }
    return out
  }).filter((run) => run.length >= 2)
}

/* ------------------------------------------------------------------ */
/* world                                                               */
/* ------------------------------------------------------------------ */

export function buildWorld(scene, data, renderer, { mobile = false } = {}) {
  const flatBridges = new URLSearchParams(window.location.search).has('flat')
  const group = new THREE.Group()
  group.name = 'subang-jaya'
  scene.add(group)

  const rng = mulberry32(20140411)
  const maxAniso = renderer.capabilities.getMaxAnisotropy()
  const bounds = data.meta.bounds
  const terrainAt = (x, z) => terrainHeightAt(data, x, z)
  const nidoRoute = Array.isArray(data.nidoRoute) ? data.nidoRoute : []
  const routeDistanceAt = (x, z) => {
    if (nidoRoute.length < 2) return Infinity
    let best = Infinity
    for (let i = 0; i < nidoRoute.length - 1; i++) {
      const [ax, az] = nidoRoute[i]
      const [bx, bz] = nidoRoute[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const l2 = dx * dx + dz * dz
      if (l2 < 1e-6) continue
      let t = ((x - ax) * dx + (z - az) * dz) / l2
      t = Math.max(0, Math.min(1, t))
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t))
      if (d < best) best = d
    }
    return best
  }

  /* ---------------- terrain ---------------- */
  const grass = grassTexture()
  grass.anisotropy = Math.min(8, maxAniso)
  grass.repeat.set(2000, 2000)
  const ground = createTerrainMesh(data, grass)
  if (!data.terrain) {
    ground.rotation.x = -Math.PI / 2
  }
  ground.position.y = data.terrain ? 0 : -0.03
  ground.receiveShadow = true
  group.add(ground)

  /* ---------------- animated water ---------------- */
  const waterUniforms = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.36, 0.68, 0.28).normalize() },
    uSunColor: { value: new THREE.Color(0xffce92) },
    uSky: { value: new THREE.Color(0x315d66) },
    uHorizon: { value: new THREE.Color(0x68837d) },
    uDeep: { value: new THREE.Color(0x061f23) },
    uShallow: { value: new THREE.Color(0x16443f) },
  }
  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uNight;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSky;
      uniform vec3 uHorizon;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      varying vec3 vWorld;

      void main() {
        vec2 p = vWorld.xz * 0.55;
        float t = uTime;
        vec2 g = vec2(0.0);
        g.x += cos(p.x * 1.7 + p.y * 0.35 + t * 1.3) * 0.024;
        g.x += cos(p.x * 3.1 - p.y * 0.90 - t * 1.8) * 0.009;
        g.y += cos(p.y * 1.9 - p.x * 0.45 - t * 1.1) * 0.023;
        g.y += sin(p.x * 1.1 + p.y * 2.70 + t * 1.5) * 0.008;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 4.0);
        vec3 refl = reflect(-viewDir, n);
        vec3 sky = mix(uHorizon, uSky, clamp(refl.y * 0.9 + 0.18, 0.0, 1.0));
        vec3 base = mix(uDeep, uShallow, 0.28 + 0.20 * sin(p.x * 0.6 + p.y * 0.4));
        vec3 col = mix(base, sky, 0.06 + fres * 0.46);
        float spec = pow(max(dot(refl, uSunDir), 0.0), 110.0);
        col += uSunColor * spec * 0.95 * (1.0 - uNight * 0.65);
        float sparkle = pow(max(dot(refl, normalize(uSunDir + vec3(0.13, 0.0, 0.07))), 0.0), 220.0);
        col += uSunColor * sparkle * 0.45 * (1.0 - uNight * 0.5);
        col = mix(col, col * 0.22 + vec3(0.015, 0.03, 0.045), uNight * 0.55);
        gl_FragColor = vec4(col, 0.90);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })

  /* ---------------- land use areas ---------------- */
  const areaGeos = []
  const waterGeos = []
  data.areas.forEach((area, i) => {
    if (area.p.length < 3) return
    let geo
    try {
      geo = new THREE.ShapeGeometry(makeShape(area.p))
    } catch {
      return
    }
    geo.rotateX(-Math.PI / 2)
    const color = KIND_COLORS[area.k] || '#7d8370'
    setGeometryColor(geo, color)
    const pos = geo.attributes.position
    for (let v = 0; v < pos.count; v++) {
      pos.setY(v, terrainAt(pos.getX(v), pos.getZ(v)) + 0.02 + (i % 7) * 0.0012)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    if (area.k === 'water') waterGeos.push(geo)
    else areaGeos.push(geo)
  })
  if (areaGeos.length) {
    const merged = mergeGeometries(areaGeos, false)
    if (merged) {
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
      )
      mesh.receiveShadow = true
      mesh.position.y = 0.003
      group.add(mesh)
    }
  }
  if (waterGeos.length) {
    const merged = mergeGeometries(waterGeos, false)
    if (merged) {
      const water = new THREE.Mesh(merged, waterMaterial)
      water.receiveShadow = true
      water.renderOrder = 2
      group.add(water)
    }
  }

  // Rivers, streams, canals and drains are separate animated ribbons.
  if (data.waterways && data.waterways.length) {
    const bankGeos = []
    const waterwayGeos = []
    for (const way of data.waterways) {
      if (way.p.length < 2) continue
      const bank = ribbon(way.p, Math.max(2.6, way.w + 2.4), 0.021, 12, 1.0, way.p.map(([x, z]) => 0.021 + terrainAt(x, z)))
      if (bank) bankGeos.push(bank)
      const geo = ribbon(way.p, way.w, 0.034, 12, 1.0, way.p.map(([x, z]) => 0.034 + terrainAt(x, z)))
      if (geo) waterwayGeos.push(geo)
    }
    if (bankGeos.length) {
      const bankMesh = new THREE.Mesh(
        mergeGeometries(bankGeos, false),
        new THREE.MeshStandardMaterial({ color: '#3f5038', roughness: 1 }),
      )
      bankMesh.receiveShadow = true
      group.add(bankMesh)
      for (const g of bankGeos) g.dispose()
    }
    if (waterwayGeos.length) {
      const merged = mergeGeometries(waterwayGeos, false)
      const waterwayMesh = new THREE.Mesh(merged, waterMaterial)
      waterwayMesh.receiveShadow = true
      waterwayMesh.renderOrder = 2
      group.add(waterwayMesh)
      for (const g of waterwayGeos) g.dispose()
    }
  }

  /* ---------------- roads ---------------- */
  const roadGroups = new Map()
  const pathGeos = []
  const railGeos = []
  const roadInfo = new RoadInfo(data)

  // bridge profiles are shared by the deck, kerbs, parapets and car-height query
  const bridgeProfiles = new Map()
  data.roads.forEach((road, index) => {
    const flyover = !flatBridges &&
      !road.outer && road.b && !road.tn && road.p.length >= 2 && road.w >= 8.5 &&
      ['motorway', 'trunk', 'primary', 'secondary'].includes(road.t)
    if (flyover) bridgeProfiles.set(index, makeBridgeProfile(road))
  })

  /* ---------------- road guide / junctions ---------------- */
  const guideSegments = []
  const guideGrid = new Map()
  const GUIDE_CELL = 40
  data.roads.forEach((road, ri) => {
    if (road.p.length < 2) return
    for (let i = 0; i < road.p.length - 1; i++) {
      const [ax, az] = road.p[i]
      const [bx, bz] = road.p[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 1) continue
      guideSegments.push({ ri, i, ax, az, bx, bz, w: road.w, angle: Math.atan2(-(bx - ax), -(bz - az)) })
    }
  })
  guideSegments.forEach((seg, idx) => {
    const x0 = Math.floor(Math.min(seg.ax, seg.bx) / GUIDE_CELL)
    const x1 = Math.floor(Math.max(seg.ax, seg.bx) / GUIDE_CELL)
    const z0 = Math.floor(Math.min(seg.az, seg.bz) / GUIDE_CELL)
    const z1 = Math.floor(Math.max(seg.az, seg.bz) / GUIDE_CELL)
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = `${gx},${gz}`
        let list = guideGrid.get(k)
        if (!list) guideGrid.set(k, (list = []))
        list.push(idx)
      }
    }
  })

  function segmentsNear(x, z, radius = 14) {
    const gx = Math.floor(x / GUIDE_CELL)
    const gz = Math.floor(z / GUIDE_CELL)
    const seen = new Set()
    const out = []
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = guideGrid.get(`${gx + ox},${gz + oz}`)
        if (!list) continue
        for (const idx of list) {
          if (seen.has(idx)) continue
          seen.add(idx)
          const s = guideSegments[idx]
          const dx = s.bx - s.ax
          const dz = s.bz - s.az
          const l2 = dx * dx + dz * dz
          let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2
          t = Math.max(0, Math.min(1, t))
          const cx = s.ax + dx * t
          const cz = s.az + dz * t
          const d = Math.hypot(x - cx, z - cz)
          if (d <= radius) out.push({ seg: s, idx, dist: d, cx, cz, t })
        }
      }
    }
    out.sort((a, b) => a.dist - b.dist)
    return out
  }

  function nearestRoadInfo(x, z) {
    const near = segmentsNear(x, z, 24)
    if (!near.length) return null
    const n = near[0]
    return {
      roadIndex: n.seg.ri,
      segmentIndex: n.seg.i,
      t: n.t,
      cx: n.cx,
      cz: n.cz,
      dist: n.dist,
      width: n.seg.w,
      angle: n.seg.angle,
      name: data.roads[n.seg.ri]?.n || '',
      ref: data.roads[n.seg.ri]?.ref || '',
    }
  }

  function frontRoadInfo(x, z) {
    const near = segmentsNear(x, z, 26)
    if (!near.length) return null
    let n = near[0]
    for (const candidate of near) {
      const road = data.roads[candidate.seg.ri]
      if (road && (road.n || road.t !== 'service')) { n = candidate; break }
    }
    return {
      roadIndex: n.seg.ri,
      segmentIndex: n.seg.i,
      t: n.t,
      cx: n.cx,
      cz: n.cz,
      dist: n.dist,
      width: n.seg.w,
      angle: n.seg.angle,
    }
  }

  function roadGuidePath(x, z, yaw, maxDist = 60, count = 7) {
    const near = nearestRoadInfo(x, z)
    if (!near) return []
    const road = data.roads[near.roadIndex]
    if (!road || road.p.length < 2) return []
    const pts = road.p
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const a = pts[near.segmentIndex]
    const b = pts[near.segmentIndex + 1]
    const forward = fx * (b[0] - a[0]) + fz * (b[1] - a[1]) >= 0
    const path = [[near.cx, near.cz]]
    if (forward) {
      for (let i = near.segmentIndex + 1; i < pts.length; i++) path.push(pts[i])
    } else {
      for (let i = near.segmentIndex; i >= 0; i--) path.push(pts[i])
    }

    const targets = []
    const spacing = maxDist / count
    for (let i = 1; i <= count; i++) targets.push(spacing * i)

    const samples = []
    let acc = 0
    let ti = 0
    for (let i = 0; i < path.length - 1 && ti < targets.length; i++) {
      const [ax, az] = path[i]
      const [bx, bz] = path[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.01) continue
      while (ti < targets.length && targets[ti] <= acc + len) {
        const f = (targets[ti] - acc) / len
        samples.push({
          x: ax + (bx - ax) * f,
          z: az + (bz - az) * f,
          dx: bx - ax,
          dz: bz - az,
        })
        ti++
      }
      acc += len
    }
    return samples
  }

  // Keep only real turn junctions (a side road / a significant change of
  // direction), and add every traffic light as an allowed U-turn spot.
  const junctionPoints = []
  for (const [jx, jz] of data.junctions || []) {
    const nearSegs = segmentsNear(jx, jz, 16)
    if (nearSegs.length < 2) continue
    const angles = nearSegs.slice(0, 8).map((n) => ((n.seg.angle % Math.PI) + Math.PI) % Math.PI)
    let spread = 0
    for (let i = 0; i < angles.length; i++) {
      for (let j = i + 1; j < angles.length; j++) {
        let d = Math.abs(angles[i] - angles[j])
        if (d > Math.PI / 2) d = Math.PI - d
        if (d > spread) spread = d
      }
    }
    if (spread > 0.42) junctionPoints.push({ x: jx, z: jz, signal: false })
  }
  for (const [sx, sz] of data.signals || []) junctionPoints.push({ x: sx, z: sz, signal: true })

  const junctionGrid = new Map()
  const JUNCTION_CELL = 32
  junctionPoints.forEach((p) => {
    const k = `${Math.floor(p.x / JUNCTION_CELL)},${Math.floor(p.z / JUNCTION_CELL)}`
    let list = junctionGrid.get(k)
    if (!list) junctionGrid.set(k, (list = []))
    list.push(p)
  })

  function junctionInfoAt(x, z) {
    const gx = Math.floor(x / JUNCTION_CELL)
    const gz = Math.floor(z / JUNCTION_CELL)
    let best = Infinity
    let signal = false
    let near = false
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = junctionGrid.get(`${gx + ox},${gz + oz}`)
        if (!list) continue
        for (const p of list) {
          const d = Math.hypot(x - p.x, z - p.z)
          if (d < best) best = d
          if (p.signal && d < 30) signal = true
          if (d < 25) near = true
        }
      }
    }
    return { near, signal, dist: best }
  }

  // pale shoulders / kerb strips make the tarmac read clearly from the cockpit
  const shoulderGeos = []
  data.roads.forEach((road, index) => {
    if (road.p.length < 2) return
    if (road.t === 'service' || road.t === 'raceway') return
    const extra = road.t === 'motorway' || road.t === 'trunk' ? 2.6 : 1.5
    const prof = bridgeProfiles.get(index)
    // Outer-ring roads must still render inside the detailed core: the
    // router can legitimately use an outer-only motorway link near the core
    // boundary. Keep them slightly below core roads so duplicates do not
    // z-fight, but never remove the only visible copy of a road.
    const drop = road.outer ? 0.017 : 0
    const runs = [road.p]
    for (const run of runs) {
      const pts = resamplePolyline(run, 6).points.map((p) => [p.x, p.z])
      const shoulderHeights = terrainEdgeHeights(pts, road.w + extra, 0.038 - drop, terrainAt)
      const geo = prof
        ? ribbon(prof.coords, road.w + extra, 0.05 - drop, 10, 0.4, prof.heights.map((h, i) => 0.05 - drop + h - 0.016 + terrainAt(prof.coords[i][0], prof.coords[i][1])))
        : ribbon(pts, road.w + extra, 0.038 - drop, 10, 0.4, shoulderHeights)
      if (geo) {
        setGeometryColor(geo, '#918d82')
        shoulderGeos.push(geo)
      }
    }
  })
  if (shoulderGeos.length) {
    const merged = mergeGeometries(shoulderGeos, false)
    if (merged) {
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
      )
      mesh.receiveShadow = true
      mesh.renderOrder = 0
      group.add(mesh)
    }
  }

  data.roads.forEach((road, index) => {
    if (road.p.length < 2) return
    const plain = ['service', 'residential', 'living_street', 'raceway', 'road'].includes(road.t)
    const lanes = plain ? 0 : lanesFor(road.w)
    const key = plain ? 'plain' : `r${lanes}`
    const prof = bridgeProfiles.get(index)
    const drop = road.outer ? 0.017 : 0
    const runs = [road.p]
    let list = roadGroups.get(key)
    if (!list) roadGroups.set(key, (list = []))
    for (const run of runs) {
      const pts = resamplePolyline(run, 6).points.map((p) => [p.x, p.z])
      const roadHeights = terrainEdgeHeights(pts, road.w, 0.052 - drop, terrainAt)
      const geo = prof
        ? ribbon(prof.coords, road.w, 0.05 - drop, 12, 0.4, prof.heights.map((h, i) => 0.05 - drop + h + terrainAt(prof.coords[i][0], prof.coords[i][1])))
        : ribbon(pts, road.w, 0.052 - drop, 12, 0.4, roadHeights)
      if (geo) list.push(geo)
    }
  })

  for (const [key, geos] of roadGroups) {
    const merged = mergeGeometries(geos, false)
    if (!merged) continue
    const plain = key === 'plain'
    const lanes = plain ? 0 : parseInt(key.slice(1), 10)
    const map = roadTexture(lanes, plain)
    map.anisotropy = Math.min(16, maxAniso)
    const mat = new THREE.MeshStandardMaterial({
      map,
      roughness: 0.93,
      metalness: 0.02,
      color: plain ? 0xd6d6d0 : 0xdeded6,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(merged, mat)
    mesh.receiveShadow = true
    mesh.renderOrder = 1
    group.add(mesh)
  }

  /* ---------------- bridges ---------------- */
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0xb9b7ae, roughness: 0.9, metalness: 0.04 })
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x8f8d86, roughness: 0.95 })
  const underMat = new THREE.MeshStandardMaterial({ color: 0x77746c, roughness: 0.95, side: THREE.DoubleSide })
  const parapetGeos = []
  const pierGeos = []
  const underGeos = []
  const bridgeSegments = []

  for (const [index, prof] of bridgeProfiles) {
    const road = data.roads[index]
    const half = road.w / 2 + 0.18

    // dark underside slab
    underGeos.push(
      ribbon(prof.coords, road.w + 1.0, 0.05, 12, 0.3, prof.heights.map((h, i) => 0.05 + h - 0.42 + terrainAt(prof.coords[i][0], prof.coords[i][1]))),
    )

    for (let i = 0; i < prof.coords.length - 1; i++) {
      const [ax, az] = prof.coords[i]
      const [bx, bz] = prof.coords[i + 1]
      const groundA = terrainAt(ax, az)
      const groundB = terrainAt(bx, bz)
      const ha = 0.05 + prof.heights[i] + groundA
      const hb = 0.05 + prof.heights[i + 1] + groundB
      const dx = bx - ax
      const dz = bz - az
      const len = Math.hypot(dx, dz)
      if (len < 0.01) continue
      const nx = dz / len
      const nz = -dx / len
      const angle = Math.atan2(dx, dz)
      const mx = (ax + bx) / 2
      const mz = (az + bz) / 2
      const my = (ha + hb) / 2 + 0.33

      for (const side of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.22, 0.66, len + 0.08)
        g.rotateY(angle)
        g.translate(mx + nx * half * side, my, mz + nz * half * side)
        parapetGeos.push(g)

        // Deep side fascia closes the gap between the road deck and the
        // underside, so a flyover reads as a solid box-girder bridge rather
        // than a thin slab with a hollow black underside.
        const fascia = new THREE.BoxGeometry(0.24, 0.62, len + 0.08)
        fascia.rotateY(angle)
        fascia.translate(
          mx + nx * half * side,
          my - 0.52,
          mz + nz * half * side,
        )
        parapetGeos.push(fascia)
      }

      bridgeSegments.push({
        ax, az, bx, bz,
        ha: prof.heights[i], hb: prof.heights[i + 1],
        w: road.w / 2 + (road.t === 'motorway' || road.t === 'trunk' ? 3.0 : 2.2),
        name: road.n || '',
        ref: road.ref || '',
        roadIndex: index,
        dirX: dx / len,
        dirZ: dz / len,
      })
    }

    // simple piers under the wider flyovers
    const maxH = prof.deck
    if (maxH > 3.2 && prof.length > 55) {
      for (const t of [0.3, 0.5, 0.7]) {
        let bi = 0
        let best = Infinity
        for (let i = 0; i < prof.points.length; i++) {
          const d = Math.abs(prof.points[i].t - t)
          if (d < best) { best = d; bi = i }
        }
        const p = prof.points[bi]
        const h = prof.heights[bi]
        if (h < 2.4) continue
        for (const side of [-1, 1]) {
          const g = new THREE.BoxGeometry(0.55, h - 0.4, 0.55)
          g.translate(p.x + side * (road.w / 2 - 0.3), terrainAt(p.x, p.z) + (h - 0.4) / 2, p.z)
          pierGeos.push(g)
        }
      }
    }
  }

  function addMerged(geos, material, cast = true) {
    const valid = geos.filter(Boolean)
    if (!valid.length) return
    const merged = mergeGeometries(valid, false)
    if (!merged) return
    const mesh = new THREE.Mesh(merged, material)
    mesh.castShadow = cast
    mesh.receiveShadow = true
    group.add(mesh)
    for (const g of valid) g.dispose()
  }

  addMerged(underGeos, underMat, false)
  addMerged(parapetGeos, concreteMat, true)
  addMerged(pierGeos, pierMat, true)

  const bridgeGrid = new Map()
  const BRIDGE_CELL = 28
  bridgeSegments.forEach((seg, i) => {
    const x0 = Math.floor(Math.min(seg.ax, seg.bx) / BRIDGE_CELL)
    const x1 = Math.floor(Math.max(seg.ax, seg.bx) / BRIDGE_CELL)
    const z0 = Math.floor(Math.min(seg.az, seg.bz) / BRIDGE_CELL)
    const z1 = Math.floor(Math.max(seg.az, seg.bz) / BRIDGE_CELL)
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = `${gx},${gz}`
        let list = bridgeGrid.get(k)
        if (!list) bridgeGrid.set(k, (list = []))
        list.push(i)
      }
    }
  })

  function bridgeInfoAt(x, z, headingX = 0, headingZ = 0) {
    const headingLen = Math.hypot(headingX, headingZ)
    if (headingLen > 0.0001) {
      headingX /= headingLen
      headingZ /= headingLen
    }
    const gx = Math.floor(x / BRIDGE_CELL)
    const gz = Math.floor(z / BRIDGE_CELL)
    let bestD = Infinity
    let best = null
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = bridgeGrid.get(`${gx + ox},${gz + oz}`)
        if (!list) continue
        for (const i of list) {
          const s = bridgeSegments[i]
          const dx = s.bx - s.ax
          const dz = s.bz - s.az
          const l2 = dx * dx + dz * dz
          if (!l2) continue
          if (headingX || headingZ) {
            // A flyover only counts for a car travelling along its deck.
            // A road crossing underneath (or another bridge passing over)
            // must not lift the car onto this deck.
            const dot = Math.abs((headingX * s.dirX + headingZ * s.dirZ))
            if (dot < 0.55) continue
          }
          let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2
          t = Math.max(0, Math.min(1, t))
          const cx = s.ax + dx * t
          const cz = s.az + dz * t
          const d = Math.hypot(x - cx, z - cz)
          if (d <= s.w && d < bestD) {
            bestD = d
            best = {
              h: s.ha + (s.hb - s.ha) * t,
              name: s.name,
              ref: s.ref,
              roadIndex: s.roadIndex,
              dirX: s.dirX,
              dirZ: s.dirZ,
            }
          }
        }
      }
    }
    return best || { h: 0, name: '', ref: '', roadIndex: -1, dirX: 0, dirZ: 0 }
  }

  function bridgeHeightAt(x, z, headingX = 0, headingZ = 0) {
    return bridgeInfoAt(x, z, headingX, headingZ).h
  }

  for (const path of data.paths) {
    if (path.p.length < 2) continue
    const pathPts = resamplePolyline(path.p, 6).points.map((p) => [p.x, p.z])
    if (path.t === 'railway') {
      const geo = ribbon(pathPts, 3.2, 0.052, 8, 0.6, pathPts.map(([x, z]) => 0.052 + terrainAt(x, z)))
      if (geo) {
        setGeometryColor(geo, '#4a4a48')
        railGeos.push(geo)
      }
      continue
    }
    const w = path.t === 'cycleway' ? 2.2 : path.t === 'steps' ? 2.4 : 1.8
    const geo = ribbon(pathPts, w, 0.042, 6, 0.6, pathPts.map(([x, z]) => 0.042 + terrainAt(x, z)))
    if (geo) pathGeos.push(geo)
  }
  if (pathGeos.length) {
    const merged = mergeGeometries(pathGeos, false)
    const map = pathTexture()
    map.anisotropy = Math.min(8, maxAniso)
    const mesh = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({ map, color: 0xb9b5a9, roughness: 0.95, side: THREE.DoubleSide }),
    )
    mesh.receiveShadow = true
    mesh.renderOrder = 1
    group.add(mesh)
  }
  if (railGeos.length) {
    const merged = mergeGeometries(railGeos, false)
    if (merged) {
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      )
      mesh.receiveShadow = true
      group.add(mesh)
    }
  }

  /* ---------------- buildings ---------------- */
  const windowUniforms = { uNight: { value: 0 } }
  const facadeMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.06,
  })
  facadeMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = windowUniforms.uNight
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWPos;
         varying vec3 vWNormal;
         varying vec2 vFront;
         varying float vKind;
         attribute float aSeed;
         attribute vec2 aFront;
         attribute float aKind;
         varying float vSeed;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vWNormal = normalize(mat3(modelMatrix) * objectNormal);
         vFront = aFront;
         vKind = aKind;
         vSeed = aSeed;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWPos;
         varying vec3 vWNormal;
         varying vec2 vFront;
         varying float vKind;
         varying float vSeed;
         uniform float uNight;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float wall = 1.0 - smoothstep(0.28, 0.55, abs(vWNormal.y));
         float floorH = 3.05;
         float fy = fract(vWPos.y / floorH);
         float floorIdx = floor(vWPos.y / floorH);
         float style = fract(vSeed * 13.73);
         float hcoord = (vWPos.x + vWPos.z) / floorH + vSeed * 9.13;
         float fx = fract(hcoord);
         float frontness = smoothstep(0.50, 0.82, dot(normalize(vWNormal.xz + vec2(0.00001)), vFront)) * wall;
         float isHouse = 1.0 - step(0.5, vKind);
         float isShop = step(0.5, vKind) * (1.0 - step(1.5, vKind));
         float isApt = step(1.5, vKind) * (1.0 - step(2.5, vKind));
         float isInd = step(2.5, vKind) * (1.0 - step(3.5, vKind));
         float ground = 1.0 - step(0.5, floorIdx);

         float winW = mix(0.145, 0.205, style);
         float y0 = 0.37;
         float y1 = 0.70;
         float win = step(0.5 - winW, fx) * step(fx, 0.5 + winW);
         win *= step(y0, fy) * step(fy, y1);

         // Shophouses have a much wider ground-floor glass frontage.
         float shopW = 0.37;
         float shopGlass = isShop * frontness * ground;
         shopGlass *= step(0.12, fy) * step(fy, 0.91);
         shopGlass *= step(0.5 - shopW, fx) * step(fx, 0.5 + shopW);
         win = max(win, shopGlass);

         // Taller apartment blocks get wider window bays.
         float aptWin = isApt * step(0.32, fy) * step(fy, 0.78);
         aptWin *= step(0.5 - winW - 0.035, fx) * step(fx, 0.5 + winW + 0.035);
         win = max(win, aptWin);

         // Front doors, one per terrace unit.
         float du = fract((vWPos.x + vWPos.z) / 6.15 + vSeed * 0.37);
         float door = isHouse * frontness * ground * step(0.16, du) * step(du, 0.30);
         door *= step(vWPos.y, 2.25);
         float doorFrame = isHouse * frontness * ground;
         doorFrame *= step(0.135, du) * step(du, 0.325) * step(vWPos.y, 2.35);
         win *= 1.0 - door;

         // Factories and warehouses get a large roller-shutter door on the
         // road-facing ground floor instead of domestic windows.
         float indFx = fract((vWPos.x + vWPos.z) / 7.5 + vSeed * 3.1);
         float indDoor = isInd * frontness * ground;
         indDoor *= step(0.035, fy) * step(fy, 0.90);
         indDoor *= step(0.24, indFx) * step(indFx, 0.76);
         win *= 1.0 - indDoor;

         float winW2 = winW + 0.012;
         float winOuter = step(0.5 - winW2, fx) * step(fx, 0.5 + winW2);
         winOuter *= step(y0 - 0.012, fy) * step(fy, y1 + 0.012);
         float frame = max(winOuter - win, 0.0) * wall;
         float sill = frame * step(fy, y0) * step(y0 - 0.03, fy);

         float band = wall * (1.0 - smoothstep(0.0, 0.032, abs(fy - 0.012)));
         float plinth = wall * (1.0 - smoothstep(0.30, 0.40, vWPos.y));
         float pipe = wall * smoothstep(0.014, 0.0, abs(fx - 0.022));
         pipe *= step(0.30, vWPos.y);

         vec3 glass = mix(vec3(0.035, 0.055, 0.075), vec3(0.11, 0.145, 0.17), style);
         glass += vec3(0.08, 0.11, 0.13) * smoothstep(0.30, 0.80, 1.0 - fy);
         vec3 frameCol = vec3(0.63, 0.64, 0.61) * (0.82 + style * 0.18);
         vec3 doorCol = mix(vec3(0.12, 0.085, 0.06), vec3(0.30, 0.31, 0.29), step(0.5, style));
         vec3 shopCol = mix(vec3(0.04, 0.07, 0.09), vec3(0.09, 0.15, 0.18), style);

         // Concrete plinth, floor bands, door frames and window frames.
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.19, 0.17), plinth * 0.28);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.70, 0.65), band * 0.10);
         diffuseColor.rgb = mix(diffuseColor.rgb, frameCol, frame * 0.90);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.48, 0.47, 0.43), sill * 0.50);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.20, 0.18), pipe * 0.45);
         diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.92);
         diffuseColor.rgb = mix(diffuseColor.rgb, shopCol, shopGlass * 0.92);
         diffuseColor.rgb = mix(diffuseColor.rgb, frameCol, doorFrame * 0.55);
         diffuseColor.rgb = mix(diffuseColor.rgb, doorCol, door * 0.96);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.23, 0.26, 0.27), indDoor * 0.90);
         diffuseColor.rgb *= 1.0 - indDoor * 0.12 * step(0.5, fract(vWPos.y * 5.0));

         // Slightly weather the paint, especially near the ground.
         float grain = sin(vWPos.x * 2.7 + vWPos.z * 3.3 + vWPos.y * 5.1) * 0.012;
         diffuseColor.rgb *= 1.0 + grain * wall;
         diffuseColor.rgb *= 1.0 - wall * 0.055 * (1.0 - smoothstep(0.0, 3.0, vWPos.y));

         float lit = step(0.74 - style * 0.10, fract(sin(dot(vec2(floor(fx * 2.0), floorIdx + style * 17.0), vec2(12.9898, 78.233))) * 43758.5453));
         lit *= win;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * lit * uNight * 1.25;`,
      )
  }
  facadeMaterial.customProgramCacheKey = () => 'subang-facade-v4'

  const detailMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0.02,
    side: THREE.DoubleSide,
  })

  const buildingChunks = new Map()
  const chunkSize = 1200
  const roadOverlaps = findRoadOverlaps(data.buildings, data.roads)
  const yardTrees = []
  data.buildings.forEach((b, index) => {
    if (b.p.length < 3) return
    if (roadOverlaps.has(index) && b.k !== 'roof') return
    let cx = 0
    let cz = 0
    for (const [x, z] of b.p) { cx += x; cz += z }
    cx /= b.p.length
    cz /= b.p.length

    let geo
    try {
      geo = new THREE.ExtrudeGeometry(makeShape(b.p), {
        depth: b.h,
        bevelEnabled: false,
        steps: 1,
        curveSegments: 1,
      })
    } catch {
      return
    }
    geo.rotateX(-Math.PI / 2)
    const baseY = terrainAt(cx, cz)
    geo.translate(0, baseY, 0)
    geo.computeVertexNormals()
    const count = geo.attributes.position.count
    const colors = new Float32Array(count * 3)
    const wallHex = BUILDING_COLORS[Math.floor(hash2(index * 3.7, b.p[0][0]) * BUILDING_COLORS.length)]
    const roofHex = ROOF_COLORS[Math.floor(hash2(b.p[0][1], index * 1.9) * ROOF_COLORS.length)]
    const wall = new THREE.Color(wallHex)
    const roof = new THREE.Color(roofHex)
    const shade = 0.88 + hash2(index, b.p[0][0] + b.p[0][1]) * 0.22
    const normal = geo.attributes.normal
    for (let i = 0; i < count; i++) {
      const ny = normal.getY(i)
      let r, g, bl
      if (ny > 0.7) {
        r = roof.r; g = roof.g; bl = roof.b
      } else if (ny < -0.7) {
        r = 0.16; g = 0.16; bl = 0.15
      } else {
        r = wall.r * shade; g = wall.g * shade; bl = wall.b * shade
        if (ny > -0.2) { r *= 0.97; g *= 0.97; bl *= 0.97 }
      }
      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = bl
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const seed = hash2(index * 0.73 + 1.1, b.p[0][1] * 0.37)
    const seeds = new Float32Array(count)
    seeds.fill(seed)
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))

    const kind = buildingKindCode(b.k, b.h)
    const near = frontRoadInfo(cx, cz)
    let front = null
    if (near && near.dist > 0.35) {
      front = { x: (near.cx - cx) / near.dist, z: (near.cz - cz) / near.dist }
    }
    const fronts = new Float32Array(count * 2)
    const kinds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      fronts[i * 2] = front ? front.x : 0
      fronts[i * 2 + 1] = front ? front.z : 0
      kinds[i] = kind
    }
    geo.setAttribute('aFront', new THREE.BufferAttribute(fronts, 2))
    geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1))

    const frame = footprintFrame(b.p, front)
    const rowGroup = Math.floor(((frame.u0 + frame.u1) / 2) / 64)
    const rowSeed = (near ? near.roadIndex * 1.37 : index) + rowGroup * 0.77
    const detailRoofHex = ROOF_COLORS[Math.floor(hash2(rowSeed, b.p[0][1] * 0.03) * ROOF_COLORS.length)]
    const key = `${Math.floor(cx / chunkSize)},${Math.floor(cz / chunkSize)}`
    let chunk = buildingChunks.get(key)
    if (!chunk) {
      chunk = {
        geos: [],
        detailBatch: makeDetailBatch(),
        cx: Math.floor(cx / chunkSize) * chunkSize + chunkSize / 2,
        cz: Math.floor(cz / chunkSize) * chunkSize + chunkSize / 2,
        mesh: null,
        detailMesh: null,
      }
      buildingChunks.set(key, chunk)
    }
    // OSM building=roof is an open canopy, not a solid block. Rendering it as
    // walls hides the pumps and courtyards underneath (especially at petrol
    // stations), so keep only a thin slab and its columns.
    if (b.k === 'roof') {
      const nearFuel = (data.pois || []).some((p) => p.k === 'fuel' && Math.hypot(p.x - cx, p.z - cz) < 60)
      if (!nearFuel) {
        const uu = (frame.u0 + frame.u1) / 2
        const vv = (frame.v0 + frame.v1) / 2
        const rx = frame.ux * uu + frame.fx * vv
        const rz = frame.uz * uu + frame.fz * vv
        const uSpan = Math.max(2, frame.u1 - frame.u0)
        const vSpan = Math.max(2, frame.v1 - frame.v0)
        const yaw = Math.atan2(-frame.uz, frame.ux)
        const layerBase = Math.max(0, Number(b.l) || 0) * 3.0
        const roofBase = terrainAt(cx, cz) + Math.max(b.b || 0, layerBase)
        const roofY = roofBase + b.h
        addDetailBox(chunk.detailBatch, rx, roofY, rz, uSpan, 0.24, vSpan, yaw, roofHex)
        for (const [su, sv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const px = frame.ux * (uu + su * uSpan * 0.45) + frame.fx * (vv + sv * vSpan * 0.45)
          const pz = frame.uz * (uu + su * uSpan * 0.45) + frame.fz * (vv + sv * vSpan * 0.45)
          addDetailBox(chunk.detailBatch, px, roofY / 2, pz, 0.28, roofY, 0.28, yaw, '#8a877f')
        }
      }
      return
    }

    chunk.geos.push(geo)

    const houseLike = kind === 0
    const industrial = kind === 3
    const onNidoRoute = routeDistanceAt(cx, cz) < (mobile ? 105 : 165)
    const detailNear = (data.spawn
      ? Math.hypot(cx - data.spawn.x, cz - data.spawn.z) < (mobile ? 950 : 1500)
      : false) || onNidoRoute
    const detailShops = (data.spawn
      ? Math.hypot(cx - data.spawn.x, cz - data.spawn.z) < (mobile ? 1800 : 2600)
      : false) || onNidoRoute

    // Real Malaysian terraces have pitched tiled roofs; warehouses get a shallow gable.
    if (houseLike || industrial) {
      const peak = houseLike
        ? 1.12 + hash2(index * 1.7, b.p[0][0]) * 0.38
        : 0.55 + hash2(index * 2.1, b.p[0][1]) * 0.35
      addPitchedRoof(chunk.detailBatch, b, frame, wallHex, detailRoofHex, peak, baseY)
    }

    if (detailNear && houseLike) {
      detailBaseY = baseY
      addFrontYard(chunk.detailBatch, b, frame, near, seed, !mobile)
      detailBaseY = 0
      if (near) {
        const frontDist = frame.v1 - (frame.v0 + frame.v1) / 2
        const yard = near.dist - near.width / 2 - frontDist
        const frontage = frame.u1 - frame.u0
        if (yard > 2.0 && frontage > 5.0 && hash2(seed * 4.1, frame.u0) > 0.46) {
          const side = hash2(seed * 7.3, frame.v1) > 0.5 ? 1 : -1
          const uu = (frame.u0 + frame.u1) / 2 + side * (frontage / 2 - 0.55)
          const vv = frame.v1 + Math.min(yard * 0.68, 3.8)
          yardTrees.push({
            x: frame.ux * uu + frame.fx * vv,
            z: frame.uz * uu + frame.fz * vv,
            s: 0.44 + hash2(seed * 9.1, frame.u0 * 0.2) * 0.3,
          })
        }
      }
    }
    if (detailShops && kind === 1) {
      detailBaseY = baseY
      addShopFront(chunk.detailBatch, frame, near, seed)
      detailBaseY = 0
    }
    if (detailNear && (kind === 1 || kind === 2 || kind === 4) && !houseLike) {
      detailBaseY = baseY
      addParapet(chunk.detailBatch, b, frame, wallHex)
      detailBaseY = 0
    }
  })

  const buildingChunkList = []
  for (const chunk of buildingChunks.values()) {
    const merged = mergeGeometries(chunk.geos, false)
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, facadeMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    chunk.mesh = mesh

    if (chunk.detailBatch.pos.length) {
      const detailGeo = new THREE.BufferGeometry()
      detailGeo.setAttribute('position', new THREE.Float32BufferAttribute(chunk.detailBatch.pos, 3))
      detailGeo.setAttribute('color', new THREE.Float32BufferAttribute(chunk.detailBatch.col, 3))
      detailGeo.computeVertexNormals()
      const detailMesh = new THREE.Mesh(detailGeo, detailMaterial)
      detailMesh.castShadow = true
      detailMesh.receiveShadow = true
      group.add(detailMesh)
      chunk.detailMesh = detailMesh
      chunk.detailBatch.pos.length = 0
      chunk.detailBatch.col.length = 0
    }

    buildingChunkList.push(chunk)
    for (const g of chunk.geos) g.dispose()
    chunk.geos.length = 0
  }

  const cullPosition = new THREE.Vector3(1e9, 0, 1e9)
  function updateCulling(pos) {
    cullPosition.copy(pos)
    for (const c of buildingChunkList) {
      const visible = Math.hypot(pos.x - c.cx, pos.z - c.cz) < 3400
      c.mesh.visible = visible
      if (c.detailMesh) c.detailMesh.visible = visible
    }
  }

  /* ---------------- landmarks / POIs ---------------- */
  const landmarkBatch = makeDetailBatch()
  const signGroup = new THREE.Group()
  const structureGroup = new THREE.Group()
  group.add(signGroup, structureGroup)
  const signCache = new Map()

  function signMaterial(text, sub, style) {
    const key = `${text}|${sub}|${style.bg}|${style.fg}|${style.accent}`
    if (signCache.has(key)) return signCache.get(key)
    const tex = makeLabelTexture(text, sub, {
      w: 640,
      h: 128,
      bg: style.bg,
      fg: style.fg,
      accent: style.accent,
      border: true,
    })
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    signCache.set(key, mat)
    return mat
  }

  function addSignBoard(text, sub, x, y, z, yaw, width, height, style, posts = false) {
    const label = cleanLabel(text).slice(0, 30) || 'SUBANG JAYA'
    const mat = signMaterial(label, sub, style)
    const nx = Math.sin(yaw)
    const nz = Math.cos(yaw)
    const yy = y + detailBaseY
    addDetailBox(landmarkBatch, x, y, z, width + 0.18, height + 0.16, 0.13, yaw, style.dark || '#2b2c2a')
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat)
    mesh.position.set(x + nx * 0.09, yy, z + nz * 0.09)
    mesh.rotation.y = yaw
    signGroup.add(mesh)
    if (posts) {
      const tx = Math.cos(yaw)
      const tz = -Math.sin(yaw)
      for (const side of [-1, 1]) {
        addDetailBox(
          landmarkBatch,
          x + tx * side * width * 0.36,
          y * 0.5,
          z + tz * side * width * 0.36,
          0.12, y, 0.12, 0, '#4e4f4b',
        )
      }
    }
  }

  function placeRoadSign(poi, kind, opts = {}) {
    const name = cleanLabel(poi.n || poi.br || '')
    if (!name) return
    const near = frontRoadInfo(poi.x, poi.z)
    if (!near || near.dist < 0.5) return
    const dx = (poi.x - near.cx) / near.dist
    const dz = (poi.z - near.cz) / near.dist
    const edge = near.width / 2 + (opts.edge || 0.9)
    const x = near.cx + dx * edge
    const z = near.cz + dz * edge
    const yaw = Math.atan2(-dx, -dz)
    const style = opts.style || signColorFor(kind)
    const prevBase = detailBaseY
    detailBaseY = terrainAt(x, z)
    addSignBoard(
      name,
      opts.sub || style.sub,
      x,
      opts.y || 3.1,
      z,
      yaw,
      opts.w || 7.2,
      opts.h || 1.35,
      style,
      opts.posts !== false,
    )
    detailBaseY = prevBase
  }

  function nearestBuildingNear(x, z, kinds, maxDist = 90) {
    let best = null
    for (const b of data.buildings) {
      if (!kinds.has(b.k)) continue
      let cx = 0
      let cz = 0
      for (const [px, pz] of b.p) { cx += px; cz += pz }
      cx /= b.p.length
      cz /= b.p.length
      const d = Math.hypot(cx - x, cz - z)
      if (d < maxDist && (!best || d < best.d)) best = { b, cx, cz, d }
    }
    return best
  }

  function placeFacadeSign(poi, kind, kinds, opts = {}) {
    const target = nearestBuildingNear(poi.x, poi.z, kinds, opts.maxDist || 100)
    if (!target) return false
    const near = frontRoadInfo(target.cx, target.cz)
    let fx = 0
    let fz = 1
    if (near && near.dist > 0.2) {
      fx = (near.cx - target.cx) / near.dist
      fz = (near.cz - target.cz) / near.dist
    }
    const frame = footprintFrame(target.b.p, { x: fx, z: fz })
    const uc = (frame.u0 + frame.u1) / 2
    const vc = frame.v1
    const x = frame.ux * uc + frame.fx * vc + fx * 0.2
    const z = frame.uz * uc + frame.fz * vc + fz * 0.2
    const yaw = Math.atan2(fx, fz)
    const name = cleanLabel(poi.n || target.b.n || '')
    if (!name) return false
    const style = signColorFor(kind)
    const prevBase = detailBaseY
    detailBaseY = terrainAt(target.cx, target.cz)
    addSignBoard(name, opts.sub || style.sub, x, opts.y || Math.min(target.b.h * 0.7, 6.2), z, yaw, opts.w || 10, opts.h || 1.5, style, false)
    if (opts.dock) {
      // large roller door / loading bay on the factory frontage
      const dx = frame.ux * uc + frame.fx * (vc + 0.16)
      const dz = frame.uz * uc + frame.fz * (vc + 0.16)
      addDetailBox(landmarkBatch, dx, 2.05, dz, Math.min(8.5, (frame.u1 - frame.u0) * 0.32), 4.1, 0.22, Math.atan2(-frame.uz, frame.ux), '#273133')
      addDetailBox(landmarkBatch, dx + fx * 1.1, 4.3, dz + fz * 1.1, Math.min(10, (frame.u1 - frame.u0) * 0.38), 0.25, 2.2, Math.atan2(-frame.uz, frame.ux), '#555b5b')
    }
    detailBaseY = prevBase
    return true
  }

  function addFuelStation(poi) {
    const prevBase = detailBaseY
    detailBaseY = terrainAt(poi.x, poi.z)
    const name = cleanLabel(poi.n || poi.br || 'Petrol Station')
    const style = fuelBrandStyle(poi.br || poi.n || '')
    let cx = poi.x
    let cz = poi.z
    for (const area of data.areas) {
      if (area.k !== 'fuel') continue
      let ax = 0
      let az = 0
      for (const [x, z] of area.p) { ax += x; az += z }
      ax /= area.p.length
      az /= area.p.length
      if (Math.hypot(ax - poi.x, az - poi.z) < 65) { cx = ax; cz = az; break }
    }
    const near = frontRoadInfo(cx, cz)
    let fx = 0
    let fz = 1
    if (near && near.dist > 0.2) {
      fx = (near.cx - cx) / near.dist
      fz = (near.cz - cz) / near.dist
    }
    const ux = -fz
    const uz = fx
    const yaw = Math.atan2(-uz, ux)
    const local = (l, w, y) => [cx + ux * l + fx * w, y, cz + uz * l + fz * w]
    const box = (l, w, y, sl, sw, sh, col) => {
      const [x, yy, z] = local(l, w, y)
      addDetailBox(landmarkBatch, x, yy, z, sl, sh, sw, yaw, col)
    }

    // concrete forecourt
    box(0, 0, 0.06, 19, 13, 0.05, '#b8b4aa')
    // canopy
    box(0, 0, 4.92, 14, 8, 0.34, '#efeee6')
    for (const [l, w, col] of [
      [0, 4.12, style.main], [0, -4.12, style.main],
      [7.08, 0, style.main], [-7.08, 0, style.main],
    ]) {
      box(l, w, 4.62, l === 0 ? 14.1 : 0.25, l === 0 ? 0.25 : 8.1, 0.42, col)
    }
    for (const l of [-5.6, 5.6]) {
      for (const w of [-2.8, 2.8]) box(l, w, 2.48, 0.36, 0.36, 4.9, '#d9d6cb')
    }
    // pump islands and pumps
    for (const l of [-4.2, 0, 4.2]) {
      box(l, 0.3, 0.11, 0.9, 2.9, 0.16, '#dad6cc')
      box(l, 0.3, 0.86, 0.48, 0.42, 1.5, '#eeece4')
      box(l, 0.54, 1.1, 0.35, 0.12, 0.55, '#1f2b31')
      box(l, -0.02, 1.1, 0.35, 0.12, 0.55, '#1f2b31')
    }
    // small shop at the back
    box(0, -5.35, 1.62, 5.2, 3.6, 3.16, '#e2ded2')
    box(0, -3.53, 1.55, 4.3, 0.12, 2.2, '#1c2a31')
    box(1.6, -3.5, 3.05, 1.8, 0.12, 0.7, style.main)
    // price pylon near the road
    const signStyle = {
      bg: style.main,
      fg: style.light || '#ffffff',
      accent: style.accent,
      dark: style.dark,
      sub: 'FUEL',
    }
    const [px, , pz] = local(6.2, 5.4, 0)
    addDetailBox(landmarkBatch, px, 3.3, pz, 0.72, 6.6, 0.72, yaw, style.dark)
    const pylonYaw = Math.atan2(fx, fz)
    for (const flip of [0, Math.PI]) {
      const sy = pylonYaw + flip
      addSignBoard(name, 'FUEL', px + Math.sin(sy) * 0.41, 5.25, pz + Math.cos(sy) * 0.41, sy, 3.2, 1.35, signStyle, false)
    }
    // small brand band on the canopy frontage
    const [bx, , bz] = local(0, 4.24, 0)
    addSignBoard(name, 'FUEL', bx, 4.06, bz, pylonYaw, 5.4, 0.62, signStyle, false)
    detailBaseY = prevBase
  }

  function addNidoCampus() {
    const p = data.nido
    if (!p) return
    const prevBase = detailBaseY
    const base = terrainAt(p.x, p.z)
    detailBaseY = base
    const near = frontRoadInfo(p.x, p.z)
    let fx = 1
    let fz = 0
    if (near && near.dist > 0.25) {
      fx = (near.cx - p.x) / near.dist
      fz = (near.cz - p.z) / near.dist
    }
    const tx = -fz
    const tz = fx
    const yaw = Math.atan2(-tz, tx)
    const at = (along, front) => [p.x + tx * along + fx * front, p.z + tz * along + fz * front]
    const panel = (along, color) => {
      const [x, z] = at(along, 6.35)
      addDetailBox(landmarkBatch, x, 0.62, z, 2.75, 1.24, 0.14, yaw, color)
    }
    // Colourful childcare fence with an open gate at the frontage.
    panel(-5.4, '#4f9b94')
    panel(-2.7, '#e7be4d')
    panel(2.7, '#e7be4d')
    panel(5.4, '#4f9b94')
    for (const along of [-6.7, -1.35, 1.35, 6.7]) {
      const [x, z] = at(along, 6.35)
      addDetailBox(landmarkBatch, x, 0.7, z, 0.16, 1.4, 0.16, yaw, '#205b56')
    }
    for (const along of [-4.0, 4.0]) {
      const [x, z] = at(along, 3.15)
      addDetailBox(landmarkBatch, x, 0.07, z, 3.7, 0.1, 3.0, yaw, '#82b9a8')
    }
    // Small play deck, tower and slide behind the fence.
    {
      const [x, z] = at(-2.4, 2.7)
      addDetailBox(landmarkBatch, x, 0.48, z, 1.4, 0.92, 1.2, yaw, '#f0c14b')
      addDetailBox(landmarkBatch, x, 1.15, z, 1.6, 0.35, 1.4, yaw, '#d85a50')
      const [sx, sz] = at(0.05, 2.7)
      addDetailBox(landmarkBatch, sx, 0.62, sz, 1.9, 0.16, 0.7, yaw + 0.9, '#4e91c4')
      addDetailBox(landmarkBatch, sx, 0.28, sz, 0.6, 0.5, 0.6, yaw, '#4e91c4')
    }
    // Shade canopy over the entrance.
    {
      const [x, z] = at(0, 4.2)
      addDetailBox(landmarkBatch, x, 2.55, z, 4.4, 0.16, 2.1, yaw, '#f2e7c9')
      for (const along of [-1.6, 1.6]) {
        const [px, pz] = at(along, 3.2)
        addDetailBox(landmarkBatch, px, 1.3, pz, 0.13, 2.6, 0.13, yaw, '#205b56')
      }
    }
    // Nido frontage sign, facing the road.
    const [signX, signZ] = at(0, 6.58)
    const signYaw = Math.atan2(fx, fz)
    addSignBoard(
      'THE NIDO EARLY LEARNING',
      'CHILDCARE CENTRE',
      signX,
      2.12,
      signZ,
      signYaw,
      6.2,
      1.35,
      { bg: '#2f7f79', fg: '#ffffff', accent: '#f4c84a', dark: '#173f3a', sub: 'CHILDCARE' },
      true,
    )
    detailBaseY = prevBase
  }

  function addSunwayMedical() {
    const p = data.sunway
    if (!p) return
    const prevBase = detailBaseY
    const base = terrainAt(p.x, p.z)
    detailBaseY = base
    const near = frontRoadInfo(p.x, p.z)
    let fx = 0
    let fz = 1
    if (near && near.dist > 0.25) {
      fx = (near.cx - p.x) / near.dist
      fz = (near.cz - p.z) / near.dist
    }
    const tx = -fz
    const tz = fx
    const yaw = Math.atan2(-tz, tx)
    const at = (along, front) => [p.x + tx * along + fx * front, p.z + tz * along + fz * front]
    const box = (along, front, y, sx, sy, sz, color) => {
      const [x, z] = at(along, front)
      addDetailBox(landmarkBatch, x, y, z, sx, sy, sz, yaw, color)
    }
    // Main hospital towers, set back from Jalan Lagoon Selatan.
    box(-34, -17, 21, 20, 42, 18, '#d9dedb')
    box(-34, -17, 44, 21, 2.5, 19, '#aeb8b6')
    for (let i = 1; i <= 7; i++) box(-34, -17, i * 5, 20.2, 0.35, 18.2, '#78959a')
    box(12, -34, 16, 18, 32, 16, '#e4e3da')
    box(12, -34, 33, 19, 2, 17, '#aeb8b6')
    for (let i = 1; i <= 5; i++) box(12, -34, i * 5, 18.2, 0.35, 16.2, '#78959a')
    box(-2, -58, 10, 24, 20, 16, '#cfd6d2')
    // Entrance canopy and lobby, facing the road.
    box(-2, -8, 3.2, 18, 0.5, 7, '#e9e8df')
    for (const along of [-8, 4]) box(along, -4, 1.6, 0.35, 3.2, 0.35, '#d4d7d2')
    box(-2, -2, 2.5, 10, 4.8, 3.5, '#b7c5c4')
    // Emergency / ambulance bay.
    box(29, -11, 2.4, 12, 4.5, 8, '#c7d0ce')
    box(29, -11, 4.6, 12.4, 0.35, 8.4, '#b23b3b')
    // Main destination sign.
    const [sx, sz] = at(-2, 5.6)
    addSignBoard(
      'SUNWAY MEDICAL CENTRE',
      'HOSPITAL · 24 HOURS',
      sx,
      4.3,
      sz,
      Math.atan2(fx, fz),
      13.5,
      2.0,
      { bg: '#1d4f78', fg: '#ffffff', accent: '#e34b4b', dark: '#122b3d', sub: 'HOSPITAL' },
      true,
    )
    detailBaseY = prevBase
  }

  function addParkingCars(batch, area) {
    if (area.p.length < 3) return
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const [x, z] of area.p) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
    }
    if (maxX - minX < 3 || maxZ - minZ < 3) return
    const inside = (x, z) => {
      let hit = false
      for (let i = 0, j = area.p.length - 1; i < area.p.length; j = i++) {
        const [xi, zi] = area.p[i]
        const [xj, zj] = area.p[j]
        if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) hit = !hit
      }
      return hit
    }
    const colors = ['#d8d8d3', '#a9b0b4', '#24282a', '#7a2f2a', '#e4e0d7', '#3d5666']
    const prevBase = detailBaseY
    detailBaseY = 0
    let count = 0
    for (let z = minZ + 2.5; z < maxZ - 2.5 && count < 9; z += 4.8) {
      for (let x = minX + 2.2; x < maxX - 2.2 && count < 9; x += 3.0) {
        if (!inside(x, z) || !inside(x - 1, z - 1) || !inside(x + 1, z + 1)) continue
        if (hash2(x * 1.7, z * 2.3) > 0.66) continue
        const y = terrainAt(x, z)
        const yaw = hash2(x, z) > 0.5 ? 0 : Math.PI / 2
        addDetailBox(batch, x, y + 0.43, z, 1.72, 0.62, 4.05, yaw, colors[Math.floor(hash2(z, x) * colors.length)])
        addDetailBox(batch, x, y + 0.82, z - 0.15, 1.5, 0.34, 2.0, yaw, '#30383c')
        count++
      }
    }
    detailBaseY = prevBase
  }

  function addChimney(x, z, height = 16, color = '#c9c6ba', baseY = 0) {
    const geo = new THREE.CylinderGeometry(0.55, 0.85, 1, 9)
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.scale.y = height
    mesh.position.set(x, baseY + height / 2, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    structureGroup.add(mesh)
    const bandGeo = new THREE.CylinderGeometry(0.68, 0.7, 0.8, 9)
    const band = new THREE.Mesh(bandGeo, new THREE.MeshStandardMaterial({ color: '#a84236', roughness: 0.8 }))
    band.position.set(x, baseY + height * 0.72, z)
    structureGroup.add(band)
  }

  function addSilo(x, z, radius = 2.2, height = 7, baseY = 0) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 12)
    const mat = new THREE.MeshStandardMaterial({ color: '#b9bcb7', roughness: 0.6, metalness: 0.25 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, baseY + height / 2, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    structureGroup.add(mesh)
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 1.03, radius * 0.65, 12),
      new THREE.MeshStandardMaterial({ color: '#9fa39f', roughness: 0.65, metalness: 0.3 }),
    )
    cone.position.set(x, baseY + height + radius * 0.32, z)
    structureGroup.add(cone)
  }

  // Fuel stations, pitches and POI signs are real OSM features.
  addNidoCampus()
  addSunwayMedical()
  const sortedPois = (data.pois || []).slice().sort((a, b) => Math.hypot(a.x - data.spawn.x, a.z - data.spawn.z) - Math.hypot(b.x - data.spawn.x, b.z - data.spawn.z))
  for (const area of data.areas) {
    if (area.k === 'pitch' || area.k === 'stadium' || area.k === 'sports') {
      let ax = 0, az = 0
      for (const [x, z] of area.p) { ax += x; az += z }
      detailBaseY = terrainAt(ax / area.p.length, az / area.p.length)
      addFootballField(landmarkBatch, area)
      detailBaseY = 0
    } else if (area.k === 'parking') {
      let ax = 0, az = 0
      for (const [x, z] of area.p) { ax += x; az += z }
      ax /= area.p.length
      az /= area.p.length
      if (routeDistanceAt(ax, az) < 220) addParkingCars(landmarkBatch, area)
    }
  }

  let fuelDone = 0
  const signLimits = { school: 0, factory: 0, mosque: 0, hospital: 0, supermarket: 0, restaurant: 0, shop: 0, pharmacy: 0, fuel: 0 }
  for (const poi of sortedPois) {
    const d = Math.hypot(poi.x - data.spawn.x, poi.z - data.spawn.z)
    if (poi.k === 'fuel') {
      addFuelStation(poi)
      fuelDone++
      if (routeDistanceAt(poi.x, poi.z) < 240 && signLimits.fuel < 24) {
        const brand = fuelBrandStyle(poi.br || poi.n || '')
        placeRoadSign(poi, 'fuel', {
          w: 5.2,
          y: 3.5,
          posts: true,
          sub: 'FUEL',
          style: { bg: brand.main, fg: brand.light || '#ffffff', accent: brand.accent, dark: brand.dark, sub: 'FUEL' },
        })
        signLimits.fuel++
      }
      continue
    }
    if (d > 2600 && routeDistanceAt(poi.x, poi.z) > 200) continue
    if (poi.k === 'school' && signLimits.school < 28) {
      placeRoadSign(poi, 'school', { w: 8.2, y: 3.3, posts: true, sub: 'SEKOLAH' })
      placeFacadeSign(poi, 'school', new Set(['school', 'kindergarten', 'university', 'college']), {
        w: 11.5, h: 1.7, y: 6.0, sub: 'SEKOLAH',
      })
      signLimits.school++
    } else if (poi.k === 'factory' && signLimits.factory < 26) {
      placeRoadSign(poi, 'factory', { w: 7.8, y: 3.45, posts: true, sub: 'FACTORY' })
      placeFacadeSign(poi, 'factory', new Set(['industrial', 'warehouse', 'manufacture']), {
        w: 11, h: 1.8, y: 5.4, sub: 'FACTORY', dock: true,
      })
      signLimits.factory++
      if (d < 2000 && data.buildings) {
        const near = frontRoadInfo(poi.x, poi.z)
        const fx = near ? (near.cx - poi.x) / Math.max(near.dist, 0.1) : 0
        const fz = near ? (near.cz - poi.z) / Math.max(near.dist, 0.1) : 1
        const ux = -fz
        const uz = fx
        const side = hash2(poi.x, poi.z) > 0.5 ? 1 : -1
        addChimney(poi.x + ux * side * 6.5 - fx * 2.0, poi.z + uz * side * 6.5 - fz * 2.0, 14 + hash2(poi.x, poi.z) * 8, '#c9c6ba', terrainAt(poi.x, poi.z))
        if (hash2(poi.z, poi.x) > 0.6) addSilo(poi.x - ux * side * 5.5 - fx * 3.0, poi.z - uz * side * 5.5 - fz * 3.0, 1.8, 6, terrainAt(poi.x, poi.z))
      }
    } else if ((poi.k === 'mosque' || poi.k === 'worship') && signLimits.mosque < 20) {
      placeRoadSign(poi, poi.k, { w: 6.8, y: 3.0, posts: true, sub: poi.k === 'mosque' ? 'MASJID' : 'RUMAH IBADAT' })
      signLimits.mosque++
    } else if (poi.k === 'hospital' && signLimits.hospital < 14) {
      placeRoadSign(poi, 'hospital', { w: 6.0, y: 3.0, posts: true, sub: 'KLINIK' })
      signLimits.hospital++
    } else if (poi.k === 'supermarket' && signLimits.supermarket < 12) {
      placeRoadSign(poi, 'supermarket', { w: 5.6, y: 3.3, posts: false, sub: 'PASAR RAYA' })
      signLimits.supermarket++
    } else if ((poi.k === 'restaurant' || poi.k === 'cafe') && signLimits.restaurant < 20) {
      placeRoadSign(poi, 'restaurant', { w: 5.0, y: 3.2, posts: false, sub: poi.k === 'cafe' ? 'KAFE' : 'RESTORAN' })
      signLimits.restaurant++
    } else if (poi.k === 'pharmacy' && signLimits.pharmacy < 18) {
      placeRoadSign(poi, 'pharmacy', { w: 5.4, y: 3.25, posts: false, sub: 'FARMASI' })
      placeFacadeSign(poi, 'pharmacy', new Set(['pharmacy', 'shop', 'retail', 'commercial']), {
        w: 6.2, h: 1.2, y: 3.7, sub: 'FARMASI',
      })
      signLimits.pharmacy++
    } else if (poi.k === 'shop' && signLimits.shop < 34) {
      placeRoadSign(poi, 'shop', { w: 5.2, y: 3.2, posts: false, sub: 'KEDAI' })
      placeFacadeSign(poi, 'shop', new Set(['shop', 'retail', 'commercial', 'supermarket']), {
        w: 6.4, h: 1.2, y: 3.8, sub: 'KEDAI',
      })
      signLimits.shop++
    }
  }

  const domeMat = new THREE.MeshStandardMaterial({ color: 0xc7a24a, roughness: 0.36, metalness: 0.45 })
  const minaretMat = new THREE.MeshStandardMaterial({ color: 0xe8e1cf, roughness: 0.9 })

  // If a mosque is mapped only as a node, still give it a recognisable
  // prayer-house silhouette and sign.
  const mosqueStructures = new THREE.Group()
  group.add(mosqueStructures)
  if (data.pois) {
    for (const poi of data.pois) {
      if (poi.k !== 'mosque') continue
      const nearBuilding = nearestBuildingNear(poi.x, poi.z, new Set(['mosque', 'musalla']), 35)
      if (nearBuilding) continue
      const near = frontRoadInfo(poi.x, poi.z)
      const fx = near && near.dist > 0.2 ? (near.cx - poi.x) / near.dist : 0
      const fz = near && near.dist > 0.2 ? (near.cz - poi.z) / near.dist : 1
      const yaw = Math.atan2(-fz, fx)
      const mosqueBase = terrainAt(poi.x, poi.z)
      addDetailBox(landmarkBatch, poi.x, mosqueBase + 2.4, poi.z, 10, 4.8, 7, yaw, '#ece5d5')
      addDetailBox(landmarkBatch, poi.x + fx * 3.55, mosqueBase + 1.3, poi.z + fz * 3.55, 0.15, 2.6, 1.2, yaw, '#263c3a')
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat)
      dome.scale.y = 0.85
      dome.position.set(poi.x, mosqueBase + 4.8 + 0.25, poi.z)
      dome.castShadow = true
      mosqueStructures.add(dome)
      const minaret = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.45, 9, 8), minaretMat)
      minaret.position.set(poi.x + 4.8, mosqueBase + 4.5, poi.z - 2.0)
      mosqueStructures.add(minaret)
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 8), domeMat)
      cap.position.set(poi.x + 4.8, mosqueBase + 9.7, poi.z - 2.0)
      mosqueStructures.add(cap)
      if (poi.n) {
        placeRoadSign(poi, 'mosque', { w: 6.4, y: 3.0, posts: true, sub: 'SURAU' })
      }
    }
  }

  // A few landmark mosques get a dome and minaret.
  for (const b of data.buildings) {
    if (b.k !== 'mosque' && b.k !== 'musalla') continue
    let cx = 0
    let cz = 0
    for (const [x, z] of b.p) { cx += x; cz += z }
    cx /= b.p.length
    cz /= b.p.length
    if (data.spawn && Math.hypot(cx - data.spawn.x, cz - data.spawn.z) > 3200) continue
    const frame = footprintFrame(b.p, null)
    const uw = frame.u1 - frame.u0
    const vw = frame.v1 - frame.v0
    const radius = Math.max(1.2, Math.min(uw, vw) * 0.30)
    const mosqueBase = terrainAt(cx, cz)
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      domeMat,
    )
    dome.scale.y = 0.9
    dome.position.set(cx, mosqueBase + b.h + radius * 0.12, cz)
    dome.castShadow = true
    structureGroup.add(dome)
    const minaret = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.52, 10.5, 8), minaretMat)
    minaret.position.set(cx + frame.ux * (uw * 0.42), mosqueBase + 5.25, cz + frame.uz * (uw * 0.42))
    minaret.castShadow = true
    structureGroup.add(minaret)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.4, 8), domeMat)
    cap.position.set(cx + frame.ux * (uw * 0.42), mosqueBase + 11.2, cz + frame.uz * (uw * 0.42))
    structureGroup.add(cap)
  }

  // Simplified outer-ring buildings: the detailed OSM core is within about
  // 4–5 km of home, while the rest of the 20 km radius is represented by the
  // real major road network and terrain. These low-poly blocks keep the outer
  // suburbs from looking empty without loading hundreds of thousands of OSM
  // building footprints.
  const outerBatch = makeDetailBatch()
  // Outer blocks use absolute terrain heights; make sure no landmark detail
  // offset leaks in here, otherwise the whole outer city floats above ground.
  detailBaseY = 0
  if (data.terrain) {
    // Spatial lookup for the real OSM core, so outer LOD blocks fill the
    // gaps without being dropped on top of detailed buildings.
    const detailedCells = new Map()
    const DETAIL_CELL = 64
    for (const b of data.buildings) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const [x, z] of b.p) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
      for (let gx = Math.floor(minX / DETAIL_CELL); gx <= Math.floor(maxX / DETAIL_CELL); gx++) {
        for (let gz = Math.floor(minZ / DETAIL_CELL); gz <= Math.floor(maxZ / DETAIL_CELL); gz++) {
          const k = `${gx},${gz}`
          let list = detailedCells.get(k)
          if (!list) detailedCells.set(k, (list = []))
          list.push([minX, maxX, minZ, maxZ])
        }
      }
    }
    const nearDetailedBuilding = (x, z, radius = 28) => {
      const list = detailedCells.get(`${Math.floor(x / DETAIL_CELL)},${Math.floor(z / DETAIL_CELL)}`)
      if (!list) return false
      for (const [minX, maxX, minZ, maxZ] of list) {
        if (x > minX - radius && x < maxX + radius && z > minZ - radius && z < maxZ + radius) return true
      }
      return false
    }
    const outerRoads = data.roads.filter((r) => r.outer).slice()
    for (let i = outerRoads.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[outerRoads[i], outerRoads[j]] = [outerRoads[j], outerRoads[i]]
    }
    const townColors = ['#d8d1c3', '#c8c2b6', '#e0d9ca', '#bdb6a9', '#cfc2ad', '#d4cec2']
    const townRoofs = ['#8b4f3e', '#7b4a3b', '#6c6660', '#84716a', '#5e5952']
    let built = 0
    const maxBuildings = mobile ? 9000 : 30000
    const addTownBlock = (x, z, yaw) => {
      const h = 3.4 + rng() * 5.6
      const w = 6 + rng() * 10
      const depth = 6 + rng() * 11
      const y = terrainAt(x, z)
      const wall = townColors[Math.floor(rng() * townColors.length)]
      const roof = townRoofs[Math.floor(rng() * townRoofs.length)]
      addDetailBox(outerBatch, x, y + h / 2, z, w, h, depth, yaw, wall)
      addDetailBox(outerBatch, x, y + h + 0.1, z, w * 1.08, 0.2, depth * 1.08, yaw, roof)
      built++
    }

    // Give the complete Sunway route a proper built-up corridor first, even
    // where the outer LOD has no OSM footprints. This is what keeps the long
    // 20 km drive from turning into an empty green field.
    const sunwayRoute = Array.isArray(data.sunwayRoute) ? data.sunwayRoute : []
    for (let i = 0; i < sunwayRoute.length - 1 && built < maxBuildings; i++) {
      const [ax, az] = sunwayRoute[i]
      const [bx, bz] = sunwayRoute[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const len = Math.hypot(dx, dz)
      if (len < 8) continue
      const nx = dz / len
      const nz = -dx / len
      const yaw = Math.atan2(-dz, dx)
      for (let d = 18; d < len && built < maxBuildings; d += 46) {
        const t = d / len
        const cx = ax + dx * t
        const cz = az + dz * t
        for (const side of [-1, 1]) {
          if (built >= maxBuildings) break
          const off = 22 + rng() * 18
          const x = cx + nx * off * side
          const z = cz + nz * off * side
          if (nearDetailedBuilding(x, z, 30)) continue
          if (data.nido && Math.hypot(x - data.nido.x, z - data.nido.z) < 55) continue
          if (data.sunway && Math.hypot(x - data.sunway.x, z - data.sunway.z) < 120) continue
          addTownBlock(x, z, yaw + (rng() - 0.5) * 0.25)
        }
      }
    }
    // Wider frontage rows keep the corridor visibly built up even through
    // the interchange/field sections where the nearest-road test would
    // otherwise suppress every block.
    for (let i = 0; i < sunwayRoute.length - 1 && built < maxBuildings; i++) {
      const [ax, az] = sunwayRoute[i]
      const [bx, bz] = sunwayRoute[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const len = Math.hypot(dx, dz)
      if (len < 8) continue
      const nx = dz / len
      const nz = -dx / len
      const yaw = Math.atan2(-dz, dx)
      for (let d = 16; d < len && built < maxBuildings; d += 34) {
        const t = d / len
        const cx = ax + dx * t
        const cz = az + dz * t
        for (const side of [-1, 1]) {
          if (built >= maxBuildings) break
          const off = 30 + rng() * 25
          const x = cx + nx * off * side
          const z = cz + nz * off * side
          if (nearDetailedBuilding(x, z, 28)) continue
          if (data.nido && Math.hypot(x - data.nido.x, z - data.nido.z) < 60) continue
          if (data.sunway && Math.hypot(x - data.sunway.x, z - data.sunway.z) < 120) continue
          addTownBlock(x, z, yaw + (rng() - 0.5) * 0.2)
        }
      }
    }

    // Dense frontage rows for the Sunway corridor: even where OSM has no
    // footprints, the road should read as a built-up suburban route.
    for (let i = 0; i < sunwayRoute.length - 1 && built < maxBuildings; i++) {
      const [ax, az] = sunwayRoute[i]
      const [bx, bz] = sunwayRoute[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const len = Math.hypot(dx, dz)
      if (len < 8) continue
      const nx = dz / len
      const nz = -dx / len
      const yaw = Math.atan2(-dz, dx)
      for (let d = 10; d < len && built < maxBuildings; d += 24) {
        const t = d / len
        const cx = ax + dx * t
        const cz = az + dz * t
        for (const side of [-1, 1]) {
          if (built >= maxBuildings) break
          const off = 13 + rng() * 12
          const x = cx + nx * off * side
          const z = cz + nz * off * side
          if (nearDetailedBuilding(x, z, 26)) continue
          if (data.nido && Math.hypot(x - data.nido.x, z - data.nido.z) < 55) continue
          if (data.sunway && Math.hypot(x - data.sunway.x, z - data.sunway.z) < 110) continue
          const near = nearestRoadInfo(x, z)
          if (near && near.dist < near.width / 2 + 5) continue
          addTownBlock(x, z, yaw + (rng() - 0.5) * 0.2)
        }
      }
    }

    // Fill the remaining 20 km ring with low-poly town blocks. The detailed
    // OSM core is excluded by the building lookup; the grid keeps the outer
    // world from reading as empty green terrain between major roads.
    const waterAreas = data.areas.filter((a) => a.k === 'water')
    const fillStep = mobile ? 190 : 125
    const fillCap = mobile ? 5500 : 18000
    let filled = 0
    for (let gx = -20000; gx <= 20000 && filled < fillCap && built < maxBuildings; gx += fillStep) {
      for (let gz = -20000; gz <= 20000 && filled < fillCap && built < maxBuildings; gz += fillStep) {
        const jitterX = (hash2(gx * 0.013, gz * 0.021) - 0.5) * fillStep * 0.55
        const jitterZ = (hash2(gz * 0.017, gx * 0.011) - 0.5) * fillStep * 0.55
        const x = gx + jitterX
        const z = gz + jitterZ
        const dist = Math.hypot(x, z)
        if (dist > 20000) continue
        if (nearDetailedBuilding(x, z, 34)) continue
        if (data.nido && Math.hypot(x - data.nido.x, z - data.nido.z) < 65) continue
        if (data.sunway && Math.hypot(x - data.sunway.x, z - data.sunway.z) < 130) continue
        const near = nearestRoadInfo(x, z)
        if (near && near.dist < near.width / 2 + 8) continue
        if (waterAreas.some((a) => pointInPolygon(x, z, a.p))) continue
        const chance = dist < 4500 ? 0.24 : 0.48
        if (hash2(x * 0.37, z * 0.29) > chance) continue
        addTownBlock(x, z, hash2(x, z) * Math.PI * 2)
        filled++
      }
    }
    for (const road of outerRoads) {
      if (built >= maxBuildings) break
      for (let i = 0; i < road.p.length - 1 && built < maxBuildings; i++) {
        const a = road.p[i]
        const b = road.p[i + 1]
        const dx = b[0] - a[0]
        const dz = b[1] - a[1]
        const len = Math.hypot(dx, dz)
        if (len < 30) continue
        const nx = dz / len
        const nz = -dx / len
        let d = 45 + rng() * 40
        while (d < len && built < maxBuildings) {
          d += 65 + rng() * 55
          const side = rng() > 0.5 ? 1 : -1
          const off = 18 + rng() * 25
          const x = a[0] + (dx * Math.min(1, d / len)) + nx * off * side
          const z = a[1] + (dz * Math.min(1, d / len)) + nz * off * side
          if (nearDetailedBuilding(x, z, 28)) continue
          if (data.nido && Math.hypot(x - data.nido.x, z - data.nido.z) < 55) continue
          if (data.sunway && Math.hypot(x - data.sunway.x, z - data.sunway.z) < 90) continue
          const yaw = Math.atan2(-dz, dx) + (rng() - 0.5) * 0.3
          addTownBlock(x, z, yaw)
        }
      }
    }
  }
  if (outerBatch.pos.length) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(outerBatch.pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(outerBatch.col, 3))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, detailMaterial)
    mesh.castShadow = false
    mesh.receiveShadow = true
    group.add(mesh)
    outerBatch.pos.length = 0
    outerBatch.col.length = 0
  }

  if (landmarkBatch.pos.length) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(landmarkBatch.pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(landmarkBatch.col, 3))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, detailMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    landmarkBatch.pos.length = 0
    landmarkBatch.col.length = 0
  }

  /* ---------------- trees ---------------- */
  const treeData = []
  for (const t of data.trees) treeData.push({ x: t[0], z: t[1], s: t[2] })
  for (const t of data.satTrees || []) treeData.push({ x: t[0], z: t[1], s: t[2] })
  for (const t of yardTrees) treeData.push(t)

  // USJ 3 is much leafier than the sparse OSM tree points. Put a deterministic
  // row of street trees around the start area first so the avenue reads right.
  if (data.spawn) {
    const nearTypes = new Set(['residential', 'unclassified', 'tertiary', 'secondary'])
    for (const road of data.roads) {
      if (!nearTypes.has(road.t)) continue
      let dist = 10
      for (let i = 0; i < road.p.length - 1; i++) {
        const a = road.p[i]
        const b = road.p[i + 1]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (len < 1) continue
        const dx = (b[0] - a[0]) / len
        const dz = (b[1] - a[1]) / len
        while (dist < len) {
          dist += 20 + rng() * 12
          const mx = a[0] + dx * dist
          const mz = a[1] + dz * dist
          if (Math.hypot(mx - data.spawn.x, mz - data.spawn.z) > 1350) continue
          const side = rng() > 0.5 ? 1 : -1
          const offset = road.w / 2 + 1.45 + rng() * 1.1
          treeData.push({
            x: mx - dz * offset * side,
            z: mz + dx * offset * side,
            s: 0.78 + rng() * 0.5,
          })
        }
        dist -= len
      }
    }
  }

  const roadTypesForTrees = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified'])
  for (const road of data.roads) {
    if (!roadTypesForTrees.has(road.t)) continue
    let dist = 6
    for (let i = 0; i < road.p.length - 1; i++) {
      const a = road.p[i]
      const b = road.p[i + 1]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const dx = (b[0] - a[0]) / len
      const dz = (b[1] - a[1]) / len
      while (dist < len) {
        dist += 16 + rng() * 14
        if (rng() > 0.62) continue
        const side = rng() > 0.5 ? 1 : -1
        const offset = road.w / 2 + 1.35 + rng() * 1.5
        const x = a[0] + dx * dist - dz * offset * side
        const z = a[1] + dz * dist + dx * offset * side
        treeData.push({ x, z, s: 0.8 + rng() * 0.55 })
      }
      dist -= len
    }
  }

  for (const area of data.areas) {
    if (!['park', 'wood', 'grass', 'scrub'].includes(area.k)) continue
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const [x, z] of area.p) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const areaSize = (maxX - minX) * (maxZ - minZ)
    const want = Math.min(28, Math.floor(areaSize / 900))
    let added = 0
    for (let tries = 0; tries < want * 12 && added < want; tries++) {
      const x = minX + rng() * (maxX - minX)
      const z = minZ + rng() * (maxZ - minZ)
      if (!pointInPolygon(x, z, area.p)) continue
      treeData.push({ x, z, s: 0.75 + rng() * 0.8 })
      added++
    }
  }

  // de-duplicate and cap
  const trees = []
  const seen = new Set()
  for (const t of treeData) {
    const key = `${Math.round(t.x / 5)},${Math.round(t.z / 5)}`
    if (seen.has(key)) continue
    seen.add(key)
    trees.push(t)
    if (trees.length >= (mobile ? 1800 : 3200)) break
  }

  const instanced = { trunks: null, canopies: null }
  if (trees.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.17, 1, 5)
    trunkGeo.translate(0, 0.5, 0)
    const lobes = []
    const lobeSpec = [
      [1.0, 0, 0, 0],
      [0.72, 0.55, 0.28, 0.2],
      [0.68, -0.5, 0.18, -0.25],
      [0.55, 0.1, 0.55, -0.35],
    ]
    for (const [r, ox, oy, oz] of lobeSpec) {
      const ico = new THREE.IcosahedronGeometry(r, 0)
      ico.translate(ox, oy, oz)
      lobes.push(ico)
    }
    const canopyGeo = mergeGeometries(lobes, false)
    canopyGeo.computeVertexNormals()
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 1 })
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length)
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, trees.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    const col = new THREE.Color()
    const greens = ['#46632f', '#52703a', '#3d5b2c', '#5c7a40', '#445f30']
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i]
      const trunkH = (1.9 + rng() * 0.9) * t.s
      p.set(t.x, terrainAt(t.x, t.z), t.z)
      s.set(t.s * 0.95, trunkH, t.s * 0.95)
      m.compose(p, q, s)
      trunks.setMatrixAt(i, m)
      const cy = trunkH + 1.2 * t.s
      p.set(t.x, cy + terrainAt(t.x, t.z), t.z)
      s.set(1.32 * t.s, 1.45 * t.s, 1.32 * t.s)
      m.compose(p, q, s)
      canopies.setMatrixAt(i, m)
      col.set(greens[Math.floor(hash2(t.x, t.z) * greens.length)])
      canopies.setColorAt(i, col)
    }
    trunks.castShadow = true
    canopies.castShadow = true
    canopies.receiveShadow = false
    trunks.frustumCulled = false
    canopies.frustumCulled = false
    group.add(trunks, canopies)
    instanced.trunks = trunks
    instanced.canopies = canopies
  }

  /* ---------------- hedges / shrubs ---------------- */
  const shrubPositions = []
  for (const road of data.roads) {
    if (!['residential', 'tertiary', 'unclassified'].includes(road.t)) continue
    let dist = 4
    for (let i = 0; i < road.p.length - 1; i++) {
      const a = road.p[i]
      const b = road.p[i + 1]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const dx = (b[0] - a[0]) / len
      const dz = (b[1] - a[1]) / len
      while (dist < len) {
        dist += 9 + rng() * 9
        if (rng() > 0.62) continue
        const side = rng() > 0.5 ? 1 : -1
        const offset = road.w / 2 + 1.05 + rng() * 1.05
        const x = a[0] + dx * dist - dz * offset * side
        const z = a[1] + dz * dist + dx * offset * side
        shrubPositions.push({ x, z, s: 0.7 + rng() * 0.9 })
        if (shrubPositions.length > (mobile ? 800 : 1600)) break
      }
      dist -= len
      if (shrubPositions.length > (mobile ? 800 : 1600)) break
    }
    if (shrubPositions.length > (mobile ? 800 : 1600)) break
  }
  if (shrubPositions.length) {
    const shrubGeo = new THREE.IcosahedronGeometry(0.62, 0)
    const shrubMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })
    const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, shrubPositions.length)
    shrubs.castShadow = false
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const sc = new THREE.Vector3()
    const col = new THREE.Color()
    const greens = ['#3d562a', '#496330', '#365027', '#536d39']
    for (let i = 0; i < shrubPositions.length; i++) {
      const t = shrubPositions[i]
      p.set(t.x, terrainAt(t.x, t.z) + 0.34 + t.s * 0.18, t.z)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(t.x, t.z) * Math.PI * 2)
      sc.set(t.s * 1.25, t.s * 0.8, t.s * 1.25)
      m.compose(p, q, sc)
      shrubs.setMatrixAt(i, m)
      col.set(greens[Math.floor(hash2(t.z, t.x) * greens.length)])
      shrubs.setColorAt(i, col)
    }
    shrubs.castShadow = true
    shrubs.frustumCulled = false
    group.add(shrubs)
  }

  /* ---------------- street lights ---------------- */
  const lampPositions = []
  const lampGround = []
  for (const road of data.roads) {
    if (!['primary', 'secondary', 'tertiary', 'unclassified'].includes(road.t)) continue
    let dist = 20
    for (let i = 0; i < road.p.length - 1; i++) {
      const a = road.p[i]
      const b = road.p[i + 1]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const dx = (b[0] - a[0]) / len
      const dz = (b[1] - a[1]) / len
      while (dist < len) {
        dist += 34 + rng() * 12
        const side = lampGround.length % 2 === 0 ? 1 : -1
        const offset = road.w / 2 + 1.2
        const x = a[0] + dx * dist - dz * offset * side
        const z = a[1] + dz * dist + dx * offset * side
        if (roadInfo.onRoad(x, z)) continue
        const angle = Math.atan2(-dx * side, -dz * side)
        lampPositions.push({ x, z, angle })
      }
      dist -= len
    }
    if (lampPositions.length > 650) break
  }

  let lampMat = null
  let lampGlow = null
  if (lampPositions.length) {
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 7.4, 5)
    poleGeo.translate(0, 3.7, 0)
    const armGeo = new THREE.BoxGeometry(1.6, 0.09, 0.09)
    armGeo.translate(0.8, 7.35, 0)
    const headGeo = new THREE.BoxGeometry(0.62, 0.11, 0.24)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3c3f41, roughness: 0.7, metalness: 0.5 })
    lampMat = new THREE.MeshStandardMaterial({
      color: 0x6a6a60,
      emissive: 0xffc879,
      emissiveIntensity: 0,
      roughness: 0.4,
    })
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampPositions.length)
    const arms = new THREE.InstancedMesh(armGeo, poleMat, lampPositions.length)
    const heads = new THREE.InstancedMesh(headGeo, lampMat, lampPositions.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3(1, 1, 1)
    const up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < lampPositions.length; i++) {
      const l = lampPositions[i]
      q.setFromAxisAngle(up, l.angle)
      p.set(l.x, terrainAt(l.x, l.z), l.z)
      m.compose(p, q, s)
      poles.setMatrixAt(i, m)
      arms.setMatrixAt(i, m)
      const hx = l.x + Math.sin(l.angle) * 1.6
      const hz = l.z + Math.cos(l.angle) * 1.6
      p.set(hx, terrainAt(hx, hz) + 7.35, hz)
      m.compose(p, q, s)
      heads.setMatrixAt(i, m)
      lampPositions[i].gx = hx
      lampPositions[i].gz = hz
    }
    poles.castShadow = true
    poles.frustumCulled = false
    arms.frustumCulled = false
    heads.frustumCulled = false
    group.add(poles, arms, heads)

    const gp = new Float32Array(lampPositions.length * 3)
    lampPositions.forEach((l, i) => {
      gp[i * 3] = l.gx
      gp[i * 3 + 1] = terrainAt(l.gx, l.gz) + 7.25
      gp[i * 3 + 2] = l.gz
    })
    const gGeo = new THREE.BufferGeometry()
    gGeo.setAttribute('position', new THREE.BufferAttribute(gp, 3))
    lampGlow = new THREE.Points(
      gGeo,
      new THREE.PointsMaterial({
        map: glowTexture(),
        color: 0xffc879,
        size: 7,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    )
    lampGlow.frustumCulled = false
    group.add(lampGlow)
  }

  /* ---------------- traffic lights ---------------- */
  if (data.signals && data.signals.length) {
    const signalPoleMat = new THREE.MeshStandardMaterial({ color: 0x2f3336, roughness: 0.7, metalness: 0.5 })
    const signalHeadMat = new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.8 })
    const redMat = new THREE.MeshStandardMaterial({ color: 0x3a0805, emissive: 0xff2d1c, emissiveIntensity: 1.4 })
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0x3a2a04, emissive: 0xffb020, emissiveIntensity: 0.05 })
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x04321c, emissive: 0x37e06a, emissiveIntensity: 0.05 })
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 3.6, 6)
    poleGeo.translate(0, 1.8, 0)
    const headGeo = new THREE.BoxGeometry(0.42, 1.06, 0.3)
    headGeo.translate(0, 4.0, 0)
    const lampGeo = new THREE.CircleGeometry(0.12, 12)
    const poles = new THREE.InstancedMesh(poleGeo, signalPoleMat, data.signals.length)
    const heads = new THREE.InstancedMesh(headGeo, signalHeadMat, data.signals.length)
    const reds = new THREE.InstancedMesh(lampGeo, redMat, data.signals.length)
    const yellows = new THREE.InstancedMesh(lampGeo, yellowMat, data.signals.length)
    const greens = new THREE.InstancedMesh(lampGeo, greenMat, data.signals.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const qLamp = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    const up = new THREE.Vector3(0, 1, 0)
    data.signals.forEach(([x, z], i) => {
      // OSM signal nodes are usually on the road centreline. Put the pole on
      // the verge instead of leaving it standing in the traffic lane.
      const near = nearestRoadInfo(x, z)
      let sx = x
      let sz = z
      let yaw = hash2(x, z) * Math.PI * 2
      if (near) {
        const side = hash2(x * 1.7, z * 2.3) > 0.5 ? 1 : -1
        const nx = Math.cos(near.angle) * side
        const nz = -Math.sin(near.angle) * side
        const offset = near.width / 2 + 0.72
        sx = near.cx + nx * offset
        sz = near.cz + nz * offset
        yaw = Math.atan2(-nx, -nz)
      }
      q.setFromAxisAngle(up, yaw)
      const signalGround = terrainAt(sx, sz)
      p.set(sx, signalGround, sz)
      m.compose(p, q, one)
      poles.setMatrixAt(i, m)
      p.set(sx, signalGround, sz)
      m.compose(p, q, one)
      heads.setMatrixAt(i, m)
      qLamp.setFromAxisAngle(up, yaw + Math.PI)
      const offX = -0.155 * Math.sin(yaw)
      const offZ = -0.155 * Math.cos(yaw)
      const lampAt = (mesh, y) => {
        p.set(sx + offX, y + signalGround, sz + offZ)
        m.compose(p, qLamp, one)
        mesh.setMatrixAt(i, m)
      }
      lampAt(reds, 4.32)
      lampAt(yellows, 4.02)
      lampAt(greens, 3.72)
    })
    for (const mesh of [poles, heads, reds, yellows, greens]) {
      mesh.frustumCulled = false
      group.add(mesh)
    }
  }

  /* ---------------- bus stop signs ---------------- */
  if (data.busStops && data.busStops.length) {
    const signTexture = makeLabelTexture('HENTIAN BAS', 'bus stop', {
      w: 256,
      h: 128,
      bg: 'rgba(20,64,116,0.96)',
      fg: '#ffffff',
      accent: '#d9e8ff',
    })
    const signMat = new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.7, side: THREE.DoubleSide })
    const signGeo = new THREE.PlaneGeometry(0.9, 0.45)
    const postMat = new THREE.MeshStandardMaterial({ color: 0x5a5e60, roughness: 0.6, metalness: 0.5 })
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.6, 5)
    const posts = new THREE.InstancedMesh(postGeo, postMat, data.busStops.length)
    const signs = new THREE.InstancedMesh(signGeo, signMat, data.busStops.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    const up = new THREE.Vector3(0, 1, 0)
    data.busStops.forEach(([x, z], i) => {
      pos.set(x, terrainAt(x, z) + 1.3, z)
      m.compose(pos, q.identity(), one)
      posts.setMatrixAt(i, m)
      q.setFromAxisAngle(up, hash2(x, z) * Math.PI * 2)
      pos.set(x, terrainAt(x, z) + 2.5, z)
      m.compose(pos, q, one)
      signs.setMatrixAt(i, m)
    })
    posts.frustumCulled = false
    signs.frustumCulled = false
    group.add(posts, signs)
  }

  /* ---------------- water query ---------------- */
  const waterAreas = data.areas.filter((a) => a.k === 'water')
  const waterWays = (data.waterways || []).filter((w) => w.w >= 3 && ['river', 'stream', 'canal'].includes(w.k))
  const waterCells = new Map()
  const WATER_CELL = 32
  for (const area of waterAreas) {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [x, z] of area.p) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    for (let gx = Math.floor(minX / WATER_CELL); gx <= Math.floor(maxX / WATER_CELL); gx++) {
      for (let gz = Math.floor(minZ / WATER_CELL); gz <= Math.floor(maxZ / WATER_CELL); gz++) {
        const k = `${gx},${gz}`
        let list = waterCells.get(k)
        if (!list) waterCells.set(k, (list = []))
        list.push({ t: 'area', area })
      }
    }
  }
  for (const way of waterWays) {
    for (let i = 0; i < way.p.length - 1; i++) {
      const [ax, az] = way.p[i]
      const [bx, bz] = way.p[i + 1]
      const minX = Math.min(ax, bx) - way.w
      const maxX = Math.max(ax, bx) + way.w
      const minZ = Math.min(az, bz) - way.w
      const maxZ = Math.max(az, bz) + way.w
      for (let gx = Math.floor(minX / WATER_CELL); gx <= Math.floor(maxX / WATER_CELL); gx++) {
        for (let gz = Math.floor(minZ / WATER_CELL); gz <= Math.floor(maxZ / WATER_CELL); gz++) {
          const k = `${gx},${gz}`
          let list = waterCells.get(k)
          if (!list) waterCells.set(k, (list = []))
          list.push({ t: 'way', way, ax, az, bx, bz })
        }
      }
    }
  }
  function waterAt(x, z) {
    const list = waterCells.get(`${Math.floor(x / WATER_CELL)},${Math.floor(z / WATER_CELL)}`)
    if (!list) return false
    for (const item of list) {
      if (item.t === 'area') {
        if (pointInPolygon(x, z, item.area.p)) return true
      } else {
        const dx = item.bx - item.ax
        const dz = item.bz - item.az
        const l2 = dx * dx + dz * dz
        let t = l2 > 0 ? ((x - item.ax) * dx + (z - item.az) * dz) / l2 : 0
        t = Math.max(0, Math.min(1, t))
        if (Math.hypot(x - (item.ax + dx * t), z - (item.az + dz * t)) < item.way.w / 2) return true
      }
    }
    return false
  }

  /* ---------------- moving traffic ---------------- */
  const trafficCars = []
  const trafficRoot = new THREE.Group()
  trafficRoot.name = 'moving-traffic'
  group.add(trafficRoot)
  {
    const carBodyGeo = new THREE.BoxGeometry(1.68, 0.56, 4.0)
    const carCabinGeo = new THREE.BoxGeometry(1.4, 0.48, 1.82)
    const wheelGeo = new THREE.BoxGeometry(0.24, 0.5, 0.56)
    const lightGeo = new THREE.BoxGeometry(0.38, 0.12, 0.06)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.95 })
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1d2a30, roughness: 0.35, metalness: 0.25 })
    const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff3a28, toneMapped: false })
    const headLightMat = new THREE.MeshBasicMaterial({ color: 0xffe8b0, toneMapped: false })
    const colors = ['#e8e7e2', '#c9ccd0', '#2e3235', '#8f3030', '#3b5d7b', '#6d7173', '#d6d1c5', '#a99d8c']
    const trafficRoads = []
    for (const road of data.roads) {
      if (!['primary', 'secondary', 'tertiary', 'residential', 'unclassified'].includes(road.t)) continue
      if (road.tn || road.p.length < 2) continue
      let len = 0
      const cumulative = [0]
      for (let i = 0; i < road.p.length - 1; i++) {
        len += Math.hypot(road.p[i + 1][0] - road.p[i][0], road.p[i + 1][1] - road.p[i][1])
        cumulative.push(len)
      }
      if (len < 70) continue
      let minSpawn = Infinity
      let minHome = Infinity
      for (const [x, z] of road.p) {
        minSpawn = Math.min(minSpawn, Math.hypot(x - data.spawn.x, z - data.spawn.z))
        minHome = Math.min(minHome, Math.hypot(x - 93.8, z + 714.2))
      }
      trafficRoads.push({ road, len, cumulative, near: minSpawn < 1200 || minHome < 1200 })
    }
    const picks = []
    const nearRoads = trafficRoads.filter((r) => r.near)
    const nearCount = mobile ? 4 : 10
    const allCount = mobile ? 4 : 10
    for (let i = 0; i < nearCount && nearRoads.length; i++) picks.push(nearRoads[Math.floor(rng() * nearRoads.length)])
    for (let i = 0; i < allCount && trafficRoads.length; i++) picks.push(trafficRoads[Math.floor(rng() * trafficRoads.length)])
    for (const info of picks) {
      const road = info.road
      let dir = 1
      if (road.ow && !road.owb) dir = 1
      else if (road.owb) dir = -1
      else dir = rng() > 0.5 ? 1 : -1
      const color = colors[Math.floor(rng() * colors.length)]
      const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.12 })
      const car = new THREE.Group()
      const body = new THREE.Mesh(carBodyGeo, bodyMat)
      body.position.y = 0.48
      body.castShadow = true
      body.receiveShadow = true
      car.add(body)
      const cabin = new THREE.Mesh(carCabinGeo, glassMat)
      cabin.position.set(0, 0.9, 0.1)
      car.add(cabin)
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.06, 1.62), bodyMat)
      roof.position.set(0, 1.16, 0.1)
      car.add(roof)
      for (const wx of [-0.77, 0.77]) {
        for (const wz of [-1.25, 1.25]) {
          const wheel = new THREE.Mesh(wheelGeo, wheelMat)
          wheel.position.set(wx, 0.28, wz)
          car.add(wheel)
        }
      }
      for (const lx of [-0.6, 0.6]) {
        const tail = new THREE.Mesh(lightGeo, redLightMat)
        tail.position.set(lx, 0.48, 2.02)
        car.add(tail)
        const head = new THREE.Mesh(lightGeo, headLightMat)
        head.position.set(lx, 0.48, -2.02)
        car.add(head)
      }
      car.position.set(road.p[0][0], 0.055, road.p[0][1])
      trafficRoot.add(car)
      trafficCars.push({
        car,
        info,
        dir,
        travel: rng() * info.len,
        speed: 6.5 + rng() * 7,
      })
    }
  }

  function sampleTraffic(info, travel, dir) {
    const pts = info.road.p
    const cumulative = info.cumulative
    const target = dir > 0 ? travel % info.len : info.len - (travel % info.len)
    let i = 0
    while (i < cumulative.length - 2 && cumulative[i + 1] < target) i++
    const segLen = cumulative[i + 1] - cumulative[i] || 1
    const t = Math.max(0, Math.min(1, (target - cumulative[i]) / segLen))
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz) || 1
    let fx = dx / len
    let fz = dz / len
    if (dir < 0) { fx = -fx; fz = -fz }
    const x = a[0] + dx * t
    const z = a[1] + dz * t
    // Malaysia drives on the left; offset the sprite car into its lane.
    const lane = 1.45
    const px = x + fz * lane
    const pz = z - fx * lane
    const h = bridgeHeightAt(px, pz, fx, fz) + terrainHeightAt(data, px, pz)
    return { x: px, z: pz, y: h, fx, fz }
  }

  function updateTraffic(dt) {
    for (const tc of trafficCars) {
      tc.travel += tc.speed * dt
      if (tc.travel > tc.info.len) tc.travel %= tc.info.len
      const p = sampleTraffic(tc.info, tc.travel, tc.dir)
      tc.car.position.set(p.x, 0.055 + p.y, p.z)
      tc.car.rotation.y = Math.atan2(-p.fx, -p.fz)
    }
  }

  /* ---------------- expose ---------------- */
  // building=roof is an open canopy (LRT platforms, bus stations, petrol
  // station canopies). Its footprint must not act as a solid wall across the
  // road underneath. Buildings whose footprint covers a road are overhead
  // structures or bad footprints, so they must not block ground traffic.
  const collision = new BuildingCollision(
    data.buildings.filter((b, index) => b.k !== 'roof' && !roadOverlaps.has(index)),
    26,
    terrainAt,
  )

  function setNight(n) {
    windowUniforms.uNight.value = n
    waterUniforms.uNight.value = n
    if (lampMat) lampMat.emissiveIntensity = n * 1.9
    if (lampGlow) lampGlow.material.opacity = n * 0.75
  }

  function updateWater(dt) {
    waterUniforms.uTime.value += Math.min(dt, 0.1)
  }

  return {
    group,
    collision,
    roadInfo,
    nearestRoadInfo,
    roadGuidePath,
    junctionInfoAt,
    bridgeHeightAt,
    bridgeInfoAt,
    spawn: data.spawn,
    bounds,
    setNight,
    updateWater,
    waterAt,
    updateTraffic,
    terrainHeightAt: terrainAt,
    updateCulling,
    stats: { buildings: data.buildings.length, trees: trees.length, lamps: lampPositions.length, chunks: buildingChunkList.length, traffic: trafficCars.length },
    windowUniforms,
    dispose() {
      scene.remove(group)
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of mats) {
            if (m.map) m.map.dispose()
            m.dispose()
          }
        }
      })
    },
  }
}

function pointInPolygon(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1]
    const xj = poly[j][0], zj = poly[j][1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
