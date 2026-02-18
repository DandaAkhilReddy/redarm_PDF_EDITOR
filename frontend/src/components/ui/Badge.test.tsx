import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders as a span element', () => {
    render(<Badge>Label</Badge>);
    const el = screen.getByText('Label');
    expect(el.tagName).toBe('SPAN');
  });

  it('applies default variant classes when no variant is specified', () => {
    render(<Badge>Default</Badge>);
    const el = screen.getByText('Default');
    expect(el.className).toContain('bg-slate-100');
    expect(el.className).toContain('text-slate-700');
  });

  it('applies a custom className alongside base classes', () => {
    render(<Badge className="my-custom-class">Custom</Badge>);
    const el = screen.getByText('Custom');
    expect(el.className).toContain('my-custom-class');
    // Base classes must still be present
    expect(el.className).toContain('rounded-full');
  });

  it.each([
    ['success', 'bg-emerald-50', 'text-emerald-700'],
    ['error', 'bg-red-50', 'text-red-700'],
    ['warning', 'bg-amber-50', 'text-amber-700'],
    ['info', 'bg-blue-50', 'text-blue-700'],
  ] as const)(
    'applies correct classes for the "%s" variant',
    (variant, bgClass, textClass) => {
      render(<Badge variant={variant}>{variant}</Badge>);
      const el = screen.getByText(variant);
      expect(el.className).toContain(bgClass);
      expect(el.className).toContain(textClass);
    }
  );

  it('contains base styling classes (rounded-full, text-xs, font-medium)', () => {
    render(<Badge>Base</Badge>);
    const el = screen.getByText('Base');
    expect(el.className).toContain('rounded-full');
    expect(el.className).toContain('text-xs');
    expect(el.className).toContain('font-medium');
  });
});
