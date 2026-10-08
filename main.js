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

const hazardMat = new CANNON.Material();
world.addContactMaterial(new CANNON.ContactMaterial(physMat, hazardMat, { friction: 0.2, restitution: 1.5 })); // Super bouncy Fall Guys style

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

camera.position.set(0, 15, 25);
camera.lookAt(0, 10, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.enablePan = false;
controls.maxPolarAngle = Math.PI / 2 - 0.1; // Don't let camera go below ground
controls.minDistance = 10;
controls.maxDistance = 60;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloom.threshold = 0.2; bloom.strength = 0.3; bloom.radius = 0.1;
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
    jumps: 0, maxJumps: 1, // Only jump when at ground
    dashReady: true,
    grappleBody: null, grappleConstraint: null,
    checkpoint: new THREE.Vector3(0, 10, 0),
    lastZ: 10,
    lastY: 0,
    checkpointCount: 0,
    recordChk: parseInt(localStorage.getItem('recordChk') || '0'),
    nextCheckpointDist: 5 // Initial distance to first checkpoint
};
if(document.getElementById('record-chk')) document.getElementById('record-chk').innerText = state.recordChk;

// --- PLAYER (THE BEAN CHARACTER) ---
const playerRadius = 1;
const playerGroup = new THREE.Group();
const beanMat = new THREE.MeshPhysicalMaterial({ color: 0x00ffff, emissive: 0x00aaaa, roughness: 0.1, transmission: 0.9, thickness: 1.0 });

// Body
const bodyMesh = new THREE.Mesh(new THREE.CapsuleGeometry(playerRadius, 2, 4, 16), beanMat);
playerGroup.add(bodyMesh);

// Eyes
const eyeMat = new THREE.MeshBasicMaterial({color: 0x000000});
const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.25), eyeMat);
eyeR.position.set(0.4, 0.8, -0.9);
playerGroup.add(eyeR);
const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.25), eyeMat);
eyeL.position.set(-0.4, 0.8, -0.9);
playerGroup.add(eyeL);

// Arms
const armGeo = new THREE.CapsuleGeometry(0.3, 1.2);
const armR = new THREE.Mesh(armGeo, beanMat);
armR.position.set(1.2, 0, 0); armR.rotation.z = -Math.PI/8;
playerGroup.add(armR);
const armL = new THREE.Mesh(armGeo, beanMat);
armL.position.set(-1.2, 0, 0); armL.rotation.z = Math.PI/8;
playerGroup.add(armL);

scene.add(playerGroup);
const playerBody = new CANNON.Body({ mass: 5, material: physMat, shape: new CANNON.Sphere(1.5), position: new CANNON.Vec3(0, 10, 0) });
playerBody.fixedRotation = true; // Stay upright like a Fall Guy
playerBody.updateMassProperties();
world.addBody(playerBody);

const playerLight = new THREE.PointLight(0x00ffff, 3, 40);
scene.add(playerLight);

// --- LEVEL GENERATION (RHYTHM/PATTERN BASED) ---
const objects = [];
function createObj(x, y, z, w, h, d, type, color, moveSpeed=0, moveAxis='x', isTrigger=false, pitch=0) {
    let geo = new THREE.BoxGeometry(w, h, d);
    let shape = new CANNON.Box(new CANNON.Vec3(w/2,h/2,d/2));
    if(type === 'bumper') {
        geo = new THREE.CylinderGeometry(w/2, w/2, h, 16);
        // CANNON.Cylinder acts on Z axis, so just use sphere for physics for a bouncy bumper
        shape = new CANNON.Sphere(w/2);
    } else if (type === 'coin') {
        geo = new THREE.TorusGeometry(w, h, 8, 16);
    }
    
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: type==='coin'?0.8:0.2, metalness: type==='coin'?1.0:0.8 }));
    mesh.position.set(x,y,z); 
    mesh.rotation.x = pitch;
    mesh.castShadow=true; mesh.receiveShadow=true; scene.add(mesh);
    
    const useHazardMat = (type==='hazard'||type==='spinner'||type==='pendulum'||type==='bumper');
    const body = new CANNON.Body({ type: moveSpeed?CANNON.Body.KINEMATIC:CANNON.Body.STATIC, material: useHazardMat?hazardMat:physMat, shape: shape, position: new CANNON.Vec3(x,y,z) });
    if (pitch !== 0) body.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), pitch);
    
    if(isTrigger || type === 'coin') body.isTrigger = true;
    world.addBody(body);
    objects.push({mesh, body, type, startX: x, startY: y, startZ: z, time: Math.random()*100, moveSpeed, moveAxis});
    return body;
}

