import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';

const defaultProps = {
  activeTool: 'select' as const,
  onToolChange: vi.fn(),
  currentPage: 1,
  totalPages: 5,
  scale: 1.0,
  onPrevPage: vi.fn(),
  onNextPage: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onSave: vi.fn(),
  onExport: vi.fn(),
  onOCR: vi.fn(),
  onClearAnnotations: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: false,
  canRedo: false,
  isSaving: false,
  canEdit: true,
};

// Helper: returns [prevPage, nextPage, zoomOut, zoomIn] buttons.
// The toolbar renders (in order): 8 tool buttons (with title), 2 undo/redo (with title),
// then unnamed ghost buttons: prevPage, nextPage, zoomOut, zoomIn,
// clearAnnotations (with title), ocr (with title), export, save.
function getUnnamedButtons() {
  const all = screen.getAllByRole('button');
  // Tool buttons and undo/redo/clear/ocr have title attrs; ghost nav buttons do not.
  const unnamed = all.filter((btn) => !btn.hasAttribute('title'));
  return {
    prevPage: unnamed[0],
    nextPage: unnamed[1],
    zoomOut: unnamed[2],
    zoomIn: unnamed[3],
  };
}

describe('Toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 8 tool buttons by title attribute', () => {
    render(<Toolbar {...defaultProps} />);

    expect(screen.getByTitle('Select \u2014 click text to edit')).toBeInTheDocument();
    expect(screen.getByTitle('Pan \u2014 scroll the document')).toBeInTheDocument();
    expect(screen.getByTitle('Highlight \u2014 click & drag a region')).toBeInTheDocument();
    expect(screen.getByTitle('Ink \u2014 freehand draw')).toBeInTheDocument();
    expect(screen.getByTitle('Text \u2014 click to place text')).toBeInTheDocument();
    expect(screen.getByTitle('Shape \u2014 click & drag a rectangle')).toBeInTheDocument();
    expect(screen.getByTitle('Redact \u2014 click & drag to cover')).toBeInTheDocument();
    expect(screen.getByTitle('Eraser \u2014 click an annotation to remove')).toBeInTheDocument();
  });

  it('shows page indicator "1 / 5"', () => {
    render(<Toolbar {...defaultProps} currentPage={1} totalPages={5} />);

    expect(screen.getByText('1 / 5')).toBeInTheDocument();
  });

  it('shows zoom percentage "100%"', () => {
    render(<Toolbar {...defaultProps} scale={1.0} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('calls onPrevPage when previous page button is clicked', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} currentPage={2} totalPages={5} />);

    await user.click(getUnnamedButtons().prevPage);

    expect(defaultProps.onPrevPage).toHaveBeenCalledTimes(1);
  });

  it('calls onNextPage when next page button is clicked', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} currentPage={2} totalPages={5} />);

    await user.click(getUnnamedButtons().nextPage);

    expect(defaultProps.onNextPage).toHaveBeenCalledTimes(1);
  });

  it('disables previous page button when currentPage <= 1', () => {
    render(<Toolbar {...defaultProps} currentPage={1} totalPages={5} />);

    expect(getUnnamedButtons().prevPage).toBeDisabled();
  });

  it('disables next page button when currentPage >= totalPages', () => {
    render(<Toolbar {...defaultProps} currentPage={5} totalPages={5} />);

    expect(getUnnamedButtons().nextPage).toBeDisabled();
  });

  it('calls onZoomOut when zoom out button is clicked', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} />);

    await user.click(getUnnamedButtons().zoomOut);

    expect(defaultProps.onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('calls onZoomIn when zoom in button is clicked', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} />);

    await user.click(getUnnamedButtons().zoomIn);

    expect(defaultProps.onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('calls onSave when Save button is clicked', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
  });

  it('calls onExport when Export button is clicked', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /export/i }));

    expect(defaultProps.onExport).toHaveBeenCalledTimes(1);
  });

  it('Save button is disabled and shows loading spinner when isSaving=true', () => {
    render(<Toolbar {...defaultProps} isSaving={true} />);

    // When isLoading=true the Button component disables the element
    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it('disables annotation tool buttons (except select and pan) when canEdit=false', () => {
    render(<Toolbar {...defaultProps} canEdit={false} />);

    // select and pan must remain enabled
    expect(screen.getByTitle('Select \u2014 click text to edit')).not.toBeDisabled();
    expect(screen.getByTitle('Pan \u2014 scroll the document')).not.toBeDisabled();

    // every other annotation tool must be disabled
    expect(screen.getByTitle('Highlight \u2014 click & drag a region')).toBeDisabled();
    expect(screen.getByTitle('Ink \u2014 freehand draw')).toBeDisabled();
    expect(screen.getByTitle('Text \u2014 click to place text')).toBeDisabled();
    expect(screen.getByTitle('Shape \u2014 click & drag a rectangle')).toBeDisabled();
    expect(screen.getByTitle('Redact \u2014 click & drag to cover')).toBeDisabled();
    expect(screen.getByTitle('Eraser \u2014 click an annotation to remove')).toBeDisabled();
  });

  it('shows "Export" text on the export button', () => {
    render(<Toolbar {...defaultProps} />);

    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('shows "Save" text on the save button', () => {
    render(<Toolbar {...defaultProps} />);

    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  // --- Eraser tool ---

  it('renders the Eraser tool button', () => {
    render(<Toolbar {...defaultProps} />);
    expect(screen.getByTitle('Eraser \u2014 click an annotation to remove')).toBeInTheDocument();
  });

  it('calls onToolChange with "eraser" when Eraser is clicked', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} />);

    await user.click(screen.getByTitle('Eraser \u2014 click an annotation to remove'));
    expect(defaultProps.onToolChange).toHaveBeenCalledWith('eraser');
  });

  it('highlights the eraser button when activeTool="eraser"', () => {
    render(<Toolbar {...defaultProps} activeTool="eraser" />);
    const btn = screen.getByTitle('Eraser \u2014 click an annotation to remove');
    expect(btn.className).toContain('bg-white');
  });

  // --- Undo/Redo buttons ---

  it('renders Undo and Redo buttons', () => {
    render(<Toolbar {...defaultProps} />);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeInTheDocument();
    expect(screen.getByTitle('Redo (Ctrl+Shift+Z)')).toBeInTheDocument();
  });

  it('Undo button is disabled when canUndo=false', () => {
    render(<Toolbar {...defaultProps} canUndo={false} />);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
  });

  it('Undo button is enabled when canUndo=true', () => {
    render(<Toolbar {...defaultProps} canUndo={true} />);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).not.toBeDisabled();
  });

  it('Redo button is disabled when canRedo=false', () => {
    render(<Toolbar {...defaultProps} canRedo={false} />);
    expect(screen.getByTitle('Redo (Ctrl+Shift+Z)')).toBeDisabled();
  });

  it('Redo button is enabled when canRedo=true', () => {
    render(<Toolbar {...defaultProps} canRedo={true} />);
    expect(screen.getByTitle('Redo (Ctrl+Shift+Z)')).not.toBeDisabled();
  });

  it('calls onUndo when Undo button is clicked', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} canUndo={true} />);

    await user.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(defaultProps.onUndo).toHaveBeenCalledTimes(1);
  });

  it('calls onRedo when Redo button is clicked', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...defaultProps} canRedo={true} />);

    await user.click(screen.getByTitle('Redo (Ctrl+Shift+Z)'));
    expect(defaultProps.onRedo).toHaveBeenCalledTimes(1);
  });

  it('Undo and Redo buttons are disabled when canEdit=false', () => {
    render(<Toolbar {...defaultProps} canEdit={false} canUndo={true} canRedo={true} />);
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
    expect(screen.getByTitle('Redo (Ctrl+Shift+Z)')).toBeDisabled();
  });
});
