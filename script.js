import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SUBTRACTION, ADDITION, Brush, Evaluator } from 'three-bvh-csg';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { ARButton } from 'three/addons/webxr/ARButton.js?v=2';

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x333333);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(400, 300, 600);

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.xr.enabled = true; // Enabled WebXR for AR
document.body.appendChild(renderer.domElement);

// Create AR Button
document.body.appendChild(ARButton.createButton(renderer));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Environment (better lighting for geometry)
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

// Grid
const gridHelper = new THREE.GridHelper(1000, 50);
scene.add(gridHelper);

// --- State & Parameters ---
const params = {
    // Top Section
    // USER REQUEST: Original numbers (100) but as Diameter
    topDiameter: 100,
    topHeight: 25,    // Thickness of the cover
    topBevel: 25,     // Visual bevel factor

    // Central/Body Section
    elevation: 380,
    count: 24,        // Divisions
    dipFactor: 50,
    dipIndicesStr: "3, 9, 15, 21", // Easier to edit in GUI

    // Base/Intermediate Section
    // USER REQUEST: Original numbers (250) but as Diameter
    baseDiameter: 250,
    baseElevation: 0,

    // Appearance
    colorTop: 0xc1f5c1,
    colorBody: 0xf0c493,
    wireframe: false,

    // Visibility
    showCover: true,
    showBody: true,

    // Assembly / Thread
    threadDiameter: 60,
    threadLength: 30,

    // Export Actions
    exportBase: function () {
        const base = modelGroup.children.find(c => c.name === 'BaseMesh');
        if (base) {
            exportSTL(base, 'base_design');
        } else {
            alert("No se encuentra la base para exportar.");
        }
    },
    exportCover: function () {
        const coverParts = modelGroup.children.filter(c => c.name === 'CoverPart');
        if (coverParts.length > 0) {
            const tempGroup = new THREE.Group();
            coverParts.forEach(p => tempGroup.add(p.clone()));
            const result = exporter.parse(tempGroup, { binary: true });
            const blob = new Blob([result], { type: 'application/octet-stream' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'cubierta_design.stl';
            link.click();
        } else {
            alert("No se encuentra la cubierta para exportar.");
        }
    }
};

// Container for our generated meshes
const modelGroup = new THREE.Group();
scene.add(modelGroup);

// --- Export Logic ---
const exporter = new STLExporter();

function exportSTL(mesh, filename) {
    const result = exporter.parse(mesh, { binary: true });
    const blob = new Blob([result], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename + '.stl';
    link.click();
}

// CSG Evaluator
const csgEvaluator = new Evaluator();

// Helper Class for Helix (Thread)
class HelixCurve extends THREE.Curve {
    constructor(radius, height, turns) {
        super();
        this.radius = radius;
        this.height = height;
        this.turns = turns;
    }
    getPoint(t) {
        // t goes from 0 to 1
        const angle = 2 * Math.PI * this.turns * t;
        const x = this.radius * Math.cos(angle);
        const z = this.radius * Math.sin(angle);
        const y = -this.height * t; // Going down
        return new THREE.Vector3(x, y, z);
    }
}

// --- Helpers ---

// Parse string indices to array
function getDipIndices() {
    return params.dipIndicesStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
}

// Generate a closed CatmullRom curve from points
function createCurve(points) {
    const curve = new THREE.CatmullRomCurve3(points);
    curve.closed = true;
    curve.tension = 0.5;
    return curve;
}

// Helper to generate curve points (now reusable for Inner/Outer)
function getCurvePoints(radius, baseElevation, isBase, dipFactorOverride) {
    const points = [];
    const smoothRes = 300;

    // Use override if provided, otherwise default (though generator always provides it now)
    const currentDipFactor = (dipFactorOverride !== undefined) ? dipFactorOverride : params.dipFactor;

    // Calculate Derived Radii for direction logic
    const currentBaseRadius = params.baseDiameter / 2;
    const currentTopRadius = params.topDiameter / 2;

    // Top Curve Logic (Circle)
    if (!isBase) {
        for (let i = 0; i <= smoothRes; i++) {
            const t = i / smoothRes;
            const angle = t * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            points.push(new THREE.Vector3(x, params.elevation, z)); // Still uses params.elevation for global height
        }
        points.pop(); // Remove duplicate end point
        return points;
    }

    // Base Curve Logic (with Dips)
    const angleStepRad = (Math.PI * 2) / params.count;
    const archWidthIndices = 2.2;
    const archWidthRad = archWidthIndices * angleStepRad;
    const dipIndices = getDipIndices();

    for (let i = 0; i < smoothRes; i++) {
        const t = i / smoothRes;
        const angle = t * Math.PI * 2;

        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        let y = baseElevation;

        // Apply Dips
        dipIndices.forEach(idx => {
            const targetAngle = idx * angleStepRad;
            let dist = Math.abs(angle - targetAngle);
            if (dist > Math.PI) dist = (2 * Math.PI) - dist;

            if (dist < archWidthRad) {
                const normDist = dist / archWidthRad;
                const lift = (Math.cos(normDist * Math.PI) + 1) * 0.5;
                y += lift * currentDipFactor;
            }
        });

        // Directional offset (Vector Logic)
        const topRadiusForDir = (radius < currentBaseRadius)
            ? currentTopRadius - 10
            : currentTopRadius;

        const topX = Math.cos(angle) * topRadiusForDir;
        const topZ = Math.sin(angle) * topRadiusForDir;
        const topY = params.elevation;

        const startPos = new THREE.Vector3(x, baseElevation, z);
        const targetPos = new THREE.Vector3(topX, topY, topZ);
        const dir = new THREE.Vector3().subVectors(targetPos, startPos).normalize();

        const verticalLift = y - baseElevation;
        const point = startPos.clone();

        // Correct vector projection: Scale dir such that Y component equals verticalLift
        if (Math.abs(dir.y) > 0.0001 && verticalLift > 0.001) {
            const scale = verticalLift / dir.y;
            point.copy(startPos).add(dir.multiplyScalar(scale));
        }
        points.push(point);
    }
    return points;
}

// Function to build the SOLID mesh (Outer + Inner + Rims)
function createSolidMesh(outerTop, innerTop, outerBase, innerBase, color) {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const indices = []; // Master index list
    const segmentsY = 30; // Vertical subdivisions
    const countX = outerTop.length;
    const countY = segmentsY + 1;

    // Helper to add a smooth grid (Skin)
    // Returns the starting index offset for this grid
    const addSmoothSkin = (loopA, loopB, facingOut) => {
        const startVertexIndex = vertices.length / 3;

        // 1. Generate Vertices
        for (let y = 0; y < countY; y++) {
            const t = y / segmentsY;
            for (let x = 0; x < countX; x++) {
                // Interpolate
                const pA = loopA[x];
                const pB = loopB[x];

                const vx = pA.x * (1 - t) + pB.x * t;
                const vy = pA.y * (1 - t) + pB.y * t;
                const vz = pA.z * (1 - t) + pB.z * t;

                vertices.push(vx, vy, vz);
            }
        }

        // 2. Generate Indices
        for (let y = 0; y < segmentsY; y++) {
            for (let x = 0; x < countX; x++) {
                const nextX = (x + 1) % countX;
                const rowCurrent = y * countX;
                const rowNext = (y + 1) * countX;

                const a = startVertexIndex + rowCurrent + x;
                const b = startVertexIndex + rowCurrent + nextX;
                const c = startVertexIndex + rowNext + x;
                const d = startVertexIndex + rowNext + nextX;

                if (facingOut) {
                    // Outer Shell: Normals Point OUT
                    // a-b-c, b-d-c (Assuming this creates Outward normals)
                    indices.push(a, b, c);
                    indices.push(b, d, c);
                } else {
                    // Inner Shell: Normals Point IN (Towards Axis)
                    // c-b-a, c-d-b (Assuming this creates Inward normals)
                    indices.push(c, b, a);
                    indices.push(c, d, b);
                }
            }
        }
    };

    // Helper for Flat Rims (Caps)
    const addFlatStrip = (loopA, loopB, facingOut) => {
        for (let i = 0; i < countX; i++) {
            const next = (i + 1) % countX;
            const a0 = loopA[i];
            const a1 = loopA[next];
            const b0 = loopB[i];
            const b1 = loopB[next];

            // Push distinct vertices for flat shading (face normals)
            if (facingOut) {
                // Tri 1
                vertices.push(a0.x, a0.y, a0.z);
                vertices.push(b0.x, b0.y, b0.z);
                vertices.push(b1.x, b1.y, b1.z);
                const idx = (vertices.length / 3) - 3;
                indices.push(idx, idx + 1, idx + 2);

                // Tri 2
                vertices.push(a0.x, a0.y, a0.z);
                vertices.push(b1.x, b1.y, b1.z);
                vertices.push(a1.x, a1.y, a1.z);
                const idx2 = (vertices.length / 3) - 3;
                indices.push(idx2, idx2 + 1, idx2 + 2);
            } else {
                // Flipped - Order matters for face culling/normals
                vertices.push(a0.x, a0.y, a0.z);
                vertices.push(b1.x, b1.y, b1.z);
                vertices.push(b0.x, b0.y, b0.z);
                const idx = (vertices.length / 3) - 3;
                indices.push(idx, idx + 1, idx + 2);

                vertices.push(a0.x, a0.y, a0.z);
                vertices.push(a1.x, a1.y, a1.z);
                vertices.push(b1.x, b1.y, b1.z);
                const idx2 = (vertices.length / 3) - 3;
                indices.push(idx2, idx2 + 1, idx2 + 2);
            }
        }
    };

    // 1. Smooth External Skins
    addSmoothSkin(outerTop, outerBase, true);  // Outer
    addSmoothSkin(innerTop, innerBase, false); // Inner

    // 2. Flat Rims (Independent vertices for Hard Edges)
    addFlatStrip(outerTop, innerTop, true);    // Top Rim (Restored)
    addFlatStrip(outerBase, innerBase, false); // Bottom Rim

    // --- UV Generation (Cylindrical Projection) ---
    // Fix for CSG Error: Attribute uv must exist on both operands
    const uvs = [];
    const _minY = params.baseElevation;
    const _maxY = params.elevation;
    const _height = Math.max(1, _maxY - _minY);

    for (let i = 0; i < vertices.length / 3; i++) {
        const x = vertices[i * 3];
        const y = vertices[i * 3 + 1];
        const z = vertices[i * 3 + 2];

        // Cylindrical Mapping: u = angle, v = height
        const u = (Math.atan2(x, z) / (Math.PI * 2)) + 0.5;
        const v = (y - _minY) / _height;
        uvs.push(u, v);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Matte Material
    const material = new THREE.MeshStandardMaterial({
        color: color,
        side: THREE.DoubleSide,
        roughness: 0.6,
        metalness: 0.1
    });

    return new THREE.Mesh(geometry, material);
}

// Helper: Create Thread Spiral Mesh
const createSolidThreadSpiral = (radius, isInward, color) => {
    const tVertices = [];
    const tIndices = [];

    const tHeight = params.threadLength;
    const tTurns = 2;
    const segmentsPerTurn = 120;
    const totalSegments = segmentsPerTurn * tTurns;
    const taperLen = segmentsPerTurn * 0.5;

    const tPitch = tHeight / tTurns;
    const tBaseWidth = tPitch * 0.5;
    const tTopWidth = tPitch * 0.2;
    const tDepth = (tBaseWidth - tTopWidth) / 2;

    const halfBase = tBaseWidth / 2;
    const halfTop = tTopWidth / 2;

    const startY = -halfBase;
    const endY = -tHeight + halfBase;

    for (let i = 0; i <= totalSegments; i++) {
        const pct = i / totalSegments;
        const angle = pct * tTurns * 2 * Math.PI;

        const yCenter = startY + pct * (endY - startY);

        let depthScale = 1.0;
        if (i < taperLen) {
            const t = i / taperLen;
            depthScale = t * t * (3 - 2 * t);
        } else if (i > totalSegments - taperLen) {
            const t = (totalSegments - i) / taperLen;
            depthScale = t * t * (3 - 2 * t);
        }

        const currentDepth = tDepth * depthScale;

        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        let x1, z1, x2, z2;

        if (!isInward) {
            // Male Thread: Base at Radius, Peak OUTwards
            x1 = radius * cos;
            z1 = radius * sin;
            x2 = (radius + currentDepth) * cos;
            z2 = (radius + currentDepth) * sin;
        } else {
            // Female Thread: Base at Radius (Outer), Peak INwards
            x1 = radius * cos;
            z1 = radius * sin;
            x2 = (radius - currentDepth) * cos;
            z2 = (radius - currentDepth) * sin;
        }

        const yBaseTop = yCenter + halfBase;
        const yPeakTop = yCenter + halfTop;
        const yPeakBot = yCenter - halfTop;
        const yBaseBot = yCenter - halfBase;

        tVertices.push(x1, yBaseTop, z1); // 0
        tVertices.push(x2, yPeakTop, z2); // 1
        tVertices.push(x2, yPeakBot, z2); // 2
        tVertices.push(x1, yBaseBot, z1); // 3 (Base Bot)
    }

    for (let i = 0; i < totalSegments; i++) {
        const base = i * 4;
        const next = base + 4;

        // Top Face
        tIndices.push(base + 0, next + 0, next + 1);
        tIndices.push(base + 0, next + 1, base + 1);

        // Peak Face
        tIndices.push(base + 1, next + 1, next + 2);
        tIndices.push(base + 1, next + 2, base + 2);

        // Bottom Face
        tIndices.push(base + 2, next + 2, next + 3);
        tIndices.push(base + 2, next + 3, base + 3);
    }

    // UV Generation (Simple Planar/Cylindrical approximation)
    const tUVs = [];
    for (let i = 0; i < tVertices.length / 3; i++) {
        const x = tVertices[i * 3];
        const y = tVertices[i * 3 + 1];
        const z = tVertices[i * 3 + 2];

        const u = (Math.atan2(x, z) / (Math.PI * 2)) + 0.5;
        const v = (y - startY) / (endY - startY);
        tUVs.push(u, v);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tVertices, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(tUVs, 2));
    geo.setIndex(tIndices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.2,
        roughness: 0.1,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = params.elevation;
    return mesh;
};


// --- Main Generation Functions ---

function generateGeometry() {
    // Clear previous
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
        modelGroup.remove(child);
    }

    // Safety Max for Dip Factor
    const limit = params.elevation - 150;
    const effectiveDip = Math.max(0, Math.min(params.dipFactor, limit));

    // Derive Radii from Diameters
    const topRadius = params.topDiameter / 2;
    const baseRadius = params.baseDiameter / 2;

    // --- Thread Parameters (Shared between Cover and Base) ---
    // Moved up to be available for Cover Lathe
    const tRadius = params.threadDiameter / 2;
    const tHeight = params.threadLength;
    const tTurns = 2; // Fixed as requested
    const tWallThickness = 20;
    const tInnerRadius = Math.max(0.1, tRadius - tWallThickness);

    // Thread Profile Dimensions
    const segmentsPerTurn = 120; // High res for smoothness
    const totalSegments = segmentsPerTurn * tTurns;
    const taperLen = segmentsPerTurn * 0.5; // Taper over half a turn

    const tPitch = tHeight / tTurns;
    const tBaseWidth = tPitch * 0.5;  // 50% of pitch
    const tTopWidth = tPitch * 0.2;   // Narrow top
    // Depth = Run => Flank angle 45 deg (Rise/Run = 1)
    const tDepth = (tBaseWidth - tTopWidth) / 2;

    // Pre-calculate profile offsets
    const halfBase = tBaseWidth / 2;
    const halfTop = tTopWidth / 2;

    // Helix Bounds (Ensure thread fits strictly INSIDE tHeight)
    const startY = -halfBase;
    const endY = -tHeight + halfBase;


    // --- 1. Top Section (Cover) ---
    if (params.showCover) {
        // Diameter controlled by Base Diameter + 50mm => Radius = Base Radius + 25mm
        const coverRadius = baseRadius + 25;
        const rimHeight = 5; // Vertical edge thickness
        const totalHeight = params.topHeight; // Total height from connection to top
        const chamferHeight = Math.max(1, totalHeight - rimHeight);

        // --- Calculate Thread Dimensions FIRST (to know hole size) ---
        // (Calculated above)

        // Profile points for Lathe (Side Walls & Bottom) - OPEN TOP
        const points = [];
        // Center Bottom (Solid)
        points.push(new THREE.Vector2(0, 0));
        // Outer Bottom (Connection Point)
        points.push(new THREE.Vector2(topRadius, 0));
        // Chamfer Out (Bottom of Rim)
        points.push(new THREE.Vector2(coverRadius, chamferHeight));
        // Vertical Rim (Top Edge)
        points.push(new THREE.Vector2(coverRadius, totalHeight));
        // CLOSE TOP: Add point at center top
        points.push(new THREE.Vector2(0, totalHeight));

        const coverGeo = new THREE.LatheGeometry(points, 64);
        const coverMat = new THREE.MeshStandardMaterial({
            color: params.colorTop,
            metalness: 0.2,
            roughness: 0.1,
            side: THREE.DoubleSide
        });
        const coverMesh = new THREE.Mesh(coverGeo, coverMat);
        coverMesh.position.y = params.elevation;
        coverMesh.name = 'CoverPart';
        modelGroup.add(coverMesh);

        modelGroup.add(coverMesh);

        // --- MALE Threaded Mount (Rosca) ---

        // Create Main Thread Cylinder (Outer Shell)
        const outerCylGeo = new THREE.CylinderGeometry(tRadius, tRadius, tHeight, 64);
        const outerCylBrush = new Brush(outerCylGeo, coverMat);
        outerCylBrush.position.y = params.elevation - (tHeight / 2);
        outerCylBrush.updateMatrixWorld();

        // Create Inner Cutter (Hole)
        const innerCylGeo = new THREE.CylinderGeometry(tInnerRadius, tInnerRadius, tHeight + 2, 64);
        const innerCylBrush = new Brush(innerCylGeo, coverMat);
        innerCylBrush.position.y = params.elevation - (tHeight / 2);
        innerCylBrush.updateMatrixWorld();

        // Subtract to get Hollow Tube
        const hollowCyl = csgEvaluator.evaluate(outerCylBrush, innerCylBrush, SUBTRACTION);
        hollowCyl.name = 'CoverPart';
        modelGroup.add(hollowCyl);

        // (Thread removed for a clean plug-in fit)

        // Bottom Cap (To close the bottom ring of the thread tube)
        const botRingGeo = new THREE.RingGeometry(tInnerRadius, tRadius, 64);
        const botRingMesh = new THREE.Mesh(botRingGeo, coverMat);
        botRingMesh.rotation.x = Math.PI / 2;
        botRingMesh.position.y = params.elevation - tHeight;
        botRingMesh.name = 'CoverPart';
        modelGroup.add(botRingMesh);
    }



    // --- 2. Generate Curves for Solid Body ---
    const thickness = 10;

    // Use helper to get points
    const outerTop = getCurvePoints(topRadius, params.elevation, false, effectiveDip);
    const innerTop = getCurvePoints(topRadius - thickness, params.elevation, false, effectiveDip);

    const outerBase = getCurvePoints(baseRadius, params.baseElevation, true, effectiveDip);
    const innerBase = getCurvePoints(baseRadius - thickness, params.baseElevation, true, effectiveDip);


    // --- 3. Create Solid Mesh (BASE) with CSG Subtraction ---
    if (params.showBody) {

        // 2a. Create the Main Body with mathematically perfect inner wall slope
        const wallThickness = 10;
        
        // Calculate the ideal inner top radius so the inner wall EXACTLY meets the thread hole's bottom
        const innerBaseRadius = baseRadius - wallThickness;
        const totalHeight = params.elevation - params.baseElevation;
        const threadBottomHeight = totalHeight - tHeight;
        
        // We want the inner wall radius at threadBottomHeight to be exactly equal to tRadius (the thread).
        // Using inverted linear interpolation: R_top = R_base + (R_target - R_base) * (totalHeight / targetHeight)
        let solidInnerTopRadius = innerBaseRadius + (tRadius - innerBaseRadius) * (totalHeight / threadBottomHeight);
        solidInnerTopRadius = Math.max(0.1, Math.min(topRadius - 5, solidInnerTopRadius));

        const outerTop = getCurvePoints(topRadius, params.elevation, false, effectiveDip);
        const innerTop = getCurvePoints(solidInnerTopRadius, params.elevation, false, effectiveDip);

        const outerBase = getCurvePoints(baseRadius, params.baseElevation, true, effectiveDip);
        const innerBase = getCurvePoints(innerBaseRadius, params.baseElevation, true, effectiveDip);

        const bodyMesh = createSolidMesh(outerTop, innerTop, outerBase, innerBase, params.colorBody);

        // Convert to Brush
        const bodyBrush = new Brush(bodyMesh.geometry, new THREE.MeshStandardMaterial({ color: params.colorBody }));
        bodyBrush.updateMatrixWorld();

        // 2b. Create the "Cutter" (Male Thread + Tolerance)
        // Represents the shape of the Cover's thread that will carve out the Base.
        const tolerance = 0.25;
        const cutterRadius = tRadius + tolerance;

        // A. Cutter Cylinder (Hole)
        // FIX: Add overshoot to cleanly cut through the top surface without coplanar artifacts
        const overshoot = 2; 
        const cutterGeo = new THREE.CylinderGeometry(cutterRadius, cutterRadius, tHeight + overshoot, 64);
        const cutterCylBrush = new Brush(cutterGeo, new THREE.MeshStandardMaterial({ color: 0xff0000 }));
        cutterCylBrush.position.y = params.elevation - (tHeight / 2) + (overshoot / 2);
        cutterCylBrush.updateMatrixWorld();

        // B. Thread groove removed for a smooth flush socket hole

        // Cutter is just the smooth hole shape
        let cutter = cutterCylBrush;

        // 2c. Perform Subtraction
        // Base - Screw = Threaded Hole
        let finalBody = csgEvaluator.evaluate(bodyBrush, cutter, SUBTRACTION);

        // Ensure materials are preserved
        finalBody.material = new THREE.MeshStandardMaterial({
            color: params.colorBody,
            roughness: 0.6,
            metalness: 0.1,
            side: THREE.DoubleSide
        });

        finalBody.name = 'BaseMesh'; // Tag for export
        modelGroup.add(finalBody);
    }


    // (Wireframe visualization removed)

}


// --- GUI Setup ---
const gui = new GUI();

// Dimensions Folder
const f1 = gui.addFolder('Dimensiones');
const elevationCtrl = f1.add(params, 'elevation', 350, 500).name('Altura');

// USER REQUEST: Original numerical ranges (100-250, 250-400) applied to Diameters
f1.add(params, 'topDiameter', 100, 250).name('Diámetro Superior').onChange(generateGeometry);
f1.add(params, 'baseDiameter', 250, 400).name('Diámetro Base').onChange(generateGeometry);

f1.add(params, 'topHeight', 25, 50).name('Altura Cubierta').onChange(generateGeometry);

// Structure Folder
const f2 = gui.addFolder('Estructura');
// Create controller but don't set fixed max yet (it will be dynamic)
const arcosCtrl = f2.add(params, 'dipFactor', 0, 350).name('Arcos').onChange(generateGeometry);

// Assembly Folder
const f4 = gui.addFolder('Montaje (Ensamblaje)');
f4.add(params, 'threadDiameter', 20, 100).name('Diámetro').onChange(generateGeometry);
f4.add(params, 'threadLength', 10, 100).name('Longitud').onChange(generateGeometry);

// Dynamic Limit Logic
function updateArcosMax() {
    const maxVal = params.elevation - 150; // Updated to 150 (User Request)
    const safeMax = Math.max(0, maxVal);

    // Update Slider Max
    arcosCtrl.max(safeMax);

    // Clamp current value if needed
    if (params.dipFactor > safeMax) {
        params.dipFactor = safeMax;
        arcosCtrl.updateDisplay();
    }

    generateGeometry();
}

// Bind Elevation change
elevationCtrl.onChange(updateArcosMax);

// Appearance Folder
const f3 = gui.addFolder('Apariencia');
f3.add(params, 'showCover').name('Mostrar Cubierta').onChange(generateGeometry);
f3.add(params, 'showBody').name('Mostrar Base').onChange(generateGeometry);
f3.addColor(params, 'colorTop').name('Color Cubierta').onFinishChange(generateGeometry);
f3.addColor(params, 'colorBody').name('Color Cuerpo').onFinishChange(generateGeometry);

// Export Folder
const f5 = gui.addFolder('Exportar 3D');
f5.add(params, 'exportCover').name('Descargar Cubierta (STL)');
f5.add(params, 'exportBase').name('Descargar Base (STL)');

f1.open();
f2.open();
f3.open();
f4.open();
f5.open();

// Initial Run with Limits
updateArcosMax();

// Center Camera on Object (Recalculate center based on new baseRadius/Height if needed, but height is main factor)
// Center Y is roughly midpoint of elevation.
const centerY = (params.elevation + params.baseElevation) / 2;
controls.target.set(0, centerY, 0);
camera.position.set(500, centerY + 200, 700); // Back up a bit for larger object
controls.update();

// --- Generación Automática de QR para visualizar en Móvil ---
const qrContainer = document.getElementById('qr-container');
const qrImg = document.getElementById('qr-code');
if (qrImg && qrContainer) {
    const currentUrl = encodeURIComponent(window.location.href);
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${currentUrl}`;

    // Si el dispositivo nativamente soporta AR (ej. en móvil), escondemos el código QR
    if ('xr' in navigator) {
        navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
            if (supported) {
                qrContainer.style.display = 'none';
            }
        });
    }
}

// --- WebXR AR Events ---
// When entering AR, we must scale the millimeters down to meters so it renders at life-size
renderer.xr.addEventListener('sessionstart', () => {
    modelGroup.scale.set(0.001, 0.001, 0.001);
    modelGroup.position.set(0, -0.2, -0.6); // Position slightly down and forward
});

renderer.xr.addEventListener('sessionend', () => {
    // Revert scale to 1 for correct STL generation and desktop preview
    modelGroup.scale.set(1, 1, 1);
    modelGroup.position.set(0, 0, 0);
});

// --- Loop ---
renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
});

// Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
