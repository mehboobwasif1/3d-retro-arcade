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

  // Configuration options
  private carModel = 'cyber_coupe';
  private landscapeTheme = 'tropical';
  private sirenMaterials: THREE.MeshBasicMaterial[] = [];

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    onScore: (score: number) => void,
    onHealth: (health: number) => void, // Proxied to Nitro bar
    onStatus: (status: GameStatus) => void,
    settings: GameSettings,
    options?: { carModel?: string; landscapeTheme?: string }
  ) {
    this.container = container;
    this.canvas = canvas;
    this.onScore = onScore;
    this.onHealth = onHealth; // Representing nitro meter
    this.onStatus = onStatus;
    this.settings = settings;

    if (options) {
      if (options.carModel) this.carModel = options.carModel;
      if (options.landscapeTheme) this.landscapeTheme = options.landscapeTheme;
    }

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

    // Dynamically choose background and fog colors based on theme for maximum visual pop
    let bgColor = 0x02010c; // default dark futuristic twilight
    let fogDensity = 0.007;

    if (this.landscapeTheme === 'wasteland') {
      bgColor = 0x120305; // deep crimson volcanic ash
      fogDensity = 0.009;
    } else if (this.landscapeTheme === 'desert') {
      bgColor = 0x221307; // bright dust canyon twilight
      fogDensity = 0.008;
    } else if (this.landscapeTheme === 'cybercity') {
      bgColor = 0x03010b; // deep electric night city
      fogDensity = 0.006;
    }

    this.scene.background = new THREE.Color(bgColor);
    this.scene.fog = new THREE.FogExp2(bgColor, fogDensity);

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
    // Brighter ambient light to boost color contrast dramatically
    let ambColor = 0x42468f;
    let dirColor = 0x00f2ff;
    let ambIntensity = 3.5; 
    let dirIntensity = 3.2;

    if (this.landscapeTheme === 'wasteland') {
      ambColor = 0x7a3033;
      dirColor = 0xf97316; // molten orange primary direct light
      ambIntensity = 3.6;
    } else if (this.landscapeTheme === 'desert') {
      ambColor = 0x805432;
      dirColor = 0xfbbf24; // golden desert sun
      ambIntensity = 3.8;
    } else if (this.landscapeTheme === 'cybercity') {
      ambColor = 0x50358a;
      dirColor = 0xec4899; // vibrant magenta cyberlight
      ambIntensity = 3.6;
    }

    const amb = new THREE.AmbientLight(ambColor, ambIntensity);
    this.scene.add(amb);

    const dir = new THREE.DirectionalLight(dirColor, dirIntensity);
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
      let col = idx % 2 === 0 ? 0xff00b7 : 0x00ffff;
      if (this.landscapeTheme === 'wasteland') {
        col = idx % 2 === 0 ? 0xff3700 : 0xffaa00;
      } else if (this.landscapeTheme === 'desert') {
        col = idx % 2 === 0 ? 0xeab308 : 0xf97316;
      } else if (this.landscapeTheme === 'cybercity') {
        col = idx % 2 === 0 ? 0xf43f5e : 0xa855f7;
      }
      const pl = new THREE.PointLight(col, 3.5, 85);
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

    // Configure theme neon line colors
    let innerLineColor = 0xff00ff;
    let outerLineColor = 0x00ffff;

    if (this.landscapeTheme === 'wasteland') {
      innerLineColor = 0xffaa00;
      outerLineColor = 0xff3a00;
    } else if (this.landscapeTheme === 'desert') {
      innerLineColor = 0xeab308;
      outerLineColor = 0xd97706;
    } else if (this.landscapeTheme === 'cybercity') {
      innerLineColor = 0x22d3ee;
      outerLineColor = 0xec4899;
    }

    // Generate neon border line loops
    const innerGeom = new THREE.BufferGeometry().setFromPoints(outerPoints[0]);
    const innerMat = new THREE.LineBasicMaterial({ color: innerLineColor });
    this.trackBorderInner = new THREE.LineLoop(innerGeom, innerMat);
    this.scene.add(this.trackBorderInner);

    const outerGeom = new THREE.BufferGeometry().setFromPoints(outerPoints[1]);
    const outerMat = new THREE.LineBasicMaterial({ color: outerLineColor });
    this.trackBorderOuter = new THREE.LineLoop(outerGeom, outerMat);
    this.scene.add(this.trackBorderOuter);

    // Track asphalt mesh plane floor center
    const roadRingGeom = new THREE.RingGeometry(this.trackRadiusZ - 1, this.trackRadiusX + 8, segments);
    roadRingGeom.rotateX(-Math.PI / 2);
    roadRingGeom.scale(1.0, 1.0, this.trackRadiusZ / this.trackRadiusX);

    // Brighter ashphalt base for maximum lane guidance and contrast
    let asphaltColor = 0x090a14;
    if (this.landscapeTheme === 'wasteland') {
      asphaltColor = 0x16131c;
    } else if (this.landscapeTheme === 'desert') {
      asphaltColor = 0x1b1411;
    } else if (this.landscapeTheme === 'cybercity') {
      asphaltColor = 0x0b0a1d;
    }

    const roadMat = new THREE.MeshStandardMaterial({
      color: asphaltColor,
      roughness: 0.65,
      metalness: 0.4,
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
      let coneCol = 0xfacc15;
      let emCol = 0xd97706;

      if (this.landscapeTheme === 'wasteland') {
        coneCol = 0xff4444;
        emCol = 0x990000;
      } else if (this.landscapeTheme === 'cybercity') {
        coneCol = 0xee44ff;
        emCol = 0xbb00aa;
      }

      const coneMat = new THREE.MeshStandardMaterial({
        color: coneCol,
        emissive: emCol,
        emissiveIntensity: 1.0,
      });
      const cone = new THREE.Mesh(coneGeom, coneMat);
      cone.position.set(rx, 0.4, rz);
      this.scene.add(cone);
      this.pylonCones.push(cone);
    }
  }

  // --- PROCEDURAL RE-DEFINED MULTI-MODEL SPORTS CAR BUILDER ---
  private buildDetailedCar(colorHex: number, isPlayer: boolean): { group: THREE.Group, wheels: THREE.Object3D[], steers: THREE.Object3D[] } {
    const carGroup = new THREE.Group();
    const modelStyle = isPlayer ? this.carModel : 'cyber_coupe';

    const paintMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.12,
      metalness: 0.88,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8, metalness: 0.2 });

    const wheelsList: THREE.Object3D[] = [];
    const steerWheelsList: THREE.Object3D[] = [];

    // Base tire geometry and material definitions
    let tireRadius = 0.42;
    let tireWidth = 0.45;
    let wheelOffsetZ = 1.1;
    let wheelOffsetX = 0.95;

    if (modelStyle === 'retro_truck') {
      tireRadius = 0.56;
      tireWidth = 0.52;
      wheelOffsetZ = 1.15;
      wheelOffsetX = 1.0;
    }

    const wheelTireGeom = new THREE.CylinderGeometry(tireRadius, tireRadius, tireWidth, 12);
    wheelTireGeom.rotateZ(Math.PI / 2); // align wheel axial spin
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181e, roughness: 0.95 });

    if (modelStyle === 'neon_f1') {
      // ==========================================
      // OPTION 1: NEON FORMULA 1 HYPER RACER
      // ==========================================
      
      // Central needle body monocoque
      const monocoqueGeom = new THREE.BoxGeometry(0.75, 0.36, 3.5);
      const f1Body = new THREE.Mesh(monocoqueGeom, paintMat);
      f1Body.position.y = 0.3;
      carGroup.add(f1Body);

      // Pointy front nose-cone
      const noseConeGeom = new THREE.ConeGeometry(0.35, 1.2, 5);
      noseConeGeom.rotateX(Math.PI / 2);
      const noseCone = new THREE.Mesh(noseConeGeom, paintMat);
      noseCone.position.set(0, 0.22, 1.8);
      noseCone.scale.set(1.0, 0.5, 1.0);
      carGroup.add(noseCone);

      // Driver Cockpit Pod with halo
      const cockpitHelmetGeom = new THREE.SphereGeometry(0.24, 8, 8);
      const helmetMat = new THREE.MeshBasicMaterial({ color: 0xffea00 });
      const helmet = new THREE.Mesh(cockpitHelmetGeom, helmetMat);
      helmet.position.set(0, 0.58, -0.1);
      carGroup.add(helmet);

      const haloGeom = new THREE.TorusGeometry(0.32, 0.08, 6, 12);
      haloGeom.rotateX(Math.PI / 2);
      const halo = new THREE.Mesh(haloGeom, darkMat);
      halo.position.set(0, 0.48, 0.1);
      carGroup.add(halo);

      // Huge formula forward wings
      const fWingGeom = new THREE.BoxGeometry(1.9, 0.06, 0.45);
      const fWing = new THREE.Mesh(fWingGeom, paintMat);
      fWing.position.set(0, 0.16, 2.1);
      carGroup.add(fWing);

      // Massive F1 Double-Wing Rear Spoiler
      const rearPoleL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.08), darkMat);
      rearPoleL.position.set(-0.35, 0.65, -1.4);
      carGroup.add(rearPoleL);

      const rearPoleR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.08), darkMat);
      rearPoleR.position.set(0.35, 0.65, -1.4);
      carGroup.add(rearPoleR);

      const f1BladeGeom = new THREE.BoxGeometry(1.8, 0.08, 0.65);
      const f1BladeMat = new THREE.MeshStandardMaterial({ 
        color: isPlayer ? 0xffea00 : colorHex, 
        emissive: isPlayer ? 0xffea00 : colorHex, 
        emissiveIntensity: 1.2 
      });
      const f1Spoiler = new THREE.Mesh(f1BladeGeom, f1BladeMat);
      f1Spoiler.position.set(0, 1.05, -1.4);
      carGroup.add(f1Spoiler);

      // Side Pods intakes
      const podGeom = new THREE.BoxGeometry(0.38, 0.38, 1.25);
      
      const podL = new THREE.Mesh(podGeom, paintMat);
      podL.position.set(-0.55, 0.3, 0.15);
      carGroup.add(podL);

      const podR = new THREE.Mesh(podGeom, paintMat);
      podR.position.set(0.55, 0.3, 0.15);
      carGroup.add(podR);

    } else if (modelStyle === 'retro_truck') {
      // ==========================================
      // OPTION 2: RUGGED CYBER RETRO TRUCK
      // ==========================================

      // Tall armored blocky chassis
      const truckTruckGeom = new THREE.BoxGeometry(1.65, 0.55, 3.45);
      const truckChassis = new THREE.Mesh(truckTruckGeom, paintMat);
      truckChassis.position.y = 0.55;
      truckChassis.castShadow = true;
      carGroup.add(truckChassis);

      // Elevated Crew boxy cabin
      const cabGeom = new THREE.BoxGeometry(1.48, 0.68, 1.6);
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        roughness: 0.05,
        metalness: 0.9,
        transparent: true,
        opacity: 0.7,
      });
      const cabinObj = new THREE.Mesh(cabGeom, paintMat);
      cabinObj.position.set(0, 1.12, 0.05);
      carGroup.add(cabinObj);

      const winGeom = new THREE.BoxGeometry(1.36, 0.42, 1.35);
      const winObj = new THREE.Mesh(winGeom, glassMat);
      winObj.position.set(0, 1.2, 0.1);
      carGroup.add(winObj);

      // Open back truck bed
      const bedWallLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.9), paintMat);
      bedWallLeft.position.set(-0.76, 1.0, -1.1);
      carGroup.add(bedWallLeft);

      const bedWallRight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.9), paintMat);
      bedWallRight.position.set(0.76, 1.0, -1.1);
      carGroup.add(bedWallRight);

      // Roof Mounted LED Light bar rack
      const rackMat = new THREE.MeshBasicMaterial({ color: 0x00f2ff });
      const lightRack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.15), rackMat);
      lightRack.position.set(0, 1.5, 0.45);
      carGroup.add(lightRack);

    } else if (modelStyle === 'police_intercept') {
      // ==========================================
      // OPTION 3: FUTURISTIC HIGH-PURSUIT INTERCEPTOR
      // ==========================================

      // Heavy muscular base
      const interceptorBase = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 3.4), paintMat);
      interceptorBase.position.y = 0.25;
      carGroup.add(interceptorBase);

      // Aggressive front steel push guards (black rails)
      const pushBar = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.64, 0.18), darkMat);
      pushBar.position.set(0, 0.45, 1.76);
      carGroup.add(pushBar);

      // Canopy
      const canopyGeom = new THREE.BoxGeometry(1.2, 0.48, 1.75);
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0x111822,
        roughness: 0.1,
        metalness: 0.9,
      });
      const canopyObj = new THREE.Mesh(canopyGeom, glassMat);
      canopyObj.position.set(0, 0.68, -0.15);
      carGroup.add(canopyObj);

      // Police Decals on doors
      const decalL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 1.15), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      decalL.position.set(-0.81, 0.35, -0.1);
      carGroup.add(decalL);

      const decalR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 1.15), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      decalR.position.set(0.81, 0.35, -0.1);
      carGroup.add(decalR);

      // Siren base
      const sirenBase = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.22), darkMat);
      sirenBase.position.set(0, 0.95, -0.2);
      carGroup.add(sirenBase);

      // Red and blue flashing emergency sirens
      const redSirenMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const blueSirenMat = new THREE.MeshBasicMaterial({ color: 0x0000ff });

      const sirenL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.16), redSirenMat);
      sirenL.position.set(-0.2, 1.02, -0.2);
      carGroup.add(sirenL);

      const sirenR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.16), blueSirenMat);
      sirenR.position.set(0.2, 1.02, -0.2);
      carGroup.add(sirenR);

      // Save materials so we can flash them during tick cycles
      this.sirenMaterials.push(redSirenMat, blueSirenMat);

    } else {
      // ==========================================
      // STANDARD OPTION: CYBER COUPE (GLOW MODDED)
      // ==========================================
      const subChassisGeom = new THREE.BoxGeometry(1.6, 0.2, 3.4);
      const subChassis = new THREE.Mesh(subChassisGeom, darkMat);
      subChassis.position.y = 0.15;
      carGroup.add(subChassis);

      const bodyGeom = new THREE.BoxGeometry(1.5, 0.4, 1.8);
      const mainBody = new THREE.Mesh(bodyGeom, paintMat);
      mainBody.position.set(0, 0.45, -0.3); // back-centered body
      mainBody.castShadow = true;
      carGroup.add(mainBody);

      // Sloped nose front hood
      const noseGeom = new THREE.BoxGeometry(1.48, 0.25, 1.2);
      const nose = new THREE.Mesh(noseGeom, paintMat);
      nose.position.set(0, 0.35, 1.1); // extended forward
      nose.rotation.x = -Math.PI / 16;
      carGroup.add(nose);

      // Cabin cockpit canopy with glass windows
      const cabGeom = new THREE.BoxGeometry(0.9, 0.4, 1.0);
      const glassMat = new THREE.MeshStandardMaterial({
        color: isPlayer ? 0x22d3ee : 0x0f172a,
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

      // Aerodynamic Rear wing spoiler
      const wingSupportL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.1), darkMat);
      wingSupportL.position.set(-0.6, 0.65, -1.3);
      carGroup.add(wingSupportL);

      const wingSupportR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.1), darkMat);
      wingSupportR.position.set(0.6, 0.65, -1.3);
      carGroup.add(wingSupportR);

      // Big neon spoiler wing blade
      const spoilerBladeGeom = new THREE.BoxGeometry(1.9, 0.08, 0.5);
      const neonMat = new THREE.MeshStandardMaterial({ 
        color: isPlayer ? 0xff00aa : 0x00ffff, 
        emissive: isPlayer ? 0xff00a0 : 0x00ffff, 
        emissiveIntensity: 1.2 
      });
      const spoilerBlade = new THREE.Mesh(spoilerBladeGeom, neonMat);
      spoilerBlade.position.set(0, 0.9, -1.3);
      carGroup.add(spoilerBlade);

      // Modded neon glow lines underneath fenders (underglow cyan/purple)
      const underglowMat = new THREE.MeshBasicMaterial({ color: isPlayer ? 0x22d3ee : 0xff00aa });
      const bulbL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 2.0), underglowMat);
      bulbL.position.set(-0.75, 0.08, 0);
      carGroup.add(bulbL);

      const bulbR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 2.0), underglowMat);
      bulbR.position.set(0.75, 0.08, 0);
      carGroup.add(bulbR);
    }

    // ==========================================
    // DECORATIVE ENGINE PORT EXHAUSTS AND HEADLIGHTS
    // ==========================================
    
    // Dual Exhaust Mufflers at the rear
    const exhaustGeom = new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8);
    exhaustGeom.rotateX(Math.PI / 2);
    const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.9, roughness: 0.1 });
    
    const exhaustL = new THREE.Mesh(exhaustGeom, exhaustMat);
    exhaustL.position.set(-0.35, 0.15, -1.75);
    carGroup.add(exhaustL);

    const exhaustR = new THREE.Mesh(exhaustGeom, exhaustMat);
    exhaustR.position.set(0.35, 0.15, -1.75);
    carGroup.add(exhaustR);

    // Glowing white headlights
    const lightGeom = new THREE.BoxGeometry(0.25, 0.1, 0.1);
    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const headlightL = new THREE.Mesh(lightGeom, highlightMat);
    headlightL.position.set(-0.55, 0.35, 1.72);
    carGroup.add(headlightL);

    const headlightR = new THREE.Mesh(lightGeom, highlightMat);
    headlightR.position.set(0.55, 0.35, 1.72);
    carGroup.add(headlightR);

    // Rear glowing red taillights base
    const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const taillight = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.1), redLightMat);
    taillight.position.set(0, 0.45, -1.25);
    carGroup.add(taillight);

    // ==========================================
    // TIRES / WHEELS PLACEMENT
    // ==========================================
    
    // Front steerable pivot mounts
    const makeFrontSteeringWheel = (xOffset: number, zOffset: number) => {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(xOffset, tireRadius * 0.85, zOffset);
      
      const wheelMesh = new THREE.Mesh(wheelTireGeom, tireMat);
      wheelMesh.castShadow = true;
      steerPivot.add(wheelMesh);
      carGroup.add(steerPivot);

      wheelsList.push(wheelMesh);
      steerWheelsList.push(steerPivot);
    };

    makeFrontSteeringWheel(-wheelOffsetX, wheelOffsetZ);  // FL
    makeFrontSteeringWheel(wheelOffsetX, wheelOffsetZ);   // FR

    // Rear stationary mounts
    const makeRearStationaryWheel = (xOffset: number, zOffset: number) => {
      const wheelMesh = new THREE.Mesh(wheelTireGeom, tireMat);
      wheelMesh.position.set(xOffset, tireRadius * 0.85, zOffset);
      wheelMesh.castShadow = true;
      carGroup.add(wheelMesh);
      wheelsList.push(wheelMesh);
    };

    makeRearStationaryWheel(-wheelOffsetX, -wheelOffsetZ); // RL
    makeRearStationaryWheel(wheelOffsetX, -wheelOffsetZ);  // RR

    return { group: carGroup, wheels: wheelsList, steers: steerWheelsList };
  }

  private initPlayer() {
    // Player color choice based on customization or default vibrant cyan
    let carColor = 0x06b6d4;
    if (this.carModel === 'retro_truck') {
      carColor = 0xf59e0b; // rugged gold pickup
    } else if (this.carModel === 'police_intercept') {
      carColor = 0x1e293b; // dark interceptor armored plating
    } else if (this.carModel === 'neon_f1') {
      carColor = 0x10b981; // green racing monocoque F1
    }

    const carDetails = this.buildDetailedCar(carColor, true);
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
    // --- VAST AMBIENT COASTAL OCEAN OR FLUID LAVA PLANE ---
    //坐落在熔岩海、干沙或大都市底层的赛道
    const oceanGeom = new THREE.PlaneGeometry(1200, 1000, 16, 16);
    
    let oceanColor = 0x051d38; 
    let roughnessVal = 0.1;
    let emissiveColor = 0x000000;
    let emissiveIntensityVal = 0.0;

    if (this.landscapeTheme === 'wasteland') {
      oceanColor = 0xea580c; // boiling orange volcanic lava flow
      roughnessVal = 0.6;
      emissiveColor = 0xef4444; // glowing crimson heat
      emissiveIntensityVal = 1.3;
    } else if (this.landscapeTheme === 'desert') {
      oceanColor = 0xa16207; // dry dust clay lake-bed
      roughnessVal = 0.95;
    } else if (this.landscapeTheme === 'cybercity') {
      oceanColor = 0x0d0628;  // glowing cybernetic synth-grid ocean
      roughnessVal = 0.2;
      emissiveColor = 0x1e003c;
      emissiveIntensityVal = 0.4;
    }

    const oceanMat = new THREE.MeshStandardMaterial({
      color: oceanColor,
      roughness: roughnessVal,
      metalness: 0.8,
      emissive: emissiveColor,
      emissiveIntensity: emissiveIntensityVal
    });
    this.oceanSea = new THREE.Mesh(oceanGeom, oceanMat);
    this.oceanSea.rotation.x = -Math.PI / 2;
    this.oceanSea.position.y = -0.2; // sitting below racetrack concrete
    this.scene.add(this.oceanSea);

    // Central core Island terrain bed
    const islandGeom = new THREE.PlaneGeometry(280, 180);
    
    let islandColor = 0x070c14; // Default sand dunes dark beach
    if (this.landscapeTheme === 'wasteland') {
      islandColor = 0x090506; // dark burnt obsidian soil
    } else if (this.landscapeTheme === 'desert') {
      islandColor = 0xd97706; // sandy orange desert core
    } else if (this.landscapeTheme === 'cybercity') {
      islandColor = 0x080617; // grid plate base
    }

    const islandMat = new THREE.MeshStandardMaterial({
      color: islandColor,
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
    let neonColor = 0xff00aa;
    if (this.landscapeTheme === 'wasteland') {
      neonColor = 0xffea00;
    } else if (this.landscapeTheme === 'desert') {
      neonColor = 0xf97316;
    } else if (this.landscapeTheme === 'cybercity') {
      neonColor = 0x22d3ee;
    }

    const neonRoofMat = new THREE.MeshStandardMaterial({ color: 0x111827, emissive: neonColor, emissiveIntensity: 0.6 });
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

    // --- SCENIC SHORELINE NATURAL OBSTACLES OR NEON COLUMNS ---
    const spawnLandscapeMeshObject = (x: number, z: number) => {
      if (this.landscapeTheme === 'wasteland') {
        // ==========================================
        // VOLCANIC LAVA SPIRE
        // ==========================================
        const spireGroup = new THREE.Group();
        spireGroup.position.set(x, 0, z);

        const coreGeom = new THREE.ConeGeometry(1.5, 6.5, 4);
        const coreMat = new THREE.MeshStandardMaterial({ color: 0x090506, roughness: 0.9 });
        const core = new THREE.Mesh(coreGeom, coreMat);
        core.position.y = 3.25;
        spireGroup.add(core);

        // Blazing magma highlight bands
        const bandGeom = new THREE.TorusGeometry(0.8, 0.14, 4, 8);
        bandGeom.rotateX(Math.PI / 2);
        const bandMat = new THREE.MeshBasicMaterial({ color: 0xff3b00 });
        const band = new THREE.Mesh(bandGeom, bandMat);
        band.position.y = 2.0;
        spireGroup.add(band);

        this.scene.add(spireGroup);

        const barrierBox = new THREE.Mesh(new THREE.BoxGeometry(1.6, 5, 1.6), coreMat);
        barrierBox.position.set(x, 2.5, z);
        this.walls.push(barrierBox);

      } else if (this.landscapeTheme === 'desert') {
        // ==========================================
        // DESERT CANYON ROCK PILLARS
        // ==========================================
        const rockHeight = 7 + Math.random() * 8;
        const canyonGroup = new THREE.Group();
        canyonGroup.position.set(x, 0, z);

        const canyonRockGeom = new THREE.CylinderGeometry(1.4, 2.0, rockHeight, 5);
        const canyonRockMat = new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.95 });
        const core = new THREE.Mesh(canyonRockGeom, canyonRockMat);
        core.position.y = rockHeight / 2;
        canyonGroup.add(core);

        this.scene.add(canyonGroup);

        const barrierBox = new THREE.Mesh(new THREE.BoxGeometry(2.2, rockHeight, 2.2), canyonRockMat);
        barrierBox.position.set(x, rockHeight / 2, z);
        this.walls.push(barrierBox);

      } else if (this.landscapeTheme === 'cybercity') {
        // ==========================================
        // FUTURE CITY NEON UTILITY POLE
        // ==========================================
        const poleGroup = new THREE.Group();
        poleGroup.position.set(x, 0, z);

        const pillarCore = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 6.5, 6), pillarMat);
        pillarCore.position.y = 3.25;
        poleGroup.add(pillarCore);

        // Rotating horizontal cyber ring
        const ringGeom = new THREE.TorusGeometry(1.4, 0.08, 4, 6);
        ringGeom.rotateX(Math.PI / 2);
        const ringMat = new THREE.MeshStandardMaterial({ 
          color: 0x22d3ee, 
          emissive: 0x22d3ee, 
          emissiveIntensity: 1.0 
        });
        const meshRing = new THREE.Mesh(ringGeom, ringMat);
        meshRing.position.y = 4.5;
        poleGroup.add(meshRing);

        this.scene.add(poleGroup);

        const barrierBox = new THREE.Mesh(new THREE.BoxGeometry(0.8, 6.5, 0.8), pillarMat);
        barrierBox.position.set(x, 3.25, z);
        this.walls.push(barrierBox);

      } else {
        // ==========================================
        // DEFAULT TROPICAL PALM TREE
        // ==========================================
        const tree = new THREE.Group();
        tree.position.set(x, 0, z);

        const trunkGeom = new THREE.CylinderGeometry(0.15, 0.24, 5.0, 5);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.9 });
        const trunk = new THREE.Mesh(trunkGeom, trunkMat);
        trunk.position.y = 2.5;
        trunk.rotation.z = (Math.random() - 0.5) * 0.25; // slant
        tree.add(trunk);

        const leafMat = new THREE.MeshStandardMaterial({ color: 0x047857, roughness: 0.6 });
        for (let j = 0; j < 5; j++) {
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.65, 6, 6), leafMat);
          const angle = (j / 5) * Math.PI * 2;
          leaf.position.set(Math.cos(angle) * 1.1, 4.8, Math.sin(angle) * 1.1);
          tree.add(leaf);
        }

        this.scene.add(tree);

        const peg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 0.8), trunkMat);
        peg.position.set(x, 2, z);
        this.walls.push(peg);
      }
    };

    // Plant roadside elements around the borders
    spawnLandscapeMeshObject(40, -15);
    spawnLandscapeMeshObject(-40, 15);
    spawnLandscapeMeshObject(50, 48);
    spawnLandscapeMeshObject(-50, -48);
    spawnLandscapeMeshObject(0, 18);
    spawnLandscapeMeshObject(12, -22);

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

    // Add futuristic background city towers in distances based on colors
    let towerColor1 = 0xec4899;
    let towerColor2 = 0x06b6d4;
    let towerColor3 = 0x8b5cf6;
    let towerColor4 = 0x10b981;

    if (this.landscapeTheme === 'wasteland') {
      towerColor1 = 0xffa500;
      towerColor2 = 0xff3700;
      towerColor3 = 0x990000;
      towerColor4 = 0xffea00;
    } else if (this.landscapeTheme === 'desert') {
      towerColor1 = 0xd97706;
      towerColor2 = 0xeab308;
      towerColor3 = 0xf97316;
      towerColor4 = 0xca8a04;
    }

    spawnSkyscraperNode(-110, -50, 18, 55, towerColor1);
    spawnSkyscraperNode(-120, 20, 15, 45, towerColor2);
    spawnSkyscraperNode(110, -75, 20, 60, towerColor3);
    spawnSkyscraperNode(130, -10, 16, 50, towerColor4);
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

    // Siren lights flashing interpolation for police interceptor
    if (this.sirenMaterials.length >= 2) {
      const flash = Math.floor(this.timeElapsed * 11) % 2 === 0;
      this.sirenMaterials[0].color.setHex(flash ? 0xff0000 : 0x220000); // flashing red
      this.sirenMaterials[1].color.setHex(flash ? 0x000022 : 0x0000ff); // flashing blue
    }

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
