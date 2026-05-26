import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSkeleton } from '../LoadingSkeleton';

describe('LoadingSkeleton', () => {
  it('renders without errors', () => {
    render(<LoadingSkeleton />);
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('contains dark mode classes', () => {
    render(<LoadingSkeleton />);
    const skeleton = screen.getByTestId('loading-skeleton');
    const darkElements = skeleton.querySelectorAll('[class*="dark:"]');
    expect(darkElements.length).toBeGreaterThan(0);
  });

  it('renders animate-pulse for loading animation', () => {
    render(<LoadingSkeleton />);
    const skeleton = screen.getByTestId('loading-skeleton');
    expect(skeleton.className).toContain('animate-pulse');
  });
});
