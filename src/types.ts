export type GameId = 'runner' | 'racing' | 'zombie' | 'maze' | 'space' | 'landscape';

export type GameStatus = 'MENU' | 'LOADING' | 'PLAYING' | 'PAUSED' | 'GAMEOVER' | 'VICTORY';

export interface GameSettings {
  quality: 'low' | 'medium' | 'high';
  shadows: boolean;
  mobileControls: boolean;
  audioVolume: number;
  sensitivity: number;
}

export interface PlayerStats {
  profileName?: string; // Optional custom name
  level: number;
  xp: number;
  nextLevelXp: number;
  totalGamesPlayed: number;
  highScores: Record<GameId, number>;
  achievements: Array<{
    id: string;
    title: string;
    description: string;
    icon: string;
    unlocked: boolean;
  }>;
}

export interface ScoreboardEntry {
  id: string;
  gameId: GameId;
  playerName: string;
  score: number;
  date: string;
}

export interface GameMeta {
  id: GameId;
  name: string;
  genre: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  controls: string;
  accentColor: string;
  thumbnail: string;
}
