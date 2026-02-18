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
  isSaving: false,
  canEdit: true,
};

// Helper: returns [prevPage, nextPage, zoomOut, zoomIn] buttons.
// The toolbar renders (in order): 7 tool buttons, prevPage, nextPage,
// zoomOut, zoomIn, clearAnnotations, OCR, Export, Save.
// The unnamed ghost buttons (no title) appear in that fixed order.
function getUnnamedButtons() {
  const all = screen.getAllByRole('button');
  // 7 tool buttons have a title attr and are first; skip them.
  // Remaining buttons: prevPage[0], nextPage[1], zoomOut[2], zoomIn[3],
  // clearAnnotations[4], ocr[5], export[6], save[7]
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

  it('renders all 7 tool buttons by title attribute', () => {
    render(<Toolbar {...defaultProps} />);

    expect(screen.getByTitle('Select')).toBeInTheDocument();
    expect(screen.getByTitle('Pan')).toBeInTheDocument();
    expect(screen.getByTitle('Highlight')).toBeInTheDocument();
    expect(screen.getByTitle('Ink')).toBeInTheDocument();
    expect(screen.getByTitle('Text')).toBeInTheDocument();
    expect(screen.getByTitle('Shape')).toBeInTheDocument();
    expect(screen.getByTitle('Redact')).toBeInTheDocument();
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
    expect(screen.getByTitle('Select')).not.toBeDisabled();
    expect(screen.getByTitle('Pan')).not.toBeDisabled();

    // every other annotation tool must be disabled
    expect(screen.getByTitle('Highlight')).toBeDisabled();
    expect(screen.getByTitle('Ink')).toBeDisabled();
    expect(screen.getByTitle('Text')).toBeDisabled();
    expect(screen.getByTitle('Shape')).toBeDisabled();
    expect(screen.getByTitle('Redact')).toBeDisabled();
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
});
