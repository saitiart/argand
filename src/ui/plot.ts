import { el } from './components.ts';

const SIZE = 128;   // CSS pixels

export interface CurvePlot {
    draw(curve: Float32Array | null, options?: { closed?: boolean; color?: string }): void;
}

export function curvePlot(parent: HTMLElement, title: string): CurvePlot {
    const pad = el('div', 'ui-pad', parent);
    el('div', 'ui-pad-title', pad, title);
    const canvas = el('canvas', 'ui-plot', pad);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d')!;

    return {
        draw(curve, options = {}) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, SIZE, SIZE);
            ctx.fillStyle = '#f7f8fa';
            ctx.fillRect(0, 0, SIZE, SIZE);
            if (!curve || curve.length < 4) return;

            // Bounds (always include the origin), equal aspect
            let minX = 0, maxX = 0, minY = 0, maxY = 0;
            for (let i = 0; i < curve.length; i += 2) {
                const x = curve[i], y = curve[i + 1];
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            }
            const span = Math.max(maxX - minX, maxY - minY, 1e-9);
            const scale = (SIZE - 20) / span;
            const ox = SIZE / 2 - ((minX + maxX) / 2) * scale;
            const oy = SIZE / 2 + ((minY + maxY) / 2) * scale;
            const X = (x: number) => ox + x * scale;
            const Y = (y: number) => oy - y * scale;

            // Axes through the origin
            ctx.strokeStyle = '#c8ccd6';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, Y(0)); ctx.lineTo(SIZE, Y(0));
            ctx.moveTo(X(0), 0); ctx.lineTo(X(0), SIZE);
            ctx.stroke();

            // Curve
            ctx.strokeStyle = options.color ?? '#ee6a0d';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            let pen = false;
            for (let i = 0; i < curve.length; i += 2) {
                const x = curve[i], y = curve[i + 1];
                if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
                if (pen) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y));
                pen = true;
            }
            if (options.closed && pen) ctx.closePath();
            ctx.stroke();

            // Origin and end point
            ctx.fillStyle = '#1f2328';
            ctx.beginPath(); ctx.arc(X(0), Y(0), 2.2, 0, Math.PI * 2); ctx.fill();
            const ex = curve[curve.length - 2], ey = curve[curve.length - 1];
            if (Number.isFinite(ex) && Number.isFinite(ey)) {
                ctx.fillStyle = options.color ?? '#ee6a0d';
                ctx.beginPath(); ctx.arc(X(ex), Y(ey), 3, 0, Math.PI * 2); ctx.fill();
            }
        },
    };
}
