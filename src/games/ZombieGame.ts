import * as THREE from 'three';
import { GameSettings, GameStatus } from '../types';

interface Zombie {
  mesh: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  head: THREE.Object3D;
  zombieType: 'normal' | 'fast';
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  scoreReward: number;
  isHitFlashing: number; // Flash timer > 0
}

interface Bullet {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  lifespan: number; // time left to live in ms
  isVortex?: boolean;
  damage?: number;
}

export class ZombieGame {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private onScore: (score: number) => void;
  private onHealth: (health: number) => void;
  private onStatus: (status: GameStatus) => void;
  private settings: GameSettings;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private animationFrameId: number | null = null;

  // Custom Options Configuration
  private weaponType = 'plasma_rifle';

  // Game states
  private score = 0;
  private health = 100;
  private status: GameStatus = 'PLAYING';
  private currentWave = 1;
  private killCount = 0;
  private timeElapsed = 0;

  // Weapons
  private currentAmmo = 30;
  private maxAmmo = 30;
  private isReloading = false;
  private reloadTimeLeft = 0;
  private fireCooldown = 0;

  // Player coords and rotation
  private playerPos = new THREE.Vector3(0, 0, 8);
  private playerYaw = 0;
  private playerSpeed = 10.0;

  // Hierarchical limbs for walking animation
  private playerMesh!: THREE.Group;
  private playerLegL!: THREE.Object3D;
  private playerLegR!: THREE.Object3D;
  private playerArmL!: THREE.Object3D;
  private playerArmR!: THREE.Object3D;

  private gunMesh!: THREE.Group;
  private groundFloor!: THREE.Mesh;
  private zombies: Zombie[] = [];
  private bullets: Bullet[] = [];
  private walls: THREE.Mesh[] = [];

