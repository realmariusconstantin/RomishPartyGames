export enum GamePhase {
  LOBBY = 'lobby',
  COUNTDOWN = 'countdown',
  REVEAL = 'reveal',
  ROUND = 'round',
  RESULTS = 'results'
}

export interface Player {
  id: string; // Persistent ID (UUID)
  socketId: string | null; // Current Socket ID
  name: string;
  isLeader: boolean;
  role: 'imposter' | 'crew' | null;
  connected: boolean;
  disconnectedAt: number | null; // Timestamp
}

export interface VoteState {
  votedSkip: string[]; // Array of player IDs who voted to skip
  votes: Record<string, string>; // VoterID -> TargetID
  threshold: number;   // Votes needed to skip
}

export interface GameState {
  phase: GamePhase;
  remainingTime: number;
  imposterCount: number;
  secretWord: string | null; // Shared word for crew
  hint: string | null;  // Shared hint for imposters
  lastEliminated: string | null; // ID of last person voted out
  winner: 'imposter' | 'crew' | null;
}

export interface PartySettings {
  maxPlayers: number;
  impostersCount: number;
}

export interface Party {
  code: string;
  players: Player[];
  game: GameState;
  votes: VoteState;
  settings: PartySettings;
}

export interface ClientToServerEvents {
  /** Create a new party. Responds with 'party_created' */
  create_party: (name: string) => void;
  
  /** Join an existing party by code. */
  join_party: (code: string, name: string) => void;
  
  /** Start the game (Leader only). */
  start_game: (imposterCount: number) => void;
  
  /** Vote to skip the current round. */
  vote_skip: () => void;

  /** Vote for a player to be eliminated. */
  vote_player: (targetId: string) => void;
  
  /** Explicitly request the latest state (for reconnects). */
  "state:sync": () => void;

  /** Update party settings (Leader only). */
  "party:updateSettings": (settings: PartySettings) => void;

  /** Disband the party (Leader only). */
  "party:disband": () => void;

  /** Leave the party. */
  "party:leave": () => void;
}

export interface ServerToClientEvents {
  /** Complete sync of the party state. */
  state_update: (party: Party) => void;
  
  /** Private event sent to individual players when roles are revealed. */
  role_reveal: (data: { role: 'imposter' | 'crew'; hint: string | null }) => void;
  
  /** Generic error message. */
  error: (message: string) => void;
  
  /** Success confirmation for party creation. */
  party_created: (code: string) => void;

  /** Countdown tick event 5..1 */
  countdown_tick: (seconds: number) => void;

  /** Round duration tick in seconds */
  round_tick: (seconds: number) => void;

  /** Broadcast when skip vote threshold is reached */
  "vote:passed": () => void;

  /** Broadcast when settings are updated. */
  "party:settingsUpdated": (settings: PartySettings) => void;

  /** Broadcast when party is disbanded. */
  "party:disbanded": () => void;
}
