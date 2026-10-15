/**
 * Glue between a tool screen and the report builder.
 *
 * The builder in `src/persistence/report.ts` is pure Markdown generation; this
 * module is the one place that turns it into a local file. The download uses a
 * Blob created in the page: the report never leaves the browser, and no part of
 * this path touches the network.
 */
import { buildReportMarkdown, reportFilename, type ToolReportContent } from '../../persistence/report';
import type { Investigation } from '../../persistence/schema';
import { downloadText } from '../../persistence/store';
import { getTool } from '../tools';
import type { ToolInfo } from '../tools';

export const REPORT_MIME = 'text/markdown';

/** What a screen hands over when the export action is used. Built on demand. */
export type ToolReportSource = () => ToolReportContent;

export function investigationReportMarkdown(
  investigation: Investigation | null,
  tool: ToolInfo,
  options: { config?: unknown; content?: ToolReportContent; noResultsReason?: string } = {},
): string {
  return buildReportMarkdown({
    investigation,
    tool: { name: tool.name, description: tool.description, category: tool.category },
    config: options.config,
    content: options.content,
    noResultsReason: options.noResultsReason,
  });
}

/** Build the report and save it locally. Returns the file name used. */
export function downloadInvestigationReport(
  investigation: Investigation | null,
  tool: ToolInfo,
  options: { config?: unknown; content?: ToolReportContent; noResultsReason?: string } = {},
): string {
  const markdown = investigationReportMarkdown(investigation, tool, options);
  const filename = reportFilename(investigation?.name ?? tool.name);
  downloadText(filename, markdown, REPORT_MIME);
  return filename;
}

/**
 * Export a report for a saved investigation from outside its tool screen. The
 * results are not on screen there, so the report says so plainly rather than
 * reconstructing anything from the configuration.
 */
export function downloadSavedInvestigationReport(investigation: Investigation): string {
  return downloadInvestigationReport(investigation, getTool(investigation.toolId), {
    noResultsReason:
      'This report was exported from the saved-investigations list, where the results are not on screen: an investigation stores its configuration, not its computed results. Open it in the tool and export the report from there to include the results, their exactness labels and the engine explanations.',
  });
}
