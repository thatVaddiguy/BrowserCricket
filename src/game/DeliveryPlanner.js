import { PHYSICS, DIFFICULTIES } from './config.js';

export const DELIVERY_TYPES = Object.freeze([
  { name: 'Outswinger', swing: 1, spin: 0.13, bounce: 6.5, speed: 134 },
  { name: 'Inswinger', swing: -1, spin: -0.10, bounce: 7, speed: 139 },
  { name: 'Seam-up delivery', swing: 0.20, spin: 0.05, bounce: 6, speed: 142 },
  { name: 'Off-break', swing: 0.08, spin: -0.75, bounce: 8.4, speed: 103 },
  { name: 'Leg-break', swing: -0.08, spin: 0.70, bounce: 8.8, speed: 98 },
  { name: 'Full-length yorker', swing: 0.35, spin: 0.04, bounce: 2.2, speed: 137 },
  { name: 'Slower ball', swing: -0.45, spin: -0.13, bounce: 6.3, speed: 113 },
]);

// Delivery generation is a replaceable strategy: manual bowling can supply the
// same velocity/acceleration payload without changing the innings engine.
export function planDelivery(ballNumber, rng = Math.random, requestedType = null, profile = DIFFICULTIES.normal) {
  const between = (a, b) => a + rng() * (b - a);
  const type = requestedType ?? (ballNumber === 0 ? DELIVERY_TYPES[2] :
    DELIVERY_TYPES[Math.floor(rng() * DELIVERY_TYPES.length)]);
  const speed = (type.speed + between(-3, 3)) * profile.speed;
  const bounceZ = type.bounce + between(-0.3, 0.3);
  const releaseZ = 21.5;
  const releaseY = 2.13;
  const vz = -speed / 3.6;
  const bounceTime = (releaseZ - bounceZ) / -vz;
  const vy = (PHYSICS.radius - releaseY + 0.5 * PHYSICS.gravity * bounceTime ** 2) / bounceTime;
  const swing = type.swing * between(2.6, 4.4) * profile.swing;
  const outside = rng() < 0.23 && ballNumber > 0;
  const line = outside ? (rng() < 0.5 ? -1 : 1) * between(0.31, 0.49) : between(-0.095, 0.095);
  const initialX = 0.20;
  const restitution = type.bounce < 3 ? 0.43 : 0.57;
  const afterBounceTime = (bounceZ - PHYSICS.crease) / (-vz * 0.86);
  const totalTime = bounceTime + afterBounceTime;
  const spin = type.spin * profile.spin;
  const spinKick = spin * 1.7;
  const vx = (line - initialX - 0.5 * swing * bounceTime ** 2 -
    (swing * bounceTime + spinKick) * afterBounceTime -
    0.5 * swing * 0.32 * afterBounceTime ** 2) / totalTime;
  return {
    name: type.name, speed, swing, spin, restitution,
    releaseZ, releaseY, vz, vy, vx, initialX, bounceZ, line,
    duration: totalTime / PHYSICS.deliveryTimeScale,
  };
}
