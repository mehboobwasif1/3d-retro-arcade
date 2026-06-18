import * as THREE from 'three';
import { GameSettings, GameStatus } from '../types';

interface ScannedAsset {
  id: string;
  type: 'tree' | 'rock' | 'water';
  x: number;
  z: number;
  y: number;
  scale: number;
  scanned: boolean;
  name: string;
}

export class LandscapeGame {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private onScore: (score: number) => void;
  private onHealth: (health: number) => void; // Represents flora diversity mapping percentage
  private onStatus: (status: GameStatus) => void;
  private settings: GameSettings;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private animationFrameId: number | null = null;

  // Sandbox variables
  private score = 0;
  private mappingProgress = 0;
  private status: GameStatus = 'PLAYING';
  private timeElapsed = 0;
  private generatorSeed = 42;
  private currentTerrainStyle: 'forest' | 'tundra' | 'lava' | 'cyber' = 'forest';
  private distributionMethod: 'uniform' | 'poisson' | 'cluster' = 'cluster';

  // Spawn parameters
  private treeCount = 45;
  private rockCount = 25;
  private waterCount = 3;

  // Math sizing
  private worldSize = 75; // boundary size

  // Player drone/rover pos
  private playerPos = new THREE.Vector3(0, 1.5, 0);
  private playerGroup!: THREE.Group;
  private playerLight!: THREE.PointLight;

  // Assets tracking lists
  private assetsData: ScannedAsset[] = [];
  private assetsMeshes: THREE.Object3D[] = [];
  private terrainMesh!: THREE.Mesh;
  private waterPlanes: THREE.Mesh[] = [];

