import React, { useState, useEffect } from 'react';
import { GameId, GameSettings, PlayerStats, GameMeta } from './types';
import MainDashboard from './components/MainDashboard';
import GameStage from './components/GameStage';
import { motion, AnimatePresence } from 'motion/react';

import runnerThumb from './assets/images/runner_thumbnail_1781531135830.jpg';
import racingThumb from './assets/images/racing_thumbnail_1781531161196.jpg';
import zombieThumb from './assets/images/zombie_thumbnail_1781531177862.jpg';
import mazeThumb from './assets/images/maze_thumbnail_1781531198104.jpg';
import spaceThumb from './assets/images/space_thumbnail_1781531218892.jpg';
import landscapeThumb from './assets/images/landscape_thumbnail_1781531234506.jpg';

const FALLBACK_GAMES: GameMeta[] = [
  {
    id: 'runner',
    name: 'Endless Runner',
    genre: 'Action Arcade',
    difficulty: 'medium',
    description: 'Zip through futuristic speedways, jumping gates and drawing in coins using magnet grids.',
    controls: 'A/D or Left/Right to steer. Space to jump.',
    accentColor: '#06b6d4',
    thumbnail: runnerThumb,
  },
  {
    id: 'racing',
    name: '3D Car Racing Game',
    genre: 'Racing Simulator',
    difficulty: 'hard',
    description: 'Steer a cybernetic vehicle on an elliptical racing speedway with drift slippage and nitro meters.',
    controls: 'W/S for Gas/Brake, A/D to steer, Shift for Nitro.',
    accentColor: '#d946ef',
    thumbnail: racingThumb,
  },
  {
    id: 'zombie',
    name: 'Zombie Survival Shooter',
    genre: 'FPS / Survival',
    difficulty: 'hard',
    description: 'Maintain barriers against aggressive neon zombie waves with active raycasted targeting.',
    controls: 'W/A/S/D to move, Mouse Cursor to aim, Left Click to shoot, R to reload.',
    accentColor: '#f43f5e',
    thumbnail: zombieThumb,
  },
  {
    id: 'maze',
    name: '3D Maze Escape Game',
    genre: 'Puzzle Adventure',
    difficulty: 'easy',
    description: 'Explore procedurally generated labyrinths blanketed in dark fog of war to find the gate key.',
    controls: 'W/A/S/D or Arrows to steer through the halls.',
    accentColor: '#f59e0b',
    thumbnail: mazeThumb,
  },
  {
    id: 'space',
    name: 'Space Shooter Game',
    genre: 'Arcade Shooter',
    difficulty: 'medium',
    description: 'Navigate scrolling stars, dodge rotating asteroids, and blast the colossal Alien Mothership.',
    controls: 'W/A/S/D or Arrows to fly starfighter, Space to fire twin lasers.',
    accentColor: '#a855f7',
    thumbnail: spaceThumb,
  },
  {
    id: 'landscape',
    name: 'Landscape Generator',
    genre: 'Procedural Sandbox',
    difficulty: 'easy',
    description: 'Generate stunning low-poly landscapes using randomized coordinate maps. Adjust trees, rocks, and lakes dynamically.',
    controls: 'W/A/S/D or Arrows to glide. Mouse drag to look. Use panels to fine-tune.',
    accentColor: '#10b981',
    thumbnail: landscapeThumb,
  },
];

const INITIAL_STATS: PlayerStats = {
  level: 1,
  xp: 0,
  nextLevelXp: 5000,
  totalGamesPlayed: 0,
  highScores: {
    runner: 0,
    racing: 0,
    zombie: 0,
    maze: 0,
    space: 0,
    landscape: 0,
  },
  achievements: [
    {
      id: 'runner_1500',
      title: 'Light Grid Runner',
      description: 'Score 1,500+ points in Endless Runner.',
      icon: 'zap',
      unlocked: false,
    },
    {
      id: 'racing_win',
      title: 'Neon Drift Champion',
      description: 'Score 3,000+ points in 3D Car Racing.',
      icon: 'award',
      unlocked: false,
    },
    {
      id: 'zombie_5k',
      title: 'Spooky Exterminator',
      description: 'Score 5,000+ points in Zombie Survival.',
      icon: 'shield',
      unlocked: false,
    },
    {
      id: 'maze_escape',
      title: 'Maze Keymaster',
      description: 'Score 1,200+ points in Labyrinth Escape.',
      icon: 'key',
      unlocked: false,
    },
    {
      id: 'space_boss',
      title: 'Starfleet Commander',
      description: 'Score 4,000+ points in Space Shooter.',
      icon: 'star',
      unlocked: false,
    },
    {
      id: 'landscape_seed',
      title: 'Eco Architect',
      description: 'Score 1,000+ points in Procedural Landscape Sandbox by mapping flora.',
      icon: 'globe',
      unlocked: false,
    },
  ],
};

const INITIAL_SETTINGS: GameSettings = {
  quality: 'high',
  shadows: true,
  mobileControls: false,
  audioVolume: 0.8,
  sensitivity: 1.0,
};

