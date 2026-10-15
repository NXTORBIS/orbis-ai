import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { surveyingTools } from '@jarvis/components/toolkit/wave17/surveying';
export default function SurveyCurveSetting(){return <Wave17Workbench spec={surveyingTools.find((t)=>t.id==='survey-curve-setting')} group="surveying" />;}