  // UI elements created dynamically in DOM
  private uiOverlayPanel: HTMLDivElement | null = null;
  private toggleButton: HTMLButtonElement | null = null;
  private isPanelExpanded = window.innerWidth >= 768; // collapses by default on mobile!

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
    this.initPlayer();
    this.generateLandscape();
    this.createUIOverlay();
    this.animate(0);
  }

  private initScene() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    this.scene = THREE.Scene ? new THREE.Scene() : new (THREE as any).Scene();
    // Beautiful, high luminosity daylight dusk-blue sky yields maximum contrast
    this.scene.background = new THREE.Color(0x2b395e);
    this.scene.fog = new THREE.FogExp2(0x2b395e, 0.008);

    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 300);
    this.camera.position.set(0, 15, 18);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.settings.quality !== 'low',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    if (this.settings.shadows && this.settings.quality === 'high') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
  }

  private initLights() {
    // Highly elevated ambient fill levels so models are bright and clearly distinguishable
    const ambient = new THREE.AmbientLight(0x7387cc, 2.5);
    this.scene.add(ambient);

    const mainDirLight = new THREE.DirectionalLight(0xffffff, 2.8);
    mainDirLight.position.set(20, 45, 15);
    mainDirLight.castShadow = this.settings.shadows && this.settings.quality === 'high';
    if (mainDirLight.castShadow) {
      mainDirLight.shadow.mapSize.width = 1024;
      mainDirLight.shadow.mapSize.height = 1024;
      mainDirLight.shadow.camera.near = 0.5;
      mainDirLight.shadow.camera.far = 100;
      const d = 40;
      mainDirLight.shadow.camera.left = -d;
      mainDirLight.shadow.camera.right = d;
      mainDirLight.shadow.camera.top = d;
      mainDirLight.shadow.camera.bottom = -d;
    }
    this.scene.add(mainDirLight);
    (this as any).sunLight = mainDirLight;
  }

  private initPlayer() {
    this.playerGroup = new THREE.Group();

    // Sleek hexagonal scanning hover disc
    const ringGeom = new THREE.CylinderGeometry(0.8, 0.9, 0.25, 6);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      roughness: 0.2,
      metalness: 0.8,
    });
    const disc = new THREE.Mesh(ringGeom, ringMat);
    disc.castShadow = true;
    this.playerGroup.add(disc);

    // Dynamic scanning emitter head
    const scannerGeom = new THREE.SphereGeometry(0.3, 8, 8);
    const scannerMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const scanner = new THREE.Mesh(scannerGeom, scannerMat);
    scanner.position.set(0, 0.22, -0.45);
    this.playerGroup.add(scanner);

    // Soft floating scanning light rays (downward spotlight)
    this.playerLight = new THREE.PointLight(0x10b981, 3.5, 12, 1.5);
    this.playerLight.position.set(0, -0.5, 0);
    this.playerGroup.add(this.playerLight);

    this.playerGroup.position.copy(this.playerPos);
    this.scene.add(this.playerGroup);
  }

  // --- SEED-BASED PSEUDO-RANDOM GENERATOR ---
  private randomFromSeed(s: number): () => number {
    let mask = 0xffffffff;
    let m_w = (123456789 + s) & mask;
    let m_z = (987654321 - s) & mask;
    return () => {
      m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & mask;
      m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & mask;
      let result = ((m_z << 16) + m_w) & mask;
      result /= 4294967296;
      return result + 0.5;
    };
  }

  // Height function based on current coordinates & seed inputs
  private getTerrainHeight(x: number, z: number): number {
    const seedOffset = this.generatorSeed * 0.73;
    // Layered trigonometric low-poly noise
    const hill1 = Math.sin(x * 0.08 + seedOffset) * Math.cos(z * 0.08 - seedOffset) * 4.5;
    const hill2 = Math.cos(x * 0.03 + seedOffset * 1.5) * Math.sin(z * 0.03 + seedOffset) * 2.8;
    const microDetail = Math.sin(x * 0.25) * Math.cos(z * 0.25) * 0.45;
    
    // Central valley dip
    const distanceToCenter = Math.sqrt(x * x + z * z);
    const valleyFactor = Math.max(0, Math.min(1, (distanceToCenter - 10) / 30));

    return (hill1 + hill2 + microDetail) * valleyFactor - 0.5;
  }

  private generateLandscape() {
    this.clearLandscapeMeshes();

    const qualitySteps = this.settings.quality === 'low' ? 16 : this.settings.quality === 'medium' ? 32 : 54;
    const terrainGeom = new THREE.PlaneGeometry(this.worldSize, this.worldSize, qualitySteps, qualitySteps);
    
    // Deform plane mesh using our height function
    const pos = terrainGeom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      // We map Z in 3D to Plane's horizontal Y axes
      const height = this.getTerrainHeight(px, py);
      pos.setZ(i, height);
    }
    terrainGeom.computeVertexNormals();

    // Style properties according to preset theme
    let terrainColor = 0x14532d; // Forest dark green
    let fogColor = 0x020617;
    let groundMetalness = 0.05;
    let groundRoughness = 0.95;

    if (this.currentTerrainStyle === 'tundra') {
      terrainColor = 0xe2e8f0; // Snow light blue/grey
      fogColor = 0x0f172a;
      groundRoughness = 0.85;
    } else if (this.currentTerrainStyle === 'lava') {
      terrainColor = 0x1e1b4b; // Deep purple obsidian soil
      fogColor = 0x0c040d;
      groundMetalness = 0.2;
    } else if (this.currentTerrainStyle === 'cyber') {
      terrainColor = 0x090514; // Cyber grid floor
      fogColor = 0x03000a;
      groundMetalness = 0.8;
      groundRoughness = 0.3;
    }

    this.scene.background = new THREE.Color(fogColor);
    this.scene.fog = new THREE.FogExp2(fogColor, 0.016);

    const terrainMat = new THREE.MeshStandardMaterial({
      color: terrainColor,
      roughness: groundRoughness,
      metalness: groundMetalness,
      flatShading: true, // critical for low-poly look!
    });

    this.terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    this.terrainMesh.rotation.x = -Math.PI / 2;
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = false;
    this.scene.add(this.terrainMesh);

    // Spawning coordinate mapping array
    const rand = this.randomFromSeed(this.generatorSeed);
    this.assetsData = [];

    // --- RANDOM COORDINATE MAPPING ALGORITHMS ---
    const generatedCoords: { x: number; z: number }[] = [];

    const spawnCount = this.treeCount + this.rockCount + (this.waterCount * 6);
    let attemptsLimit = spawnCount * 5;

    // Center clusters coordinates for the 'cluster' algorithm
    const clusters: { x: number; z: number }[] = [];
    for (let c = 0; c < 5; c++) {
      clusters.push({
        x: (rand() - 0.5) * (this.worldSize * 0.65),
        z: (rand() - 0.5) * (this.worldSize * 0.65),
      });
    }

    let spawnIndex = 0;
    while (generatedCoords.length < spawnCount && attemptsLimit > 0) {
      attemptsLimit--;
      let cx = 0;
      let cz = 0;

      if (this.distributionMethod === 'uniform') {
        cx = (rand() - 0.5) * (this.worldSize * 0.85);
        cz = (rand() - 0.5) * (this.worldSize * 0.85);
      } else if (this.distributionMethod === 'poisson') {
        // Poisson approximation via jittered virtual grid cells
        const cellSize = 6.0;
        const colCount = Math.floor(this.worldSize / cellSize);
        const cellX = Math.floor(rand() * colCount) - colCount / 2;
        const cellZ = Math.floor(rand() * colCount) - colCount / 2;
        const jitterX = (rand() - 0.5) * cellSize * 0.82;
        const jitterZ = (rand() - 0.5) * cellSize * 0.82;
        cx = cellX * cellSize + jitterX;
        cz = cellZ * cellSize + jitterZ;
      } else {
        // Clustering/ groves around hubs
        const parentCluster = clusters[Math.floor(rand() * clusters.length)];
        // Normal gaussian spread approximation
        const spreadRad = 4.0 + rand() * 8.0;
        const angle = rand() * Math.PI * 2;
        cx = parentCluster.x + Math.cos(angle) * spreadRad;
        cz = parentCluster.z + Math.sin(angle) * spreadRad;
      }

      // Constrain inside boundaries
      const boundLimit = (this.worldSize * 0.85) / 2;
      cx = Math.max(-boundLimit, Math.min(boundLimit, cx));
      cz = Math.max(-boundLimit, Math.min(boundLimit, cz));

      // Avoid spawning directly on center spot to keep player landing zone spacious
      if (Math.abs(cx) < 5.0 && Math.abs(cz) < 5.0) continue;

      // Ensure min distance spacing from prior objects to prevent clipping overlapping
      let overlapping = false;
      for (const prior of generatedCoords) {
        const dx = prior.x - cx;
        const dz = prior.z - cz;
        if (Math.sqrt(dx * dx + dz * dz) < 2.5) {
          overlapping = true;
          break;
        }
      }

      if (!overlapping) {
        generatedCoords.push({ x: cx, z: cz });
      }
    }

    // Now populate coordinate mapping to asset data models
    let assetCount = 0;

    // 1. Water bodies / Lake bodies (spawning first to layout under rocks/trees)
    for (let w = 0; w < this.waterCount; w++) {
      if (generatedCoords.length === 0) break;
      const coord = generatedCoords.pop()!;
      this.assetsData.push({
        id: `water_${assetCount++}`,
        type: 'water',
        x: coord.x,
        z: coord.z,
        y: -1.2,
        scale: 4.5 + rand() * 5.0,
        scanned: false,
        name: `Liquid Basin #${Math.floor(rand() * 899) + 100}`,
      });
    }

    // 2. Rocks
    for (let r = 0; r < this.rockCount; r++) {
      if (generatedCoords.length === 0) break;
      const coord = generatedCoords.pop()!;
      this.assetsData.push({
        id: `rock_${assetCount++}`,
        type: 'rock',
        x: coord.x,
        z: coord.z,
        y: this.getTerrainHeight(coord.x, coord.z),
        scale: 0.65 + rand() * 1.8,
        scanned: false,
        name: `Boulder Block #${Math.floor(rand() * 899) + 100}`,
      });
    }

    // 3. Trees
    for (let t = 0; t < this.treeCount; t++) {
      if (generatedCoords.length === 0) break;
      const coord = generatedCoords.pop()!;
      this.assetsData.push({
        id: `tree_${assetCount++}`,
        type: 'tree',
        x: coord.x,
        z: coord.z,
        y: this.getTerrainHeight(coord.x, coord.z),
        scale: 0.8 + rand() * 1.45,
        scanned: false,
        name: `Low-Poly Flora #${Math.floor(rand() * 899) + 100}`,
      });
    }

    // Build the visual 3D geometries based on the models
    this.assetsData.forEach((asset) => {
      if (asset.type === 'tree') {
        const treeGroup = new THREE.Group();
        treeGroup.position.set(asset.x, asset.y, asset.z);
        treeGroup.scale.setScalar(asset.scale);

        // Brown trunk
        const trunkGeom = new THREE.CylinderGeometry(0.12, 0.22, 1.2, 5);
        let woodHex = 0x78350f;
        if (this.currentTerrainStyle === 'lava') woodHex = 0x1e293b; // Charred cobalt tree trunks
        if (this.currentTerrainStyle === 'cyber') woodHex = 0x06b6d4; // Cyan grid trunks

        const trunkMat = new THREE.MeshStandardMaterial({ color: woodHex, roughness: 0.9, flatShading: true });
        const trunk = new THREE.Mesh(trunkGeom, trunkMat);
        trunk.position.y = 0.6;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        treeGroup.add(trunk);

        // Nested cascading foliar cones
        let leafHex = 0x059669; // Classic green
        if (this.currentTerrainStyle === 'tundra') leafHex = 0x0d9488; // Teal pine needle trees
        if (this.currentTerrainStyle === 'lava') leafHex = 0xe11d48; // Ember-red leaves
        if (this.currentTerrainStyle === 'cyber') leafHex = 0xd946ef; // Hologram pink leaves

        const leafMat = new THREE.MeshStandardMaterial({
          color: leafHex,
          roughness: 0.75,
          flatShading: true,
        });

        for (let i = 0; i < 3; i++) {
          const coneRadius = 0.95 - (i * 0.22);
          const coneHeight = 1.15 - (i * 0.15);
          const foliageMesh = new THREE.Mesh(new THREE.ConeGeometry(coneRadius, coneHeight, 5), leafMat);
          foliageMesh.position.y = 1.3 + (i * 0.55);
          foliageMesh.castShadow = true;
          foliageMesh.receiveShadow = true;
          treeGroup.add(foliageMesh);
        }

        // Attach specific ID tag to look it up in raycast/collision easily
        treeGroup.userData = { id: asset.id };
        this.scene.add(treeGroup);
        this.assetsMeshes.push(treeGroup);

      } else if (asset.type === 'rock') {
        const rockHeight = asset.y + (asset.scale * 0.3);
        const rockGeom = new THREE.DodecahedronGeometry(asset.scale, 0);
        
        let rockHex = 0x475569; // Gray shale
        if (this.currentTerrainStyle === 'tundra') rockHex = 0x64748b; // Glacial frosty slate
        if (this.currentTerrainStyle === 'lava') rockHex = 0x0f172a; // Pitch-black hard obsidian
        if (this.currentTerrainStyle === 'cyber') rockHex = 0x4f46e5; // Glowing purple nodes

        const rockMat = new THREE.MeshStandardMaterial({
          color: rockHex,
          roughness: 0.82,
          metalness: this.currentTerrainStyle === 'cyber' ? 0.75 : 0.1,
          flatShading: true,
        });

        const rockMesh = new THREE.Mesh(rockGeom, rockMat);
        rockMesh.position.set(asset.x, rockHeight, asset.z);
        // Add random tilt
        rockMesh.rotation.set(rand() * 2, rand() * 2, rand() * 2);
        rockMesh.castShadow = true;
        rockMesh.receiveShadow = true;
        
        rockMesh.userData = { id: asset.id };
        this.scene.add(rockMesh);
        this.assetsMeshes.push(rockMesh);

      } else if (asset.type === 'water') {
        // Deep round basin plate with water material edge ring styling
        const waterGroup = new THREE.Group();
        waterGroup.position.set(asset.x, asset.y, asset.z);

        let waterHex = 0x0284c7; // Vibrant dynamic pool blue
        let emissiveHex = 0x024c7a;
        if (this.currentTerrainStyle === 'lava') { waterHex = 0xf97316; emissiveHex = 0xe11d4fb3; } // Magma fire pool
        if (this.currentTerrainStyle === 'cyber') { waterHex = 0xff007f; emissiveHex = 0xaa0033; } // Holographic code pool

        const diskGeom = new THREE.CylinderGeometry(asset.scale, asset.scale * 1.1, 0.4, 8);
        const waterMat = new THREE.MeshStandardMaterial({
          color: waterHex,
          emissive: emissiveHex,
          emissiveIntensity: 1.2,
          roughness: 0.05,
          metalness: 0.9,
          transparent: true,
          opacity: 0.78,
          flatShading: true,
        });
        const disk = new THREE.Mesh(diskGeom, waterMat);
        disk.castShadow = false;
        disk.receiveShadow = true;
        waterGroup.add(disk);

        // Outer rock shore ring
        const rockRingCount = 5;
        const ringRockGeom = new THREE.DodecahedronGeometry(0.35, 0);
        const ringRockMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
        for (let ri = 0; ri < rockRingCount; ri++) {
          const tAngle = (ri / rockRingCount) * Math.PI * 2;
          const rRing = new THREE.Mesh(ringRockGeom, ringRockMat);
          rRing.position.set(Math.cos(tAngle) * (asset.scale * 0.9), 0.1, Math.sin(tAngle) * (asset.scale * 0.9));
          waterGroup.add(rRing);
        }

        waterGroup.userData = { id: asset.id };
        this.scene.add(waterGroup);
        this.assetsMeshes.push(waterGroup);
      }
    });

    this.calculateMappingProgress();
    this.updateWaterGridCoordinates();
  }

  private clearLandscapeMeshes() {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh = null as any;
    }

    this.assetsMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    });
    this.assetsMeshes = [];
    this.waterPlanes = [];
    this.assetsData = [];
  }

  private updateWaterGridCoordinates() {
    this.waterPlanes = [];
    this.assetsMeshes.forEach((mesh) => {
      if (mesh.userData && mesh.userData.id && mesh.userData.id.startsWith('water_')) {
        mesh.traverse((m) => {
          if (m instanceof THREE.Mesh && m.material && ('emissive' in m.material)) {
            this.waterPlanes.push(m);
          }
        });
      }
    });
  }

  private calculateMappingProgress() {
    if (this.assetsData.length === 0) return;
    const mapped = this.assetsData.filter((a) => a.scanned).length;
    this.mappingProgress = Math.round((mapped / this.assetsData.length) * 100);
    this.onHealth(this.mappingProgress); // onHealth maps HUD progress bar percentage
  }

  // --- INTERACTIVE CODES & PARAMETERS UI PANEL ---
  private syncPanelDisplay() {
    if (!this.uiOverlayPanel || !this.toggleButton) return;
    if (this.isPanelExpanded) {
      this.uiOverlayPanel.style.display = 'block';
      this.toggleButton.innerHTML = `✕ CLOSE PANEL`;
      this.toggleButton.className = 'absolute left-4 top-20 bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-[11px] tracking-widest uppercase rounded-xl px-4 py-2.5 z-20 pointer-events-auto shadow-lg flex items-center gap-1.5 cursor-pointer font-mono border border-rose-450 transition-all';
    } else {
      this.uiOverlayPanel.style.display = 'none';
      this.toggleButton.innerHTML = `⚙️ CONFIGURE BIOME`;
      this.toggleButton.className = 'absolute left-4 top-20 bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-[11px] tracking-widest uppercase rounded-xl px-4 py-2.5 z-20 pointer-events-auto shadow-lg flex items-center gap-1.5 cursor-pointer font-mono border border-emerald-300 transition-all';
    }
  }

  private createUIOverlay() {
    // Check if duplicate elements exist and clean them
    const priorElement = document.getElementById('landscape-sandbox-dashboard-overlay');
    if (priorElement && priorElement.parentNode) {
      priorElement.parentNode.removeChild(priorElement);
    }
    const priorToggle = document.getElementById('landscape-sandbox-toggle-btn');
    if (priorToggle && priorToggle.parentNode) {
      priorToggle.parentNode.removeChild(priorToggle);
    }

    // Toggle button to expand/collapse panel to satisfy touch screen & mobile views
    this.toggleButton = document.createElement('button');
    this.toggleButton.id = 'landscape-sandbox-toggle-btn';
    this.container.appendChild(this.toggleButton);

    this.toggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isPanelExpanded = !this.isPanelExpanded;
      this.syncPanelDisplay();
    });

    this.uiOverlayPanel = document.createElement('div');
    this.uiOverlayPanel.id = 'landscape-sandbox-dashboard-overlay';
    // Position slightly below to accommodate the toggle-button without intersection overlap
    this.uiOverlayPanel.className = 'absolute left-4 top-36 bg-slate-950/85 border border-emerald-500/30 rounded-2xl p-4 w-72 sm:w-80 text-slate-100 z-10 pointer-events-auto shadow-[0_0_25px_rgba(16,185,129,0.15)] space-y-4 max-h-[60vh] overflow-y-auto backdrop-blur-md select-none font-mono text-left transition-all hover:border-emerald-400/50';

    this.renderUIContent();
    this.container.appendChild(this.uiOverlayPanel);

    // Initial draw synchronization
    this.syncPanelDisplay();
  }

  private renderUIContent() {
    if (!this.uiOverlayPanel) return;

    this.uiOverlayPanel.innerHTML = `
      <div class="space-y-1">
        <div class="flex justify-between items-center bg-emerald-950/40 p-2 rounded-lg border border-emerald-500/20">
          <span class="text-xs uppercase font-extrabold text-emerald-400 tracking-wider flex items-center gap-1">🌲 Eco Sandbox Config</span>
          <span class="text-[10px] uppercase bg-emerald-500/20 text-emerald-200 py-0.5 px-2 rounded font-extrabold">${this.currentTerrainStyle}</span>
        </div>
      </div>

      <div class="space-y-3">
        <!-- 1. Preset Style Selector -->
        <div class="space-y-1">
          <label class="text-[9px] text-emerald-300 font-semibold tracking-wider uppercase">Landscape Theme Preset</label>
          <div class="grid grid-cols-2 gap-1 text-[9px]">
            <button id="style-forest" class="py-1 rounded text-center border capitalize ${this.currentTerrainStyle === 'forest' ? 'bg-emerald-500/20 border-emerald-400 text-emerald-100' : 'bg-slate-900 border-slate-800 text-slate-400'}">Valley Forest</button>
            <button id="style-tundra" class="py-1 rounded text-center border capitalize ${this.currentTerrainStyle === 'tundra' ? 'bg-emerald-500/20 border-emerald-400 text-emerald-100' : 'bg-slate-900 border-slate-800 text-slate-400'}">Snowy Tundra</button>
            <button id="style-lava" class="py-1 rounded text-center border capitalize ${this.currentTerrainStyle === 'lava' ? 'bg-emerald-500/20 border-emerald-400 text-emerald-100' : 'bg-slate-900 border-slate-800 text-slate-400'}">Lava Obsidian</button>
            <button id="style-cyber" class="py-1 rounded text-center border capitalize ${this.currentTerrainStyle === 'cyber' ? 'bg-emerald-500/20 border-emerald-400 text-emerald-100' : 'bg-slate-900 border-slate-800 text-slate-400'}">Cyber Grid</button>
          </div>
        </div>

        <!-- 2. Mapping Distribution Method -->
        <div class="space-y-1">
          <label class="text-[9px] text-emerald-300 font-semibold tracking-wider uppercase">Distribution Map Math</label>
          <select id="dist-select" class="w-full bg-slate-900 border border-slate-800 rounded py-1 px-2 text-[10px] text-cyan-300 focus:outline-none">
            <option value="cluster" ${this.distributionMethod === 'cluster' ? 'selected' : ''}>Groves Clustering (Biomic)</option>
            <option value="poisson" ${this.distributionMethod === 'poisson' ? 'selected' : ''}>Jitter Grid (Poisson Approx)</option>
            <option value="uniform" ${this.distributionMethod === 'uniform' ? 'selected' : ''}>Pure Random (Uniform)</option>
          </select>
        </div>

        <!-- 3. Dynamic sliders counts -->
        <div class="space-y-2 pt-1 border-t border-slate-800 text-[9px]">
          <div>
            <div class="flex justify-between font-mono mb-0.5">
              <span class="text-slate-400 uppercase">Tree Density:</span>
              <span class="text-emerald-400 font-bold">${this.treeCount} pcs</span>
            </div>
            <input type="range" id="slider-trees" min="15" max="110" step="5" value="${this.treeCount}" class="w-full accent-emerald-500 h-1 bg-slate-800 rounded" />
          </div>
          <div>
            <div class="flex justify-between font-mono mb-0.5">
              <span class="text-slate-400 uppercase">Rock Outcrops:</span>
              <span class="text-emerald-400 font-bold">${this.rockCount} pcs</span>
            </div>
            <input type="range" id="slider-rocks" min="8" max="75" step="3" value="${this.rockCount}" class="w-full accent-emerald-500 h-1 bg-slate-800 rounded" />
          </div>
          <div>
            <div class="flex justify-between font-mono mb-0.5">
              <span class="text-slate-400 uppercase">Primal Ponds:</span>
              <span class="text-emerald-400 font-bold">${this.waterCount} bodies</span>
            </div>
            <input type="range" id="slider-water" min="1" max="6" step="1" value="${this.waterCount}" class="w-full accent-emerald-500 h-1 bg-slate-800 rounded" />
          </div>
        </div>

        <!-- 4. Seed trigger action -->
        <div class="flex gap-2 text-[9px] pt-1">
          <button id="btn-seed-reroll" class="flex-1 py-1.5 bg-slate-900 border border-emerald-500/40 rounded hover:bg-slate-850 text-center font-bold text-emerald-400 hover:text-emerald-300">Reroll Seed</button>
          <button id="btn-seed-apply" class="flex-1 py-1.5 bg-emerald-500/20 border border-emerald-500 rounded hover:bg-emerald-500/35 text-center font-bold text-white uppercase">Regenerate</button>
        </div>
      </div>

      <!-- Minimap 2D coordinate view -->
      <div class="pt-2 border-t border-slate-800">
        <label class="text-[9px] text-cyan-300 font-semibold uppercase block mb-1">Randomized Coordinate Minimap</label>
        <div class="bg-slate-950/90 border border-slate-900 w-full aspect-square rounded-xl relative overflow-hidden flex items-center justify-center relative p-1" id="ui-coord-minimap">
          <!-- Dynamically plotted dot indicators -->
          <div class="absolute inset-0 border border-emerald-500/5 grid grid-cols-4 pointer-events-none select-none">
            <div class="border-r border-b border-emerald-500/5"></div>
            <div class="border-r border-b border-emerald-500/5"></div>
            <div class="border-r border-b border-emerald-500/5"></div>
            <div class="border-b border-emerald-500/5"></div>
          </div>
          <div id="minimap-contents" class="relative w-full h-full"></div>
        </div>
        <div class="flex justify-between text-[8px] font-mono mt-1 text-slate-500 px-1 uppercase">
          <span>X: -37.5</span>
          <span class="text-emerald-400 tracking-wider">🟢 Grid map scale: low-poly</span>
          <span>X: +37.5</span>
        </div>
      </div>

      <!-- Scanned logs lists -->
      <div class="pt-2 border-t border-slate-800 space-y-1.5">
        <label class="text-[9px] text-emerald-300 font-semibold uppercase block">Environmental Logs Map</label>
        <div id="ui-scan-logs" class="space-y-1 max-h-24 overflow-y-auto pr-1 text-[8px] text-slate-400 font-mono">
          <div class="text-[8px] text-slate-500 text-center py-2 italic uppercase">// Drone scanning grid system active...</div>
        </div>
      </div>
    `;

    // Attaching dynamic listeners
    this.attachElementsListeners();
    this.plotMinimapDots();
    this.updateScanLogsList();
  }

  private attachElementsListeners() {
    if (!this.uiOverlayPanel) return;
    const s = this.uiOverlayPanel;

    // Theme preset clicks
    s.querySelector('#style-forest')?.addEventListener('click', () => { this.currentTerrainStyle = 'forest'; this.renderUIContent(); this.generateLandscape(); });
    s.querySelector('#style-tundra')?.addEventListener('click', () => { this.currentTerrainStyle = 'tundra'; this.renderUIContent(); this.generateLandscape(); });
    s.querySelector('#style-lava')?.addEventListener('click', () => { this.currentTerrainStyle = 'lava'; this.renderUIContent(); this.generateLandscape(); });
    s.querySelector('#style-cyber')?.addEventListener('click', () => { this.currentTerrainStyle = 'cyber'; this.renderUIContent(); this.generateLandscape(); });

    // Slider inputs
    s.querySelector('#dist-select')?.addEventListener('change', (e: any) => {
      this.distributionMethod = e.target.value;
    });
    s.querySelector('#slider-trees')?.addEventListener('input', (e: any) => {
      this.treeCount = parseInt(e.target.value);
      const span = s.querySelector('#slider-trees')?.previousElementSibling?.querySelector('span');
      if (span) span.innerText = `${this.treeCount} pcs`;
    });
    s.querySelector('#slider-rocks')?.addEventListener('input', (e: any) => {
      this.rockCount = parseInt(e.target.value);
      const span = s.querySelector('#slider-rocks')?.previousElementSibling?.querySelector('span');
      if (span) span.innerText = `${this.rockCount} pcs`;
    });
    s.querySelector('#slider-water')?.addEventListener('input', (e: any) => {
      this.waterCount = parseInt(e.target.value);
      const span = s.querySelector('#slider-water')?.previousElementSibling?.querySelector('span');
      if (span) span.innerText = `${this.waterCount} bodies`;
    });

    s.querySelector('#btn-seed-reroll')?.addEventListener('click', () => {
      this.generatorSeed = Math.floor(Math.random() * 9999);
      this.renderUIContent();
      this.generateLandscape();
    });

    s.querySelector('#btn-seed-apply')?.addEventListener('click', () => {
      this.generateLandscape();
      this.renderUIContent();
    });
  }

  private plotMinimapDots() {
    if (!this.uiOverlayPanel) return;
    const minimapContents = this.uiOverlayPanel.querySelector('#minimap-contents');
    if (!minimapContents) return;

    minimapContents.innerHTML = '';

    // Boundary maps: worldSize corresponds to full minimap dimensions
    const widthPercentageMultiplier = 100 / this.worldSize;

    this.assetsData.forEach((asset) => {
      // Map [-half, +half] coordinate grid into [0, 100] coordinates
      const mappedX = (asset.x + this.worldSize / 2) * widthPercentageMultiplier;
      const mappedZ = (asset.z + this.worldSize / 2) * widthPercentageMultiplier;

      const dot = document.createElement('div');
      dot.className = `absolute w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2 transition border ${
        asset.scanned 
          ? 'bg-emerald-400 border-white scale-125 z-10 shadow-[0_0_6px_#10b981]' 
          : asset.type === 'water' 
          ? 'bg-blue-400 border-blue-900' 
          : asset.type === 'rock' 
          ? 'bg-slate-400 border-slate-600' 
          : 'bg-emerald-700/80 border-emerald-500'
      }`;
      dot.style.left = `${mappedX}%`;
      dot.style.top = `${mappedZ}%`;
      dot.title = `${asset.name} at: [X:${asset.x.toFixed(1)}, Z:${asset.z.toFixed(1)}]`;
      
      // Let minimap dots double up as teleport coordinates scanner!
      dot.style.cursor = 'pointer';
      dot.addEventListener('click', () => {
        this.playerPos.set(asset.x, 1.5, asset.z);
        this.playerGroup.position.copy(this.playerPos);
      });

      minimapContents.appendChild(dot);
    });

    // Add Player icon coordinates to the minimap
    const pX = (this.playerPos.x + this.worldSize / 2) * widthPercentageMultiplier;
    const pZ = (this.playerPos.z + this.worldSize / 2) * widthPercentageMultiplier;

    const playerDot = document.createElement('div');
    playerDot.id = 'minimap-player-node';
    playerDot.className = 'absolute w-2 h-2 bg-red-500 border border-white rounded-full -translate-x-1/2 -translate-y-1/2 z-20 shadow-[0_0_8px_#ef4444] animate-ping';
    playerDot.style.left = `${pX}%`;
    playerDot.style.top = `${pZ}%`;
    minimapContents.appendChild(playerDot);
  }

  private updateMinimapPlayerPosition() {
    if (!this.uiOverlayPanel) return;
    const playerDot = this.uiOverlayPanel.querySelector('#minimap-player-node') as HTMLDivElement;
    if (!playerDot) return;

    const widthPercentageMultiplier = 100 / this.worldSize;
    const pX = (this.playerPos.x + this.worldSize / 2) * widthPercentageMultiplier;
    const pZ = (this.playerPos.z + this.worldSize / 2) * widthPercentageMultiplier;

    playerDot.style.left = `${pX}%`;
    playerDot.style.top = `${pZ}%`;
  }

  private updateScanLogsList() {
    if (!this.uiOverlayPanel) return;
    const logsContainer = this.uiOverlayPanel.querySelector('#ui-scan-logs');
    if (!logsContainer) return;

    logsContainer.innerHTML = '';
    
    const logs = this.assetsData
      .filter((a) => a.scanned)
      .slice(-6)
      .reverse();

    if (logs.length === 0) {
      logsContainer.innerHTML = `<div class="text-[8px] text-slate-500 text-center py-2 italic uppercase">// Float near assets to scan coordinates...</div>`;
      return;
    }

    logs.forEach((log) => {
      const row = document.createElement('div');
      row.className = 'flex justify-between border-b border-emerald-950/20 py-0.5 text-slate-300';
      row.innerHTML = `
        <span class="text-emerald-400 font-bold">[${log.type.toUpperCase()}]</span>
        <span>${log.name}</span>
        <span class="text-cyan-400">X:${log.x.toFixed(1)}, Z:${log.z.toFixed(1)}</span>
      `;
      logsContainer.appendChild(row);
    });
  }

  public movePlayer(vx: number, vz: number, delta: number) {
    if (this.status !== 'PLAYING') return;

    const moveSpeed = 16.0;
    const offsetVectorX = vx * moveSpeed * delta;
    const offsetVectorZ = vz * moveSpeed * delta;

    // Direct movement bounded by coordinates boundary
    const boundaryValue = (this.worldSize * 0.85) / 2;
    this.playerPos.x = Math.max(-boundaryValue, Math.min(boundaryValue, this.playerPos.x + offsetVectorX));
    this.playerPos.z = Math.max(-boundaryValue, Math.min(boundaryValue, this.playerPos.z + offsetVectorZ));

    // Stick drone elegantly to our hilly terrain surface with a nice hover cushion
    const groundHeight = this.getTerrainHeight(this.playerPos.x, this.playerPos.z);
    const cushion = 1.35;
    this.playerPos.y = groundHeight + cushion;

    this.playerGroup.position.copy(this.playerPos);

    // Face player group relative to glide vector direction
    if (vx !== 0 || vz !== 0) {
      const angle = Math.atan2(vx, vz);
      this.playerGroup.rotation.y = angle;
    }

    this.updateMinimapPlayerPosition();
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

    // Hover amplitude animations
    const floatFactor = Math.sin(this.timeElapsed * 4.0) * 0.12;
    this.playerGroup.position.y += floatFactor;

    // Slowly rotate scan disk
    this.playerGroup.rotation.y += 0.8 * delta;

    // Raycast or simply distance-check asset scans
    let logsModified = false;
    this.assetsData.forEach((asset, idx) => {
      if (asset.scanned) return;

      const dx = asset.x - this.playerPos.x;
      const dz = asset.z - this.playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Probe distance scanning range
      if (dist < 3.2) {
        asset.scanned = true;
        this.score += 150;
        this.onScore(this.score);
        logsModified = true;

        // Custom micro animation scale feedback
        const parentMesh = this.assetsMeshes[idx];
        if (parentMesh) {
          parentMesh.scale.addScalar(0.45);
          setTimeout(() => {
            if (parentMesh) parentMesh.scale.addScalar(-0.45);
          }, 120);
        }
      }
    });

    if (logsModified) {
      this.calculateMappingProgress();
      this.plotMinimapDots();
      this.updateScanLogsList();

      // Achievement unlock score thresholds
      if (this.mappingProgress >= 100) {
        this.die('VICTORY');
      }
    }

    // Dynamic wave updates on water bodies
    this.waterPlanes.forEach((plane, idx) => {
      plane.rotation.y += (idx % 2 === 0 ? 0.22 : -0.15) * delta;
    });

    // Elegant float third person orbit follow camera
    const orbitDistance = 14.0;
    const heightElevation = 7.5;
    const camTargetX = this.playerPos.x;
    const camTargetZ = this.playerPos.z + orbitDistance;
    const camTargetY = this.playerPos.y + heightElevation;

    this.camera.position.x += (camTargetX - this.camera.position.x) * 4.2 * delta;
    this.camera.position.z += (camTargetZ - this.camera.position.z) * 4.2 * delta;
    this.camera.position.y += (camTargetY - this.camera.position.y) * 4.2 * delta;

    this.camera.lookAt(new THREE.Vector3(this.playerPos.x, this.playerPos.y - 0.5, this.playerPos.z));
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

  public getLandscapeInfo(): string {
    return `🌲 DIVERSITY LEVEL MAPPING: ${this.mappingProgress}% | SEED: ${this.generatorSeed}`;
  }

  public resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public pause() {
    this.status = 'PAUSED';
    this.onStatus('PAUSED');
    if (this.uiOverlayPanel) {
      this.uiOverlayPanel.style.opacity = '0.15';
      this.uiOverlayPanel.style.pointerEvents = 'none';
    }
  }

  public resume() {
    this.status = 'PLAYING';
    this.onStatus('PLAYING');
    if (this.uiOverlayPanel) {
      this.uiOverlayPanel.style.opacity = '1';
      this.uiOverlayPanel.style.pointerEvents = 'auto';
    }
    this.lastTime = performance.now();
    this.animate(this.lastTime);
  }

  public destroy() {
    this.status = 'GAMEOVER';
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Safely delete dinamics UI container nodes
    if (this.uiOverlayPanel && this.uiOverlayPanel.parentNode) {
      this.uiOverlayPanel.parentNode.removeChild(this.uiOverlayPanel);
      this.uiOverlayPanel = null;
    }

    if (this.toggleButton && this.toggleButton.parentNode) {
      this.toggleButton.parentNode.removeChild(this.toggleButton);
      this.toggleButton = null;
    }

    this.clearLandscapeMeshes();
    this.scene.clear();
    this.renderer.dispose();
  }
}
