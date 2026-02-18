import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('returns empty string when called with no arguments', () => {
    expect(cn()).toBe('');
  });

  it('joins multiple class strings into a single string', () => {
    expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz');
  });

  it('filters out conditional classes that are false, null, or undefined', () => {
    expect(cn('foo', false && 'bar', null, undefined, 'baz')).toBe('foo baz');
  });

  it('merges conflicting tailwind classes, keeping the last one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-red-500', 'text-blue-300')).toBe('text-blue-300');
    expect(cn('p-2', 'p-4', 'px-6')).toBe('p-4 px-6');
  });

  it('handles array inputs', () => {
    expect(cn(['foo', 'bar'], ['baz'])).toBe('foo bar baz');
    expect(cn(['px-2', 'px-4'])).toBe('px-4');
  });

  it('handles object inputs, including only keys with truthy values', () => {
    expect(cn({ 'class-a': true, 'class-b': false })).toBe('class-a');
    // tailwind-merge resolves conflicting text-size utilities; last one wins
    expect(cn({ 'text-sm': true, 'text-lg': true, 'font-bold': false })).toBe('text-lg');
    expect(cn('base', { 'extra': true, 'hidden': false })).toBe('base extra');
  });
});
