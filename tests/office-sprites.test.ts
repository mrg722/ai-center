import { describe, expect, it } from 'vitest';
import { getOfficeAnimation, getSpriteFrame } from '@/components/office/animationMachine';
import { getBotMotion, getMovement, shouldWalkForMessage } from '@/components/office/movement';
import { resolveSpriteProfile } from '@/components/office/sprites';

describe('AI Office sprite state machine', () => {
  it('maps orchestrator status to visual animation without changing the status', () => {
    expect(getOfficeAnimation('WORKING', 'builder')).toBe('working');
    expect(getOfficeAnimation('WORKING', 'researcher')).toBe('researching');
    expect(getOfficeAnimation('THINKING', 'builder')).toBe('thinking');
    expect(getOfficeAnimation('REVIEWING', 'reviewer')).toBe('reviewing');
    expect(getOfficeAnimation('OFFLINE', 'generic')).toBe('offline');
    expect(getOfficeAnimation('ERROR', 'generic')).toBe('error');
  });

  it('uses deterministic four-frame loops', () => {
    expect(getSpriteFrame('idle', 0)).toBe(0);
    expect(getSpriteFrame('idle', 500)).toBe(1);
    expect(getSpriteFrame('walking', 250)).toBe(2);
    expect(getSpriteFrame('working', 1000)).toBe(1);
  });

  it('only turns selected message types into visible walks', () => {
    expect(shouldWalkForMessage('HANDOFF')).toBe(true);
    expect(shouldWalkForMessage('REVIEW')).toBe(true);
    expect(shouldWalkForMessage('APPROVAL_REQUEST')).toBe(true);
    expect(shouldWalkForMessage('RESULT')).toBe(false);
  });

  it('interpolates a real handoff between desks', () => {
    const motion = getMovement({ x: 100, y: 100 }, { x: 300, y: 200 }, 950, 0, 'WORKING', 'builder', 'HANDOFF');
    expect(motion.active).toBe(true);
    expect(motion.x).toBeGreaterThan(100);
    expect(motion.x).toBeLessThan(300);
    expect(motion.animation).toBe('walking');
  });


  it('keeps each reference character visually distinct', () => {
    expect(resolveSpriteProfile('claude', '#fff').kind).toBe('claude');
    expect(resolveSpriteProfile('chatgpt', '#fff').kind).toBe('chatgpt');
    expect(resolveSpriteProfile('gpt', '#fff').kind).toBe('chatgpt');
    expect(resolveSpriteProfile('antigravity', '#fff').kind).toBe('antigravity');
    expect(resolveSpriteProfile('vercel-ai-gateway', '#fff').kind).toBe('vercel');
    expect(resolveSpriteProfile('nvidia-nim', '#fff').kind).toBe('nvidia');
    expect(resolveSpriteProfile('moderator', '#fff').glasses).toBe(true);
  });

  it('keeps the mascot independent from agent state', () => {
    const a = getBotMotion(4);
    const b = getBotMotion(4);
    expect(a).toEqual(b);
    expect(['idle', 'walking', 'observing', 'resting']).toContain(a.animation);
  });
});
