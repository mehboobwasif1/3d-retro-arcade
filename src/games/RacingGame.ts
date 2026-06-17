import * as THREE from 'three';
import { GameSettings, GameStatus } from '../types';

interface AICar {
  mesh: THREE.Group;
  wheels: THREE.Object3D[];
  color: number;
  progress: number; // Parametric progress around track (0 to 2*Math.PI)
  speed: number;
  laneOffset: number; // Left/right offset from center spline
}

export class RacingGame {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private onScore: (score: number) => void;
  private onHealth: (health: number) => void; // Used for "Nitro Fuel" in UI
  private onStatus: (status: GameStatus) => void;
  private settings: GameSettings;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private animationFrameId: number | null = null;

  // Car stats
  private position = new THREE.Vector3(70, 0.45, 0); // Start position on the track
  private velocity = new THREE.Vector3(0, 0, 0);
  private yaw = Math.PI / 2; // Facing angle pointing along track forward (north-ish at start)
  private speed = 0;
  private carAccel = 32;
  private carLimitSpeed = 48;
  private friction = 0.96;
  private driftSlippage = 0.92; // Slide factor

  // Nitrous fuel gauge
  private nitroCapacity = 100;
  private nitroActive = false;

  // Elapsed timings
  private timeElapsed = 0;

  // Track geometry and progress
  private trackWidth = 14;
  private checkLapPassed = false;
  private currentLap = 1;
  private totalLaps = 3;
  private trackRadiusX = 74;
  private trackRadiusZ = 46;

  // Game state
  private status: GameStatus = 'PLAYING';

  // Objects
  private playerMesh!: THREE.Group;
  private playerWheels: THREE.Object3D[] = [];
  private playerSteerWheels: THREE.Object3D[] = [];
  private aiCars: AICar[] = [];
  private trackBorderInner!: THREE.LineLoop;
  private trackBorderOuter!: THREE.LineLoop;
  private pylonCones: THREE.Mesh[] = [];

