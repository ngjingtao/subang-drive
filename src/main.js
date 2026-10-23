import './style.css'
import * as THREE from 'three'
import { buildWorld } from './world/world.js'
import { Sky, TIME_KEYS, TIME_PRESETS } from './world/sky.js'
import { createExterior } from './car/exterior.js'
import { createInterior } from './car/interior.js'
import { CarPhysics } from './car/physics.js'
import { Input } from './game/input.js'
import { HUD } from './game/hud.js'
import { Minimap } from './game/minimap.js'
import { CarAudio } from './game/audio.js'
import { chevronTexture } from './world/textures.js'
import { RoadRouter } from './game/router.js'
import { DESTINATIONS } from './game/destinations.js'

/* Older iPadOS Safari does not have CanvasRenderingContext2D.roundRect. */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r = 0) {
    const rad = Math.min(typeof r === 'number' ? r : 0, Math.abs(w) / 2, Math.abs(h) / 2)
    this.moveTo(x + rad, y)
    this.lineTo(x + w - rad, y)
    this.quadraticCurveTo(x + w, y, x + w, y + rad)
    this.lineTo(x + w, y + h - rad)
    this.quadraticCurveTo(x + w, y + h, x + w - rad, y + h)
    this.lineTo(x + rad, y + h)
    this.quadraticCurveTo(x, y + h, x, y + h - rad)
    this.lineTo(x, y + rad)
    this.quadraticCurveTo(x, y, x + rad, y)
    return this
  }
}

/* ------------------------------------------------------------------ */
/* environment / device                                                */
/* ------------------------------------------------------------------ */

const canvas = document.getElementById('game')
const isTouch =
  window.matchMedia('(pointer: coarse)').matches ||
  navigator.maxTouchPoints > 1 ||
  /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)

if (isTouch) document.body.classList.add('touch')

const isMobile = isTouch && Math.min(window.innerWidth, window.innerHeight) < 820
const DPR_CAP = [1, 1.5, 2]
let quality = isTouch ? 1 : 2

let renderer
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isTouch,
    powerPreference: 'high-performance',
    stencil: false,
  })
} catch (err) {
  const msg = document.getElementById('loadmsg')
  if (msg) msg.textContent = 'WebGL 2 is required to run Subang Drive. Please update your browser or enable hardware acceleration.'
  throw err
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP[quality]))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.02
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0xcbd3cd, 320, 2500)

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.045, 6500)
camera.rotation.order = 'YXZ'
scene.add(camera)

const sky = new Sky()
scene.add(sky.group)

const hemi = new THREE.HemisphereLight(0xb9d4f0, 0x6f6a56, 1.15)
scene.add(hemi)

const sun = new THREE.DirectionalLight(0xfff1d6, 3.1)
sun.castShadow = true
sun.shadow.mapSize.set(quality >= 2 ? 2048 : 1024, quality >= 2 ? 2048 : 1024)
sun.shadow.camera.near = 5
sun.shadow.camera.far = 650
sun.shadow.camera.left = -90
sun.shadow.camera.right = 90
sun.shadow.camera.top = 90
sun.shadow.camera.bottom = -90
sun.shadow.bias = -0.00025
sun.shadow.normalBias = 0.045
scene.add(sun)
const sunTarget = new THREE.Object3D()
scene.add(sunTarget)
sun.target = sunTarget

let world = null
let exterior = null
let interior = null
let physics = null
let minimap = null
let router = null
let nav = null
let navUiLast = 0
let destinationTimer = 0
let preset = null
let presetIndex = 0
let sunDir = new THREE.Vector3(0, 1, 0)
let headlights = []

const carRoot = new THREE.Group()
carRoot.name = 'vios'
const tilt = new THREE.Group()
carRoot.add(tilt)
scene.add(carRoot)

const audio = new CarAudio()
const hud = new HUD()
hud.setCamera('cockpit')

let input = null
let running = false
let paused = false
let ready = false
let orientationBlocked = false
let cameraMode = 'cockpit'
let cameraSnap = true
let lastTime = performance.now()
let elapsed = 0
let mirrorRT = null
let mirrorCam = null
let mirrorTimer = 0
let wakeLock = null
let introUntil = 0
let turnHintAt = 0
let guideGroup = null
let guideMeshes = []

const lookTarget = { yaw: 0, pitch: 0 }
const tmpV = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ')

