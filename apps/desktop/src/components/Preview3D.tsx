import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FrameStore } from '../runtime/frame';

/**
 * Model of the 1.75C built from three product photos (two side views, one back view): the housing is a lathe of the silhouette
 * measured from the photo, ports, buttons and the speaker grille sit at positions measured from it. Not official CAD, and
 * the azimuth that joins the two side views is inferred. The display shows the same offscreen canvas the 2D view uses.
 * Loaded lazily and fully disposed when the 2D view is shown. Units: 1 = housing radius.
 */

// Silhouette from the side photo: [pixel row, width px]. The photo spans rows 316..483 (height) and 601 px (diameter).
const ROWS: [number, number][] = [[318, 498], [324, 540], [330, 553], [336, 565], [342, 573], [348, 580], [354, 586], [360, 591], [366, 595], [372, 597], [378, 599], [384, 601], [390, 601], [396, 600], [408, 596], [420, 586], [432, 574], [444, 555], [450, 544], [453, 538], [456, 532], [462, 517], [468, 499], [474, 477], [480, 445], [483, 420]];
const W_MAX = 601, ROW_TOP = 316, ROW_H = 167, Y_TOP = 0.278, PX = W_MAX / 2;
const yOfRow = (row: number) => Y_TOP - (row - ROW_TOP) / PX;
const PROFILE = ROWS.map(([row, w]) => ({ y: yOfRow(row), rho: w / W_MAX }));
const Y_BOT = yOfRow(ROW_TOP + ROW_H), SEAM_Y = yOfRow(453);
/** Housing radius at height y (linear between the measured rows). */
function rhoAt(y: number): number {
  if (y >= PROFILE[0].y) return PROFILE[0].rho;
  for (let i = 1; i < PROFILE.length; i++) {
    if (y >= PROFILE[i].y) { const a = PROFILE[i - 1], b = PROFILE[i]; return a.rho + (b.rho - a.rho) * ((a.y - y) / (a.y - b.y)); }
  }
  return PROFILE[PROFILE.length - 1].rho;
}

const rr = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
};
const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] as const; };

function drawUsb(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.strokeStyle = g.fillStyle = '#85878b'; g.lineWidth = s * 0.07; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(cx - s * 0.55, cy); g.lineTo(cx + s * 0.5, cy); g.stroke();
  g.beginPath(); g.arc(cx - s * 0.64, cy, s * 0.1, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx + s * 0.5, cy - s * 0.13); g.lineTo(cx + s * 0.7, cy); g.lineTo(cx + s * 0.5, cy + s * 0.13); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(cx - s * 0.2, cy); g.lineTo(cx - s * 0.05, cy - s * 0.22); g.lineTo(cx + s * 0.2, cy - s * 0.22); g.stroke();
  g.fillRect(cx + s * 0.2, cy - s * 0.22 - s * 0.07, s * 0.14, s * 0.14);
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + s * 0.15, cy + s * 0.22); g.lineTo(cx + s * 0.28, cy + s * 0.22); g.stroke();
  g.beginPath(); g.arc(cx + s * 0.37, cy + s * 0.22, s * 0.07, 0, Math.PI * 2); g.fill();
}

type Tex = THREE.CanvasTexture;
const tex = (c: HTMLCanvasElement): Tex => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const decalMat = (map: Tex, metalness = 0.55, roughness = 0.42) => new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.4, metalness, roughness, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

