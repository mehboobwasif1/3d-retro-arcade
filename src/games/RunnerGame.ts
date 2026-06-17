import * as THREE from 'three';
import { GameSettings, GameStatus } from '../types';

export class RunnerGame {
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

  // Running speed levels
  private initialSpeed = 16.0;
  private currentSpeed = 16.0;
  private maxSpeed = 38.0;

  // Track lanes
  private lanes = [-3.8, 0, 3.8];
  private playerLane = 1; // Start in middle lane
  private targetPlayerX = 0;

  // Player jumping physics
  private playerY = 0;
  private playerVelocityY = 0;
  private gravity = 32.0;
  private jumpPower = 12.0;
  private isJumping = false;

  // Gameplay
  private score = 0;
  private health = 100;
  private status: GameStatus = 'PLAYING';
  private timeElapsed = 0;

  // Player hierarchical bones
  private playerMesh!: THREE.Group;
  private playerLegL!: THREE.Object3D;
  private playerLegR!: THREE.Object3D;
  private playerArmL!: THREE.Object3D;
  private playerArmR!: THREE.Object3D;

  private roadGroup!: THREE.Group;
  private roadLength = 90.0;

  // Obstacles, coins, powerups
  private obstacles: THREE.Mesh[] = [];
  private coins: THREE.Mesh[] = [];
  private magnetPowerUp: THREE.Mesh | null = null;
  private isMagnetActive = false;
  private magnetTimer = 0;

