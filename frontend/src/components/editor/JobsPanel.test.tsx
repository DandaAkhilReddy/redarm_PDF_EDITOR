import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JobsPanel } from './JobsPanel';
import type { JobResponse } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    jobId: 'job-abc-123',
    status: 'queued',
    type: 'export',
    resultUri: null,
    error: null,
    updatedAt: '2026-02-18T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JobsPanel', () => {
  // 1. Heading is always visible
  it('shows "Jobs" heading', () => {
    render(<JobsPanel jobs={[]} />);
    expect(screen.getByText('Jobs')).toBeInTheDocument();
  });

  // 2. Empty-state message
  it('shows "No jobs yet" when the jobs array is empty', () => {
    render(<JobsPanel jobs={[]} />);
    expect(screen.getByText('No jobs yet')).toBeInTheDocument();
  });

  // 3. Count badge reflects the number of jobs passed in
  it('shows count badge with the correct job count', () => {
    const jobs: JobResponse[] = [
      makeJob({ jobId: 'job-1' }),
      makeJob({ jobId: 'job-2' }),
      makeJob({ jobId: 'job-3' }),
    ];
    render(<JobsPanel jobs={jobs} />);
    // The badge lives next to the "Jobs" heading and should display "3"
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  // 4. "No jobs yet" is NOT shown when there are jobs
  it('does not show "No jobs yet" when at least one job is present', () => {
    render(<JobsPanel jobs={[makeJob()]} />);
    expect(screen.queryByText('No jobs yet')).not.toBeInTheDocument();
  });

  // 5. Job type is rendered in upper-case
  it('renders job type in uppercase', () => {
    render(<JobsPanel jobs={[makeJob({ type: 'ocr' })]} />);
    // The component applies `uppercase` via Tailwind; the DOM text is the raw
    // value. We verify the text node is present and the element carries the
    // `uppercase` CSS class.
    const typeEl = screen.getByText('ocr');
    expect(typeEl).toBeInTheDocument();
    expect(typeEl.className).toContain('uppercase');
  });

  // 6. Status badge renders the job's current status text
  it('shows the job status text inside a badge', () => {
    render(<JobsPanel jobs={[makeJob({ status: 'completed' })]} />);
    // "completed" appears as the badge label
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  // 7. Download link is rendered when resultUri is present
  it('shows "Download result" link when resultUri is provided', () => {
    const uri = 'https://storage.example.com/results/job-abc-123.pdf';
    render(<JobsPanel jobs={[makeJob({ status: 'completed', resultUri: uri })]} />);

    const link = screen.getByRole('link', { name: /download result/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', uri);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  // 8. Download link is NOT rendered when resultUri is null
  it('does not show "Download result" link when resultUri is null', () => {
    render(<JobsPanel jobs={[makeJob({ resultUri: null })]} />);
    expect(screen.queryByRole('link', { name: /download result/i })).not.toBeInTheDocument();
  });

  // 9. Error message is rendered when error is present
  it('shows error message when job.error is set', () => {
    const errorMsg = 'Export failed: timeout after 30 s';
    render(<JobsPanel jobs={[makeJob({ status: 'failed', error: errorMsg })]} />);
    expect(screen.getByText(errorMsg)).toBeInTheDocument();
  });

  // 10. Error message is NOT rendered when error is null
  it('does not show an error message when job.error is null', () => {
    render(<JobsPanel jobs={[makeJob({ error: null })]} />);
    // There is no element with the red-500 error paragraph
    // We use a loose selector to confirm no unexpected error text appears
    expect(screen.queryByText(/failed|error/i)).not.toBeInTheDocument();
  });

  // 11. Spinner (Loader2) is present for "running" jobs
  it('renders spinner icon for running jobs', () => {
    render(<JobsPanel jobs={[makeJob({ status: 'running' })]} />);
    // Lucide renders an <svg>. The Loader2 icon uses the animate-spin class.
    const spinner = document.querySelector('svg.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  // 12. Spinner is present for "queued" jobs
  it('renders spinner icon for queued jobs', () => {
    render(<JobsPanel jobs={[makeJob({ status: 'queued' })]} />);
    const spinner = document.querySelector('svg.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  // 13. Spinner is NOT shown for terminal statuses
  it('does not render a spinner for completed jobs', () => {
    render(<JobsPanel jobs={[makeJob({ status: 'completed' })]} />);
    expect(document.querySelector('svg.animate-spin')).not.toBeInTheDocument();
  });

  // 14. jobId is displayed in the card
  it('renders the jobId text inside the card', () => {
    const id = 'job-unique-xyz-9876';
    render(<JobsPanel jobs={[makeJob({ jobId: id })]} />);
    expect(screen.getByText(id)).toBeInTheDocument();
  });

  // 15. Multiple jobs are all rendered
  it('renders a card for every job in the array', () => {
    const jobs: JobResponse[] = [
      makeJob({ jobId: 'job-001', type: 'export' }),
      makeJob({ jobId: 'job-002', type: 'ocr' }),
      makeJob({ jobId: 'job-003', type: 'export' }),
    ];
    render(<JobsPanel jobs={jobs} />);

    expect(screen.getByText('job-001')).toBeInTheDocument();
    expect(screen.getByText('job-002')).toBeInTheDocument();
    expect(screen.getByText('job-003')).toBeInTheDocument();
  });

  // 16. Count badge shows "0" when no jobs are supplied
  it('shows count badge with 0 when the jobs array is empty', () => {
    render(<JobsPanel jobs={[]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
