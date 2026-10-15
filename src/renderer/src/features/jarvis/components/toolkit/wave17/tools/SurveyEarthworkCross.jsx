import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { surveyingTools } from '@jarvis/components/toolkit/wave17/surveying';
export default function SurveyEarthworkCross(){return <Wave17Workbench spec={surveyingTools.find((t)=>t.id==='survey-earthwork-cross')} group="surveying" />;}