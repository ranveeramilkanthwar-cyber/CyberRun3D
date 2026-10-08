import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- PHYSICS (ADVANCED CONSTRAINTS) ---
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -30, 0) });
const solver = new CANNON.GSSolver();
solver.iterations = 15;
world.solver = solver;
const physMat = new CANNON.Material();
world.addContactMaterial(new CANNON.ContactMaterial(physMat, physMat, { friction: 0.0, restitution: 0.1 }));

// --- SCENE ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.FogExp2(0x050510, 0.015);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 2000);
const cameraOffset = new THREE.Vector3(0, 8, 15);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2 for performance
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 + 0.1; // Restrict going too far below the platforms
controls.minDistance = 10;
controls.maxDistance = 100;
// Set initial view
camera.position.set(0, 25, 35);
controls.target.set(0, 10, 0);
controls.update();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloom.threshold = 0.2; bloom.strength = 1.0; bloom.radius = 0.3;
composer.addPass(bloom);
const glitch = new GlitchPass();
glitch.enabled = false;
composer.addPass(glitch);

// Lighting
scene.add(new THREE.AmbientLight(0x222222));
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(50, 100, 50);
dirLight.castShadow = true;
scene.add(dirLight);

// Environment (Dynamic Hexagon Grid)
const envGeo = new THREE.InstancedMesh(new THREE.CylinderGeometry(2, 2, 10, 6), new THREE.MeshStandardMaterial({color: 0x111122, metalness: 0.8, roughness: 0.2}), 1000);
scene.add(envGeo);
const dummy = new THREE.Object3D();
let envCount = 0;
for(let x=-5; x<5; x++) {
    for(let z=0; z<100; z++) {
        dummy.position.set(x*4 + (z%2===0?2:0), -15 - Math.random()*20, -z*3.5);
        dummy.updateMatrix();
        envGeo.setMatrixAt(envCount++, dummy.matrix);
    }
}
envGeo.instanceMatrix.needsUpdate = true;

// --- BACKGROUND PARTICLES ---
const starGeo = new THREE.BufferGeometry();
const starCount = 3000;
const starPos = new Float32Array(starCount * 3);
for(let i=0; i<starCount; i++) {
    starPos[i*3] = (Math.random() - 0.5) * 500;
    starPos[i*3+1] = (Math.random() - 0.5) * 500;
    starPos[i*3+2] = (Math.random() - 0.5) * 500;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({color: 0x00ffff, size: 0.8, transparent: true, opacity: 0.6});
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);


// --- STATE ---
const state = {
    level: 1, score: 0, 
    jumps: 0, maxJumps: 3,
    dashReady: true,
    grappleBody: null, grappleConstraint: null,
    checkpoint: new THREE.Vector3(0, 10, 0)
};

// --- PLAYER ---
const playerRadius = 1;
const playerMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(playerRadius, 3), new THREE.MeshPhysicalMaterial({ color: 0x00ffff, emissive: 0x00aaaa, roughness: 0.1, transmission: 0.9, thickness: 1.0 }));
playerMesh.castShadow = true; scene.add(playerMesh);
const playerBody = new CANNON.Body({ mass: 5, material: physMat, shape: new CANNON.Sphere(playerRadius), position: new CANNON.Vec3(0, 10, 0) });
world.addBody(playerBody);

const playerLight = new THREE.PointLight(0x00ffff, 3, 40);
scene.add(playerLight);

// --- LEVEL GENERATION (RHYTHM/PATTERN BASED) ---
const objects = [];
function createObj(x, y, z, w, h, d, type, color, moveSpeed=0, moveAxis='x') {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.8 }));
    mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true; scene.add(mesh);
    const body = new CANNON.Body({ type: moveSpeed?CANNON.Body.KINEMATIC:CANNON.Body.STATIC, material: physMat, shape: new CANNON.Box(new CANNON.Vec3(w/2,h/2,d/2)), position: new CANNON.Vec3(x,y,z) });
    if(type==='hazard') body.isTrigger = true;
    world.addBody(body);
    objects.push({mesh, body, type, startX: x, startY: y, startZ: z, time: Math.random()*100, moveSpeed, moveAxis});
    return body;
}

