import * as THREE from 'three';
import { GameSettings, GameStatus } from '../types';

interface SpaceEnemy {
  mesh: THREE.Group;
  enemyType: 'grunt' | 'boss';
  health: number;
  maxHealth: number;
  speedX: number;
  speedZ: number;
  fireCooldown: number;
}

interface SpaceAsteroid {
  mesh: THREE.Mesh;
  rotSpeed: THREE.Vector3;
  size: number;
}

interface Laser {
  mesh: THREE.Mesh;
  velocityZ: number;
  isEnemyLaser: boolean;
  isSingularity?: boolean;
  damage?: number;
}

export class SpaceGame {
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

  // Custom configurations
  private weaponMode = 'plasma_burst';

  // Space mechanics
  private score = 0;
  private health = 100;
  private status: GameStatus = 'PLAYING';
  private stageWidth = 24; // boundary limit [-12, 12]
  private stageLength = 32; // boundary limit [-12, 20]
  private timeElapsed = 0;

  // Wave index
  private currentProgress = 1;
  private maxWavesBeforeBoss = 3;
  private isBossFight = false;
  private bossHealth = 500;
  private bossMaxHealth = 500;

  // Player pos
  private playerPos = new THREE.Vector3(0, 0, 10);
  private playerSpeed = 15.0;

  // Objects groups
  private playerMesh!: THREE.Group;
  private starfield!: THREE.Points;
  private enemies: SpaceEnemy[] = [];
  private asteroids: SpaceAsteroid[] = [];
  private lasers: Laser[] = [];

  // Cosmic scenery planets
  private sceneryPlanets: THREE.Group[] = [];

