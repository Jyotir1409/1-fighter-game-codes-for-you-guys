// --- 1. GLOBAL VARIABLES & SETUP ---
let scene, camera, renderer;
let player1, player2;
let keys = {};
let gameState = 'START'; // START, PLAYING, GAMEOVER
let gameTimer = 60;
let lastTime = 0;

const GROUND_Y = 0;
const GRAVITY = -0.015;

// UI Elements
const uiHud = document.getElementById('hud');
const uiTimer = document.getElementById('timer');
const uiP1Health = document.getElementById('p1-health');
const uiP2Health = document.getElementById('p2-health');
const startMenu = document.getElementById('start-menu');
const gameOverMenu = document.getElementById('game-over');
const winnerText = document.getElementById('winner-text');

initThreeJS();
createEnvironment();

// --- 2. FIGHTER CLASS ---
class Fighter {
    constructor(color, startX, direction, controls, name) {
        this.name = name;
        this.color = color;
        this.direction = direction; // 1 = facing right, -1 = facing left
        this.controls = controls;
        
        // Stats
        this.health = 100;
        this.speed = 0.15;
        this.jumpPower = 0.4;
        
        // Physics/State
        this.velocity = { x: 0, y: 0 };
        this.isJumping = false;
        
        // Combat
        this.isAttacking = false;
        this.attackType = null; // 'punch' or 'kick'
        this.attackFrame = 0;
        this.hasHit = false;

        this.mesh = this.createBody();
        this.mesh.position.set(startX, 2, 0); // Y=2 to sit on floor
        scene.add(this.mesh);
    }

    createBody() {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: this.color });

        // Helper to create offset geometries so they pivot at joints
        const createPart = (w, h, d, yOffset) => {
            const geo = new THREE.BoxGeometry(w, h, d);
            geo.translate(0, yOffset, 0); 
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            return mesh;
        };

        // Torso
        this.torso = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 0.5), mat);
        this.torso.castShadow = true;
        group.add(this.torso);

        // Head
        this.head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat);
        this.head.position.y = 1.15;
        this.head.castShadow = true;
        group.add(this.head);

        // Arm (Right - Attacking Arm)
        this.armR = createPart(0.4, 1.2, 0.4, -0.5);
        this.armR.position.set(0, 0.6, 0.3); // Attached at shoulder
        group.add(this.armR);

        // Arm (Left - Static)
        this.armL = createPart(0.4, 1.2, 0.4, -0.5);
        this.armL.position.set(0, 0.6, -0.3);
        group.add(this.armL);

        // Leg (Right - Attacking Leg)
        this.legR = createPart(0.4, 1.2, 0.4, -0.6);
        this.legR.position.set(0, -0.75, 0.15); // Attached at hip
        group.add(this.legR);

        // Leg (Left - Static)
        this.legL = createPart(0.4, 1.2, 0.4, -0.6);
        this.legL.position.set(0, -0.75, -0.15);
        group.add(this.legL);

        return group;
    }

    update() {
        if (gameState !== 'PLAYING' || this.health <= 0) return;

        // 1. Handle Movement (Left/Right)
        if (keys[this.controls.left] && !this.isAttacking) {
            this.mesh.position.x -= this.speed;
            this.direction = -1; // Face left
        }
        if (keys[this.controls.right] && !this.isAttacking) {
            this.mesh.position.x += this.speed;
            this.direction = 1; // Face right
        }

        // Lock z-axis and boundaries
        this.mesh.position.z = 0; 
        if (this.mesh.position.x < -9) this.mesh.position.x = -9;
        if (this.mesh.position.x > 9) this.mesh.position.x = 9;

        // 2. Handle Jump
        if (keys[this.controls.up] && !this.isJumping && !this.isAttacking) {
            this.velocity.y = this.jumpPower;
            this.isJumping = true;
        }

        // Apply Gravity
        this.velocity.y += GRAVITY;
        this.mesh.position.y += this.velocity.y;

        // Floor collision
        if (this.mesh.position.y <= 2) {
            this.mesh.position.y = 2;
            this.velocity.y = 0;
            this.isJumping = false;
        }

        // 3. Handle Attacks (Punch/Kick)
        if (keys[this.controls.punch] && !this.isAttacking && !this.isJumping) {
            this.isAttacking = true;
            this.attackType = 'punch';
            this.attackFrame = 0;
            this.hasHit = false;
        }
        if (keys[this.controls.kick] && !this.isAttacking && !this.isJumping) {
            this.isAttacking = true;
            this.attackType = 'kick';
            this.attackFrame = 0;
            this.hasHit = false;
        }

        this.animateAttack();
    }

    animateAttack() {
        if (!this.isAttacking) return;

        this.attackFrame++;
        const maxFrames = 20;
        let angle = 0;

        // Animate out and then back in
        if (this.attackFrame <= maxFrames / 2) {
            angle = (this.attackFrame / (maxFrames / 2)) * (Math.PI / 2);
        } else {
            angle = (1 - (this.attackFrame - maxFrames/2) / (maxFrames/2)) * (Math.PI / 2);
        }

        // Apply rotation based on facing direction
        const rotDir = this.direction; 
        
        if (this.attackType === 'punch') {
            this.armR.rotation.z = angle * -rotDir;
        } else if (this.attackType === 'kick') {
            this.legR.rotation.z = angle * -rotDir;
        }

        // End attack
        if (this.attackFrame >= maxFrames) {
            this.isAttacking = false;
            this.armR.rotation.z = 0;
            this.legR.rotation.z = 0;
        }
    }

    takeDamage(amount, knockbackDir) {
        this.health -= amount;
        if (this.health < 0) this.health = 0;
        
        // Knockback effect
        this.mesh.position.x += knockbackDir * 1.5;
        this.mesh.position.y += 0.5; // Slight pop-up
        this.velocity.y = 0;
        
        updateHealthBars();
        checkWinCondition();
    }
}

