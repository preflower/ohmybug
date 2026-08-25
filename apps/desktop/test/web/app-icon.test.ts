// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

const desktopRoot = resolve(import.meta.dirname, "../..");

describe("application icon", () => {
  it("ships a black mascot that fills the canvas while retaining safe visual padding", async () => {
    const iconPath = resolve(desktopRoot, "assets/icons/oh-my-bug.png");
    expect(existsSync(iconPath)).toBe(true);

    const { data, info } = await sharp(iconPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(1024);
    expect(info.height).toBe(1024);
    expect(info.channels).toBe(4);

    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    let opaquePixels = 0;
    let opaqueRgbTotal = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const offset = (y * info.width + x) * info.channels;
        const alpha = data[offset + 3]!;
        const isArtwork = alpha > 32;
        if (!isArtwork) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (alpha > 200) {
          opaquePixels += 1;
          opaqueRgbTotal += (data[offset]! + data[offset + 1]! + data[offset + 2]!) / 3;
        }
      }
    }

    const safeInset = Math.floor(info.width * 0.1);
    expect({ minX, minY, maxX, maxY }).toMatchObject({
      minX: expect.any(Number),
      minY: expect.any(Number),
      maxX: expect.any(Number),
      maxY: expect.any(Number)
    });
    expect(minX).toBeGreaterThanOrEqual(safeInset);
    expect(minY).toBeGreaterThanOrEqual(safeInset);
    expect(maxX).toBeLessThan(info.width - safeInset);
    expect(maxY).toBeLessThan(info.height - safeInset);
    expect(maxX - minX + 1).toBeGreaterThanOrEqual(Math.floor(info.width * 0.7));
    expect(maxY - minY + 1).toBeGreaterThanOrEqual(Math.floor(info.height * 0.78));
    expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(opaquePixels).toBeGreaterThan(10_000);
    expect(opaqueRgbTotal / opaquePixels).toBeLessThan(64);
  });

  it("exposes the same icon as the browser favicon", () => {
    const publicIconPath = resolve(desktopRoot, "public/app-icon.png");
    expect(existsSync(publicIconPath)).toBe(true);
    expect(readFileSync(publicIconPath)).toEqual(
      readFileSync(resolve(desktopRoot, "assets/icons/oh-my-bug.png")),
    );

    const html = readFileSync(resolve(desktopRoot, "index.html"), "utf8");
    const parsed = document.implementation.createHTMLDocument("Oh My Bug");
    parsed.documentElement.innerHTML = html;
    expect(parsed.title).toBe("Oh My Bug ?!");
    expect(parsed.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute("href")).toBe("/app-icon.png");
    expect(html.indexOf("oh-my-bug-theme")).toBeGreaterThan(-1);
    expect(html.indexOf("oh-my-bug-theme")).toBeLessThan(html.indexOf("/src/web/main.tsx"));
  });

  it("ships standard and Retina monochrome macOS tray template images", async () => {
    for (const [name, size] of [
      ["oh-my-bug-trayTemplate.png", 18],
      ["oh-my-bug-trayTemplate@2x.png", 36],
    ] as const) {
      const path = resolve(desktopRoot, "assets/icons", name);
      expect(existsSync(path)).toBe(true);
      const { data, info } = await sharp(path)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect({ width: info.width, height: info.height, channels: info.channels }).toEqual({
        width: size,
        height: size,
        channels: 4,
      });

      const cornerOffsets = [
        3,
        (size - 1) * 4 + 3,
        ((size - 1) * size) * 4 + 3,
        (size * size - 1) * 4 + 3,
      ];
      for (const offset of cornerOffsets) expect(data[offset]).toBe(0);

      let minX: number = size;
      let minY: number = size;
      let maxX = -1;
      let maxY = -1;
      let visiblePixels = 0;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const offset = (y * size + x) * 4;
          const alpha = data[offset + 3]!;
          if (alpha <= 32) continue;
          visiblePixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          expect(Math.max(data[offset]!, data[offset + 1]!, data[offset + 2]!)).toBeLessThan(32);
        }
      }
      const padding = size / 18;
      expect(visiblePixels).toBeGreaterThan(0);
      expect(minX).toBeGreaterThanOrEqual(padding);
      expect(minY).toBeGreaterThanOrEqual(padding);
      expect(maxX).toBeLessThan(size - padding);
      expect(maxY).toBeLessThan(size - padding);
      expect(maxX - minX + 1).toBeGreaterThanOrEqual(Math.floor(size * 0.7));
      expect(maxY - minY + 1).toBeGreaterThanOrEqual(Math.floor(size * 0.7));
    }
  });
});