/* ------------------------------------------------------------------ */
/* loading                                                             */
/* ------------------------------------------------------------------ */

const loadFill = document.getElementById('loadfill')
const loadMsg = document.getElementById('loadmsg')
const loadingEl = document.getElementById('loading')
const startEl = document.getElementById('start')

function setProgress(p, msg) {
  loadFill.style.width = `${p}%`
  loadMsg.textContent = msg
}

function nextFrame(ms = 30) {
  return new Promise((resolve) => setTimeout(() => requestAnimationFrame(resolve), ms))
}

async function init() {
  setProgress(6, 'Memuatkan data peta…')
  await nextFrame(120)

  let data
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/subang-jaya.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data = await res.json()
  } catch (err) {
    setProgress(100, 'Peta gagal dimuatkan. Sila jalankan "npm run map".')
    console.error(err)
    return
  }

  setProgress(30, 'Membina peta besar (48 ribu bangunan)…')
  await nextFrame()

  try {
    world = buildWorld(scene, data, renderer, { mobile: isMobile })
  } catch (err) {
    console.error(err)
    setProgress(100, 'Ralat membina dunia — lihat konsol.')
    return
  }

  setProgress(72, 'Memasang kokpit Vios…')
  await nextFrame()

  exterior = createExterior()
  interior = createInterior()
  tilt.add(exterior.group)
  tilt.add(interior.group)

  // headlights
  headlights = []
  for (const side of [-1, 1]) {
    const light = new THREE.SpotLight(0xfff0cc, 0, 95, 0.44, 0.55, 1.65)
    light.position.set(side * 0.55, 0.9, -2.1)
    light.target.position.set(side * 0.35, 0.0, -34)
    tilt.add(light)
    tilt.add(light.target)
    headlights.push(light)
  }

  // amber chevrons that follow the current road ahead
  guideGroup = new THREE.Group()
  guideGroup.name = 'road-guide'
  const chevGeo = new THREE.PlaneGeometry(3.6, 1.8)
  chevGeo.rotateX(-Math.PI / 2)
  const chevMat = new THREE.MeshBasicMaterial({
    map: chevronTexture(),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  guideMeshes = []
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(chevGeo, chevMat)
    m.visible = false
    m.renderOrder = 6
    guideGroup.add(m)
    guideMeshes.push(m)
  }
  scene.add(guideGroup)

  physics = new CarPhysics(world.spawn)
  physics.reset(world.spawn)

  minimap = new Minimap(data)
  router = new RoadRouter(data.roads)
  router.build()
  initPhoneUi()
  input = new Input(canvas, { onAction: handleAction })

  // mirror
  mirrorRT = new THREE.WebGLRenderTarget(isTouch ? 192 : 320, isTouch ? 56 : 92, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  })
  mirrorCam = new THREE.PerspectiveCamera(
    40,
    mirrorRT.width / mirrorRT.height,
    0.2,
    400,
  )
  interior.setMirrorTexture(mirrorRT.texture)

  // spawn labels
  const spawnName = world.spawn.name || 'USJ 3'
  hud.setLocation(spawnName, 'USJ 3 · Subang Jaya', world.spawn.ref || '')
  const loc = document.querySelector('.wc-loc')
  if (loc) loc.textContent = 'USJ 3 · SUBANG JAYA'

  carRoot.position.set(physics.x, 0.055, physics.z)
  carRoot.rotation.y = physics.yaw
  carRoot.updateMatrixWorld(true)

  setProgress(86, 'Menyalakan enjin…')
  await nextFrame(140)

  applyTime(0, { silent: true })
  updateCarVisual()
  updateCamera(0, true)
  hud.update(physics)
  minimap.draw(physics, null)
  updateDestinationDistances()

  setProgress(100, 'Sedia.')
  await nextFrame(220)

  loadingEl.classList.add('hidden')
  startEl.classList.remove('hidden')
  const play = document.getElementById('playbtn')
  play.addEventListener('click', startGame, { once: false })

  ready = true

  requestAnimationFrame(loop)
}

/* ------------------------------------------------------------------ */
/* time of day                                                         */
/* ------------------------------------------------------------------ */

