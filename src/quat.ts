// =============================================================================
//  Quaternion helpers — layout [x, y, z, w], w = real part (same as the shaders)
// =============================================================================

import { Vec3Tuple } from './config.ts';

export type Quat = [number, number, number, number];

export const IDENTITY: Quat = [0, 0, 0, 1];

// Hamilton product a·b
export function quatMul(a: Quat, b: Quat): Quat {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}

export function quatNormalize(q: Quat): Quat {
    const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatFromAxisAngle(axis: Vec3Tuple, angle: number): Quat {
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < 1e-9) return [...IDENTITY];
    const s = Math.sin(angle / 2) / len;
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

// Inverse of quatFromAxisAngle: unit axis + angle in [0, 2π]
export function quatToAxisAngle(q: Quat): { axis: Vec3Tuple; angle: number } {
    const n = quatNormalize(q);
    const s = Math.hypot(n[0], n[1], n[2]);
    if (s < 1e-9) return { axis: [1, 0, 0], angle: 0 };
    return { axis: [n[0] / s, n[1] / s, n[2] / s], angle: 2 * Math.atan2(s, n[3]) };
}

// Rotates a 3D vector by a unit quaternion: q v q*
export function rotateVec(q: Quat, v: Vec3Tuple): Vec3Tuple {
    const p = quatMul(quatMul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
    return [p[0], p[1], p[2]];
}
