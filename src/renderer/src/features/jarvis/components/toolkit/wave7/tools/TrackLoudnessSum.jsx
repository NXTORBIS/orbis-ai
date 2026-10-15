import Wave7Workbench from '@jarvis/components/toolkit/wave7/Wave7Workbench';
import { audioTools } from '@jarvis/components/toolkit/wave7/audio';
export default function TrackLoudnessSum(){return <Wave7Workbench spec={audioTools[7]} group="audio" />;}