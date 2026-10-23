import * as THREE from 'three'

const WHEELBASE = 2.55
const WHEEL_RADIUS = 0.305
const MAX_SPEED = 51 // m/s ≈ 184 km/h
const MAX_REVERSE = 10
const GEAR_TOPS = [28, 58, 96, 136, 190] // km/h upper bound of each gear

export class CarPhysics {
  constructor(spawn) {
    this.spawn = spawn
    this.reset(spawn)
  }

  reset(spawn = this.spawn) {
    this.spawn = spawn
    this.x = spawn.x
    this.z = spawn.z
    this.yaw = Math.atan2(-spawn.dx, -spawn.dz)
    this.speed = 0 // m/s along forward
    this.steer = 0 // -1..1 smoothed
    this.wheelAngle = 0
    this.wheelSpin = 0
    this.gear = 1
    this.gearLabel = 'P'
    this.rpm = 900
    this.distance = 0
    this.accel = 0
    this.yawRate = 0
    this.roll = 0
    this.pitch = 0
    this.bounce = 0
    this.roadY = 0
    this.roadPitch = 0
    this.roadSign = 0
    this.turnBlocked = false
    this.collideFlash = 0
    this.onRoad = true
    this.roadName = spawn.name || ''
    this.roadRef = spawn.ref || ''
    this.timeSinceStart = 0
    this.handbrake = false
    this.throttle = 0
    this.brake = 0
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
  }

  update(dt, input, world) {
    dt = Math.min(dt, 0.05)
    this.timeSinceStart += dt

    const throttle = input.throttle
    const brake = input.brake
    const handbrake = input.handbrake
    this.throttle = throttle
    this.brake = brake

    // steering — less lock at speed, smoothed
    const speedKmh = Math.abs(this.speed) * 3.6
    const lock = 0.58 / (1 + speedKmh * 0.016)
    const target = input.steer * lock
    const rate = 7.5 - Math.min(4.5, speedKmh * 0.03)
    this.steer += (target - this.steer) * Math.min(1, rate * dt)

    const prevSpeed = this.speed

    // engine / brakes
    if (throttle > 0.01) {
      const curve = Math.pow(Math.max(0, 1 - Math.max(0, this.speed) / MAX_SPEED), 0.62)
      const power = this.speed < -0.2 ? 12 : 8.6
      this.speed += power * throttle * curve * dt
    }
    if (brake > 0.01) {
      if (this.speed > 0.4) {
        this.speed -= 15.5 * brake * dt
        if (this.speed < 0) this.speed = 0
      } else if (throttle < 0.05) {
        this.speed -= 4.6 * brake * dt
      }
    }
    if (throttle < 0.05 && brake < 0.05) {
      const drag = 0.35 + Math.abs(this.speed) * 0.028
      const drop = drag * dt
      if (Math.abs(this.speed) <= drop) this.speed = 0
      else this.speed -= Math.sign(this.speed) * drop
    }
    if (handbrake) {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 9.5 * dt)
    }

