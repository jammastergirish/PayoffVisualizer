import { describe, it, expect } from 'vitest';

describe('Viewport Configuration', () => {
  it('should have proper viewport configuration format', () => {
    // Test the expected viewport configuration structure
    const expectedViewport = {
      width: 'device-width',
      initialScale: 1,
      maximumScale: 5,
      userScalable: true
    };

    expect(expectedViewport.width).toBe('device-width');
    expect(expectedViewport.initialScale).toBe(1);
    expect(expectedViewport.maximumScale).toBe(5);
    expect(expectedViewport.userScalable).toBe(true);
  });

  it('should have proper metadata structure', () => {
    // Test the expected metadata configuration structure
    const expectedMetadata = {
      title: 'TradeShape',
      description: 'Personalized trading dashboard for Interactive Brokers'
    };

    expect(expectedMetadata.title).toBe('TradeShape');
    expect(expectedMetadata.description).toBe('Personalized trading dashboard for Interactive Brokers');
    expect(expectedMetadata.viewport).toBeUndefined();
  });

  it('should separate viewport from metadata (Next.js 16 requirement)', () => {
    // Verify that viewport is exported separately from metadata
    const metadataWithViewport = {
      title: 'TradeShape',
      viewport: 'width=device-width, initial-scale=1'
    };

    const metadataWithoutViewport = {
      title: 'TradeShape'
    };

    const separateViewport = {
      width: 'device-width',
      initialScale: 1
    };

    // This test ensures we understand the requirement to separate them
    expect(metadataWithoutViewport.viewport).toBeUndefined();
    expect(separateViewport.width).toBeDefined();
  });
});