# Data subject: 5 laboratories, 38 features

Laboratories in the `data` domain of the native catalogue (`src/shared/native/catalogue.ts`, domain `'data'`). Every file path is relative to the repository root. Line numbers are the line where each feature is implemented.

Shared catalogue entries and parameter sets: `src/shared/native/catalogue.ts` (apps at lines 630, 652, 669, 683, 697; parameter sets `STATISTICS` 249, `SIGNALS` 363, `FITTER` 383; `PARAMETERS` assembly 441). Page registration: `src/renderer/src/components/native/surfaces.tsx` (lines 273, 274, 287, 293, 294). Page slugs: `src/main/pages/builtins.ts` (lines 208, 242, 586, 744, 776).

Note on the Data Importer: the catalogue says it reads CSV, JSON and pasted text into a table. The page that is actually on screen only detects what kind of file it is. It does not produce a table. That gap is recorded in its section below.

---

## 1. Statistics Lab

- **Id:** `statistics-lab`
- **Catalogue entry:** `src/shared/native/catalogue.ts` line 630
- **Parameters:** `src/shared/native/catalogue.ts` lines 249-267 (`STATISTICS`)
- **Component:** `StatisticsLabPage` in `src/renderer/src/components/PageTools.tsx` line 449
- **Engine calls:** `statistics.summarise`, `statistics.test`, `statistics.correlate`, `statistics.histogram`, `statistics.outliers`

Features:

1. **Summary of your numbers.** Shows how many values there are, the average, the middle value, the spread (standard deviation), and the smallest and largest. Lines 524-540 (engine call at line 477).
2. **Distribution chart.** Draws a histogram of the numbers, and says which binning rule was used. Lines 494-503 (series), 542-550 (chart and note); engine call at line 485.
3. **Unusual-value flag.** Marks values that sit far outside the rest, using the interquartile range rule, and names their positions. Lines 552-559; engine call at line 486.
4. **One-sample test.** Asks whether the average differs from a value you choose, and gives the t value, the p value and what the test assumes. Lines 561-571; engine call at lines 480-481.
5. **Two-group comparison.** Compares a second set of numbers with the first and reports a two-sample test with its assumptions. Lines 573-583; engine call at line 482.
6. **Do the two groups move together.** Gives a correlation between the two sets, shown with a warning that correlation is not proof of cause. Lines 585-592; engine call at lines 483-484.
7. **Stated assumptions.** Lists what each calculation assumes, next to the result. Lines 569, 581, 594.
8. **Save these numbers.** Stores the numbers and comparison value as a saved page. Lines 596-606.

---

## 2. Data Explorer

- **Id:** `data-explorer`
- **Catalogue entry:** `src/shared/native/catalogue.ts` line 652 (no parameter set; inputs are typed on the page)
- **Component:** `DataExplorerPage` in `src/renderer/src/components/PageTools.tsx` line 633
- **Engine calls:** `data.parse`, `data.sort`, `data.profile`

Features:

1. **Paste a table and read it.** Takes pasted text and works out the separator and whether the first row holds headings. It says both were guesses. Lines 646-669 (engine call at line 656); note at lines 686-693.
2. **Column types with confidence.** Shows each column's detected type and unit, and marks a column as "unsure" when the detection is weak. Lines 724-733.
3. **Sort by any column.** Click a column heading to sort by it; click again to reverse the order; click "original order" to go back. Lines 697-718 (chips), 663-667 (sort call at line 665), 706-711 (toggle).
4. **Data warnings.** Lists problems the profile found in the data, such as mixed types. Lines 668, 675, 757.
5. **Table view.** Shows the rows, up to the first 200, with a note when there are more. Lines 720-753.
6. **Missing and unreadable cells.** Shows empty cells as "missing", unreadable cells as their original text, and empty values as a dash. Lines 620-631 (`cellText`), 741-744.
7. **Save this table.** Stores the pasted text as a saved page. Lines 759-769.

Not on the page, though the catalogue names it: group and join. No implementation was found for either in the page component, so they are left out here.

---

## 3. Data Importer

- **Id:** `data-importer`
- **Catalogue entry:** `src/shared/native/catalogue.ts` line 669
- **Component:** `DataImporterPage` in `src/renderer/src/components/PageLabs.tsx` line 499
- **Engine call:** `interchange.detect`

Features:

