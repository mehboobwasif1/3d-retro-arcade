import React, { useEffect, useRef, useState } from 'react';
import { GameId, GameSettings, GameStatus } from '../types';
import { RunnerGame } from '../games/RunnerGame';
import { RacingGame } from '../games/RacingGame';
import { ZombieGame } from '../games/ZombieGame';
import { MazeGame } from '../games/MazeGame';
import { SpaceGame } from '../games/SpaceGame';
import { LandscapeGame } from '../games/LandscapeGame';
import { ArrowLeft, Play, RotateCcw, VolumeX, Volume2, Shield, Flame, Target } from 'lucide-react';

interface GameStageProps {
  gameId: GameId;
  settings: GameSettings;
  onExit: () => void;
  onSaveHighScore: (gameId: GameId, score: number) => void;
}

export default function GameStage({
  gameId,
  settings,
  onExit,
  onSaveHighScore,
}: GameStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // References to active game instance
  const gameInstanceRef = useRef<any>(null);

  // Gameplay state
  const [score, setScore] = useState(0);
  const [health, setHealth] = useState(100);
  const [gameStatus, setGameStatus] = useState<GameStatus>('LOADING');
  const [showGuide, setShowGuide] = useState<boolean>(true);

  // Resilient status reference for tracking in high frequency polling loop
  const gameStatusRef = useRef<GameStatus>('LOADING');
  useEffect(() => {
    gameStatusRef.current = gameStatus;
  }, [gameStatus]);

  // Track cursor movement triggers to switch between PC mouse look and directional look
  const lastMouseTimeRef = useRef<number>(0);

  // Input states tracking for virtual controller holding loops
  const keyboardKeysRef = useRef<{ [key: string]: boolean }>({});
  const virtualMovementRef = useRef({ left: false, right: false, up: false, down: false, actionA: false, actionB: false });

  // Custom metadata overlay parameters
  const [gameSpecificMeta, setGameSpecificMeta] = useState<string>('');

  useEffect(() => {
    // 1. Let the system load
    setGameStatus('LOADING');
    setScore(0);
    setHealth(100);

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // 2. Setup resizing observer
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (gameInstanceRef.current) {
        gameInstanceRef.current.resize(width, height);
      }
    });
    resizeObserver.observe(container);

    // Initial size parameters
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    // 3. Instantiate Game engines Based on gameId
    let gameInstance: any = null;

    try {
      if (gameId === 'runner') {
        gameInstance = new RunnerGame(
          container,
          canvas,
          (s) => setScore(s),
          (h) => setHealth(h),
          (stat) => setGameStatus(stat),
          settings
        );
      } else if (gameId === 'racing') {
        gameInstance = new RacingGame(
          container,
          canvas,
          (s) => setScore(s),
          (nitro) => setHealth(nitro), // health represents Nitro fuel percentage
          (stat) => setGameStatus(stat),
          settings
        );
      } else if (gameId === 'zombie') {
        gameInstance = new ZombieGame(
          container,
          canvas,
          (s) => setScore(s),
          (h) => setHealth(h),
          (stat) => setGameStatus(stat),
          settings
        );
      } else if (gameId === 'maze') {
        gameInstance = new MazeGame(
          container,
          canvas,
          (s) => setScore(s),
          (secondsLeft) => setHealth(secondsLeft), // health represents timer countdown
          (stat) => setGameStatus(stat),
          settings
        );
      } else if (gameId === 'space') {
        gameInstance = new SpaceGame(
          container,
          canvas,
          (s) => setScore(s),
          (h) => setHealth(h),
          (stat) => setGameStatus(stat),
          settings
        );
      } else if (gameId === 'landscape') {
        gameInstance = new LandscapeGame(
          container,
          canvas,
          (s) => setScore(s),
          (progress) => setHealth(progress),
          (stat) => setGameStatus(stat),
          settings
        );
      }

      gameInstanceRef.current = gameInstance;
      if (showGuide) {
        setGameStatus('PAUSED');
        if (gameInstance && gameInstance.pause) gameInstance.pause();
      } else {
        setGameStatus('PLAYING');
      }
    } catch (err) {
      console.error('Error starting 3D game:', err);
      setGameStatus('GAMEOVER');
    }

    // 4. Bind keyboard events
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keyboardKeysRef.current[key] = true;

      if (!gameInstance) return;

      // Single triggers
      if (gameId === 'runner') {
        if (key === 'a' || e.key === 'ArrowLeft') gameInstance.moveLeft();
        if (key === 'd' || e.key === 'ArrowRight') gameInstance.moveRight();
        if (e.key === ' ' || key === 'w' || e.key === 'ArrowUp') gameInstance.jump();
      } else if (gameId === 'zombie') {
        if (key === 'r') gameInstance.reload();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keyboardKeysRef.current[key] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Mouse aiming handler for top-down Zombie survival shooter
    const handleMouseMove = (e: MouseEvent) => {
      if (gameId !== 'zombie' || !gameInstanceRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Register timestamp to bypass directional keyboard auto-alignment
      lastMouseTimeRef.current = Date.now();

      // Project mouse angle from center of canvas viewport
      const dx = mouseX - rect.width / 2;
      const dy = mouseY - rect.height / 2;
      gameInstanceRef.current.updateAimAngle(dx, dy);
    };

    const handleMouseClick = (e: MouseEvent) => {
      if (gameId === 'zombie' && gameInstanceRef.current) {
        gameInstanceRef.current.fireBullet();
      }
    };

    if (gameId === 'zombie') {
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mousedown', handleMouseClick);
    }

    // 5. Game input poll timer loop (60 ticks/s)
    const inputPollInterval = setInterval(() => {
      const inst = gameInstanceRef.current;
      if (!inst || gameStatusRef.current !== 'PLAYING') return;

      const keys = keyboardKeysRef.current;
      const v = virtualMovementRef.current;

      // Unify physical keyboard coordinates + virtual HUD controllers
      if (gameId === 'racing') {
        if (keys['w'] || keys['arrowup'] || v.up) inst.accelerate();
        if (keys['s'] || keys['arrowdown'] || v.down) inst.brake();
        if (keys['a'] || keys['arrowleft'] || v.left) inst.steerLeft();
        if (keys['d'] || keys['arrowright'] || v.right) inst.steerRight();
        
        // Nitro trigger (Shift or action click)
        inst.triggerNitro(!!keys['shift'] || v.actionA);

        // Update custom subtitle racing metrics in HUD
        if (inst.getLapInfo) {
          setGameSpecificMeta(`${inst.getLapInfo()} | Speed: ${inst.getSpeed()} MPH`);
        }
      } else if (gameId === 'zombie') {
        let vx = 0;
        let vz = 0;
        if (keys['a'] || keys['arrowleft'] || v.left) vx = -1;
        if (keys['d'] || keys['arrowright'] || v.right) vx = 1;
        if (keys['w'] || keys['arrowup'] || v.up) vz = -1;
        if (keys['s'] || keys['arrowdown'] || v.down) vz = 1;

        inst.move(vx, vz, 0.016);

        // Auto-aim based on movement under mobile configurations, or if no PC mouse actions inside 1.5s
        if (vx !== 0 || vz !== 0) {
          if (settings.mobileControls || (Date.now() - lastMouseTimeRef.current > 1500)) {
            inst.updateAimAngle(vx, vz);
          }
        }

        // Fire bullets under spacebar pressed or held, or virtual touch Action A held
        if (keys[' '] || v.actionA) {
          inst.fireBullet();
        }

        if (inst.getAmmoInfo) {
          setGameSpecificMeta(`${inst.getWaveHeader()} | AMMO: ${inst.getAmmoInfo()}`);
        }
      } else if (gameId === 'maze') {
        let vx = 0;
        let vz = 0;
        if (keys['a'] || keys['arrowleft'] || v.left) vx = -1;
        if (keys['d'] || keys['arrowright'] || v.right) vx = 1;
        if (keys['w'] || keys['arrowup'] || v.up) vz = -1;
        if (keys['s'] || keys['arrowdown'] || v.down) vz = 1;

        inst.movePlayer(vx, vz, 0.016);
        
        if (inst.getMazeInfo) {
          setGameSpecificMeta(inst.getMazeInfo());
        }
      } else if (gameId === 'space') {
        const step = 0.3;
        if (keys['a'] || keys['arrowleft'] || v.left) inst.steerX(-step);
        if (keys['d'] || keys['arrowright'] || v.right) inst.steerX(step);
        if (keys['w'] || keys['arrowup'] || v.up) inst.steerZ(-step);
        if (keys['s'] || keys['arrowdown'] || v.down) inst.steerZ(step);

        if (keys[' '] || v.actionA || v.actionB) {
          inst.fireLaser();
        }

        if (inst.isBossActive && inst.isBossActive()) {
          setGameSpecificMeta(`⚠️ RED ALERT: BOSS INCOMING | BOSS HP: ${inst.getBossProgress()}`);
        } else {
          setGameSpecificMeta(`DEEP SPACE SECTOR | SQUAD WAVE`);
        }
      } else if (gameId === 'landscape') {
        let vx = 0;
        let vz = 0;
        if (keys['a'] || keys['arrowleft'] || v.left) vx = -1;
        if (keys['d'] || keys['arrowright'] || v.right) vx = 1;
        if (keys['w'] || keys['arrowup'] || v.up) vz = -1;
        if (keys['s'] || keys['arrowdown'] || v.down) vz = 1;

        inst.movePlayer(vx, vz, 0.016);

        if (inst.getLandscapeInfo) {
          setGameSpecificMeta(inst.getLandscapeInfo());
        }
      } else if (gameId === 'runner') {
        // Continuous keyboard holding speed controls
        if (keys['w'] || keys['arrowup'] || v.up) inst.speedUp(0.12);
        if (keys['s'] || keys['arrowdown'] || v.down) inst.slowDown(0.12);
        if (v.left) { inst.moveLeft(); v.left = false; }
        if (v.right) { inst.moveRight(); v.right = false; }
        if (v.up || v.actionA) { inst.jump(); v.up = false; v.actionA = false; }
      }
    }, 16);

    // 6. Tear down component
    return () => {
      clearInterval(inputPollInterval);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      
      if (gameId === 'zombie' && canvas) {
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mousedown', handleMouseClick);
      }

      resizeObserver.disconnect();
      if (gameInstanceRef.current) {
        gameInstanceRef.current.destroy();
        gameInstanceRef.current = null;
      }
    };
  }, [gameId]);

  // Handle final high scores check on game over or victory
  useEffect(() => {
    if (gameStatus === 'GAMEOVER' || gameStatus === 'VICTORY') {
      onSaveHighScore(gameId, score);
    }
  }, [gameStatus, score, gameId]);

  const handleRestart = () => {
    // Exit current load cycle momentarily to force component constructor recreation
    setGameStatus('LOADING');
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 150);
  };

  const handlePauseToggle = () => {
    const inst = gameInstanceRef.current;
    if (!inst) return;

    if (gameStatus === 'PLAYING') {
      inst.pause();
      setGameStatus('PAUSED');
    } else if (gameStatus === 'PAUSED') {
      inst.resume();
      setGameStatus('PLAYING');
    }
  };

  const handleStartGame = () => {
    setShowGuide(false);
    setGameStatus('PLAYING');
    if (gameInstanceRef.current && gameInstanceRef.current.resume) {
      gameInstanceRef.current.resume();
    }
  };

  const handleToggleGuide = () => {
    const inst = gameInstanceRef.current;
    if (!inst) return;

    if (showGuide) {
      setShowGuide(false);
      setGameStatus('PLAYING');
      if (inst.resume) inst.resume();
    } else {
      setShowGuide(true);
      setGameStatus('PAUSED');
      if (inst.pause) inst.pause();
    }
  };

  const getGameGuideContent = () => {
    switch (gameId) {
      case 'runner':
        return {
          title: 'ENDLESS NEON RUNNER',
          description: 'Sprint through a towering synthwave city, jump over roadblocks, absorb glowing credit rings with your magnetizer, and establish the ultimate high score!',
          controls: [
            { key: 'A / D or ◀ / ▶', action: 'Shift lanes left / right' },
            { key: 'W / Space or ▲', action: 'Jump over flat concrete barriers' },
            { key: 'W / S or ▲ / ▼', action: 'Throttle scale speed faster / slower' },
            { key: 'Red Tall Obstacles', action: 'Must be dodged (cannot jump over!)' },
            { key: 'Blue Torus Ring', action: 'Magnet powerup (automatically absorbs coins)' },
          ]
        };
      case 'racing':
        return {
          title: '3D CYBER RACING',
          description: 'Steer a high-performance vector sports car on a shorelined tropical island circuit. Burn nitrous oxide to blast past AI competitors and dominate 3 laps!',
          controls: [
            { key: 'W / S or ▲ / ▼', action: 'Accelerate / brake & reverse' },
            { key: 'A / D or ◀ / ▶', action: 'Steer vector sports car' },
            { key: 'Shift / Action A', action: 'Ignite Nitro Fuel speed booster!' },
            { key: 'Yellow Cones', action: 'Road barriers that slow you down' },
            { key: 'Laps To Win', action: 'Complete 3 full laps around the elliptical track' },
          ]
        };
      case 'zombie':
        return {
          title: 'SPOOKY ZOMBIE FPS',
          description: 'Survive endless tactical waves of cyber-infected undead! Face them head-on using a rapid-fire laser rifle.',
          controls: [
            { key: 'W/A/S/D or Arrows', action: 'Walk in all horizontal directions' },
            { key: 'Mouse & Left Click', action: 'Aim & shoot laser rifle at zombies' },
            { key: 'Spacebar', action: 'Shoot laser rifle in walking direction' },
            { key: 'R Key', action: 'Reload laser rifle when out of ammunition' },
            { key: 'Mobile Touch Controls', action: 'Move via D-Pad (auto-aim is enabled) and shoot with Action A button!' },
          ]
        };
      case 'maze':
        return {
          title: 'PROCEDURAL LABYRINTH',
          description: 'Trapped inside a dark concrete construct! Reposition the camera overlays, seek out the glowing golden key, and lock-on to the cyan escape portal before time expires!',
          controls: [
            { key: 'W/A/S/D or Arrows', action: 'Map traversal / movement' },
            { key: 'Goal 1', action: 'Find the glowing Gold Key mesh' },
            { key: 'Goal 2', action: 'Enter the Cyan Exit Lattice to escape the construct' },
            { key: 'Mobile D-Pad', action: 'Allows full walking and navigation' },
          ]
        };
      case 'space':
        return {
          title: 'STARFIGHTER SPACE SHOOTER',
          description: 'Hurtle through an deep cosmic asteroid field! Break incoming meteors and steel your lasers to survive the attack of the Alien Mothership!',
          controls: [
            { key: 'W/A/S/D or Arrows', action: 'Flight pitch and roll rotation' },
            { key: 'Spacebar / Action A', action: 'Shoot primary twin laser plasma blasts' },
            { key: 'Goal', action: 'Destroy asteroids to level-up, and hit the Boss Mothership to win!' },
          ]
        };
      case 'landscape':
        return {
          title: '3D PROXIMAL LANDSCAPE',
          description: 'Construct a cozy procedurally generated biome in a sandy grid. Tweak values to distribute deep oceans, hills, trees, and rocks.',
          controls: [
            { key: 'W/A/S/D or Arrows', action: 'Fly camera view around scene' },
            { key: 'Interactive Sliders', action: 'Tweak counts for trees and rocks in the UI panel' },
            { key: 'Regenerate Button', action: 'Form a brand new layout using randomized seeds' },
          ]
        };
      default:
        return {
          title: 'GAME MODULE CONTROLS',
          description: 'Review default keys to start gaming.',
          controls: [
            { key: 'W/A/S/D or Arrows', action: 'Standard movement vectors' },
            { key: 'Spacebar', action: 'Primary Action Trigger' },
          ]
        };
    }
  };

  // Virtual d-pad events handlers for mobile overlays
  const setVirtualMovement = (dir: 'left' | 'right' | 'up' | 'down', state: boolean) => {
    virtualMovementRef.current[dir] = state;
  };

  const setVirtualAction = (action: 'actionA' | 'actionB', state: boolean) => {
    virtualMovementRef.current[action] = state;
  };

  // Get localized game details
  const getGameTitle = () => {
    switch (gameId) {
      case 'runner': return 'Endless Runner';
      case 'racing': return '3D Car Racing';
      case 'zombie': return 'Spooky Zombie FPS';
      case 'maze': return 'Procedural Labyrinth';
      case 'space': return 'Starfighter Space Shooter';
      case 'landscape': return 'Landscape Generator';
      default: return 'WebGL Game';
    }
  };

  const isTimeLimitMaze = gameId === 'maze';
  const isRacingNitro = gameId === 'racing';
  const isLandscapeMapping = gameId === 'landscape';

  return (
    <div className="relative w-full h-[100vh] bg-black overflow-hidden flex flex-col justify-between">
      
      {/* HUD FLOATING TOP ROW */}
      <div className="absolute top-0 inset-x-0 p-4 z-20 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        
        {/* Left Side: Exit button + Name */}
        <div className="flex items-center gap-4 pointer-events-auto">
          <button
            onClick={onExit}
            className="p-2.5 bg-slate-900/80 hover:bg-red-950/40 border border-purple-500/30 rounded-xl text-purple-300 hover:text-red-400 transition cursor-pointer flex items-center gap-1 font-mono text-xs font-bold shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
            title="Exit to Portal"
            id="btn-hud-exit"
          >
            <ArrowLeft size={16} />
            EXIT PORTAL
          </button>
          
          <div className="text-left select-none">
            <h2 className="text-sm font-bold font-mono tracking-wider text-white uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
              {getGameTitle()}
            </h2>
            {gameSpecificMeta && (
              <span className="text-[10px] sm:text-xs font-mono text-cyan-400 block tracking-widest drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                {gameSpecificMeta}
              </span>
            )}
          </div>
        </div>

        {/* Center: Running score info */}
        <div className="bg-slate-900/90 border border-purple-500/30 rounded-2xl px-6 py-2 shadow-2xl backdrop-blur-md select-none pointer-events-auto flex flex-col items-center">
          <span className="text-[9px] font-mono text-purple-300 tracking-wider uppercase">Score</span>
          <span className="text-xl sm:text-2xl font-mono text-yellow-300 font-bold">{score.toLocaleString()}</span>
        </div>

        {/* Right Side: Pause triggers + Vital stats meters */}
        <div className="flex items-center gap-4 pointer-events-auto">
          
          {/* Health or timer progression slider bar */}
          <div className="bg-slate-950/80 border border-purple-500/20 rounded-xl px-4 py-2 flex items-center gap-2.5 shadow-lg select-none min-w-[124px]">
            {isTimeLimitMaze ? (
              <>
                <Target className="text-amber-400 animate-pulse" size={16} />
                <div className="text-left">
                  <div className="text-[8px] font-mono text-purple-300/60 uppercase">Seconds left</div>
                  <div className="text-sm font-mono font-bold text-amber-300">{health}s</div>
                </div>
              </>
            ) : isLandscapeMapping ? (
              <>
                <Flame className="text-emerald-400 animate-pulse" size={16} />
                <div className="text-left w-full">
                  <div className="text-[8px] font-mono text-purple-300/60 uppercase">Diversity Scan</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-emerald-300">{health}%</span>
                    <div className="w-16 h-1.5 bg-slate-900 border border-purple-500/30 rounded overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-200"
                        style={{ width: `${Math.max(0, Math.min(100, health))}%` }}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : isRacingNitro ? (
              <>
                <Flame className="text-fuchsia-400 animate-pulse animate-bounce" size={16} />
                <div className="text-left w-full">
                  <div className="text-[8px] font-mono text-purple-300/60 uppercase">Nitro Fuel</div>
                  <div className="w-20 h-2 bg-slate-900 border border-purple-500/30 rounded overflow-hidden mt-0.5">
                    <div
                      className="h-full bg-gradient-to-r from-fuchsia-600 to-cyan-400 transition-all duration-100"
                      style={{ width: `${Math.max(0, Math.min(100, health))}%` }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <Shield className="text-rose-400 animate-pulse" size={16} />
                <div className="text-left w-full">
                  <div className="text-[8px] font-mono text-purple-300/60 uppercase">Hull Vitality</div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-bold text-rose-300">{health}%</span>
                    <div className="w-16 h-1.5 bg-slate-900 border border-purple-500/30 rounded overflow-hidden">
                      <div
                        className="h-full bg-rose-500 transition-all duration-200"
                        style={{ width: `${Math.max(0, Math.min(100, health))}%` }}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleToggleGuide}
            className={`p-2.5 mr-2 bg-slate-900/80 border text-xs font-mono font-bold rounded-xl transition cursor-pointer shadow-lg ${showGuide ? 'border-yellow-400 text-yellow-100 shadow-[0_0_12px_rgba(234,179,8,0.3)] bg-slate-950' : 'border-yellow-600/30 text-yellow-400 hover:text-white'}`}
            title="How to Play"
            id="btn-hud-guide-toggle"
          >
            HELP / GUIDELINE
          </button>

          <button
            onClick={handlePauseToggle}
            className="p-2.5 bg-slate-900/80 border border-purple-500/30 rounded-xl text-cyan-400 hover:text-white transition cursor-pointer shadow-lg"
            title="Pause Match"
            id="btn-hud-pause"
          >
            <Play size={16} fill={gameStatus === 'PAUSED' ? 'currentColor' : 'none'} />
          </button>
        </div>

      </div>

      {/* CORE 3D STAGE CONTAINER canvas */}
      <div
        ref={containerRef}
        className="w-full h-full relative cursor-crosshair select-none bg-slate-950 flex items-center justify-center"
        id="canvas-3d-container"
      >
        <canvas ref={canvasRef} className="block w-full h-full outline-none" />

        {/* HOW TO PLAY / CONTROLS OVERSIGHT GUIDE OVERLAY */}
        {showGuide && (
          <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-lg z-40 flex items-center justify-center p-4">
            <div className="max-w-xl w-full bg-slate-100 dark:bg-slate-900 border border-purple-500/40 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_40px_rgba(168,85,247,0.25)] select-none animate-fade-in max-h-[90vh] overflow-y-auto text-slate-900 dark:text-white">
              {/* Header */}
              <div className="text-center space-y-1">
                <span className="text-xs font-mono text-cyan-500 font-bold uppercase block tracking-widest">// GRID DIRECTIVE</span>
                <h2 className="text-2xl md:text-3xl font-mono text-slate-900 dark:text-white tracking-tight font-extrabold uppercase">
                  {getGameGuideContent().title}
                </h2>
                <p className="text-xs text-slate-600 dark:text-purple-200/70 leading-relaxed max-w-md mx-auto">
                  {getGameGuideContent().description}
                </p>
              </div>

              {/* Controls Grid */}
              <div className="space-y-3 text-left">
                <span className="text-[10px] font-mono text-purple-600 dark:text-purple-400 font-bold uppercase tracking-wider block">Operational Controls:</span>
                <div className="space-y-2 bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 max-h-[40vh] overflow-y-auto">
                  {getGameGuideContent().controls.map((ctrl, index) => (
                    <div key={index} className="flex flex-col sm:flex-row justify-between sm:items-center py-2 border-b border-slate-100 dark:border-slate-900 last:border-0 gap-1 font-mono">
                      <span className="text-xs font-bold text-yellow-600 dark:text-yellow-300">{ctrl.key}</span>
                      <span className="text-[11px] text-slate-700 dark:text-purple-200">{ctrl.action}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dispatch Action Button */}
              <div className="text-center pt-2">
                <button
                  onClick={handleStartGame}
                  className="w-full sm:w-auto px-10 py-4 bg-gradient-to-r from-cyan-400 to-fuchsia-500 hover:from-cyan-300 hover:to-fuchsia-400 text-black font-extrabold font-mono text-sm tracking-widest rounded-xl transition cursor-pointer transform hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_rgba(168,85,247,0.4)]"
                  id="btn-guide-dismiss"
                >
                  INITIALIZE GAMEGRID
                </button>
              </div>
            </div>
          </div>
        )}

        {/* LOADING SHIELD SCREEN */}
        {gameStatus === 'LOADING' && (
          <div className="absolute inset-0 bg-slate-950/90 z-30 flex flex-col items-center justify-center gap-4 text-center select-none animate-pulse">
            <div className="inline-block relative w-16 h-16 border-4 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin shadow-[0_0_15px_rgba(6,182,212,0.5)]" />
            <div className="space-y-1">
              <h3 className="text-lg font-mono font-bold text-white uppercase tracking-widest">
                Compiling 3D Assets...
              </h3>
              <p className="text-xs text-purple-300/60 font-mono">
                // INITIALIZING THREE.js WEBGL RENDER SYSTEM
              </p>
            </div>
          </div>
        )}

        {/* PAUSE SHIELD OVERLAY STATE */}
        {gameStatus === 'PAUSED' && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-30 flex flex-col items-center justify-center gap-6">
            <div className="space-y-3 text-center">
              <h2 className="text-4xl font-mono tracking-tighter bg-gradient-to-r from-cyan-400 to-fuchsia-500 bg-clip-text text-transparent font-extrabold uppercase">
                Grid Suspended
              </h2>
              <p className="text-xs text-purple-300/40 font-mono">
                // ACTIVE LEVEL PARAMETERS MAINTAINED
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={handlePauseToggle}
                className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-xl text-sm font-mono tracking-wide transition cursor-pointer flex items-center gap-2 shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                id="btn-pause-resume"
              >
                <Play size={16} fill="currentColor" />
                RESUME RUN
              </button>
              <button
                onClick={handleRestart}
                className="px-6 py-3 bg-slate-950 hover:bg-slate-900 border border-purple-500/30 rounded-xl text-sm font-mono text-purple-300 tracking-wide transition cursor-pointer flex items-center gap-2"
                id="btn-pause-restart"
              >
                <RotateCcw size={16} />
                RETRY LEVEL
              </button>
            </div>
          </div>
        )}

        {/* GAME OVER STATE OVERLAY */}
        {gameStatus === 'GAMEOVER' && (
          <div className="absolute inset-0 bg-red-950/80 backdrop-blur-md z-30 flex flex-col items-center justify-center gap-6 animate-fade-in text-center p-4">
            <div className="space-y-3">
              <h2 className="text-5xl md:text-6xl font-mono tracking-tight font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-rose-500 to-red-800 drop-shadow-[0_0_15px_rgba(244,63,94,0.4)] uppercase">
                System Depleted
              </h2>
              <p className="text-xs md:text-sm text-rose-300/60 font-mono uppercase tracking-widest">
                // CRITICAL STRUCTURAL CRASH REGISTERED
              </p>
            </div>

            <div className="bg-slate-950/90 border border-red-500/30 rounded-2xl p-6 min-w-[280px] space-y-2">
              <div className="text-[10px] font-mono text-purple-300 uppercase">Current Score</div>
              <div className="text-4xl font-mono font-bold text-yellow-300">{score.toLocaleString()}</div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={handleRestart}
                className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-sm font-mono tracking-wider transition cursor-pointer flex items-center gap-2 shadow-[0_0_12px_rgba(244,63,94,0.4)]"
                id="btn-go-retry"
              >
                <RotateCcw size={16} className="animate-spin-slow" />
                RETRY LEVEL
              </button>
              <button
                onClick={onExit}
                className="px-6 py-3 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-sm font-mono text-slate-300 tracking-wider transition cursor-pointer"
                id="btn-go-exit"
              >
                BACK TO PORTAL
              </button>
            </div>
          </div>
        )}

        {/* VICTORY/WIN STATE OVERLAY */}
        {gameStatus === 'VICTORY' && (
          <div className="absolute inset-0 bg-emerald-950/80 backdrop-blur-md z-30 flex flex-col items-center justify-center gap-6 animate-fade-in text-center p-4">
            <div className="space-y-3">
              <h2 className="text-5xl md:text-6xl font-mono tracking-tight font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-emerald-400 to-teal-500 drop-shadow-[0_0_15px_rgba(52,211,153,0.4)] uppercase">
                Grid Dominated
              </h2>
              <p className="text-xs md:text-sm text-emerald-300/60 font-mono uppercase tracking-widest">
                // COMPLETED LEVEL PARAMETERS VICTORIOUSLY
              </p>
            </div>

            <div className="bg-slate-950/90 border border-emerald-500/30 rounded-2xl p-6 min-w-[280px] space-y-2">
              <div className="text-[10px] font-mono text-purple-300 uppercase">Final Victory Score</div>
              <div className="text-4xl font-mono font-bold text-yellow-300">{score.toLocaleString()}</div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={onExit}
                className="px-7 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-black font-extrabold rounded-xl text-sm font-mono tracking-wider transition cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                id="btn-victory-exit"
              >
                RETURN HOME
              </button>
              <button
                onClick={handleRestart}
                className="px-6 py-3.5 bg-slate-950 hover:bg-slate-900 border border-emerald-500/20 rounded-xl text-sm font-mono text-emerald-300 tracking-wider transition cursor-pointer flex items-center gap-2"
                id="btn-victory-retry"
              >
                <RotateCcw size={16} />
                RETREAD LEVEL
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FLOATING VIRTUAL HUD ON-SCREEN MOBILE CONTROLLER */}
      {settings.mobileControls && gameStatus === 'PLAYING' && (
        <div className="absolute inset-x-0 bottom-4 px-6 z-20 flex justify-between items-end pointer-events-none select-none">
          
          {/* LEFT SIDE: D-Pad navigation (W/S/A/D equivalent) */}
          <div className="flex flex-col items-center gap-2 pointer-events-auto bg-slate-950/40 p-4 rounded-3xl border border-purple-500/10 backdrop-blur-sm shadow-2xl">
            {/* Top row */}
            <button
              onTouchStart={() => setVirtualMovement('up', true)}
              onTouchEnd={() => setVirtualMovement('up', false)}
              onMouseDown={() => setVirtualMovement('up', true)}
              onMouseUp={() => setVirtualMovement('up', false)}
              onMouseLeave={() => setVirtualMovement('up', false)}
              className="w-12 h-12 bg-slate-900/90 active:bg-cyan-500 hover:active:text-black border border-purple-500/40 rounded-xl text-lg flex items-center justify-center font-mono text-cyan-400 transition transform duration-100 select-none shadow-md"
              id="vpad-up"
            >
              ▲
            </button>
            
            {/* Mid row */}
            <div className="flex gap-4">
              <button
                onTouchStart={() => setVirtualMovement('left', true)}
                onTouchEnd={() => setVirtualMovement('left', false)}
                onMouseDown={() => setVirtualMovement('left', true)}
                onMouseUp={() => setVirtualMovement('left', false)}
                onMouseLeave={() => setVirtualMovement('left', false)}
                className="w-12 h-12 bg-slate-900/90 active:bg-cyan-500 border border-purple-500/40 rounded-xl text-lg flex items-center justify-center font-mono text-cyan-400 transition select-none shadow-md"
                id="vpad-left"
              >
                ◀
              </button>
              <div className="w-12 h-12 flex items-center justify-center text-purple-600/30 font-mono text-[10px] select-none uppercase">
                Pad
              </div>
              <button
                onTouchStart={() => setVirtualMovement('right', true)}
                onTouchEnd={() => setVirtualMovement('right', false)}
                onMouseDown={() => setVirtualMovement('right', true)}
                onMouseUp={() => setVirtualMovement('right', false)}
                onMouseLeave={() => setVirtualMovement('right', false)}
                className="w-12 h-12 bg-slate-900/90 active:bg-cyan-500 border border-purple-500/40 rounded-xl text-lg flex items-center justify-center font-mono text-cyan-400 transition select-none shadow-md"
                id="vpad-right"
              >
                ▶
              </button>
            </div>

            {/* Bottom row */}
            <button
              onTouchStart={() => setVirtualMovement('down', true)}
              onTouchEnd={() => setVirtualMovement('down', false)}
              onMouseDown={() => setVirtualMovement('down', true)}
              onMouseUp={() => setVirtualMovement('down', false)}
              onMouseLeave={() => setVirtualMovement('down', false)}
              className="w-12 h-12 bg-slate-900/90 active:bg-cyan-500 border border-purple-500/40 rounded-xl text-lg flex items-center justify-center font-mono text-cyan-400 transition select-none shadow-md"
              id="vpad-down"
            >
              ▼
            </button>
          </div>

          {/* RIGHT SIDE: Action Buttons (Boosters, weapons, jumpers) */}
          <div className="flex gap-4 pointer-events-auto items-end bg-slate-950/40 p-4 rounded-3xl border border-purple-500/10 backdrop-blur-sm shadow-2xl">
            <div className="flex flex-col gap-2 items-center">
              <span className="text-[8px] font-mono text-purple-300">Action A</span>
              <button
                onTouchStart={() => setVirtualAction('actionA', true)}
                onTouchEnd={() => setVirtualAction('actionA', false)}
                onMouseDown={() => setVirtualAction('actionA', true)}
                onMouseUp={() => setVirtualAction('actionA', false)}
                onMouseLeave={() => setVirtualAction('actionA', false)}
                className="w-16 h-16 bg-gradient-to-tr from-fuchsia-950 to-purple-900 active:from-fuchsia-500 active:to-fuchsia-400 border border-fuchsia-500/50 rounded-full font-mono text-xs font-extrabold text-fuchsia-200 shadow-[0_0_12px_rgba(240,70,239,0.3)] hover:scale-105 active:scale-95 transition flex items-center justify-center uppercase select-none cursor-pointer"
                id="btn-vact-a"
              >
                Jump/Fire
              </button>
            </div>

            <div className="flex flex-col gap-2 items-center">
              <span className="text-[8px] font-mono text-purple-300">Action B</span>
              <button
                onTouchStart={() => setVirtualAction('actionB', true)}
                onTouchEnd={() => setVirtualAction('actionB', false)}
                onMouseDown={() => setVirtualAction('actionB', true)}
                onMouseUp={() => setVirtualAction('actionB', false)}
                onMouseLeave={() => setVirtualAction('actionB', false)}
                className="w-14 h-14 bg-gradient-to-tr from-slate-950 to-slate-800 active:from-cyan-500 active:to-cyan-400 border border-cyan-500/50 rounded-full font-mono text-[10px] text-cyan-200 shadow-md hover:scale-105 active:scale-95 transition flex items-center justify-center uppercase select-none cursor-pointer"
                id="btn-vact-b"
              >
                Modifier
              </button>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
