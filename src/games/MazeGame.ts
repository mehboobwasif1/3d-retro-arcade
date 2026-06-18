import * as THREE from 'three';
import { GameSettings, GameStatus } from '../types';

interface MazeCell {
  x: number;
  y: number;
  visited: boolean;
  walls: boolean[]; // Top, Right, Bottom, Left
}

export class MazeGame {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private onScore: (score: number) => void;
  private onHealth: (health: number) => void; // Count-down timer
  private onStatus: (status: GameStatus) => void;
  private settings: GameSettings;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private animationFrameId: number | null = null;

  // Maze size parameters
  private gridSizeX = 9;
  private gridSizeY = 9;
  private cellSize = 6.0; // scale of each corridor tile in 3D
  private wallHeight = 4.5;

  // Gameplay
  private score = 0;
  private timeLeft = 120; // 120-second challenge timer
  private status: GameStatus = 'PLAYING';
  private hasKey = false;
  private mazeGrid: MazeCell[][] = [];
  private timeElapsed = 0;

  // Positions
  private playerPos = new THREE.Vector3(0, 0.8, 0); // start at tile (0, 0)
  private keyPos = new THREE.Vector3(0, 0.8, 0);
  private gatePos = new THREE.Vector3(0, 0.8, 0);

  // Humanoid segments
  private playerMesh!: THREE.Group;
  private playerLegL!: THREE.Object3D;
  private playerLegR!: THREE.Object3D;
  private playerArmL!: THREE.Object3D;
  private playerArmR!: THREE.Object3D;
  private backpackTorch!: THREE.Object3D;

