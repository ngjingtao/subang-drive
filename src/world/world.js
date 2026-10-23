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
}

const BUILDING_COLORS = [
  '#cfc8b8', '#d8d3c6', '#c4c1b7', '#b6b3ab', '#c9bda9', '#ded9cd',
  '#b0aea7', '#d3c3ae', '#a8aaa5', '#e2ded4', '#bdb6a8', '#c1b9a7',
]
const ROOF_COLORS = ['#7c4a3b', '#6d4537', '#77716a', '#5d5952', '#8d5747', '#665d55']

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
    const vy = heights ? heights[i] : y
    verts.push(
      [p.x + nrm.x * half, vy, p.y + nrm.y * half],
      [p.x - nrm.x * half, vy, p.y - nrm.y * half],
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
  const heights = points.map((p) => deck * smoothstep(p.t))
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
  constructor(buildings, cell = 26) {
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
      const box = { minX, maxX, minZ, maxZ, h: b.h, p: b.p }
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

  resolve(pos, radius) {
    const gx = Math.floor(pos.x / this.cell)
    const gz = Math.floor(pos.z / this.cell)
    const boxes = this.map.get(`${gx},${gz}`)
    if (!boxes) return null
    for (const b of boxes) {
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

  /* ---------------- ground ---------------- */
  const grass = grassTexture()
  grass.anisotropy = Math.min(8, maxAniso)
  grass.repeat.set(2000, 2000)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 1, color: 0xd8d8cf }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.03
  ground.receiveShadow = true
  group.add(ground)

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
    geo.translate(0, 0.02 + (i % 7) * 0.0012, 0)
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
      const water = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.12,
          metalness: 0.15,
          transparent: true,
          opacity: 0.92,
        }),
      )
      water.receiveShadow = true
      group.add(water)
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
      road.b && !road.tn && road.p.length >= 2 && road.w >= 8.5 &&
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
    const geo = prof
      ? ribbon(prof.coords, road.w + extra, 0.05, 10, 0.4, prof.heights.map((h) => 0.05 + h - 0.016))
      : ribbon(road.p, road.w + extra, 0.036, 10)
    if (geo) {
      setGeometryColor(geo, '#918d82')
      shoulderGeos.push(geo)
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
    const geo = prof
      ? ribbon(prof.coords, road.w, 0.05, 12, 0.4, prof.heights.map((h) => 0.05 + h))
      : ribbon(road.p, road.w, 0.05, 12)
    if (!geo) return
    let list = roadGroups.get(key)
    if (!list) roadGroups.set(key, (list = []))
    list.push(geo)
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
  const underMat = new THREE.MeshStandardMaterial({ color: 0x2e3032, roughness: 0.95, side: THREE.DoubleSide })
  const parapetGeos = []
  const pierGeos = []
  const underGeos = []
  const bridgeSegments = []

  for (const [index, prof] of bridgeProfiles) {
    const road = data.roads[index]
    const half = road.w / 2 + 0.18

    // dark underside slab
    underGeos.push(
      ribbon(prof.coords, road.w + 1.0, 0.05, 12, 0.3, prof.heights.map((h) => 0.05 + h - 0.42)),
    )

    for (let i = 0; i < prof.coords.length - 1; i++) {
      const [ax, az] = prof.coords[i]
      const [bx, bz] = prof.coords[i + 1]
      const ha = 0.05 + prof.heights[i]
      const hb = 0.05 + prof.heights[i + 1]
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
      }

      bridgeSegments.push({
        ax, az, bx, bz,
        ha: prof.heights[i], hb: prof.heights[i + 1],
        w: road.w / 2 + (road.t === 'motorway' || road.t === 'trunk' ? 3.0 : 2.2),
        name: road.n || '',
        ref: road.ref || '',
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
          g.translate(p.x + side * (road.w / 2 - 0.3), (h - 0.4) / 2, p.z)
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

  function bridgeInfoAt(x, z) {
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
          let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2
          t = Math.max(0, Math.min(1, t))
          const cx = s.ax + dx * t
          const cz = s.az + dz * t
          const d = Math.hypot(x - cx, z - cz)
          if (d <= s.w && d < bestD) {
            bestD = d
            best = { h: s.ha + (s.hb - s.ha) * t, name: s.name, ref: s.ref }
          }
        }
      }
    }
    return best || { h: 0, name: '', ref: '' }
  }

  function bridgeHeightAt(x, z) {
    return bridgeInfoAt(x, z).h
  }

  for (const path of data.paths) {
    if (path.p.length < 2) continue
    if (path.t === 'railway') {
      const geo = ribbon(path.p, 3.2, 0.052, 8)
      if (geo) {
        setGeometryColor(geo, '#4a4a48')
        railGeos.push(geo)
      }
      continue
    }
    const w = path.t === 'cycleway' ? 2.2 : path.t === 'steps' ? 2.4 : 1.8
    const geo = ribbon(path.p, w, 0.042, 6)
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
        '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nattribute float aSeed;\nvarying float vSeed;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vWNormal = normalize(mat3(modelMatrix) * objectNormal);
         vSeed = aSeed;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSeed;\nuniform float uNight;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float wall = 1.0 - smoothstep(0.42, 0.72, abs(vWNormal.y));
         float fy = fract(vWPos.y / 3.15);
         float floorIdx = floor(vWPos.y / 3.15);
         float style = fract(vSeed * 13.73);
         float hcoord = (vWPos.x + vWPos.z) / 3.05 + vSeed * 9.13;
         float fx = fract(hcoord);
         float winW = 0.2 + style * 0.14;
         float win = step(0.5 - winW, fx) * step(fx, 0.5 + winW) * step(0.3, fy) * step(fy, 0.8) * wall;
         vec3 glassCol = mix(vec3(0.04, 0.06, 0.08), vec3(0.075, 0.095, 0.115), style);
         diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, win * 0.9);
         diffuseColor.rgb *= 1.0 - wall * 0.13 * (1.0 - smoothstep(0.0, 2.4, vWPos.y));
         diffuseColor.rgb *= 1.0 - wall * 0.08 * step(0.94, fy);
         float seed = fract(sin(dot(vec2(floor(hcoord * 2.0), floorIdx + style * 17.0), vec2(12.9898, 78.233))) * 43758.5453);
         float lit = step(0.76 - style * 0.1, seed) * win;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * lit * uNight * 1.25;`,
      )
  }
  facadeMaterial.customProgramCacheKey = () => 'subang-facade-v2'

  const buildingChunks = new Map()
  const chunkSize = 1200
  data.buildings.forEach((b, index) => {
    if (b.p.length < 3) return
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
    geo.computeVertexNormals()
    const count = geo.attributes.position.count
    const colors = new Float32Array(count * 3)
    const wall = new THREE.Color(BUILDING_COLORS[Math.floor(hash2(index * 3.7, b.p[0][0]) * BUILDING_COLORS.length)])
    const roof = new THREE.Color(ROOF_COLORS[Math.floor(hash2(b.p[0][1], index * 1.9) * ROOF_COLORS.length)])
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
        // gentle vertical shading near the street
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

    let cx = 0
    let cz = 0
    for (const [x, z] of b.p) { cx += x; cz += z }
    cx /= b.p.length
    cz /= b.p.length
    const key = `${Math.floor(cx / chunkSize)},${Math.floor(cz / chunkSize)}`
    let chunk = buildingChunks.get(key)
    if (!chunk) {
      chunk = { geos: [], cx: Math.floor(cx / chunkSize) * chunkSize + chunkSize / 2, cz: Math.floor(cz / chunkSize) * chunkSize + chunkSize / 2, mesh: null }
      buildingChunks.set(key, chunk)
    }
    chunk.geos.push(geo)
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
    buildingChunkList.push(chunk)
    for (const g of chunk.geos) g.dispose()
    chunk.geos.length = 0
  }

  const cullPosition = new THREE.Vector3(1e9, 0, 1e9)
  function updateCulling(pos) {
    cullPosition.copy(pos)
    for (const c of buildingChunkList) {
      c.mesh.visible = Math.hypot(pos.x - c.cx, pos.z - c.cz) < 3400
    }
  }

  /* ---------------- trees ---------------- */
  const treeData = []
  for (const t of data.trees) treeData.push({ x: t[0], z: t[1], s: t[2] })

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
    if (trees.length >= (mobile ? 1500 : 2600)) break
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
      p.set(t.x, 0, t.z)
      s.set(t.s * 0.95, trunkH, t.s * 0.95)
      m.compose(p, q, s)
      trunks.setMatrixAt(i, m)
      const cy = trunkH + 1.2 * t.s
      p.set(t.x, cy, t.z)
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
      p.set(t.x, 0.34 + t.s * 0.18, t.z)
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
      p.set(l.x, 0, l.z)
      m.compose(p, q, s)
      poles.setMatrixAt(i, m)
      arms.setMatrixAt(i, m)
      const hx = l.x + Math.sin(l.angle) * 1.6
      const hz = l.z + Math.cos(l.angle) * 1.6
      p.set(hx, 7.35, hz)
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
      gp[i * 3 + 1] = 7.25
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
      const yaw = hash2(x, z) * Math.PI * 2
      q.setFromAxisAngle(up, yaw)
      p.set(x, 0, z)
      m.compose(p, q, one)
      poles.setMatrixAt(i, m)
      p.set(x, 0, z)
      m.compose(p, q, one)
      heads.setMatrixAt(i, m)
      qLamp.setFromAxisAngle(up, yaw + Math.PI)
      const offX = -0.155 * Math.sin(yaw)
      const offZ = -0.155 * Math.cos(yaw)
      const lampAt = (mesh, y) => {
        p.set(x + offX, y, z + offZ)
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
      pos.set(x, 1.3, z)
      m.compose(pos, q.identity(), one)
      posts.setMatrixAt(i, m)
      q.setFromAxisAngle(up, hash2(x, z) * Math.PI * 2)
      pos.set(x, 2.5, z)
      m.compose(pos, q, one)
      signs.setMatrixAt(i, m)
    })
    posts.frustumCulled = false
    signs.frustumCulled = false
    group.add(posts, signs)
  }

  /* ---------------- expose ---------------- */
  const collision = new BuildingCollision(data.buildings)

  function setNight(n) {
    windowUniforms.uNight.value = n
    if (lampMat) lampMat.emissiveIntensity = n * 1.9
    if (lampGlow) lampGlow.material.opacity = n * 0.75
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
    updateCulling,
    stats: { buildings: data.buildings.length, trees: trees.length, lamps: lampPositions.length, chunks: buildingChunkList.length },
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