export default function App() {
  const [activeGameId, setActiveGameId] = useState<GameId | null>(null);
  const [gamesList, setGamesList] = useState<GameMeta[]>(FALLBACK_GAMES);
  const [stats, setStats] = useState<PlayerStats>(INITIAL_STATS);
  const [settings, setSettings] = useState<GameSettings>(INITIAL_SETTINGS);

  // Load configuration and cached stats on launch
  useEffect(() => {
    // 1. Fetch JSON configuration lists to override fallback dynamically
    fetch('/data/games.json')
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Static metadata files missing, falling back to bundled data');
      })
      .then((data) => {
        if (data && data.games) {
          const merged = FALLBACK_GAMES.map((fallback) => {
            const foundNode = data.games.find((g: any) => g.id === fallback.id);
            if (foundNode) {
              return { ...fallback, ...foundNode };
            }
            return fallback;
          });
          setGamesList(merged);
        }
      })
      .catch((err) => console.log('Serving from dynamic bundled models fallback:', err));

    // 2. Hydrate localStorage profiles
    const cachedStats = localStorage.getItem('neon_portal_stats');
    if (cachedStats) {
      try {
        setStats(JSON.parse(cachedStats));
      } catch (e) {
        console.error('State decoding error, resetting profile:', e);
      }
    }

    const cachedSettings = localStorage.getItem('neon_portal_settings');
    if (cachedSettings) {
      try {
        setSettings(JSON.parse(cachedSettings));
      } catch (e) {
        console.error('Settings decoding format invalid, maintaining defaults');
      }
    }

    // Attempt auto-detecting mobile hardware agent
    const isMobileHardware = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if (isMobileHardware) {
      setSettings((prev) => ({ ...prev, mobileControls: true }));
    }
  }, []);

  const handleUpdateSettings = (updated: GameSettings) => {
    setSettings(updated);
    localStorage.setItem('neon_portal_settings', JSON.stringify(updated));
  };

  const handleResetStats = () => {
    setStats(INITIAL_STATS);
    localStorage.removeItem('neon_portal_stats');
  };

  const handleLaunchGame = (id: string) => {
    setActiveGameId(id as GameId);
    
    // Track stats counter
    setStats((prev) => {
      const nextStats = {
        ...prev,
        totalGamesPlayed: prev.totalGamesPlayed + 1,
      };
      localStorage.setItem('neon_portal_stats', JSON.stringify(nextStats));
      return nextStats;
    });
  };

  // Central state update engine for game scores & achievements unlocks
  const handleSaveHighScore = (gameId: GameId, score: number) => {
    setStats((prev) => {
      const currentHigh = prev.highScores[gameId] || 0;
      const isNewRecord = score > currentHigh;
      
      const updatedScores = {
        ...prev.highScores,
        [gameId]: isNewRecord ? score : currentHigh,
      };

      // Add earned XP proportional to the gameplay performance (flat rate: score / 5)
      const earnedXp = Math.floor(score / 5);
      let newXp = prev.xp + earnedXp;
      let newLevel = prev.level;
      let nextLevelThreshold = prev.nextLevelXp;

      // Simple scaling level-up multiplier loop
      while (newXp >= nextLevelThreshold) {
        newXp -= nextLevelThreshold;
        newLevel++;
        nextLevelThreshold = Math.floor(nextLevelThreshold * 1.4);
      }

      // Check medal eligibility conditions
      const updatedAchievements = prev.achievements.map((ach) => {
        let isEligible = ach.unlocked;

        if (ach.id === 'runner_1500' && gameId === 'runner' && score >= 1500) isEligible = true;
        if (ach.id === 'racing_win' && gameId === 'racing' && score >= 3000) isEligible = true;
        if (ach.id === 'zombie_5k' && gameId === 'zombie' && score >= 5000) isEligible = true;
        if (ach.id === 'maze_escape' && gameId === 'maze' && score >= 1200) isEligible = true;
        if (ach.id === 'space_boss' && gameId === 'space' && score >= 4000) isEligible = true;
        if (ach.id === 'landscape_seed' && gameId === 'landscape' && score >= 1000) isEligible = true;

        return { ...ach, unlocked: isEligible };
      });

      const nextStats = {
        ...prev,
        level: newLevel,
        xp: newXp,
        nextLevelXp: nextLevelThreshold,
        highScores: updatedScores,
        achievements: updatedAchievements,
      };

      localStorage.setItem('neon_portal_stats', JSON.stringify(nextStats));
      return nextStats;
    });
  };

  return (
    <div className="w-full min-h-screen bg-[#03010b] select-none text-slate-100 flex flex-col justify-start relative">
      
      {/* Background cyberpunk star patterns */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950/20 via-slate-950 to-[#020006] pointer-events-none" />
      
      {/* Dynamic Route views switching */}
      <AnimatePresence mode="wait">
        {!activeGameId ? (
          <motion.div
            key="dashboard-view"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="w-full relative z-10"
          >
            <MainDashboard
              games={gamesList}
              stats={stats}
              settings={settings}
              onLaunchGame={handleLaunchGame}
              onUpdateSettings={handleUpdateSettings}
              onResetStats={handleResetStats}
            />
          </motion.div>
        ) : (
          <motion.div
            key="gamestage-view"
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="w-full h-[100vh]"
          >
            <GameStage
              gameId={activeGameId}
              settings={settings}
              onExit={() => setActiveGameId(null)}
              onSaveHighScore={handleSaveHighScore}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cyber Grid margin lines pattern at absolute bottom */}
      {!activeGameId && (
        <footer className="w-full py-8 mt-12 border-t border-purple-950/30 text-center text-xs font-mono text-purple-300/40 z-10 select-none">
          SYSTEM CORE OPERATIONAL ON PORT 3000 // DESIGNED FOR HIGHEST FIDELITY WEBGL ENGINE // STATIC ZIP READY
        </footer>
      )}

    </div>
  );
}
