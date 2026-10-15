import Wave3Workbench from '@jarvis/components/toolkit/wave3/Wave3Workbench';
import { Trophy, Podcast, TrainFront, Warehouse, ShieldCheck, PawPrint, Hammer, ShieldAlert } from 'lucide-react';

const icons = { sports: Trophy, broadcast: Podcast, rail: TrainFront, warehouse: Warehouse, insurance: ShieldCheck, veterinary: PawPrint, metallurgy: Hammer, cyberops: ShieldAlert };

export default function Wave9Workbench({ spec, group }) {
  return <Wave3Workbench spec={spec} icon={icons[group]} />;
}