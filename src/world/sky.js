import * as THREE from 'three'
import { glowTexture } from './textures.js'

export const TIME_KEYS = ['afternoon', 'sunset', 'night']

export const TIME_PRESETS = {
  afternoon: {
    key: 'afternoon',
    label: 'Golden hour',
    clock: '4:42 PM',
    weather: 'Petang yang tenang',
    sun: { azimuth: 252, elevation: 27, color: '#ffe2b0', intensity: 3.5 },
    ambient: { sky: '#a9c7e8', ground: '#6a614b', intensity: 1.05 },
    skyTop: '#4f8fc9',
    skyHorizon: '#f0d7b2',
    skyBottom: '#c9c6b6',
    sunColor: '#ffe6b8',
    sunPower: 1.0,
    fog: { color: '#dfd1bb', near: 380, far: 2900 },
    exposure: 1.02,
    night: 0,
    stars: 0,
    dawn: 0,
  },
  sunset: {
    key: 'sunset',
    label: 'Sunset',
    clock: '7:12 PM',
    weather: 'Senja di USJ',
    sun: { azimuth: 264, elevation: 6.5, color: '#ffab6e', intensity: 2.3 },
    ambient: { sky: '#8ea2c4', ground: '#5c5246', intensity: 0.9 },
    skyTop: '#31557f',
    skyHorizon: '#ffb178',
    skyBottom: '#dba27f',
    sunColor: '#ffb070',
    sunPower: 1.15,
    fog: { color: '#dfa583', near: 280, far: 2200 },
    exposure: 1.06,
    night: 0.42,
    stars: 0.12,
    dawn: 1,
  },
  night: {
    key: 'night',
    label: 'Night',
    clock: '10:08 PM',
    weather: 'Malam yang sunyi',
    sun: { azimuth: 310, elevation: 34, color: '#8ea7d6', intensity: 0.32 },
    ambient: { sky: '#2b3c58', ground: '#11151b', intensity: 0.42 },
    skyTop: '#060b18',
    skyHorizon: '#16233a',
    skyBottom: '#0a0f18',
    sunColor: '#b9cdf0',
    sunPower: 0.0,
    fog: { color: '#0a101c', near: 160, far: 1500 },
    exposure: 1.18,
    night: 1,
    stars: 1,
    dawn: 0,
  },
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`

const SKY_FRAG = /* glsl */ `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 bottomColor;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform float sunPower;
uniform float night;
varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float t = clamp(pow(max(h, 0.0), 0.62), 0.0, 1.0);
  vec3 col = mix(horizonColor, topColor, t);
  if (h < 0.0) col = mix(horizonColor, bottomColor, clamp(-h * 3.2, 0.0, 1.0));

  float sunDot = max(dot(dir, sunDir), 0.0);
  col += sunColor * pow(sunDot, 6.0) * 0.28 * sunPower;
  col += sunColor * pow(sunDot, 180.0) * 1.35 * sunPower;

  // soft sun disc
  float disc = smoothstep(0.9992, 0.99972, sunDot);
  col += sunColor * disc * 3.6 * sunPower;

  // horizon haze band
  float haze = exp(-abs(h) * 9.0) * 0.12;
  col += horizonColor * haze;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export class Sky {
  constructor() {
    this.group = new THREE.Group()
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color('#4e8ec9') },
        horizonColor: { value: new THREE.Color('#eadfc4') },
        bottomColor: { value: new THREE.Color('#c9cfc3') },
        sunColor: { value: new THREE.Color('#ffe6b8') },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunPower: { value: 1 },
        night: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    })

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(28000, 48, 24), this.material)
    this.dome.frustumCulled = false
    this.dome.renderOrder = -10
    this.group.add(this.dome)

    // stars
    const starCount = 1400
    const pos = new Float32Array(starCount * 3)
    const sizes = new Float32Array(starCount)
    for (let i = 0; i < starCount; i++) {
      const u = Math.random()
      const v = Math.random() * 0.95 + 0.02
      const theta = u * Math.PI * 2
      const phi = Math.acos(v)
      const r = 26000
      pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r
      pos[i * 3 + 1] = Math.cos(phi) * r
      pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r
      sizes[i] = Math.random()
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xdfe8ff,
      size: 2.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    this.stars = new THREE.Points(starGeo, this.starMaterial)
    this.stars.frustumCulled = false
    this.stars.renderOrder = -9
    this.group.add(this.stars)

    // sun sprite
    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xfff0cc,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      }),
    )
    this.sunSprite.scale.setScalar(520)
    this.sunSprite.renderOrder = -8
    this.group.add(this.sunSprite)

    // moon sprite
    this.moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xd5e3ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      }),
    )
    this.moonSprite.scale.setScalar(240)
    this.moonSprite.renderOrder = -8
    this.group.add(this.moonSprite)

    this.envScene = new THREE.Scene()
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.material)
    envDome.frustumCulled = false
    this.envScene.add(envDome)
    this.envDome = envDome
    this.envDome.renderOrder = 0
  }

  setPreset(preset, renderer) {
    this.preset = preset
    const u = this.material.uniforms
    u.topColor.value.set(preset.skyTop)
    u.horizonColor.value.set(preset.skyHorizon)
    u.bottomColor.value.set(preset.skyBottom)
    u.sunColor.value.set(preset.sunColor)
    u.sunPower.value = preset.sunPower
    u.night.value = preset.night

    const sunDir = sunDirection(preset.sun.azimuth, preset.sun.elevation)
    u.sunDir.value.copy(sunDir)
    this.sunSprite.position.copy(sunDir).multiplyScalar(3900)
    this.sunSprite.material.color.set(preset.sunColor)
    this.sunSprite.material.opacity = Math.max(0, preset.sunPower)
    this.sunSprite.scale.setScalar(preset.key === 'night' ? 300 : 560)
    this.sunSprite.visible = preset.sun.elevation > -2

    const moonDir = sunDirection(preset.sun.azimuth + 180, 32)
    this.moonSprite.position.copy(moonDir).multiplyScalar(4000)
    this.moonSprite.material.opacity = preset.key === 'night' ? 0.8 : 0
    this.moonSprite.visible = preset.key === 'night'

    this.starMaterial.opacity = preset.stars
    this.stars.visible = preset.stars > 0.01

    if (renderer) {
      const pmrem = new THREE.PMREMGenerator(renderer)
      pmrem.compileEquirectangularShader()
      this.envRT?.dispose()
      this.envRT = pmrem.fromScene(this.envScene, 0, 0.1, 1000)
      this.envTexture = this.envRT.texture
      pmrem.dispose()
    }
    return sunDir
  }

  update(camera) {
    this.group.position.set(camera.position.x, 0, camera.position.z)
  }
}

export function sunDirection(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg)
  const el = THREE.MathUtils.degToRad(elevationDeg)
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el),
  ).normalize()
}
