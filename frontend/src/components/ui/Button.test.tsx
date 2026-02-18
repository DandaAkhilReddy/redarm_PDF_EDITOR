import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Button } from './Button';

describe('Button', () => {
  it('renders children text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('fires onClick when clicked', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Submit</Button>);
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button', { name: /disabled/i })).toBeDisabled();
  });

  it('is disabled when isLoading is true', () => {
    render(<Button isLoading>Loading</Button>);
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<Button disabled onClick={handleClick}>Blocked</Button>);
    await user.click(screen.getByRole('button', { name: /blocked/i }));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('applies correct classes for variant="primary" (default)', () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole('button', { name: /primary/i });
    expect(btn.className).toMatch(/bg-brand-600/);
    expect(btn.className).toMatch(/text-white/);
  });

  it('applies correct classes for size="md" (default)', () => {
    render(<Button>Medium</Button>);
    const btn = screen.getByRole('button', { name: /medium/i });
    expect(btn.className).toMatch(/h-9/);
    expect(btn.className).toMatch(/px-4/);
    expect(btn.className).toMatch(/text-sm/);
  });

  it('forwards ref to the underlying button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref Button</Button>);
    const btn = screen.getByRole('button', { name: /ref button/i });
    expect(ref.current).toBe(btn);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('shows a spinner icon when isLoading is true', () => {
    render(<Button isLoading>Saving</Button>);
    // Loader2 renders an <svg> inside the button; the spinner carries animate-spin
    const btn = screen.getByRole('button', { name: /saving/i });
    const svg = btn.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute('class')).toMatch(/animate-spin/);
  });

  it('renders a custom icon when provided and isLoading is false', () => {
    const TestIcon = () => <svg data-testid="custom-icon" />;
    render(<Button icon={<TestIcon />}>With Icon</Button>);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('does not render the custom icon when isLoading is true (spinner takes its place)', () => {
    const TestIcon = () => <svg data-testid="custom-icon" />;
    render(<Button icon={<TestIcon />} isLoading>Loading</Button>);
    expect(screen.queryByTestId('custom-icon')).not.toBeInTheDocument();
  });

  it('has displayName "Button"', () => {
    expect(Button.displayName).toBe('Button');
  });
});
