# Imposter Party - Feature Inventory

## 1. Core Game Engine
- **State Management**: Authoritative server-side state using `GameEngine` class.
- **Player Management**: 
  - Dynamic joining/leaving with room persistence.
  - Automatic leader reassignment when the current leader leaves.
  - Maximum player limit (3-10) with real-time enforcement.
- **Game Phases**:
  - `LOBBY`: Pre-game staging area.
  - `COUNTDOWN`: 5-second preparation phase.
  - `REVEAL`: Role assignment and hint delivery (10s).
  - `ROUND`: Main discussion/gameplay (120s default).
  - `RESULTS`: End-game summary and role exposure.
- **Role System**:
  - **Crew**: Majority of players. Do not receive the hint.
  - **Imposter**: Minority of players. Receive the secret hint.
- **Voting System**:
  - "Skip Round" mechanism allowing players to end the `ROUND` phase early if a majority threshold is hit.
- **Hint System**:
  - Randomly selected secrets from a pre-defined library.

## 2. Party Management (Leader Only)
- **Settings Dashboard**: Accessible via a secure "Manage" tab.
- **Max Players**: Slider control (3-10) with validation against current player count.
- **Imposter Count**: Slider control (1 to N-1) with validation against max players.
- **Party Termination**: Global `disband` capability with confirmation modal and automatic redirection for all connected clients.
- **Authorization**: All management actions are verified server-side against the leader's socket ID.

## 3. User Interface
- **Home Page**:
  - Identity creation (Persistence in LocalStorage).
  - Create Party flow.
  - Join Party via 4-character code.
- **Party Page**:
  - Responsive layout with navigation tabs (Lobby/Manage).
  - Visual feedback for game states (Color-coded themes for Crew vs. Imposter).
  - Real-time player list with leader markers.
  - Animated phase transitions.
  - Interactive sliders and modals for management.

## 4. Technical Infrastructure
- **Real-time Communication**: Socket.io for low-latency state synchronization.
- **Persistence**: Temporary in-memory server storage (resets on server restart).
- **Validation**:
  - client-side zod-like checks (via UI logic).
  - server-side strict validation for all socket events.
- **Testability**: `data-testid` attributes on all critical action elements for E2E automation.