  // Infinite skyscrapers scrolling
  private sceneryNodes: THREE.Group[] = [];

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    onScore: (score: number) => void,
    onHealth: (health: number) => void,
    onStatus: (status: GameStatus) => void,
    settings: GameSettings
  ) {
    this.container = container;
    this.canvas = canvas;
    this.onScore = onScore;
    this.onHealth = onHealth;
    this.onStatus = onStatus;
    this.settings = settings;

    this.initScene();
    this.initLights();
    this.initWorld();
    this.initPlayer();
    this.initLandscape();
    this.animate(0);
  }

  private initScene() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    this.scene = THREE.Scene ? new THREE.Scene() : new (THREE as any).Scene();
    this.scene.background = new THREE.Color(0x020008);
    // Neon mist fog
    this.scene.fog = new THREE.FogExp2(0x020008, 0.012);

    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
    // Over-the-shoulder third person view
    this.camera.position.set(0, 4.2, 5.5);

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
    const spaceAmb = new THREE.AmbientLight(0x0b0417, 1.8);
    this.scene.add(spaceAmb);

    const keyFlash = new THREE.DirectionalLight(0xa855f7, 2.2);
    keyFlash.position.set(10, 20, 10);
    this.scene.add(keyFlash);

    const blueSpot = new THREE.PointLight(0x00f2ff, 4, 30);
    blueSpot.position.set(0, 6, -15);
    this.scene.add(blueSpot);
  }

  private initWorld() {
    this.roadGroup = new THREE.Group();
    this.scene.add(this.roadGroup);

    // Create seamless segments of cyber grid highway
    for (let i = 0; i < 3; i++) {
      this.createRoadSegment(-i * this.roadLength);
    }
  }

  private createRoadSegment(zOffset: number) {
    const sections = 40;
    const geom = new THREE.PlaneGeometry(14, this.roadLength, 1, sections);
    
    const mat = new THREE.MeshStandardMaterial({
      color: 0x060714,
      roughness: 0.7,
      metalness: 0.8,
    });

    const roadMesh = new THREE.Mesh(geom, mat);
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.set(0, 0, zOffset - this.roadLength / 2);
    roadMesh.receiveShadow = true;
    this.roadGroup.add(roadMesh);

    // Glowing pink highway guide borders
    const borderGeom = new THREE.BoxGeometry(0.35, 0.25, this.roadLength);
    const borderMat = new THREE.MeshStandardMaterial({
      color: 0xec4899,
      emissive: 0xdb2777,
      emissiveIntensity: 1.4,
    });

    const borderL = new THREE.Mesh(borderGeom, borderMat);
    borderL.position.set(-7.0, 0.12, zOffset - this.roadLength / 2);
    this.roadGroup.add(borderL);

    const borderR = new THREE.Mesh(borderGeom, borderMat);
    borderR.position.set(7.0, 0.12, zOffset - this.roadLength / 2);
    this.roadGroup.add(borderR);

    // Cyan lane division guides
    const dashedLineGeom = new THREE.BoxGeometry(0.08, 0.03, 5.0);
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 1.2,
    });

    for (let z = 0; z < this.roadLength; z += 12) {
      const dividerL = new THREE.Mesh(dashedLineGeom, lineMat);
      dividerL.position.set(-2.0, 0.02, zOffset - z);
      this.roadGroup.add(dividerL);

      const dividerR = new THREE.Mesh(dashedLineGeom, lineMat);
      dividerR.position.set(2.0, 0.02, zOffset - z);
      this.roadGroup.add(dividerR);
    }
  }

  // --- HIGH-FIDELITY HUMANOID CYBERNETIC SPRINT RUNNER ---
  private initPlayer() {
    this.playerMesh = new THREE.Group();

    // 1. Sleek metallic cybernetic Chest
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4, // Cyan nano shell suit
      roughness: 0.1,
      metalness: 0.9,
    });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.35), armorMat);
    chest.position.y = 1.0;
    chest.castShadow = true;
    this.playerMesh.add(chest);

    // 2. Helmet with brilliant glowing pink visor
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.5, 0);

    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), armorMat);
    headGroup.add(helm);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0xff00aa }));
    visor.position.set(0, 0.04, 0.2);
    headGroup.add(visor);
    this.playerMesh.add(headGroup);

    // 3. Segmented Arms
    this.playerArmL = new THREE.Group();
    this.playerArmL.position.set(-0.35, 1.25, 0);
    const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), blackMat);
    this.playerArmL.add(shoulderL);
    const sleeveL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.5, 6), armorMat);
    sleeveL.position.y = -0.22;
    this.playerArmL.add(sleeveL);
    this.playerMesh.add(this.playerArmL);

    this.playerArmR = new THREE.Group();
    this.playerArmR.position.set(0.35, 1.25, 0);
    const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), blackMat);
    this.playerArmR.add(shoulderR);
    const sleeveR = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.5, 6), armorMat);
    sleeveR.position.y = -0.22;
    this.playerArmR.add(sleeveR);
    this.playerMesh.add(this.playerArmR);

    // 4. Detailed joints legs
    this.playerLegL = new THREE.Group();
    this.playerLegL.position.set(-0.16, 0.65, 0);
    const hipL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), blackMat);
    this.playerLegL.add(hipL);
    const thighL = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.55, 6), armorMat);
    thighL.position.y = -0.25;
    this.playerLegL.add(thighL);
    const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.25), blackMat);
    bootL.position.set(0, -0.55, 0.04);
    this.playerLegL.add(bootL);
    this.playerMesh.add(this.playerLegL);

    this.playerLegR = new THREE.Group();
    this.playerLegR.position.set(0.16, 0.65, 0);
    const hipR = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), blackMat);
    this.playerLegR.add(hipR);
    const thighR = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.55, 6), armorMat);
    thighR.position.y = -0.25;
    this.playerLegR.add(thighR);
    const bootR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.25), blackMat);
    bootR.position.set(0, -0.55, 0.04);
    this.playerLegR.add(bootR);
    this.playerMesh.add(this.playerLegR);

    // 5. Backpack thrust jet booster with exhaust emission ring
    const jetpack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.45, 0.18), blackMat);
    jetpack.position.set(0, 1.0, -0.24);
    
    const flareGeom = new THREE.ConeGeometry(0.15, 0.45, 6);
    flareGeom.rotateX(Math.PI / 2);
    const flareMat = new THREE.MeshBasicMaterial({ color: 0xff00b7 });
    const boostFlare = new THREE.Mesh(flareGeom, flareMat);
    boostFlare.position.set(0, -0.24, -0.1);
    jetpack.add(boostFlare);

    this.playerMesh.add(jetpack);

    this.playerMesh.position.set(0, 0, 0);
    this.scene.add(this.playerMesh);
  }

  // --- SCI-FI SCENIC INFINITE SKY HIGH CITY BACKDROP ---
  private initLandscape() {
    // Cyber sea level plane well below
    const deepGrid = new THREE.GridHelper(800, 40, 0x1e1b4b, 0x581c87);
    deepGrid.position.y = -18.0;
    this.scene.add(deepGrid);

    const seaGeom = new THREE.PlaneGeometry(800, 800);
    const seaMat = new THREE.MeshStandardMaterial({ color: 0x02000a, roughness: 0.1 });
    const blueSeaPlane = new THREE.Mesh(seaGeom, seaMat);
    blueSeaPlane.rotation.x = -Math.PI / 2;
    blueSeaPlane.position.y = -18.1;
    this.scene.add(blueSeaPlane);

    // Towers rising alongside Zaxis
    const buildTowerStructure = (x: number, z: number, w: number, h: number, glassColor: number) => {
      const towerGroup = new THREE.Group();
      towerGroup.position.set(x, -2, z);

      const blockGeom = new THREE.BoxGeometry(w, h, w);
      const blockMat = new THREE.MeshStandardMaterial({
        color: 0x0c0d1e,
        roughness: 0.6,
        metalness: 0.9,
      });
      const core = new THREE.Mesh(blockGeom, blockMat);
      core.position.y = h / 2 - 16; // secure base
      towerGroup.add(core);

      // Glowing panels window bands
      const bandGeom = new THREE.BoxGeometry(w + 0.1, 0.4, w + 0.1);
      const glowMat = new THREE.MeshBasicMaterial({ color: glassColor });
      for (let i = 2; i < h; i += 7) {
        if (i < h - 5) {
          const band = new THREE.Mesh(bandGeom, glowMat);
          band.position.y = i - 16;
          towerGroup.add(band);
        }
      }

      this.scene.add(towerGroup);
      this.sceneryNodes.push(towerGroup);
    };

    // Stagger skyscrapers alongside the speed zone
    for (let z = -140; z <= 40; z += 30) {
      buildTowerStructure(-14.0, z, 3.8, 30 + Math.random() * 25, 0xec4899); // Magenta panels on left
      buildTowerStructure(14.0, z + 12, 3.8, 30 + Math.random() * 25, 0x00f2ff); // Turquoise panels on right
    }
  }

  private spawnHurdles(cameraZ: number) {
    const rZ = -120 - Math.random() * 30;

    const spawnDecider = Math.random();
    if (spawnDecider < 0.55) {
      // Spawn concrete cyber hurdle blocks
      const lane = Math.floor(Math.random() * 3);
      const isTall = Math.random() < 0.35;

      const blockGeom = isTall 
        ? new THREE.BoxGeometry(1.5, 3.2, 1.5) 
        : new THREE.BoxGeometry(2.0, 1.1, 1.1);

      const neonBlockMat = new THREE.MeshStandardMaterial({
        color: isTall ? 0xf43f5e : 0xf59e0b,
        roughness: 0.2,
        emissive: isTall ? 0xbe123c : 0xd97706,
        emissiveIntensity: 1.2,
      });

      const block = new THREE.Mesh(blockGeom, neonBlockMat);
      block.position.set(this.lanes[lane], isTall ? 1.6 : 0.55, rZ);
      (block as any).userData = { lane, isTall };
      this.scene.add(block);
      this.obstacles.push(block);
    } else {
      // Spawn floating gold ring credits
      const lane = Math.floor(Math.random() * 3);
      for (let j = 0; j < 3; j++) {
        // Glowing credit torus rings
        const ringGeom = new THREE.TorusGeometry(0.42, 0.1, 6, 16);
        const goldMat = new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          emissive: 0xeab308,
          emissiveIntensity: 1.5,
          roughness: 0.1,
          metalness: 0.9,
        });

        const goldRing = new THREE.Mesh(ringGeom, goldMat);
        goldRing.position.set(this.lanes[lane], 1.15, rZ - (j * 4.2));
        (goldRing as any).userData = { lane, score: 60 };
        this.scene.add(goldRing);
        this.coins.push(goldRing);
      }

      // Spawn Magnet Power-up items
      if (Math.random() < 0.25 && !this.magnetPowerUp) {
        const magGeom = new THREE.TorusGeometry(0.6, 0.16, 8, 20);
        const magMat = new THREE.MeshStandardMaterial({
          color: 0x06b6d4,
          emissive: 0x0891b2,
          emissiveIntensity: 2.0,
          roughness: 0.1,
          metalness: 0.9,
        });
        const magnet = new THREE.Mesh(magGeom, magMat);
        magnet.position.set(this.lanes[Math.floor(Math.random() * 3)], 1.35, rZ - 14.0);
        (magnet as any).userData = { isPowerUp: true };
        this.scene.add(magnet);
        this.magnetPowerUp = magnet;
      }
    }
  }

  public moveLeft() {
    if (this.status !== 'PLAYING') return;
    if (this.playerLane > 0) {
      this.playerLane--;
    }
  }

  public moveRight() {
    if (this.status !== 'PLAYING') return;
    if (this.playerLane < 2) {
      this.playerLane++;
    }
  }

  public jump() {
    if (this.status !== 'PLAYING') return;
    if (!this.isJumping) {
      this.isJumping = true;
      this.playerVelocityY = this.jumpPower;
    }
  }

  public speedUp(amount: number) {
    if (this.status !== 'PLAYING') return;
    this.currentSpeed = Math.min(this.currentSpeed + amount, this.maxSpeed);
  }

  public slowDown(amount: number) {
    if (this.status !== 'PLAYING') return;
    this.currentSpeed = Math.max(this.currentSpeed - amount, 8.0);
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
    this.currentSpeed = Math.min(this.currentSpeed + delta * 0.18, this.maxSpeed);

    // Increase core score
    this.score += Math.floor(delta * this.currentSpeed * 1.5);
    this.onScore(this.score);

    // Horizontal sliding movement
    this.targetPlayerX = this.lanes[this.playerLane];
    this.playerMesh.position.x += (this.targetPlayerX - this.playerMesh.position.x) * 14 * delta;

    // Side leaning styling
    const sideLeaningX = (this.targetPlayerX - this.playerMesh.position.x) * 0.12;
    this.playerMesh.rotation.z = -sideLeaningX;

    // Upward jump gravity engine
    if (this.isJumping) {
      this.playerVelocityY -= this.gravity * delta;
      this.playerY += this.playerVelocityY * delta;

      if (this.playerY <= 0.0) {
        this.playerY = 0.0;
        this.playerVelocityY = 0;
        this.isJumping = false;
      }
    }
    this.playerMesh.position.y = 0.12 + this.playerY;

    // --- ANIMATE HUMANOID ATHLETE RUNNING CYCLE ---
    const runFreq = 16 + this.currentSpeed * 0.15;
    const runnerCycle = Math.sin(this.timeElapsed * runFreq);

    if (!this.isJumping) {
      this.playerLegL.rotation.x = runnerCycle * 0.95;
      this.playerLegR.rotation.x = -runnerCycle * 0.95;
      this.playerArmL.rotation.x = -runnerCycle * 0.95;
      this.playerArmR.rotation.x = runnerCycle * 0.95;
    } else {
      // Jump posture
      this.playerLegL.rotation.x = -1.1;
      this.playerLegR.rotation.x = -1.1;
      this.playerArmL.rotation.y = 0.6;
      this.playerArmR.rotation.y = -0.6;
    }

    // Scroll highways segments
    this.roadGroup.position.z += this.currentSpeed * delta;
    if (this.roadGroup.position.z >= this.roadLength) {
      this.roadGroup.position.z -= this.roadLength;
    }

    // Scroll skyscrapers backdrop scenery flawlessly to match endless warp speed
    this.sceneryNodes.forEach((node) => {
      node.position.z += this.currentSpeed * delta;
      if (node.position.z > 50) {
        node.position.z = -140; // recycle spawn behind horizon
      }
    });

    // Spawn elements ahead
    if (this.obstacles.length + this.coins.length < 12) {
      this.spawnHurdles(0);
    }

    // Power-up magnet timer ticking
    if (this.isMagnetActive) {
      this.magnetTimer -= delta;
      if (this.magnetTimer <= 0) {
        this.isMagnetActive = false;
      }
    }

    // Magnet power collection
    if (this.magnetPowerUp) {
      this.magnetPowerUp.position.z += this.currentSpeed * delta;
      this.magnetPowerUp.rotation.z += 2.5 * delta;
      
      if (this.magnetPowerUp.position.z > 20) {
        this.scene.remove(this.magnetPowerUp);
        this.magnetPowerUp = null;
      } else {
        const dX = Math.abs(this.playerMesh.position.x - this.magnetPowerUp.position.x);
        const dZ = Math.abs(this.magnetPowerUp.position.z - 0.2);
        if (dZ < 1.8 && dX < 1.5) {
          this.isMagnetActive = true;
          this.magnetTimer = 8.0;
          this.score += 500;
          this.onScore(this.score);
          this.scene.remove(this.magnetPowerUp);
          this.magnetPowerUp = null;
        }
      }
    }

    // Check obstacle crashes
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.position.z += this.currentSpeed * delta;

      if (o.position.z > 20) {
        this.scene.remove(o);
        this.obstacles.splice(i, 1);
        continue;
      }

      const oUserData = (o as any).userData;
      const distZ = Math.abs(o.position.z - 0.2);
      const distX = Math.abs(this.playerMesh.position.x - o.position.x);

      if (distZ < 1.5 && distX < 1.3) {
        const isFlat = !oUserData.isTall;
        if (isFlat && this.playerY > 0.8) {
          // Jumped cleanly!
          this.score += 150;
          this.onScore(this.score);
          this.scene.remove(o);
          this.obstacles.splice(i, 1);
          continue;
        }

        // Damage runner
        this.health -= 35;
        this.onHealth(this.health);
        this.cameraShake();

        this.scene.remove(o);
        this.obstacles.splice(i, 1);

        if (this.health <= 0) {
          this.die();
        }
      }
    }

    // Process Coins and magnetic absorption
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.position.z += this.currentSpeed * delta;
      c.rotation.z += 2.2 * delta;

      if (c.position.z > 20) {
        this.scene.remove(c);
        this.coins.splice(i, 1);
        continue;
      }

      if (this.isMagnetActive) {
        const dScoreX = this.playerMesh.position.x - c.position.x;
        // Move towards player at Z = 0
        const dScoreZ = -c.position.z;
        const distToPlayer = Math.sqrt(Math.pow(dScoreX, 2) + Math.pow(c.position.z, 2));

        if (distToPlayer < 12.0) {
          c.position.x += dScoreX * 10 * delta;
          c.position.z += dScoreZ * 10 * delta;
        }
      }

      const dX = Math.abs(this.playerMesh.position.x - c.position.x);
      const dZ = Math.abs(c.position.z - 0.2);
      const dY = Math.abs(this.playerMesh.position.y - c.position.y);

      if (dZ < 1.4 && dX < 1.1 && dY < 1.5) {
        this.score += 120;
        this.onScore(this.score);
        this.scene.remove(c);
        this.coins.splice(i, 1);
      }
    }

    // Camera follow
    const targetCameraZ = 6.4;
    this.camera.position.z += (targetCameraZ - this.camera.position.z) * 6 * delta;
    this.camera.position.x += ((this.playerMesh.position.x * 0.45) - this.camera.position.x) * 6 * delta;
  }

  private cameraShake() {
    this.camera.position.x += (Math.random() - 0.5) * 1.2;
    this.camera.position.y += (Math.random() - 0.5) * 1.2;
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  private die() {
    this.status = 'GAMEOVER';
    this.onStatus('GAMEOVER');
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
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
