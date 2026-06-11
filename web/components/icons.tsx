'use client';

// Single icon family (Lucide) for the whole designer. One place maps a node
// type to its glyph so the palette, layers panel, and inspector all agree.

import { Square, Circle, Hexagon, Image as ImageIcon, Type, Group, Component, type LucideIcon } from 'lucide-react';

const NODE_ICONS: Record<string, LucideIcon> = {
  Rectangle: Square,
  Ellipse: Circle,
  Polygon: Hexagon,
  Image: ImageIcon,
  Text: Type,
  Group,
  Instance: Component,
};

export function NodeIcon({
  type,
  size = 16,
  className,
}: {
  type: string;
  size?: number;
  className?: string;
}) {
  const Icon = NODE_ICONS[type] ?? Square;
  return <Icon size={size} strokeWidth={1.75} className={className} />;
}