  // Scenery environments
  private oceanSea!: THREE.Mesh;
  private walls: THREE.Mesh[] = [];

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    onScore: (score: number) => void,
    onHealth: (health: number) => void, // Proxied to Nitro bar
    onStatus: (status: GameStatus) => void,
    settings: GameSettings
  ) {
    this.container = container;
    this.canvas = canvas;
    this.onScore = onScore;
    this.onHealth = onHealth; // Representing nitro meter
    this.onStatus = onStatus;
    this.settings = settings;

    this.initScene();
    this.initLights();
    this.initTrack();
    this.initPlayer();
    this.initAI();
    this.initLandscape();
    this.animate(0);
  }

  private initScene() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    this.scene = THREE.Scene ? new THREE.Scene() : new (THREE as any).Scene();
    this.scene.background = new THREE.Color(0x02010c);
    this.scene.fog = new THREE.FogExp2(0x02010c, 0.007);

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(70, 10, 20);

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
    const amb = new THREE.AmbientLight(0x0f112e, 1.6);
    this.scene.add(amb);

    const dir = new THREE.DirectionalLight(0x00f2ff, 1.8);
    dir.position.set(20, 60, 40);
    this.scene.add(dir);

    // Glowing track lamps (point lights along the oval)
    const points = [
      new THREE.Vector3(75, 4, 0),
      new THREE.Vector3(-75, 4, 0),
      new THREE.Vector3(0, 4, 46),
      new THREE.Vector3(0, 4, -46),
    ];
    points.forEach((p, idx) => {
      const col = idx % 2 === 0 ? 0xff00b7 : 0x00ffff;
      const pl = new THREE.PointLight(col, 2.5, 75);
      pl.position.copy(p);
      this.scene.add(pl);
    });
  }

  private initTrack() {
    const segments = 120;
    const outerPoints: THREE.Vector3[][] = [[], []]; // 0=inner, 1=outer

    // Draw an elliptical boundary
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;

      // Inner boundary coords
      const ix = (this.trackRadiusX - this.trackWidth / 2) * Math.cos(theta);
      const iz = (this.trackRadiusZ - this.trackWidth / 2) * Math.sin(theta);
      outerPoints[0].push(new THREE.Vector3(ix, 0.08, iz));

      // Outer boundary coords
      const ox = (this.trackRadiusX + this.trackWidth / 2) * Math.cos(theta);
      const oz = (this.trackRadiusZ + this.trackWidth / 2) * Math.sin(theta);
      outerPoints[1].push(new THREE.Vector3(ox, 0.08, oz));
    }

    // Generate neon border line loops
    const innerGeom = new THREE.BufferGeometry().setFromPoints(outerPoints[0]);
    const innerMat = new THREE.LineBasicMaterial({ color: 0xff00ff });
    this.trackBorderInner = new THREE.LineLoop(innerGeom, innerMat);
    this.scene.add(this.trackBorderInner);

    const outerGeom = new THREE.BufferGeometry().setFromPoints(outerPoints[1]);
    const outerMat = new THREE.LineBasicMaterial({ color: 0x00ffff });
    this.trackBorderOuter = new THREE.LineLoop(outerGeom, outerMat);
    this.scene.add(this.trackBorderOuter);

    // Track asphalt mesh plane floor center
    const roadRingGeom = new THREE.RingGeometry(this.trackRadiusZ - 1, this.trackRadiusX + 8, segments);
    roadRingGeom.rotateX(-Math.PI / 2);
    roadRingGeom.scale(1.0, 1.0, this.trackRadiusZ / this.trackRadiusX);

    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x090a14,
      roughness: 0.75,
      metalness: 0.3,
    });
    const roadMesh = new THREE.Mesh(roadRingGeom, roadMat);
    roadMesh.position.y = 0.02;
    this.scene.add(roadMesh);

    // Spawn cone hazards on racetrack lanes
    for (let i = 0; i < 18; i++) {
      const theta = (i / 18) * Math.PI * 2 + 0.15;
      const rx = this.trackRadiusX * Math.cos(theta) + (Math.random() - 0.5) * 5;
      const rz = this.trackRadiusZ * Math.sin(theta) + (Math.random() - 0.5) * 5;

      const coneGeom = new THREE.ConeGeometry(0.35, 0.8, 6);
      const coneMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xd97706,
        emissiveIntensity: 0.8,
      });
      const cone = new THREE.Mesh(coneGeom, coneMat);
      cone.position.set(rx, 0.4, rz);
      this.scene.add(cone);
      this.pylonCones.push(cone);
    }
  }

  // --- PROCEDURAL REAL CAR BUILDER ---
  private buildDetailedCar(colorHex: number, isPlayer: boolean): { group: THREE.Group, wheels: THREE.Object3D[], steers: THREE.Object3D[] } {
    const carGroup = new THREE.Group();

    // 1. Lower streamlined underchassis
    const subChassisGeom = new THREE.BoxGeometry(1.6, 0.2, 3.4);
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8, metalness: 0.2 });
    const subChassis = new THREE.Mesh(subChassisGeom, darkMat);
    subChassis.position.y = 0.15;
    carGroup.add(subChassis);

    // 2. Streamlined hood/wedge fuselage body
    const bodyGeom = new THREE.BoxGeometry(1.5, 0.4, 1.8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.15,
      metalness: 0.85,
    });
    const mainBody = new THREE.Mesh(bodyGeom, bodyMat);
    mainBody.position.set(0, 0.45, -0.3); // back-centered body
    mainBody.castShadow = true;
    carGroup.add(mainBody);

    // Sloped nose front hood
    const noseGeom = new THREE.BoxGeometry(1.48, 0.25, 1.2);
    const nose = new THREE.Mesh(noseGeom, bodyMat);
    nose.position.set(0, 0.35, 1.1); // extended forward
    nose.rotation.x = -Math.PI / 16; // sloped down nose
    carGroup.add(nose);

    // 3. Cabin cockpit canopy with glass windows
    const cabGeom = new THREE.BoxGeometry(0.9, 0.4, 1.0);
    const glassMat = new THREE.MeshStandardMaterial({
      color: isPlayer ? 0x06b6d4 : 0x0f172a,
      roughness: 0.05,
      metalness: 0.95,
      transparent: true,
      opacity: 0.7,
    });
    const cockpit = new THREE.Mesh(cabGeom, glassMat);
    cockpit.position.set(0, 0.75, -0.2);
    carGroup.add(cockpit);

    // Windshield
    const windshieldGeom = new THREE.BoxGeometry(0.85, 0.35, 0.1);
    const windshield = new THREE.Mesh(windshieldGeom, glassMat);
    windshield.position.set(0, 0.7, 0.35);
    windshield.rotation.x = -Math.PI / 6;
    carGroup.add(windshield);

    // 4. Aerodynamic Rear wing spoiler
    const wingSupportL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.1), darkMat);
    wingSupportL.position.set(-0.6, 0.65, -1.3);
    carGroup.add(wingSupportL);

    const wingSupportR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.1), darkMat);
    wingSupportR.position.set(0.6, 0.65, -1.3);
    carGroup.add(wingSupportR);

    // Big neon spoiler wing blade
    const bladeGeom = new THREE.BoxGeometry(1.9, 0.08, 0.5);
    const neonMat = new THREE.MeshStandardMaterial({ color: isPlayer ? 0xff00aa : 0x00ffff, emissive: isPlayer ? 0xff00a0 : 0x00ffff, emissiveIntensity: 1.0 });
    const spoilerBlade = new THREE.Mesh(bladeGeom, neonMat);
    spoilerBlade.position.set(0, 0.9, -1.3);
    carGroup.add(spoilerBlade);

    // 5. Dual Exhaust Mufflers
    const exhaustGeom = new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8);
    exhaustGeom.rotateX(Math.PI / 2);
    const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.9, roughness: 0.1 });
    
    const exhaustL = new THREE.Mesh(exhaustGeom, exhaustMat);
    exhaustL.position.set(-0.35, 0.15, -1.75);
    carGroup.add(exhaustL);

    const exhaustR = new THREE.Mesh(exhaustGeom, exhaustMat);
    exhaustR.position.set(0.35, 0.15, -1.75);
    carGroup.add(exhaustR);

    // 6. Glowing white headlights
    const lightGeom = new THREE.BoxGeometry(0.25, 0.1, 0.1);
    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const headlightL = new THREE.Mesh(lightGeom, highlightMat);
    headlightL.position.set(-0.55, 0.35, 1.72);
    carGroup.add(headlightL);

    const headlightR = new THREE.Mesh(lightGeom, highlightMat);
    headlightR.position.set(0.55, 0.35, 1.72);
    carGroup.add(headlightR);

    // Rear glowing red taillights
    const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const taillight = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.1), redLightMat);
    taillight.position.set(0, 0.45, -1.25);
    carGroup.add(taillight);

    // 7. Cylindrical tires placement (4 wheels)
    const wheelsList: THREE.Object3D[] = [];
    const steerWheelsList: THREE.Object3D[] = [];

    const wheelTireGeom = new THREE.CylinderGeometry(0.42, 0.42, 0.45, 10);
    wheelTireGeom.rotateZ(Math.PI / 2); // align wheel axial spin
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.9 });
    
    // Front steerable wheels are placed inside pivot groups
    const makeFrontSteeringWheel = (xOffset: number, zOffset: number) => {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(xOffset, 0.35, zOffset);
      
      const wheelMesh = new THREE.Mesh(wheelTireGeom, tireMat);
      wheelMesh.castShadow = true;
      steerPivot.add(wheelMesh);
      carGroup.add(steerPivot);

      wheelsList.push(wheelMesh);
      steerWheelsList.push(steerPivot);
    };

    makeFrontSteeringWheel(-0.95, 1.1);  // FL
    makeFrontSteeringWheel(0.95, 1.1);   // FR

    // Rear stationary wheels
    const makeRearStationaryWheel = (xOffset: number, rOffset: number) => {
      const wheelMesh = new THREE.Mesh(wheelTireGeom, tireMat);
      wheelMesh.position.set(xOffset, 0.35, rOffset);
      wheelMesh.castShadow = true;
      carGroup.add(wheelMesh);
      wheelsList.push(wheelMesh);
    };

    makeRearStationaryWheel(-0.95, -1.1); // RL
    makeRearStationaryWheel(0.95, -1.1);  // RR

    return { group: carGroup, wheels: wheelsList, steers: steerWheelsList };
  }

  private initPlayer() {
    const carDetails = this.buildDetailedCar(0x06b6d4, true); // Player Cyan Sports Car
    this.playerMesh = carDetails.group;
    this.playerWheels = carDetails.wheels;
    this.playerSteerWheels = carDetails.steers;

    this.playerMesh.position.copy(this.position);
    this.scene.add(this.playerMesh);
  }

  private initAI() {
    const colors = [0xff0066, 0xd946ef, 0x8b5cf6];
    const keyways = [-3.8, 0, 3.8]; // AI lanes offset

    for (let i = 0; i < 3; i++) {
      const aiCarDetails = this.buildDetailedCar(colors[i], false);
      const aiMesh = aiCarDetails.group;

      // Spaced positions backward on start grid line
      const initialProgress = -0.12 * (i + 1);
      aiMesh.position.set(
        (this.trackRadiusX + keyways[i]) * Math.cos(initialProgress),
        0.45,
        (this.trackRadiusZ + keyways[i]) * Math.sin(initialProgress)
      );
      this.scene.add(aiMesh);

      this.aiCars.push({
        mesh: aiMesh,
        wheels: aiCarDetails.wheels,
        color: colors[i],
        progress: initialProgress,
        speed: 12.0 + i * 2.5, // varied speeds
        laneOffset: keyways[i],
      });
    }
  }

  private initLandscape() {
    // --- VAST AMBIENT COASTAL OCEAN SEA PLANE ---
    // Make racetrack sit on a cool island surrounded by water!
    const oceanGeom = new THREE.PlaneGeometry(1200, 1000, 24, 24);
    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x051d38,
      roughness: 0.1,
      metalness: 0.9,
    });
    this.oceanSea = new THREE.Mesh(oceanGeom, oceanMat);
    this.oceanSea.rotation.x = -Math.PI / 2;
    this.oceanSea.position.y = -0.2; // sea level is below racetrack concrete
    this.scene.add(this.oceanSea);

    // Sandy Shore Island terrain bed
    const islandGeom = new THREE.PlaneGeometry(280, 180);
    const islandMat = new THREE.MeshStandardMaterial({
      color: 0x070c14,
      roughness: 0.9,
    });
    const island = new THREE.Mesh(islandGeom, islandMat);
    island.rotation.x = -Math.PI / 2;
    island.position.y = -0.05;
    this.scene.add(island);

    // --- PROCEDURAL SCI-FI SPECTATOR GRANDSTANDS ---
    const standGroup = new THREE.Group();
    standGroup.position.set(0, 0, -56); // positioned alongside start line oval corridor

    const baseGeom = new THREE.BoxGeometry(40, 4.0, 6.0);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.7 });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = 2.0;
    standGroup.add(base);

    // Neon grandstand columns/canopy roof
    const roofGeom = new THREE.BoxGeometry(42, 0.4, 7.0);
    const neonRoofMat = new THREE.MeshStandardMaterial({ color: 0x111827, emissive: 0xff00aa, emissiveIntensity: 0.4 });
    const roof = new THREE.Mesh(roofGeom, neonRoofMat);
    roof.position.set(0, 7.0, 0);
    standGroup.add(roof);

    const pillarsGeom = new THREE.CylinderGeometry(0.12, 0.12, 5.0, 6);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    
    const p1 = new THREE.Mesh(pillarsGeom, pillarMat);
    p1.position.set(-18, 4.5, 2.5);
    standGroup.add(p1);

    const p2 = new THREE.Mesh(pillarsGeom, pillarMat);
    p2.position.set(18, 4.5, 2.5);
    standGroup.add(p2);

    this.scene.add(standGroup);

    // Add solid boundaries at Grandstand coordinates
    const standObstacle = new THREE.Mesh(new THREE.BoxGeometry(42, 6, 8), baseMat);
    standObstacle.position.set(0, 3, -58);
    this.walls.push(standObstacle);

    // --- SCENIC SHORELINE TROPICAL TREES ---
    const spawnPalmTree = (x: number, z: number) => {
      const tree = new THREE.Group();
      tree.position.set(x, 0, z);

      // Slanted high trunk cylinder
      const trunkGeom = new THREE.CylinderGeometry(0.15, 0.24, 5.0, 5);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.9 });
      const trunk = new THREE.Mesh(trunkGeom, trunkMat);
      trunk.position.y = 2.5;
      trunk.rotation.z = (Math.random() - 0.5) * 0.25; // slant
      tree.add(trunk);

      // Palm leaf foliage clusters (using small overlapping spheres)
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x047857, roughness: 0.6 });
      for (let j = 0; j < 5; j++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.65, 6, 6), leafMat);
        const angle = (j / 5) * Math.PI * 2;
        leaf.position.set(Math.cos(angle) * 1.1, 4.8, Math.sin(angle) * 1.1);
        tree.add(leaf);
      }

      this.scene.add(tree);

      // Simple collision peg for palm tree
      const peg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 0.8), trunkMat);
      peg.position.set(x, 2, z);
      this.walls.push(peg);
    };

    // Plant seaside palm trees around the borders
    spawnPalmTree(40, -15);
    spawnPalmTree(-40, 15);
    spawnPalmTree(50, 48);
    spawnPalmTree(-50, -48);
    spawnPalmTree(0, 18);
    spawnPalmTree(12, -22);

    // --- BACKGROUND METROPOLIS NEON SKYLINE ---
    const spawnSkyscraperNode = (x: number, z: number, rSize: number, h: number, colGlow: number) => {
      const towerParent = new THREE.Group();
      towerParent.position.set(x, 0, z);

      const buildGeom = new THREE.BoxGeometry(rSize, h, rSize);
      const buildMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.8 });
      const mainBox = new THREE.Mesh(buildGeom, buildMat);
      mainBox.position.y = h / 2;
      towerParent.add(mainBox);

      // Glowing communications needle on top of tower
      const needleGeom = new THREE.CylinderGeometry(0.04, 0.1, 6, 4);
      const needleMat = new THREE.MeshBasicMaterial({ color: colGlow });
      const needle = new THREE.Mesh(needleGeom, needleMat);
      needle.position.set(0, h + 3, 0);
      towerParent.add(needle);

      // Add actual point beacon light
      const beacon = new THREE.PointLight(colGlow, 1.2, 30);
      beacon.position.set(0, h + 5, 0);
      towerParent.add(beacon);

      this.scene.add(towerParent);
    };

    // Add futuristic background city towers in distances
    spawnSkyscraperNode(-110, -50, 18, 55, 0xec4899);
    spawnSkyscraperNode(-120, 20, 15, 45, 0x06b6d4);
    spawnSkyscraperNode(110, -75, 20, 60, 0x8b5cf6);
    spawnSkyscraperNode(130, -10, 16, 50, 0x10b981);
  }

  public accelerate() {
    if (this.status !== 'PLAYING') return;
    const accelScale = this.nitroActive ? this.carAccel * 2.2 : this.carAccel;
    const speedCap = this.nitroActive ? this.carLimitSpeed * 1.5 : this.carLimitSpeed;
    this.speed = Math.min(this.speed + accelScale * 0.02, speedCap);
  }

  public brake() {
    if (this.status !== 'PLAYING') return;
    this.speed = Math.max(this.speed - this.carAccel * 0.04, -10.0);
  }

  public steerLeft() {
    if (this.status !== 'PLAYING') return;
    const yawAngle = 2.4 * (1.1 - Math.min(Math.abs(this.speed) / this.carLimitSpeed, 0.5));
    this.yaw += yawAngle * 0.015;

    // Turn front steering-knuckle wheels mesh left and bank car slightly
    this.playerSteerWheels.forEach(p => {
      p.rotation.y = 0.35; // yaw front tires inward
    });
    this.playerMesh.rotation.z = -0.06;
  }

  public steerRight() {
    if (this.status !== 'PLAYING') return;
    const yawAngle = 2.4 * (1.1 - Math.min(Math.abs(this.speed) / this.carLimitSpeed, 0.5));
    this.yaw -= yawAngle * 0.015;

    this.playerSteerWheels.forEach(p => {
      p.rotation.y = -0.35; // yaw front tires outward
    });
    this.playerMesh.rotation.z = 0.06;
  }

  public triggerNitro(active: boolean) {
    if (this.status !== 'PLAYING') return;
    if (active && this.nitroCapacity > 5) {
      this.nitroActive = true;
    } else {
      this.nitroActive = false;
    }
  }

  private lastTime = 0;
  private animate = (time: number) => {
    if (this.status === 'GAMEOVER' || this.status === 'VICTORY') return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    const delta = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    this.tick(delta);
    this.render();
  };

  private tick(delta: number) {
    if (this.status !== 'PLAYING') return;

    this.timeElapsed += delta;

    // Simulate animated wavy Sea waves using vertex transformations approximations (mesh changes context)
    if (this.oceanSea) {
      this.oceanSea.position.y = -0.2 + Math.sin(this.timeElapsed * 1.2) * 0.08;
    }

    // Incremental race score calculations proportional to speed
    if (Math.abs(this.speed) > 1.0) {
      this.onScore(Math.floor(this.currentLap * 1000 + (this.speed * 2)));
    }

    // Nitro capacity discharge/charge loop
    if (this.nitroActive) {
      this.nitroCapacity = Math.max(0, this.nitroCapacity - 35 * delta);
      this.onHealth(this.nitroCapacity);
      if (this.nitroCapacity <= 0) {
         this.nitroActive = false;
      }
    } else {
      this.nitroCapacity = Math.min(100, this.nitroCapacity + 5 * delta);
      this.onHealth(this.nitroCapacity);
    }

    // Drag / friction deceleration
    this.speed *= this.friction;

    // Yaw heading vector integration
    const headingX = Math.sin(this.yaw);
    const headingZ = Math.cos(this.yaw);

    // Drifting velocity slips lagging behind cockpit orientation heading
    const targetVelX = headingX * this.speed;
    const targetVelZ = headingZ * this.speed;

    this.velocity.x += (targetVelX - this.velocity.x) * this.driftSlippage * 12 * delta;
    this.velocity.z += (targetVelZ - this.velocity.z) * this.driftSlippage * 12 * delta;

    this.position.addScaledVector(this.velocity, delta);
    this.playerMesh.position.copy(this.position);
    this.playerMesh.rotation.y = this.yaw;

    // Reset front wheel steering yaw/banking back to straight configuration smoothly if no steering keys active
    const steerPivotWheelsActive = (this.playerSteerWheels[0] && this.playerSteerWheels[0].rotation.y !== 0);
    if (steerPivotWheelsActive) {
      this.playerSteerWheels.forEach(p => {
        p.rotation.y += (0 - p.rotation.y) * 8 * delta;
      });
      this.playerMesh.rotation.z += (0 - this.playerMesh.rotation.z) * 8 * delta;
    }

    // --- ACCELERATING WHEELS SPIN MESHES ---
    const rotationIncrement = this.speed * 1.5 * delta;
    this.playerWheels.forEach(w => {
      w.rotation.x += rotationIncrement; // rotate around local wheel axle!
    });

    // Check boundary limitations
    this.constrainPlayerToTrack(delta);

    // Check pylon barriers collisions
    this.pylonCones.forEach((cone) => {
      const dist = this.position.distanceTo(cone.position);
      if (dist < 1.6) {
        this.speed *= 0.45; // slowdown
        cone.position.x += Math.cos(this.yaw) * 4 * delta;
        cone.position.z += Math.sin(this.yaw) * 4 * delta;
      }
    });

    // Check Lap progress crossings
    const angle = Math.atan2(this.position.z, this.position.x);

    // Checkpoint pass: at theta ~= PI opposite corner
    if (angle > 2.8 || angle < -2.8) {
      this.checkLapPassed = true;
    }

    // Finish line (theta ~= 0, X=74, Z=0)
    if (this.checkLapPassed && angle > -0.2 && angle < 0.2) {
      this.checkLapPassed = false;
      this.currentLap++;
      if (this.currentLap > this.totalLaps) {
        this.victory();
      }
    }

    // Process AI moves & spin AI wheels
    this.aiCars.forEach((ai) => {
      const currentRadius = this.trackRadiusX + ai.laneOffset;
      const progressDelta = (ai.speed / currentRadius) * delta;
      ai.progress += progressDelta;

      const tx = (this.trackRadiusX + ai.laneOffset) * Math.cos(ai.progress);
      const tz = (this.trackRadiusZ + ai.laneOffset) * Math.sin(ai.progress);
      ai.mesh.position.set(tx, 0.45, tz);

      const tangentX = -Math.sin(ai.progress);
      const tangentZ = Math.cos(ai.progress);
      ai.mesh.rotation.y = Math.atan2(tangentX, tangentZ);

      // Spin AI tyres
      const rotationIncrementAI = ai.speed * 1.5 * delta;
      ai.wheels.forEach(w => {
        w.rotation.x += rotationIncrementAI;
      });
    });

    // Camera follow behind player smoothly
    const backLength = this.nitroActive ? 12 : 9.5;
    const heightOffset = this.nitroActive ? 5.8 : 4.4;

    const camTargetX = this.position.x - headingX * backLength;
    const camTargetZ = this.position.z - headingZ * backLength;
    const camTargetY = this.position.y + heightOffset;

    this.camera.position.x += (camTargetX - this.camera.position.x) * 6 * delta;
    this.camera.position.z += (camTargetZ - this.camera.position.z) * 6 * delta;
    this.camera.position.y += (camTargetY - this.camera.position.y) * 6 * delta;

    const lookTarget = this.position.clone().add(new THREE.Vector3(headingX * 6, 0.8, headingZ * 6));
    this.camera.lookAt(lookTarget);
  }

  private constrainPlayerToTrack(delta: number) {
    const thetaPlayer = Math.atan2(this.position.z, this.position.x);

    // Ideal centerline point
    const idealcX = this.trackRadiusX * Math.cos(thetaPlayer);
    const idealcZ = this.trackRadiusZ * Math.sin(thetaPlayer);
    const idealCenterPos = new THREE.Vector3(idealcX, 0.45, idealcZ);

    const distFromCenterline = this.position.distanceTo(idealCenterPos);

    const halfWidth = this.trackWidth / 2 - 1.2;
    if (distFromCenterline > halfWidth) {
      const directionToCenter = idealCenterPos.clone().sub(this.position).normalize();
      const bounceOff = distFromCenterline - halfWidth;
      
      this.position.addScaledVector(directionToCenter, bounceOff);
      this.playerMesh.position.copy(this.position);

      this.speed *= 0.9; // speed hit
    }
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  private victory() {
    this.status = 'VICTORY';
    this.onStatus('VICTORY');
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  public getLapInfo(): string {
    return `Lap ${Math.min(this.currentLap, this.totalLaps)} / ${this.totalLaps}`;
  }

  public getSpeed(): number {
    return Math.floor(Math.abs(this.speed) * 3);
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