function createCheckpointDoor(x, z, num) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.fillRect(0,0,512,256);
    ctx.font = 'bold 120px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.fillText("CHK " + num, 256, 160);
    const tex = new THREE.CanvasTexture(canvas);
    
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshBasicMaterial({map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false}));
    mesh.position.set(x, 10, z);
    scene.add(mesh);
    
    // trigger body
    const body = new CANNON.Body({ isTrigger: true, shape: new CANNON.Box(new CANNON.Vec3(20, 10, 1)), position: new CANNON.Vec3(x, 10, z) });
    world.addBody(body);
    objects.push({mesh, body, type: 'checkpoint_door', startX: x, startY: 10, startZ: z, active: true});
}

function generateChunk(numBlocks) {
    for(let i=0; i<numBlocks; i++) {
        state.lastZ -= 20;
        const curZ = state.lastZ;
        const curY = state.lastY;
        
        const r = Math.random();
        state.nextCheckpointDist--;
        if (state.nextCheckpointDist <= 0) {
            state.nextCheckpointDist = 8 + Math.floor(Math.random() * 12);
            createObj(0, curY, curZ, 40, 2, 20, 'pad', 0x1111aa);
            state.checkpointCount++;
            createCheckpointDoor(0, curZ, state.checkpointCount);
        } else if(r < 0.2) {
            // FALL GUYS: Spinning Hammers
            createObj(0, curY, curZ, 40, 2, 20, 'pad', 0xaa00aa); 
            createObj(0, curY + 5, curZ, 30, 4, 4, 'spinner', 0xaaaa00, 3 + state.level*0.2); 
            createObj(18, curY + 50, curZ, 4, 100, 20, 'hazard', 0xaa0000); 
            createObj(-18, curY + 50, curZ, 4, 100, 20, 'hazard', 0xaa0000); 
        } else if (r < 0.4) {
            // FALL GUYS: Pendulums
            createObj(0, curY, curZ, 40, 2, 20, 'pad', 0xaa5500); 
            createObj(-10, curY + 25, curZ, 6, 6, 6, 'pendulum', 0xaa0000, 3 + state.level*0.1);
            createObj(10, curY + 25, curZ, 6, 6, 6, 'pendulum', 0xaa0000, 3.5 + state.level*0.1);
        } else if (r < 0.55) {
            // FALL GUYS: Multi-Sliding Doors
            createObj(0, curY, curZ, 40, 2, 20, 'pad', 0x00aaaa); 
            createObj(-15, curY + 50, curZ, 20, 100, 8, 'hazard', 0xaa0000, 4 + state.level*0.2, 'x'); 
            createObj(15, curY + 50, curZ, 20, 100, 8, 'hazard', 0xaa0000, -4 - state.level*0.2, 'x'); 
        } else if (r < 0.7) {
            // MASSIVE INCLINED RAMP (Up or Down)
            const pitch = (Math.random() > 0.5 ? 1 : -1) * 0.4; // steep incline or decline
            const rampLen = 80;
            // The ramp spans from curZ to curZ - rampLen.
            // Z shift is rampLen * cos(pitch), Y shift is rampLen * sin(pitch)
            const dZ = rampLen * Math.cos(pitch);
            const dY = rampLen * Math.sin(-pitch); // -pitch because -Z is forward
            
            // Place ramp at midpoint
            createObj(0, curY + dY/2, curZ - dZ/2, 40, 2, rampLen, 'pad', 0x220022, 0, 'x', false, pitch);
            
            // Spawn some bouncing hazards rolling down the ramp!
            createObj(Math.random()*20-10, curY + dY/2 + 5, curZ - dZ/2, 8, 8, 8, 'bumper', 0xaa0000);
            
            state.lastZ -= dZ;
            state.lastY += dY;
        } else if (r < 0.85) {
            // FALL GUYS: Bumpers and Coins
            createObj(0, curY, curZ, 40, 2, 20, 'pad', 0x00aa00); 
            createObj(-10, curY + 5, curZ, 6, 8, 6, 'bumper', 0xaa0000);
            createObj(10, curY + 5, curZ, 6, 8, 6, 'bumper', 0xaa0000);
            createObj(0, curY + 5, curZ, 2, 0.5, 2, 'coin', 0xffff00);
        } else {
            // EASY: Wide Safe pad with minor obstacles
            createObj(0, curY, curZ, 40, 2, 20, 'pad', 0xaaaa00); 
            createObj((Math.random()-0.5)*20, curY + 50, curZ, 12, 100, 8, 'hazard', 0xaa0000, 2 + state.level*0.2, 'x');
            createObj(0, curY + 5, curZ - 5, 2, 0.5, 2, 'coin', 0xffff00);
            createObj(0, curY + 5, curZ + 5, 2, 0.5, 2, 'coin', 0xffff00);
        }
    }
}

