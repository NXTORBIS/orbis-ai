import Wave17Workbench from '@jarvis/components/toolkit/wave17/Wave17Workbench';
import { surveyingTools } from '@jarvis/components/toolkit/wave17/surveying';
export default function SurveyErrorBudget(){return <Wave17Workbench spec={surveyingTools.find((t)=>t.id==='survey-error-budget')} group="surveying" />;}