function generate() {
    objects.forEach(o => { scene.remove(o.mesh); world.removeBody(o.body); });
    objects.length = 0;
    
    state.checkpoint.set(0, 10, 0);
    playerBody.position.set(0, 10, 0); playerBody.velocity.set(0,0,0);
    
    createObj(0, 0, 0, 20, 2, 20, 'pad', 0x2222ff);
    let curX = 0, curZ = 0;
    let dir = 0; // 0: -Z, 1: -X, 2: +X
    
    for(let i=0; i<20+state.level*5; i++) {
        // Randomly turn left or right
        if(Math.random() < 0.35) {
            if(dir === 0) dir = (Math.random() < 0.5) ? 1 : 2;
            else dir = 0;
        }
        
        let dx = 0, dz = 0;
        if(dir === 0) dz = -20;
        else if(dir === 1) dx = -20;
        else if(dir === 2) dx = 20;
        
        curX += dx; curZ += dz;
        
        const r = Math.random();
        if(r < 0.2) {
            // Gap + Grapple hook point
            createObj(curX - dx*0.5, 15, curZ - dz*0.5, 4, 4, 4, 'grapple', 0xffff00);
            createObj(curX, 0, curZ, 20, 2, 20, 'pad', 0x2222ff);
        } else if (r < 0.5) {
            // Moving walls (Hazards)
            createObj(curX, 0, curZ, 20, 2, 20, 'pad', 0x2222ff);
            if(dir === 0) { // Moving along Z, obstacles sweep X
                createObj(curX, 5, curZ, 12, 10, 2, 'hazard', 0xff0000, 2 + state.level * 0.3, 'x');
            } else { // Moving along X, obstacles sweep Z
                createObj(curX, 5, curZ, 2, 10, 12, 'hazard', 0xff0000, 2 + state.level * 0.3, 'z');
            }
        } else if (r < 0.7) {
            // Staircase / Elevation
            createObj(curX - dx*0.6, 2, curZ - dz*0.6, 12, 2, 12, 'pad', 0x2222ff);
            createObj(curX - dx*0.3, 4, curZ - dz*0.3, 12, 2, 12, 'pad', 0x2222ff);
            createObj(curX, 6, curZ, 12, 2, 12, 'pad', 0x2222ff);
        } else {
            // Safe pad
            createObj(curX, 0, curZ, 20, 2, 20, 'pad', 0x2222ff);
        }
    }
    // Finish
    curX += (dir===1?-20:dir===2?20:0);
    curZ += (dir===0?-20:0);
    createObj(curX, 0, curZ, 30, 2, 30, 'finish', 0xffffff);
}
generate();

// --- CONTROLS & MECHANICS ---
const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code]=true;
    if(e.code === 'Space' && state.jumps < state.maxJumps) {
        playerBody.velocity.y = 20; state.jumps++;
        triggerGlitch(0.1);
    }
    if(e.code === 'ShiftLeft' && state.dashReady) {
        state.dashReady = false;
        const dir = new THREE.Vector3(0,0,-1).applyQuaternion(playerMesh.quaternion);
        playerBody.velocity.set(dir.x*120, 10, dir.z*120);
        triggerGlitch(0.2);
        setTimeout(()=>state.dashReady=true, 1000);
    }
    if(e.code === 'KeyE') {
        // Grapple
        if(state.grappleConstraint) { world.removeConstraint(state.grappleConstraint); state.grappleConstraint = null; }
        else {
            const hook = objects.find(o => o.type === 'grapple' && o.body.position.distanceTo(playerBody.position) < 50);
            if(hook) {
                state.grappleConstraint = new CANNON.DistanceConstraint(playerBody, hook.body, 15);
                world.addConstraint(state.grappleConstraint);
                triggerGlitch(0.05);
            }
        }
    }
});
window.addEventListener('keyup', e => keys[e.code]=false);

playerBody.addEventListener("collide", (e) => {
    state.jumps = 0; // reset jumps reliably on any collision

    // Checkpoint logic
    const hitObj = objects.find(o => o.body === e.body);
    if(hitObj && (hitObj.type === 'pad' || hitObj.type === 'finish')) {
        state.checkpoint.set(hitObj.startX, hitObj.startY + 5, hitObj.startZ);
    }
});

// --- BUTTON CONTROLS ---
const bindBtn = (id, code) => {
    const btn = document.getElementById(id);
    if(btn) {
        btn.addEventListener('mousedown', () => window.dispatchEvent(new KeyboardEvent('keydown', { code })));
        btn.addEventListener('mouseup', () => window.dispatchEvent(new KeyboardEvent('keyup', { code })));
        btn.addEventListener('mouseleave', () => window.dispatchEvent(new KeyboardEvent('keyup', { code })));
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); window.dispatchEvent(new KeyboardEvent('keydown', { code })); });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); window.dispatchEvent(new KeyboardEvent('keyup', { code })); });
    }
};
bindBtn('btn-w', 'KeyW');
bindBtn('btn-a', 'KeyA');
bindBtn('btn-s', 'KeyS');
bindBtn('btn-d', 'KeyD');
bindBtn('btn-jump', 'Space');
bindBtn('btn-dash', 'ShiftLeft');
bindBtn('btn-grapple', 'KeyE');

function triggerGlitch(time) {
    glitch.enabled = true;
    setTimeout(()=>glitch.enabled=false, time*1000);
}

function die() {
    triggerGlitch(0.5);
    state.score = Math.max(0, state.score - 50);
    document.getElementById('score').innerText = state.score;
    playerBody.position.set(state.checkpoint.x, state.checkpoint.y, state.checkpoint.z);
    playerBody.velocity.set(0,0,0);
    if(state.grappleConstraint) { world.removeConstraint(state.grappleConstraint); state.grappleConstraint = null; }
    
    // Clear trail so it doesn't stretch across the map
    for(let i=0; i<trailCount*3; i+=3) {
        trailPos[i] = state.checkpoint.x;
        trailPos[i+1] = state.checkpoint.y;
        trailPos[i+2] = state.checkpoint.z;
    }
    trailGeo.attributes.position.needsUpdate = true;
}