function initGame() {
    objects.forEach(o => { scene.remove(o.mesh); world.removeBody(o.body); });
    objects.length = 0;
    
    state.checkpoint.set(0, 10, 0);
    state.lastZ = 10;
    state.lastY = 0;
    playerBody.position.set(0, 10, 0); playerBody.velocity.set(0,0,0);
    
    // Start pad
    createObj(0, 0, 0, 40, 2, 20, 'pad', 0x1111aa);
    generateChunk(25);
}
initGame();

// --- CONTROLS & MECHANICS ---
const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code]=true;
    if(e.code === 'Space' && state.jumps < state.maxJumps) {
        playerBody.velocity.y = 28; state.jumps++; // Bigger jump
        triggerGlitch(0.1);
    }
    if(e.code === 'ShiftLeft' && state.dashReady) {
        state.dashReady = false;
        // Dive mechanics (Launch forward and up)
        const forward = new THREE.Vector3(0, 0, -1);
        playerBody.velocity.set(forward.x * 60, 15, forward.z * 60);
        setTimeout(()=>state.dashReady=true, 1500); // Long recovery time for diving
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
    const hitObj = objects.find(o => o.body === e.body);
    
    // Only reset jumps when firmly landing on a ground pad
    if (hitObj && hitObj.type === 'pad') {
        state.jumps = 0; 
    }
    
    if(hitObj && (hitObj.type === 'hazard' || hitObj.type === 'spinner' || hitObj.type === 'pendulum' || hitObj.type === 'bumper')) {
        // Only tackle (destroy) the obstacle if you are currently diving!
        if(!state.dashReady) {
            scene.remove(hitObj.mesh);
            world.removeBody(hitObj.body);
            objects.splice(objects.indexOf(hitObj), 1);
            
            triggerGlitch(0.2);
            state.score += 500; // Bonus for tackling
            document.getElementById('score').innerText = state.score;
            
            const msg = document.getElementById('center-msg');
            if(msg) { msg.innerText = "OBSTACLE SMASHED!"; msg.style.opacity = 1; setTimeout(()=>msg.style.opacity=0, 1000); }
        } else {
            // Arcade-Perfect Physics Knockback
            const dx = playerBody.position.x - hitObj.body.position.x;
            const dz = playerBody.position.z - hitObj.body.position.z;
            const dist = Math.sqrt(dx*dx + dz*dz) || 1;
            
            // Apply massive explosive force outward and upward
            playerBody.velocity.x = (dx/dist) * 50;
            playerBody.velocity.y = 30; // Knock them high into the air
            playerBody.velocity.z = (dz/dist) * 50;
            
            triggerGlitch(0.1);
        }
    }
});

