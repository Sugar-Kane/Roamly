// Anatomy Mirror engine: webcam → MediaPipe face/hand tracking → three.js.
//
// The head model lives in MediaPipe's canonical face space (centimetres), so
// the face landmarker's per-frame facial transformation matrix places it
// directly; rendering with MediaPipe's own camera model (63° vertical FOV)
// reproduces the image-space fit. Hands are drawn in screen space: every
// finger bone is stretched between two hand landmarks.
//
// Everything runs on the device. Video frames never leave the browser.
import * as THREE from "three";
import { FaceLandmarker, FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

const TASKS_VERSION = "1.2.2"; // keep in step with package.json
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MP_FOV_Y = 63; // MediaPipe face geometry's perspective camera

export type Layer = "skull" | "jaw" | "eyes" | "brain" | "muscles";
export const LAYERS: Layer[] = ["skull", "jaw", "muscles", "brain", "eyes"];
export type Look = "xray" | "solid";

type PartMeta = {
  key: string; layer: Layer; label: string; min: number[]; max: number[];
  vOffset: number; vCount: number; iOffset: number; iCount: number; anchors: number[][];
};
type HeadMeta = { parts: PartMeta[]; jawPivot: number[] };
type HandPartMeta = {
  key: string; label: string; min: number[]; max: number[]; vOffset: number; vCount: number; iOffset: number; iCount: number;
  frame: { type: "palm"; landmarks: number[] } | { type: "segment"; a: number; b: number };
};

export type Fit = { scale: number; up: number; depth: number };
export type LabelSpot = { label: string; layer: Layer; x: number; y: number };
export type Frame = { face: boolean; hands: number; jawOpen: number; fingertip: { x: number; y: number } | null; labels: LabelSpot[] };

const COLORS: Record<Layer, { xray: number; solid: number }> = {
  skull: { xray: 0xcfe8ff, solid: 0xe9dfc8 },
  jaw: { xray: 0xcfe8ff, solid: 0xe2d6bb },
  eyes: { xray: 0xffffff, solid: 0xf4f4f0 },
  brain: { xray: 0xd7a6ff, solid: 0xe7a3ad },
  muscles: { xray: 0xff8a7a, solid: 0xb5473f },
};

function xrayMaterial(color: number, strength: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uOpacity: { value: 1 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = (0.06 + pow(rim, 2.2) * 0.9) * uStrength * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function decode(buf: ArrayBuffer, p: { min: number[]; max: number[]; vOffset: number; vCount: number; iOffset: number; iCount: number }) {
  const q = new Uint16Array(buf, p.vOffset, p.vCount * 3);
  const pos = new Float32Array(p.vCount * 3);
  for (let i = 0; i < q.length; i++) {
    const axis = i % 3;
    pos[i] = p.min[axis] + (q[i] / 65535) * (p.max[axis] - p.min[axis]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, p.iOffset, p.iCount).slice(), 1));
  geo.computeVertexNormals();
  return geo;
}

async function fetchAsset(name: string) {
  const [meta, bin] = await Promise.all([
    fetch(`/anatomy/${name}.json`).then((r) => { if (!r.ok) throw new Error("anatomy_asset"); return r.json(); }),
    fetch(`/anatomy/${name}.bin`).then((r) => { if (!r.ok) throw new Error("anatomy_asset"); return r.arrayBuffer(); }),
  ]);
  return { meta, bin };
}

export class AnatomyEngine {
  private renderer: THREE.WebGLRenderer;
  private faceScene = new THREE.Scene();
  private handScene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(MP_FOV_Y, 4 / 3, 1, 10000);
  private handCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -10000, 10000);
  private headRoot = new THREE.Group();   // driven by the facial transformation matrix
  private fitGroup = new THREE.Group();   // user fit sliders
  private jawGroup = new THREE.Group();   // pivots at the temporomandibular joints
  private layerGroups = new Map<Layer, THREE.Group>();
  private meshes: { mesh: THREE.Mesh; part: PartMeta }[] = [];
  private hands: { root: THREE.Group; palm: THREE.Mesh; segs: { mesh: THREE.Mesh; a: number; b: number }[] }[] = [];
  private face?: FaceLandmarker;
  private hand?: HandLandmarker;
  private lastTs = -1;
  private look: Look = "xray";
  private visible = new Set<Layer>(["skull", "jaw", "eyes"]);
  private showHands = true;
  private opacity = 1;
  private focusLayers: Set<Layer> | null = null;
  private center = new THREE.Vector3(0, 1.5, 0); // rough head center in canonical space, for back-facing labels
  private raycaster = new THREE.Raycaster();
  private transposeMatrix: boolean | null = null;
  private lastFrame: Frame = { face: false, hands: 0, jawOpen: 0, fingertip: null, labels: [] };

  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    this.canvas = canvas; this.video = video;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.headRoot.matrixAutoUpdate = false;
    this.headRoot.add(this.fitGroup);
    this.faceScene.add(this.headRoot);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.4);
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(0.3, 0.6, 1);
    this.faceScene.add(hemi, key);
    this.handScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5));
    const hk = new THREE.DirectionalLight(0xffffff, 1.2); hk.position.set(0, 0, 1); this.handScene.add(hk);
  }

  /** Loads models and anatomy. Reports progress text for the UI. */
  async load(onStatus: (s: string) => void) {
    onStatus("Loading anatomy…");
    const [head, handAsset] = await Promise.all([fetchAsset("head"), fetchAsset("hand")]);
    this.buildHead(head.meta as HeadMeta, head.bin);
    this.buildHands(handAsset.meta.parts as HandPartMeta[], handAsset.bin);
    onStatus("Loading face and hand tracking…");
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    const make = async (delegate: "GPU" | "CPU") => Promise.all([
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: "VIDEO", numFaces: 1,
        outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
      }),
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: "VIDEO", numHands: 2,
      }),
    ]);
    try { [this.face, this.hand] = await make("GPU"); }
    catch { [this.face, this.hand] = await make("CPU"); } // some devices have no WebGL2 compute path
    this.applyLook();
  }

  private buildHead(meta: HeadMeta, bin: ArrayBuffer) {
    for (const layer of LAYERS) {
      const g = new THREE.Group(); g.name = layer; this.layerGroups.set(layer, g);
      if (layer === "jaw") this.jawGroup.add(g); else this.fitGroup.add(g);
    }
    // Jaw rotates about the line through both condyles (x axis in canonical space).
    const [px, py, pz] = meta.jawPivot;
    this.jawGroup.position.set(px, py, pz);
    this.layerGroups.get("jaw")!.position.set(-px, -py, -pz);
    this.fitGroup.add(this.jawGroup);
    for (const part of meta.parts) {
      const mesh = new THREE.Mesh(decode(bin, part));
      mesh.userData.part = part;
      this.layerGroups.get(part.layer)!.add(mesh);
      this.meshes.push({ mesh, part });
    }
  }

  private buildHands(parts: HandPartMeta[], bin: ArrayBuffer) {
    for (let h = 0; h < 2; h++) {
      const root = new THREE.Group(); root.visible = false;
      let palm: THREE.Mesh | null = null;
      const segs: { mesh: THREE.Mesh; a: number; b: number }[] = [];
      for (const p of parts) {
        const mesh = new THREE.Mesh(decode(bin, p));
        mesh.matrixAutoUpdate = false;
        root.add(mesh);
        if (p.frame.type === "palm") palm = mesh; else segs.push({ mesh, a: p.frame.a, b: p.frame.b });
      }
      this.handScene.add(root);
      this.hands.push({ root, palm: palm!, segs });
    }
  }

  setLook(look: Look) { this.look = look; this.applyLook(); }
  setLayers(layers: Layer[]) { this.visible = new Set(layers); this.applyLook(); }
  setHands(on: boolean) { this.showHands = on; }
  setOpacity(o: number) { this.opacity = o; this.applyLook(); }
  /** Quiz focus: these layers bright, the rest faint. null = normal. */
  setFocusLayers(layers: Layer[] | null) { this.focusLayers = layers ? new Set(layers) : null; this.applyLook(); }
  setFit(fit: Fit) {
    this.fitGroup.scale.setScalar(fit.scale);
    this.fitGroup.position.set(0, fit.up, fit.depth);
  }

  private applyLook() {
    for (const [layer, g] of this.layerGroups) {
      g.visible = this.visible.has(layer) || !!this.focusLayers?.has(layer);
      const dim = this.focusLayers && !this.focusLayers.has(layer) ? 0.25 : 1;
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        (o.material as THREE.Material | undefined)?.dispose?.();
        if (this.look === "xray") {
          const m = xrayMaterial(COLORS[layer].xray, layer === "brain" ? 0.9 : 1);
          m.uniforms.uOpacity.value = this.opacity * dim;
          o.material = m;
          o.renderOrder = 1;
        } else {
          o.material = new THREE.MeshStandardMaterial({
            color: COLORS[layer].solid, roughness: layer === "muscles" ? 0.55 : 0.75, metalness: 0,
            transparent: this.opacity < 1 || dim < 1, opacity: this.opacity * dim,
          });
          o.renderOrder = 0;
        }
      });
    }
    const handMat = this.look === "xray" ? xrayMaterial(COLORS.skull.xray, 1.1)
      : new THREE.MeshStandardMaterial({ color: COLORS.skull.solid, roughness: 0.7 });
    if (handMat instanceof THREE.ShaderMaterial) handMat.uniforms.uOpacity.value = this.opacity;
    handMat.side = THREE.DoubleSide; // the left hand is mirrored geometry, so its triangles face inward
    for (const h of this.hands) h.root.traverse((o) => { if (o instanceof THREE.Mesh) o.material = handMat; });
  }

  private resize() {
    const w = this.video.videoWidth || 640, h = this.video.videoHeight || 480;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(cw * this.renderer.getPixelRatio()) || this.camera.aspect !== w / h) {
      this.renderer.setSize(cw, ch, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.handCamera.left = 0; this.handCamera.right = w; this.handCamera.top = h; this.handCamera.bottom = 0;
      this.handCamera.updateProjectionMatrix();
    }
  }

  /** Runs tracking on the current video frame and renders. Call once per animation frame. */
  tick(): Frame {
    if (!this.face || !this.hand || this.video.readyState < 2) return this.lastFrame;
    let ts = performance.now(); if (ts <= this.lastTs) ts = this.lastTs + 1; this.lastTs = ts;
    this.resize();
    const w = this.video.videoWidth, h = this.video.videoHeight;
    const frame: Frame = { face: false, hands: 0, jawOpen: 0, fingertip: null, labels: [] };

    const fr = this.face.detectForVideo(this.video, ts);
    const mat = fr.facialTransformationMatrixes?.[0];
    if (mat) {
      const d = mat.data;
      // Column-major puts the translation (depth ~ -30…-80 cm) in elements 12–14.
      if (this.transposeMatrix === null) this.transposeMatrix = Math.abs(d[11]) > Math.abs(d[14]);
      this.headRoot.matrix.fromArray(d);
      if (this.transposeMatrix) this.headRoot.matrix.transpose();
      this.headRoot.matrixWorldNeedsUpdate = true;
      const jaw = fr.faceBlendshapes?.[0]?.categories.find((c) => c.categoryName === "jawOpen")?.score ?? 0;
      frame.jawOpen = jaw;
      this.jawGroup.rotation.x = THREE.MathUtils.degToRad(26) * Math.min(1, jaw * 1.15);
      frame.face = true;
    }
    this.headRoot.visible = frame.face;

    const hr = this.hand.detectForVideo(this.video, ts);
    this.hands.forEach((hd, i) => {
      const lm = hr.landmarks?.[i];
      hd.root.visible = !!lm && this.showHands;
      if (!lm) return;
      const isLeft = hr.handedness?.[i]?.[0]?.categoryName === "Left";
      this.poseHand(hd, lm, w, h, isLeft);
      frame.hands++;
      if (i === 0) frame.fingertip = { x: lm[8].x, y: lm[8].y };
    });

    if (frame.face) frame.labels = this.labelSpots();
    this.renderer.autoClear = true;
    this.renderer.render(this.faceScene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.handScene, this.handCamera);
    this.lastFrame = frame;
    return frame;
  }

  private poseHand(hd: (typeof this.hands)[number], lm: NormalizedLandmark[], w: number, h: number, isLeft: boolean) {
    const P = lm.map((p) => new THREE.Vector3(p.x * w, (1 - p.y) * h, -p.z * w));
    const W = P[0], M2 = P[5], M3 = P[9], M5 = P[17];
    const Y = M3.clone().sub(W); const palmLen = Y.length(); Y.normalize();
    const X = M2.clone().sub(M5); const palmWidth = X.length();
    X.sub(Y.clone().multiplyScalar(X.dot(Y))).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    // A left hand is the mirror image of the right-hand bones: flip local z.
    const zs = isLeft ? -1 : 1;
    const basis = new THREE.Matrix4().makeBasis(
      X.clone().multiplyScalar(palmWidth), Y.clone().multiplyScalar(palmLen), Z.clone().multiplyScalar(palmWidth * zs));
    basis.setPosition(W);
    hd.palm.matrix.copy(basis);
    for (const s of hd.segs) {
      const a = P[s.a], b = P[s.b];
      const by = b.clone().sub(a); const len = by.length(); if (len < 1e-3) continue; by.normalize();
      const bz = Z.clone().sub(by.clone().multiplyScalar(Z.dot(by))).normalize();
      const bx = new THREE.Vector3().crossVectors(by, bz);
      const m = new THREE.Matrix4().makeBasis(bx.multiplyScalar(len), by.multiplyScalar(len), bz.multiplyScalar(len * zs));
      m.setPosition(a);
      s.mesh.matrix.copy(m);
    }
  }

  /** Screen positions (0–1, unmirrored video space) of labels on the camera-facing side. */
  private labelSpots(): LabelSpot[] {
    this.faceScene.updateMatrixWorld(true);
    const centerW = this.center.clone().applyMatrix4(this.headRoot.matrixWorld);
    const out: LabelSpot[] = [];
    const seen = new Set<string>();
    for (const { mesh, part } of this.meshes) {
      if (!mesh.parent?.visible || (this.focusLayers && !this.focusLayers.has(part.layer))) continue;
      if (seen.has(part.label)) continue;
      let best: THREE.Vector3 | null = null;
      for (const a of part.anchors) {
        const p = new THREE.Vector3(a[0], a[1], a[2]).applyMatrix4(mesh.matrixWorld);
        // Facing the camera when the anchor is nearer the camera than the head center.
        if (p.z > centerW.z - 1.5 && (!best || p.z > best.z)) best = p;
      }
      if (!best) continue;
      const ndc = best.clone().project(this.camera);
      if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;
      seen.add(part.label);
      out.push({ label: part.label, layer: part.layer, x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 });
    }
    return out;
  }

  /** Which labelled part (if any) is under a point given in unmirrored 0–1 video coordinates. */
  pick(x: number, y: number, onlyLayers?: Layer[]): { label: string; layer: Layer } | null {
    if (!this.headRoot.visible) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), this.camera);
    const targets = this.meshes.filter(({ mesh, part }) => mesh.parent?.visible && (!onlyLayers || onlyLayers.includes(part.layer))).map((m) => m.mesh);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const part = hit?.object.userData.part as PartMeta | undefined;
    return part ? { label: part.label, layer: part.layer } : null;
  }

  labelsFor(layers: Layer[]): string[] {
    return [...new Set(this.meshes.filter((m) => layers.includes(m.part.layer)).map((m) => m.part.label))];
  }

  dispose() {
    this.face?.close(); this.hand?.close();
    for (const { mesh } of this.meshes) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose?.(); }
    for (const h of this.hands) h.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.renderer.dispose();
  }
}