function applyTime(index, { silent = false } = {}) {
  presetIndex = ((index % TIME_KEYS.length) + TIME_KEYS.length) % TIME_KEYS.length
  preset = TIME_PRESETS[TIME_KEYS[presetIndex]]
  sunDir = sky.setPreset(preset, renderer)
  scene.environment = sky.envTexture
  scene.environmentIntensity = 0.85
  renderer.toneMappingExposure = preset.exposure
  scene.fog.color.set(preset.fog.color)
  scene.fog.near = preset.fog.near
  scene.fog.far = preset.fog.far
  hemi.color.set(preset.ambient.sky)
  hemi.groundColor.set(preset.ambient.ground)
  hemi.intensity = preset.ambient.intensity
  sun.color.set(preset.sun.color)
  sun.intensity = preset.sun.intensity

  if (world) world.setNight(preset.night)
  if (exterior) exterior.setLights(preset.night, false, false)
  if (headlights.length) {
    for (const l of headlights) l.intensity = preset.night > 0.1 ? 160 + preset.night * 900 : 0
  }
  hud.setTimeLabel(preset.clock)
  const phoneClock = document.getElementById('phone-clock')
  if (phoneClock) phoneClock.textContent = preset.clock
  const dawn = document.getElementById('dawn')
  if (dawn) dawn.classList.toggle('on', preset.dawn > 0.5)
  if (!silent) hud.toast(`${preset.label} · ${preset.clock}`)
  return sunDir
}

/* ------------------------------------------------------------------ */
/* driving / camera                                                    */
/* ------------------------------------------------------------------ */

function handleAction(action) {
  if (!ready) return
  switch (action) {
    case 'camera': {
      if (!running || paused) return
      const modes = ['cockpit', 'chase', 'hood']
      cameraMode = modes[(modes.indexOf(cameraMode) + 1) % modes.length]
      exterior.setCockpitView(cameraMode === 'cockpit')
      hud.setCamera(cameraMode)
      hud.toast(
        cameraMode === 'cockpit' ? 'Cockpit · drag to look' : cameraMode === 'chase' ? 'Chase camera' : 'Hood camera',
      )
      input?.recenterLook()
      cameraSnap = true
      break
    }
    case 'time':
      applyTime(presetIndex + 1)
      break
    case 'respawn':
      if (!running) return
      physics.reset(world.spawn)
      stopNavigation()
      input?.recenterLook()
      cameraSnap = true
      hud.toast(`Respawned · ${world.spawn.name || 'USJ 3'}`)
      break
    case 'mute':
      audio.setMuted(!audio.muted)
      hud.setSound(audio.muted)
      hud.toast(audio.muted ? 'Sound off' : 'Sound on')
      break
    case 'horn':
      if (!running || paused) return
      audio.horn()
      break
    case 'pause':
      if (!running) return
      setPaused(!paused)
      break
    default:
      break
  }
}

function setPaused(value) {
  if (!running) return
  paused = value
  const panel = document.getElementById('pause')
  panel.classList.toggle('hidden', !paused)
  hud.el.hud.classList.toggle('hidden', paused)
  audio.setPaused(paused)
  if (paused) {
    input.keys.clear()
    input.touch.throttle = input.touch.brake = input.touch.left = input.touch.right = input.touch.handbrake = false
    document.getElementById('pause-loc').textContent = physics.roadName || (world.spawn.name || 'USJ 3')
  } else {
    lastTime = performance.now()
    hud.show()
  }
}

function updateRoadGuide() {
  if (!guideGroup) return
  if (!running || paused || orientationBlocked || !physics.onRoad || nav) {
    guideGroup.visible = false
    return
  }
  const samples = world.roadGuidePath(physics.x, physics.z, physics.yaw, 50, 7)
  guideGroup.visible = samples.length > 0
  for (let i = 0; i < guideMeshes.length; i++) {
    const m = guideMeshes[i]
    const s = samples[i]
    if (!s) { m.visible = false; continue }
    const h = world.bridgeHeightAt(s.x, s.z, s.dx, s.dz)
    m.position.set(s.x, 0.05 + h + 0.035, s.z)
    m.rotation.y = Math.atan2(-s.dx, -s.dz)
    m.visible = true
  }
}

function updateCarVisual() {
  if (!physics) return
  carRoot.position.set(physics.x, 0.055 + physics.roadY + physics.bounce, physics.z)
  carRoot.rotation.y = physics.yaw
  tilt.rotation.z = physics.roll
  tilt.rotation.x = physics.pitch + physics.roadPitch
  exterior.updateWheels(physics.wheelSpin, physics.steer)
  exterior.setLights(
    preset ? preset.night : 0,
    (physics.brake > 0.05 && physics.speed > -0.5) || physics.speed < -0.2,
    physics.speed < -0.3,
  )
  interior.update(physics, { night: preset ? preset.night : 0 })
  carRoot.updateMatrixWorld(true)
}