/** A w × h patch (arc length × height) bent onto the housing at azimuth `az` (rad, 0 = USB side facing +Z) and `v` (0 = top edge, 1 = bottom). */
function patch(w: number, h: number, az: number, v: number, lift: number, mat: THREE.Material) {
  const g = new THREE.PlaneGeometry(w, h, Math.max(8, Math.ceil(w * 40)), Math.max(6, Math.ceil(h * 40)));
  const p = g.attributes.position, yc = Y_TOP - v * (ROW_H / PX), r0 = rhoAt(yc);
  for (let i = 0; i < p.count; i++) {
    const a = az + p.getX(i) / r0, y = yc + p.getY(i), r = rhoAt(y) + lift;
    p.setXYZ(i, r * Math.sin(a), y, r * Math.cos(a));
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function holeTex(): Tex {
  const [c, g] = canvas(96, 96);
  const rim = g.createRadialGradient(48, 48, 26, 48, 48, 46); rim.addColorStop(0, '#2a2b2e'); rim.addColorStop(0.5, '#d9dbde'); rim.addColorStop(1, '#8e9094');
  g.fillStyle = rim; g.beginPath(); g.arc(48, 48, 46, 0, Math.PI * 2); g.fill();
  const bore = g.createRadialGradient(40, 38, 2, 48, 48, 30); bore.addColorStop(0, '#2b2c2f'); bore.addColorStop(1, '#050506');
  g.fillStyle = bore; g.beginPath(); g.arc(48, 48, 30, 0, Math.PI * 2); g.fill();
  return tex(c);
}

function usbTex() {
  const [c, g] = canvas(768, 312);
  const bez = g.createLinearGradient(0, 0, 0, 312); bez.addColorStop(0, '#f0f1f3'); bez.addColorStop(0.5, '#c9cbce'); bez.addColorStop(1, '#a9abaf');
  g.fillStyle = bez; rr(g, 0, 0, 768, 312, 150); g.fill();
  const cov = g.createLinearGradient(0, 24, 0, 288); cov.addColorStop(0, '#b9bbbe'); cov.addColorStop(1, '#d3d5d8');
  g.fillStyle = cov; rr(g, 30, 30, 708, 252, 126); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 3; rr(g, 30, 30, 708, 252, 126); g.stroke();
  drawUsb(g, 330, 156, 150);
  return tex(c);
}
function buttonTex(cap: boolean) {
  const [c, g] = canvas(384, 192);
  const grad = g.createLinearGradient(0, 0, 0, 192);
  if (cap) { grad.addColorStop(0, '#e4e6e8'); grad.addColorStop(0.55, '#c3c5c9'); grad.addColorStop(1, '#a4a6aa'); } else { grad.addColorStop(0, '#f2f3f4'); grad.addColorStop(1, '#8d8f93'); }
  g.fillStyle = grad; rr(g, 0, 0, 384, 192, 96); g.fill();
  return tex(c);
}
const noise = () => { const [c, g] = canvas(256, 256); const d = g.createImageData(256, 256); for (let i = 0; i < d.data.length; i += 4) { const v = 110 + Math.random() * 40; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); return t; };

const deg = (d: number) => (d * Math.PI) / 180;
// Ports and controls, measured from the photos. az: degrees from the USB-side view's centre; v: 0 = top edge, 1 = bottom edge.
const HOLES: { az: number; v: number; d: number }[] = [
  { az: -65, v: 0.29, d: 0.07 }, { az: -60, v: 0.43, d: 0.05 }, // beside the USB cover
  ...[45, 49.2, 53.1, 57.1, 60.8].map((az) => ({ az, v: 0.29, d: 0.045 })), // speaker grille
  { az: 175, v: 0.43, d: 0.068 }, { az: 185, v: 0.43, d: 0.068 }, { az: 207, v: 0.28, d: 0.066 }, // opposite side: microphones
  { az: -33.8, v: 0.9, d: 0.045 }, // pin hole in the lower plate
];

/** Everything above the display glass: housing, groove, ports. */
function buildBody(): THREE.Group {
  const dev = new THREE.Group(), hole = holeTex();
  const up = PROFILE.filter((p) => p.y >= SEAM_Y).reverse().map((p) => new THREE.Vector2(p.rho, p.y)).concat([new THREE.Vector2(0.8, Y_TOP), new THREE.Vector2(0, Y_TOP)]);
  const low = [new THREE.Vector2(0, Y_BOT)].concat(PROFILE.filter((p) => p.y <= SEAM_Y).reverse().map((p) => new THREE.Vector2(p.rho, p.y)));
  dev.add(new THREE.Mesh(new THREE.LatheGeometry(up, 160), new THREE.MeshStandardMaterial({ color: 0xcdcfd3, metalness: 1, roughness: 0.27 })));
  dev.add(new THREE.Mesh(new THREE.LatheGeometry(low, 160), new THREE.MeshStandardMaterial({ color: 0xc9cbcf, metalness: 0.7, roughness: 0.5 })));
  const back = new THREE.Mesh(new THREE.CircleGeometry(PROFILE[PROFILE.length - 1].rho - 0.004, 96), new THREE.MeshStandardMaterial({ color: 0xcfd1d4, metalness: 0.45, roughness: 0.62, bumpMap: noise(), bumpScale: 0.6 }));
  back.rotation.x = Math.PI / 2; back.position.y = Y_BOT - 0.0004; dev.add(back);
  // Pins on the back plate. The back photo is nearer the camera than the side photos, so its apparent radius (0.86) is inflated;
  // 0.60 keeps them on the 0.70-radius flat face measured from the side silhouette.
  for (const a of [30, 150, 270]) {
    const pin = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), decalMat(hole, 0.4, 0.5));
    pin.rotation.x = Math.PI / 2; pin.position.set(0.6 * Math.sin(deg(a)), Y_BOT - 0.0012, 0.6 * Math.cos(deg(a))); dev.add(pin);
  }
  const groove = new THREE.Mesh(new THREE.TorusGeometry(rhoAt(SEAM_Y) - 0.001, 0.0035, 8, 192), new THREE.MeshStandardMaterial({ color: 0x2b2c2e, metalness: 0.6, roughness: 0.6 }));
  groove.rotation.x = Math.PI / 2; groove.position.y = SEAM_Y; dev.add(groove);

  dev.add(patch(0.72, 0.29, deg(-36), 0.43, 0.004, decalMat(usbTex(), 0.5, 0.4))); // USB-C cover in its recess
  for (const [az, v, w, h] of [[15.7, 0.353, 0.2, 0.12], [128, 0.34, 0.37, 0.107]] as const) { // two buttons: bezel + cap
    dev.add(patch(w, h, deg(az), v, 0.006, decalMat(buttonTex(false), 0.8, 0.3)));
    dev.add(patch(w - 0.03, h - 0.03, deg(az), v, 0.011, decalMat(buttonTex(true), 0.8, 0.38)));
  }
  for (const { az, v, d } of HOLES) dev.add(patch(d, d, deg(az), v, 0.0025, decalMat(hole, 0.4, 0.5)));
  const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 20), new THREE.MeshStandardMaterial({ color: 0xd2d4d8, metalness: 1, roughness: 0.25 }));
  const ny = Y_TOP - 0.345 * (ROW_H / PX), nr = rhoAt(ny) + 0.008, na = deg(88);
  nub.position.set(nr * Math.sin(na), ny, nr * Math.cos(na));
  nub.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(na), 0, Math.cos(na))); dev.add(nub);
  return dev;
}