  // Muzzle flash pointlight
  private muzzleFlashLight!: THREE.PointLight;
  private muzzleTimer = 0;

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    onScore: (score: number) => void,
    onHealth: (health: number) => void,
    onStatus: (status: GameStatus) => void,
    settings: GameSettings,
    options?: { weaponType?: string }
  ) {
    this.container = container;
    this.canvas = canvas;
    this.onScore = onScore;
    this.onHealth = onHealth;
    this.onStatus = onStatus;
    this.settings = settings;

    if (options && options.weaponType) {
      this.weaponType = options.weaponType;
    }

    // Configure magazine/stats based on selected weapon system
    if (this.weaponType === 'plasma_rifle') {
      this.maxAmmo = 45;
    } else if (this.weaponType === 'scatter_shotgun') {
      this.maxAmmo = 8;
    } else if (this.weaponType === 'vortex_cannon') {
      this.maxAmmo = 15;
    }
    this.currentAmmo = this.maxAmmo;

    this.initScene();
    this.initLights();
    this.initArena();
    this.initPlayer();
    this.spawnWave(this.currentWave);
    this.animate(0);
  }

  private initScene() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    this.scene = THREE.Scene ? new THREE.Scene() : new (THREE as any).Scene();
    // Brighter steel-blue midnight theme instead of pitch black, yielding perfect visual depth
    this.scene.background = new THREE.Color(0x0a0e1a);
    this.scene.fog = new THREE.FogExp2(0x0a0e1a, 0.016);

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    // Overhead isometric shooter perspective
    this.camera.position.set(0, 25, 18);
    this.camera.lookAt(new THREE.Vector3(0, 0, -2));

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.settings.quality !== 'low',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    if (this.settings.shadows && this.settings.quality === 'high') {
      this.renderer.shadowMap.enabled = true;
    }
  }

  private initLights() {
    // Highly brightened ambient light for strong overall visibility
    const SpookyAmbient = new THREE.AmbientLight(0x22324f, 2.5);
    this.scene.add(SpookyAmbient);

    // Brilliant, high contrast cyan directional moon beam casting soft guidance on field
    const greenFlash = new THREE.DirectionalLight(0x0ea5e9, 2.6);
    greenFlash.position.set(-10, 30, 20);
    this.scene.add(greenFlash);

    // Dynamic muzzle flash light that turns on during shots
    this.muzzleFlashLight = new THREE.PointLight(0xffb900, 0, 15);
    this.muzzleFlashLight.position.set(0, 1.5, 0);
    this.scene.add(this.muzzleFlashLight);
  }

  private initArena() {
    // 64x64 floor
    const floorGeom = new THREE.PlaneGeometry(66, 66);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0c120f,
      roughness: 0.9,
    });
    this.groundFloor = new THREE.Mesh(floorGeom, floorMat);
    this.groundFloor.rotation.x = -Math.PI / 2;
    this.groundFloor.receiveShadow = true;
    this.scene.add(this.groundFloor);

    // Grid details on street lanes
    const gridHelper = new THREE.GridHelper(64, 32, 0x047857, 0x061c12);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);

    // --- PROCEDURAL SURROUNDING CITY BLOCKS ---
    const buildWallBorder = (x: number, z: number, w: number, d: number, name: string) => {
      const parentGroup = new THREE.Group();
      parentGroup.position.set(x, 0, z);

      // Main structural skyscraper block
      const h = 12 + Math.random() * 15;
      const buildingGeom = new THREE.BoxGeometry(w, h, d);
      const buildingMat = new THREE.MeshStandardMaterial({
        color: 0x111827,
        roughness: 0.6,
        metalness: 0.3,
      });
      const mainBlock = new THREE.Mesh(buildingGeom, buildingMat);
      mainBlock.position.y = h / 2;
      mainBlock.castShadow = true;
      mainBlock.receiveShadow = true;
      parentGroup.add(mainBlock);

      // Add windows with neon glow
      const winCols = Math.max(2, Math.floor(w / 2.5));
      const winRows = Math.max(3, Math.floor(h / 3.5));
      const winGeom = new THREE.PlaneGeometry(0.6, 0.9);
      const winGlowColor = Math.random() < 0.5 ? 0x10b981 : 0x06b6d4;
      const winMat = new THREE.MeshBasicMaterial({
        color: winGlowColor,
        side: THREE.DoubleSide
      });

      // Front facing windows (if facing inwards)
      for (let r = 0; r < winRows; r++) {
        for (let c = 0; c < winCols; c++) {
          if (Math.random() < 0.75) {
            const win = new THREE.Mesh(winGeom, winMat);
            const wx = (c - (winCols - 1) / 2) * (w / (winCols + 0.1));
            const wy = 2 + r * 3.0;
            // Align on frontage
            win.position.set(wx, wy, d / 2 + 0.05);
            parentGroup.add(win);
          }
        }
      }

      this.scene.add(parentGroup);

      // We add the physical block to the obstacles walls group to prevent passing
      const colliderGeom = new THREE.BoxGeometry(w, 4, d);
      const colliderMesh = new THREE.Mesh(colliderGeom, buildingMat);
      colliderMesh.position.set(x, 2, z);
      this.walls.push(colliderMesh);
    };

    // Construct perimeter skyline (serves as the boundary walls)
    // Left boundary skyline blocks (X = -32)
    for (let z = -30; z <= 30; z += 12) {
      buildWallBorder(-32.5, z, 8, 10, 'buildingL');
    }
    // Right boundary skyline blocks (X = +32)
    for (let z = -30; z <= 30; z += 12) {
      buildWallBorder(32.5, z, 8, 10, 'buildingR');
    }
    // Deep back wall blocks (Z = -32)
    for (let x = -24; x <= 24; x += 12) {
      buildWallBorder(x, -32.5, 10, 8, 'buildingB');
    }
    // Front edge boundary block wall (Z = +32)
    for (let x = -24; x <= 24; x += 12) {
      buildWallBorder(x, 32.5, 10, 8, 'buildingF');
    }

    // --- SCENIC TOXIC FLOWING SEWER RIVER ---
    const riverGeom = new THREE.BoxGeometry(64, 0.2, 5.0);
    const riverMat = new THREE.MeshStandardMaterial({
      color: 0x059669,
      emissive: 0x10b981,
      emissiveIntensity: 1.2,
      roughness: 0.1,
    });
    const river = new THREE.Mesh(riverGeom, riverMat);
    river.position.set(0, 0.04, -12); // river crossing at Z = -12
    this.scene.add(river);

    // Concrete Bridge for safety crossing over toxic channel
    const bridgeGeom = new THREE.BoxGeometry(8.0, 0.35, 6.0);
    const bridgeMat = new THREE.MeshStandardMaterial({
      color: 0x3f3f46,
      roughness: 0.8,
    });
    const bridge = new THREE.Mesh(bridgeGeom, bridgeMat);
    bridge.position.set(0, 0.18, -12);
    bridge.receiveShadow = true;
    this.scene.add(bridge);

    // Obstacle blocking river sides
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x111827 });
    const rFenceL = new THREE.Mesh(new THREE.BoxGeometry(28, 1.2, 0.4), fenceMat);
    rFenceL.position.set(-18, 0.6, -12);
    this.scene.add(rFenceL);
    this.walls.push(rFenceL);

    const rFenceR = new THREE.Mesh(new THREE.BoxGeometry(28, 1.2, 0.4), fenceMat);
    rFenceR.position.set(18, 0.6, -12);
    this.scene.add(rFenceR);
    this.walls.push(rFenceR);

    // --- STREET LAMPS WHICH CAST ACTUAL LIGHTS ---
    const createStreetLamp = (x: number, z: number) => {
      const lampGroup = new THREE.Group();
      lampGroup.position.set(x, 0, z);

      // Pole
      const poleGeom = new THREE.CylinderGeometry(0.12, 0.12, 6.0, 6);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.3 });
      const pole = new THREE.Mesh(poleGeom, poleMat);
      pole.position.y = 3.0;
      lampGroup.add(pole);

      // Neck
      const neckGeom = new THREE.BoxGeometry(1.2, 0.2, 0.2);
      const neck = new THREE.Mesh(neckGeom, poleMat);
      neck.position.set(0.5, 6.0, 0);
      lampGroup.add(neck);

      // Lamp Head with glowing sphere
      const headGeom = new THREE.SphereGeometry(0.3, 8, 8);
      const headMat = new THREE.MeshBasicMaterial({ color: 0xffea00 });
      const head = new THREE.Mesh(headGeom, headMat);
      head.position.set(1.0, 5.8, 0);
      lampGroup.add(head);

      // Real Pointlight projecting on map
      const coneLight = new THREE.PointLight(0xffea00, 1.8, 16);
      coneLight.position.set(1.0, 5.5, 0);
      lampGroup.add(coneLight);

      this.scene.add(lampGroup);
    };

    createStreetLamp(-14, -4);
    createStreetLamp(14, 14);
    createStreetLamp(-14, 18);

    // --- PROCEDURAL DETAILED LANDSCAPE TREES ---
    const spawnPineTree = (x: number, z: number) => {
      const tree = new THREE.Group();
      tree.position.set(x, 0, z);

      // Trunk
      const trunkGeom = new THREE.CylinderGeometry(0.2, 0.35, 2.5, 5);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
      const trunk = new THREE.Mesh(trunkGeom, trunkMat);
      trunk.position.y = 1.25;
      trunk.castShadow = true;
      tree.add(trunk);

      // Layered foliage (cones stacked)
      const foliageMat = new THREE.MeshStandardMaterial({
        color: 0x065f46,
        roughness: 0.8,
      });

      for (let i = 0; i < 3; i++) {
        const rad = 1.4 - i * 0.35;
        const h = 1.5;
        const coneGeom = new THREE.ConeGeometry(rad, h, 6);
        const cone = new THREE.Mesh(coneGeom, foliageMat);
        cone.position.y = 2.5 + i * 1.1;
        cone.castShadow = true;
        tree.add(cone);
      }

      this.scene.add(tree);

      // Create a solid low-poly barrier for trees
      const barrierGeom = new THREE.BoxGeometry(1.2, 3.5, 1.2);
      const barrier = new THREE.Mesh(barrierGeom, trunkMat);
      barrier.position.set(x, 1.75, z);
      this.walls.push(barrier);
    };

    spawnPineTree(-20, 4);
    spawnPineTree(18, -4);
    spawnPineTree(-8, -20);
    spawnPineTree(24, 22);

    // --- PROCEDURAL DETAILED SPORTS CARS PLAYSTAGE OBSTACLES ---
    // Instead of simple boxes/crates, we place realistic sports cars parked around!
    const buildParkedCarObstacle = (x: number, z: number, yaw: number, colorHex: number) => {
      const carGroup = new THREE.Group();
      carGroup.position.set(x, 0, z);
      carGroup.rotation.y = yaw;

      // Chassis body
      const chassisGeom = new THREE.BoxGeometry(1.9, 0.5, 4.0);
      const chassisMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.2,
        metalness: 0.8,
      });
      const chassis = new THREE.Mesh(chassisGeom, chassisMat);
      chassis.position.y = 0.45;
      chassis.castShadow = true;
      chassis.receiveShadow = true;
      carGroup.add(chassis);

      // Cabin slope
      const cabinGeom = new THREE.BoxGeometry(1.6, 0.45, 2.0);
      const cabinMat = new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        roughness: 0.1,
        metalness: 0.9,
      });
      const cabin = new THREE.Mesh(cabinGeom, cabinMat);
      cabin.position.set(0, 0.85, -0.3);
      cabin.castShadow = true;
      carGroup.add(cabin);

      // Windshield glass
      const windshieldGeom = new THREE.BoxGeometry(1.5, 0.35, 0.2);
      const windshieldMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.65,
      });
      const windshield = new THREE.Mesh(windshieldGeom, windshieldMat);
      windshield.position.set(0, 0.85, 0.65);
      windshield.rotation.x = -Math.PI / 6;
      carGroup.add(windshield);

      // 4 wheels
      const wheelGeom = new THREE.CylinderGeometry(0.38, 0.38, 0.4, 8);
      wheelGeom.rotateZ(Math.PI / 2);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 });
      
      const wheelFL = new THREE.Mesh(wheelGeom, wheelMat);
      wheelFL.position.set(-1.0, 0.38, 1.25);
      carGroup.add(wheelFL);

      const wheelFR = new THREE.Mesh(wheelGeom, wheelMat);
      wheelFR.position.set(1.0, 0.38, 1.25);
      carGroup.add(wheelFR);

      const wheelRL = new THREE.Mesh(wheelGeom, wheelMat);
      wheelRL.position.set(-1.0, 0.38, -1.25);
      carGroup.add(wheelRL);

      const wheelRR = new THREE.Mesh(wheelGeom, wheelMat);
      wheelRR.position.set(1.0, 0.38, -1.25);
      carGroup.add(wheelRR);

      // Glowing headlights
      const hlGeom = new THREE.SphereGeometry(0.15, 6, 6);
      const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      
      const hlL = new THREE.Mesh(hlGeom, hlMat);
      hlL.position.set(-0.7, 0.5, 2.02);
      carGroup.add(hlL);

      const hlR = new THREE.Mesh(hlGeom, hlMat);
      hlR.position.set(0.7, 0.5, 2.02);
      carGroup.add(hlR);

      // Spoiler wing on the back
      const wingSupportGeom = new THREE.BoxGeometry(0.1, 0.4, 0.1);
      const wS1 = new THREE.Mesh(wingSupportGeom, wheelMat);
      wS1.position.set(-0.6, 0.7, -1.8);
      carGroup.add(wS1);

      const wS2 = new THREE.Mesh(wingSupportGeom, wheelMat);
      wS2.position.set(0.6, 0.7, -1.8);
      carGroup.add(wS2);

      const wingBladeGeom = new THREE.BoxGeometry(2.1, 0.08, 0.45);
      const blade = new THREE.Mesh(wingBladeGeom, chassisMat);
      blade.position.set(0, 0.9, -1.8);
      carGroup.add(blade);

      this.scene.add(carGroup);

      // Build physical box to block soldier traversal
      const colBoxGeom = new THREE.BoxGeometry(2.3, 1.8, 4.4);
      const colBox = new THREE.Mesh(colBoxGeom, chassisMat);
      colBox.position.set(x, 0.9, z);
      colBox.rotation.y = yaw;
      this.walls.push(colBox);
    };

    // Spawn parked sports car obstacles around the street
    buildParkedCarObstacle(-10, 4, Math.PI / 4, 0xd97706); // Amber sports car
    buildParkedCarObstacle(14, -4, -Math.PI / 3, 0xf43f5e); // Crimson sports car
    buildParkedCarObstacle(-16, 20, Math.PI / 2, 0x06b6d4); // Cyan coupe
    buildParkedCarObstacle(18, 14, -Math.PI / 6, 0x8b5cf6); // Violet tuner car
  }

  private initPlayer() {
    // --- HIGH-FIDELITY HUMANOID SOLDIER PLAYER MODEL ---
    this.playerMesh = new THREE.Group();

    // Chest/Torso armor panel
    const chestGeom = new THREE.BoxGeometry(0.85, 1.05, 0.55);
    const suitMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8, // deep military blue
      roughness: 0.4,
      metalness: 0.6,
    });
    const chest = new THREE.Mesh(chestGeom, suitMat);
    chest.position.y = 1.35;
    chest.castShadow = true;
    this.playerMesh.add(chest);

    // Tactical utility belt
    const beltGeom = new THREE.BoxGeometry(0.9, 0.15, 0.6);
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const belt = new THREE.Mesh(beltGeom, beltMat);
    belt.position.y = 0.85;
    this.playerMesh.add(belt);

    // Left sleeve / upper arm joint
    this.playerArmL = new THREE.Group();
    this.playerArmL.position.set(-0.55, 1.7, 0);
    const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), suitMat);
    this.playerArmL.add(shoulderL);
    
    const armLMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.6, 6), suitMat);
    armLMesh.position.y = -0.3;
    this.playerArmL.add(armLMesh);
    this.playerMesh.add(this.playerArmL);

    // Right sleeve joint (holding gun)
    this.playerArmR = new THREE.Group();
    this.playerArmR.position.set(0.55, 1.7, 0);
    const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), suitMat);
    this.playerArmR.add(shoulderR);

    const armRMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.6, 6), suitMat);
    armRMesh.position.y = -0.3;
    this.playerArmR.add(armRMesh);
    this.playerMesh.add(this.playerArmR);

    // Left Thigh & Leg joints
    this.playerLegL = new THREE.Group();
    this.playerLegL.position.set(-0.25, 0.75, 0);
    const hipL = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), beltMat);
    this.playerLegL.add(hipL);

    const limbL = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.75, 6), suitMat);
    limbL.position.y = -0.38;
    limbL.castShadow = true;
    this.playerLegL.add(limbL);

    const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.4), beltMat);
    bootL.position.set(0, -0.75, 0.08);
    this.playerLegL.add(bootL);
    this.playerMesh.add(this.playerLegL);

    // Right Thigh & Leg joints
    this.playerLegR = new THREE.Group();
    this.playerLegR.position.set(0.25, 0.75, 0);
    const hipR = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), beltMat);
    this.playerLegR.add(hipR);

    const limbR = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.75, 6), suitMat);
    limbR.position.y = -0.38;
    limbR.castShadow = true;
    this.playerLegR.add(limbR);

    const bootR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.4), beltMat);
    bootR.position.set(0, -0.75, 0.08);
    this.playerLegR.add(bootR);
    this.playerMesh.add(this.playerLegR);

    // Helmet & Visor Face model
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 2.05, 0);

    const helmGeom = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const helmMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.8 });
    const helm = new THREE.Mesh(helmGeom, helmMat);
    headGroup.add(helm);

    const visorGeom = new THREE.BoxGeometry(0.6, 0.14, 0.2);
    const visorMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const visor = new THREE.Mesh(visorGeom, visorMat);
    visor.position.set(0, 0.08, 0.24);
    headGroup.add(visor);
    this.playerMesh.add(headGroup);

    // --- DETAILED CUSTOM WEAPON HELD FORWARD ---
    this.gunMesh = new THREE.Group();
    this.gunMesh.position.set(0.38, 1.25, 0.55);

    if (this.weaponType === 'plasma_rifle') {
      // 1. NEON PLASMA RIFLE
      const gunStock = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.28, 0.85),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 })
      );
      this.gunMesh.add(gunStock);

      const barrelGeom = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6);
      barrelGeom.rotateX(Math.PI / 2);
      const barrel = new THREE.Mesh(
        barrelGeom,
        new THREE.MeshStandardMaterial({ color: 0x0ea5e9, metalness: 0.9 })
      );
      barrel.position.set(0, 0.04, 0.85);
      this.gunMesh.add(barrel);

      // Cyan scope
      const scopeGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.45, 6);
      scopeGeom.rotateX(Math.PI / 2);
      const scope = new THREE.Mesh(scopeGeom, new THREE.MeshStandardMaterial({ color: 0x0ea5e9 }));
      scope.position.set(0, 0.21, 0.0);
      this.gunMesh.add(scope);

      const lensGeom = new THREE.SphereGeometry(0.06, 6, 6);
      const lens = new THREE.Mesh(lensGeom, new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
      lens.position.set(0, 0, 0.24);
      scope.add(lens);

      const clip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.2), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
      clip.position.set(0, -0.3, 0.15);
      clip.rotation.x = -Math.PI / 10;
      this.gunMesh.add(clip);
    } else if (this.weaponType === 'scatter_shotgun') {
      // 2. RETRO DUAL-BARREL SHOTGUN
      const gunStock = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.32, 0.95),
        new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.9 }) // classic wooden stock
      );
      this.gunMesh.add(gunStock);

      // Two barrels parallel
      const barrelGeom = new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6);
      barrelGeom.rotateX(Math.PI / 2);
      const barrelL = new THREE.Mesh(barrelGeom, new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.95 }));
      barrelL.position.set(-0.06, 0.04, 0.85);
      this.gunMesh.add(barrelL);

      const barrelR = new THREE.Mesh(barrelGeom, new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.95 }));
      barrelR.position.set(0.06, 0.04, 0.85);
      this.gunMesh.add(barrelR);

      // Red scope
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x0f172a }));
      scope.position.set(0, 0.21, 0.0);
      scope.rotation.x = Math.PI / 2;
      this.gunMesh.add(scope);

      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: 0xf43f5e }));
      lens.position.set(0, 0, 0.22);
      scope.add(lens);
    } else {
      // 3. BRUTAL HEAVY VORTEX CANNON
      const gunStock = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.42, 1.05),
        new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.4, metalness: 0.8 })
      );
      this.gunMesh.add(gunStock);

      const giantBarrelGeom = new THREE.CylinderGeometry(0.12, 0.15, 1.0, 8);
      giantBarrelGeom.rotateX(Math.PI / 2);
      const barrel = new THREE.Mesh(giantBarrelGeom, new THREE.MeshStandardMaterial({ color: 0x581c87, metalness: 0.9 }));
      barrel.position.set(0, 0.06, 0.82);
      this.gunMesh.add(barrel);

      // Embedded pulsing purple energy core sphere inside generator
      const coreGeom = new THREE.SphereGeometry(0.18, 12, 12);
      const core = new THREE.Mesh(coreGeom, new THREE.MeshBasicMaterial({ color: 0xc084fc }));
      core.position.set(0, 0.06, 0.52);
      this.gunMesh.add(core);

      // Scope purple
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x3b0764 }));
      scope.position.set(0, 0.28, 0.0);
      scope.rotation.x = Math.PI / 2;
      this.gunMesh.add(scope);

      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
      lens.position.set(0, 0, 0.2);
      scope.add(lens);
    }

    this.playerMesh.add(this.gunMesh);

    this.playerMesh.position.copy(this.playerPos);
    this.scene.add(this.playerMesh);
  }

  private spawnWave(wave: number) {
    const spawnCount = 4 + wave * 3;

    for (let i = 0; i < spawnCount; i++) {
      // Spawn at perimeter boundaries
      const side = Math.floor(Math.random() * 4);
      let sx = 0, sz = 0;
      const margin = 24;

      if (side === 0) { sx = -margin + Math.random() * 5; sz = (Math.random() - 0.5) * margin * 2; }
      else if (side === 1) { sx = margin - Math.random() * 5; sz = (Math.random() - 0.5) * margin * 2; }
      else if (side === 2) { sz = -margin + Math.random() * 5; sx = (Math.random() - 0.5) * margin * 2; }
      else { sz = margin - Math.random() * 5; sx = (Math.random() - 0.5) * margin * 2; }

      // Don't spawn on top of bridges or inside water
      if (sz > -15 && sz < -9) {
        sz = -6; // adjust coordinate out of river
      }

      const isFast = Math.random() < 0.25;

      // Spooky Zombie Group (detailed Humanoid model)
      const zombieGroup = new THREE.Group();

      const suitColor = isFast ? 0xff0055 : 0x00ff88; // glowing hot ruby pink/red or toxic super neon green
      const skinColor = isFast ? 0x7a0c2e : 0x0d5736;

      const zombieMat = new THREE.MeshStandardMaterial({
        color: suitColor,
        roughness: 0.2,
        emissive: suitColor,
        emissiveIntensity: 0.45
      });
      const skinMat = new THREE.MeshStandardMaterial({
        color: skinColor,
        roughness: 0.4,
        emissive: skinColor,
        emissiveIntensity: 0.25
      });

      // Zombie decaying Chest
      const zChest = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.5), zombieMat);
      zChest.position.y = 1.3;
      zChest.castShadow = true;
      zombieGroup.add(zChest);

      // Limping legs
      const zLegL = new THREE.Group();
      zLegL.position.set(-0.25, 0.8, 0);
      const thighL = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.8, 6), zombieMat);
      thighL.position.y = -0.4;
      zLegL.add(thighL);
      zombieGroup.add(zLegL);

      const zLegR = new THREE.Group();
      zLegR.position.set(0.25, 0.8, 0);
      const thighR = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.8, 6), zombieMat);
      thighR.position.y = -0.4;
      zLegR.add(thighR);
      zombieGroup.add(zLegR);

      // Reaching zombie arms
      const zArmL = new THREE.Group();
      zArmL.position.set(-0.5, 1.6, 0.1);
      const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.8, 6), skinMat);
      armL.position.y = -0.4;
      zArmL.rotation.x = -Math.PI / 2; // extended forward spooky style!
      zArmL.add(armL);
      zombieGroup.add(zArmL);

      const zArmR = new THREE.Group();
      zArmR.position.set(0.5, 1.6, 0.1);
      const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.8, 6), skinMat);
      armR.position.y = -0.4;
      zArmR.rotation.x = -Math.PI / 2.2; 
      zArmR.add(armR);
      zombieGroup.add(zArmR);

      // Grotesque Decaying head
      const zHeadGroup = new THREE.Group();
      zHeadGroup.position.set(0, 1.95, 0);
      const zHead = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 8), skinMat);
      zHeadGroup.add(zHead);

      // Creepy glowing crimson eyes
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 4, 4), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
      eyeL.position.set(-0.16, 0.08, 0.3);
      zHeadGroup.add(eyeL);

      const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 4, 4), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
      eyeR.position.set(0.16, 0.08, 0.3);
      zHeadGroup.add(eyeR);

      zombieGroup.add(zHeadGroup);

      zombieGroup.position.set(sx, 0, sz);
      this.scene.add(zombieGroup);

      this.zombies.push({
        mesh: zombieGroup,
        legL: zLegL,
        legR: zLegR,
        armL: zArmL,
        armR: zArmR,
        head: zHeadGroup,
        zombieType: isFast ? 'fast' : 'normal',
        health: isFast ? 50 : 100,
        maxHealth: isFast ? 50 : 100,
        speed: isFast ? 4.2 : 2.2, // speed upgrades
        damage: isFast ? 15 : 10,
        scoreReward: isFast ? 300 : 100,
        isHitFlashing: 0,
      });
    }
  }

  public move(vx: number, vz: number, delta: number) {
    if (this.status !== 'PLAYING') return;

    // Movement vectors
    const moveVector = new THREE.Vector3(vx, 0, vz).normalize();
    const nextPos = this.playerPos.clone().addScaledVector(moveVector, this.playerSpeed * delta);

    // Collision check against cover obstacles and boundary buildings
    let collides = false;
    for (const w of this.walls) {
      const boxSize = w.geometry.boundingBox ? w.geometry.boundingBox.getSize(new THREE.Vector3()) : new THREE.Vector3(2.5, 2.5, 4.5);
      const dX = Math.abs(nextPos.x - w.position.x);
      const dZ = Math.abs(nextPos.z - w.position.z);

      if (dX < (boxSize.x / 2 + 0.6) && dZ < (boxSize.z / 2 + 0.6)) {
        collides = true;
        break;
      }
    }

    // River limits: Do NOT allow falling in river except where the bridge is!
    // River crosses at Z = [-14.5, -9.5] (river coordinate is -12)
    const onBridgeX = nextPos.x > -4.5 && nextPos.x < 4.5;
    const inRiverY = nextPos.z > -14.5 && nextPos.z < -9.5;
    if (inRiverY && !onBridgeX) {
      collides = true; // Block drowning in hazardous toxic waste
    }

    if (!collides) {
      if (nextPos.x > -29.0 && nextPos.x < 29.0) this.playerPos.x = nextPos.x;
      if (nextPos.z > -29.0 && nextPos.z < 29.0) this.playerPos.z = nextPos.z;
    }

    this.playerMesh.position.copy(this.playerPos);

    // --- HUMANOID WALKING LIMBS MOTION ANIMATION ---
    const isMoving = (vx !== 0 || vz !== 0);
    if (isMoving) {
      const walkCycle = Math.sin(this.timeElapsed * 15);
      this.playerLegL.rotation.x = walkCycle * 0.7;
      this.playerLegR.rotation.x = -walkCycle * 0.7;

      this.playerArmL.rotation.x = -walkCycle * 0.5;
      this.playerArmR.rotation.x = walkCycle * 0.3; // gun shifts nicely
    } else {
      // Revert limbs posture
      this.playerLegL.rotation.x = 0;
      this.playerLegR.rotation.x = 0;
      this.playerArmL.rotation.x = 0;
      this.playerArmR.rotation.x = 0;
    }
  }

  // Updates cursor direction lookAt
  public updateAimAngle(headingX: number, headingZ: number) {
    if (this.status !== 'PLAYING') return;
    this.playerYaw = Math.atan2(headingX, headingZ);
    this.playerMesh.rotation.y = this.playerYaw;
  }

  public fireBullet() {
    if (this.status !== 'PLAYING') return;
    if (this.isReloading) return;
    if (this.fireCooldown > 0) return;
    if (this.currentAmmo <= 0) {
      this.reload();
      return;
    }

    this.currentAmmo--;

    // Choose cooldown & properties based on active tech weapon class
    let cooldownValue = 0.20;
    if (this.weaponType === 'plasma_rifle') {
      cooldownValue = 0.13;
    } else if (this.weaponType === 'scatter_shotgun') {
      cooldownValue = 0.65;
    } else if (this.weaponType === 'vortex_cannon') {
      cooldownValue = 0.45;
    }
    this.fireCooldown = cooldownValue;

    // Compute barrel tip relative position to scene
    const barrelDir = new THREE.Vector3(Math.sin(this.playerYaw), 0, Math.cos(this.playerYaw)).normalize();
    const tipPos = this.playerPos.clone().add(barrelDir.clone().setLength(1.8));
    tipPos.y = 1.35;

    // Muzzle flash color feedback based on weapon
    let flashColor = 0xffb900;
    if (this.weaponType === 'plasma_rifle') flashColor = 0x22d3ee;
    else if (this.weaponType === 'vortex_cannon') flashColor = 0xc084fc;
    else if (this.weaponType === 'scatter_shotgun') flashColor = 0xf43f5e;

    this.muzzleFlashLight.color.setHex(flashColor);

    if (this.weaponType === 'scatter_shotgun') {
      // 5-bullet shotgun diverging spread system
      const spreadAngles = [-0.15, -0.075, 0, 0.075, 0.15];
      spreadAngles.forEach((angleOffset) => {
        const bulletYaw = this.playerYaw + angleOffset;
        const spreadDir = new THREE.Vector3(Math.sin(bulletYaw), 0, Math.cos(bulletYaw)).normalize();

        const pelletGeom = new THREE.BoxGeometry(0.12, 0.12, 0.25);
        const pelletMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
        const pMesh = new THREE.Mesh(pelletGeom, pelletMat);
        pMesh.position.copy(tipPos);
        pMesh.rotation.y = bulletYaw;
        this.scene.add(pMesh);

        this.bullets.push({
          mesh: pMesh,
          velocity: spreadDir.multiplyScalar(45.0),
          lifespan: 750, // shorter range shotgun pellets
          damage: 24
        });
      });
    } else if (this.weaponType === 'vortex_cannon') {
      // Slow-moving, heavy orbital purple plasma sphere
      const sphereGeom = new THREE.SphereGeometry(0.35, 8, 8);
      const sphereMat = new THREE.MeshBasicMaterial({ color: 0xc084fc });
      const bMesh = new THREE.Mesh(sphereGeom, sphereMat);
      bMesh.position.copy(tipPos);
      bMesh.rotation.y = this.playerYaw;
      this.scene.add(bMesh);

      this.bullets.push({
        mesh: bMesh,
        velocity: barrelDir.multiplyScalar(22.0), // slower heavy projectile
        lifespan: 2000, // longer lifespan
        isVortex: true,
        damage: 85
      });
    } else {
      // Neon plasma rapid burst rifle
      const bulletGeom = new THREE.BoxGeometry(0.1, 0.1, 0.7);
      const bulletMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
      const bMesh = new THREE.Mesh(bulletGeom, bulletMat);
      bMesh.position.copy(tipPos);
      bMesh.rotation.y = this.playerYaw;
      this.scene.add(bMesh);

      this.bullets.push({
        mesh: bMesh,
        velocity: barrelDir.multiplyScalar(55.0),
        lifespan: 1400,
        damage: 38
      });
    }

    // Muzzle flash feedback
    this.muzzleFlashLight.position.copy(tipPos);
    this.muzzleFlashLight.intensity = 5;
    this.muzzleTimer = 0.05; // 50ms flash
  }

  public reload() {
    if (this.status !== 'PLAYING') return;
    if (this.isReloading || this.currentAmmo === this.maxAmmo) return;

    this.isReloading = true;
    this.reloadTimeLeft = 1.3; // 1.3s reload delay
  }

  private lastTime = 0;
  private animate = (time: number) => {
    if (this.status === 'GAMEOVER') return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    const delta = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    this.tick(delta);
    this.render();
  };

  private tick(delta: number) {
    if (this.status !== 'PLAYING') return;

    this.timeElapsed += delta;

    // Fire cool-down clocks
    if (this.fireCooldown > 0) {
      this.fireCooldown -= delta;
    }

    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= delta;
      if (this.muzzleTimer <= 0) {
        this.muzzleFlashLight.intensity = 0;
      }
    }

    // Weapons reloading clock
    if (this.isReloading) {
      this.reloadTimeLeft -= delta;
      if (this.reloadTimeLeft <= 0) {
        this.currentAmmo = this.maxAmmo;
        this.isReloading = false;
      }
    }

    // Process Projectiles
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.lifespan -= delta * 1000;
      b.mesh.position.addScaledVector(b.velocity, delta);

      // Check wall collider crash
      let bHitWall = false;
      for (const w of this.walls) {
        const boxSize = w.geometry.boundingBox ? w.geometry.boundingBox.getSize(new THREE.Vector3()) : new THREE.Vector3(2.5,2.5,4.5);
        const distX = Math.abs(b.mesh.position.x - w.position.x);
        const distZ = Math.abs(b.mesh.position.z - w.position.z);
        
        if (distX < (boxSize.x / 2 + 0.15) && distZ < (boxSize.z / 2 + 0.15)) {
          bHitWall = true;
          break;
        }
      }

      if (b.lifespan <= 0 || bHitWall) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
        continue;
      }

      // Check bullet overlap with zombies
      let hitRegistered = false;
      for (let j = this.zombies.length - 1; j >= 0; j--) {
        const z = this.zombies[j];
        const distToZ = b.mesh.position.distanceTo(z.mesh.position);

        if (distToZ < 1.4) {
          hitRegistered = true;
          const bulletDmg = b.damage || 38;

          if (b.isVortex) {
            // Create a gorgeous visual shockwave expansion sphere
            const boomGeom = new THREE.SphereGeometry(1.5, 12, 12);
            const boomMat = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.85 });
            const boom = new THREE.Mesh(boomGeom, boomMat);
            boom.position.copy(b.mesh.position);
            this.scene.add(boom);

            // Animate growing wave effect and cleanup
            let scaleTime = 0;
            const animateWave = () => {
              scaleTime += 0.05;
              boom.scale.addScalar(0.4);
              (boom.material as THREE.MeshBasicMaterial).opacity -= 0.12;
              if (scaleTime < 0.4) {
                requestAnimationFrame(animateWave);
              } else {
                this.scene.remove(boom);
              }
            };
            animateWave();

            // Scurry splash damage across all entities in splash radius
            for (let k = this.zombies.length - 1; k >= 0; k--) {
              const otherZ = this.zombies[k];
              const splashDist = b.mesh.position.distanceTo(otherZ.mesh.position);
              
              if (splashDist <= 5.0) {
                otherZ.health -= bulletDmg;
                otherZ.isHitFlashing = 0.15;
                this.setMeshColorRecursive(otherZ.mesh, 0xff0000);

                if (otherZ.health <= 0) {
                  this.scene.remove(otherZ.mesh);
                  this.zombies.splice(k, 1);
                  this.killCount++;
                  this.score += otherZ.scoreReward;
                  this.onScore(this.score);
                }
              }
            }
          } else {
            // Standard point-impact weapon hit
            z.health -= bulletDmg;
            z.isHitFlashing = 0.12;
            this.setMeshColorRecursive(z.mesh, 0xff0000);

            if (z.health <= 0) {
              this.scene.remove(z.mesh);
              this.zombies.splice(j, 1);
              this.killCount++;
              this.score += z.scoreReward;
              this.onScore(this.score);
            }
          }
          break;
        }
      }

      if (hitRegistered) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }

    // Wave status check: if all zombies are dead, raise wave difficulty!
    if (this.zombies.length === 0) {
      this.currentWave++;
      this.spawnWave(this.currentWave);
    }

    // Process Zombies pathfinding
    this.zombies.forEach((z) => {
      // Vector pointing to player
      const pathToward = this.playerPos.clone().sub(z.mesh.position);
      pathToward.y = 0; // maintain height
      const angle = Math.atan2(pathToward.x, pathToward.z);
      z.mesh.rotation.y = angle;

      pathToward.normalize();

      // Step zombie positions forward (limping)
      z.mesh.position.addScaledVector(pathToward, z.speed * delta);

      // --- ZOMBIE LIMBS DRAGGING ANIMATION ---
      const zSpeedFactor = z.zombieType === 'fast' ? 22 : 11;
      const dragCycle = Math.sin(this.timeElapsed * zSpeedFactor);
      z.legL.rotation.x = dragCycle * 0.45;
      z.legR.rotation.x = -dragCycle * 0.45;
      z.head.rotation.z = Math.sin(this.timeElapsed * 4) * 0.12; // wobbling spooky head

      // Handle hit flash reset
      if (z.isHitFlashing > 0) {
        z.isHitFlashing -= delta;
        if (z.isHitFlashing <= 0) {
          // revert zombie color
          const defaultColor = z.zombieType === 'fast' ? 0xff0055 : 0x00ff88;
          this.setMeshColorRecursive(z.mesh, defaultColor);
        }
      }

      // Damage player if they touch
      const distToPlayer = z.mesh.position.distanceTo(this.playerPos);
      if (distToPlayer < 1.35) {
        this.health = Math.max(0, this.health - z.damage * delta * 2.0);
        this.onHealth(Math.ceil(this.health));

        if (this.health <= 0) {
          this.gameOver();
        }
      }
    });

    // Camera locks over player smoothly
    const lookTargetX = this.playerPos.x;
    const lookTargetZ = this.playerPos.z + 11.5; // offset isometric look
    
    this.camera.position.x += (lookTargetX - this.camera.position.x) * 5 * delta;
    this.camera.position.z += (lookTargetZ - this.camera.position.z) * 5 * delta;
    this.camera.lookAt(new THREE.Vector3(this.playerPos.x, 0.5, this.playerPos.z - 1.5));
  }

  private setMeshColorRecursive(mesh: THREE.Object3D, colorVal: number) {
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material && 'color' in child.material) {
          (child.material as any).color.setHex(colorVal);
        }
      }
    });
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  private gameOver() {
    this.status = 'GAMEOVER';
    this.onStatus('GAMEOVER');
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  public getAmmoInfo(): string {
    return this.isReloading ? 'RELOADING...' : `${this.currentAmmo} / ${this.maxAmmo}`;
  }

  public getWaveHeader(): string {
    return `Wave ${this.currentWave}`;
  }

  public resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public pause() {
    this.status = 'PAUSED';
    this.onStatus('PAUSED');
  }

  public resume() {
    this.status = 'PLAYING';
    this.onStatus('PLAYING');
    this.lastTime = performance.now();
    this.animate(this.lastTime);
  }

  public destroy() {
    this.status = 'GAMEOVER';
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.scene.clear();
    this.renderer.dispose();
  }
}