  // Fire triggers
  private laserCooldown = 0;

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    onScore: (score: number) => void,
    onHealth: (health: number) => void,
    onStatus: (status: GameStatus) => void,
    settings: GameSettings,
    options?: { weaponMode?: string }
  ) {
    this.container = container;
    this.canvas = canvas;
    this.onScore = onScore;
    this.onHealth = onHealth;
    this.onStatus = onStatus;
    this.settings = settings;

    if (options && options.weaponMode) {
      this.weaponMode = options.weaponMode;
    }

    this.initScene();
    this.initLights();
    this.initWorld();
    this.initPlayer();
    this.spawnNextWave();
    this.animate(0);
  }

  private initScene() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    this.scene = THREE.Scene ? new THREE.Scene() : new (THREE as any).Scene();
    // Rich deep midnight nebula space background yields high visual contrast
    this.scene.background = new THREE.Color(0x060517);
    this.scene.fog = new THREE.FogExp2(0x060517, 0.012);

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.camera.position.set(0, 22, 15);
    this.camera.lookAt(new THREE.Vector3(0, 0, 1.5));

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.settings.quality !== 'low',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  private initLights() {
    // Significantly elevated background light levels to eliminate dark silhouette problems
    const spaceAmbient = new THREE.AmbientLight(0x232042, 2.5);
    this.scene.add(spaceAmbient);

    const nebulaPink = new THREE.DirectionalLight(0xd946ef, 2.2);
    nebulaPink.position.set(-10, -20, -50);
    this.scene.add(nebulaPink);

    const spectRay = new THREE.DirectionalLight(0x06b6d4, 2.2);
    spectRay.position.set(0, 40, 10);
    this.scene.add(spectRay);
  }

  private initWorld() {
    // Generate star field particles
    const starCount = 380;
    const starGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 60; // X
      positions[i + 1] = -4 - Math.random() * 5; // Y (depth underneath)
      positions[i + 2] = (Math.random() - 0.5) * 80; // Z
    }

    starGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.15,
      sizeAttenuation: true,
    });
    this.starfield = new THREE.Points(starGeom, starMat);
    this.scene.add(this.starfield);

    // --- COSMIC PLANETS LANDSCAPE BACKGROUND ---
    const buildSaturnPlanet = (x: number, y: number, z: number, size: number, colorHex: number, ringColor: number) => {
      const planetGroup = new THREE.Group();
      planetGroup.position.set(x, y, z);

      // Core planet sphere
      const sphereMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.6,
        metalness: 0.3,
      });
      const core = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 16), sphereMat);
      planetGroup.add(core);

      // Planetary Ring
      const ringGeom = new THREE.TorusGeometry(size * 1.8, size * 0.18, 2, 24);
      ringGeom.rotateX(Math.PI / 2.3); // tilt ring
      const ringMat = new THREE.MeshStandardMaterial({
        color: ringColor,
        roughness: 0.8,
        transparent: true,
        opacity: 0.65,
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      planetGroup.add(ring);

      this.scene.add(planetGroup);
      this.sceneryPlanets.push(planetGroup);
    };

    // Plant majestic cosmic scenery deep in space (negative Y / deep Z background)
    buildSaturnPlanet(-25, -12, -45, 4.0, 0xef4444, 0xf59e0b); // Molten Ringed giant on left
    buildSaturnPlanet(25, -15, -60, 3.5, 0x06b6d4, 0xa855f7);  // Neptunian Ringed giant on right
  }

  // --- HIGH-FIDELITY TWIN-WING COBALT FIGHTER ASSEMBLY ---
  private initPlayer() {
    this.playerMesh = new THREE.Group();

    const suitMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Royal Cyan body armor panels
      roughness: 0.1,
      metalness: 0.9,
    });
    const subMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.4 });

    // 1. Sleek central fuselage cylinder
    const fuselageGeom = new THREE.CylinderGeometry(0.12, 0.44, 2.4, 8);
    fuselageGeom.rotateX(Math.PI / 2);
    const fuselage = new THREE.Mesh(fuselageGeom, suitMat);
    fuselage.castShadow = true;
    this.playerMesh.add(fuselage);

    // 2. Translucent glass cockpit canopy bubble
    const canopyGeom = new THREE.SphereGeometry(0.24, 10, 10);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      roughness: 0.05,
      metalness: 0.95,
      transparent: true,
      opacity: 0.65,
    });
    const cockpitGlass = new THREE.Mesh(canopyGeom, glassMat);
    cockpitGlass.position.set(0, 0.22, -0.15); // front chest shift
    cockpitGlass.scale.set(1.0, 1.0, 1.8);
    this.playerMesh.add(cockpitGlass);

    // 3. Swept-back Wings & Dual mounted laser cannons
    const leftWing = new THREE.Group();
    leftWing.position.set(-1.1, 0, 0.2);
    leftWing.rotation.y = 0.22; // sweep slightly back

    const wingGeomL = new THREE.BoxGeometry(1.6, 0.08, 0.85);
    const wingLMesh = new THREE.Mesh(wingGeomL, suitMat);
    leftWing.add(wingLMesh);

    // Wingtip cannon barrel cylinder
    const wingTipCannonL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), subMat);
    wingTipCannonL.rotation.x = Math.PI / 2;
    wingTipCannonL.position.set(-0.7, 0.04, -0.45);
    leftWing.add(wingTipCannonL);

    this.playerMesh.add(leftWing);

    const rightWing = new THREE.Group();
    rightWing.position.set(1.1, 0, 0.2);
    rightWing.rotation.y = -0.22;

    const wingGeomR = new THREE.BoxGeometry(1.6, 0.08, 0.85);
    const wingRMesh = new THREE.Mesh(wingGeomR, suitMat);
    rightWing.add(wingRMesh);

    const wingTipCannonR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), subMat);
    wingTipCannonR.rotation.x = Math.PI / 2;
    wingTipCannonR.position.set(0.7, 0.04, -0.45);
    rightWing.add(wingTipCannonR);

    this.playerMesh.add(rightWing);

    // 4. Dual Jet exhaust thruster ports with glowing cone
    const exhaustGeom = new THREE.CylinderGeometry(0.18, 0.18, 0.5, 8);
    exhaustGeom.rotateX(Math.PI / 2);

    const prtL = new THREE.Mesh(exhaustGeom, subMat);
    prtL.position.set(-0.2, 0, 1.22);
    this.playerMesh.add(prtL);

    const prtR = new THREE.Mesh(exhaustGeom, subMat);
    prtR.position.set(0.2, 0, 1.22);
    this.playerMesh.add(prtR);

    // Intense turquoise engine fire glow cones
    const flareGeom = new THREE.ConeGeometry(0.16, 0.6, 8);
    flareGeom.rotateX(Math.PI / 2);
    const flareMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });

    const flareL = new THREE.Mesh(flareGeom, flareMat);
    flareL.position.set(-0.2, 0, 1.62);
    this.playerMesh.add(flareL);

    const flareR = new THREE.Mesh(flareGeom, flareMat);
    flareR.position.set(0.2, 0, 1.62);
    this.playerMesh.add(flareR);

    this.playerMesh.position.copy(this.playerPos);
    this.scene.add(this.playerMesh);
  }

  // --- SCI-FI ALIEN FIGHTERS AND HEAVY VEHICLES ---
  private spawnNextWave() {
    if (this.currentProgress > this.maxWavesBeforeBoss) {
      this.initBossFight();
      return;
    }

    // Spawn 5 highly stylized flying enemy scout groups
    for (let i = 0; i < 5; i++) {
      const sx = -10 + i * 5;
      const sz = -18 - (Math.random() * 6);

      const enemyGroup = new THREE.Group();
      
      const droneMat = new THREE.MeshStandardMaterial({
        color: 0xef4444, // Crimson plasma hulls
        roughness: 0.2,
        metalness: 0.9,
      });
      const energyMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });

      // Core sphere drone eye
      const coreEye = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), droneMat);
      enemyGroup.add(coreEye);

      // Twin blade side panels (creepy curved wedges)
      const bladeGeom = new THREE.BoxGeometry(1.2, 0.12, 0.7);
      const bladeL = new THREE.Mesh(bladeGeom, droneMat);
      bladeL.position.set(-0.7, 0, 0);
      bladeL.rotation.z = Math.PI / 6;
      enemyGroup.add(bladeL);

      const bladeR = new THREE.Mesh(bladeGeom, droneMat);
      bladeR.position.set(0.7, 0, 0);
      bladeR.rotation.z = -Math.PI / 6;
      enemyGroup.add(bladeR);

      // Glowing crimson back thrusters
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 6), energyMat);
      fire.rotateX(Math.PI / 2);
      fire.position.set(0, 0, 0.6);
      enemyGroup.add(fire);

      const eMesh = enemyGroup;
      eMesh.position.set(sx, 0, sz);
      this.scene.add(eMesh);

      this.enemies.push({
        mesh: eMesh,
        enemyType: 'grunt',
        health: 40,
        maxHealth: 40,
        speedX: Math.sin(i) * 3.5,
        speedZ: 4.5,
        fireCooldown: 1.0 + Math.random() * 2,
      });
    }

    // Spawn 3 detailed polygon asteroids
    for (let j = 0; j < 3; j++) {
      const rx = (Math.random() - 0.5) * 20;
      const rz = -25 - Math.random() * 15;
      const sizeVal = 0.9 + Math.random() * 1.5;

      const polyGeom = new THREE.DodecahedronGeometry(sizeVal, 0);
      const polyMat = new THREE.MeshStandardMaterial({
        color: 0x475569,
        roughness: 0.95,
      });
      const ast = new THREE.Mesh(polyGeom, polyMat);
      ast.position.set(rx, 0, rz);
      this.scene.add(ast);

      this.asteroids.push({
        mesh: ast,
        rotSpeed: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
        size: sizeVal,
      });
    }
  }

  // --- DETAILED GIANT MOTHERSHIPS BOSS ---
  private initBossFight() {
    this.isBossFight = true;

    const bossGroup = new THREE.Group();

    // Giant circular reactor ring core
    const coreGeom = new THREE.TorusGeometry(3.6, 0.72, 8, 32);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x8b5cf6, // Violet alien mother armor panels
      roughness: 0.15,
      metalness: 0.85,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    core.rotation.x = Math.PI / 2;
    bossGroup.add(core);

    // Center firing eye core sphere
    const eyeGeom = new THREE.SphereGeometry(1.6, 12, 12);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00f2ff });
    const eye = new THREE.Mesh(eyeGeom, eyeMat);
    bossGroup.add(eye);

    // Glowing shield columns protruding
    const colGeom = new THREE.CylinderGeometry(0.24, 0.24, 1.6, 6);
    for (let i = 0; i < 4; i++) {
      const col = new THREE.Mesh(colGeom, coreMat);
      const angle = (i / 4) * Math.PI * 2;
      col.position.set(Math.cos(angle) * 3.6, 0, Math.sin(angle) * 3.6);
      col.rotation.y = angle;
      bossGroup.add(col);
    }

    const bMesh = bossGroup;
    bMesh.position.set(0, 0, -18);
    this.scene.add(bMesh);

    this.enemies.push({
      mesh: bMesh,
      enemyType: 'boss',
      health: this.bossHealth,
      maxHealth: this.bossMaxHealth,
      speedX: 5.5, // sway left/right
      speedZ: 0.8,
      fireCooldown: 0.5,
    });
  }

  public steerX(offset: number) {
    if (this.status !== 'PLAYING') return;
    this.playerPos.x = Math.max(-11.5, Math.min(11.5, this.playerPos.x + offset));
    this.playerMesh.position.copy(this.playerPos);

    // Bank fighter slightly
    this.playerMesh.rotation.z = -offset * 0.12;
  }

  public steerZ(offset: number) {
    if (this.status !== 'PLAYING') return;
    this.playerPos.z = Math.max(-2, Math.min(13.5, this.playerPos.z + offset));
    this.playerMesh.position.copy(this.playerPos);
  }

  public fireLaser() {
    if (this.status !== 'PLAYING') return;
    if (this.laserCooldown > 0) return;

    if (this.weaponMode === 'scatter_shotgun' || this.weaponMode === 'neutron_wave') {
      // 2. penetrative/wide NEUTRON WAVE
      this.laserCooldown = 0.38;

      const tipCenter = this.playerPos.clone().add(new THREE.Vector3(0, 0, -1.0));
      const waveGeom = new THREE.BoxGeometry(4.2, 0.08, 0.4);
      const waveMat = new THREE.MeshBasicMaterial({ color: 0x10b981 }); // bright green fluorescent ring wave
      const wMesh = new THREE.Mesh(waveGeom, waveMat);
      wMesh.position.copy(tipCenter);
      this.scene.add(wMesh);

      this.lasers.push({
        mesh: wMesh,
        velocityZ: -42.0,
        isEnemyLaser: false,
        damage: 75
      });
    } else if (this.weaponMode === 'vortex_cannon' || this.weaponMode === 'singularity_charge') {
      // 3. custom explosive SINGULARITY CHARGE
      this.laserCooldown = 0.48;

      const tipCenter = this.playerPos.clone().add(new THREE.Vector3(0, 0, -1.2));
      const coreGeom = new THREE.SphereGeometry(0.55, 8, 8);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xf97316 }); // super neon hot orange
      const cMesh = new THREE.Mesh(coreGeom, coreMat);
      cMesh.position.copy(tipCenter);
      this.scene.add(cMesh);

      this.lasers.push({
        mesh: cMesh,
        velocityZ: -24.0, // slower heavy singularity orb
        isEnemyLaser: false,
        isSingularity: true,
        damage: 110
      });
    } else {
      // 1. NEON PLASMA BURST (Dual light cyan bolts)
      this.laserCooldown = 0.14;

      const tipL = this.playerPos.clone().add(new THREE.Vector3(-1.4, 0, -0.6));
      const tipR = this.playerPos.clone().add(new THREE.Vector3(1.4, 0, -0.6));

      const laserGeom = new THREE.BoxGeometry(0.12, 0.12, 0.95);
      const laserMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee }); // cyan light

      const lMeshL = new THREE.Mesh(laserGeom, laserMat);
      lMeshL.position.copy(tipL);
      this.scene.add(lMeshL);

      const lMeshR = new THREE.Mesh(laserGeom, laserMat);
      lMeshR.position.copy(tipR);
      this.scene.add(lMeshR);

      this.lasers.push({ mesh: lMeshL, velocityZ: -60.0, isEnemyLaser: false, damage: 35 });
      this.lasers.push({ mesh: lMeshR, velocityZ: -60.0, isEnemyLaser: false, damage: 35 });
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
    this.laserCooldown -= delta;

    this.score += Math.floor(delta * 12);
    this.onScore(this.score);

    // Gently drift fighters rotation straight when no steer inputs active
    this.playerMesh.rotation.z += (0 - this.playerMesh.rotation.z) * 8 * delta;

    // Slowly scroll stars downward
    const starPosAttr = this.starfield.geometry.attributes.position as THREE.BufferAttribute;
    const scrollAmount = 16.0 * delta;
    for (let i = 0; i < starPosAttr.count; i++) {
      let sz = starPosAttr.getZ(i);
      sz += scrollAmount;
      if (sz > 30) sz = -50;
      starPosAttr.setZ(i, sz);
    }
    starPosAttr.needsUpdate = true;

    // Slowly rotate background planet scenery nodes
    this.sceneryPlanets.forEach((p, idx) => {
      p.rotation.y += (idx === 0 ? 0.08 : -0.05) * delta;
    });

    // Process lasers
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      l.mesh.position.z += l.velocityZ * delta;

      if (l.mesh.position.z < -25 || l.mesh.position.z > 25) {
        this.scene.remove(l.mesh);
        this.lasers.splice(i, 1);
        continue;
      }

      if (l.isEnemyLaser) {
        const distToPlayer = l.mesh.position.distanceTo(this.playerPos);
        if (distToPlayer < 1.35) {
          this.health = Math.max(0, this.health - 15);
          this.onHealth(this.health);
          this.scene.remove(l.mesh);
          this.lasers.splice(i, 1);

          if (this.health <= 0) this.die('GAMEOVER');
          continue;
        }
      } else {
        let laserConsumed = false;
        
        // Hit collision enemies
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const e = this.enemies[j];
          const distToE = l.mesh.position.distanceTo(e.mesh.position);

          if (distToE < (e.enemyType === 'boss' ? 4.5 : 1.5)) {
            laserConsumed = true;
            const dmg = l.damage || 25;

            if (l.isSingularity) {
              // Create singularity explosion ring visualizer
              const singularityBoom = new THREE.Mesh(
                new THREE.RingGeometry(0.1, 4.5, 16),
                new THREE.MeshBasicMaterial({ color: 0xf97316, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
              );
              singularityBoom.rotation.x = Math.PI / 2;
              singularityBoom.position.copy(l.mesh.position);
              this.scene.add(singularityBoom);

              let ringTime = 0;
              const animateRing = () => {
                ringTime += 0.05;
                singularityBoom.scale.addScalar(0.45);
                (singularityBoom.material as THREE.MeshBasicMaterial).opacity -= 0.12;
                if (ringTime < 0.45) {
                  requestAnimationFrame(animateRing);
                } else {
                  this.scene.remove(singularityBoom);
                }
              };
              animateRing();

              // Splash damage to ALL close-by enemies!
              for (let k = this.enemies.length - 1; k >= 0; k--) {
                const innerE = this.enemies[k];
                const sDist = l.mesh.position.distanceTo(innerE.mesh.position);
                if (sDist <= 6.5) {
                  innerE.health -= dmg;
                  this.setMeshColorRecursive(innerE.mesh, 0xff0000);
                  const defaultClr = innerE.enemyType === 'boss' ? 0x8b5cf6 : 0xef4444;
                  setTimeout(() => {
                    if (innerE.mesh) this.setMeshColorRecursive(innerE.mesh, defaultClr);
                  }, 60);

                  if (innerE.health <= 0) {
                    if (innerE.enemyType === 'boss') {
                      this.score += 5000;
                      this.onScore(this.score);
                      this.die('VICTORY');
                    } else {
                      this.score += 500;
                      this.onScore(this.score);
                      this.scene.remove(innerE.mesh);
                      this.enemies.splice(k, 1);
                    }
                  }
                }
              }

              // Also demolish close-by asteroids in the explosion radius!
              for (let aIdx = this.asteroids.length - 1; aIdx >= 0; aIdx--) {
                const ast = this.asteroids[aIdx];
                const sDist = l.mesh.position.distanceTo(ast.mesh.position);
                if (sDist <= 6.5) {
                  this.scene.remove(ast.mesh);
                  this.asteroids.splice(aIdx, 1);
                  this.score += 200;
                  this.onScore(this.score);
                }
              }
            } else {
              // Standard single target laser hit damage
              e.health -= dmg;
              this.setMeshColorRecursive(e.mesh, 0xff0000);
              setTimeout(() => {
                if (e.mesh) this.setMeshColorRecursive(e.mesh, e.enemyType === 'boss' ? 0x8b5cf6 : 0xef4444);
              }, 60);

              if (e.health <= 0) {
                if (e.enemyType === 'boss') {
                  this.score += 5000;
                  this.onScore(this.score);
                  this.die('VICTORY');
                } else {
                  this.score += 500;
                  this.onScore(this.score);
                  this.scene.remove(e.mesh);
                  this.enemies.splice(j, 1);
                }
              }
            }
            break;
          }
        }

        if (laserConsumed) {
          this.scene.remove(l.mesh);
          this.lasers.splice(i, 1);
          continue;
        }

        // Hit collision Asteroids
        for (let aIdx = this.asteroids.length - 1; aIdx >= 0; aIdx--) {
          const ast = this.asteroids[aIdx];
          const distToA = l.mesh.position.distanceTo(ast.mesh.position);
          if (distToA < ast.size + 0.5) {
            laserConsumed = true;
            this.scene.remove(ast.mesh);
            this.asteroids.splice(aIdx, 1);
            this.score += 200;
            this.onScore(this.score);
            break;
          }
        }

        if (laserConsumed) {
          this.scene.remove(l.mesh);
          this.lasers.splice(i, 1);
        }
      }
    }

    // Scroll Asteroids
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const ast = this.asteroids[i];
      ast.mesh.position.z += 8.5 * delta;
      ast.mesh.rotation.x += ast.rotSpeed.x * delta;
      ast.mesh.rotation.y += ast.rotSpeed.y * delta;

      const dist = ast.mesh.position.distanceTo(this.playerPos);
      if (dist < ast.size + 1.0) {
        this.health = Math.max(0, this.health - 25);
        this.onHealth(this.health);
        this.scene.remove(ast.mesh);
        this.asteroids.splice(i, 1);

        if (this.health <= 0) this.die('GAMEOVER');
        continue;
      }

      if (ast.mesh.position.z > 20) {
        this.scene.remove(ast.mesh);
        this.asteroids.splice(i, 1);
      }
    }

    // Spawn wave details
    if (this.enemies.length === 0 && !this.isBossFight) {
      this.currentProgress++;
      this.spawnNextWave();
    }

    // Move fighters
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      if (e.enemyType === 'grunt') {
        e.mesh.position.z += e.speedZ * delta;
        e.mesh.position.x += e.speedX * delta;

        if (e.mesh.position.x > 11.5 || e.mesh.position.x < -11.5) {
          e.speedX = -e.speedX;
        }

        e.fireCooldown -= delta;
        if (e.fireCooldown <= 0) {
          e.fireCooldown = 1.8 + Math.random() * 1.5;
          this.spawnEnemyLaser(e.mesh.position.x, e.mesh.position.z + 1.25);
        }

        const dist = e.mesh.position.distanceTo(this.playerPos);
        if (dist < 1.6) {
          this.health = Math.max(0, this.health - 30);
          this.onHealth(this.health);
          this.scene.remove(e.mesh);
          this.enemies.splice(i, 1);

          if (this.health <= 0) this.die('GAMEOVER');
          continue;
        }

        if (e.mesh.position.z > 18) {
          this.scene.remove(e.mesh);
          this.enemies.splice(i, 1);
        }
      } else if (e.enemyType === 'boss') {
        if (e.mesh.position.z < -4) {
          e.mesh.position.z += e.speedZ * delta;
        }

        e.mesh.position.x += e.speedX * delta;
        if (e.mesh.position.x > 8.0 || e.mesh.position.x < -8.0) {
          e.speedX = -e.speedX;
        }

        this.bossHealth = e.health;

        e.fireCooldown -= delta;
        if (e.fireCooldown <= 0) {
          e.fireCooldown = 0.55;
          
          const angleOffset = performance.now() * 0.0012;
          for (let k = 0; k < 3; k++) {
            const radAngle = (k / 3) * Math.PI + angleOffset;
            const lvx = Math.sin(radAngle) * 14.0;
            const lvz = Math.cos(radAngle) * 14.0;

            const plasmaGeom = new THREE.SphereGeometry(0.32, 8, 8);
            const plasmaMat = new THREE.MeshBasicMaterial({ color: 0xff004f });
            const pMesh = new THREE.Mesh(plasmaGeom, plasmaMat);
            pMesh.position.copy(e.mesh.position).add(new THREE.Vector3(0, 0, 1.5));
            this.scene.add(pMesh);

            this.lasers.push({
              mesh: pMesh,
              velocityZ: lvz,
              isEnemyLaser: true,
            });

            (pMesh as any).velocityX = lvx;
          }
        }
      }
    }

    // Horizontal radial velocity
    this.lasers.forEach((l) => {
      if ((l.mesh as any).velocityX) {
        l.mesh.position.x += (l.mesh as any).velocityX * delta;
      }
    });
  }

  private spawnEnemyLaser(x: number, z: number) {
    const laserGeom = new THREE.BoxGeometry(0.12, 0.12, 0.85);
    const laserMat = new THREE.MeshBasicMaterial({ color: 0xff3b5c });
    const eLaser = new THREE.Mesh(laserGeom, laserMat);
    eLaser.position.set(x, 0, z);
    this.scene.add(eLaser);

    this.lasers.push({ mesh: eLaser, velocityZ: 25.0, isEnemyLaser: true });
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

  private die(finalVal: GameStatus) {
    this.status = finalVal;
    this.onStatus(finalVal);
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  public getBossProgress(): number {
    return this.bossHealth;
  }

  public isBossActive(): boolean {
    return this.isBossFight;
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
