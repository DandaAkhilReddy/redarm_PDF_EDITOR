import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastContainer } from './Toast';
import type { Toast } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeToast = (overrides: Partial<Toast> = {}): Toast => ({
  id: 'toast-1',
  type: 'info',
  message: 'Test message',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ToastContainer', () => {
  let onDismiss: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onDismiss = vi.fn();
  });

  // 1. Empty state
  it('returns null when toasts array is empty', () => {
    const { container } = render(
      <ToastContainer toasts={[]} onDismiss={onDismiss} />
    );
    expect(container.firstChild).toBeNull();
  });

  // 2. Renders a single toast message
  it('renders the toast message text', () => {
    const toast = makeToast({ message: 'File saved successfully' });
    render(<ToastContainer toasts={[toast]} onDismiss={onDismiss} />);
    expect(screen.getByText('File saved successfully')).toBeInTheDocument();
  });

  // 3. Renders multiple toasts simultaneously
  it('renders multiple toasts at the same time', () => {
    const toasts: Toast[] = [
      makeToast({ id: 'a', message: 'First toast' }),
      makeToast({ id: 'b', message: 'Second toast' }),
      makeToast({ id: 'c', message: 'Third toast' }),
    ];
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);
    expect(screen.getByText('First toast')).toBeInTheDocument();
    expect(screen.getByText('Second toast')).toBeInTheDocument();
    expect(screen.getByText('Third toast')).toBeInTheDocument();
  });

  // 4. Shows a dismiss button for each toast
  it('renders a dismiss button for each toast', () => {
    const toasts: Toast[] = [
      makeToast({ id: 'a', message: 'Toast A' }),
      makeToast({ id: 'b', message: 'Toast B' }),
    ];
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);
    // Each ToastItem has exactly one <button>
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  // 5. Calls onDismiss with the correct id when the dismiss button is clicked
  it('calls onDismiss with the toast id when the dismiss button is clicked', async () => {
    const user = userEvent.setup();
    const toast = makeToast({ id: 'dismiss-me', message: 'Click to dismiss' });
    render(<ToastContainer toasts={[toast]} onDismiss={onDismiss} />);

    const button = screen.getByRole('button');
    await user.click(button);

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith('dismiss-me');
  });

  // 6. Auto-dismisses after the default 5 000 ms duration
  it('auto-dismisses after the default 5000ms duration', () => {
    vi.useFakeTimers();
    try {
      const toast = makeToast({ id: 'auto-default', message: 'Auto dismiss default' });
      render(<ToastContainer toasts={[toast]} onDismiss={onDismiss} />);

      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(onDismiss).toHaveBeenCalledOnce();
      expect(onDismiss).toHaveBeenCalledWith('auto-default');
    } finally {
      vi.useRealTimers();
    }
  });

  // 6b. Auto-dismisses after a custom duration
  it('auto-dismisses after a custom duration', () => {
    vi.useFakeTimers();
    try {
      const toast = makeToast({ id: 'auto-custom', message: 'Auto dismiss custom', duration: 2000 });
      render(<ToastContainer toasts={[toast]} onDismiss={onDismiss} />);

      act(() => {
        vi.advanceTimersByTime(1999);
      });
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(onDismiss).toHaveBeenCalledWith('auto-custom');
    } finally {
      vi.useRealTimers();
    }
  });

  // 7. Success variant applies the correct styling classes
  it('applies success styling classes for a success toast', () => {
    const toast = makeToast({ type: 'success', message: 'Operation succeeded' });
    render(<ToastContainer toasts={[toast]} onDismiss={onDismiss} />);

    // The outermost div inside the container wraps each ToastItem
    const toastEl = screen.getByText('Operation succeeded').closest('div');
    expect(toastEl).toHaveClass('border-emerald-200');
    expect(toastEl).toHaveClass('bg-emerald-50');
    expect(toastEl).toHaveClass('text-emerald-800');
  });

  // 7b. Error variant applies the correct styling classes
  it('applies error styling classes for an error toast', () => {
    const toast = makeToast({ type: 'error', message: 'Something went wrong' });
    render(<ToastContainer toasts={[toast]} onDismiss={onDismiss} />);

    const toastEl = screen.getByText('Something went wrong').closest('div');
    expect(toastEl).toHaveClass('border-red-200');
    expect(toastEl).toHaveClass('bg-red-50');
    expect(toastEl).toHaveClass('text-red-800');
  });

  // 7c. Info variant applies the correct styling classes
  it('applies info styling classes for an info toast', () => {
    const toast = makeToast({ type: 'info', message: 'Just so you know' });
    render(<ToastContainer toasts={[toast]} onDismiss={onDismiss} />);

    const toastEl = screen.getByText('Just so you know').closest('div');
    expect(toastEl).toHaveClass('border-blue-200');
    expect(toastEl).toHaveClass('bg-blue-50');
    expect(toastEl).toHaveClass('text-blue-800');
  });

  // 8. The message text is rendered inside a <p> element
  it('renders the toast message inside a paragraph element', () => {
    const toast = makeToast({ message: 'Paragraph check' });
    render(<ToastContainer toasts={[toast]} onDismiss={onDismiss} />);

    const paragraph = screen.getByText('Paragraph check');
    expect(paragraph.tagName).toBe('P');
  });
});
