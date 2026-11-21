import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../theme';

const WORDMARK_ASPECT_RATIO = 560 / 200;

export interface ClarifyLogoWordmarkProps {
  /** Rendered height in dp; width scales proportionally to the official 560x200 viewBox. */
  height?: number;
  /** Optional override width in dp. */
  width?: number;
  /** Optional fill color; defaults to official ClariFy Orange (#ff9718). */
  color?: string;
}

/**
 * Official ClariFy wordmark vector ported 1:1 from clarify-web/public/assets/clarify-logo.svg.
 * Uses exact official paths (speech-bubble C + ellipsis dots + "lariFy" wordmark).
 */
export function ClarifyLogoWordmark({
  height = 32,
  width,
  color = colors.ustpOrange,
}: ClarifyLogoWordmarkProps) {
  const computedWidth = width ?? Math.round(height * WORDMARK_ASPECT_RATIO);
  return (
    <Svg
      width={computedWidth}
      height={height}
      viewBox="0 0 560 200"
      fill="none"
      accessibilityRole="image"
      accessibilityLabel="ClariFy"
    >
      {/* Outer C + Speech Bubble Counter */}
      <Path
        fill={color}
        fillRule="evenodd"
        clipRule="evenodd"
        d="M182 48C165.5 23.8 137.6 8 106 8C55.2 8 14 49.2 14 100C14 150.8 55.2 192 106 192C137.6 192 165.5 176.2 182 152L145.5 129.5C135.8 141.2 121.6 148 105.5 148H58L74.5 130.5C63.8 121.4 57 107.8 57 92.5C57 65.2 78.9 43 106 43C122.4 43 136.9 51 145.8 63.4L182 48Z"
      />
      {/* Speech Bubble Ellipsis Dots */}
      <Circle cx="84" cy="96" r="8.5" fill={color} />
      <Circle cx="106" cy="96" r="8.5" fill={color} />
      <Circle cx="128" cy="96" r="8.5" fill={color} />
      {/* Wordmark "lariFy" */}
      <Rect x="193" y="48" width="21" height="99" fill={color} />
      <Path
        fill={color}
        fillRule="evenodd"
        clipRule="evenodd"
        d="M261 72C284.5 72 299 84.4 299 106.5V147H279V138.2C273.6 144.8 264.6 148.5 253.5 148.5C235.6 148.5 223 138.2 223 123.5C223 108.2 236.2 99.5 258.5 99.5H278V97.5C278 89.2 271.5 84.5 260 84.5C250.2 84.5 241.5 87.8 234.5 92.5L226.5 79C235.8 74.2 247.8 72 261 72ZM258 134.5C268.2 134.5 276.2 129.2 278 121.5V112H260.5C249.2 112 243.5 115.8 243.5 122.8C243.5 129.8 249.2 134.5 258 134.5Z"
      />
      <Path
        fill={color}
        d="M313 73.5H333V85.5C338.2 76.8 347.5 72 359 72V91.5C357.2 91.2 355.2 91 353 91C341.2 91 334 98.2 334 111.5V147H313V73.5Z"
      />
      <Circle cx="379.5" cy="51.5" r="12.5" fill={color} />
      <Rect x="369" y="73.5" width="21" height="73.5" fill={color} />
      <Path
        fill={color}
        d="M406 54H474V72.5H428V93.5H467.5V111.5H428V147H406V54Z"
      />
      <Path
        fill={color}
        d="M477 73.5H499L516.5 121.5L533.5 73.5H554.5L523.5 153.5C516.2 172.2 505.2 179.5 488.5 179.5C481.2 179.5 474.2 177.8 469.5 174.5L476 158.5C479.2 160.8 483.2 162 487.5 162C494.5 162 498.8 158.8 502.2 150.5L504.5 145L477 73.5Z"
      />
    </Svg>
  );
}

export interface ClarifyLogoMarkProps {
  /** Width and height in dp (square 160x160 viewBox). */
  size?: number;
  /** Optional circle background color; defaults to USTP Navy (#1a1851). */
  backgroundColor?: string;
  /** Optional emblem fill color; defaults to official ClariFy Orange (#ff9718). */
  color?: string;
}

/**
 * Official ClariFy circular emblem ported 1:1 from clarify-web/public/assets/clarify-mark.svg.
 */
export function ClarifyLogoMark({
  size = 68,
  backgroundColor = colors.ustpNavy,
  color = colors.ustpOrange,
}: ClarifyLogoMarkProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      accessibilityRole="image"
      accessibilityLabel="ClariFy Emblem"
    >
      <Circle cx="80" cy="80" r="76" fill={backgroundColor} />
      <Path
        fill={color}
        fillRule="evenodd"
        clipRule="evenodd"
        d="M136 44C123.8 26.2 103.3 14.5 80 14.5C42.7 14.5 12.5 44.7 12.5 82C12.5 119.3 42.7 149.5 80 149.5C103.3 149.5 123.8 137.8 136 120L109.2 103.5C102.1 112.1 91.6 117.2 79.8 117.2H45L57.1 104.3C49.2 97.6 44.2 87.6 44.2 76.4C44.2 56.3 60.3 40 80.2 40C92.3 40 102.9 45.9 109.5 55L136 44Z"
      />
      <Circle cx="64" cy="79" r="6.5" fill={color} />
      <Circle cx="80" cy="79" r="6.5" fill={color} />
      <Circle cx="96" cy="79" r="6.5" fill={color} />
    </Svg>
  );
}
