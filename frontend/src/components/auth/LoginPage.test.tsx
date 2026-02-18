import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';

// Helper: create a resolved onLogin stub
const resolvedLogin = () => vi.fn().mockResolvedValue(undefined);

// Helper: create a rejected onLogin stub that throws with the given message
const rejectedLogin = (message: string) =>
  vi.fn().mockRejectedValue(new Error(message));

// Helper: render LoginPage with sensible defaults so each test only overrides
// what it cares about.
function renderLoginPage(
  overrides: Partial<React.ComponentProps<typeof LoginPage>> = {}
) {
  const defaultProps = {
    onLogin: resolvedLogin(),
    isLoading: false,
  };
  return render(<LoginPage {...defaultProps} {...overrides} />);
}

describe('LoginPage', () => {
  // -----------------------------------------------------------------------
  // Structural / rendering tests
  // -----------------------------------------------------------------------

  it('renders an email input', () => {
    renderLoginPage();
    // The Input component generates an id from its label ("email" → "email")
    const emailInput = screen.getByLabelText('Email');
    expect(emailInput).toBeInTheDocument();
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('renders a password input', () => {
    renderLoginPage();
    const passwordInput = screen.getByLabelText('Password');
    expect(passwordInput).toBeInTheDocument();
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('renders a "Sign in" submit button', () => {
    renderLoginPage();
    const button = screen.getByRole('button', { name: /sign in/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'submit');
  });

  it('shows the title "RedArm PDF Editor"', () => {
    renderLoginPage();
    expect(screen.getByText('RedArm PDF Editor')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Validation tests
  // -----------------------------------------------------------------------

  it('shows a validation error when the email field is empty on submit', async () => {
    const user = userEvent.setup();
    const onLogin = resolvedLogin();
    renderLoginPage({ onLogin });

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByText('Please enter a valid email address.')
    ).toBeInTheDocument();
  });

  it('shows a validation error when email does not contain "@"', async () => {
    const onLogin = resolvedLogin();
    renderLoginPage({ onLogin });

    // jsdom enforces HTML5 constraint validation on type="email" inputs when the
    // form is submitted via a button click, so it silently blocks submission for
    // invalid patterns.  We use fireEvent.change to set the raw value and
    // fireEvent.submit on the form to call the React onSubmit handler directly,
    // bypassing the native constraint-validation layer.
    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'notanemail' } });

    const form = emailInput.closest('form')!;
    fireEvent.submit(form);

    expect(
      await screen.findByText('Please enter a valid email address.')
    ).toBeInTheDocument();
  });

  it('shows a validation error when the password field is empty on submit', async () => {
    const user = userEvent.setup();
    const onLogin = resolvedLogin();
    renderLoginPage({ onLogin });

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByText('Password is required.')
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Happy-path / onLogin callback tests
  // -----------------------------------------------------------------------

  it('calls onLogin with the entered email and password on valid submit', async () => {
    const user = userEvent.setup();
    const onLogin = resolvedLogin();
    renderLoginPage({ onLogin });

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(onLogin).toHaveBeenCalledOnce();
    expect(onLogin).toHaveBeenCalledWith('admin@example.com', 'secret123');
  });

  it('does not call onLogin when validation fails', async () => {
    const user = userEvent.setup();
    const onLogin = resolvedLogin();
    renderLoginPage({ onLogin });

    // Submit with no data at all — email validation will fire first
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(onLogin).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Error display tests
  // -----------------------------------------------------------------------

  it('displays the error message passed via the error prop', () => {
    renderLoginPage({ error: 'Invalid credentials' });
    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
  });

  it('displays an error message when onLogin rejects with an Error', async () => {
    const user = userEvent.setup();
    const onLogin = rejectedLogin('Network error occurred');
    renderLoginPage({ onLogin });

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByText('Network error occurred')
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Loading state tests
  // -----------------------------------------------------------------------

  it('disables the submit button and shows a spinner when isLoading is true', () => {
    renderLoginPage({ isLoading: true });

    const button = screen.getByRole('button', { name: /sign in/i });

    // Button.tsx sets disabled={isLoading}, so the element should be disabled
    expect(button).toBeDisabled();

    // Button.tsx renders a Loader2 (lucide) SVG in place of the icon when loading
    // The svg is a child of the button element
    const svg = button.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