function updateCamera(dt, force = false) {
  if (!physics) return
  const speed = Math.abs(physics.speed)

  // recenter the free-look after a moment
  if (!running || paused) {
    lookTarget.yaw = input ? input.look.yaw : 0
    lookTarget.pitch = input ? input.look.pitch : 0
  } else if (input && performance.now() < introUntil) {
    input.look.yaw = 0
    input.look.pitch = 0
    lookTarget.yaw = 0
    lookTarget.pitch = 0
  } else if (input) {
    const idle = performance.now() - input.look.lastActive > 2200
    if (idle && !input.look.dragging) {
      input.look.yaw *= 0.94
      input.look.pitch *= 0.94
    }
    lookTarget.yaw = input.look.yaw
    lookTarget.pitch = input.look.pitch
  }

  const targetFov = cameraMode === 'cockpit' ? 71 : cameraMode === 'chase' ? 60 : 73
  camera.fov += (targetFov - camera.fov) * Math.min(1, (force ? 1 : 4 * dt))
  camera.updateProjectionMatrix()

  if (!running) {
    // cinematic parked shot: stay on the road, look down the street
    const yaw = physics.yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const rx = Math.cos(yaw)
    const rz = -Math.sin(yaw)
    const back = 8.4 + Math.sin(elapsed * 0.18) * 0.55
    const side = 2.3 + Math.sin(elapsed * 0.13) * 0.4
    camera.position.set(
      physics.x - fx * back - rx * side,
      2.35 + physics.roadY + Math.sin(elapsed * 0.35) * 0.05,
      physics.z - fz * back - rz * side,
    )
    camera.lookAt(
      physics.x + fx * 9.5,
      0.92 + physics.roadY,
      physics.z + fz * 9.5,
    )
    camera.fov = 42
    camera.updateProjectionMatrix()
    return
  }

  if (cameraMode === 'cockpit' || cameraMode === 'hood') {
    const local = cameraMode === 'cockpit' ? interior.eye : new THREE.Vector3(0, 1.135, -1.33)
    tmpV.copy(local)
    tilt.localToWorld(tmpV)
    camera.position.copy(tmpV)

    tilt.getWorldQuaternion(tmpQ)
    tmpE.set(lookTarget.pitch - 0.032, lookTarget.yaw, 0, 'YXZ')
    const lookQ = new THREE.Quaternion().setFromEuler(tmpE)
    camera.quaternion.copy(tmpQ).multiply(lookQ)

    if (cameraMode === 'cockpit') {
      // gentle engine vibration + impact shake
      const v = 0.0007 + speed * 0.00002
      camera.position.y += Math.sin(elapsed * 31) * v
      camera.position.x += Math.sin(elapsed * 23.7) * v * 0.6
      const shake = physics.collideFlash * 0.045
      if (shake > 0.0001) {
        camera.position.x += (Math.random() - 0.5) * shake
        camera.position.y += (Math.random() - 0.5) * shake
      }
    }
  } else {
    const yaw = physics.yaw + lookTarget.yaw
    const dist = 6.3 + Math.min(1.2, speed * 0.02)
    const height = 2.55 + lookTarget.pitch * 3.4
    const desired = tmpV.set(
      physics.x + Math.sin(yaw) * dist,
      height + physics.roadY + physics.bounce,
      physics.z + Math.cos(yaw) * dist,
    )
    if (cameraSnap || force) {
      camera.position.copy(desired)
    } else {
      const k = 1 - Math.exp(-6.5 * dt)
      camera.position.lerp(desired, k)
    }
    const lookY = 0.78 + physics.roadY + lookTarget.pitch * 0.6
    camera.lookAt(physics.x, lookY, physics.z)
    const shake = physics.collideFlash * 0.06
    if (shake > 0.0001) {
      camera.position.x += (Math.random() - 0.5) * shake
      camera.position.y += (Math.random() - 0.5) * shake
    }
  }

  if (cameraSnap) cameraSnap = false
}

