# AI Office sprite system

The AI Office uses a deterministic, canvas-native sprite system.

## Contract

- The office background is static.
- Characters are independently rendered sprites.
- Animation is derived from real orchestrator state.
- Message events can trigger short, visible movement.
- The mascot bot has its own visual-only life cycle and is never presented as a real agent.
- prefers-reduced-motion freezes nonessential motion.
- Rendering is driven by requestAnimationFrame; there is no animation setInterval.

## Sprite states

idle, thinking, working, researching, walking, reviewing, waiting, error, complete, blocked, offline, approving.

Walk cycles use four phases. Idle/typing use subtle four-frame loops. The implementation currently draws the pixel frames procedurally so the existing office art remains visually coherent; a future authored PNG spritesheet can replace the renderer without changing the state/movement contracts.

## Real-state rules

WORKING never becomes walking merely because time passed. Walking is triggered by a real message event (HANDOFF, REVIEW, APPROVAL_REQUEST, TASK, or COMMAND) and expires after the short travel animation. The underlying agent status remains untouched.

The mascot follows a deterministic route only as environmental animation. It is explicitly not an agent, does not emit events, and does not affect orchestrator state.

## Performance

The scene is a canvas renderer. The render loop uses requestAnimationFrame with a 30 FPS cap in the full office and 12 FPS in compact previews. Static furniture remains cached; only the dynamic layer is repainted.

## Research basis

Browser animation should use requestAnimationFrame rather than timer-driven frame loops, and short repeated frame sequences are a common sprite-animation pattern. The implementation keeps those principles while using procedural pixel frames to avoid introducing unverified external art assets.
