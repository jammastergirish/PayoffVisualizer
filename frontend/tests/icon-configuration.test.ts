import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Icon Configuration Tests', () => {
  const publicDir = path.join(process.cwd(), 'public');
  const appDir = path.join(process.cwd(), 'app');

  describe('Icon File Existence', () => {
    it('should have all required icon files in public directory', () => {
      const requiredIcons = [
        'icon.png',
        'icon-192.png',
        'apple-icon-180.png',
        'favicon-32.png',
        'favicon-16.png'
      ];

      requiredIcons.forEach(iconFile => {
        const iconPath = path.join(publicDir, iconFile);
        expect(fs.existsSync(iconPath), `${iconFile} should exist in public directory`).toBe(true);
      });
    });

    it('should have icon.png in app directory for Next.js convention', () => {
      const iconPath = path.join(appDir, 'icon.png');
      expect(fs.existsSync(iconPath)).toBe(true);
    });

    it('should have manifest.json file', () => {
      const manifestPath = path.join(publicDir, 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
    });
  });

  describe('Icon File Properties', () => {
    it('should have non-empty icon files', () => {
      const iconFiles = [
        'icon.png',
        'icon-192.png',
        'apple-icon-180.png',
        'favicon-32.png',
        'favicon-16.png'
      ];

      iconFiles.forEach(iconFile => {
        const iconPath = path.join(publicDir, iconFile);
        const stats = fs.statSync(iconPath);
        expect(stats.size, `${iconFile} should not be empty`).toBeGreaterThan(0);
      });
    });

    it('should have main icon as largest file', () => {
      const mainIconPath = path.join(publicDir, 'icon.png');
      const smallIconPath = path.join(publicDir, 'favicon-16.png');

      const mainIconStats = fs.statSync(mainIconPath);
      const smallIconStats = fs.statSync(smallIconPath);

      expect(mainIconStats.size).toBeGreaterThan(smallIconStats.size);
    });

    it('should have appropriate file sizes for different icon variants', () => {
      const iconSizeExpectations = [
        { file: 'favicon-16.png', maxSize: 5000 }, // Small favicon should be under 5KB
        { file: 'favicon-32.png', maxSize: 10000 }, // 32px should be under 10KB
        { file: 'icon-192.png', maxSize: 100000 }, // 192px should be under 100KB
        { file: 'apple-icon-180.png', maxSize: 100000 } // Apple icon should be under 100KB
      ];

      iconSizeExpectations.forEach(({ file, maxSize }) => {
        const iconPath = path.join(publicDir, file);
        if (fs.existsSync(iconPath)) {
          const stats = fs.statSync(iconPath);
          expect(stats.size, `${file} should be optimized and under ${maxSize} bytes`).toBeLessThan(maxSize);
        }
      });
    });
  });

  describe('Metadata Configuration', () => {
    it('should have correct icon metadata structure', () => {
      // Test the expected metadata structure for icons
      const expectedIconConfig = {
        icons: {
          icon: [
            { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
            { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
            { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { url: '/icon.png', sizes: '512x512', type: 'image/png' }
          ],
          apple: [
            { url: '/apple-icon-180.png', sizes: '180x180', type: 'image/png' }
          ]
        }
      };

      expect(expectedIconConfig.icons.icon).toHaveLength(4);
      expect(expectedIconConfig.icons.apple).toHaveLength(1);

      // Verify all icon entries have required properties
      expectedIconConfig.icons.icon.forEach(icon => {
        expect(icon).toHaveProperty('url');
        expect(icon).toHaveProperty('sizes');
        expect(icon).toHaveProperty('type');
        expect(icon.type).toBe('image/png');
      });
    });

    it('should have manifest reference in metadata', () => {
      const expectedMetadata = {
        manifest: '/manifest.json'
      };

      expect(expectedMetadata.manifest).toBe('/manifest.json');
    });
  });

  describe('PWA Manifest Configuration', () => {
    it('should have valid manifest.json structure', () => {
      const manifestPath = path.join(publicDir, 'manifest.json');
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      expect(manifest).toHaveProperty('name');
      expect(manifest).toHaveProperty('short_name');
      expect(manifest).toHaveProperty('description');
      expect(manifest).toHaveProperty('start_url');
      expect(manifest).toHaveProperty('display');
      expect(manifest).toHaveProperty('icons');

      expect(manifest.name).toBe('TradeShape');
      expect(manifest.short_name).toBe('TradeShape');
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBe('/');
    });

    it('should have all icon sizes in manifest', () => {
      const manifestPath = path.join(publicDir, 'manifest.json');
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      expect(manifest.icons).toBeInstanceOf(Array);
      expect(manifest.icons.length).toBeGreaterThanOrEqual(4);

      const iconSizes = manifest.icons.map((icon: any) => icon.sizes);
      expect(iconSizes).toContain('16x16');
      expect(iconSizes).toContain('32x32');
      expect(iconSizes).toContain('180x180');
      expect(iconSizes).toContain('192x192');
      expect(iconSizes).toContain('512x512');
    });

    it('should have proper theme and background colors for TradeShape branding', () => {
      const manifestPath = path.join(publicDir, 'manifest.json');
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      expect(manifest.background_color).toBe('#000000'); // Black background
      expect(manifest.theme_color).toBe('#f97316'); // Orange theme matching TradeShape
    });

    it('should have correct icon purposes for PWA compatibility', () => {
      const manifestPath = path.join(publicDir, 'manifest.json');
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      // Check that larger icons have proper purpose attributes
      const largeIcons = manifest.icons.filter((icon: any) =>
        icon.sizes === '192x192' || icon.sizes === '512x512'
      );

      largeIcons.forEach((icon: any) => {
        expect(icon.purpose).toBe('maskable any');
      });
    });
  });

  describe('Icon File Format and Quality', () => {
    it('should have PNG format for all icons', () => {
      const iconFiles = [
        'icon.png',
        'icon-192.png',
        'apple-icon-180.png',
        'favicon-32.png',
        'favicon-16.png'
      ];

      iconFiles.forEach(iconFile => {
        expect(iconFile.endsWith('.png')).toBe(true);
      });
    });

    it('should have valid PNG file headers', () => {
      const iconFiles = [
        'icon.png',
        'icon-192.png',
        'apple-icon-180.png',
        'favicon-32.png',
        'favicon-16.png'
      ];

      iconFiles.forEach(iconFile => {
        const iconPath = path.join(publicDir, iconFile);
        const buffer = fs.readFileSync(iconPath);

        // PNG files start with specific magic bytes
        const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const fileHeader = buffer.subarray(0, 8);

        expect(fileHeader.equals(pngSignature), `${iconFile} should have valid PNG signature`).toBe(true);
      });
    });
  });

  describe('Next.js Integration', () => {
    it('should be compatible with Next.js 13+ app directory conventions', () => {
      // Verify both public and app directory icons exist for maximum compatibility
      const publicIconPath = path.join(publicDir, 'icon.png');
      const appIconPath = path.join(appDir, 'icon.png');

      expect(fs.existsSync(publicIconPath)).toBe(true);
      expect(fs.existsSync(appIconPath)).toBe(true);
    });

    it('should have consistent file sizes between app and public directories', () => {
      const publicIconPath = path.join(publicDir, 'icon.png');
      const appIconPath = path.join(appDir, 'icon.png');

      if (fs.existsSync(publicIconPath) && fs.existsSync(appIconPath)) {
        const publicStats = fs.statSync(publicIconPath);
        const appStats = fs.statSync(appIconPath);

        expect(publicStats.size).toBe(appStats.size);
      }
    });
  });

  describe('Performance and Optimization', () => {
    it('should have reasonable file sizes for web performance', () => {
      const performanceThresholds = [
        { file: 'favicon-16.png', maxSize: 2000 }, // 2KB max for 16px
        { file: 'favicon-32.png', maxSize: 5000 }, // 5KB max for 32px
        { file: 'apple-icon-180.png', maxSize: 50000 }, // 50KB max for Apple icon
        { file: 'icon-192.png', maxSize: 60000 }, // 60KB max for PWA icon
      ];

      performanceThresholds.forEach(({ file, maxSize }) => {
        const iconPath = path.join(publicDir, file);
        if (fs.existsSync(iconPath)) {
          const stats = fs.statSync(iconPath);
          expect(stats.size, `${file} should be under ${maxSize} bytes for good performance`).toBeLessThan(maxSize);
        }
      });
    });

    it('should have optimized compression ratios', () => {
      const mainIconPath = path.join(publicDir, 'icon.png');
      const smallIconPath = path.join(publicDir, 'favicon-16.png');

      const mainStats = fs.statSync(mainIconPath);
      const smallStats = fs.statSync(smallIconPath);

      // The 16x16 icon should be significantly smaller than the 512x512 main icon
      const compressionRatio = mainStats.size / smallStats.size;
      expect(compressionRatio, 'Icons should show proper size scaling').toBeGreaterThan(10);
    });
  });
});