function updateMirror(dt) {
  if (!mirrorRT || cameraMode !== 'cockpit' || !running || paused || quality < 1) return
  mirrorTimer -= dt
  if (mirrorTimer > 0) return
  mirrorTimer = isTouch ? 0.18 : 0.09

  tmpV.set(0, 1.28, 1.9)
  carRoot.localToWorld(tmpV)
  mirrorCam.position.copy(tmpV)
  carRoot.getWorldQuaternion(tmpQ)
  const e = new THREE.Euler(0.16, Math.PI, 0, 'YXZ')
  mirrorCam.quaternion.copy(tmpQ).multiply(new THREE.Quaternion().setFromEuler(e))

  const extVisible = exterior.group.visible
  exterior.group.visible = false
  interior.group.visible = false
  renderer.setRenderTarget(mirrorRT)
  renderer.clear()
  renderer.render(scene, mirrorCam)
  renderer.setRenderTarget(null)
  exterior.group.visible = extVisible
  interior.group.visible = true
}

function updateSun() {
  if (!physics) return
  sun.position.set(
    physics.x + sunDir.x * 220,
    sunDir.y * 220 + 10,
    physics.z + sunDir.z * 220,
  )
  sunTarget.position.set(physics.x, 0, physics.z)
  sunTarget.updateMatrixWorld()
}

/* ------------------------------------------------------------------ */
/* Waze phone UI                                                        */
/* ------------------------------------------------------------------ */

function formatDistance(metres) {
  if (metres == null || !Number.isFinite(metres)) return '—'
  if (metres < 950) return `${Math.max(10, Math.round(metres / 10) * 10)} m`
  return `${(metres / 1000).toFixed(1)} km`
}

function formatEta(metres) {
  if (metres == null || !Number.isFinite(metres)) return '—'
  const mins = Math.max(1, Math.round(metres / 520))
  return `${mins} min`
}

function initPhoneUi() {
  const list = document.getElementById('dest-list')
  if (!list) return
  list.innerHTML = DESTINATIONS.map(
    (d) => `<button class="dest-row" data-dest="${d.id}" type="button">
      <span class="dest-icon" style="background:${d.color}24;color:${d.color}">${d.icon}</span>
      <span class="dest-text"><span class="dest-name">${d.name}</span><span class="dest-sub">${d.sub}</span></span>
      <span class="dest-dist" data-dist="${d.id}">—</span>
    </button>`,
  ).join('')

  list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-dest]')
    if (!row) return
    const dest = DESTINATIONS.find((d) => d.id === row.dataset.dest)
    if (dest) selectDestination(dest)
  })

  const search = document.getElementById('phone-search')
  search?.addEventListener('click', () => {
    if (nav) {
      stopNavigation()
    } else {
      updateDestinationDistances()
      hud.toast('Pick a destination on the phone', 1800)
    }
  })
  document.getElementById('nav-stop')?.addEventListener('click', () => stopNavigation())
  document.getElementById('nav-change')?.addEventListener('click', () => stopNavigation())
}

function updateDestinationDistances() {
  if (!router || !physics) return
  for (const dest of DESTINATIONS) {
    const el = document.querySelector(`[data-dist="${dest.id}"]`)
    if (!el) continue
    const route = router.route({ x: physics.x, z: physics.z }, dest, dest.name)
    el.textContent = route ? formatDistance(route.distance) : '—'
  }
}

