import Wave7Workbench from '@jarvis/components/toolkit/wave7/Wave7Workbench';
import { audioTools } from '@jarvis/components/toolkit/wave7/audio';
export default function SpeakerImpedanceLoad(){return <Wave7Workbench spec={audioTools[8]} group="audio" />;}