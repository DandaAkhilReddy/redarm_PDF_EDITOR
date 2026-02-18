import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextEditor } from './TextEditor';

const defaultProps = {
  position: { x: 100, y: 200 },
  zoom: 1,
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
};

// ---------------------------------------------------------------------------
// requestAnimationFrame mock — executes callback synchronously so readyRef
// becomes true immediately.  Individual tests can override this when they need
// to test the "not-yet-ready" state.
// ---------------------------------------------------------------------------
let rafSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  rafSpy.mockRestore();
});

describe('TextEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  it('renders a textarea element', () => {
    render(<TextEditor {...defaultProps} />);

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders with correct placeholder "Type here..."', () => {
    render(<TextEditor {...defaultProps} />);

    expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument();
  });

  it('positions container at position.x * zoom, position.y * zoom', () => {
    const { container } = render(<TextEditor {...defaultProps} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.left).toBe('100px');
    expect(wrapper.style.top).toBe('200px');
  });

  it('shows "Enter to confirm · Esc to cancel" help text when not editing', () => {
    render(<TextEditor {...defaultProps} isEditing={false} />);

    expect(screen.getByText(/Enter to confirm/)).toBeInTheDocument();
    expect(screen.getByText(/Esc to cancel/)).toBeInTheDocument();
  });

  it('shows "Editing to confirm · Esc to cancel" help text when isEditing=true', () => {
    render(<TextEditor {...defaultProps} isEditing={true} />);

    expect(screen.getByText(/Editing to confirm/)).toBeInTheDocument();
    expect(screen.getByText(/Esc to cancel/)).toBeInTheDocument();
  });

  it('uses green border class when isEditing=false (new text)', () => {
    render(<TextEditor {...defaultProps} isEditing={false} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain('border-green-500');
  });

  it('uses blue border class when isEditing=true (editing existing)', () => {
    render(<TextEditor {...defaultProps} isEditing={true} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain('border-blue-500');
  });

  it('pre-fills textarea with initialText when provided', () => {
    render(<TextEditor {...defaultProps} initialText="Hello World" />);

    expect(screen.getByRole('textbox')).toHaveValue('Hello World');
  });

  it('textarea is empty when no initialText provided', () => {
    render(<TextEditor {...defaultProps} />);

    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  // ---------------------------------------------------------------------------
  // Interaction - Submit
  // ---------------------------------------------------------------------------

  it('Enter key calls onSubmit with trimmed text', () => {
    render(<TextEditor {...defaultProps} initialText="  some text  " />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSubmit).toHaveBeenCalledWith('some text');
  });

  it('Enter key does NOT call onSubmit when text is empty (calls onCancel instead)', () => {
    render(<TextEditor {...defaultProps} initialText="" />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('Shift+Enter does NOT submit (allows multiline)', () => {
    render(<TextEditor {...defaultProps} initialText="hello" />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
  });

  it('blur calls onSubmit when text is non-empty and component is ready', () => {
    render(<TextEditor {...defaultProps} initialText="some text" />);

    const textarea = screen.getByRole('textbox');
    fireEvent.blur(textarea);

    expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSubmit).toHaveBeenCalledWith('some text');
  });

  it('blur calls onCancel when text is empty/whitespace and component is ready', () => {
    render(<TextEditor {...defaultProps} initialText="   " />);

    const textarea = screen.getByRole('textbox');
    fireEvent.blur(textarea);

    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Interaction - Cancel
  // ---------------------------------------------------------------------------

  it('Escape key calls onCancel', () => {
    render(<TextEditor {...defaultProps} initialText="text" />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape does not call onSubmit', () => {
    render(<TextEditor {...defaultProps} initialText="text" />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Focus behavior
  // ---------------------------------------------------------------------------

  it('textarea receives focus on mount (via requestAnimationFrame)', () => {
    render(<TextEditor {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    expect(document.activeElement).toBe(textarea);
  });

  // ---------------------------------------------------------------------------
  // Typing
  // ---------------------------------------------------------------------------

  it('typing updates the textarea value', async () => {
    const user = userEvent.setup();
    render(<TextEditor {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'New text');

    expect(textarea).toHaveValue('New text');
  });

  it('typing then Enter submits the typed text', async () => {
    const user = userEvent.setup();
    render(<TextEditor {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'My annotation');

    // Use fireEvent for Enter to avoid blur side-effects from userEvent
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(defaultProps.onSubmit).toHaveBeenCalledWith('My annotation');
  });

  it('can type, clear, and get cancel on submit of empty', async () => {
    const user = userEvent.setup();
    render(<TextEditor {...defaultProps} />);

    const textarea = screen.getByRole('textbox');

    // Type something
    await user.type(textarea, 'temporary');
    expect(textarea).toHaveValue('temporary');

    // Clear it all
    await user.clear(textarea);
    expect(textarea).toHaveValue('');

    // Submit with empty text should cancel
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Position calculations
  // ---------------------------------------------------------------------------

  it('position={x:100, y:200} zoom=1 results in left:100px, top:200px', () => {
    const { container } = render(
      <TextEditor {...defaultProps} position={{ x: 100, y: 200 }} zoom={1} />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.left).toBe('100px');
    expect(wrapper.style.top).toBe('200px');
  });

  it('position={x:100, y:200} zoom=2 results in left:200px, top:400px', () => {
    const { container } = render(
      <TextEditor {...defaultProps} position={{ x: 100, y: 200 }} zoom={2} />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.left).toBe('200px');
    expect(wrapper.style.top).toBe('400px');
  });

  // ---------------------------------------------------------------------------
  // Additional edge cases
  // ---------------------------------------------------------------------------

  it('applies bg-blue-50 dark mode class when isEditing=true', () => {
    render(<TextEditor {...defaultProps} isEditing={true} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain('bg-blue-50');
    expect(textarea.className).toContain('dark:bg-blue-950');
  });

  it('applies bg-white class when isEditing=false', () => {
    render(<TextEditor {...defaultProps} isEditing={false} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain('bg-white');
    expect(textarea.className).toContain('dark:bg-slate-800');
  });

  it('Enter on whitespace-only text triggers onCancel not onSubmit', () => {
    render(<TextEditor {...defaultProps} initialText="   " />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('position with fractional zoom computes correctly', () => {
    const { container } = render(
      <TextEditor {...defaultProps} position={{ x: 50, y: 75 }} zoom={1.5} />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.left).toBe('75px');
    expect(wrapper.style.top).toBe('112.5px');
  });

  // ---------------------------------------------------------------------------
  // readyRef blur guard (Bug 1 fix)
  // ---------------------------------------------------------------------------

  it('blur before readyRef is set does NOT call onSubmit or onCancel', () => {
    // Override the rAF mock so callback is NOT called immediately
    rafSpy.mockRestore();
    const pendingCallbacks: FrameRequestCallback[] = [];
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      pendingCallbacks.push(cb);
      return pendingCallbacks.length;
    });

    render(<TextEditor {...defaultProps} initialText="some text" />);

    const textarea = screen.getByRole('textbox');
    // Blur fires before rAF callback executes
    fireEvent.blur(textarea);

    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
  });

  it('blur after readyRef is set via rAF calls onSubmit correctly', () => {
    // Override the rAF mock to capture and control execution
    rafSpy.mockRestore();
    const pendingCallbacks: FrameRequestCallback[] = [];
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      pendingCallbacks.push(cb);
      return pendingCallbacks.length;
    });

    render(<TextEditor {...defaultProps} initialText="some text" />);

    // Execute the rAF callback (sets readyRef.current = true)
    pendingCallbacks.forEach((cb) => cb(0));

    const textarea = screen.getByRole('textbox');
    fireEvent.blur(textarea);

    expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSubmit).toHaveBeenCalledWith('some text');
  });

  // ---------------------------------------------------------------------------
  // stopPropagation on pointerDown (Bug 1 fix)
  // ---------------------------------------------------------------------------

  it('pointerDown on wrapper div calls stopPropagation', () => {
    const { container } = render(<TextEditor {...defaultProps} />);
    const wrapper = container.firstChild as HTMLElement;

    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    wrapper.dispatchEvent(event);

    expect(stopSpy).toHaveBeenCalled();
  });
});
