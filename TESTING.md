# QA and Testing Guide: Imposter Party

This guide outlines the critical features and scenarios to test to ensure high-fidelity gameplay and server stability.

## 1. Core Connection & Identity
- [ ] **Persistent Identity**: Join a party, then refresh the browser. You should automatically reconnect as the same player without being prompted for a name.
- [ ] **Hand-off**: Open the same party link in an Incognito window. You should be treated as a new player.
- [ ] **Grace Period**: Join a party, then close the tab. Wait 10 seconds and reopen. The server should still show you as the same player (reconnected). Wait >30 seconds, and the server should remove you.

## 2. Lobby & Game Setup
- [ ] **Double-Click Protection**: Mash the "Create Party" or "Join Party" buttons. Only one request should fire (verified by one toast/navigation).
- [ ] **Leader Permissions**: Ensure only the leader can see the "Start Mission" button and the "Manage" tab.
- [ ] **Validation**: Try to start a game with only 1 player. The UI should block this with an error message.

## 3. Party Management (Leader Only)
- [ ] **Max Capacity**: Try setting max players below the current player count. The server should reject it.
- [ ] **Imposter Quota**: Verify that the max range for imposters updates when max players is adjusted.
- [ ] **Settings Sync**: Change settings on one device (leader) and verify that the "Max Capacity" updates for other players in the header/lobby.
- [ ] **Disband Logic**: Click "Disband" and type "DISBAND". Verify all connected players are kicked to the home screen with a "Party was disbanded" message.
- [ ] **Auth Check**: On a non-leader device, try to switch to the "Manage" tab. It should either be invisible or redirect you immediately.

## 3. Game Loop (Phase Transitions)
- [ ] **Countdown**: Verify the 3-second countdown precedes the role reveal.
- [ ] **Reveal Logic**: 
    - Crew should see "NO INTEL PROVIDED".
    - Imposter(s) should see their secret hint.
- [ ] **Timer Accuracy**: Ensure the round timer syncs across all clients and turns red in the final 30 seconds.

## 4. Voting & Results
- [ ] **Vote Sync**: When one player votes to skip, all other players should see that player's icon light up with a checkmark in real-time.
- [ ] **Threshold**: Verify the game ends immediately when the majority (or threshold) is met.
- [ ] **Results Debrief**: Ensure the "Mission Complete" screen correctly identifies all imposters and reveals the secret intel to everyone.

## 5. UI/UX "Mission" Feel
- [ ] **Toasts**: Verify success toasts for "Copy Code" and error toasts for "Invalid Code".
- [ ] **Iconography**: Check for consistent use of Radio (Link), Crown (Leader), and Shield (Imposter) icons.
- [ ] **Responsiveness**: Test on a mobile-sized viewport (max 448px width) to ensure buttons and typography are readable.

## 6. Technical Checklist
- [ ] Socket.io server cleans up empty parties after 1 hour.
- [ ] `localStorage` correctly stores `imposter-party-id`.
- [ ] Server handles sudden process termination (graceful cleanup of rooms).
