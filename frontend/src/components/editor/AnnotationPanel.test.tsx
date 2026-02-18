import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnnotationPanel } from './AnnotationPanel';
import type { AnnotationOperation } from '../../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeAnnotation = (overrides: Partial<AnnotationOperation> = {}): AnnotationOperation => ({
  opId: 'op-1',
  opType: 'highlight',
  page: 1,
  bounds: { x: 10, y: 20, w: 100, h: 30 },
  author: 'Alice',
  ts: '2024-06-15T10:30:00.000Z',
  ...overrides,
});

const EMPTY: AnnotationOperation[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnnotationPanel', () => {
  it('shows the "Annotations" heading', () => {
    render(<AnnotationPanel annotations={EMPTY} onRemove={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Annotations');
  });

  it('shows "No annotations yet" when the annotations list is empty', () => {
    render(<AnnotationPanel annotations={EMPTY} onRemove={vi.fn()} />);

    expect(screen.getByText('No annotations yet')).toBeInTheDocument();
  });

  it('shows a count badge reflecting the number of annotations', () => {
    const annotations = [
      makeAnnotation({ opId: 'op-1' }),
      makeAnnotation({ opId: 'op-2' }),
      makeAnnotation({ opId: 'op-3' }),
    ];

    render(<AnnotationPanel annotations={annotations} onRemove={vi.fn()} />);

    // The Badge renders the count as its text content inside a <span>
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders the annotation type name for a single annotation', () => {
    const annotation = makeAnnotation({ opType: 'redaction' });

    render(<AnnotationPanel annotations={[annotation]} onRemove={vi.fn()} />);

    // The component renders the opType with `capitalize` CSS, but the DOM text is lowercase
    expect(screen.getByText('redaction')).toBeInTheDocument();
  });

  it('shows the page number for an annotation', () => {
    const annotation = makeAnnotation({ page: 7 });

    render(<AnnotationPanel annotations={[annotation]} onRemove={vi.fn()} />);

    expect(screen.getByText('p.7')).toBeInTheDocument();
  });

  it('shows the author name for an annotation', () => {
    const annotation = makeAnnotation({ author: 'Dr. Smith' });

    render(<AnnotationPanel annotations={[annotation]} onRemove={vi.fn()} />);

    // The author appears as part of the "author · time" line; check for the author substring
    expect(screen.getByText(/Dr\. Smith/)).toBeInTheDocument();
  });

  it('calls onRemove with the correct opId when the delete button is clicked', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const annotation = makeAnnotation({ opId: 'op-abc-123' });

    render(<AnnotationPanel annotations={[annotation]} onRemove={onRemove} />);

    // The delete button contains a Trash2 icon; find it via its parent button role
    const deleteButtons = screen.getAllByRole('button');
    expect(deleteButtons).toHaveLength(1);

    await user.click(deleteButtons[0]);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('op-abc-123');
  });

  it('renders multiple annotations and shows each type and page', () => {
    const annotations: AnnotationOperation[] = [
      makeAnnotation({ opId: 'op-1', opType: 'highlight', page: 1 }),
      makeAnnotation({ opId: 'op-2', opType: 'ink', page: 2 }),
      makeAnnotation({ opId: 'op-3', opType: 'text', page: 3 }),
    ];

    render(<AnnotationPanel annotations={annotations} onRemove={vi.fn()} />);

    // Each type should appear exactly once
    expect(screen.getByText('highlight')).toBeInTheDocument();
    expect(screen.getByText('ink')).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();

    // Each page label should appear exactly once
    expect(screen.getByText('p.1')).toBeInTheDocument();
    expect(screen.getByText('p.2')).toBeInTheDocument();
    expect(screen.getByText('p.3')).toBeInTheDocument();

    // There should be one delete button per annotation
    expect(screen.getAllByRole('button')).toHaveLength(3);

    // "No annotations yet" must not be visible
    expect(screen.queryByText('No annotations yet')).not.toBeInTheDocument();
  });
});