export default function Preview3D({ store }: { store: FrameStore }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Three.js · mirrors the 2D frame buffer');

  useEffect(() => {
    const el = host.current!;
    let w = el.clientWidth, h = el.clientHeight;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setStatus('Could not start WebGL'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w, h); el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = env;
    const cam = new THREE.PerspectiveCamera(32, w / h, 0.1, 50); cam.position.set(0, 0.2, 5.2);
    const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true; ctl.minDistance = 2.2; ctl.maxDistance = 9; ctl.enablePan = false;
    // dev.rotation.x puts the display towards the camera (+Z) and the USB side (az 0) at the bottom.
    const grp = new THREE.Group(), dev = buildBody(); dev.rotation.x = Math.PI / 2; grp.add(dev); scene.add(grp);
    const frame = new THREE.CanvasTexture(store.canvas); frame.colorSpace = THREE.SRGBColorSpace;
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.815, 128), new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }));
    glass.rotation.x = -Math.PI / 2; glass.position.y = Y_TOP + 0.0012; dev.add(glass);
    const disp = new THREE.Mesh(new THREE.CircleGeometry(0.79, 128), new THREE.MeshStandardMaterial({ map: frame, roughness: 0.15, metalness: 0, emissive: 0xffffff, emissiveMap: frame, emissiveIntensity: 0.9 }));
    disp.rotation.x = -Math.PI / 2; disp.position.y = Y_TOP + 0.0024; dev.add(disp);
    const [sc, g] = canvas(128, 128);
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.35; scene.add(shadow);
    grp.rotation.y = -0.45; grp.rotation.x = -0.12;

    const ro = new ResizeObserver(() => { w = el.clientWidth; h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); });
    ro.observe(el);
    const unsub = store.subscribe(() => { frame.needsUpdate = true; });
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); if (document.hidden) return; ctl.update(); renderer.render(scene, cam); };
    loop();
    return () => {
      cancelAnimationFrame(raf); unsub(); ro.disconnect(); ctl.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh; m.geometry?.dispose();
        const mat = m.material as THREE.MeshStandardMaterial | undefined;
        if (mat) { mat.map?.dispose(); mat.emissiveMap?.dispose(); mat.bumpMap?.dispose(); mat.dispose(); }
      });
      env.dispose(); pm.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [store]);

  return <>
    <div ref={host} style={{ position: 'absolute', inset: 0, cursor: 'grab' }} />
    <div className="caption" style={{ top: 12, left: 14, right: 'auto', textAlign: 'left' }}>{status}</div>
    <div className="caption" style={{ bottom: 12 }}>Built from product photos — approximate, not official CAD · drag to orbit · scroll to zoom</div>
  </>;
}
