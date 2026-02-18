import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Input } from './Input';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows label text when label prop is provided', () => {
    render(<Input label="Email Address" />);
    expect(screen.getByText('Email Address')).toBeInTheDocument();
  });

  it('associates label with input via htmlFor and id derived from label text', () => {
    render(<Input label="Email Address" />);
    const label = screen.getByText('Email Address');
    const input = screen.getByRole('textbox');
    expect(label).toHaveAttribute('for', 'email-address');
    expect(input).toHaveAttribute('id', 'email-address');
  });

  it('shows error message when error prop is provided', () => {
    render(<Input error="This field is required" />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('does not render error message when error prop is absent', () => {
    render(<Input />);
    // queryByRole('paragraph') does not work for <p> in jsdom — use queryByText instead
    expect(screen.queryByText(/this field/i)).not.toBeInTheDocument();
    // Also verify no error paragraph exists by checking for the error CSS class
    expect(document.querySelector('.text-red-500')).toBeNull();
  });

  it('renders icon when icon prop is provided', () => {
    const icon = <svg data-testid="test-icon" />;
    render(<Input icon={icon} />);
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('forwards ref to the underlying input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBe(screen.getByRole('textbox'));
  });

  it('passes through standard input props such as placeholder and type', () => {
    render(<Input placeholder="Enter your email" type="email" />);
    const input = screen.getByPlaceholderText('Enter your email');
    expect(input).toHaveAttribute('type', 'email');
  });

  it('has displayName set to "Input"', () => {
    expect(Input.displayName).toBe('Input');
  });
});