// --- 3. INIT & ENVIRONMENT ---
function initThreeJS() {
    const container = document.getElementById('game-container');
    
    // Scene & Camera (Fixed 2.5D perspective)
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 20);
    camera.lookAt(0, 2, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Window resize handler
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function createEnvironment() {
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    dirLight.shadow.camera.left = -15;
    dirLight.shadow.camera.right = 15;
    scene.add(dirLight);

    // Arena Floor
    const floorGeo = new THREE.PlaneGeometry(30, 10);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    
    // Background Grid (for visual flavor)
    const gridHelper = new THREE.GridHelper(30, 30, 0x000000, 0x000000);
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);
}

// --- 4. GAME LOGIC ---
function startGame() {
    // Clean up old fighters if they exist
    if (player1) scene.remove(player1.mesh);
    if (player2) scene.remove(player2.mesh);

    // Initialize Players
    const p1Controls = { up: 'KeyW', left: 'KeyA', right: 'KeyD', punch: 'KeyF', kick: 'KeyG' };
    const p2Controls = { up: 'ArrowUp', left: 'ArrowLeft', right: 'ArrowRight', punch: 'KeyK', kick: 'KeyL' };

    player1 = new Fighter(0x007bff, -4, 1, p1Controls, "PLAYER 1"); // Blue
    player2 = new Fighter(0xdc3545, 4, -1, p2Controls, "PLAYER 2"); // Red

    // Reset Game State
    gameTimer = 60;
    lastTime = Date.now();
    gameState = 'PLAYING';
    
    // UI Update
    startMenu.style.display = 'none';
    gameOverMenu.style.display = 'none';
    uiHud.style.display = 'flex';
    updateHealthBars();
    uiTimer.innerText = gameTimer;

    animate();
}

function resetGame() {
    startGame();
}

function updateHealthBars() {
    uiP1Health.style.width = player1.health + '%';
    uiP2Health.style.width = player2.health + '%';
}

function checkWinCondition() {
    if (player1.health <= 0 || player2.health <= 0 || gameTimer <= 0) {
        gameState = 'GAMEOVER';
        uiHud.style.display = 'none';
        gameOverMenu.style.display = 'flex';

        if (player1.health > player2.health) {
            winnerText.innerText = "PLAYER 1 WINS!";
        } else if (player2.health > player1.health) {
            winnerText.innerText = "PLAYER 2 WINS!";
        } else {
            winnerText.innerText = "DRAW!";
        }
    }
}

// Collision Detection
function checkCollisions() {
    if (gameState !== 'PLAYING') return;

    // Distance check (X axis mainly since it's 2.5D)
    const dist = Math.abs(player1.mesh.position.x - player2.mesh.position.x);
    const reach = 2.0; // Attack range

    // Check if P1 hits P2
    if (player1.isAttacking && dist < reach && !player1.hasHit) {
        // Must be facing the right way
        if ((player1.direction === 1 && player1.mesh.position.x < player2.mesh.position.x) ||
            (player1.direction === -1 && player1.mesh.position.x > player2.mesh.position.x)) {
            
            const dmg = player1.attackType === 'punch' ? 5 : 10;
            player2.takeDamage(dmg, player1.direction);
            player1.hasHit = true;
        }
    }

    // Check if P2 hits P1
    if (player2.isAttacking && dist < reach && !player2.hasHit) {
        if ((player2.direction === 1 && player2.mesh.position.x < player1.mesh.position.x) ||
            (player2.direction === -1 && player2.mesh.position.x > player1.mesh.position.x)) {
            
            const dmg = player2.attackType === 'punch' ? 5 : 10;
            player1.takeDamage(dmg, player2.direction);
            player2.hasHit = true;
        }
    }
}

// --- 5. MAIN LOOP & INPUT ---
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);

function animate() {
    if (gameState === 'PLAYING') {
        requestAnimationFrame(animate);

        // Timer Logic
        const now = Date.now();
        if (now - lastTime >= 1000) {
            gameTimer--;
            uiTimer.innerText = gameTimer;
            lastTime = now;
            if (gameTimer <= 0) checkWinCondition();
        }

        // Update entities
        player1.update();
        player2.update();
        
        checkCollisions();
    }

    // Render scene
    renderer.render(scene, camera);
}

// Initial render for the Start Screen background
renderer.render(scene, camera);