    // surface drag / limits
    this.onRoad = world.roadInfo.onRoad(this.x, this.z)
    if (!this.onRoad && Math.abs(this.speed) > 0.2) {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 5.5 * dt)
    }
    this.speed = THREE.MathUtils.clamp(this.speed, -MAX_REVERSE, MAX_SPEED)

    // yaw
    const grip = handbrake ? 0.52 : 1
    const turnBoost = handbrake ? 1.55 : 1
    const yawRate = (this.speed / WHEELBASE) * Math.tan(this.steer) * grip * turnBoost
    this.yawRate += (yawRate - this.yawRate) * Math.min(1, 12 * dt)
    this.yaw += this.yawRate * dt

    // Road guide rule: on a normal stretch of road you can follow the curve
    // and change lanes, but a sharp turn / U-turn is only allowed near a
    // junction with a side road or at a traffic light.
    this.turnBlocked = false
    const roadNear = world.nearestRoadInfo(this.x, this.z)
    if (roadNear && roadNear.dist < roadNear.width / 2 + 1.8) {
      // Directed road heading: track which way along this way we are riding.
      // A U-turn reverses that sign, which is only allowed at a junction or
      // a traffic light.
      const dot = Math.cos(this.yaw - roadNear.angle)
      const j = world.junctionInfoAt(this.x, this.z)
      if (!this.roadSign) this.roadSign = dot >= 0 ? 1 : -1
      if (j.near || j.signal) {
        this.roadSign = dot >= 0 ? 1 : -1
      } else {
        let refYaw = roadNear.angle + (this.roadSign < 0 ? Math.PI : 0)
        let diff = this.yaw - refYaw
        diff = Math.atan2(Math.sin(diff), Math.cos(diff))
        let limit = 1.05 // ~60 degrees; enough for bends and lane changes
        if (Math.abs(diff) > limit) {
          this.yaw = refYaw + Math.sign(diff) * limit
          this.yawRate *= 0.15
          this.turnBlocked = true
        }
      }
    } else {
      this.roadSign = 0
    }

    // move
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    this.x += fx * this.speed * dt
    this.z += fz * this.speed * dt
    this.distance += Math.abs(this.speed) * dt
    this.wheelSpin += (this.speed / WHEEL_RADIUS) * dt

    // collisions — sample three circles along the body
    const radius = 0.92
    let hit = false
    for (const offset of [0.95, 0, -0.95]) {
      const px = this.x + fx * offset
      const pz = this.z + fz * offset
      const push = world.collision.resolve({ x: px, z: pz }, radius)
      if (push) {
        this.x += push.x
        this.z += push.z
        hit = true
      }
    }
    if (hit) {
      this.collideFlash = Math.min(1, this.collideFlash + Math.min(1, Math.abs(this.speed) / 12))
      this.speed *= -0.12
      this.yawRate *= 0.4
    }

    // soft map edge
    const b = world.bounds
    const margin = 25
    if (this.x < b.minX + margin) { this.x = b.minX + margin; this.speed *= 0.55 }
    if (this.x > b.maxX - margin) { this.x = b.maxX - margin; this.speed *= 0.55 }
    if (this.z < b.minZ + margin) { this.z = b.minZ + margin; this.speed *= 0.55 }
    if (this.z > b.maxZ - margin) { this.z = b.maxZ - margin; this.speed *= 0.55 }

    // automatic gearbox feel
    const kmh = Math.abs(this.speed) * 3.6
    if (this.speed < -0.4) {
      this.gearLabel = 'R'
      this.gear = -1
      this.rpm = 900 + ((kmh / 3.6) / MAX_REVERSE) * 2600
    } else if (kmh < 0.6 && throttle < 0.05) {
      this.gearLabel = 'P'
      this.gear = 0
      this.rpm = 900
    } else {
      this.gearLabel = 'D'
      let g = 1
      for (let i = 0; i < GEAR_TOPS.length; i++) {
        if (kmh <= GEAR_TOPS[i]) { g = i + 1; break }
        g = GEAR_TOPS.length
      }
      this.gear = g
      const lower = g === 1 ? 0 : GEAR_TOPS[g - 2]
      const upper = GEAR_TOPS[g - 1]
      const t = THREE.MathUtils.clamp((kmh - lower) / (upper - lower), 0, 1)
      this.rpm = 1150 + t * 5000 + throttle * 450
      if (g === 1 && kmh < 3 && throttle < 0.1) this.rpm = 900
    }
    this.rpm = THREE.MathUtils.clamp(this.rpm, 850, 6900)

    // body motion
    this.accel = (this.speed - prevSpeed) / Math.max(dt, 0.001)
    const targetRoll = THREE.MathUtils.clamp(-this.yawRate * this.speed * 0.0042, -0.055, 0.055)
    const targetPitch = THREE.MathUtils.clamp(-this.accel * 0.0028, -0.028, 0.028)
    this.roll += (targetRoll - this.roll) * Math.min(1, 6 * dt)
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 5 * dt)
    const bumpTarget = !this.onRoad ? Math.sin(this.distance * 2.6) * Math.min(0.012, Math.abs(this.speed) * 0.0008) : 0
    this.bounce += (bumpTarget - this.bounce) * Math.min(1, 8 * dt)
    this.collideFlash = Math.max(0, this.collideFlash - dt * 2.2)
    const gridName = world.roadInfo.nameAt(this.x, this.z) || ''
    const gridRef = world.roadInfo.refAt(this.x, this.z) || ''
    this.roadName = gridName
    this.roadRef = gridRef

    // Decide whether we are on top of a flyover or passing underneath it.
    // Direction matters: the 2-D bridge footprint also matches traffic on the
    // road crossing below. Only follow a deck when the car is heading along
    // that deck and is either still up there or already on the bridge road.
    const bridgeInfo = world.bridgeInfoAt(this.x, this.z, fx, fz)
    const nearRoad = world.nearestRoadInfo(this.x, this.z)
    const bridgeRoad = nearRoad && bridgeInfo.roadIndex >= 0 && nearRoad.roadIndex === bridgeInfo.roadIndex
    const wasUp = this.roadY > 0.3
    // Enter a deck only at its ramp, then keep following it. This stops a car
    // on the road underneath from being lifted onto the middle of a flyover.
    const canEnter = bridgeInfo.h < 2.2
    const onBridge = bridgeInfo.h > 0.05 && (wasUp || (bridgeRoad && canEnter))
    this.roadY = onBridge ? bridgeInfo.h : 0
    if (onBridge && bridgeInfo.name) {
      this.roadName = bridgeInfo.name
      this.roadRef = bridgeInfo.ref
    }

    const hf = this.roadY > 0.12 ? world.bridgeHeightAt(this.x + fx * 1.25, this.z + fz * 1.25, fx, fz) : 0
    const hr = this.roadY > 0.12 ? world.bridgeHeightAt(this.x - fx * 1.25, this.z - fz * 1.25, fx, fz) : 0
    const targetRoadPitch = Math.atan2(hf - hr, 2.5)
    this.roadPitch += (targetRoadPitch - this.roadPitch) * Math.min(1, 8 * dt)

    this.handbrake = handbrake
  }
}