  private keyMesh!: THREE.Mesh;
  private gateMesh!: THREE.Mesh;
  private walls: THREE.Mesh[] = [];

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    onScore: (score: number) => void,
    onHealth: (health: number) => void, // countdown
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
    this.generateMaze();
    this.buildMaze3D();
    this.initPlayer();
    this.initLandscape();
    this.animate(0);
  }

  private initScene() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    this.scene = THREE.Scene ? new THREE.Scene() : new (THREE as any).Scene();
    // High contrast slate indigo background
    this.scene.background = new THREE.Color(0x1e1e2f);
    this.scene.fog = new THREE.FogExp2(0x1e1e2f, 0.02);

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    this.camera.position.set(0, 11, 4);

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
    // Elevate dungeon fill levels so player can clearly see maze pathways and exits
    const dungeonAmbient = new THREE.AmbientLight(0x4b437a, 2.6);
    this.scene.add(dungeonAmbient);

    // Moonlight tint
    const moon = new THREE.DirectionalLight(0x818cf8, 2.5);
    moon.position.set(10, 25, 10);
    this.scene.add(moon);

    // Warm high luminosity explorer spotlight held by player
    const explorerSpotlight = new THREE.PointLight(0xfffae0, 6.0, 24);
    explorerSpotlight.position.set(0, 1.8, 0);
    this.scene.add(explorerSpotlight);
    (this as any).playerLight = explorerSpotlight;
  }

  private generateMaze() {
    this.mazeGrid = [];
    for (let x = 0; x < this.gridSizeX; x++) {
      this.mazeGrid[x] = [];
      for (let y = 0; y < this.gridSizeY; y++) {
        this.mazeGrid[x][y] = {
          x,
          y,
          visited: false,
          walls: [true, true, true, true],
        };
      }
    }

    const stack: MazeCell[] = [];
    const startCell = this.mazeGrid[0][0];
    startCell.visited = true;
    stack.push(startCell);

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors = this.getNeighbors(current);

      if (neighbors.length > 0) {
        const next = neighbors[Math.floor(Math.random() * neighbors.length)];
        this.removeWallsBetween(current, next);
        next.visited = true;
        stack.push(next);
      } else {
        stack.pop();
      }
    }
  }

  private getNeighbors(cell: MazeCell): MazeCell[] {
    const neighbors: MazeCell[] = [];
    const { x, y } = cell;

    if (y > 0 && !this.mazeGrid[x][y - 1].visited) neighbors.push(this.mazeGrid[x][y - 1]); // Top
    if (x < this.gridSizeX - 1 && !this.mazeGrid[x + 1][y].visited) neighbors.push(this.mazeGrid[x + 1][y]); // Right
    if (y < this.gridSizeY - 1 && !this.mazeGrid[x][y + 1].visited) neighbors.push(this.mazeGrid[x][y + 1]); // Bottom
    if (x > 0 && !this.mazeGrid[x - 1][y].visited) neighbors.push(this.mazeGrid[x - 1][y]); // Left

    return neighbors;
  }

  private removeWallsBetween(c1: MazeCell, c2: MazeCell) {
    const diffX = c1.x - c2.x;
    const diffY = c1.y - c2.y;

    if (diffX === 1) {
      c1.walls[3] = false;
      c2.walls[1] = false;
    } else if (diffX === -1) {
      c1.walls[1] = false;
      c2.walls[3] = false;
    }

    if (diffY === 1) {
      c1.walls[0] = false;
      c2.walls[2] = false;
    } else if (diffY === -1) {
      c1.walls[2] = false;
      c2.walls[0] = false;
    }
  }

  private gridTo3D(gx: number, gy: number): THREE.Vector3 {
    const centerOffsetZ = ((this.gridSizeY - 1) * this.cellSize) / 2;
    const centerOffsetX = ((this.gridSizeX - 1) * this.cellSize) / 2;
    return new THREE.Vector3(
      gx * this.cellSize - centerOffsetX,
      0,
      gy * this.cellSize - centerOffsetZ
    );
  }

  private buildMaze3D() {
    const wallThickness = 0.65;
    const wallGeomH = new THREE.BoxGeometry(this.cellSize, this.wallHeight, wallThickness);
    const wallGeomV = new THREE.BoxGeometry(wallThickness, this.wallHeight, this.cellSize);
    
    // Ancient mossy castle stone wall
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.9,
      metalness: 0.1,
    });

    const floorGeom = new THREE.PlaneGeometry(120, 120);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0f0d, roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Build physical brick structures
    for (let x = 0; x < this.gridSizeX; x++) {
      for (let y = 0; y < this.gridSizeY; y++) {
        const cell = this.mazeGrid[x][y];
        const cellCenter = this.gridTo3D(x, y);

        // Top wall
        if (cell.walls[0]) {
          const w = new THREE.Mesh(wallGeomH, wallMat);
          w.position.set(cellCenter.x, this.wallHeight / 2, cellCenter.z - this.cellSize / 2);
          w.castShadow = true;
          w.receiveShadow = true;
          this.scene.add(w);
          this.walls.push(w);
        }
        // Right wall
        if (cell.walls[1]) {
          const w = new THREE.Mesh(wallGeomV, wallMat);
          w.position.set(cellCenter.x + this.cellSize / 2, this.wallHeight / 2, cellCenter.z);
          w.castShadow = true;
          w.receiveShadow = true;
          this.scene.add(w);
          this.walls.push(w);
        }
        // Bottom wall
        if (cell.walls[2]) {
          const w = new THREE.Mesh(wallGeomH, wallMat);
          w.position.set(cellCenter.x, this.wallHeight / 2, cellCenter.z + this.cellSize / 2);
          w.castShadow = true;
          w.receiveShadow = true;
          this.scene.add(w);
          this.walls.push(w);
        }
        // Left wall
        if (cell.walls[3]) {
          const w = new THREE.Mesh(wallGeomV, wallMat);
          w.position.set(cellCenter.x - this.cellSize / 2, this.wallHeight / 2, cellCenter.z);
          w.castShadow = true;
          w.receiveShadow = true;
          this.scene.add(w);
          this.walls.push(w);
        }
      }
    }

    // Place key torus ring at bottom-right cell
    const farCornerPos = this.gridTo3D(this.gridSizeX - 1, this.gridSizeY - 1);
    this.keyPos.set(farCornerPos.x, 1.25, farCornerPos.z);

    const keyGeom = new THREE.TorusGeometry(0.48, 0.14, 8, 24);
    const keyMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xd97706,
      emissiveIntensity: 1.4,
      roughness: 0.1,
      metalness: 0.9,
    });
    this.keyMesh = new THREE.Mesh(keyGeom, keyMat);
    this.keyMesh.position.copy(this.keyPos);
    this.scene.add(this.keyMesh);

    // Place portal gate at top-right
    const gateCellPos = this.gridTo3D(this.gridSizeX - 1, 0);
    this.gatePos.set(gateCellPos.x, 0, gateCellPos.z);

    const gateGeom = new THREE.BoxGeometry(2.4, 4.0, 0.4);
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.9,
    });
    this.gateMesh = new THREE.Mesh(gateGeom, gateMat);
    this.gateMesh.position.set(this.gatePos.x, 2.0, this.gatePos.z);
    this.scene.add(this.gateMesh);

    // Inner portal glowing core
    const coreGeom = new THREE.PlaneGeometry(1.8, 3.4);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x00f5ff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const portalCore = new THREE.Mesh(coreGeom, coreMat);
    portalCore.position.set(0, 0, 0.22);
    this.gateMesh.add(portalCore);
  }

  // --- HIGH-FIDELITY HUMANOID MEDIEVAL EXPLORER ---
  private initPlayer() {
    this.playerPos.copy(this.gridTo3D(0, 0)).add(new THREE.Vector3(0, 0.8, 0));

    this.playerMesh = new THREE.Group();

    // 1. Torso chest armor
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7, // Royal Purple velvet explorer tunic
      roughness: 0.3,
      metalness: 0.4,
    });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.35), armorMat);
    torso.position.y = 0.95;
    torso.castShadow = true;
    this.playerMesh.add(torso);

    // 2. Head explorer helmet
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.45, 0);
    
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), armorMat);
    headGroup.add(helm);

    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
    goggles.position.set(0, 0.04, 0.18);
    headGroup.add(goggles);

    this.playerMesh.add(headGroup);

    // 3. Legs
    this.playerLegL = new THREE.Group();
    this.playerLegL.position.set(-0.16, 0.55, 0);
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.5, 6), armorMat);
    legL.position.y = -0.25;
    this.playerLegL.add(legL);
    this.playerMesh.add(this.playerLegL);

    this.playerLegR = new THREE.Group();
    this.playerLegR.position.set(0.16, 0.55, 0);
    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.5, 6), armorMat);
    legR.position.y = -0.25;
    this.playerLegR.add(legR);
    this.playerMesh.add(this.playerLegR);

    // 4. Arms (held forward holding a cylindrical torch!)
    this.playerArmL = new THREE.Group();
    this.playerArmL.position.set(-0.35, 1.15, 0.05);
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.45, 6), armorMat);
    armL.position.y = -0.2;
    this.playerArmL.add(armL);
    this.playerMesh.add(this.playerArmL);

    this.playerArmR = new THREE.Group();
    this.playerArmR.position.set(0.35, 1.15, 0.05);
    const armR = new THREE.Group();
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.45, 6), armorMat);
    forearm.position.y = -0.2;
    armR.add(forearm);
    this.playerArmR.add(armR);

    // Wooden Torch held in right hand pointing forward
    const torchGroup = new THREE.Group();
    torchGroup.position.set(0, -0.4, 0.2);
    torchGroup.rotation.x = -Math.PI / 3; // tilt forward

    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 5), woodMat);
    torchGroup.add(handle);

    // Glowing flame sphere at tip
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffea00 }));
    flame.position.y = 0.32;
    torchGroup.add(flame);

    armR.add(torchGroup);
    this.playerMesh.add(this.playerArmR);

    this.playerMesh.position.copy(this.playerPos);
    this.scene.add(this.playerMesh);
  }

  // --- CASTLE MOAT SCENIC LANDSCAPE ---
  private initLandscape() {
    // Castle Moat Water plane surrounding the entire labyrinth
    const moatGeom = new THREE.PlaneGeometry(160, 160);
    const moatMat = new THREE.MeshStandardMaterial({
      color: 0x05161f,
      roughness: 0.1,
      metalness: 0.9,
    });
    const moat = new THREE.Mesh(moatGeom, moatMat);
    moat.rotation.x = -Math.PI / 2;
    moat.position.y = -0.15; // slightly sunken moat
    this.scene.add(moat);

    // Overgrown spruce pine trees flanking side pathways
    const spawnCastlePine = (x: number, z: number) => {
      const tree = new THREE.Group();
      tree.position.set(x, 0, z);

      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4f260a, roughness: 0.9 });
      const foliageMat = new THREE.MeshStandardMaterial({ color: 0x064e3b, roughness: 0.7 });

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 2.0, 5), trunkMat);
      trunk.position.y = 1.0;
      tree.add(trunk);

      for (let i = 0; i < 3; i++) {
        const rad = 1.2 - i * 0.3;
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(rad, 1.4, 6), foliageMat);
        leaves.position.y = 1.8 + i * 1.0;
        tree.add(leaves);
      }

      this.scene.add(tree);
    };

    // Plant trees in safety banks outside maze boundary walls
    for (let x = -36; x <= 36; x += 18) {
      spawnCastlePine(x, -36);
      spawnCastlePine(x, 36);
    }
  }

  public movePlayer(vx: number, vz: number, delta: number) {
    if (this.status !== 'PLAYING') return;

    const moveSpeed = 10.0;
    const offsetVectorX = vx * moveSpeed * delta;
    const offsetVectorZ = vz * moveSpeed * delta;

    // Independent axis movement sliding for robustness
    const candidatePosX = this.playerPos.clone();
    candidatePosX.x += offsetVectorX;

    if (!this.checkWallCollision(candidatePosX, 0.72)) {
      this.playerPos.x = candidatePosX.x;
    }

    const candidatePosZ = this.playerPos.clone();
    candidatePosZ.z += offsetVectorZ;

    if (!this.checkWallCollision(candidatePosZ, 0.72)) {
      this.playerPos.z = candidatePosZ.z;
    }

    this.playerMesh.position.copy(this.playerPos);

    // Yaw look orientation
    if (vx !== 0 || vz !== 0) {
      const angle = Math.atan2(vx, vz);
      this.playerMesh.rotation.y = angle;

      // Animate walking limbs
      const swingCycle = Math.sin(this.timeElapsed * 16);
      this.playerLegL.rotation.x = swingCycle * 0.75;
      this.playerLegR.rotation.x = -swingCycle * 0.75;
      this.playerArmL.rotation.x = -swingCycle * 0.5;
    } else {
      this.playerLegL.rotation.x = 0;
      this.playerLegR.rotation.x = 0;
      this.playerArmL.rotation.x = 0;
    }
  }

  private checkWallCollision(testPos: THREE.Vector3, radius: number): boolean {
    for (const w of this.walls) {
      const box = new THREE.Box3().setFromObject(w);
      const testMin = new THREE.Vector3(testPos.x - radius, 0, testPos.z - radius);
      const testMax = new THREE.Vector3(testPos.x + radius, this.wallHeight, testPos.z + radius);
      const testBox = new THREE.Box3(testMin, testMax);

      if (box.intersectsBox(testBox)) {
        return true;
      }
    }
    return false;
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

    // Count down clocks
    this.timeLeft = Math.max(0, this.timeLeft - delta);
    this.onHealth(Math.ceil(this.timeLeft));

    if (this.timeLeft <= 0) {
      this.die('GAMEOVER');
    }

    // Spin key mesh
    if (!this.hasKey) {
      this.keyMesh.rotation.y += 2.5 * delta;
      this.keyMesh.rotation.x += 1.2 * delta;

      const distToKey = this.playerPos.distanceTo(this.keyPos);
      if (distToKey < 1.6) {
        this.hasKey = true;
        this.score += 500;
        this.onScore(this.score);
        this.scene.remove(this.keyMesh);

        // Flash key portal indicator green
        (this.gateMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x22c55e);
      }
    }

    // Portal exit reach check
    const distToGate = this.playerPos.distanceTo(new THREE.Vector3(this.gatePos.x, 0.8, this.gatePos.z));
    if (distToGate < 1.8) {
      if (this.hasKey) {
        this.score += Math.floor(this.timeLeft * 20);
        this.onScore(this.score);
        this.die('VICTORY');
      }
    }

    // Flashlight spotlight held follows the player coordinate
    if ((this as any).playerLight) {
      (this as any).playerLight.position.set(this.playerPos.x, 1.8, this.playerPos.z);
    }

    // Over-the-shoulder overhead camera smoothing follow
    const camTargetX = this.playerPos.x;
    const camTargetZ = this.playerPos.z + 5.5; // offset backwards
    const camTargetY = 11.0;

    this.camera.position.x += (camTargetX - this.camera.position.x) * 6 * delta;
    this.camera.position.z += (camTargetZ - this.camera.position.z) * 6 * delta;
    this.camera.position.y += (camTargetY - this.camera.position.y) * 6 * delta;

    this.camera.lookAt(new THREE.Vector3(this.playerPos.x, 0.2, this.playerPos.z - 1.0));
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

  public getMazeInfo(): string {
    return this.hasKey ? '🔑 KEY ACQUIRED: Make haste to the Portal!' : '🔍 Dungeon Quest: Locate the Golden Key!';
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
