import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorLayout } from './EditorLayout';

describe('EditorLayout', () => {
  it('renders sidebar content', () => {
    render(
      <EditorLayout
        sidebar={<div>Sidebar</div>}
        toolbar={<div>Toolbar</div>}
        canvas={<div>Canvas</div>}
        rightPanel={<div>RightPanel</div>}
      />
    );
    expect(screen.getByText('Sidebar')).toBeInTheDocument();
  });

  it('renders toolbar content', () => {
    render(
      <EditorLayout
        sidebar={<div>Sidebar</div>}
        toolbar={<div>Toolbar</div>}
        canvas={<div>Canvas</div>}
        rightPanel={<div>RightPanel</div>}
      />
    );
    expect(screen.getByText('Toolbar')).toBeInTheDocument();
  });

  it('renders canvas content', () => {
    render(
      <EditorLayout
        sidebar={<div>Sidebar</div>}
        toolbar={<div>Toolbar</div>}
        canvas={<div>Canvas</div>}
        rightPanel={<div>RightPanel</div>}
      />
    );
    expect(screen.getByText('Canvas')).toBeInTheDocument();
  });

  it('renders rightPanel content', () => {
    render(
      <EditorLayout
        sidebar={<div>Sidebar</div>}
        toolbar={<div>Toolbar</div>}
        canvas={<div>Canvas</div>}
        rightPanel={<div>RightPanel</div>}
      />
    );
    expect(screen.getByText('RightPanel')).toBeInTheDocument();
  });
});
