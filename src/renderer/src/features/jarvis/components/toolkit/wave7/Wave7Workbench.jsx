import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { Anchor, Flame, UtensilsCrossed, Printer, AudioLines, Bot, Package, Pickaxe } from 'lucide-react';

const icons = { marine: Anchor, firesafety: Flame, food: UtensilsCrossed, print: Printer, audio: AudioLines, robotics: Bot, packaging: Package, mining: Pickaxe };

export default function Wave7Workbench({ spec, group }) {
  return <Wave3Workbench spec={spec} icon={icons[group]} />;
}