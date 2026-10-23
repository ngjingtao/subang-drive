import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { emblemTexture, plateTexture, shadowTexture, glowTexture } from '../world/textures.js'

function mat(opts) {
  return new THREE.MeshStandardMaterial(opts)
}

function mesh(geo, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material)
  m.castShadow = cast
  m.receiveShadow = receive
  return m
}

function box(w, h, d, material, { rounded = false, radius = 0.05, seg = 2 } = {}) {
  const geo = rounded
    ? new RoundedBoxGeometry(w, h, d, seg, radius)
    : new THREE.BoxGeometry(w, h, d)
  return mesh(geo, material)
}

function quad(points, material) {
  const geo = new THREE.BufferGeometry()
  const verts = []
  for (const p of points) verts.push(p[0], p[1], p[2])
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2),
  )
  geo.setIndex([0, 1, 2, 2, 1, 3])
  geo.computeVertexNormals()
  return mesh(geo, material, { cast: false, receive: false })
}

function beamBetween(a, b, thickness, material) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  const g = new THREE.BoxGeometry(thickness, len, thickness * 1.2)
  const m = mesh(g, material)
  m.position.copy(a).add(b).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  return m
}

export function createExterior() {
  const group = new THREE.Group()
  group.name = 'vios-exterior'
  const cabin = new THREE.Group()
  cabin.name = 'exterior-cabin'
  group.add(cabin)

  const paint = mat({ color: 0x9fa5a8, metalness: 0.66, roughness: 0.36, envMapIntensity: 1.05 })
  const paintDark = mat({ color: 0x9a9fa2, metalness: 0.6, roughness: 0.4 })
  const blackTrim = mat({ color: 0x141619, metalness: 0.2, roughness: 0.62 })
  const plastic = mat({ color: 0x24272a, roughness: 0.8 })
  const chrome = mat({ color: 0xd5dade, metalness: 1, roughness: 0.12 })
  const rubber = mat({ color: 0x0b0c0d, roughness: 0.92 })

  const glass = new THREE.MeshStandardMaterial({
    color: 0x0c1319,
    metalness: 0.35,
    roughness: 0.06,
    transparent: true,
    opacity: 0.93,
    envMapIntensity: 1.6,
    side: THREE.DoubleSide,
  })

  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0x809198,
    metalness: 0.75,
    roughness: 0.16,
    emissive: 0xfff1cf,
    emissiveIntensity: 0.02,
    envMapIntensity: 1.5,
  })
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x3d0909,
    metalness: 0.45,
    roughness: 0.24,
    emissive: 0xd8180c,
    emissiveIntensity: 0.26,
  })
  const reverseMat = new THREE.MeshStandardMaterial({
    color: 0xd9d9cf,
    roughness: 0.3,
    emissive: 0xfff6d8,
    emissiveIntensity: 0,
  })
  const amberMat = new THREE.MeshStandardMaterial({
    color: 0x6b3a07,
    emissive: 0xff9a22,
    emissiveIntensity: 0.08,
    roughness: 0.35,
  })

  /* ---------- main body ---------- */
  // The lower shell stops just below the interior floor, so the cabin is
  // actually hollow when you sit inside. The door/fender sides are separate
  // panels above it.
  const lowerBody = box(1.755, 0.22, 4.32, paint, { rounded: true, radius: 0.09, seg: 4 })
  lowerBody.position.y = 0.4
  group.add(lowerBody)

  for (const side of [-1, 1]) {
    const flank = box(0.07, 0.48, 4.12, paint, { rounded: true, radius: 0.035, seg: 3 })
    flank.position.set(side * 0.852, 0.74, 0)
    group.add(flank)
  }

  // lower sill / rocker
  const sill = box(1.72, 0.12, 4.0, paintDark, { rounded: true, radius: 0.035 })
  sill.position.y = 0.35
  group.add(sill)

  // bumper volumes
  const frontBumper = box(1.76, 0.4, 0.5, paint, { rounded: true, radius: 0.09 })
  frontBumper.position.set(0, 0.505, -1.98)
  const rearBumper = box(1.76, 0.42, 0.44, paint, { rounded: true, radius: 0.09 })
  rearBumper.position.set(0, 0.52, 2.01)
  group.add(frontBumper, rearBumper)

  // hood
  const hood = box(1.6, 0.075, 1.28, paint, { rounded: true, radius: 0.03 })
  hood.position.set(0, 0.945, -1.32)
  hood.rotation.x = -0.028
  group.add(hood)

  // cowl panel
  const cowl = box(1.58, 0.05, 0.26, plastic)
  cowl.position.set(0, 0.978, -0.73)
  group.add(cowl)

  // trunk lid
  const trunk = box(1.6, 0.075, 0.86, paint, { rounded: true, radius: 0.03 })
  trunk.position.set(0, 0.945, 1.72)
  trunk.rotation.x = 0.02
  group.add(trunk)

  // roof
  const roof = box(1.42, 0.07, 1.52, paint, { rounded: true, radius: 0.035 })
  roof.position.set(0, 1.447, 0.46)
  cabin.add(roof)

  /* ---------- greenhouse ---------- */
  const wsBaseY = 1.0
  const wsTopY = 1.445
  const wsBaseZ = -0.9
  const wsTopZ = -0.31
  const wsHalfBase = 0.715
  const wsHalfTop = 0.665
  const windshield = quad(
    [
      [-wsHalfBase, wsBaseY, wsBaseZ],
      [wsHalfBase, wsBaseY, wsBaseZ],
      [-wsHalfTop, wsTopY, wsTopZ],
      [wsHalfTop, wsTopY, wsTopZ],
    ],
    glass,
  )
  cabin.add(windshield)

  const rearWindow = quad(
    [
      [-0.665, wsTopY, 1.22],
      [0.665, wsTopY, 1.22],
      [-0.715, 1.0, 1.78],
      [0.715, 1.0, 1.78],
    ],
    glass,
  )
  cabin.add(rearWindow)

  // side windows (two per side)
  const sideGlass = new THREE.Group()
  for (const side of [-1, 1]) {
    const x = side * 0.722
    const front = quad(
      [
        [x, 1.015, -0.28],
        [x, 1.015, 0.46],
        [x, 1.43, -0.22],
        [x, 1.43, 0.46],
      ],
      glass,
    )
    const rear = quad(
      [
        [x, 1.015, 0.53],
        [x, 1.015, 1.18],
        [x, 1.43, 0.53],
        [x, 1.41, 1.16],
      ],
      glass,
    )
    sideGlass.add(front, rear)
  }
  cabin.add(sideGlass)

  // black window surrounds
  const windowTrim = mat({ color: 0x0c0d0f, roughness: 0.5, metalness: 0.2 })
  for (const side of [-1, 1]) {
    const belt = box(0.025, 0.035, 2.62, windowTrim)
    belt.position.set(side * 0.858, 0.995, 0.45)
    cabin.add(belt)
    const upperBelt = box(0.02, 0.025, 2.45, chrome)
    upperBelt.position.set(side * 0.858, 1.018, 0.45)
    cabin.add(upperBelt)
    // B pillar
    const bp = box(0.06, 0.46, 0.09, windowTrim)
    bp.position.set(side * 0.728, 1.22, 0.49)
    cabin.add(bp)
    // C pillar trim
    const cp = beamBetween(
      new THREE.Vector3(side * 0.71, 1.43, 1.2),
      new THREE.Vector3(side * 0.725, 1.0, 1.76),
      0.075,
      paint,
    )
    cabin.add(cp)
    // A pillar
    const ap = beamBetween(
      new THREE.Vector3(side * 0.73, 1.0, -0.9),
      new THREE.Vector3(side * 0.675, 1.44, -0.31),
      0.075,
      paint,
    )
    cabin.add(ap)
  }

  // windshield trim
  const wsTop = box(1.36, 0.04, 0.05, windowTrim)
  wsTop.position.set(0, 1.455, -0.3)
  cabin.add(wsTop)

  // roof rails / drip channels
  for (const side of [-1, 1]) {
    const rail = box(0.035, 0.03, 1.55, windowTrim)
    rail.position.set(side * 0.72, 1.44, 0.46)
    cabin.add(rail)
  }

  /* ---------- doors / details ---------- */
  for (const side of [-1, 1]) {
    const handle = box(0.11, 0.035, 0.2, chrome, { rounded: true, radius: 0.015 })
    handle.position.set(side * 0.89, 0.89, -0.12)
    group.add(handle)
    const handle2 = box(0.1, 0.032, 0.16, chrome, { rounded: true, radius: 0.015 })
    handle2.position.set(side * 0.89, 0.89, 0.72)
    group.add(handle2)
    // door shut line
    const seam = box(0.006, 0.5, 0.012, blackTrim)
    seam.position.set(side * 0.88, 0.68, 0.44)
    group.add(seam)
    const seam2 = box(0.006, 0.46, 0.012, blackTrim)
    seam2.position.set(side * 0.878, 0.68, -0.62)
    group.add(seam2)
  }

  for (const side of [-1, 1]) {
    const crease = box(0.008, 0.014, 2.7, paintDark)
    crease.position.set(side * 0.884, 0.76, 0.1)
    group.add(crease)
  }

  // side mirrors
  const mirrorGroup = new THREE.Group()
  for (const side of [-1, 1]) {
    const stalk = box(0.15, 0.05, 0.06, blackTrim)
    stalk.position.set(side * 0.9, 1.01, -0.62)
    const housing = box(0.16, 0.085, 0.2, paint, { rounded: true, radius: 0.03 })
    housing.position.set(side * 0.98, 1.05, -0.63)
    housing.rotation.z = side * -0.1
    const glassMirror = new THREE.Mesh(
      new THREE.PlaneGeometry(0.115, 0.055),
      new THREE.MeshStandardMaterial({ color: 0x9fb0bb, metalness: 1, roughness: 0.04, envMapIntensity: 2 }),
    )
    glassMirror.position.set(side * 0.98, 1.05, -0.527)
    glassMirror.rotation.y = side * -0.08
    mirrorGroup.add(stalk, housing, glassMirror)
  }
  cabin.add(mirrorGroup)

  /* ---------- front ---------- */
  const frontFace = -2.245
  const grille = box(0.78, 0.26, 0.06, plastic)
  grille.position.set(0, 0.72, frontFace + 0.045)
  group.add(grille)
  for (let i = 0; i < 3; i++) {
    const bar = box(0.76, 0.022, 0.02, chrome)
    bar.position.set(0, 0.65 + i * 0.07, frontFace + 0.012)
    group.add(bar)
  }

  const emblem = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.15),
    new THREE.MeshStandardMaterial({
      map: emblemTexture(),
      transparent: true,
      metalness: 0.85,
      roughness: 0.22,
      color: 0xffffff,
    }),
  )
  emblem.position.set(0, 0.83, frontFace - 0.001)
  emblem.rotation.y = Math.PI
  emblem.rotation.z = Math.PI
  group.add(emblem)

  const headlights = []
  for (const side of [-1, 1]) {
    const housing = box(0.5, 0.18, 0.08, blackTrim)
    housing.position.set(side * 0.55, 0.87, frontFace + 0.03)
    housing.rotation.z = side * 0.03
    const lens = box(0.4, 0.105, 0.05, headlightMat)
    lens.position.set(side * 0.57, 0.87, frontFace - 0.045)
    lens.rotation.z = side * 0.03
    const projector = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), chrome)
    projector.rotation.x = Math.PI / 2
    projector.position.set(side * 0.58, 0.87, frontFace - 0.07)
    group.add(housing, lens, projector)
    headlights.push(lens)
    // amber indicator strip
    const ind = box(0.1, 0.035, 0.02, amberMat)
    ind.position.set(side * 0.32, 0.83, frontFace - 0.06)
    group.add(ind)
  }

  const lowerGrille = box(1.05, 0.15, 0.06, plastic)
  lowerGrille.position.set(0, 0.5, frontFace + 0.05)
  group.add(lowerGrille)
  const lowerLip = box(1.55, 0.08, 0.12, blackTrim)
  lowerLip.position.set(0, 0.38, frontFace + 0.12)
  group.add(lowerLip)

  for (const side of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 6, 16), chrome)
    ring.position.set(side * 0.7, 0.52, frontFace - 0.004)
    const fog = new THREE.Mesh(new THREE.CircleGeometry(0.048, 16), mat({ color: 0x2a3034, metalness: 0.4, roughness: 0.25 }))
    fog.position.set(side * 0.7, 0.52, frontFace - 0.006)
    fog.rotation.y = Math.PI
    group.add(ring, fog)
  }

  /* ---------- rear ---------- */
  const rearFace = 2.225
  const taillights = []
  for (const side of [-1, 1]) {
    const t = box(0.42, 0.14, 0.06, tailMat)
    t.position.set(side * 0.6, 0.86, rearFace - 0.02)
    group.add(t)
    taillights.push(t)
    const rev = box(0.14, 0.06, 0.02, reverseMat)
    rev.position.set(side * 0.36, 0.84, rearFace - 0.065)
    group.add(rev)
    const ind = box(0.09, 0.04, 0.02, amberMat)
    ind.position.set(side * 0.76, 0.84, rearFace - 0.06)
    group.add(ind)
  }

  const chromeStrip = box(0.95, 0.035, 0.02, chrome)
  chromeStrip.position.set(0, 0.78, rearFace - 0.03)
  group.add(chromeStrip)

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.36, 0.09),
    new THREE.MeshStandardMaterial({ map: plateTexture('B 2014 V'), roughness: 0.5 }),
  )
  plate.position.set(0, 0.62, rearFace - 0.055)
  group.add(plate)

  const vios = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.04),
    new THREE.MeshStandardMaterial({
      color: 0xc8ccd0,
      metalness: 0.9,
      roughness: 0.2,
    }),
  )
  vios.position.set(0.5, 0.71, rearFace - 0.058)
  group.add(vios)

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.14, 10), chrome)
  exhaust.rotation.x = Math.PI / 2
  exhaust.position.set(-0.52, 0.34, rearFace - 0.02)
  group.add(exhaust)

  /* ---------- underbody / shadow ---------- */
  const under = box(1.5, 0.08, 3.9, blackTrim)
  under.position.y = 0.33
  group.add(under)

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 4.9),
    new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.028
  shadow.renderOrder = 2
  group.add(shadow)

  /* ---------- wheels ---------- */
  const wheels = []
  const tireGeo = new THREE.CylinderGeometry(0.335, 0.335, 0.21, 24)
  tireGeo.rotateZ(Math.PI / 2)
  const rimGeo = new THREE.CylinderGeometry(0.215, 0.215, 0.222, 24)
  rimGeo.rotateZ(Math.PI / 2)
  const rimMat = mat({ color: 0xb7bcc1, metalness: 0.95, roughness: 0.18 })
  const hubMat = mat({ color: 0x35393d, metalness: 0.6, roughness: 0.35 })

  for (const [sx, sz, front] of [
    [-0.815, -1.29, true],
    [0.815, -1.29, true],
    [-0.815, 1.3, false],
    [0.815, 1.3, false],
  ]) {
    const outer = new THREE.Group()
    outer.position.set(sx, 0.335, sz)
    const spin = new THREE.Group()
    const tire = mesh(tireGeo, rubber)
    const rim = mesh(rimGeo, rimMat)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.225, 12), hubMat)
    hub.rotation.z = Math.PI / 2
    spin.add(tire, rim, hub)
    for (let i = 0; i < 5; i++) {
      const spoke = box(0.03, 0.026, 0.33, rimMat)
      spoke.rotation.x = (i / 5) * Math.PI * 2
      spin.add(spoke)
    }
    outer.add(spin)
    outer.userData = { spin, front }
    group.add(outer)
    wheels.push(outer)
  }

  // wheel arch trims
  const archGeo = new THREE.TorusGeometry(0.375, 0.022, 6, 22)
  for (const [sx, sz] of [
    [-0.885, -1.29], [0.885, -1.29], [-0.885, 1.3], [0.885, 1.3],
  ]) {
    const arch = new THREE.Mesh(archGeo, blackTrim)
    arch.position.set(sx, 0.335, sz)
    arch.rotation.y = Math.PI / 2
    arch.castShadow = false
    group.add(arch)
  }

  /* ---------- light glows ---------- */
  const headGlows = []
  for (const side of [-1, 1]) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xfff2d0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    )
    s.position.set(side * 0.55, 0.86, frontFace - 0.1)
    s.scale.setScalar(0.75)
    group.add(s)
    headGlows.push(s)
  }
  const tailGlows = []
  for (const side of [-1, 1]) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xff3a22,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    )
    s.position.set(side * 0.55, 0.88, rearFace + 0.1)
    s.scale.setScalar(0.65)
    group.add(s)
    tailGlows.push(s)
  }

  // Invisible proxy so the roof still shades the cabin in cockpit view.
  const roofShadow = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.06, 1.75),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  )
  roofShadow.position.set(0, 1.46, 0.45)
  roofShadow.castShadow = true
  group.add(roofShadow)

  let cockpit = false
  function setCockpitView(on) {
    if (cockpit === on) return
    cockpit = on
    cabin.visible = !on
    glass.visible = !on
  }

  function setLights(night, braking, reversing) {
    headlightMat.emissiveIntensity = 0.12 + night * 2.6
    for (const g of headGlows) g.material.opacity = Math.max(0, night - 0.35) * 0.9
    const tailPower = 0.24 + (braking ? 1.9 : 0) + night * 0.5
    tailMat.emissiveIntensity = tailPower
    for (const g of tailGlows) g.material.opacity = 0.08 + (braking ? 0.45 : 0) + Math.max(0, night - 0.3) * 0.25
    reverseMat.emissiveIntensity = reversing ? 2.2 : 0
  }

  function updateWheels(wheelSpin, steer) {
    for (const w of wheels) {
      w.userData.spin.rotation.x = -wheelSpin
      if (w.userData.front) w.rotation.y = steer * 0.95
    }
  }

  return { group, setCockpitView, setLights, updateWheels, glass, wheels, materials: { paint, tailMat, headlightMat } }
}
