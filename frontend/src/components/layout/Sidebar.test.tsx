import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';

// ---------------------------------------------------------------------------
// Default prop factory — keeps each test focused on the one thing it changes.
// ---------------------------------------------------------------------------
const makeThumbnail = () => vi.fn().mockResolvedValue('data:image/png;base64,thumb');

function buildProps(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return {
    totalPages: 0,
    currentPage: 1,
    onGoToPage: vi.fn(),
    onUpload: vi.fn(),
    getThumbnail: makeThumbnail(),
    isDocLoaded: false,
    ...overrides,
  };
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1 -----------------------------------------------------------------------
  it('shows "No document loaded" when isDocLoaded is false', () => {
    render(<Sidebar {...buildProps({ isDocLoaded: false, totalPages: 0 })} />);

    expect(screen.getByText('No document loaded')).toBeInTheDocument();
  });

  // 2 -----------------------------------------------------------------------
  it('shows "Upload PDF" text', () => {
    render(<Sidebar {...buildProps()} />);

    expect(screen.getByText('Upload PDF')).toBeInTheDocument();
  });

  // 3 -----------------------------------------------------------------------
  it('shows "Pages" heading', () => {
    render(<Sidebar {...buildProps()} />);

    expect(screen.getByText('Pages')).toBeInTheDocument();
  });

  // 4 -----------------------------------------------------------------------
  it('renders one button per page when totalPages > 0', async () => {
    render(
      <Sidebar
        {...buildProps({ totalPages: 3, isDocLoaded: true })}
      />,
    );

    // Page buttons are rendered synchronously; thumbnails load asynchronously.
    // We only need to assert the buttons, not the images.
    const pageButtons = await screen.findAllByRole('button', { name: /^[123]$/ });
    expect(pageButtons).toHaveLength(3);
  });

  // 5 -----------------------------------------------------------------------
  it('calls onGoToPage with the correct page number when a page button is clicked', async () => {
    const user = userEvent.setup();
    const onGoToPage = vi.fn();

    render(
      <Sidebar
        {...buildProps({ totalPages: 3, currentPage: 1, isDocLoaded: true, onGoToPage })}
      />,
    );

    // Button text is the page number rendered inside a <span>.
    // findByRole searches accessible name which includes child text.
    const page2Button = await screen.findByRole('button', { name: '2' });
    await user.click(page2Button);

    expect(onGoToPage).toHaveBeenCalledOnce();
    expect(onGoToPage).toHaveBeenCalledWith(2);
  });

  // 6 -----------------------------------------------------------------------
  it('collapses the sidebar when the collapse button is clicked', async () => {
    const user = userEvent.setup();

    render(<Sidebar {...buildProps()} />);

    // The expanded sidebar shows the "Pages" heading.
    expect(screen.getByText('Pages')).toBeInTheDocument();

    const collapseBtn = screen.getByRole('button', { name: 'Collapse sidebar' });
    await user.click(collapseBtn);

    // After collapsing, the "Pages" heading is no longer rendered.
    expect(screen.queryByText('Pages')).not.toBeInTheDocument();
  });

  // 7 -----------------------------------------------------------------------
  it('expands the sidebar when the expand button is clicked after collapsing', async () => {
    const user = userEvent.setup();

    render(<Sidebar {...buildProps()} />);

    // Collapse first.
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByText('Pages')).not.toBeInTheDocument();

    // Now expand.
    const expandBtn = screen.getByRole('button', { name: 'Expand sidebar' });
    await user.click(expandBtn);

    expect(screen.getByText('Pages')).toBeInTheDocument();
  });

  // 8 -----------------------------------------------------------------------
  it('has a hidden file input that accepts only PDF files', () => {
    render(<Sidebar {...buildProps()} />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');

    expect(input).not.toBeNull();
    expect(input!.accept).toBe('application/pdf');
  });

  // Bonus -------------------------------------------------------------------
  it('calls onUpload with the selected File object when a file is chosen', async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();

    render(<Sidebar {...buildProps({ onUpload })} />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['%PDF-1.4'], 'sample.pdf', { type: 'application/pdf' });

    await user.upload(input, file);

    expect(onUpload).toHaveBeenCalledOnce();
    expect(onUpload).toHaveBeenCalledWith(file);
  });
});
