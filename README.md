# Neon WebGL 3D Game Portal 🎮🕹️

A highly polished, high-performance, single-page WebGL 3D game launcher built natively with **Vite**, **React**, **Three.js**, and **Tailwind CSS**. 

Runs fully client-side on mobile and desktop viewports, with automatic LocalStorage data persistence, progression engines, and touch interface overlays. Designed specifically for instant **GitHub Pages** deployment.

---

## 🚀 Key Features

- **5 IMMERSIVE 3D RENDER GAMES**:
  1. **Endless Runner (Highway Dodge)**: Maneuver between lanes, dodge neon walls, and gather magnetic collection spheres as the speed escalates.
  2. **3D Car Racing (Drift Speedway)**: Drift around an elliptical racecourse against active AI speedsters with a discharging nitro booster gauge.
  3. **Zombie Survival Shooter (Overhead FPS)**: Defend a warehouse perimeter against creeping green zombies using a raycast laser scope and reload delays.
  4. **3D Maze Escape (Fog Labyrinth)**: Roam procedurally randomized mazes blanketed in a heavy fog of war, find the golden key, and portal home.
  5. **Space Shooter (Delta Fighter)**: Scroll through starfields, blast incoming asteroid hazards and waves of alien drones, and bring down the giant Mothership boss.
- **Cyberpunk Dark-Neon Graphic Pairing**: Elegant glassmorphic dashboard HUD with neon cards, hover reflections, and responsive scale transitions.
- **Player Stats & Badge Unleash**: Real-time Level/XP progression engine, custom trophy list, and continuous high-score metrics kept securely in LocalStorage.
- **Adaptive Inputs Configuration**: Play smoothly using mouse cursor coordinates and WASD controls on desktop, or virtual virtual joysticks/action buttons on mobile.
- **Vitals HUD Indicators**: Real-time trackers for shields, lap cycles, countdown timers, and bullet magazine reload states.

---

## 📁 Modular Architecture

This project is fully structured as a modular static application:
- `/public/data/` & `/public/config/`: Static JSON metrics and XML hardware control parameters queryable locally or via CDN.
- `/src/types.ts`: Strictly declared TypeScript interfaces for unified game statuses, settings, and player records.
- `/src/games/`: Self-contained Three.js simulation engines handles frame rendering, lighting vectors, collision meshes, and particle systems.
- `/src/components/`: Modular glassmorphic dashboards and stages with a responsive `ResizeObserver` listener.

---

## 🌍 GitHub Pages Deployment (Step-by-Step)

Deploying this static WebGL portal directly to GitHub Pages takes less than 2 minutes and requires zero backend/server setups!

### 1. Push Code to GitHub
Create a new GitHub repository and push this compiled project folder:
```bash
git init
git add .
git commit -m "Initialize 3D game portal suite"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

### 2. Configure GitHub Pages
1. Open your repository page on **GitHub.com**.
2. Go to the **Settings** tab.
3. Click on the **Pages** sub-section inside the left sidebar.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
5. Choose your target branch (usually `main`) and root folder (select `/` or `/docs`), then click **Save**.

### 3. Automated Build Action (Highly Recommended)
Alternatively, since this is a React/Vite project, configure a lightweight GitHub Action to build and deploy for you instantly on every commit!
Create a file under `.github/workflows/deploy.yml`:
```yaml
name: Build and Deploy Game Portal
on:
  push:
    branches: [ main ]
permissions:
  contents: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - uses: JamesIves/github-pages-deploy-action@v4
        with:
          folder: dist
          branch: gh-pages
```

Once that Action runs, head to **Settings** -> **Pages** in your repository and set the default tracking branch to **gh-pages**. Your neon gaming portal is officially live!