function clockToMinutes(text) {
  const m = String(text || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return 16 * 60 + 42
  let h = parseInt(m[1], 10) % 12
  if (m[3].toUpperCase() === 'PM') h += 12
  return h * 60 + parseInt(m[2], 10)
}

function minutesToClock(total) {
  const mins = ((total % 1440) + 1440) % 1440
  const h24 = Math.floor(mins / 60)
  const mm = mins % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h = h24 % 12 || 12
  return `${h}:${String(mm).padStart(2, '0')} ${ampm}`
}

function arrivalClock(minutesAhead) {
  return minutesToClock(clockToMinutes(preset?.clock || '4:42 PM') + minutesAhead)
}

function selectDestination(dest, { reroute = false } = {}) {
  if (!router) return
  const route = router.route({ x: physics.x, z: physics.z }, dest, dest.name)
  if (!route) {
    hud.toast(`No route found to ${dest.name}`, 2400)
    return
  }
  nav = {
    dest,
    route,
    arrived: false,
    offSince: 0,
    lastReroute: 0,
  }
  minimap.setNav(nav)
  document.getElementById('phone-search-text').textContent = dest.name
  document.getElementById('nav-dest-name').textContent = dest.name
  document.getElementById('nav-dest-sub').textContent = dest.sub
  document.getElementById('dest-panel').classList.add('hidden')
  document.getElementById('nav-panel').classList.remove('hidden')
  document.getElementById('nav-banner').classList.remove('hidden')
  document.getElementById('phone').classList.add('navigating')
  navUiLast = 0
  updateNavUi({ along: 0, off: 0 })
  if (!reroute) hud.toast(`Navigating to ${dest.name}`, 2500)
}

function stopNavigation() {
  nav = null
  minimap.setNav(null)
  document.getElementById('phone-search-text').textContent = 'Where to?'
  document.getElementById('dest-panel').classList.remove('hidden')
  document.getElementById('nav-panel').classList.add('hidden')
  document.getElementById('nav-banner').classList.add('hidden')
  document.getElementById('phone').classList.remove('navigating')
  updateDestinationDistances()
}

function updateNavigation(now) {
  if (!nav) return
  const progress = router.progress(nav.route, physics.x, physics.z)
  const remaining = Math.max(0, nav.route.distance - progress.along)
  nav.remaining = remaining
  nav.off = progress.off

  if (!nav.arrived && remaining < 28) {
    nav.arrived = true
    hud.toast(`Arrived at ${nav.dest.name}`, 3500)
  }

  // If the driver leaves the line, quietly recompute from where they are.
  if (!nav.arrived && progress.off > 55 && physics.speedKmh > 4) {
    if (!nav.offSince) nav.offSince = now
    else if (now - nav.offSince > 2400 && now - nav.lastReroute > 6000) {
      nav.lastReroute = now
      selectDestination(nav.dest, { reroute: true })
      return
    }
  } else {
    nav.offSince = 0
  }

  if (now - navUiLast > 240 || nav.arrived) {
    navUiLast = now
    updateNavUi(progress)
  }
}

function updateNavUi(progress) {
  if (!nav) return
  const along = progress?.along || 0
  const remaining = Math.max(0, nav.route.distance - along)
  const next = router.nextInstruction(nav.route, along)
  const icons = { start: '↑', continue: '↑', left: '↰', right: '↱', uturn: '↺', arrive: '⚑' }
  const etaMin = Math.max(1, Math.round(remaining / 520))

  document.getElementById('nav-arrival').textContent = nav.arrived ? 'Arrived' : arrivalClock(etaMin)
  document.getElementById('nav-summary').textContent = nav.arrived
    ? nav.dest.name
    : `${etaMin} min  ·  ${formatDistance(remaining)}`

  let bannerDist = 'Arrived'
  let bannerRoad = nav.dest.name
  let icon = '⚑'
  let guideText = `ARRIVED · ${nav.dest.name}`

  if (!nav.arrived) {
    if (!next || next.type === 'arrive') {
      bannerDist = formatDistance(remaining)
      bannerRoad = nav.dest.name
      icon = '⚑'
      guideText = `ARRIVE · ${nav.dest.name}`
    } else {
      const d = Math.max(0, next.at - along)
      bannerDist = formatDistance(d)
      bannerRoad = next.road || 'the road'
      icon = icons[next.type] || '↑'
      guideText = `${icon} ${formatDistance(d)} · ${next.text}`
    }
  }
  document.getElementById('banner-icon').textContent = icon
  document.getElementById('banner-dist').textContent = bannerDist
  document.getElementById('banner-road').textContent = bannerRoad
  hud.setGuide(guideText, true)
}

/* ------------------------------------------------------------------ */
/* start / pause                                                       */
/* ------------------------------------------------------------------ */

async function startGame() {
  if (!ready || running) return
  await audio.start()
  running = true
  paused = false
  hud.show()
  exterior.setCockpitView(true)
  cameraMode = 'cockpit'
  hud.setCamera('cockpit')
  input.recenterLook()
  cameraSnap = true
  introUntil = performance.now() + 900
  startEl.classList.add('fadeout')
  setTimeout(() => startEl.classList.add('hidden'), 900)
  hud.toast(`Free roam · ${world.spawn.name || 'USJ 3'}`, 3000)
  audio.setMuted(audio.muted)
  requestWakeLock()
  updateDestinationDistances()
  checkOrientation()
  lastTime = performance.now()
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen')
  } catch {
    /* not available */
  }
}

