// Shift+Drag rotates around the 4th dimension, but only around the XW and YW planes

import { Params } from '../config.ts';
import { Quat, quatMul, quatNormalize, quatFromAxisAngle } from '../quat.ts';

export interface QuaternionPair {
    get(): { left: Quat; right: Quat };
    set(left: Quat, right: Quat): void;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function attachFourDDrag(
    canvas: HTMLCanvasElement,
    params: Params,
    quats: QuaternionPair,
    onChange: () => void,
) {
    let last: [number, number] | null = null;

    const swallow = (e: Event) => {
        e.stopImmediatePropagation();
        e.preventDefault();
    };

    window.addEventListener('mousedown', e => {
        if (e.target !== canvas || !e.shiftKey || e.button !== 0) return;
        last = [e.clientX, e.clientY];
        swallow(e);
    }, true);

    window.addEventListener('mousemove', e => {
        if (!last) return;
        const radPerPx = Math.PI / Math.max(canvas.clientHeight, 1);   // full height = 180deg
        const ax = (e.clientX - last[0]) * radPerPx;
        const ay = (e.clientY - last[1]) * radPerPx;
        last = [e.clientX, e.clientY];
        swallow(e);
        if (ax === 0 && ay === 0) return;

        if (params.use_quaternion_rotation >= 0.5) {
            // Simple rotation in the X–W plane: qL = qR = e^{θ/2·i}; Y–W uses j.
            // Signs chosen so the drag turns the same way as in plane mode.
            const sx = quatFromAxisAngle([1, 0, 0], -ax);
            const sy = quatFromAxisAngle([0, 1, 0], ay);
            const s = quatMul(sy, sx);
            const s2 = quatMul(sx, sy);
            const { left, right } = quats.get();
            quats.set(quatNormalize(quatMul(s, left)), quatNormalize(quatMul(right, s2)));
        } else {
            params.rot_xw = wrapAngle(params.rot_xw + ax);
            params.rot_yw = wrapAngle(params.rot_yw - ay);
        }
        onChange();
    }, true);

    window.addEventListener('mouseup', e => {
        if (!last) return;
        last = null;
        swallow(e);
    }, true);
}

export type { Quat };
