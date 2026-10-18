// =============================================================================
//  Trackball pad: shows a unit quaternion as a rotated globe, drag to turn it
//
//  A 4D rotation p -> qL p qR is set by two of these (left and right). The pad
//  draws a sphere whose frame is rotated by q, with q's rotation axis as an
//  arrow. Dragging spins the globe like a trackball (q <- Δ q); double-click
//  resets to no rotation.
// =============================================================================

import { Ui, el } from './components.ts';
import { Quat, IDENTITY, quatMul, quatFromAxisAngle, quatToAxisAngle, quatNormalize, rotateVec } from '../quat.ts';
import { Vec3Tuple } from '../config.ts';

export interface TrackballOptions {
    title: string;
    color: string;           // CSS color of the axis arrow
    get(): Quat;
    set(q: Quat): void;
}

const SIZE = 118;            // CSS pixels
const RADIUS = 48;

export function trackball(ui: Ui, parent: HTMLElement, o: TrackballOptions) {
    const pad = el('div', 'ui-pad', parent);
    el('div', 'ui-pad-title', pad, o.title);
    const canvas = el('canvas', undefined, pad);
    const caption = el('div', 'ui-pad-caption', pad);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d')!;

    const draw = () => {
        const q = o.get();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, SIZE, SIZE);
        const c = SIZE / 2;

        // Sphere silhouette
        const grad = ctx.createRadialGradient(c - 14, c - 16, 4, c, c, RADIUS);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, '#e9ebf2');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c, c, RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#c9cdd8';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Rotated frame: three great circles, back halves faint
        // (view: x right, y up, z toward the viewer)
        const circles: [Vec3Tuple, Vec3Tuple, string][] = [
            [[1, 0, 0], [0, 1, 0], '#d9534f'],   // XY plane
            [[0, 1, 0], [0, 0, 1], '#5cb85c'],   // YZ plane
            [[1, 0, 0], [0, 0, 1], '#4a7bd0'],   // XZ plane
        ];
        for (const [a, b, color] of circles) {
            const ra = rotateVec(q, a);
            const rb = rotateVec(q, b);
            for (const front of [false, true]) {
                ctx.strokeStyle = color;
                ctx.globalAlpha = front ? 0.9 : 0.18;
                ctx.lineWidth = front ? 1.4 : 1;
                ctx.beginPath();
                let pen = false;
                for (let k = 0; k <= 64; k++) {
                    const t = (k / 64) * Math.PI * 2;
                    const x = ra[0] * Math.cos(t) + rb[0] * Math.sin(t);
                    const y = ra[1] * Math.cos(t) + rb[1] * Math.sin(t);
                    const z = ra[2] * Math.cos(t) + rb[2] * Math.sin(t);
                    if ((z >= 0) !== front) { pen = false; continue; }
                    const px = c + x * RADIUS, py = c - y * RADIUS;
                    if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
                    pen = true;
                }
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;

        // Rotation axis arrow (length shrinks to a dot when there is no rotation)
        const { axis, angle } = quatToAxisAngle(q);
        const amount = Math.min(1, angle / Math.PI);
        if (amount > 1e-3) {
            const tipX = c + axis[0] * RADIUS * 0.95, tipY = c - axis[1] * RADIUS * 0.95;
            ctx.strokeStyle = o.color;
            ctx.fillStyle = o.color;
            ctx.globalAlpha = axis[2] >= 0 ? 1 : 0.45;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(c, c);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(tipX, tipY, 3.2, 0, Math.PI * 2);
            ctx.fill();
            // angle arc around the centre
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.35;
            ctx.beginPath();
            ctx.arc(c, c, 10, -Math.PI / 2, -Math.PI / 2 + angle);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#1f2328';
        ctx.beginPath();
        ctx.arc(c, c, 2, 0, Math.PI * 2);
        ctx.fill();

        const deg = (angle * 180) / Math.PI;
        caption.textContent = deg < 0.05
            ? 'no rotation'
            : `${deg.toFixed(0)}° about (${axis.map(v => v.toFixed(2)).join(', ')})`;
    };

    // Drag = trackball: moving right spins about +y, moving down about +x
    let last: [number, number] | null = null;
    canvas.addEventListener('pointerdown', e => {
        canvas.setPointerCapture(e.pointerId);
        last = [e.clientX, e.clientY];
    });
    canvas.addEventListener('pointermove', e => {
        if (!last) return;
        const dx = e.clientX - last[0];
        const dy = e.clientY - last[1];
        last = [e.clientX, e.clientY];
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const delta = quatFromAxisAngle([dy / len, dx / len, 0], len / RADIUS);
        o.set(quatNormalize(quatMul(delta, o.get())));
        ui.refresh();
    });
    const end = () => { last = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('dblclick', () => { o.set([...IDENTITY]); ui.refresh(); });

    ui.track(draw);
}
