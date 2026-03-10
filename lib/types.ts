export enum GamePhase {
  LOBBY = 'lobby',
  PREGAME = 'pregame',     // Confirmation vote before starting
  COUNTDOWN = 'countdown',
  REVEAL = 'reveal',
  ROUND = 'round',
  VOTING_GRACE = 'voting_grace',
  VOTE_RESULTS = 'vote_results',
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
  isDead?: boolean; // If they were voted out but are still in the game
}

export interface ChatMessage {
  id: string;
  playerId: string | 'system';
  playerName: string;
  text: string;
  timestamp: number;
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
  hint: string | null;       // Shared hint for imposters
  category: string | null;   // Shown to everyone — narrows the domain
  lastEliminated: string | null; // ID of last person voted out
  winner: 'imposter' | 'crew' | null;
}

export interface PartySettings {
  maxPlayers: number;
  impostersCount: number;
  language: string; // e.g. 'english' | 'spanish' | 'french' | 'german' | 'romanian'
}

export interface Party {
  code: string;
  players: Player[];
  game: GameState;
  votes: VoteState;
  settings: PartySettings;
  messages: ChatMessage[];
  continueVotes: string[]; // Player IDs who want to play again
  lobbyVotes: string[];    // Player IDs who want to go back to lobby
  startVotes: string[];    // Player IDs who confirmed the pre-game start
  cancelVotes: string[];   // Player IDs who declined the pre-game start
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

  /** Vote to continue game/play again. */
  vote_continue: () => void;

  /** Vote to return to lobby. */
  vote_lobby: () => void;
  
  /** Explicitly request the latest state (for reconnects). */
  "state:sync": () => void;

  /** Update party settings (Leader only). */
  "party:updateSettings": (settings: PartySettings) => void;

  /** Disband the party (Leader only). */
  "party:disband": () => void;

  /** Leave the party. */
  "party:leave": () => void;

  /** Kick a player from the party (Leader only). */
  kick_player: (targetId: string) => void;

  /** Send a chat message. */
  send_message: (text: string) => void;

  /** Leader proposes to start — begins the pre-game confirmation vote. */
  propose_game: () => void;

  /** Vote to confirm start during the pre-game phase. */
  vote_start: () => void;

  /** Vote to cancel start during the pre-game phase (returns to lobby). */
  cancel_start: () => void;
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

  /** New chat message received. */
  chat_message: (message: ChatMessage) => void;

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