1. **Work out the file type.** Takes a file name and the first part of the file and says what kind of data it is, such as CSV. Lines 503-505 (engine call), 517-523 (result).
2. **Confidence of the guess.** Shows how sure the detection is. Line 521.
3. **Clash between name, type and content.** When the file name, the declared type and the file content disagree, it shows the conflict as a warning rather than picking one. Lines 527-531.
4. **Reasons for the answer.** Lists why the type was chosen. Line 532.
5. **Evidence note.** States that only the file content counts as evidence. Lines 535-539.

Gap: the catalogue entry promises to turn a file or pasted text into a table. The page has no such feature. It stops at naming the file type. Nothing in `DataImporterPage` produces a table.

---

## 4. Curve Fitter

- **Id:** `curve-fitter`
- **Catalogue entry:** `src/shared/native/catalogue.ts` line 683
- **Parameters:** `src/shared/native/catalogue.ts` lines 383-411 (`FITTER`)
- **Component:** `CurveFitterPage` in `src/renderer/src/components/ScienceLabs.tsx` line 217
- **Engine calls:** `fit.curve`, `fit.residuals`, `interpolate.build`

Features:

1. **Enter the measurements.** Two boxes, one for x values and one for y values, separated by commas. Lines 218-219, 258-261.
2. **Count check.** Warns when there are a different number of x and y values. Lines 263-267.
3. **Choose the shape.** Pick a straight line, polynomial, exponential, power law, logarithmic, reciprocal or logistic curve. Lines 199-207 (list), 270 (picker); engine call at lines 229-236.
4. **Polynomial degree.** Sets how many bends the polynomial may have. Shown only for polynomial. Line 271.
5. **Logistic ceiling.** Sets the level the logistic curve levels off at. Shown only for logistic. Lines 222, 272.
6. **Fit quality numbers.** Shows R², adjusted R², root mean squared error and the number of points, with the equation. Lines 277-288.
7. **Log-scale fit note.** Explains when a fit was done on the logarithm, and that the R² shown is on the original scale. Lines 289-295.
8. **Residual check.** Looks at the leftover errors for a pattern and lists any concerns or notes. Lines 237-244 (engine call), 300-315 (results).
9. **Curve through every point.** Draws a curve that passes through each measurement, with five methods: straight lines, monotone cubic, cubic spline, nearest value (a staircase), and one polynomial through all points. Lines 209-215 (methods), 317-333 (picker and result); engine call at line 247.
10. **Overshoot warning.** Reports how far the through-points curve goes above or below the measurements, and explains that this may or may not be wrong. Lines 252, 325-330.

---

## 5. Signal Lab

- **Id:** `signal-lab`
- **Catalogue entry:** `src/shared/native/catalogue.ts` line 697
- **Parameters:** `src/shared/native/catalogue.ts` lines 363-381 (`SIGNALS`)
- **Component:** `SignalLabPage` in `src/renderer/src/components/ScienceLabs.tsx` line 50
- **Engine calls:** `signal.peaks`, `signal.facts`, `signal.autocorrelation`

Features:

1. **Enter a signal.** A list of evenly spaced samples, plus the sampling rate in samples per second. Lines 51-54, 95, 98.
2. **Frequencies found.** Finds the tones in the signal and lists each with its frequency and amplitude. Lines 61-65 (engine call), 119-162 (table).
3. **Estimated between bins.** Marks a frequency that was worked out between two frequency bins rather than read off a bin. Lines 142-150.
4. **Window choice.** Picks which window is applied before the analysis: none, Hann, Hamming, Blackman, Blackman-Harris or flat top. Line 99 (picker); options defined in `SIGNALS` at `src/shared/native/catalogue.ts` lines 366-378.
5. **Remove the average first.** A tick box that takes the mean out of the signal before analysis. Lines 56, 100-103.
6. **Sampling limits.** Shows the record length, the highest frequency the sampling rate can show, and the spacing between frequency bins. Lines 85, 108-117.
7. **Basic facts about the series.** Shows the mean, the RMS variation, the peak-to-peak range and the crest factor. Lines 66-70 (engine call), 164-177 (display).
8. **What repeats.** Finds whether the signal repeats after a set number of samples, and converts that into seconds and hertz. Lines 71-75 (engine call), 179-192 (display).

---

## Totals

| Laboratory | Features |
|---|---|
| Statistics Lab | 8 |
| Data Explorer | 7 |
| Data Importer | 5 |
| Curve Fitter | 10 |
| Signal Lab | 8 |
| **Total** | **38** |
