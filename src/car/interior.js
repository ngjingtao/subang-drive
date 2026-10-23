import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { clusterTexture, emblemTexture, makeLabelTexture } from '../world/textures.js'

function std(opts) {
  return new THREE.MeshStandardMaterial(opts)
}

function m(geo, material, cast = false) {
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = cast
  mesh.receiveShadow = false
  return mesh
}

function rbox(w, h, d, material, radius = 0.02, seg = 2) {
  return m(new RoundedBoxGeometry(w, h, d, seg, Math.min(radius, Math.min(w, h, d) / 2 - 0.001)), material)
}

function box(w, h, d, material) {
  return m(new THREE.BoxGeometry(w, h, d), material)
}

function cylinder(rt, rb, h, material, seg = 16) {
  return m(new THREE.CylinderGeometry(rt, rb, h, seg), material)
}

function beam(a, b, thickness, material) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  const mesh = m(new THREE.BoxGeometry(thickness, len, thickness * 0.85), material)
  mesh.position.copy(a).add(b).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  return mesh
}

const EYE = new THREE.Vector3(0.365, 1.235, 0.46)
const WHEEL_CENTER = new THREE.Vector3(0.365, 0.94, -0.38)

function createDashScreen() {
  const W = 640
  const H = 384
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  let last = ''

  const rounded = (x, y, w, h, r) => {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
  }

  function draw(speed = 0, gear = 'P') {
    const key = `${Math.round(speed)}|${gear}`
    if (key === last) return
    last = key

    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#05070b'
    ctx.fillRect(0, 0, W, H)
    const bg = ctx.createLinearGradient(0, 0, W, H)
    bg.addColorStop(0, 'rgba(18,40,66,0.65)')
    bg.addColorStop(0.5, 'rgba(6,10,16,0.1)')
    bg.addColorStop(1, 'rgba(18,10,30,0.5)')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // top status row
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = '500 19px "Helvetica Neue", Arial, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('4:42', 26, 34)
    ctx.textAlign = 'right'
    ctx.fillText('28°C   BT   ▂▄▆', W - 26, 34)
    ctx.fillStyle = 'rgba(100,190,255,0.75)'
    ctx.font = '700 17px "Helvetica Neue", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('SUBANG DRIVE', W / 2, 34)

    // ambient glow behind the car
    const glow = ctx.createRadialGradient(W / 2, 150, 10, W / 2, 150, 220)
    glow.addColorStop(0, 'rgba(28,115,220,0.35)')
    glow.addColorStop(1, 'rgba(20,60,130,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 50, W, 230)

    // simple blue car front
    ctx.save()
    ctx.translate(W / 2, 148)
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.ellipse(0, 52, 100, 16, 0, 0, Math.PI * 2)
    ctx.fill()
    const body = ctx.createLinearGradient(0, -35, 0, 58)
    body.addColorStop(0, '#36a8ff')
    body.addColorStop(0.55, '#1459c8')
    body.addColorStop(1, '#0a317b')
    ctx.fillStyle = body
    rounded(-96, -18, 192, 76, 22)
    ctx.fill()
    ctx.fillStyle = '#081525'
    rounded(-70, -50, 140, 44, 14)
    ctx.fill()
    ctx.fillStyle = 'rgba(90,190,255,0.28)'
    rounded(-61, -43, 122, 30, 9)
    ctx.fill()
    ctx.fillStyle = '#09121d'
    rounded(-64, 14, 128, 24, 8)
    ctx.fill()
    ctx.fillStyle = '#d9f5ff'
    rounded(-82, 21, 28, 7, 3)
    ctx.fill()
    rounded(54, 21, 28, 7, 3)
    ctx.fill()
    ctx.fillStyle = '#030507'
    ctx.beginPath()
    ctx.arc(-72, 58, 12, 0, Math.PI * 2)
    ctx.arc(72, 58, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // speed
    ctx.fillStyle = '#ffffff'
    ctx.font = '800 54px "Helvetica Neue", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(String(Math.round(speed)), W / 2 - 14, 283)
    ctx.fillStyle = 'rgba(190,220,255,0.65)'
    ctx.font = '600 15px "Helvetica Neue", Arial, sans-serif'
    ctx.fillText('km/h', W / 2 + 58, 282)
    ctx.fillStyle = '#ffc857'
    ctx.font = '700 16px "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(gear === 'P' ? 'P' : gear, W / 2 + 100, 270)

    // app tiles
    const apps = [
      ['MAP', '#1f7ed8'],
      ['MEDIA', '#d74376'],
      ['PHONE', '#2fb673'],
      ['RADIO', '#8b5bd6'],
    ]
    const tw = 78
    const gap = 18
    const total = apps.length * tw + (apps.length - 1) * gap
    let ax = (W - total) / 2
    for (const [label, col] of apps) {
      ctx.fillStyle = col
      rounded(ax, 310, tw, 48, 12)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.font = '700 11px "Helvetica Neue", Arial, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, ax + tw / 2, 334)
      ax += tw + gap
    }
    tex.needsUpdate = true
  }

  draw(0, 'P')
  return { tex, draw }
}

export function createInterior() {
  const group = new THREE.Group()
  group.name = 'vios-interior'

  /* ---------------- materials ---------------- */
  const dash = std({ color: 0x171a1e, roughness: 0.93, metalness: 0.02 })
  const dashTopMat = std({ color: 0x0a0c0f, roughness: 0.99, metalness: 0.0 })
  const dashLight = std({ color: 0x282c32, roughness: 0.9 })
  const panel = std({ color: 0x16191d, roughness: 0.8 })
  const piano = std({ color: 0x0b0d0f, roughness: 0.22, metalness: 0.32 })
  const silver = std({ color: 0xbfc5cb, metalness: 0.9, roughness: 0.2 })
  const chrome = std({ color: 0xd8dde2, metalness: 1, roughness: 0.1 })
  const leather = std({ color: 0x17191c, roughness: 0.72 })
  const fabric = std({ color: 0x24282e, roughness: 0.95 })
  const fabricDark = std({ color: 0x1c2025, roughness: 0.96 })
  const stitching = std({ color: 0x682520, roughness: 0.8 })
  const headliner = std({ color: 0x6b6863, roughness: 0.96 })
  const pillarMat = std({ color: 0x6c6963, roughness: 0.95 })
  const pink = std({ color: 0xd13767, roughness: 0.62, metalness: 0.05 })
  const matBlack = std({ color: 0x0b0c0e, roughness: 1 })
  const carpet = std({ color: 0x131416, roughness: 1 })
  const dashScreen = createDashScreen()
  const screenMat = new THREE.MeshBasicMaterial({ map: dashScreen.tex, toneMapped: false })
  const clusterMat = new THREE.MeshBasicMaterial({ map: clusterTexture(), toneMapped: false })
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xff5a2e, toneMapped: false })
  const amberLed = new THREE.MeshBasicMaterial({ color: 0xff7a2a, toneMapped: false })
  const hazardMat = std({ color: 0x3f0b07, roughness: 0.5, metalness: 0.1, emissive: 0xff2a12, emissiveIntensity: 0.22 })
  const startMat = std({ color: 0x171a1e, roughness: 0.3, metalness: 0.7, emissive: 0xff7a2a, emissiveIntensity: 0.12 })

  /* ---------------- dash ---------------- */
  const dashTop = rbox(1.5, 0.13, 0.62, dashTopMat, 0.05, 3)
  dashTop.position.set(0, 0.94, -0.68)
  group.add(dashTop)

  // pink-trimmed dashboard mat from the owner's car
  const dashMat = rbox(0.7, 0.012, 0.3, matBlack, 0.025)
  dashMat.position.set(-0.32, 1.007, -0.63)
  group.add(dashMat)
  const matEdge = (w, d, x, z) => {
    const e = box(w, 0.006, d, pink)
    e.position.set(x, 1.016, z)
    group.add(e)
  }
  matEdge(0.7, 0.008, -0.32, -0.477)
  matEdge(0.7, 0.008, -0.32, -0.783)
  matEdge(0.008, 0.306, -0.672, -0.63)
  matEdge(0.008, 0.306, 0.032, -0.63)
  // pink piping along the dashboard edge
  const pinkLine = box(1.38, 0.006, 0.008, pink)
  pinkLine.position.set(0, 1.006, -0.383)
  group.add(pinkLine)

  const dashFace = rbox(1.47, 0.34, 0.13, dash, 0.04, 3)
  dashFace.position.set(0, 0.82, -0.43)
  group.add(dashFace)

  const dashLower = rbox(1.5, 0.33, 0.1, dashLight, 0.03)
  dashLower.position.set(0, 0.58, -0.4)
  group.add(dashLower)

  // soft shadow gap under the dash top
  const gap = box(1.42, 0.012, 0.02, panel)
  gap.position.set(0, 0.865, -0.365)
  group.add(gap)

  // silver trim sweep
  const trim = box(1.34, 0.018, 0.015, silver)
  trim.position.set(0, 0.862, -0.365)
  group.add(trim)
  const trimL = box(0.25, 0.018, 0.015, silver)
  trimL.position.set(-0.59, 0.862, -0.365)
  group.add(trimL)

  // passenger airbag seam
  const airbag = box(0.42, 0.003, 0.008, panel)
  airbag.position.set(-0.42, 0.838, -0.368)
  group.add(airbag)

  // glovebox
  const glove = box(0.46, 0.004, 0.01, panel)
  glove.position.set(-0.45, 0.768, -0.364)
  group.add(glove)
  const gloveHandle = box(0.07, 0.018, 0.025, silver)
  gloveHandle.position.set(-0.45, 0.735, -0.358)
  group.add(gloveHandle)

  // outboard vents
  for (const side of [-1, 1]) {
    const vent = rbox(0.14, 0.085, 0.03, panel, 0.015)
    vent.position.set(side * 0.61, 0.915, -0.357)
    group.add(vent)
    const ventTrim = rbox(0.15, 0.095, 0.012, silver, 0.012)
    ventTrim.position.set(side * 0.61, 0.915, -0.37)
    group.add(ventTrim)
    for (let i = 0; i < 3; i++) {
      const slat = box(0.11, 0.006, 0.004, piano)
      slat.position.set(side * 0.61, 0.893 + i * 0.023, -0.34)
      group.add(slat)
    }
  }

  // start button
  const startRing = cylinder(0.027, 0.027, 0.012, silver, 20)
  startRing.rotation.x = Math.PI / 2
  startRing.position.set(0.57, 0.86, -0.36)
  group.add(startRing)
  const startBtn = cylinder(0.019, 0.019, 0.016, startMat, 20)
  startBtn.rotation.x = Math.PI / 2
  startBtn.position.set(0.57, 0.86, -0.355)
  group.add(startBtn)

  // small vios badge on passenger side
  const viosBadge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 0.028),
    new THREE.MeshBasicMaterial({
      map: makeLabelTexture('VIOS', '', { w: 256, h: 72, bg: 'rgba(0,0,0,0)', fg: '#c8ccd0', border: false }),
      transparent: true,
      toneMapped: false,
    }),
  )
  viosBadge.position.set(-0.29, 0.735, -0.36)
  group.add(viosBadge)

  /* ---------------- centre stack ---------------- */
  const stackBezel = rbox(0.37, 0.55, 0.03, silver, 0.02)
  stackBezel.position.set(0, 0.79, -0.385)
  group.add(stackBezel)
  const stack = rbox(0.32, 0.5, 0.05, piano, 0.015)
  stack.position.set(0, 0.79, -0.365)
  group.add(stack)

  // aftermarket Android-style head unit (the screen from the owner's car)
  const screenGroup = new THREE.Group()
  screenGroup.position.set(0.02, 0.91, -0.335)
  screenGroup.rotation.x = -0.08
  const screenTrim = rbox(0.348, 0.212, 0.012, silver, 0.008)
  screenTrim.position.z = 0.016
  const screenFrame = rbox(0.336, 0.2, 0.026, piano, 0.012)
  screenFrame.position.z = 0.004
  const screenFace = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.185), screenMat)
  screenFace.position.z = 0.026
  screenGroup.add(screenTrim, screenFrame, screenFace)
  group.add(screenGroup)

  // magnetic phone mount under the screen
  const phoneArm = box(0.014, 0.08, 0.014, panel)
  phoneArm.position.set(0.02, 0.79, -0.30)
  const phoneMount = cylinder(0.03, 0.03, 0.022, panel, 20)
  phoneMount.rotation.x = Math.PI / 2
  phoneMount.position.set(0.02, 0.75, -0.295)
  const mountRing = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.004, 8, 20), silver)
  mountRing.position.set(0.02, 0.75, -0.29)
  group.add(phoneArm, phoneMount, mountRing)

  // climate controls
  const climate = rbox(0.3, 0.12, 0.02, panel, 0.01)
  climate.position.set(0, 0.69, -0.36)
  group.add(climate)
  for (let i = 0; i < 3; i++) {
    const knob = cylinder(0.027, 0.027, 0.026, silver, 18)
    knob.rotation.x = Math.PI / 2
    knob.position.set(-0.085 + i * 0.085, 0.69, -0.34)
    group.add(knob)
    const cap = cylinder(0.017, 0.017, 0.03, piano, 14)
    cap.rotation.x = Math.PI / 2
    cap.position.copy(knob.position)
    cap.position.z += 0.002
    group.add(cap)
  }

  /* ---------------- instrument cluster ---------------- */
  const clusterGroup = new THREE.Group()
  clusterGroup.position.set(0.365, 1.085, -0.545)
  clusterGroup.rotation.x = -0.12
  group.add(clusterGroup)

  const clusterBack = rbox(0.46, 0.24, 0.02, piano, 0.02)
  clusterBack.position.z = -0.006
  clusterGroup.add(clusterBack)
  const clusterFace = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.22), clusterMat)
  clusterFace.position.z = 0.004
  clusterGroup.add(clusterFace)

  // cluster hood
  const brow = rbox(0.47, 0.035, 0.28, dash, 0.015)
  brow.position.set(0.365, 1.135, -0.585)
  brow.rotation.x = -0.16
  group.add(brow)
  const browSideL = box(0.02, 0.1, 0.28, dash)
  browSideL.position.set(0.14, 1.085, -0.585)
  browSideL.rotation.x = -0.16
  group.add(browSideL)
  const browSideR = browSideL.clone()
  browSideR.position.x = 0.59
  group.add(browSideR)

  const needleTach = new THREE.Group()
  needleTach.position.set(-0.094, 0.002, 0.007)
  clusterGroup.add(needleTach)
  const nTach = box(0.0035, 0.075, 0.0015, needleMat)
  nTach.position.y = 0.035
  needleTach.add(nTach)

  const needleSpeed = new THREE.Group()
  needleSpeed.position.set(0.094, 0.002, 0.007)
  clusterGroup.add(needleSpeed)
  const nSpeed = box(0.0035, 0.075, 0.0015, needleMat)
  nSpeed.position.y = 0.035
  needleSpeed.add(nSpeed)

  const needleHub = cylinder(0.008, 0.008, 0.004, piano, 10)
  needleHub.rotation.x = Math.PI / 2
  needleHub.position.z = 0.009
  clusterGroup.add(needleHub)

  // digital info panel
  const dCanvas = document.createElement('canvas')
  dCanvas.width = 256
  dCanvas.height = 128
  const dCtx = dCanvas.getContext('2d')
  const dTex = new THREE.CanvasTexture(dCanvas)
  dTex.colorSpace = THREE.SRGBColorSpace
  const digital = new THREE.Mesh(
    new THREE.PlaneGeometry(0.115, 0.051),
    new THREE.MeshBasicMaterial({ map: dTex, toneMapped: false }),
  )
  digital.position.set(0, 0.002, 0.012)
  clusterGroup.add(digital)
  let lastDigital = ''

  function drawDigital(gear, speed, odo) {
    const key = `${gear}|${Math.round(speed)}|${odo}`
    if (key === lastDigital) return
    lastDigital = key
    dCtx.fillStyle = '#05070a'
    dCtx.fillRect(0, 0, 256, 128)
    dCtx.strokeStyle = 'rgba(90,130,170,0.25)'
    dCtx.lineWidth = 3
    dCtx.strokeRect(4, 4, 248, 120)
    dCtx.fillStyle = '#ffb347'
    dCtx.font = '700 82px "Helvetica Neue", Arial, sans-serif'
    dCtx.textAlign = 'center'
    dCtx.textBaseline = 'middle'
    dCtx.fillText(gear === 'P' ? 'P' : gear, 58, 66)
    dCtx.fillStyle = 'rgba(170,215,255,0.9)'
    dCtx.font = '700 58px "Helvetica Neue", Arial, sans-serif'
    dCtx.textAlign = 'right'
    dCtx.fillText(String(Math.round(speed)), 218, 64)
    dCtx.fillStyle = 'rgba(160,190,220,0.55)'
    dCtx.font = '500 20px Arial, sans-serif'
    dCtx.textAlign = 'right'
    dCtx.fillText('km/h', 224, 98)
    dCtx.textAlign = 'left'
    dCtx.font = '500 20px Arial, sans-serif'
    dCtx.fillText('D', 38, 98)
    dTex.needsUpdate = true
  }

  /* ---------------- steering wheel ---------------- */
  const column = cylinder(0.055, 0.065, 0.26, panel, 12)
  column.rotation.x = Math.PI / 2
  column.position.set(WHEEL_CENTER.x, WHEEL_CENTER.y - 0.012, -0.49)
  group.add(column)

  const wheelPivot = new THREE.Group()
  wheelPivot.position.copy(WHEEL_CENTER)
  wheelPivot.rotation.x = -0.34
  group.add(wheelPivot)
  const wheelSpin = new THREE.Group()
  wheelPivot.add(wheelSpin)

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.021, 10, 36), leather)
  rim.castShadow = false
  wheelSpin.add(rim)

  const spokeMat = std({ color: 0x23262a, roughness: 0.7, metalness: 0.15 })
  const spokeL = box(0.3, 0.038, 0.026, spokeMat)
  spokeL.position.x = 0
  wheelSpin.add(spokeL)
  const spokeB = box(0.04, 0.16, 0.026, spokeMat)
  spokeB.position.y = -0.085
  wheelSpin.add(spokeB)
  const spokeSilver = box(0.022, 0.09, 0.018, silver)
  spokeSilver.position.set(0, -0.1, 0.02)
  wheelSpin.add(spokeSilver)
  const vLeft = box(0.115, 0.012, 0.018, silver)
  vLeft.position.set(-0.06, -0.06, 0.02)
  vLeft.rotation.z = 0.72
  const vRight = box(0.115, 0.012, 0.018, silver)
  vRight.position.set(0.06, -0.06, 0.02)
  vRight.rotation.z = -0.72
  wheelSpin.add(vLeft, vRight)
  // thumb grips
  for (const side of [-1, 1]) {
    const grip = rbox(0.08, 0.05, 0.03, spokeMat, 0.015)
    grip.position.set(side * 0.09, -0.005, 0.02)
    wheelSpin.add(grip)
  }

  const hub = cylinder(0.062, 0.07, 0.038, leather, 24)
  hub.rotation.x = Math.PI / 2
  hub.position.z = 0.012
  wheelSpin.add(hub)
  const emblem = new THREE.Mesh(
    new THREE.CircleGeometry(0.036, 24),
    new THREE.MeshBasicMaterial({ map: emblemTexture(), transparent: true, toneMapped: false }),
  )
  emblem.position.z = 0.033
  wheelSpin.add(emblem)

  // stalks
  const stalkL = cylinder(0.007, 0.007, 0.12, panel, 6)
  stalkL.rotation.z = Math.PI / 2
  stalkL.position.set(WHEEL_CENTER.x - 0.16, WHEEL_CENTER.y + 0.02, -0.42)
  group.add(stalkL)
  const stalkR = stalkL.clone()
  stalkR.position.x = WHEEL_CENTER.x + 0.16
  group.add(stalkR)

  /* ---------------- seats ---------------- */
  function makeSeat(x, z, rear = false) {
    const seat = new THREE.Group()
    const cushion = rbox(0.5, 0.15, 0.52, fabric, 0.04, 3)
    cushion.position.set(x, 0.66, z)
    seat.add(cushion)
    const back = rbox(0.5, 0.68, 0.15, fabric, 0.045, 3)
    back.position.set(x, 0.96, z + 0.27)
    back.rotation.x = 0.14
    seat.add(back)
    // bolsters
    for (const side of [-1, 1]) {
      const bol = rbox(0.09, 0.12, 0.48, fabricDark, 0.03)
      bol.position.set(x + side * 0.235, 0.69, z)
      seat.add(bol)
      const bbol = rbox(0.085, 0.55, 0.12, fabricDark, 0.03)
      bbol.position.set(x + side * 0.235, 0.95, z + 0.29)
      bbol.rotation.x = 0.14
      seat.add(bbol)
    }
    // stitching accents
    const stitch = box(0.36, 0.006, 0.006, stitching)
    stitch.position.set(x, 1.18, z + 0.355)
    stitch.rotation.x = 0.14
    seat.add(stitch)
    // headrest
    const head = rbox(0.28, 0.19, 0.13, fabric, 0.04, 2)
    head.position.set(x, 1.3, z + 0.36)
    head.rotation.x = 0.12
    seat.add(head)
    for (const side of [-1, 1]) {
      const post = cylinder(0.012, 0.012, 0.13, chrome, 8)
      post.position.set(x + side * 0.07, 1.21, z + 0.35)
      seat.add(post)
    }
    if (rear) seat.scale.setScalar(0.94)
    return seat
  }
  group.add(makeSeat(0.365, 0.32))
  group.add(makeSeat(-0.37, 0.32))

  // rear bench
  const rearCushion = rbox(1.35, 0.15, 0.5, fabric, 0.04, 3)
  rearCushion.position.set(0, 0.64, 1.18)
  group.add(rearCushion)
  const rearBack = rbox(1.35, 0.56, 0.14, fabric, 0.04, 3)
  rearBack.position.set(0, 0.9, 1.42)
  rearBack.rotation.x = 0.15
  group.add(rearBack)
  for (const x of [-0.43, 0.43]) {
    const head = rbox(0.27, 0.17, 0.12, fabric, 0.04, 2)
    head.position.set(x, 1.26, 1.47)
    head.rotation.x = 0.12
    group.add(head)
  }

  // seat rails
  for (const x of [0.24, 0.5, -0.24, -0.5]) {
    const rail = box(0.05, 0.05, 0.6, panel)
    rail.position.set(x, 0.52, 0.28)
    group.add(rail)
  }

  // floor carpet
  const floor = box(1.42, 0.02, 1.7, carpet)
  floor.position.set(0, 0.505, 0.28)
  group.add(floor)
  const mats = box(0.55, 0.025, 0.7, std({ color: 0x191a1d, roughness: 1 }))
  mats.position.set(0.36, 0.518, 0.2)
  group.add(mats)

  /* ---------------- centre console ---------------- */
  const consoleBody = rbox(0.28, 0.3, 1.05, dashLight, 0.03, 3)
  consoleBody.position.set(0, 0.62, 0.25)
  group.add(consoleBody)
  const consoleTop = rbox(0.3, 0.05, 0.95, panel, 0.02)
  consoleTop.position.set(0, 0.785, 0.22)
  group.add(consoleTop)
  const consoleFront = rbox(0.32, 0.24, 0.3, dash, 0.03)
  consoleFront.position.set(0, 0.68, -0.30)
  group.add(consoleFront)

  // shifter
  const gate = box(0.17, 0.012, 0.3, piano)
  gate.position.set(0, 0.818, 0.0)
  group.add(gate)
  const boot = cylinder(0.045, 0.085, 0.1, leather, 14)
  boot.position.set(0, 0.86, 0.02)
  group.add(boot)
  const lever = new THREE.Group()
  lever.position.set(0, 0.86, 0.02)
  group.add(lever)
  const leverRod = cylinder(0.011, 0.013, 0.19, chrome, 8)
  leverRod.position.y = 0.1
  lever.add(leverRod)
  const knob = rbox(0.055, 0.075, 0.055, leather, 0.02, 2)
  knob.position.y = 0.2
  lever.add(knob)
  const knobTop = box(0.03, 0.006, 0.03, silver)
  knobTop.position.y = 0.24
  lever.add(knobTop)

  // gate letters
  const gateTex = makeLabelTexture('P  R  N  D', '', {
    w: 512,
    h: 80,
    bg: 'rgba(0,0,0,0)',
    fg: '#c9d6e3',
    border: false,
  })
  const gateLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.19, 0.03),
    new THREE.MeshBasicMaterial({ map: gateTex, transparent: true, toneMapped: false }),
  )
  gateLabel.rotation.x = -Math.PI / 2
  gateLabel.position.set(0, 0.827, -0.095)
  group.add(gateLabel)

  // handbrake
  const hbBase = box(0.06, 0.02, 0.14, panel)
  hbBase.position.set(0.17, 0.79, 0.27)
  group.add(hbBase)
  const hbLever = cylinder(0.011, 0.013, 0.22, panel, 8)
  hbLever.rotation.x = -0.55
  hbLever.position.set(0.17, 0.9, 0.3)
  group.add(hbLever)
  const hbTip = rbox(0.045, 0.05, 0.06, leather, 0.02)
  hbTip.position.set(0.17, 0.995, 0.345)
  hbTip.rotation.x = -0.55
  group.add(hbTip)

  // cup holders
  for (const x of [-0.075, 0.075]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.007, 8, 18), panel)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(x, 0.822, 0.33)
    group.add(ring)
  }

  // armrest
  const armrest = rbox(0.27, 0.09, 0.42, leather, 0.03)
  armrest.position.set(0, 0.83, 0.52)
  group.add(armrest)

  /* ---------------- doors ---------------- */
  for (const side of [-1, 1]) {
    const card = rbox(0.055, 0.46, 1.15, panel, 0.02)
    card.position.set(side * 0.755, 0.77, 0.2)
    group.add(card)
    const upper = box(0.02, 0.035, 1.02, silver)
    upper.position.set(side * 0.728, 0.905, 0.16)
    group.add(upper)
    const arm = rbox(0.14, 0.06, 0.42, dashLight, 0.02)
    arm.position.set(side * 0.685, 0.74, 0.14)
    group.add(arm)
    const handle = box(0.09, 0.025, 0.15, chrome)
    handle.position.set(side * 0.72, 0.83, -0.04)
    group.add(handle)
    const switchPanel = box(0.07, 0.01, 0.16, piano)
    switchPanel.position.set(side * 0.7, 0.773, 0.12)
    group.add(switchPanel)
    const speaker = cylinder(0.055, 0.055, 0.01, panel, 18)
    speaker.rotation.z = Math.PI / 2
    speaker.position.set(side * 0.727, 0.64, 0.45)
    group.add(speaker)
  }

  /* ---------------- pillars / roof ---------------- */
  for (const side of [-1, 1]) {
    const ap = beam(
      new THREE.Vector3(side * 0.68, 1.01, -0.87),
      new THREE.Vector3(side * 0.63, 1.42, -0.3),
      0.068,
      pillarMat,
    )
    group.add(ap)
    const bp = beam(
      new THREE.Vector3(side * 0.72, 1.0, 0.49),
      new THREE.Vector3(side * 0.7, 1.42, 0.49),
      0.075,
      panel,
    )
    group.add(bp)
    const cp = beam(
      new THREE.Vector3(side * 0.7, 1.42, 1.2),
      new THREE.Vector3(side * 0.72, 1.0, 1.74),
      0.08,
      dashLight,
    )
    group.add(cp)
  }

  const ceiling = box(1.38, 0.014, 1.44, headliner)
  ceiling.position.set(0, 1.427, 0.46)
  group.add(ceiling)
  const header = rbox(1.4, 0.07, 0.11, headliner, 0.02)
  header.position.set(0, 1.395, -0.31)
  group.add(header)


  const dome = box(0.12, 0.015, 0.08, headliner)
  const domeLight = new THREE.Mesh(
    new THREE.PlaneGeometry(0.06, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8, toneMapped: false }),
  )
  domeLight.rotation.x = Math.PI / 2
  domeLight.position.set(0, 1.412, 0.42)
  group.add(dome, domeLight)

  // seatbelts
  for (const side of [-1, 1]) {
    const belt = beam(
      new THREE.Vector3(side * 0.7, 1.36, 0.5),
      new THREE.Vector3(side * 0.55, 1.03, 0.34),
      0.045,
      std({ color: 0x3c3f43, roughness: 0.85 }),
    )
    belt.scale.z = 0.14
    group.add(belt)
    const buckle = box(0.03, 0.05, 0.015, silver)
    buckle.position.set(side * 0.53, 1.0, 0.32)
    group.add(buckle)
  }

  /* ---------------- rear view mirror ---------------- */
  const mirrorStalk = cylinder(0.012, 0.012, 0.1, panel, 8)
  mirrorStalk.position.set(0.17, 1.4, -0.18)
  mirrorStalk.rotation.x = 0.3
  group.add(mirrorStalk)
  const mirrorHousing = rbox(0.2, 0.062, 0.04, panel, 0.013)
  mirrorHousing.position.set(0.17, 1.352, -0.162)
  group.add(mirrorHousing)

  const mirrorCanvas = document.createElement('canvas')
  mirrorCanvas.width = 256
  mirrorCanvas.height = 72
  const mctx = mirrorCanvas.getContext('2d')
  mctx.fillStyle = '#0a0f14'
  mctx.fillRect(0, 0, 256, 72)
  const mirrorTex = new THREE.CanvasTexture(mirrorCanvas)
  mirrorTex.colorSpace = THREE.SRGBColorSpace
  const mirrorMat = new THREE.MeshBasicMaterial({ map: mirrorTex, color: 0x66727c, toneMapped: false })
  const mirrorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.168, 0.04), mirrorMat)
  mirrorGlass.position.set(0.17, 1.352, -0.14)
  group.add(mirrorGlass)

  // wipers (visible through the windscreen)
  for (const side of [-1, 1]) {
    const arm = box(0.5, 0.008, 0.018, panel)
    arm.position.set(side * 0.3, 1.0, -0.94)
    arm.rotation.y = side * 0.15
    group.add(arm)
  }

  /* ---------------- interior light ---------------- */
  const dashFill = new THREE.PointLight(0xbfd4e8, 0.75, 2.4, 2)
  dashFill.position.set(0.1, 1.16, -0.22)
  group.add(dashFill)
  const cabinLight = new THREE.PointLight(0xffe8cc, 1.4, 4.6, 2)
  cabinLight.position.set(0, 1.31, 0.18)
  group.add(cabinLight)

  /* ---------------- update ---------------- */
  let lastGear = null
  function update(state, { night = 0 } = {}) {
    wheelSpin.rotation.z = state.steer * 2.6

    const speedT = Math.min(1, state.speedKmh / 200)
    const rpmT = Math.min(1, state.rpm / 8000)
    needleSpeed.rotation.z = Math.PI * 0.75 - Math.PI * 1.5 * speedT
    needleTach.rotation.z = Math.PI * 0.75 - Math.PI * 1.5 * rpmT

    drawDigital(state.gearLabel, state.speedKmh, Math.floor(state.distance / 1000))
    dashScreen.draw(state.speedKmh, state.gearLabel)
    if (state.gearLabel !== lastGear) {
      lastGear = state.gearLabel
      const tilt = { P: -0.12, R: -0.06, N: 0, D: 0.07 }[state.gearLabel] ?? 0
      lever.rotation.x = tilt
    }
    cabinLight.intensity = 1.0 + night * 0.7
    domeLight.material.color.setHex(night > 0.4 ? 0xffe6b8 : 0x6a6558)
  }

  function setMirrorTexture(texture) {
    mirrorMat.map = texture
    mirrorMat.needsUpdate = true
  }

  return {
    group,
    eye: EYE.clone(),
    wheelCenter: WHEEL_CENTER.clone(),
    update,
    setMirrorTexture,
    mirrorGlass,
    clusterGroup,
  }
}
