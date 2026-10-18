// Domain map to edit the countour, computed in the CPU as its not very heavy

import { Params } from '../config.ts';
import { CONTOUR_SHAPES, MAP_W, MAP_H, MAP_ASPECT, MapData, MapView, Point2, mapView } from '../calculus.ts';
import { Ui, el } from './components.ts';

const WIDTH = 200;
const HEIGHT = Math.round(WIDTH * MAP_ASPECT);
const HANDLE_PX = 9;

export interface ContourMap {
    setBackground(map: MapData): void;
}

// Phase → hue, |f| → lightness (a light version of the surface colouring)
function phaseColor(re: number, im: number): [number, number, number] {
    if (!Number.isFinite(re) || !Number.isFinite(im)) return [255, 255, 255];
    const hue = (Math.atan2(im, re) / (2 * Math.PI) + 1) % 1;
    const lm = Math.log2(Math.max(Math.hypot(re, im), 1e-30));
    const light = 0.42 + 0.4 * (0.5 + 0.5 * Math.tanh(lm * 0.35));
    const sat = 0.55;
    // HSL -> RGB
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const h6 = hue * 6;
    const x = c * (1 - Math.abs((h6 % 2) - 1));
    const [r, g, b] = h6 < 1 ? [c, x, 0] : h6 < 2 ? [x, c, 0] : h6 < 3 ? [0, c, x]
        : h6 < 4 ? [0, x, c] : h6 < 5 ? [x, 0, c] : [c, 0, x];
    const m = light - c / 2;
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function contourMap(ui: Ui, parent: HTMLElement, params: Params, onEdit: () => void): ContourMap {
    const canvas = el('canvas', 'ui-map', parent);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    canvas.style.width = `${WIDTH}px`;
    canvas.style.height = `${HEIGHT}px`;
    const ctx = canvas.getContext('2d')!;

    // Background image at grid resolution scaled up when drawn
    const bg = document.createElement('canvas');
    bg.width = MAP_W;
    bg.height = MAP_H;
    const bgCtx = bg.getContext('2d')!;
    let bgView: MapView | null = null;

    let frozenView: MapView | null = null;
    const view = () => frozenView ?? mapView(params);
    const toScreen = (v: MapView, p: Point2): Point2 => [
        ((p[0] - v.cx) / v.halfW * 0.5 + 0.5) * WIDTH,
        (0.5 - (p[1] - v.cy) / v.halfH * 0.5) * HEIGHT,
    ];
    const toDomain = (v: MapView, x: number, y: number): Point2 => [
        v.cx + ((x / WIDTH) * 2 - 1) * v.halfW,
        v.cy - ((y / HEIGHT) * 2 - 1) * v.halfH,
    ];

    const rimHandle = (cx: number, cy: number, r: number): Point2 => [cx + r * Math.SQRT1_2, cy + r * Math.SQRT1_2];

    const shape = () => Number(params.contourShape);
    const vertices = (): Point2[] => (shape() === CONTOUR_SHAPES.path ? params.contour_path : params.contour_polygon);
    const closed = () => shape() !== CONTOUR_SHAPES.path;

    const arrow = (a: Point2, b: Point2) => {
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(5, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath();
        ctx.fill();
        ctx.restore();
    };

    const draw = () => {
        const v = view();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#f4f5f8';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // Phase background placed where it was sampled, so it stays right while the view moves
        if (bgView) {
            const [x0, y0] = toScreen(v, [bgView.cx - bgView.halfW, bgView.cy + bgView.halfH]);
            const [x1, y1] = toScreen(v, [bgView.cx + bgView.halfW, bgView.cy - bgView.halfH]);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(bg, x0, y0, x1 - x0, y1 - y0);
        }

        // Axes
        ctx.strokeStyle = 'rgba(30, 35, 45, 0.35)';
        ctx.lineWidth = 1;
        const [ox, oy] = toScreen(v, [0, 0]);
        ctx.beginPath();
        ctx.moveTo(0, oy); ctx.lineTo(WIDTH, oy);
        ctx.moveTo(ox, 0); ctx.lineTo(ox, HEIGHT);
        ctx.stroke();

        // Contour
        ctx.strokeStyle = '#1f2328';
        ctx.fillStyle = '#1f2328';
        ctx.lineWidth = 2;
        if (shape() === CONTOUR_SHAPES.circle) {
            const [cx, cy] = toScreen(v, [params.contour_cx, params.contour_cy]);
            const r = (params.contour_r / v.halfW) * 0.5 * WIDTH;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
            arrow([cx + r, cy + 1], [cx + r, cy - 1]);         // counter-clockwise (screen y is down)
            const [hx, hy] = rimHandle(cx, cy, r);
            ctx.fillStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(hx, hy, hover === 'radius' ? 6 : 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else {
            const pts = vertices().map(p => toScreen(v, p));
            ctx.beginPath();
            pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
            if (closed()) ctx.closePath();
            ctx.stroke();
            const edges = closed() ? pts.length : pts.length - 1;
            for (let e = 0; e < edges; e++) arrow(pts[e], pts[(e + 1) % pts.length]);
            pts.forEach((p, i) => {
                ctx.fillStyle = i === 0 ? '#ee6a0d' : '#ffffff';
                ctx.strokeStyle = '#1f2328';
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(p[0], p[1], hover === i ? 6 : 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            });
        }
    };


    type Drag = { kind: 'vertex'; index: number } | { kind: 'center'; dx: number; dy: number } | { kind: 'radius' };
    let drag: Drag | null = null;
    let hover: number | 'radius' | null = null;     // highlighted handle

    // Pointer position in drawing pixels (robust to CSS scaling)
    const local = (e: PointerEvent | MouseEvent): Point2 => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) * (WIDTH / r.width), (e.clientY - r.top) * (HEIGHT / r.height)];
    };
    const circleOnScreen = (v: MapView) => {
        const [cx, cy] = toScreen(v, [params.contour_cx, params.contour_cy]);
        return { cx, cy, r: (params.contour_r / v.halfW) * 0.5 * WIDTH };
    };
    const nearestVertex = (x: number, y: number) => {
        const v = view();
        let best = -1, bestD = HANDLE_PX;
        vertices().forEach((p, i) => {
            const [sx, sy] = toScreen(v, p);
            const d = Math.hypot(sx - x, sy - y);
            if (d < bestD) { bestD = d; best = i; }
        });
        return best;
    };
    // What a press at (x, y) would grab
    const hitTest = (x: number, y: number): Drag | 'add' | null => {
        const v = view();
        if (shape() === CONTOUR_SHAPES.circle) {
            const { cx, cy, r } = circleOnScreen(v);
            const [hx, hy] = rimHandle(cx, cy, r);
            const d = Math.hypot(x - cx, y - cy);
            if (Math.hypot(x - hx, y - hy) < HANDLE_PX || Math.abs(d - r) < HANDLE_PX || d > r) return { kind: 'radius' };
            return { kind: 'center', dx: x - cx, dy: y - cy };
        }
        const i = nearestVertex(x, y);
        return i >= 0 ? { kind: 'vertex', index: i } : 'add';
    };

    // New corner: where it lengthens the outline least (|a−p| + |p−b| − |a−b|),
    // which keeps simple shapes simple; open paths may also grow at either end.
    const insertCorner = (p: Point2): number => {
        const pts = vertices();
        const dist = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const edges = closed() ? pts.length : pts.length - 1;
        let at = pts.length, best = Infinity;
        for (let i = 0; i < edges; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            const cost = dist(a, p) + dist(p, b) - dist(a, b);
            if (cost < best) { best = cost; at = i + 1; }
        }
        if (!closed()) {
            if (dist(p, pts[pts.length - 1]) < best) { best = dist(p, pts[pts.length - 1]); at = pts.length; }
            if (dist(p, pts[0]) < best) at = 0;
        }
        pts.splice(at, 0, p);
        return at;
    };

    const setRadius = (x: number, y: number) => {
        const v = view();
        const { cx, cy } = circleOnScreen(v);
        params.contour_r = Math.max(1e-3, (Math.hypot(x - cx, y - cy) / (0.5 * WIDTH)) * v.halfW);
    };

    canvas.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        const [x, y] = local(e);
        frozenView = mapView(params);
        canvas.setPointerCapture(e.pointerId);
        const hit = hitTest(x, y);
        if (hit === 'add') {
            drag = { kind: 'vertex', index: insertCorner(toDomain(view(), x, y)) };
            hover = drag.index;
        } else {
            drag = hit;
            if (drag?.kind === 'radius') setRadius(x, y);     // a press outside jumps the rim there
        }
        canvas.style.cursor = 'grabbing';
        onEdit();
    });

    canvas.addEventListener('pointermove', e => {
        const [x, y] = local(e);
        if (!drag) {
            // Hover feedback: highlight the handle and show what a press would do
            const hit = hitTest(x, y);
            const next = hit === 'add' || hit === null ? null
                : hit.kind === 'vertex' ? hit.index
                : hit.kind === 'radius' ? 'radius' : null;
            canvas.style.cursor = hit === 'add' ? 'copy'
                : hit?.kind === 'vertex' ? 'grab'
                : hit?.kind === 'radius' ? 'nesw-resize' : 'move';
            if (next !== hover) { hover = next; draw(); }
            return;
        }
        const v = view();
        if (drag.kind === 'vertex') {
            vertices()[drag.index] = toDomain(v, x, y);
        } else if (drag.kind === 'center') {
            [params.contour_cx, params.contour_cy] = toDomain(v, x - drag.dx, y - drag.dy);
        } else {
            setRadius(x, y);
        }
        onEdit();
    });

    // Releasing refits the view to the edited contour
    const end = () => {
        if (!drag) return;
        drag = null;
        frozenView = null;
        canvas.style.cursor = '';
        onEdit();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { if (!drag && hover !== null) { hover = null; draw(); } });

    canvas.addEventListener('dblclick', e => {
        if (shape() === CONTOUR_SHAPES.circle) return;
        const [x, y] = local(e);
        const hit = nearestVertex(x, y);
        const min = closed() ? 3 : 2;
        if (hit >= 0 && vertices().length > min) {
            vertices().splice(hit, 1);
            hover = null;
            onEdit();
        }
    });

    ui.track(draw);

    return {
        setBackground(map: MapData) {
            const img = bgCtx.createImageData(MAP_W, MAP_H);
            for (let k = 0; k < MAP_W * MAP_H; k++) {
                const [r, g, b] = phaseColor(map.values[2 * k], map.values[2 * k + 1]);
                img.data[4 * k] = r; img.data[4 * k + 1] = g; img.data[4 * k + 2] = b; img.data[4 * k + 3] = 255;
            }
            bgCtx.putImageData(img, 0, 0);
            bgView = map.view;
            draw();
        },
    };
}