document.getElementById('resume').addEventListener('click', () => setPaused(false))
document.getElementById('respawn').addEventListener('click', () => {
  physics.reset(world.spawn)
  stopNavigation()
  setPaused(false)
  input.recenterLook()
  cameraSnap = true
  hud.toast(`Respawned · ${world.spawn.name || 'USJ 3'}`)
})

/* ------------------------------------------------------------------ */
/* orientation / resize / quality                                      */
/* ------------------------------------------------------------------ */

function checkOrientation() {
  const portrait = isTouch && window.innerHeight > window.innerWidth * 1.02 && window.innerWidth < 1024
  const overlay = document.getElementById('rotate')
  const blockedNow = portrait && running
  if (blockedNow !== orientationBlocked) {
    orientationBlocked = blockedNow
    overlay.classList.toggle('hidden', !orientationBlocked)
  }
}

window.addEventListener('resize', () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP[quality]))
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  checkOrientation()
})

window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 250))

function applyQuality() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP[quality]))
  renderer.setSize(window.innerWidth, window.innerHeight)
  const shadows = quality >= 1
  renderer.shadowMap.enabled = shadows
  sun.castShadow = shadows
  renderer.shadowMap.needsUpdate = true
}

/* ------------------------------------------------------------------ */
/* loop                                                                */
/* ------------------------------------------------------------------ */

let fpsAccum = 0
let fpsFrames = 0
let qualityTimer = 0
let firstFrame = true

function loop(now) {
  requestAnimationFrame(loop)
  const rawDt = (now - lastTime) / 1000
  lastTime = now
  const dt = Math.min(0.05, Math.max(0.0005, rawDt))
  elapsed += dt

  if (!ready) return

  // skip everything while the rotate-device overlay is up
  const active = running && !paused && !orientationBlocked

  if (active && input) {
    physics.update(dt, input.state(), world)
    updateCarVisual()
    const phoneSpeed = document.getElementById('phone-speed-value')
    if (phoneSpeed) phoneSpeed.textContent = String(Math.round(physics.speedKmh))
    audio.update({
      rpm: physics.rpm,
      speed: physics.speedKmh / 3.6,
      throttle: physics.throttle,
      onRoad: physics.onRoad,
    })
    hud.setLocation(physics.roadName || (physics.onRoad ? 'Jalan tanpa nama' : 'Off the tarmac'), 'USJ 3 · Subang Jaya', physics.roadRef)
    hud.update(physics)
    if (!nav) {
      const junction = world.junctionInfoAt(physics.x, physics.z)
      if (!physics.onRoad) hud.setGuide('OFF ROAD', false)
      else if (junction.signal) hud.setGuide('TRAFFIC LIGHT · U-TURN ALLOWED', true)
      else if (junction.near) hud.setGuide('JUNCTION · U-TURN ALLOWED', true)
      else hud.setGuide('FOLLOW ROAD', false)
    }
    if (physics.turnBlocked && now > turnHintAt) {
      hud.toast('U-turn only at junctions or traffic lights', 2200)
      turnHintAt = now + 3000
    }
    updateNavigation(now)
    if (!nav && now > destinationTimer) {
      destinationTimer = now + 8000
      updateDestinationDistances()
    }
    minimap.draw(physics, nav)
  } else if (!running) {
    updateCarVisual()
  }

  updateRoadGuide()
  updateCamera(dt, firstFrame)
  if (world && world.updateCulling) world.updateCulling(camera.position)
  updateSun()
  updateMirror(dt)
  sky.update(camera)

  renderer.render(scene, camera)
  firstFrame = false

  // adaptive resolution
  fpsAccum += rawDt
  fpsFrames++
  qualityTimer += rawDt
  if (qualityTimer > 3 && running) {
    const avg = fpsFrames / fpsAccum
    const floor = isTouch ? 27 : 42
    if (avg < floor && quality > 0) {
      quality--
      applyQuality()
      if (quality === 0 && mirrorRT) interior.setMirrorTexture(null)
    }
    qualityTimer = 0
    fpsAccum = 0
    fpsFrames = 0
  }
}

/* ------------------------------------------------------------------ */
/* pwa + misc                                                          */
/* ------------------------------------------------------------------ */

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (running && !paused) setPaused(true)
    wakeLock?.release?.().catch(() => {})
    wakeLock = null
  } else if (running && !paused) {
    requestWakeLock()
  }
})

window.addEventListener('beforeunload', () => {
  wakeLock?.release?.().catch(() => {})
})




init()
