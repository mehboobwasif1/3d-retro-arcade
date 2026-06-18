import React, { useState } from 'react';
import { GameMeta, PlayerStats, GameSettings } from '../types';
import { Trophy, Shield, HelpCircle, Flame, Star, Volume2, Search, Sliders, Play, Trash2, Smartphone, Monitor, Edit3 } from 'lucide-react';

interface MainDashboardProps {
  games: GameMeta[];
  stats: PlayerStats;
  settings: GameSettings;
  onLaunchGame: (id: string) => void;
  onUpdateSettings: (settings: GameSettings) => void;
  onResetStats: () => void;
  onUpdateName?: (name: string) => void;
}

export default function MainDashboard({
  games,
  stats,
  settings,
  onLaunchGame,
  onUpdateSettings,
  onResetStats,
  onUpdateName,
}: MainDashboardProps) {
  const [search, setSearch] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState<string>('all');
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(stats.profileName || 'Neon Pilot');
  const [scoreboard, setScoreboard] = useState<any[]>([]);

  React.useEffect(() => {
    setTempName(stats.profileName || 'Neon Pilot');
  }, [stats.profileName]);

  React.useEffect(() => {
    const existing = localStorage.getItem('neon_portal_scoreboard');
    if (existing) {
      try {
        setScoreboard(JSON.parse(existing));
      } catch (e) {}
    }
  }, []);

  const handleSaveName = () => {
    setIsEditingName(false);
    const trimmed = tempName.trim();
    if (trimmed && onUpdateName) {
      onUpdateName(trimmed);
    }
  };

  const filteredGames = games.filter((g) => {
    const matchesSearch = g.name.toLowerCase().includes(search.toLowerCase()) ||
                          g.description.toLowerCase().includes(search.toLowerCase());
    const matchesDifficulty = filterDifficulty === 'all' || g.difficulty === filterDifficulty;
    return matchesSearch && matchesDifficulty;
  });

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-8 animate-fade-in text-gray-200">
      
      {/* HEADER SECTION */}
      <header className="flex flex-col md:flex-row justify-between items-center gap-6 pb-6 border-b border-purple-900/30">
        <div className="space-y-1 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-mono tracking-tighter bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-indigo-500 bg-clip-text text-transparent font-extrabold uppercase select-none drop-shadow-[0_0_12px_rgba(236,72,153,0.3)]">
            NEON WebGL Sandbox
          </h1>
          <p className="text-xs md:text-sm text-cyan-200/60 font-mono tracking-widest">
            // CLIENTSIDE 3D ARCADE SUITE
          </p>
        </div>

        {/* Dynamic header tracker counters */}
        <div className="flex gap-4 items-center">
          <div className="bg-gradient-to-br from-purple-950/40 to-slate-900/60 backdrop-blur-md border border-purple-500/30 rounded-xl px-5 py-3 flex items-center gap-4 hover:border-cyan-500/40 transition duration-300 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
            <div className="bg-cyan-500/20 p-2 rounded-lg border border-cyan-500/40 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)] animate-pulse">
              <Flame size={20} />
            </div>
            <div>
              <div className="text-[10px] text-cyan-200/60 font-mono tracking-wider uppercase">Player Profile</div>
              <div className="flex items-center gap-1.5 min-h-[22px]">
                {isEditingName ? (
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onBlur={handleSaveName}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); }}
                    maxLength={15}
                    className="bg-slate-900 border border-cyan-400 text-xs font-mono text-cyan-100 rounded px-1.5 py-0.5 focus:outline-none w-28"
                    autoFocus
                  />
                ) : (
                  <span
                    onClick={() => setIsEditingName(true)}
                    className="text-xs font-bold text-cyan-300 font-mono hover:text-white cursor-pointer flex items-center gap-1.5 group/name"
                    title="Click to change name"
                    id="profile-name-editable"
                  >
                    {stats.profileName || 'Neon Pilot'}
                    <Edit3 size={11} className="text-cyan-400/50 group-hover/name:text-cyan-300" />
                  </span>
                )}
              </div>
              <div className="text-[10px] font-semibold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-amber-300 font-mono">
                Level {stats.level} Elite
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-950/40 to-slate-900/60 backdrop-blur-md border border-purple-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
            <Trophy className="text-yellow-400 animate-bounce" size={18} />
            <div>
              <div className="text-[10px] text-fuchsia-200/50 font-mono uppercase">Total XP</div>
              <div className="text-sm font-mono font-bold text-yellow-300">
                {stats.xp} / {stats.nextLevelXp}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* DASHBOARD COLUMNS Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COLUMN: Main Game selection Grid (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* SEARCH & FILTER CONTROLS */}
          <div className="bg-slate-950/50 border border-purple-500/20 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 backdrop-blur-md">
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan-400/50" size={16} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search cyber game..."
                className="w-full bg-slate-900/60 border border-purple-500/30 rounded-lg pl-10 pr-4 py-2 text-sm font-mono text-cyan-100 placeholder-purple-300/40 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition"
                id="search-input"
              />
            </div>

            <div className="flex gap-2 w-full md:w-auto items-center">
              <span className="text-xs font-mono text-purple-300/60 mr-2 uppercase">Difficulty:</span>
              {['all', 'easy', 'medium', 'hard'].map((d) => (
                <button
                  key={d}
                  onClick={() => setFilterDifficulty(d)}
                  className={`px-3 py-1 text-xs font-mono rounded-md uppercase transition border ${
                    filterDifficulty === d
                      ? 'bg-fuchsia-600/30 border-fuchsia-500 text-fuchsia-200 shadow-[0_0_8px_rgba(232,121,249,0.3)] font-bold'
                      : 'bg-slate-900/60 border-purple-500/20 text-purple-300/70 hover:bg-slate-900 hover:text-cyan-300'
                  }`}
                  id={`filter-diff-${d}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* GAME CARDS LIST GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredGames.length > 0 ? (
              filteredGames.map((game, idx) => {
                const isRunner = game.id === 'runner';
                const isRacing = game.id === 'racing';
                const isZombie = game.id === 'zombie';
                const isMaze = game.id === 'maze';
                const isSpace = game.id === 'space';
                const isLandscape = game.id === 'landscape';

                // Setup distinctive neon borders/shadow styles matching individual characters
                let glowClass = 'hover:border-emerald-500 shadow-emerald-950/20';
                if (isRunner) { glowClass = 'hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(6,182,212,0.25)]'; }
                if (isRacing) { glowClass = 'hover:border-fuchsia-500 hover:shadow-[0_0_15px_rgba(217,70,239,0.25)]'; }
                if (isZombie) { glowClass = 'hover:border-rose-500 hover:shadow-[0_0_15px_rgba(244,63,94,0.25)]'; }
                if (isMaze) { glowClass = 'hover:border-amber-400 hover:shadow-[0_0_15px_rgba(251,191,36,0.25)]'; }
                if (isSpace) { glowClass = 'hover:border-purple-400 hover:shadow-[0_0_15px_rgba(168,85,247,0.25)]'; }
                if (isLandscape) { glowClass = 'hover:border-emerald-400 hover:shadow-[0_0_15px_rgba(16,185,129,0.25)]'; }

                const highScoreValue = stats.highScores[game.id] || 0;

                return (
                  <div
                    key={game.id}
                    id={`game-card-${game.id}`}
                    className={`bg-gradient-to-br from-slate-900/95 to-purple-950/40 border border-purple-500/20 rounded-2xl overflow-hidden flex flex-col justify-between transition-all duration-300 transform hover:-translate-y-1.5 shadow-xl group ${glowClass}`}
                  >
                    {/* Thumbnail Image Header */}
                    <div className="relative w-full h-44 overflow-hidden bg-slate-950 border-b border-purple-500/10">
                      <img
                        src={game.thumbnail}
                        alt={`${game.name} Artwork`}
                        referrerPolicy="no-referrer"
                        className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-700 ease-out brightness-90 group-hover:brightness-100"
                      />
                      {/* Top Overlay Badge for Genre */}
                      <div className="absolute top-3 left-3">
                        <span className="text-[9px] font-mono font-extrabold uppercase bg-slate-950/90 border border-purple-500/40 rounded px-2.5 py-1 text-purple-300 tracking-wider shadow-md backdrop-blur-sm">
                          {game.genre}
                        </span>
                      </div>
                      {/* Top Overlay Badge for Difficulty */}
                      <div className="absolute top-3 right-3">
                        <span
                          className={`text-[9px] font-mono tracking-widest font-extrabold uppercase rounded px-2.5 py-1 border shadow-md backdrop-blur-sm ${
                            game.difficulty === 'easy'
                              ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/40'
                              : game.difficulty === 'medium'
                              ? 'bg-amber-500/25 text-amber-300 border-amber-400/40'
                              : 'bg-rose-500/25 text-rose-300 border-rose-400/40'
                          }`}
                        >
                          {game.difficulty}
                        </span>
                      </div>
                      {/* Bottom atmospheric dark shadow wash */}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent pointer-events-none" />
                    </div>

                    <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                      <div className="space-y-3">
                        {/* Title */}
                        <div className="text-left">
                          <h3 className="text-lg font-bold font-sans group-hover:text-white transition tracking-tight">
                            {game.name}
                          </h3>
                        </div>

                        {/* Description */}
                        <p className="text-xs text-slate-300/80 leading-relaxed min-h-[48px] text-left">
                          {game.description}
                        </p>

                        {/* Controls quick documentation */}
                        <div className="bg-black/40 border border-purple-950 rounded-lg p-2 text-[10px] font-mono text-purple-300/70 text-left">
                          <span className="text-cyan-300 font-semibold uppercase">KEYS:</span> {game.controls}
                        </div>
                      </div>

                      {/* Footer scores + action trigger */}
                      <div className="flex justify-between items-center pt-4 border-t border-purple-950/60">
                        <div>
                          <div className="text-[9px] text-slate-400 font-mono text-left uppercase">Personal Record</div>
                          <div className="font-mono text-xs text-yellow-300 font-bold">
                            {highScoreValue > 0 ? highScoreValue.toLocaleString() : 'N/A'}
                          </div>
                        </div>

                        <button
                          onClick={() => onLaunchGame(game.id)}
                          className={`flex items-center gap-1.5 px-3.5 py-2 font-mono text-xs font-bold uppercase rounded-lg border tracking-wider transition duration-200 cursor-pointer ${
                            isRunner
                              ? 'bg-cyan-500/10 hover:bg-cyan-500 border-cyan-500/50 hover:text-black hover:shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                              : isRacing
                              ? 'bg-fuchsia-500/10 hover:bg-fuchsia-500 border-fuchsia-500/50 hover:text-black hover:shadow-[0_0_12px_rgba(217,70,239,0.5)]'
                              : isZombie
                              ? 'bg-rose-500/10 hover:bg-rose-500 border-rose-500/50 hover:text-black hover:shadow-[0_0_12px_rgba(244,63,94,0.5)]'
                              : isMaze
                              ? 'bg-amber-500/10 hover:bg-amber-500 border-amber-500/50 hover:text-black hover:shadow-[0_0_12px_rgba(251,191,36,0.5)]'
                              : isSpace
                              ? 'bg-purple-500/10 hover:bg-purple-500 border-purple-500/50 hover:text-black hover:shadow-[0_0_12px_rgba(168,85,247,0.5)]'
                              : 'bg-emerald-500/10 hover:bg-emerald-500 border-emerald-500/50 hover:text-black hover:shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                          }`}
                          id={`btn-launch-${game.id}`}
                        >
                          <Play size={12} fill="currentColor" />
                          ENGAGE 3D
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="col-span-full py-16 text-center border-2 border-dashed border-purple-500/10 rounded-2xl bg-slate-900/20">
                <HelpCircle className="mx-auto text-purple-400/40 mb-3" size={32} />
                <p className="text-sm font-mono text-purple-300/50 uppercase">No cybersecurity systems detected</p>
                <p className="text-xs text-slate-400 mt-1">Try resetting search string query or difficulty levels</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Statistics + Game Controls settings Panel (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* PLAYER CONTROLS & SYSTEM SETTINGS PANEL */}
          <div className="bg-gradient-to-br from-slate-950 to-purple-950/40 border border-purple-500/20 rounded-2xl p-6 space-y-6 backdrop-blur-md shadow-xl text-left">
            <h2 className="text-lg font-bold font-mono text-cyan-400 border-b border-purple-500/10 pb-2 uppercase tracking-wide flex items-center gap-2">
              <Sliders size={18} />
              Engine Configuration
            </h2>

            <div className="space-y-4">
              {/* Graphic quality */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-purple-300/70 uppercase">Rendering Profile</label>
                <div className="grid grid-cols-3 gap-1 bg-slate-950/60 p-1 border border-purple-500/20 rounded-lg">
                  {(['low', 'medium', 'high'] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => onUpdateSettings({ ...settings, quality: q })}
                      className={`py-1.5 text-[10px] font-mono rounded uppercase transition ${
                        settings.quality === q
                          ? 'bg-cyan-500/30 text-cyan-200 font-bold border border-cyan-500/40'
                          : 'text-purple-300/50 hover:bg-slate-900'
                      }`}
                      id={`quality-toggle-${q}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shadows toggle */}
              <div className="flex items-center justify-between py-1 border-b border-purple-500/5">
                <div>
                  <div className="text-xs font-mono text-slate-200">Cast Standard Shadows</div>
                  <div className="text-[10px] text-purple-300/40 font-mono">Enhances immersive 3D depth</div>
                </div>
                <button
                  onClick={() => onUpdateSettings({ ...settings, shadows: !settings.shadows })}
                  className={`w-10 h-6 rounded-full p-1 transition-colors duration-300 ${
                    settings.shadows ? 'bg-fuchsia-600' : 'bg-slate-800'
                  }`}
                  id="toggle-shadows"
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform duration-300 transform ${
                      settings.shadows ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Mobile controls visual toggle */}
              <div className="flex items-center justify-between py-1 border-b border-purple-500/5">
                <div>
                  <div className="text-xs font-mono text-slate-200 flex items-center gap-1.5">
                    Virtual Layout HUD
                  </div>
                  <div className="text-[10px] text-purple-300/40 font-mono text-left">Forces on-screen Touch buttons</div>
                </div>
                <button
                  onClick={() => onUpdateSettings({ ...settings, mobileControls: !settings.mobileControls })}
                  className="bg-slate-900/60 hover:bg-slate-900 border border-purple-500/30 p-1.5 rounded text-fuchsia-400 hover:text-cyan-400 transition"
                  title="Force Virtual Controller Grid"
                  id="toggle-virtual-hud"
                >
                  {settings.mobileControls ? <Smartphone size={16} className="text-cyan-400 animate-pulse" /> : <Monitor size={16} />}
                </button>
              </div>

              {/* Speed volume */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-purple-300/70 uppercase">Rhythm Volume</span>
                  <span className="text-cyan-400 font-bold">{Math.floor(settings.audioVolume * 100)}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <Volume2 className="text-purple-400" size={16} />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={settings.audioVolume}
                    onChange={(e) => onUpdateSettings({ ...settings, audioVolume: parseFloat(e.target.value) })}
                    className="w-full accent-fuchsia-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    id="audio-volume-slider"
                  />
                </div>
              </div>

              {/* Reset Stats section */}
              <div className="pt-4 border-t border-purple-500/10">
                {showResetConfirm ? (
                  <div className="space-y-2 p-3 bg-red-950/30 border border-red-500/30 rounded-lg text-center">
                    <p className="text-xs font-mono text-red-300 uppercase">Wipe all player history?</p>
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={() => {
                          onResetStats();
                          setShowResetConfirm(false);
                        }}
                        className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-[10px] font-mono cursor-pointer"
                        id="btn-confirm-reset"
                      >
                        YES, WIPE
                      </button>
                      <button
                        onClick={() => setShowResetConfirm(false)}
                        className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono cursor-pointer"
                        id="btn-cancel-reset"
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="w-full py-2 bg-slate-900 hover:bg-red-950/20 border border-purple-500/20 rounded-lg text-[10px] font-mono text-purple-300/60 hover:text-red-400 hover:border-red-500/30 flex items-center justify-center gap-2 transition cursor-pointer"
                    id="btn-reset-statistics"
                  >
                    <Trash2 size={12} />
                    RESET PLAYER STATISTICS
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* LOCAL DEVICE ARCADE LEADERBOARD */}
          <div className="bg-gradient-to-br from-slate-950 to-purple-950/40 border border-purple-500/20 rounded-2xl p-6 space-y-4 backdrop-blur-md shadow-xl text-left">
            <h2 className="text-lg font-bold font-mono text-cyan-400 border-b border-purple-500/10 pb-2 uppercase tracking-wide flex items-center gap-2">
              <Trophy size={18} />
              Device Arcade Hall of Fame
            </h2>

            {scoreboard.length === 0 ? (
              <div className="text-slate-500 text-[10px] italic font-mono text-center py-4 uppercase">
                // No runs recorded yet on this device.
                <br />Finish a game to register your score!
              </div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {scoreboard.map((entry, idx) => (
                  <div
                    key={entry.id || idx}
                    className="bg-slate-900/65 border border-purple-500/10 rounded-lg p-2.5 flex justify-between items-center text-xs font-mono group hover:border-purple-500/30 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-purple-400 font-extrabold w-4">#{idx + 1}</span>
                      <div>
                        <span className="font-sans font-bold text-slate-100 uppercase tracking-tight group-hover:text-cyan-300 transition-colors">
                          {entry.playerName}
                        </span>
                        <div className="text-[8px] text-purple-400/65 uppercase mt-0.5">
                          {entry.gameId?.toUpperCase()} • {entry.date ? new Date(entry.date).toLocaleDateString() : 'N/A'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-yellow-300 font-bold tracking-widest text-[13px]">{entry.score?.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gradient-to-br from-slate-950 to-purple-950/40 border border-purple-500/20 rounded-2xl p-6 space-y-4 backdrop-blur-md shadow-xl text-left">
            <h2 className="text-lg font-bold font-mono text-fuchsia-400 border-b border-purple-500/10 pb-2 uppercase tracking-wide flex items-center gap-2">
              <Trophy size={18} />
              Medals of Valour
            </h2>

            <div className="grid grid-cols-2 gap-3 py-1">
              <div className="bg-slate-950/70 border border-purple-500/10 rounded-lg p-2.5 text-center">
                <div className="text-[10px] font-mono text-purple-300/50 uppercase">Runs Played</div>
                <div className="text-xl font-bold font-mono text-cyan-400 mt-1">{stats.totalGamesPlayed}</div>
              </div>
              <div className="bg-slate-950/70 border border-purple-500/10 rounded-lg p-2.5 text-center">
                <div className="text-[10px] font-mono text-purple-300/50 uppercase">Achievements</div>
                <div className="text-xl font-bold font-mono text-fuchsia-400 mt-1">
                  {stats.achievements.filter((a) => a.unlocked).length} / {stats.achievements.length}
                </div>
              </div>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {stats.achievements.map((achievement) => (
                <div
                  key={achievement.id}
                  id={`achievement-card-${achievement.id}`}
                  className={`flex gap-3 items-center p-2 rounded-lg border transition ${
                    achievement.unlocked
                      ? 'bg-purple-950/30 border-purple-500/30 text-slate-100 shadow-[0_0_8px_rgba(168,85,247,0.1)]'
                      : 'bg-slate-950/20 border-slate-900 text-slate-200/40'
                  }`}
                >
                  <div
                    className={`p-1.5 rounded-md border ${
                      achievement.unlocked
                        ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-300 animate-pulse'
                        : 'bg-slate-900 border-slate-800 text-slate-600'
                    }`}
                  >
                    <Star size={16} fill={achievement.unlocked ? 'currentColor' : 'none'} />
                  </div>
                  <div>
                    <div className="text-xs font-bold font-sans">{achievement.title}</div>
                    <div className="text-[9px] font-mono leading-tight">{achievement.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
