import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from './Header';

// Default props shared across tests
const defaultProps = {
  email: 'user@example.com',
  theme: 'light' as const,
  onToggleTheme: vi.fn(),
  onLogout: vi.fn(),
};

describe('Header', () => {
  it('renders "RedArm" brand text', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText('RedArm')).toBeInTheDocument();
  });

  it('shows fileName when provided', () => {
    render(<Header {...defaultProps} fileName="invoice-2024.pdf" />);
    expect(screen.getByText('invoice-2024.pdf')).toBeInTheDocument();
  });

  it('does not show fileName when not provided', () => {
    render(<Header {...defaultProps} />);
    // The separator slash only renders alongside fileName; neither should exist
    expect(screen.queryByText('invoice-2024.pdf')).not.toBeInTheDocument();
    // The slash separator should also be absent
    expect(screen.queryByText('/')).not.toBeInTheDocument();
  });

  it('shows email in the header user button', () => {
    render(<Header {...defaultProps} email="doctor@hha.com" />);
    // The email text is rendered inside the trigger button (hidden on small screens via CSS,
    // but present in the DOM)
    expect(screen.getByText('doctor@hha.com')).toBeInTheDocument();
  });

  it('calls onToggleTheme when the theme toggle button is clicked', async () => {
    const onToggleTheme = vi.fn();
    const user = userEvent.setup();

    render(<Header {...defaultProps} onToggleTheme={onToggleTheme} />);

    await user.click(screen.getByRole('button', { name: /toggle theme/i }));

    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('opens the dropdown menu when the user button is clicked', async () => {
    const user = userEvent.setup();

    render(<Header {...defaultProps} />);

    // "Sign out" lives inside the dropdown, which is hidden until the button is clicked
    expect(screen.queryByText('Sign out')).not.toBeInTheDocument();

    // The user button contains the email text — click it to open the menu
    await user.click(screen.getByText('user@example.com'));

    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });

  it('calls onLogout when "Sign out" is clicked in the dropdown', async () => {
    const onLogout = vi.fn();
    const user = userEvent.setup();

    render(<Header {...defaultProps} onLogout={onLogout} />);

    // Open the dropdown first
    await user.click(screen.getByText('user@example.com'));

    await user.click(screen.getByText('Sign out'));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('shows "Sign out" text inside the open dropdown', async () => {
    const user = userEvent.setup();

    render(<Header {...defaultProps} />);

    await user.click(screen.getByText('user@example.com'));

    const signOutButton = screen.getByRole('button', { name: /sign out/i });
    expect(signOutButton).toBeInTheDocument();
    expect(signOutButton).toHaveTextContent('Sign out');
  });
});