// --- BUTTON CONTROLS & JOYSTICK ---
let joyX = 0, joyY = 0;
const jZone = document.getElementById('joystick-zone');
const jKnob = document.getElementById('joystick-knob');
if (jZone) {
    let jCenter = {x:0, y:0};
    
    jZone.addEventListener('touchstart', e => {
        e.preventDefault(); e.stopPropagation();
        const rect = jZone.getBoundingClientRect();
        jCenter = { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
        updateJoy(e.touches[0]);
    }, {passive: false});
    
    jZone.addEventListener('touchmove', e => {
        e.preventDefault(); e.stopPropagation();
        updateJoy(e.touches[0]);
    }, {passive: false});
    
    jZone.addEventListener('touchend', e => {
        e.preventDefault(); e.stopPropagation();
        joyX = 0; joyY = 0;
        jKnob.style.transform = `translate(0px, 0px)`;
    }, {passive: false});
    
    function updateJoy(touch) {
        const dx = touch.clientX - jCenter.x;
        const dy = touch.clientY - jCenter.y;
        const dist = Math.min(Math.sqrt(dx*dx + dy*dy), 50);
        const angle = Math.atan2(dy, dx);
        joyX = (dist * Math.cos(angle)) / 50; 
        joyY = (dist * Math.sin(angle)) / 50; 
        jKnob.style.transform = `translate(${joyX*50}px, ${joyY*50}px)`;
    }
}

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
    
    // Combine Keyboard and Joystick
    moveX = Math.abs(moveX) > 0 ? moveX : joyX;
    moveZ = Math.abs(moveZ) > 0 ? moveZ : joyY;
    
    if(moveX!==0 || moveZ!==0) {
        // Camera relative movement!
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0; // Keep movement purely horizontal
        forward.normalize();
        
        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        
        const targetDir = new THREE.Vector3();
        targetDir.addScaledVector(forward, -moveZ); // W goes forward relative to camera
        targetDir.addScaledVector(right, moveX);    // D goes right relative to camera
        targetDir.normalize();

        playerBody.velocity.x = targetDir.x * speed;
        if(!state.grappleConstraint) playerBody.velocity.z = targetDir.z * speed;
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

    playerGroup.position.copy(playerBody.position);
    
    // Fall Guys Animations
    if(!state.dashReady) {
        // Belly slide dive
        playerGroup.rotation.set(-Math.PI / 2, 0, 0);
    } else {
        // Upright, tilt into run
        playerGroup.rotation.set(playerBody.velocity.z * 0.015, 0, -playerBody.velocity.x * 0.015);
    }
    
    playerLight.position.copy(playerGroup.position);
    
    // Trail
    trailPos[trailIdx*3] = playerGroup.position.x; trailPos[trailIdx*3+1] = playerGroup.position.y; trailPos[trailIdx*3+2] = playerGroup.position.z;
    trailIdx = (trailIdx+1)%trailCount;
    trailGeo.attributes.position.needsUpdate = true;
    
    // Grapple vis
    if(state.grappleConstraint) {
        grLine.visible = true;
        const pts = grLineGeo.attributes.position.array;
        pts[0]=playerGroup.position.x; pts[1]=playerGroup.position.y; pts[2]=playerGroup.position.z;
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
                o.time += dt * 3;
                const v = Math.cos(o.time) * 3 * o.moveSpeed;
                if(o.moveAxis === 'x') {
                    o.body.velocity.x = v;
                    o.body.position.x = o.startX + Math.sin(o.time) * o.moveSpeed; // hard sync to prevent drift
                } else {
                    o.body.velocity.z = v;
                    o.body.position.z = o.startZ + Math.sin(o.time) * o.moveSpeed;
                }
                o.mesh.position.copy(o.body.position);
            }
        }
        if(o.type === 'spinner') {
            if(o.moveSpeed) {
                o.time += dt * 3;
                o.body.angularVelocity.set(0, o.moveSpeed * 3, 0); // Assign real angular velocity for correct collision impulses!
                o.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), o.time * o.moveSpeed);
                o.mesh.quaternion.copy(o.body.quaternion);
            }
        }
        if(o.type === 'pendulum') {
            if(o.moveSpeed) {
                o.time += dt * o.moveSpeed;
                const angle = Math.sin(o.time) * Math.PI/2.5;
                const dAngleDt = Math.cos(o.time) * o.moveSpeed * Math.PI/2.5;
                o.body.velocity.x = Math.cos(angle) * dAngleDt * 15;
                o.body.velocity.y = Math.sin(angle) * dAngleDt * 15;
                
                o.body.position.x = o.startX + Math.sin(angle) * 15;
                o.body.position.y = o.startY - Math.cos(angle) * 15;
                o.mesh.position.copy(o.body.position);
            }
        }
        if(o.type === 'coin') {
            o.mesh.rotation.y += dt * 5;
            if(o.body.position.distanceTo(playerBody.position) < 4) {
                scene.remove(o.mesh);
                world.removeBody(o.body);
                objects.splice(objects.indexOf(o), 1);
                state.score += 100;
                document.getElementById('score').innerText = state.score;
            }
        }
        if(o.type === 'checkpoint_door') {
            if(o.active && o.body.position.distanceTo(playerBody.position) < 8) {
                o.active = false;
                o.mesh.visible = false;
                state.checkpoint.set(o.startX, o.startY + 5, o.startZ);
                document.getElementById('level-display').innerText = state.checkpointCount;
                if(state.checkpointCount > state.recordChk) {
                    state.recordChk = state.checkpointCount;
                    localStorage.setItem('recordChk', state.recordChk);
                    document.getElementById('record-chk').innerText = state.recordChk;
                }
                
                const msg = document.getElementById('center-msg');
                if(msg) { msg.innerText = "CHECKPOINT REACHED"; msg.style.opacity = 1; setTimeout(()=>msg.style.opacity=0, 1000); }
            }
        }
    });

    // Endless Generation & Garbage Collection
    if(playerBody.position.z < state.lastZ + 150) {
        state.level++; state.score+=1000; document.getElementById('score').innerText = state.score;
        generateChunk(10);
        
        // Remove objects far behind the player (and far behind checkpoint) to prevent memory leaks
        const cullZ = Math.max(playerBody.position.z, state.checkpoint.z) + 100;
        for(let i=objects.length-1; i>=0; i--) {
            const o = objects[i];
            if(o.body.position.z > cullZ) {
                scene.remove(o.mesh);
                world.removeBody(o.body);
                objects.splice(i, 1);
            }
        }
    }

    if(playerBody.position.y < state.checkpoint.y - 50) die();

    // Pulse Env
    const scale = 1 + Math.sin(Date.now()*0.01)*0.1;
    envGeo.scale.set(1, scale, 1);

    // Update Mouse View Camera
    controls.target.copy(playerGroup.position);
    controls.update();

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