// Custom Trail
const trailGeo = new THREE.BufferGeometry();
const trailCount = 100;
const trailPos = new Float32Array(trailCount*3);
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
const trailMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 3 });
const trail = new THREE.Line(trailGeo, trailMat);
scene.add(trail);
let trailIdx = 0;

// Grapple Line
const grLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const grLine = new THREE.Line(grLineGeo, new THREE.LineBasicMaterial({color: 0xffff00}));
scene.add(grLine);

// --- LOOP ---
let lastCallTime = performance.now();

// Run controls in physics preStep for perfectly smooth, frame-independent movement
world.addEventListener("preStep", () => {
    const speed = 40;
    let moveX=0, moveZ=0;
    if(keys['KeyW']) moveZ -= 1;
    if(keys['KeyS']) moveZ += 1;
    if(keys['KeyA']) moveX -= 1;
    if(keys['KeyD']) moveX += 1;
    
    if(moveX!==0 || moveZ!==0) {
        const dir = new THREE.Vector2(moveX, moveZ).normalize();
        playerBody.velocity.x = dir.x * speed;
        if(!state.grappleConstraint) playerBody.velocity.z = dir.y * speed;
    } else {
        playerBody.velocity.x *= 0.85;
        if(!state.grappleConstraint) playerBody.velocity.z *= 0.85;
    }
});

function animate() {
    requestAnimationFrame(animate);
    
    const time = performance.now();
    const dt = (time - lastCallTime) / 1000;
    lastCallTime = time;
    
    world.step(1/60, Math.min(dt, 0.1), 3);

    playerMesh.position.copy(playerBody.position);
    playerMesh.quaternion.copy(playerBody.quaternion);
    playerLight.position.copy(playerMesh.position);
    
    // Trail
    trailPos[trailIdx*3] = playerMesh.position.x; trailPos[trailIdx*3+1] = playerMesh.position.y; trailPos[trailIdx*3+2] = playerMesh.position.z;
    trailIdx = (trailIdx+1)%trailCount;
    trailGeo.attributes.position.needsUpdate = true;
    
    // Grapple vis
    if(state.grappleConstraint) {
        grLine.visible = true;
        const pts = grLineGeo.attributes.position.array;
        pts[0]=playerMesh.position.x; pts[1]=playerMesh.position.y; pts[2]=playerMesh.position.z;
        pts[3]=state.grappleConstraint.bodyB.position.x; pts[4]=state.grappleConstraint.bodyB.position.y; pts[5]=state.grappleConstraint.bodyB.position.z;
        grLineGeo.attributes.position.needsUpdate = true;
        // Reel in
        state.grappleConstraint.distance = Math.max(2, state.grappleConstraint.distance - dt * 15);
    } else {
        grLine.visible = false;
    }

    // Objects Logic
    objects.forEach(o => {
        if(o.type === 'hazard') {
            if(o.moveSpeed) {
                o.time += dt * 3; // Frame-rate independent hazard movement
                if(o.moveAxis === 'x') {
                    o.body.position.x = o.startX + Math.sin(o.time) * o.moveSpeed;
                } else {
                    o.body.position.z = o.startZ + Math.sin(o.time) * o.moveSpeed;
                }
                o.mesh.position.copy(o.body.position);
            }
            if(o.body.position.distanceTo(playerBody.position) < 3) die();
        }
        if(o.type === 'finish' && o.body.position.distanceTo(playerBody.position) < 10) {
            state.level++; state.score+=1000; document.getElementById('score').innerText = state.score;
            document.getElementById('level-display').innerText = state.level;
            generate();
        }
    });

    if(playerBody.position.y < -30) die();

    // Pulse Env
    const scale = 1 + Math.sin(Date.now()*0.01)*0.1;
    envGeo.scale.set(1, scale, 1);

    // Camera (Orbit Controls Following Player)
    controls.target.copy(playerMesh.position);
    controls.update(); // Smoothly follow and allow mouse rotation

    // Animate background stars
    const starPositions = starGeo.attributes.position.array;
    for(let i=2; i<starCount*3; i+=3) {
        starPositions[i] += playerBody.velocity.length() * 0.05 + 0.2; // Move stars towards camera based on speed
        if(starPositions[i] > 250) starPositions[i] = -250;
    }
    starGeo.attributes.position.needsUpdate = true;
    stars.rotation.z -= 0.0005;

    // Speed Lines Effect
    const speedLines = document.getElementById('speed-lines');
    if(speedLines) {
        const velSq = playerBody.velocity.lengthSquared();
        if(velSq > 2000) {
            speedLines.style.opacity = Math.min(1, (velSq - 2000) / 5000);
        } else {
            speedLines.style.opacity = 0;
        }
    }

    composer.render();
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});
animate();
