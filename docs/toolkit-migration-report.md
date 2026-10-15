# Jarvis Toolkit migration report

Tools in the Orbis Toolkit: **2081**

| Status | Tools | Meaning |
|---|---|---|
| ok | 2081 | Opened in the real Orbis window, rendered its interface, and logged no errors |
| console-errors | 0 | Rendered, but logged errors while doing so |
| empty | 0 | Opened but drew nothing |
| error | 0 | Crashed when opened (caught; the rest of Orbis is unaffected) |
| timeout | 0 | Did not finish loading within the check |

"ok" means it opens and renders. It does not by itself prove every number a tool computes is right; the calculations are the original ones, unmodified.

## Not ok


## Every tool

| # | Tool | Category | Source | Status |
|---|---|---|---|---|
| 1 | Screen Ruler | device | toolkit/ScreenRuler.jsx | ok |
| 2 | Color Picker | device | toolkit/ColorPicker.jsx | ok |
| 3 | Compass | device | toolkit/Compass.jsx | ok |
| 4 | Level Tool | device | (registry / shared workbench) | ok |
| 5 | GPS Coordinates | device | (registry / shared workbench) | ok |
| 6 | Speedometer | device | toolkit/Speedometer.jsx | ok |
| 7 | Altitude Meter | device | (registry / shared workbench) | ok |
| 8 | Sensor Monitor | device | (registry / shared workbench) | ok |
| 9 | QR & Barcode Scanner | device | toolkit/QrScanner.jsx | ok |
| 10 | Device & Browser Info | device | toolkit/DeviceInfo.jsx | ok |
| 11 | Screen & Touch Test | device | toolkit/ScreenTest.jsx | ok |
| 12 | Performance Benchmark | browser-audit | toolkit/audit/PerfBench.jsx | ok |
| 13 | Frame Rate & Jank Meter | browser-audit | toolkit/audit/FpsMeter.jsx | ok |
| 14 | Battery & Power Audit | browser-audit | (registry / shared workbench) | ok |
| 15 | Storage & Quota Audit | browser-audit | toolkit/audit/StorageAudit.jsx | ok |
| 16 | Browser Capability Audit | browser-audit | (registry / shared workbench) | ok |
| 17 | Fingerprint Exposure Audit | browser-audit | toolkit/audit/FingerprintAudit.jsx | ok |
| 18 | Page Weight & Resource Audit | browser-audit | toolkit/audit/PageWeight.jsx | ok |
| 19 | Speed Test | network | (registry / shared workbench) | ok |
| 20 | DNS Lookup | network | (registry / shared workbench) | ok |
| 21 | IP / Subnet Calculator | network | (registry / shared workbench) | ok |
| 22 | Port Checker | network | toolkit/PortChecker.jsx | ok |
| 23 | IP Range & Subnet Planner | network | toolkit/IpRangePlanner.jsx | ok |
| 24 | Connection Doctor | network | toolkit/network/ConnectionDoctor.jsx | ok |
| 25 | Multi-Timer | time | toolkit/MultiTimer.jsx | ok |
| 26 | World Clock | time | toolkit/WorldClock.jsx | ok |
| 27 | Interval Timer | time | toolkit/IntervalTimer.jsx | ok |
| 28 | Meeting Planner | time | toolkit/MeetingPlanner.jsx | ok |
| 29 | Chess Clock | time | toolkit/ChessClock.jsx | ok |
| 30 | Alarm Clock | time | (registry / shared workbench) | ok |
| 31 | Date Calculator | time | toolkit/DateAdd.jsx | ok |
| 32 | Month Calendar Maker | time | (registry / shared workbench) | ok |
| 33 | Weekly Time Budget | time | toolkit/TimeBudget.jsx | ok |
| 34 | Audio Recorder | media | toolkit/AudioRecorder.jsx | ok |
| 35 | Screen Recorder | media | toolkit/ScreenRecorder.jsx | ok |
| 36 | Webcam Recorder | media | toolkit/WebcamRecorder.jsx | ok |
| 37 | Video Downloader | media | toolkit/VideoDownloader.jsx | ok |
| 38 | Voice Dictation | media | toolkit/VoiceDictation.jsx | ok |
| 39 | Tone & Signal Generator | media | (registry / shared workbench) | ok |
| 40 | Metronome | media | toolkit/Metronome.jsx | ok |
| 41 | YouTube Link Studio | media | (registry / shared workbench) | ok |
| 42 | Sound Level Meter | media | toolkit/SoundMeter.jsx | ok |
| 43 | Instrument Tuner | media | (registry / shared workbench) | ok |
| 44 | Media File Inspector | media | toolkit/MediaInspector.jsx | ok |
| 45 | Audio Trimmer | media | (registry / shared workbench) | ok |
| 46 | Subtitle Studio | media | (registry / shared workbench) | ok |
| 47 | Depth of Field & Hyperfocal | media | toolkit/DepthOfField.jsx | ok |
| 48 | Delay Time & Tempo Calculator | media | (registry / shared workbench) | ok |
| 49 | Image Compressor | image | (registry / shared workbench) | ok |
| 50 | Image Resizer | image | (registry / shared workbench) | ok |
| 51 | Image Inspector | image | (registry / shared workbench) | ok |
| 52 | Color Contrast Checker | image | (registry / shared workbench) | ok |
| 53 | Image to Base64 | image | (registry / shared workbench) | ok |
| 54 | Image Filters | image | toolkit/ImageFilters.jsx | ok |
| 55 | Image Colour Extractor | image | (registry / shared workbench) | ok |
| 56 | Aspect Ratio & Fit Calculator | image | toolkit/AspectRatio.jsx | ok |
| 57 | PPI / DPI & Print Size | image | toolkit/PrintSize.jsx | ok |
| 58 | Pixel Art Editor | image | toolkit/PixelArt.jsx | ok |
| 59 | Image to ASCII Art | image | (registry / shared workbench) | ok |
| 60 | Image Watermark | image | toolkit/Watermark.jsx | ok |
| 61 | Meme & Caption Maker | image | (registry / shared workbench) | ok |
| 62 | Photo Collage | image | (registry / shared workbench) | ok |
| 63 | Colour Blindness Simulator | image | (registry / shared workbench) | ok |
| 64 | Image Format Converter | image | (registry / shared workbench) | ok |
| 65 | Image Cropper & Rotator | image | (registry / shared workbench) | ok |
| 66 | Image Diff & Compare | image | toolkit/ImageDiff.jsx | ok |
| 67 | Image Annotator | image | toolkit/ImageAnnotate.jsx | ok |
| 68 | Passport & ID Photo Maker | image | (registry / shared workbench) | ok |
| 69 | File Hash & Integrity Check | file | (registry / shared workbench) | ok |
| 70 | File Metadata | file | (registry / shared workbench) | ok |
| 71 | ZIP Creator | file | (registry / shared workbench) | ok |
| 72 | ZIP Extractor | file | (registry / shared workbench) | ok |
| 73 | PDF Studio | file | toolkit/PdfStudio.jsx | ok |
| 74 | Images → PDF | file | toolkit/ImagesToPdf.jsx | ok |
| 75 | Signature Pad | file | (registry / shared workbench) | ok |
| 76 | JSON Validator | dev | (registry / shared workbench) | ok |
| 77 | Base64 Encoder/Decoder | dev | (registry / shared workbench) | ok |
| 78 | JWT Decoder | dev | (registry / shared workbench) | ok |
| 79 | UUID Generator | dev | (registry / shared workbench) | ok |
| 80 | Hash Generator | dev | (registry / shared workbench) | ok |
| 81 | Regex Tester | dev | (registry / shared workbench) | ok |
| 82 | Text Diff | dev | (registry / shared workbench) | ok |
| 83 | Duplicate Line Remover | dev | (registry / shared workbench) | ok |
| 84 | XML → JSON Converter | dev | (registry / shared workbench) | ok |
| 85 | ASCII & Unicode Table | dev | toolkit/AsciiTable.jsx | ok |
| 86 | Docker & Compose Cheat Sheet | dev | toolkit/DockerCheatsheet.jsx | ok |
| 87 | Linux & Bash Cheat Sheet | dev | toolkit/BashCheatsheet.jsx | ok |
| 88 | OAuth PKCE Generator | dev | (registry / shared workbench) | ok |
| 89 | HTTP Headers & Auth Builder | dev | (registry / shared workbench) | ok |
| 90 | Data URI Helper | dev | (registry / shared workbench) | ok |
| 91 | .gitignore Generator | dev | (registry / shared workbench) | ok |
| 92 | License Generator | dev | (registry / shared workbench) | ok |
| 93 | TOTP Code Generator | dev | (registry / shared workbench) | ok |
| 94 | Campaign Link Builder | dev | (registry / shared workbench) | ok |
| 95 | JSON → Schema Generator | dev | (registry / shared workbench) | ok |
| 96 | Commit Message Builder | dev | (registry / shared workbench) | ok |
| 97 | API Request Tester | dev | toolkit/ApiTester.jsx | ok |
| 98 | API Key Tester & Validator | dev | toolkit/ApiKeyTester.jsx | ok |
| 99 | Regex Explainer | dev | (registry / shared workbench) | ok |
| 100 | JSON ⇄ CSV Converter | dev | (registry / shared workbench) | ok |
| 101 | Equation Solver | math | (registry / shared workbench) | ok |
| 102 | Matrix Calculator | math | (registry / shared workbench) | ok |
| 103 | Ohm's Law | math | (registry / shared workbench) | ok |
| 104 | Kinematics | math | toolkit/Kinematics.jsx | ok |
| 105 | Percentage Toolkit | math | (registry / shared workbench) | ok |
| 106 | Statistics Calculator | math | (registry / shared workbench) | ok |
| 107 | Prime Factorizer | math | (registry / shared workbench) | ok |
| 108 | GCD, LCM & Fractions | math | toolkit/GcdLcm.jsx | ok |
| 109 | Combinatorics Calculator | math | toolkit/Combinatorics.jsx | ok |
| 110 | Geometry Calculator | math | (registry / shared workbench) | ok |
| 111 | Significant Figures & Notation | math | (registry / shared workbench) | ok |
| 112 | Bitwise Calculator | math | (registry / shared workbench) | ok |
| 113 | Probability & Odds | math | (registry / shared workbench) | ok |
| 114 | Ratio & Proportion | math | (registry / shared workbench) | ok |
| 115 | IEEE 754 Float Inspector | math | toolkit/FloatBits.jsx | ok |
| 116 | Function Plotter | math | (registry / shared workbench) | ok |
| 117 | Complex Number Calculator | math | (registry / shared workbench) | ok |
| 118 | Regression & Trend Fit | math | (registry / shared workbench) | ok |
| 119 | Molar Mass & Solutions | math | toolkit/MolarMass.jsx | ok |
| 120 | Stoichiometry & Limiting Reagent | math | toolkit/Stoichiometry.jsx | ok |
| 121 | Resistor Colour Code | math | toolkit/ResistorCode.jsx | ok |
| 122 | pH, pKa & Buffer Calculator | math | toolkit/PhCalculator.jsx | ok |
| 123 | Vector Calculator | math | toolkit/VectorCalculator.jsx | ok |
| 124 | Electronics Calculator | math | toolkit/ElectronicsCalc.jsx | ok |
| 125 | Radioactive Decay Calculator | math | toolkit/RadioactiveDecay.jsx | ok |
| 126 | Projectile Motion Lab | math | toolkit/ProjectileMotion.jsx | ok |
| 127 | A/B Test Significance Calculator | math | (registry / shared workbench) | ok |
| 128 | Wave Calculator | math | toolkit/WaveCalculator.jsx | ok |
| 129 | Orbit & Satellite Calculator | math | toolkit/OrbitCalculator.jsx | ok |
| 130 | Survey Sample Size Calculator | math | toolkit/SurveySampleSize.jsx | ok |
| 131 | Doppler Shift Calculator | math | (registry / shared workbench) | ok |
| 132 | Beer-Lambert & Dilution Lab | math | toolkit/BeerLambert.jsx | ok |
| 133 | Waveform & Harmonic Builder | math | toolkit/FourierBuilder.jsx | ok |
| 134 | Battery Runtime & Sizing | math | toolkit/BatteryRuntime.jsx | ok |
| 135 | Telescope & Eyepiece Calculator | math | (registry / shared workbench) | ok |
| 136 | Gear Ratio Calculator | math | (registry / shared workbench) | ok |
| 137 | Beam Load & Deflection | math | (registry / shared workbench) | ok |
| 138 | Bolt Torque & Preload | math | (registry / shared workbench) | ok |
| 139 | Antenna & Feedline Calculator | math | (registry / shared workbench) | ok |
| 140 | Cable & Voltage Drop | math | toolkit/WireGauge.jsx | ok |
| 141 | Pipe Flow & Pressure Loss | math | toolkit/PipeFlow.jsx | ok |
| 142 | Pump Head & Power | math | toolkit/PumpSizing.jsx | ok |
| 143 | Motor Torque & Gearing | math | toolkit/MotorTorque.jsx | ok |
| 144 | Compression Spring Designer | math | toolkit/SpringDesign.jsx | ok |
| 145 | HVAC Duct Sizing | math | toolkit/DuctSizing.jsx | ok |
| 146 | Room Heat Load & AC Sizing | math | toolkit/HeatLoad.jsx | ok |
| 147 | Gas Laws Calculator | math | toolkit/GasLaws.jsx | ok |
| 148 | Optics, Lenses & Field of View | math | toolkit/OpticsLab.jsx | ok |
| 149 | Algorithm Visualizer | learn | (registry / shared workbench) | ok |
| 150 | CSV Analyzer | learn | (registry / shared workbench) | ok |
| 151 | Word Scrambler | learn | toolkit/WordScrambler.jsx | ok |
| 152 | Caesar Cipher | learn | toolkit/CaesarCipher.jsx | ok |
| 153 | Readability Score | learn | (registry / shared workbench) | ok |
| 154 | Morse & Spelling Alphabet | learn | (registry / shared workbench) | ok |
| 155 | Moon Phase Calculator | learn | toolkit/MoonPhase.jsx | ok |
| 156 | GPA & CGPA Calculator | learn | (registry / shared workbench) | ok |
| 157 | Study Timetable Builder | learn | toolkit/StudyPlan.jsx | ok |
| 158 | Speaking Time Calculator | learn | toolkit/SpeakingTime.jsx | ok |
| 159 | Spaced Revision Planner | learn | toolkit/SpacedRepetition.jsx | ok |
| 160 | Unit Circle Explorer | learn | toolkit/UnitCircle.jsx | ok |
| 161 | Scales, Keys & Chords | learn | toolkit/MusicTheory.jsx | ok |
| 162 | Grade Curve Calculator | learn | toolkit/GradeCurve.jsx | ok |
| 163 | Rubric Builder & Grader | learn | (registry / shared workbench) | ok |
| 164 | Symbol & Unicode Picker | text | toolkit/SymbolPicker.jsx | ok |
| 165 | Word Cloud Generator | text | toolkit/WordCloud.jsx | ok |
| 166 | ASCII Text Art | text | (registry / shared workbench) | ok |
| 167 | Data Extractor | text | (registry / shared workbench) | ok |
| 168 | Post Length Checker | text | toolkit/SocialLimits.jsx | ok |
| 169 | Text Wrapper | text | toolkit/TextWrap.jsx | ok |
| 170 | Delimited Text Splitter | text | (registry / shared workbench) | ok |
| 171 | Case Converter | text | toolkit/CaseConverter.jsx | ok |
| 172 | Word & Character Counter | text | toolkit/WordCounter.jsx | ok |
| 173 | Lorem Ipsum Generator | text | toolkit/LoremIpsum.jsx | ok |
| 174 | Text Reverser | text | toolkit/TextReverser.jsx | ok |
| 175 | Slug Generator | text | toolkit/SlugGenerator.jsx | ok |
| 176 | Line Sorter & Deduper | text | toolkit/LineSorter.jsx | ok |
| 177 | Find & Replace | text | toolkit/FindReplace.jsx | ok |
| 178 | Whitespace Cleaner | text | toolkit/WhitespaceCleaner.jsx | ok |
| 179 | Markdown Preview | text | toolkit/MarkdownPreview.jsx | ok |
| 180 | URL & HTML Encoder | text | toolkit/UrlEncoder.jsx | ok |
| 181 | Read Aloud | text | toolkit/ReadAloud.jsx | ok |
| 182 | Word Frequency & Keywords | text | toolkit/WordFrequency.jsx | ok |
| 183 | Fancy Text Generator | text | (registry / shared workbench) | ok |
| 184 | Character & Encoding Inspector | text | toolkit/TextInspector.jsx | ok |
| 185 | Text Box & Banner | text | toolkit/TextBox.jsx | ok |
| 186 | Writing Plan & Word Budget | text | toolkit/WritingPlan.jsx | ok |
| 187 | Resume & ATS Checker | text | (registry / shared workbench) | ok |
| 188 | Email Signature Builder | text | (registry / shared workbench) | ok |
| 189 | Template & Snippet Filler | text | toolkit/TextExpander.jsx | ok |
| 190 | Number to Words | convert | (registry / shared workbench) | ok |
| 191 | Roman Numerals | convert | (registry / shared workbench) | ok |
| 192 | Number Base Converter | convert | toolkit/BaseConverter.jsx | ok |
| 193 | Unix Timestamp Converter | convert | (registry / shared workbench) | ok |
| 194 | Time Zone Converter | convert | (registry / shared workbench) | ok |
| 195 | Color Converter | convert | toolkit/ColorConverter.jsx | ok |
| 196 | Data Size Converter | convert | (registry / shared workbench) | ok |
| 197 | Binary ⇄ Text Converter | convert | toolkit/BinaryText.jsx | ok |
| 198 | Unit Converter | convert | (registry / shared workbench) | ok |
| 199 | Duration Converter | convert | (registry / shared workbench) | ok |
| 200 | Number Formatter | convert | (registry / shared workbench) | ok |
| 201 | Currency Converter | convert | (registry / shared workbench) | ok |
| 202 | CSS Gradient Generator | design | (registry / shared workbench) | ok |
| 203 | Box Shadow Generator | design | (registry / shared workbench) | ok |
| 204 | Border Radius Generator | design | (registry / shared workbench) | ok |
| 205 | Colour Palette Generator | design | (registry / shared workbench) | ok |
| 206 | Emoji Picker | design | toolkit/EmojiPicker.jsx | ok |
| 207 | Fluid Size Generator | design | (registry / shared workbench) | ok |
| 208 | CSS Grid Builder | design | (registry / shared workbench) | ok |
| 209 | Meta Tag & Social Preview | design | (registry / shared workbench) | ok |
| 210 | Colour Scale Generator | design | (registry / shared workbench) | ok |
| 211 | CSS Easing Curve | design | toolkit/EasingCurve.jsx | ok |
| 212 | Image Placeholder Generator | design | toolkit/ImagePlaceholder.jsx | ok |
| 213 | CSS Clip-Path Generator | design | (registry / shared workbench) | ok |
| 214 | CSS Filter Studio | design | (registry / shared workbench) | ok |
| 215 | Glassmorphism Generator | design | (registry / shared workbench) | ok |
| 216 | Soft UI Generator | design | (registry / shared workbench) | ok |
| 217 | CSS Animation Generator | design | (registry / shared workbench) | ok |
| 218 | Neon Text Generator | design | (registry / shared workbench) | ok |
| 219 | Pattern Generator | design | (registry / shared workbench) | ok |
| 220 | Section Divider Generator | design | toolkit/WaveDivider.jsx | ok |
| 221 | Mesh Gradient Generator | design | toolkit/MeshGradient.jsx | ok |
| 222 | Blob Shape Generator | design | (registry / shared workbench) | ok |
| 223 | Loader & Spinner Studio | design | toolkit/LoaderStudio.jsx | ok |
| 224 | Noise & Grain Generator | design | (registry / shared workbench) | ok |
| 225 | CSS Button Studio | design | toolkit/ButtonStudio.jsx | ok |
| 226 | Scrollbar Styler | design | (registry / shared workbench) | ok |
| 227 | Photo Frame & Border | design | toolkit/PhotoFrame.jsx | ok |
| 228 | Font Pairing Studio | design | (registry / shared workbench) | ok |
| 229 | CSS Units & Clamp | design | toolkit/CssUnits.jsx | ok |
| 230 | Colour Name Finder | design | toolkit/ColorNames.jsx | ok |
| 231 | Chart Builder | design | toolkit/ChartBuilder.jsx | ok |
| 232 | Screenshot Device Frames | design | toolkit/DeviceFrame.jsx | ok |
| 233 | Social Share Card Maker | design | toolkit/SocialCard.jsx | ok |
| 234 | Flexbox Playground | design | toolkit/FlexboxStudio.jsx | ok |
| 235 | Design Token Exporter | design | (registry / shared workbench) | ok |
| 236 | Theme Contrast Auditor | design | (registry / shared workbench) | ok |
| 237 | Breakpoint & Layout Studio | design | (registry / shared workbench) | ok |
| 238 | CSS Specificity Calculator | design | (registry / shared workbench) | ok |
| 239 | Modular Type Scale Studio | design | toolkit/TypeScale.jsx | ok |
| 240 | Colour Blend Studio | design | (registry / shared workbench) | ok |
| 241 | Password Strength Analyzer | security | toolkit/PasswordStrength.jsx | ok |
| 242 | Password Generator | security | (registry / shared workbench) | ok |
| 243 | Text Encryptor | security | toolkit/TextEncryptor.jsx | ok |
| 244 | Classical Cipher Suite | security | toolkit/ClassicalCiphers.jsx | ok |
| 245 | HMAC Signature Generator | security | (registry / shared workbench) | ok |
| 246 | ID & Checksum Validator | security | (registry / shared workbench) | ok |
| 247 | Content Security Policy Builder | security | (registry / shared workbench) | ok |
| 248 | Log & Data Masker | security | toolkit/DataMasker.jsx | ok |
| 249 | Password Breach Check | security | (registry / shared workbench) | ok |
| 250 | Random Number Generator | generators | toolkit/RandomNumber.jsx | ok |
| 251 | Random Picker | generators | toolkit/RandomPicker.jsx | ok |
| 252 | Team Splitter | generators | toolkit/TeamSplitter.jsx | ok |
| 253 | Fake Data Generator | generators | toolkit/FakeData.jsx | ok |
| 254 | QR Code Generator | generators | (registry / shared workbench) | ok |
| 255 | Favicon Maker | generators | toolkit/FaviconMaker.jsx | ok |
| 256 | Passphrase Generator | generators | (registry / shared workbench) | ok |
| 257 | Barcode Generator | generators | (registry / shared workbench) | ok |
| 258 | Avatar Generator | generators | (registry / shared workbench) | ok |
| 259 | ID & Token Generator | generators | (registry / shared workbench) | ok |
| 260 | Tournament Bracket | generators | (registry / shared workbench) | ok |
| 261 | Acronym & Backronym Builder | generators | (registry / shared workbench) | ok |
| 262 | BMI Calculator | everyday | (registry / shared workbench) | ok |
| 263 | Age Calculator | everyday | (registry / shared workbench) | ok |
| 264 | Date Difference | everyday | (registry / shared workbench) | ok |
| 265 | Tip & Bill Splitter | everyday | toolkit/TipSplitter.jsx | ok |
| 266 | Loan EMI Calculator | everyday | (registry / shared workbench) | ok |
| 267 | Compound Interest | everyday | toolkit/CompoundInterest.jsx | ok |
| 268 | Profit & Margin Calculator | everyday | toolkit/ProfitMargin.jsx | ok |
| 269 | Sleep Cycle Calculator | everyday | toolkit/SleepCycle.jsx | ok |
| 270 | Countdown Timer | everyday | (registry / shared workbench) | ok |
| 271 | Stopwatch with Laps | everyday | (registry / shared workbench) | ok |
| 272 | Discount Calculator | everyday | (registry / shared workbench) | ok |
| 273 | VAT / GST Calculator | everyday | toolkit/VatGst.jsx | ok |
| 274 | Fuel Cost Calculator | everyday | toolkit/FuelCost.jsx | ok |
| 275 | Time Card & Hours Calculator | everyday | toolkit/TimeCard.jsx | ok |
| 276 | Salary & Rate Converter | everyday | toolkit/SalaryConverter.jsx | ok |
| 277 | Recipe Scaler | everyday | toolkit/RecipeScaler.jsx | ok |
| 278 | Calorie & Macro Calculator | everyday | (registry / shared workbench) | ok |
| 279 | Sun & Golden Hour | everyday | toolkit/SunTimes.jsx | ok |
| 280 | Invoice Builder | everyday | (registry / shared workbench) | ok |
| 281 | Pace, Speed & Splits | everyday | (registry / shared workbench) | ok |
| 282 | Body Fat & Lean Mass | everyday | toolkit/BodyFat.jsx | ok |
| 283 | Heart Rate Zones | everyday | (registry / shared workbench) | ok |
| 284 | Budget & Savings Planner | everyday | toolkit/SavingsGoal.jsx | ok |
| 285 | Break-even Calculator | everyday | toolkit/BreakEven.jsx | ok |
| 286 | Unit Price & Best Value | everyday | toolkit/UnitPrice.jsx | ok |
| 287 | Group Expense Splitter | everyday | (registry / shared workbench) | ok |
| 288 | Hydration Planner | everyday | toolkit/WaterIntake.jsx | ok |
| 289 | Pregnancy Due Date | everyday | toolkit/PregnancyDue.jsx | ok |
| 290 | One-Rep Max & Plates | everyday | toolkit/OneRepMax.jsx | ok |
| 291 | Match Scoreboard | everyday | (registry / shared workbench) | ok |
| 292 | Exam Score & Grade Planner | everyday | toolkit/ExamScore.jsx | ok |
| 293 | Citation Maker | everyday | (registry / shared workbench) | ok |
| 294 | Mortgage Overpayment Planner | everyday | toolkit/Overpay.jsx | ok |
| 295 | Debt Payoff Planner | everyday | toolkit/DebtPayoff.jsx | ok |
| 296 | Retirement Planner | everyday | toolkit/Retirement.jsx | ok |
| 297 | Appliance Energy Cost | everyday | toolkit/EnergyCost.jsx | ok |
| 298 | Paint & Wall Coverage | everyday | (registry / shared workbench) | ok |
| 299 | Kitchen Converter | everyday | (registry / shared workbench) | ok |
| 300 | Strength Plan Builder | everyday | toolkit/WorkoutPlan.jsx | ok |
| 301 | Sleep Debt Tracker | everyday | toolkit/SleepDebt.jsx | ok |
| 302 | Activity & Calories | everyday | (registry / shared workbench) | ok |
| 303 | Decision Matrix | everyday | toolkit/DecisionMatrix.jsx | ok |
| 304 | Meeting Cost Calculator | everyday | toolkit/MeetingCost.jsx | ok |
| 305 | Freelance Rate Calculator | everyday | toolkit/FreelanceRate.jsx | ok |
| 306 | Weekly Meal Planner | everyday | toolkit/MealPlanner.jsx | ok |
| 307 | Packing List Builder | everyday | toolkit/PackingList.jsx | ok |
| 308 | Grocery List & Budget | everyday | (registry / shared workbench) | ok |
| 309 | Chore Rota Builder | everyday | toolkit/ChoreRota.jsx | ok |
| 310 | Meeting Agenda Timer | everyday | toolkit/MeetingAgenda.jsx | ok |
| 311 | Subscription Audit | everyday | toolkit/SubscriptionAudit.jsx | ok |
| 312 | Income Tax Brackets | everyday | toolkit/TaxBrackets.jsx | ok |
| 313 | Investment Comparison | everyday | toolkit/InvestmentCompare.jsx | ok |
| 314 | Rent vs Buy | everyday | toolkit/RentVsBuy.jsx | ok |
| 315 | Project Timeline Planner | everyday | toolkit/TimelinePlanner.jsx | ok |
| 316 | Carbon Footprint | everyday | toolkit/CarbonFootprint.jsx | ok |
| 317 | Spreadsheet Formulas | everyday | toolkit/ExcelFormula.jsx | ok |
| 318 | Petrol vs Electric Running Cost | everyday | toolkit/EvRunningCost.jsx | ok |
| 319 | Solar Payback Planner | everyday | toolkit/SolarPayback.jsx | ok |
| 320 | Travel Budget Planner | everyday | toolkit/TravelBudget.jsx | ok |
| 321 | Recipe Cost Calculator | everyday | toolkit/RecipeCost.jsx | ok |
| 322 | Warranty & Guarantee Tracker | everyday | toolkit/WarrantyTracker.jsx | ok |
| 323 | Inflation Adjuster | everyday | toolkit/InflationAdjust.jsx | ok |
| 324 | Shift Pattern Planner | everyday | toolkit/ShiftPlanner.jsx | ok |
| 325 | Home Inventory & Contents | everyday | toolkit/HomeInventory.jsx | ok |
| 326 | Caffeine Tracker & Sleep Cutoff | everyday | toolkit/CaffeineTracker.jsx | ok |
| 327 | Blood Alcohol Estimator | everyday | (registry / shared workbench) | ok |
| 328 | Jet Lag Planner | everyday | toolkit/JetLagPlanner.jsx | ok |
| 329 | Party Food & Drink Planner | everyday | toolkit/PartyPlanner.jsx | ok |
| 330 | Flooring & Tiles Calculator | everyday | toolkit/FlooringCalculator.jsx | ok |
| 331 | Concrete & Slab Calculator | everyday | toolkit/ConcreteCalculator.jsx | ok |
| 332 | Blood Pressure Log & Categories | everyday | (registry / shared workbench) | ok |
| 333 | Screen Viewing Distance | everyday | toolkit/ViewingDistance.jsx | ok |
| 334 | Home Affordability Calculator | everyday | (registry / shared workbench) | ok |
| 335 | Vegetable Garden Planner | everyday | toolkit/GardenPlanner.jsx | ok |
| 336 | Weather Comfort Calculator | everyday | toolkit/WeatherComfort.jsx | ok |
| 337 | Fuel & Mileage Log | everyday | toolkit/FuelLog.jsx | ok |
| 338 | Emergency Fund Planner | everyday | toolkit/EmergencyFund.jsx | ok |
| 339 | Cost Per Use & Ownership | everyday | toolkit/CostPerUse.jsx | ok |
| 340 | Air Quality Index Calculator | everyday | (registry / shared workbench) | ok |
| 341 | Bread & Dough Calculator | everyday | toolkit/DoughCalculator.jsx | ok |
| 342 | Fence & Post Calculator | everyday | toolkit/FenceCalculator.jsx | ok |
| 343 | Gallery Wall Planner | everyday | (registry / shared workbench) | ok |
| 344 | Dollar-Cost Averaging Analyser | everyday | toolkit/DollarCostAverage.jsx | ok |
| 345 | Coffee Brew Calculator | everyday | (registry / shared workbench) | ok |
| 346 | Net Pay & Take-Home Calculator | everyday | (registry / shared workbench) | ok |
| 347 | Race Time Predictor & Training Paces | everyday | toolkit/RacePredictor.jsx | ok |
| 348 | Risk Matrix & Register | everyday | toolkit/RiskMatrix.jsx | ok |
| 349 | RACI Matrix Builder | everyday | (registry / shared workbench) | ok |
| 350 | Mortgage Refinance Planner | everyday | toolkit/MortgageRefinance.jsx | ok |
| 351 | VO2 Max & Training Zones | everyday | (registry / shared workbench) | ok |
| 352 | Roof Pitch & Rafter Calculator | everyday | (registry / shared workbench) | ok |
| 353 | Off-Grid Solar & Battery | everyday | toolkit/SolarSizing.jsx | ok |
| 354 | Rainwater Harvesting Planner | everyday | toolkit/RainwaterHarvest.jsx | ok |
| 355 | Option Strategy Payoff | everyday | toolkit/OptionPayoff.jsx | ok |
| 356 | Bond Yield & Duration | everyday | toolkit/BondYield.jsx | ok |
| 357 | CAGR, IRR & Growth | everyday | (registry / shared workbench) | ok |
| 358 | Leverage & Margin Call | everyday | (registry / shared workbench) | ok |
| 359 | LTV, CAC & Payback | everyday | toolkit/LtvCac.jsx | ok |
| 360 | Reorder Point & EOQ | everyday | toolkit/ReorderPoint.jsx | ok |
| 361 | Kidney Function (eGFR) | everyday | (registry / shared workbench) | ok |
| 362 | HbA1c & Average Glucose | everyday | toolkit/A1cConverter.jsx | ok |
| 363 | Position Sizing & Risk | everyday | toolkit/PositionSizing.jsx | ok |
| 364 | Meat Temperature & Doneness | everyday | (registry / shared workbench) | ok |
| 365 | Brine & Cure Calculator | everyday | (registry / shared workbench) | ok |
| 366 | Aquarium Volume & Setup | everyday | (registry / shared workbench) | ok |
| 367 | Carton Fit & Volumetric Weight | everyday | toolkit/BoxShipping.jsx | ok |
| 368 | Tyre Size & Speedometer Change | everyday | (registry / shared workbench) | ok |
| 369 | Cycling Power Zones & Climbing | everyday | toolkit/PowerZones.jsx | ok |
| 370 | IV Drip Rate & Dose | everyday | (registry / shared workbench) | ok |
| 371 | Cron Schedule Explainer | developer | (registry / shared workbench) | ok |
| 372 | CSV ⇄ JSON Converter | developer | (registry / shared workbench) | ok |
| 373 | SQL Formatter | developer | toolkit/SqlFormatter.jsx | ok |
| 374 | XML Formatter | developer | toolkit/XmlFormatter.jsx | ok |
| 375 | cURL → Code | developer | (registry / shared workbench) | ok |
| 376 | HTTP Status Codes | developer | (registry / shared workbench) | ok |
| 377 | Git Cheat Sheet | developer | toolkit/GitCheatsheet.jsx | ok |
| 378 | String Escaper | developer | toolkit/StringEscaper.jsx | ok |
| 379 | URL Parser & Query Editor | developer | toolkit/UrlParser.jsx | ok |
| 380 | JSON → TypeScript Types | developer | toolkit/JsonToTypes.jsx | ok |
| 381 | JSON Query Tester | developer | toolkit/JsonQuery.jsx | ok |
| 382 | .env ⇄ JSON Converter | developer | toolkit/EnvJson.jsx | ok |
| 383 | robots.txt & Sitemap | developer | toolkit/RobotsSitemap.jsx | ok |
| 384 | CSS Minifier | developer | toolkit/CssMinifier.jsx | ok |
| 385 | Regex Cheat Sheet | developer | toolkit/RegexCheatsheet.jsx | ok |
| 386 | Markdown Table Builder | developer | toolkit/MarkdownTable.jsx | ok |
| 387 | SVG → Data URI | developer | (registry / shared workbench) | ok |
| 388 | Semver Toolkit | developer | (registry / shared workbench) | ok |
| 389 | Glob Pattern Tester | developer | (registry / shared workbench) | ok |
| 390 | CSV → SQL Insert | developer | (registry / shared workbench) | ok |
| 391 | JSON Diff | developer | toolkit/JsonDiff.jsx | ok |
| 392 | JWT Builder & Verifier | developer | toolkit/JwtBuilder.jsx | ok |
| 393 | SVG → React Component | developer | (registry / shared workbench) | ok |
| 394 | Cron Schedule Builder | developer | (registry / shared workbench) | ok |
| 395 | YAML ⇄ JSON Converter | developer | toolkit/YamlJson.jsx | ok |
| 396 | JSON Schema Validator | developer | toolkit/SchemaCheck.jsx | ok |
| 397 | Accessibility Review Checklist | developer | toolkit/A11yChecklist.jsx | ok |
| 398 | Mock Data from a Schema | developer | toolkit/MockData.jsx | ok |
| 399 | HTML to Markdown | developer | toolkit/HtmlToMarkdown.jsx | ok |
| 400 | Regex Builder from Examples | developer | toolkit/RegexBuilder.jsx | ok |
| 401 | File Permission Calculator | developer | (registry / shared workbench) | ok |
| 402 | Nginx Site Config Builder | developer | (registry / shared workbench) | ok |
| 403 | Terminal Colour Palette | developer | toolkit/TerminalColors.jsx | ok |
| 404 | Changelog & Release Notes Builder | developer | (registry / shared workbench) | ok |
| 405 | Log Analyser | developer | toolkit/LogAnalyzer.jsx | ok |
| 406 | Table Joiner & Data Merger | developer | toolkit/TableJoiner.jsx | ok |
| 407 | Markdown → HTML | developer | (registry / shared workbench) | ok |
| 408 | Recurrence Rule Builder | developer | toolkit/RecurrenceBuilder.jsx | ok |
| 409 | Constraint Optimization Engine | engines | (registry / shared workbench) | ok |
| 410 | Geometric Mesh Boolean Engine | engines | (registry / shared workbench) | ok |
| 411 | DNA Sequence Assembly Engine | engines | (registry / shared workbench) | ok |
| 412 | Block Deduplication & Content Store | engines | toolkit/engines/BlockDedupe.jsx | ok |
| 413 | User-Space Filesystem Engine | engines | toolkit/engines/UserSpaceFs.jsx | ok |
| 414 | Columnar Query Execution Engine | engines | (registry / shared workbench) | ok |
| 415 | Persistent Merkle Index Engine | engines | toolkit/engines/MerkleIndex.jsx | ok |
| 416 | Binary Function Similarity Engine | engines | toolkit/engines/BinarySimilarity.jsx | ok |
| 417 | Binary Format Fuzzing Engine | engines | (registry / shared workbench) | ok |
| 418 | Geospatial Raster Warp Engine | engines | (registry / shared workbench) | ok |
| 419 | Audio Clock Drift Correction Engine | engines | (registry / shared workbench) | ok |
| 420 | DNA Replication Visualizer | biology | (registry / shared workbench) | ok |
| 421 | Cell Cycle Visualizer | biology | (registry / shared workbench) | ok |
| 422 | Nephron Filtration Visualizer | biology | (registry / shared workbench) | ok |
| 423 | Natural Selection Simulator | biology | (registry / shared workbench) | ok |
| 424 | Reaction Kinetics Simulator | chemistry | (registry / shared workbench) | ok |
| 425 | Chemical Equilibrium Solver | chemistry | (registry / shared workbench) | ok |
| 426 | NMR Spin System Simulator | chemistry | (registry / shared workbench) | ok |
| 427 | Microkinetic Mechanism Solver | process | (registry / shared workbench) | ok |
| 428 | Flash & Distillation Engine | process | (registry / shared workbench) | ok |
| 429 | Molecular Kinetics Network | process | (registry / shared workbench) | ok |
| 430 | QTAIM Molecular Topology | process | (registry / shared workbench) | ok |
| 431 | Brillouin Zone Explorer | process | (registry / shared workbench) | ok |
| 432 | Reaction–Diffusion Lab | process | (registry / shared workbench) | ok |
| 433 | Electric Motor Working Simulator | engineering | (registry / shared workbench) | ok |
| 434 | Four-Stroke Engine Simulator | engineering | (registry / shared workbench) | ok |
| 435 | Planetary Gearbox Simulator | engineering | (registry / shared workbench) | ok |
| 436 | Hydraulic Circuit Builder | engineering | (registry / shared workbench) | ok |
| 437 | Sluice Gate Working Simulator | engineering | (registry / shared workbench) | ok |
| 438 | Canal Lock Gate Simulator | engineering | (registry / shared workbench) | ok |
| 439 | Centrifugal Pump Cutaway Simulator | engineering | (registry / shared workbench) | ok |
| 440 | Four-Bar Linkage Simulator | engineering | (registry / shared workbench) | ok |
| 441 | PLC Ladder Logic Execution Visualizer | engineering | (registry / shared workbench) | ok |
| 442 | Transformer Working Simulator | engineering | (registry / shared workbench) | ok |
| 443 | Computed Tomography Reconstruction | structures | (registry / shared workbench) | ok |
| 444 | Tensor Network Contraction | structures | (registry / shared workbench) | ok |
| 445 | CNC Toolpath Material Removal | structures | (registry / shared workbench) | ok |
| 446 | Distributed Trace Critical Path | structures | (registry / shared workbench) | ok |
| 447 | Riemann Surface Explorer | structures | (registry / shared workbench) | ok |
| 448 | Fractal Basin Boundary Explorer | structures | (registry / shared workbench) | ok |
| 449 | Tensor Field Explorer | structures | (registry / shared workbench) | ok |
| 450 | State-Space Reachability Visualizer | structures | (registry / shared workbench) | ok |
| 451 | CPU Out-of-Order Execution Visualizer | structures | (registry / shared workbench) | ok |
| 452 | Distributed Event Causality Visualizer | structures | (registry / shared workbench) | ok |
| 453 | One-Dimensional Motion Laboratory | physics | toolkit/physics/mech/MotionLab.jsx | ok |
| 454 | Projectile Motion with Air Resistance | physics | (registry / shared workbench) | ok |
| 455 | Relative Motion & Reference Frames | physics | (registry / shared workbench) | ok |
| 456 | Inclined Plane & Friction Laboratory | physics | (registry / shared workbench) | ok |
| 457 | Mass–Spring Oscillator Laboratory | physics | toolkit/physics/osc/ShmLab.jsx | ok |
| 458 | Pendulum Laboratory | physics | toolkit/physics/osc/PendulumLab.jsx | ok |
| 459 | Driven Oscillator & Resonance | physics | (registry / shared workbench) | ok |
| 460 | Mechanical Waves & Sound Laboratory | physics | toolkit/physics/waves/WaveLab.jsx | ok |
| 461 | Doppler Effect Laboratory | physics | toolkit/physics/waves/DopplerLab.jsx | ok |
| 462 | Lens & Mirror Ray-Tracing Laboratory | physics | (registry / shared workbench) | ok |
| 463 | Refraction, Total Internal Reflection & Prisms | physics | (registry / shared workbench) | ok |
| 464 | Interference & Diffraction Laboratory | physics | (registry / shared workbench) | ok |
| 465 | Electric Field & Potential Laboratory | physics | (registry / shared workbench) | ok |
| 466 | DC Circuit Solver & Wheatstone Bridge | physics | (registry / shared workbench) | ok |
| 467 | Thermodynamic Process Laboratory | physics | (registry / shared workbench) | ok |
| 468 | Kinetic Theory of Gases Laboratory | physics | (registry / shared workbench) | ok |
| 469 | Thermal Radiation & Black-Body Laboratory | physics | (registry / shared workbench) | ok |
| 470 | Magnetic Field Laboratory | physics | (registry / shared workbench) | ok |
| 471 | Atomic Spectra Laboratory | physics | (registry / shared workbench) | ok |
| 472 | Quantum Wells & Tunnelling Laboratory | physics | (registry / shared workbench) | ok |
| 473 | Electromagnetic Induction & AC Laboratory | physics | (registry / shared workbench) | ok |
| 474 | Rotational Dynamics Laboratory | physics | (registry / shared workbench) | ok |
| 475 | Statistical Mechanics & Entropy Laboratory | physics | (registry / shared workbench) | ok |
| 476 | Special Relativity Laboratory | physics | (registry / shared workbench) | ok |
| 477 | Nuclear Decay & Binding Laboratory | physics | (registry / shared workbench) | ok |
| 478 | Semiconductor Devices Laboratory | physics | (registry / shared workbench) | ok |
| 479 | Fluid Dynamics Laboratory | physics | (registry / shared workbench) | ok |
| 480 | Acoustics & Resonance Laboratory | physics | (registry / shared workbench) | ok |
| 481 | Crystal Diffraction Laboratory | physics | (registry / shared workbench) | ok |
| 482 | Mohr Circle & Plane Stress | engineering-mechanics | (registry / shared workbench) | ok |
| 483 | Euler Column Buckling | engineering-mechanics | (registry / shared workbench) | ok |
| 484 | Shaft Torsion & Twist | engineering-mechanics | (registry / shared workbench) | ok |
| 485 | Thin-Wall Pressure Vessel | engineering-mechanics | (registry / shared workbench) | ok |
| 486 | Thick-Wall Cylinder — Lamé | engineering-mechanics | (registry / shared workbench) | ok |
| 487 | Hertz Sphere–Plane Contact | engineering-mechanics | (registry / shared workbench) | ok |
| 488 | Bearing L10 Life | engineering-mechanics | (registry / shared workbench) | ok |
| 489 | Goodman Fatigue Safety | engineering-mechanics | (registry / shared workbench) | ok |
| 490 | Fracture Stress Intensity | engineering-mechanics | (registry / shared workbench) | ok |
| 491 | Fillet Weld Throat Capacity | engineering-mechanics | (registry / shared workbench) | ok |
| 492 | Composite Wall Conduction | thermal-process-tools | (registry / shared workbench) | ok |
| 493 | Cylindrical Insulation & Critical Radius | thermal-process-tools | (registry / shared workbench) | ok |
| 494 | Heat Exchanger LMTD | thermal-process-tools | (registry / shared workbench) | ok |
| 495 | Heat Exchanger Effectiveness–NTU | thermal-process-tools | (registry / shared workbench) | ok |
| 496 | Rectangular Fin Heat Transfer | thermal-process-tools | (registry / shared workbench) | ok |
| 497 | Lumped Thermal Cooling | thermal-process-tools | (registry / shared workbench) | ok |
| 498 | Thermal Expansion & Restraint | thermal-process-tools | (registry / shared workbench) | ok |
| 499 | Psychrometric Humidity Ratio | thermal-process-tools | (registry / shared workbench) | ok |
| 500 | Isentropic Air Compressor Work | thermal-process-tools | (registry / shared workbench) | ok |
| 501 | Cooling Tower Approach & Range | thermal-process-tools | (registry / shared workbench) | ok |
| 502 | Series RLC Frequency Response | circuit-design-tools | (registry / shared workbench) | ok |
| 503 | Op-Amp Gain & Rail Clipping | circuit-design-tools | (registry / shared workbench) | ok |
| 504 | RF L-Network Impedance Match | circuit-design-tools | (registry / shared workbench) | ok |
| 505 | Transmission-Line VSWR & Input Impedance | circuit-design-tools | (registry / shared workbench) | ok |
| 506 | Conductor Skin Depth | circuit-design-tools | (registry / shared workbench) | ok |
| 507 | Johnson–Nyquist Thermal Noise | circuit-design-tools | (registry / shared workbench) | ok |
| 508 | ADC Quantisation & Ideal SNR | circuit-design-tools | (registry / shared workbench) | ok |
| 509 | R–2R DAC Output & Loading | circuit-design-tools | (registry / shared workbench) | ok |
| 510 | Buck Converter CCM Sizing | circuit-design-tools | (registry / shared workbench) | ok |
| 511 | Flyback DCM Magnetics | circuit-design-tools | (registry / shared workbench) | ok |
| 512 | Normal Shock Relations | flow-aero-tools | (registry / shared workbench) | ok |
| 513 | Oblique Shock — Weak Branch | flow-aero-tools | (registry / shared workbench) | ok |
| 514 | Nozzle Area–Mach Solver | flow-aero-tools | (registry / shared workbench) | ok |
| 515 | Compressible Gas Orifice Flow | flow-aero-tools | (registry / shared workbench) | ok |
| 516 | Manning Open-Channel Flow | flow-aero-tools | (registry / shared workbench) | ok |
| 517 | Hydraulic Jump & Energy Loss | flow-aero-tools | (registry / shared workbench) | ok |
| 518 | Water Hammer Surge | flow-aero-tools | (registry / shared workbench) | ok |
| 519 | Stokes Settling & Validity | flow-aero-tools | (registry / shared workbench) | ok |
| 520 | Ergun Packed-Bed Pressure Loss | flow-aero-tools | (registry / shared workbench) | ok |
| 521 | Capillary Rise & Contact Angle | flow-aero-tools | (registry / shared workbench) | ok |
| 522 | Nernst Electrode Potential | physical-chem-tools | (registry / shared workbench) | ok |
| 523 | Faraday Electroplating Yield | physical-chem-tools | (registry / shared workbench) | ok |
| 524 | Debye Electrolyte Screening Length | physical-chem-tools | (registry / shared workbench) | ok |
| 525 | Diffusion Length & Fick Flux | physical-chem-tools | (registry / shared workbench) | ok |
| 526 | Osmotic Pressure & Membrane Force | physical-chem-tools | (registry / shared workbench) | ok |
| 527 | Clausius–Clapeyron Vapour Pressure | physical-chem-tools | (registry / shared workbench) | ok |
| 528 | Langmuir Adsorption Isotherm | physical-chem-tools | (registry / shared workbench) | ok |
| 529 | BET Surface Area & Multilayer Adsorption | physical-chem-tools | (registry / shared workbench) | ok |
| 530 | Van der Waals Real-Gas Pressure | physical-chem-tools | (registry / shared workbench) | ok |
| 531 | Flory–Huggins Polymer Mixing | physical-chem-tools | (registry / shared workbench) | ok |
| 532 | Weibull Lifetime Explorer | wave2-reliability | toolkit/wave2/tools/WeibullLife.jsx | ok |
| 533 | Lognormal Lifetime Explorer | wave2-reliability | toolkit/wave2/tools/LognormalLife.jsx | ok |
| 534 | Series System Reliability | wave2-reliability | toolkit/wave2/tools/SeriesReliability.jsx | ok |
| 535 | Parallel Redundancy Designer | wave2-reliability | toolkit/wave2/tools/ParallelReliability.jsx | ok |
| 536 | k-of-n Voting Reliability | wave2-reliability | toolkit/wave2/tools/VotingReliability.jsx | ok |
| 537 | Zero-Failure Reliability Test Planner | wave2-reliability | toolkit/wave2/tools/ZeroFailurePlan.jsx | ok |
| 538 | Zero-Failure MTBF Demonstration | wave2-reliability | toolkit/wave2/tools/MtbfDemonstration.jsx | ok |
| 539 | Repairable System Availability | wave2-reliability | toolkit/wave2/tools/RepairAvailability.jsx | ok |
| 540 | Process Capability Cp & Cpk | wave2-reliability | toolkit/wave2/tools/ProcessCapability.jsx | ok |
| 541 | X̄ Statistical Control Limits | wave2-reliability | toolkit/wave2/tools/XbarControlLimits.jsx | ok |
| 542 | First-Order Step Response | wave2-controls | toolkit/wave2/tools/FirstOrderResponse.jsx | ok |
| 543 | Second-Order Step Response | wave2-controls | toolkit/wave2/tools/SecondOrderResponse.jsx | ok |
| 544 | PID Control Effort Workbench | wave2-controls | toolkit/wave2/tools/PidEffort.jsx | ok |
| 545 | Butterworth Filter Response | wave2-controls | toolkit/wave2/tools/ButterworthResponse.jsx | ok |
| 546 | Chebyshev-I Filter Response | wave2-controls | toolkit/wave2/tools/ChebyshevResponse.jsx | ok |
| 547 | Moving-Average FIR Analyzer | wave2-controls | toolkit/wave2/tools/MovingAverageFir.jsx | ok |
| 548 | Sampling & Aliasing Explorer | wave2-controls | toolkit/wave2/tools/SamplingAlias.jsx | ok |
| 549 | Cascaded Amplifier Noise Figure | wave2-controls | toolkit/wave2/tools/FriisNoiseCascade.jsx | ok |
| 550 | Charge-Pump PLL Loop Parameters | wave2-controls | toolkit/wave2/tools/ChargePumpPll.jsx | ok |
| 551 | Two-Point Sensor Calibration | wave2-controls | toolkit/wave2/tools/TwoPointCalibration.jsx | ok |
| 552 | First-Order CSTR Designer | wave2-bioprocess | toolkit/wave2/tools/CstrConversion.jsx | ok |
| 553 | First-Order Plug-Flow Reactor | wave2-bioprocess | toolkit/wave2/tools/PfrConversion.jsx | ok |
| 554 | CSTR Cascade Optimizer | wave2-bioprocess | toolkit/wave2/tools/CstrCascade.jsx | ok |
| 555 | Two-Temperature Activation Energy | wave2-bioprocess | toolkit/wave2/tools/ActivationEnergyFit.jsx | ok |
| 556 | Competitive Enzyme Inhibition | wave2-bioprocess | toolkit/wave2/tools/CompetitiveEnzyme.jsx | ok |
| 557 | Monod Microbial Growth | wave2-bioprocess | toolkit/wave2/tools/MonodGrowth.jsx | ok |
| 558 | Chemostat Washout Designer | wave2-bioprocess | toolkit/wave2/tools/ChemostatWashout.jsx | ok |
| 559 | Competitive Ligand Binding | wave2-bioprocess | toolkit/wave2/tools/CompetitiveBinding.jsx | ok |
| 560 | Bioreactor Oxygen Transfer | wave2-bioprocess | toolkit/wave2/tools/OxygenTransfer.jsx | ok |
| 561 | Constant-Volume Diafiltration | wave2-bioprocess | toolkit/wave2/tools/MembraneDiafiltration.jsx | ok |
| 562 | Vacuum Pump-Down Planner | wave2-process | toolkit/wave2/tools/VacuumPumpdown.jsx | ok |
| 563 | Molecular-Flow Vacuum Line | wave2-process | toolkit/wave2/tools/MolecularConductance.jsx | ok |
| 564 | Vacuum Rate-of-Rise Gas Load | wave2-process | toolkit/wave2/tools/VacuumRiseGasLoad.jsx | ok |
| 565 | Two-Stream Gas Mixing | wave2-process | toolkit/wave2/tools/GasMixtureFlow.jsx | ok |
| 566 | Rotameter Gas Correction | wave2-process | toolkit/wave2/tools/RotameterCorrection.jsx | ok |
| 567 | Porous Knudsen Diffusion | wave2-process | toolkit/wave2/tools/KnudsenDiffusion.jsx | ok |
| 568 | Darcy Porous-Medium Flow | wave2-process | toolkit/wave2/tools/DarcyPermeabilityFlow.jsx | ok |
| 569 | Isothermal Gas Line-Pack | wave2-process | toolkit/wave2/tools/GasLinepack.jsx | ok |
| 570 | Reverse Osmosis Driving Pressure | wave2-process | toolkit/wave2/tools/ReverseOsmosisDrive.jsx | ok |
| 571 | Mixed-Vessel Gas Purge Planner | wave2-process | toolkit/wave2/tools/GasPurgePlanner.jsx | ok |
| 572 | Rankine Retaining-Wall Pressure | wave2-geopower | toolkit/wave2/tools/RankineEarthPressure.jsx | ok |
| 573 | Strip Footing Bearing Capacity | wave2-geopower | toolkit/wave2/tools/StripFootingCapacity.jsx | ok |
| 574 | Infinite Slope Safety Factor | wave2-geopower | toolkit/wave2/tools/InfiniteSlopeSafety.jsx | ok |
| 575 | Clay Consolidation Settlement | wave2-geopower | toolkit/wave2/tools/ConsolidationSettlement.jsx | ok |
| 576 | Soil Compaction Phase Calculator | wave2-geopower | toolkit/wave2/tools/SoilPhaseRelationships.jsx | ok |
| 577 | Three-Phase Power Triangle | wave2-geopower | toolkit/wave2/tools/ThreePhasePower.jsx | ok |
| 578 | Power-Factor Correction Bank | wave2-geopower | toolkit/wave2/tools/PowerFactorCorrection.jsx | ok |
| 579 | Transformer Prospective Fault Current | wave2-geopower | toolkit/wave2/tools/TransformerFaultCurrent.jsx | ok |
| 580 | Symmetrical Phasor Components | wave2-geopower | toolkit/wave2/tools/SymmetricalComponents.jsx | ok |
| 581 | Battery Pack Topology & Loading | wave2-geopower | toolkit/wave2/tools/BatteryPackTopology.jsx | ok |
| 582 | Thin-Lens Imaging Studio | wave3-optics | (registry / shared workbench) | ok |
| 583 | Gaussian Beam Profile | wave3-optics | (registry / shared workbench) | ok |
| 584 | Diffraction Grating Designer | wave3-optics | toolkit/wave3/tools/DiffractionGrating.jsx | ok |
| 585 | Fibre Link Budget | wave3-optics | toolkit/wave3/tools/FiberLinkBudget.jsx | ok |
| 586 | Fresnel Reflection Explorer | wave3-optics | toolkit/wave3/tools/FresnelReflection.jsx | ok |
| 587 | Quarter-Wave AR Coating | wave3-optics | toolkit/wave3/tools/AntireflectionStack.jsx | ok |
| 588 | Radiometric to Photometric | wave3-optics | toolkit/wave3/tools/PhotometryLux.jsx | ok |
| 589 | Laser Threshold Calculator | wave3-optics | (registry / shared workbench) | ok |
| 590 | Photodetector Noise & NEP | wave3-optics | toolkit/wave3/tools/PhotodetectorNoise.jsx | ok |
| 591 | Coherence & Fringe Visibility | wave3-optics | (registry / shared workbench) | ok |
| 592 | Room Reverberation (Sabine) | wave3-acoustics | toolkit/wave3/tools/SabineReverb.jsx | ok |
| 593 | Partition Sound Insulation | wave3-acoustics | toolkit/wave3/tools/SoundTransmissionLoss.jsx | ok |
| 594 | Helmholtz Resonator | wave3-acoustics | toolkit/wave3/tools/HelmholtzResonator.jsx | ok |
| 595 | Ducted HVAC Attenuation | wave3-acoustics | toolkit/wave3/tools/DuctAttenuation.jsx | ok |
| 596 | Vibration Isolation Sizing | wave3-acoustics | (registry / shared workbench) | ok |
| 597 | Beam Natural Frequency | wave3-acoustics | (registry / shared workbench) | ok |
| 598 | Damping from a Decay Trace | wave3-acoustics | (registry / shared workbench) | ok |
| 599 | Octave-Band Level Summation | wave3-acoustics | (registry / shared workbench) | ok |
| 600 | Sonar Equation Solver | wave3-acoustics | (registry / shared workbench) | ok |
| 601 | Loudspeaker Enclosure Sizing | wave3-acoustics | toolkit/wave3/tools/LoudspeakerEnclosure.jsx | ok |
| 602 | Simply Supported Beam | wave3-structures | (registry / shared workbench) | ok |
| 603 | Cantilever with Tip Load | wave3-structures | toolkit/wave3/tools/CantileverTipLoad.jsx | ok |
| 604 | Circular Plate Under Pressure | wave3-structures | toolkit/wave3/tools/CircularPlateBending.jsx | ok |
| 605 | Torsion of a Rectangular Shaft | wave3-structures | (registry / shared workbench) | ok |
| 606 | Notch Stress Concentration | wave3-structures | (registry / shared workbench) | ok |
| 607 | Restrained Thermal Stress | wave3-structures | (registry / shared workbench) | ok |
| 608 | Creep Rupture Life (Larson–Miller) | wave3-structures | (registry / shared workbench) | ok |
| 609 | Fatigue Crack Growth (Paris) | wave3-structures | toolkit/wave3/tools/ParisCrackGrowth.jsx | ok |
| 610 | Composite Laminate Properties | wave3-structures | toolkit/wave3/tools/CompositeLaminate.jsx | ok |
| 611 | Eccentric Bolt Group (Elastic Method) | wave3-structures | (registry / shared workbench) | ok |
| 612 | Circular Orbit Calculator | wave3-orbital | (registry / shared workbench) | ok |
| 613 | Hohmann Transfer Planner | wave3-orbital | toolkit/wave3/tools/HohmannTransfer.jsx | ok |
| 614 | Elliptical Orbit Velocities | wave3-orbital | (registry / shared workbench) | ok |
| 615 | Rocket Equation & Staging | wave3-orbital | toolkit/wave3/tools/RocketEquation.jsx | ok |
| 616 | Escape Velocity & Surface Gravity | wave3-orbital | toolkit/wave3/tools/EscapeVelocity.jsx | ok |
| 617 | Synodic Period & Launch Windows | wave3-orbital | toolkit/wave3/tools/SynodicPeriod.jsx | ok |
| 618 | Insolation & Equilibrium Temperature | wave3-orbital | toolkit/wave3/tools/InsolationFlux.jsx | ok |
| 619 | Magnitude & Distance Modulus | wave3-orbital | toolkit/wave3/tools/MagnitudeDistance.jsx | ok |
| 620 | Telescope Resolution & Sampling | wave3-orbital | toolkit/wave3/tools/TelescopeResolution.jsx | ok |
| 621 | Hill Sphere & Satellite Stability | wave3-orbital | toolkit/wave3/tools/HillSphere.jsx | ok |
| 622 | Rational Method Runoff | wave3-hydro | toolkit/wave3/tools/RationalRunoff.jsx | ok |
| 623 | Solar PV Yield & Payback | wave3-hydro | toolkit/wave3/tools/SolarPvYield.jsx | ok |
| 624 | Wind Turbine Power Curve | wave3-hydro | toolkit/wave3/tools/WindTurbinePower.jsx | ok |
| 625 | River BOD/DO (Streeter–Phelps) | wave3-hydro | (registry / shared workbench) | ok |
| 626 | Horton Infiltration & Runoff | wave3-hydro | toolkit/wave3/tools/HortonInfiltration.jsx | ok |
| 627 | Apparent Temperature | wave3-hydro | (registry / shared workbench) | ok |
| 628 | Air Quality Index | wave3-hydro | toolkit/AirQualityIndex.jsx | ok |
| 629 | Soil Loss (USLE) | wave3-hydro | toolkit/wave3/tools/SoilErosionUsle.jsx | ok |
| 630 | Reference Evapotranspiration | wave3-hydro | (registry / shared workbench) | ok |
| 631 | Pumping Well Yield (Thiem) | wave3-hydro | (registry / shared workbench) | ok |
| 632 | Free-Space Radio Link Budget | wave4-radio | (registry / shared workbench) | ok |
| 633 | Radio Horizon & Mast Heights | wave4-radio | toolkit/wave4/tools/RadioHorizon.jsx | ok |
| 634 | Two-Ray Ground Reflection | wave4-radio | (registry / shared workbench) | ok |
| 635 | Shannon Channel Capacity | wave4-radio | (registry / shared workbench) | ok |
| 636 | Monostatic Radar Range | wave4-radio | (registry / shared workbench) | ok |
| 637 | Radar Doppler Velocity | wave4-radio | (registry / shared workbench) | ok |
| 638 | Eb/N₀ & Spectral Efficiency | wave4-radio | (registry / shared workbench) | ok |
| 639 | Parabolic Dish Gain | wave4-radio | (registry / shared workbench) | ok |
| 640 | Phased Array Beam Steering | wave4-radio | (registry / shared workbench) | ok |
| 641 | Phase Noise to RMS Jitter | wave4-radio | (registry / shared workbench) | ok |
| 642 | Milling Chip Load & Removal Rate | wave4-manufacturing | toolkit/wave4/tools/MillingChipLoad.jsx | ok |
| 643 | Turning Speed & Machining Time | wave4-manufacturing | (registry / shared workbench) | ok |
| 644 | Drilling Cycle Time | wave4-manufacturing | (registry / shared workbench) | ok |
| 645 | Taylor Cutting Tool Life | wave4-manufacturing | toolkit/wave4/tools/TaylorToolLife.jsx | ok |
| 646 | Turning Surface Finish | wave4-manufacturing | (registry / shared workbench) | ok |
| 647 | Sheet Metal Bend Allowance | wave4-manufacturing | (registry / shared workbench) | ok |
| 648 | Blanking Press Force | wave4-manufacturing | (registry / shared workbench) | ok |
| 649 | Assembly Tolerance Stack | wave4-manufacturing | (registry / shared workbench) | ok |
| 650 | Spur Gear Geometry | wave4-manufacturing | toolkit/wave4/tools/SpurGearGeometry.jsx | ok |
| 651 | Open Belt Drive Length | wave4-manufacturing | toolkit/wave4/tools/OpenBeltLength.jsx | ok |
| 652 | Wing Lift & Load Balance | wave4-aviation | (registry / shared workbench) | ok |
| 653 | Aircraft Drag Polar | wave4-aviation | (registry / shared workbench) | ok |
| 654 | Stall & Approach Speed Estimate | wave4-aviation | (registry / shared workbench) | ok |
| 655 | Coordinated Banked Turn | wave4-aviation | (registry / shared workbench) | ok |
| 656 | Best Glide from a Drag Polar | wave4-aviation | (registry / shared workbench) | ok |
| 657 | Excess Power & Climb Rate | wave4-aviation | (registry / shared workbench) | ok |
| 658 | Propeller Advance & Tip Speed | wave4-aviation | (registry / shared workbench) | ok |
| 659 | Wing Reynolds Number | wave4-aviation | (registry / shared workbench) | ok |
| 660 | ISA Troposphere Atmosphere | wave4-aviation | (registry / shared workbench) | ok |
| 661 | Wind Triangle & Ground Track | wave4-aviation | (registry / shared workbench) | ok |
| 662 | Single-Server Queue · M/M/1 | wave4-operations | (registry / shared workbench) | ok |
| 663 | Multi-Server Queue · Erlang C | wave4-operations | (registry / shared workbench) | ok |
| 664 | Erlang B Blocking Capacity | wave4-operations | (registry / shared workbench) | ok |
| 665 | Little’s Law Flow Balance | wave4-operations | (registry / shared workbench) | ok |
| 666 | Newsvendor Inventory Quantity | wave4-operations | toolkit/wave4/tools/NewsvendorStock.jsx | ok |
| 667 | PERT Task Duration Estimate | wave4-operations | (registry / shared workbench) | ok |
| 668 | Measurement Uncertainty Budget | wave4-operations | toolkit/wave4/tools/MeasurementUncertainty.jsx | ok |
| 669 | Poisson Event Probability | wave4-operations | (registry / shared workbench) | ok |
| 670 | Birthday & Identifier Collision | wave4-operations | toolkit/wave4/tools/BirthdayCollision.jsx | ok |
| 671 | Wilson Proportion Interval | wave4-operations | (registry / shared workbench) | ok |
| 672 | Liquid Orifice Flow Meter | wave4-water | (registry / shared workbench) | ok |
| 673 | V-Notch Weir Discharge | wave4-water | (registry / shared workbench) | ok |
| 674 | Hazen–Williams Water Pipe Loss | wave4-water | (registry / shared workbench) | ok |
| 675 | Ideal Settling Tank Removal | wave4-water | (registry / shared workbench) | ok |
| 676 | Sand Filter Loading & Backwash | wave4-water | (registry / shared workbench) | ok |
| 677 | Disinfection CT Contact Estimate | wave4-water | (registry / shared workbench) | ok |
| 678 | UV Exposure Dose Estimate | wave4-water | (registry / shared workbench) | ok |
| 679 | Langelier Saturation Index | wave4-water | (registry / shared workbench) | ok |
| 680 | Activated Carbon Bed Contact | wave4-water | (registry / shared workbench) | ok |
| 681 | Disinfectant Solution Feed Rate | wave4-water | (registry / shared workbench) | ok |
| 682 | Refrigeration Enthalpy Cycle | wave5-climate | (registry / shared workbench) | ok |
| 683 | Product Pull-Down Cooling | wave5-climate | (registry / shared workbench) | ok |
| 684 | Compressor Volumetric Capacity | wave5-climate | (registry / shared workbench) | ok |
| 685 | Chilled Water Coil Duty | wave5-climate | (registry / shared workbench) | ok |
| 686 | Humid Air Stream Mixing | wave5-climate | (registry / shared workbench) | ok |
| 687 | Sensible Heat Ratio | wave5-climate | (registry / shared workbench) | ok |
| 688 | Ventilation Heat Recovery | wave5-climate | (registry / shared workbench) | ok |
| 689 | Duct Leakage Pressure Law | wave5-climate | (registry / shared workbench) | ok |
| 690 | Refrigerant Line Velocity | wave5-climate | (registry / shared workbench) | ok |
| 691 | Degree-Day Building Energy | wave5-climate | (registry / shared workbench) | ok |
| 692 | Vehicle Stopping Distance | wave5-vehicle | (registry / shared workbench) | ok |
| 693 | Cornering Grip Speed | wave5-vehicle | (registry / shared workbench) | ok |
| 694 | Vehicle Road-Load Power | wave5-vehicle | (registry / shared workbench) | ok |
| 695 | Driveline RPM & Road Speed | wave5-vehicle | (registry / shared workbench) | ok |
| 696 | Aerodynamic Downforce | wave5-vehicle | (registry / shared workbench) | ok |
| 697 | Longitudinal Axle Load Transfer | wave5-vehicle | (registry / shared workbench) | ok |
| 698 | Tire Contact Patch Estimate | wave5-vehicle | (registry / shared workbench) | ok |
| 699 | Brake Rotor Temperature Rise | wave5-vehicle | (registry / shared workbench) | ok |
| 700 | EV Charging Window | wave5-vehicle | (registry / shared workbench) | ok |
| 701 | Regenerative Braking Capture | wave5-vehicle | (registry / shared workbench) | ok |
| 702 | Earthwork Average End Area | wave5-civil | (registry / shared workbench) | ok |
| 703 | Trapezoidal Ditch Excavation | wave5-civil | (registry / shared workbench) | ok |
| 704 | Conical Stockpile Inventory | wave5-civil | (registry / shared workbench) | ok |
| 705 | Road Superelevation Balance | wave5-civil | (registry / shared workbench) | ok |
| 706 | Crest Curve Sight Distance | wave5-civil | (registry / shared workbench) | ok |
| 707 | Horizontal Circular Curve | wave5-civil | (registry / shared workbench) | ok |
| 708 | Pile Group Axial Load | wave5-civil | (registry / shared workbench) | ok |
| 709 | Reinforcement Area & Spacing | wave5-civil | (registry / shared workbench) | ok |
| 710 | Concrete Temperature-Time Maturity | wave5-civil | (registry / shared workbench) | ok |
| 711 | Aggregate Moisture Batch Correction | wave5-civil | (registry / shared workbench) | ok |
| 712 | Synchronous Setup Timing Budget | wave5-digital | (registry / shared workbench) | ok |
| 713 | Metastability MTBF Sensitivity | wave5-digital | (registry / shared workbench) | ok |
| 714 | CMOS Switching Power | wave5-digital | (registry / shared workbench) | ok |
| 715 | Crystal Load Capacitors | wave5-digital | (registry / shared workbench) | ok |
| 716 | Hamming SECDED Word Sizing | wave5-digital | (registry / shared workbench) | ok |
| 717 | Integer Clock Divider | wave5-digital | (registry / shared workbench) | ok |
| 718 | PWM Resistive Load RMS | wave5-digital | (registry / shared workbench) | ok |
| 719 | PCB Differential Pair Skew | wave5-digital | (registry / shared workbench) | ok |
| 720 | Open-Drain Pull-Up Rise Time | wave5-digital | (registry / shared workbench) | ok |
| 721 | ADC Aperture Jitter SNR | wave5-digital | (registry / shared workbench) | ok |
| 722 | Exoplanet Transit Depth | wave5-astro | (registry / shared workbench) | ok |
| 723 | Exoplanet Radial Velocity | wave5-astro | (registry / shared workbench) | ok |
| 724 | Visual Binary Total Mass | wave5-astro | (registry / shared workbench) | ok |
| 725 | Einstein Angular Ring | wave5-astro | (registry / shared workbench) | ok |
| 726 | Low-Redshift Hubble Distance | wave5-astro | (registry / shared workbench) | ok |
| 727 | Gravitational Surface Redshift | wave5-astro | (registry / shared workbench) | ok |
| 728 | Schwarzschild Horizon Scale | wave5-astro | (registry / shared workbench) | ok |
| 729 | Jeans Cloud Instability | wave5-astro | (registry / shared workbench) | ok |
| 730 | Synchrotron Critical Frequency | wave5-astro | (registry / shared workbench) | ok |
| 731 | Astronomy Exposure SNR | wave5-astro | (registry / shared workbench) | ok |
| 732 | Debye–Hückel Ion Activity | wave5-analytical | (registry / shared workbench) | ok |
| 733 | Van’t Hoff Equilibrium Shift | wave5-analytical | (registry / shared workbench) | ok |
| 734 | Staged Liquid Extraction | wave5-analytical | (registry / shared workbench) | ok |
| 735 | Chromatography Peak Resolution | wave5-analytical | (registry / shared workbench) | ok |
| 736 | Chromatography Plate Efficiency | wave5-analytical | (registry / shared workbench) | ok |
| 737 | Mobile Phase Solvent Blend | wave5-analytical | (registry / shared workbench) | ok |
| 738 | Single-Spike Standard Addition | wave5-analytical | (registry / shared workbench) | ok |
| 739 | Internal Standard Quantitation | wave5-analytical | (registry / shared workbench) | ok |
| 740 | Gravimetric Analyte Factor | wave5-analytical | (registry / shared workbench) | ok |
| 741 | Isotope Zero-Point Effect | wave5-analytical | (registry / shared workbench) | ok |
| 742 | Wet-Basis Drying Balance | wave5-materials | (registry / shared workbench) | ok |
| 743 | GAB Moisture Sorption | wave5-materials | (registry / shared workbench) | ok |
| 744 | Yarn Linear Mass & Length | wave5-materials | (registry / shared workbench) | ok |
| 745 | Woven Fabric Areal Mass | wave5-materials | (registry / shared workbench) | ok |
| 746 | Rubber Network Modulus | wave5-materials | (registry / shared workbench) | ok |
| 747 | Polymer Chain Degree | wave5-materials | (registry / shared workbench) | ok |
| 748 | Suspension Viscosity | wave5-materials | (registry / shared workbench) | ok |
| 749 | Young–Dupré Adhesion Work | wave5-materials | (registry / shared workbench) | ok |
| 750 | Washburn Pore Infiltration | wave5-materials | (registry / shared workbench) | ok |
| 751 | Powder Carr & Hausner Indices | wave5-materials | (registry / shared workbench) | ok |
| 752 | Cumulative Learning Curve | wave5-business | (registry / shared workbench) | ok |
| 753 | Economic Production Quantity | wave5-business | (registry / shared workbench) | ok |
| 754 | Startup Cash Runway | wave5-business | (registry / shared workbench) | ok |
| 755 | Priced Round Equity Dilution | wave5-business | (registry / shared workbench) | ok |
| 756 | Post-Money SAFE Ownership | wave5-business | (registry / shared workbench) | ok |
| 757 | SaaS Rule of 40 | wave5-business | (registry / shared workbench) | ok |
| 758 | Net Revenue Retention | wave5-business | (registry / shared workbench) | ok |
| 759 | Sales Funnel & Monthly Bookings | wave5-business | (registry / shared workbench) | ok |
| 760 | Returns-Adjusted Contribution | wave5-business | (registry / shared workbench) | ok |
| 761 | Invoice Early Payment Discount | wave5-business | (registry / shared workbench) | ok |
| 762 | Great-Circle Route Distance | wave6-navigation | (registry / shared workbench) | ok |
| 763 | Great-Circle Initial Bearing | wave6-navigation | (registry / shared workbench) | ok |
| 764 | Great-Circle Destination Point | wave6-navigation | (registry / shared workbench) | ok |
| 765 | Route Cross-Track Error | wave6-navigation | (registry / shared workbench) | ok |
| 766 | Great-Circle Route Midpoint | wave6-navigation | (registry / shared workbench) | ok |
| 767 | Slippy Map Tile Address | wave6-navigation | (registry / shared workbench) | ok |
| 768 | WGS84 Earth-Centred Coordinates | wave6-navigation | (registry / shared workbench) | ok |
| 769 | ECEF to Local ENU Vector | wave6-navigation | (registry / shared workbench) | ok |
| 770 | Coordinate Rounding Resolution | wave6-navigation | (registry / shared workbench) | ok |
| 771 | Earth Tangent Curvature Drop | wave6-navigation | (registry / shared workbench) | ok |
| 772 | 4–20 mA Loop Scaling | wave6-instrument | (registry / shared workbench) | ok |
| 773 | Platinum RTD Resistance | wave6-instrument | (registry / shared workbench) | ok |
| 774 | Beta Thermistor Resistance | wave6-instrument | (registry / shared workbench) | ok |
| 775 | Quarter-Bridge Strain Signal | wave6-instrument | (registry / shared workbench) | ok |
| 776 | Differential-Pressure Flow Scaling | wave6-instrument | (registry / shared workbench) | ok |
| 777 | Pulse Tachometer RPM | wave6-instrument | (registry / shared workbench) | ok |
| 778 | Load Cell Millivolt Signal | wave6-instrument | (registry / shared workbench) | ok |
| 779 | Quadrature Encoder Count Rate | wave6-instrument | (registry / shared workbench) | ok |
| 780 | Static Accelerometer Orientation | wave6-instrument | (registry / shared workbench) | ok |
| 781 | LVDT Linear Displacement | wave6-instrument | (registry / shared workbench) | ok |
| 782 | Bloom Filter Capacity | wave6-systems | toolkit/wave6/tools/BloomFilterCapacity.jsx | ok |
| 783 | Count-Min Sketch Sizing | wave6-systems | (registry / shared workbench) | ok |
| 784 | HyperLogLog Register Budget | wave6-systems | (registry / shared workbench) | ok |
| 785 | RAID Array Usable Capacity | wave6-systems | (registry / shared workbench) | ok |
| 786 | Storage Rebuild Duration | wave6-systems | (registry / shared workbench) | ok |
| 787 | NAND Write Endurance | wave6-systems | (registry / shared workbench) | ok |
| 788 | TCP Window Throughput Limit | wave6-systems | (registry / shared workbench) | ok |
| 789 | Backlog Drain Time | wave6-systems | (registry / shared workbench) | ok |
| 790 | Replication Quorum Overlap | wave6-systems | (registry / shared workbench) | ok |
| 791 | Packet Serialization Budget | wave6-systems | (registry / shared workbench) | ok |
| 792 | Harmonic Current THD | wave6-power | (registry / shared workbench) | ok |
| 793 | Triplen Neutral Current | wave6-power | (registry / shared workbench) | ok |
| 794 | Star–Delta Starting Current | wave6-power | (registry / shared workbench) | ok |
| 795 | Induction Rotor Slip Loss | wave6-power | (registry / shared workbench) | ok |
| 796 | Parallel Generator Droop Sharing | wave6-power | (registry / shared workbench) | ok |
| 797 | Lead-Acid Peukert Runtime | wave6-power | (registry / shared workbench) | ok |
| 798 | DC Bus Capacitor Hold-Up | wave6-power | (registry / shared workbench) | ok |
| 799 | Rectifier Capacitor Ripple | wave6-power | (registry / shared workbench) | ok |
| 800 | Transformer Harmonic K-Factor | wave6-power | (registry / shared workbench) | ok |
| 801 | Facility Demand & Diversity | wave6-power | (registry / shared workbench) | ok |
| 802 | Crop Irrigation Net & Gross | wave6-agriculture | (registry / shared workbench) | ok |
| 803 | Root-Zone Refill Storage | wave6-agriculture | (registry / shared workbench) | ok |
| 804 | Drip Field Emitter Layout | wave6-agriculture | (registry / shared workbench) | ok |
| 805 | Sprinkler Application Runtime | wave6-agriculture | (registry / shared workbench) | ok |
| 806 | Irrigation Salinity Leaching | wave6-agriculture | (registry / shared workbench) | ok |
| 807 | Grain Aeration Airflow | wave6-agriculture | (registry / shared workbench) | ok |
| 808 | Fertilizer Nutrient Budget | wave6-agriculture | (registry / shared workbench) | ok |
| 809 | Field Water Tank Coverage | wave6-agriculture | (registry / shared workbench) | ok |
| 810 | Conductivity Temperature Correction | wave6-agriculture | (registry / shared workbench) | ok |
| 811 | Aquaculture Biomass Feed Budget | wave6-agriculture | (registry / shared workbench) | ok |
| 812 | Deep-Water Wave Energy Flux | wave6-renewables | (registry / shared workbench) | ok |
| 813 | Tidal Basin Potential Energy | wave6-renewables | (registry / shared workbench) | ok |
| 814 | Seasonal Hydro Energy Yield | wave6-renewables | (registry / shared workbench) | ok |
| 815 | Seebeck Matched-Load Power | wave6-renewables | (registry / shared workbench) | ok |
| 816 | Piezo Discharge Energy Harvest | wave6-renewables | (registry / shared workbench) | ok |
| 817 | Flat-Plate Solar Thermal Collector | wave6-renewables | (registry / shared workbench) | ok |
| 818 | Phase-Change Heat Storage | wave6-renewables | (registry / shared workbench) | ok |
| 819 | Geothermal Line-Source Response | wave6-renewables | (registry / shared workbench) | ok |
| 820 | Biogas Combined Heat & Power | wave6-renewables | (registry / shared workbench) | ok |
| 821 | Wet Biomass Fuel Heat | wave6-renewables | (registry / shared workbench) | ok |
| 822 | Bayesian Binary Test Posterior | wave6-probability | (registry / shared workbench) | ok |
| 823 | Beta–Bernoulli Posterior | wave6-probability | (registry / shared workbench) | ok |
| 824 | Dirichlet Three-Class Posterior | wave6-probability | (registry / shared workbench) | ok |
| 825 | Negative Binomial Failure Count | wave6-probability | (registry / shared workbench) | ok |
| 826 | Finite-Population Hypergeometric | wave6-probability | (registry / shared workbench) | ok |
| 827 | Geometric First-Success Horizon | wave6-probability | (registry / shared workbench) | ok |
| 828 | Gumbel Extreme Return Level | wave6-probability | (registry / shared workbench) | ok |
| 829 | Logistic Odds Ratio Shift | wave6-probability | (registry / shared workbench) | ok |
| 830 | Shannon Source Entropy | wave6-probability | (registry / shared workbench) | ok |
| 831 | Two-State Markov Equilibrium | wave6-probability | (registry / shared workbench) | ok |
| 832 | Camera Exposure Value | wave6-imaging | (registry / shared workbench) | ok |
| 833 | Neutral-Density Exposure Time | wave6-imaging | (registry / shared workbench) | ok |
| 834 | Flash Guide Number Range | wave6-imaging | (registry / shared workbench) | ok |
| 835 | Anamorphic Angle of View | wave6-imaging | (registry / shared workbench) | ok |
| 836 | Macro Bellows Exposure Factor | wave6-imaging | (registry / shared workbench) | ok |
| 837 | Macro Focus-Stack Spacing | wave6-imaging | (registry / shared workbench) | ok |
| 838 | Unguided Star-Trail Exposure | wave6-imaging | (registry / shared workbench) | ok |
| 839 | Cinema Shutter Angle & Time | wave6-imaging | (registry / shared workbench) | ok |
| 840 | Video Recording Storage Budget | wave6-imaging | (registry / shared workbench) | ok |
| 841 | Timelapse Capture Schedule | wave6-imaging | (registry / shared workbench) | ok |
| 842 | Hull Speed from Froude Number | wave7-marine | toolkit/wave7/tools/HullSpeedFroude.jsx | ok |
| 843 | Propeller Slip Percentage | wave7-marine | toolkit/wave7/tools/PropellerSlip.jsx | ok |
| 844 | Displacement & Buoyancy Check | wave7-marine | toolkit/wave7/tools/DisplacementBuoyancy.jsx | ok |
| 845 | Reserve Buoyancy & Freeboard | wave7-marine | toolkit/wave7/tools/LoadLineFreeboard.jsx | ok |
| 846 | Anchor Holding Capacity | wave7-marine | toolkit/wave7/tools/AnchorHoldingCapacity.jsx | ok |
| 847 | Mooring Line Catenary Tension | wave7-marine | toolkit/wave7/tools/MooringCatenaryTension.jsx | ok |
| 848 | Beaufort Sea State Estimate | wave7-marine | toolkit/wave7/tools/BeaufortSeaState.jsx | ok |
| 849 | Stabiliser Fin Force & Roll Moment | wave7-marine | toolkit/wave7/tools/StabiliserFinForce.jsx | ok |
| 850 | Marine Fouling Resistance Penalty | wave7-marine | toolkit/wave7/tools/MarineFoulingPenalty.jsx | ok |
| 851 | Marine Corrosion Rate | wave7-marine | toolkit/wave7/tools/MarineCorrosionRate.jsx | ok |
| 852 | Sprinkler Design Water Demand | wave7-firesafety | toolkit/wave7/tools/SprinklerWaterDemand.jsx | ok |
| 853 | Sprinkler Head Discharge | wave7-firesafety | toolkit/wave7/tools/SprinklerHeadDischarge.jsx | ok |
| 854 | Standpipe Residual Pressure | wave7-firesafety | toolkit/wave7/tools/StandpipeResidualPressure.jsx | ok |
| 855 | Evacuation Travel & Flow Time | wave7-firesafety | toolkit/wave7/tools/EvacuationTravelTime.jsx | ok |
| 856 | Exit Width from Occupant Load | wave7-firesafety | toolkit/wave7/tools/ExitWidthCapacity.jsx | ok |
| 857 | Smoke Detector Spacing & Count | wave7-firesafety | toolkit/wave7/tools/SmokeDetectorSpacing.jsx | ok |
| 858 | Fire Load Density | wave7-firesafety | toolkit/wave7/tools/FireLoadDensity.jsx | ok |
| 859 | Foam Concentrate Demand | wave7-firesafety | toolkit/wave7/tools/FoamConcentrateDemand.jsx | ok |
| 860 | Fire Water Tank Duration | wave7-firesafety | toolkit/wave7/tools/FireWaterTankDuration.jsx | ok |
| 861 | Hose Nozzle Reaction Force | wave7-firesafety | toolkit/wave7/tools/HoseNozzleReaction.jsx | ok |
| 862 | Pasteurisation Lethality (F₀) | wave7-food | toolkit/wave7/tools/PasteurisationF0.jsx | ok |
| 863 | Plank Freezing Time | wave7-food | toolkit/wave7/tools/PlankFreezingTime.jsx | ok |
| 864 | Carbonation CO₂ Volumes | wave7-food | toolkit/wave7/tools/CarbonationVolumes.jsx | ok |
| 865 | Pasteuriser Hold Time | wave7-food | toolkit/wave7/tools/PasteuriserHoldTime.jsx | ok |
| 866 | Brix Dilution Blend | wave7-food | toolkit/wave7/tools/BrixDilutionBlend.jsx | ok |
| 867 | Ice Cream Overrun | wave7-food | toolkit/wave7/tools/IceCreamOverrun.jsx | ok |
| 868 | Curing Salt Nitrite Concentration | wave7-food | toolkit/wave7/tools/CuringNitritePpm.jsx | ok |
| 869 | Baking Pan Conversion | wave7-food | toolkit/wave7/tools/BakingPanConversion.jsx | ok |
| 870 | Espresso Extraction Yield | wave7-food | toolkit/wave7/tools/EspressoExtractionYield.jsx | ok |
| 871 | Brewing Water Residual Alkalinity | wave7-food | toolkit/wave7/tools/BrewingWaterAlkalinity.jsx | ok |
| 872 | Imposition Sheet Count | wave7-print | toolkit/wave7/tools/ImpositionSheetCount.jsx | ok |
| 873 | Ink Coverage Area | wave7-print | toolkit/wave7/tools/InkCoverageArea.jsx | ok |
| 874 | Halftone Dot Gain (TVI) | wave7-print | toolkit/wave7/tools/DotGainTvi.jsx | ok |
| 875 | Screen Ruling & Output Resolution | wave7-print | toolkit/wave7/tools/ScreenRulingResolution.jsx | ok |
| 876 | Bleed & Trim Geometry | wave7-print | toolkit/wave7/tools/BleedTrimGeometry.jsx | ok |
| 877 | Sheet Layout Grid (N-up) | wave7-print | toolkit/wave7/tools/SheetLayoutGrid.jsx | ok |
| 878 | Paper Grammage Conversion | wave7-print | toolkit/wave7/tools/PaperGrammageConversion.jsx | ok |
| 879 | Print Waste Allowance | wave7-print | toolkit/wave7/tools/PrintWasteAllowance.jsx | ok |
| 880 | Ink Cost per Thousand Sheets | wave7-print | toolkit/wave7/tools/InkCostPerSheet.jsx | ok |
| 881 | Book Spine Width | wave7-print | toolkit/wave7/tools/SpineWidthBinding.jsx | ok |
| 882 | Audio Buffer Latency | wave7-audio | toolkit/wave7/tools/AudioBufferLatency.jsx | ok |
| 883 | Tempo Delay Time | wave7-audio | toolkit/wave7/tools/TempoDelayTime.jsx | ok |
| 884 | Passive Crossover Component Values | wave7-audio | toolkit/wave7/tools/CrossoverFrequency.jsx | ok |
| 885 | Amplifier Headroom | wave7-audio | toolkit/wave7/tools/AmplifierHeadroom.jsx | ok |
| 886 | Summing Multiple Sources | wave7-audio | toolkit/wave7/tools/DbSourceSummation.jsx | ok |
| 887 | Sample Rate Conversion Ratio | wave7-audio | toolkit/wave7/tools/SampleRateRatio.jsx | ok |
| 888 | Bit Depth Dynamic Range | wave7-audio | toolkit/wave7/tools/BitDepthDynamicRange.jsx | ok |
| 889 | Summing Two Track Levels | wave7-audio | toolkit/wave7/tools/TrackLoudnessSum.jsx | ok |
| 890 | Speaker Impedance Load | wave7-audio | toolkit/wave7/tools/SpeakerImpedanceLoad.jsx | ok |
| 891 | Monitor Level Calibration | wave7-audio | toolkit/wave7/tools/MonitorLevelCalibration.jsx | ok |
| 892 | Trapezoidal Motion Profile | wave7-robotics | toolkit/wave7/tools/TrapezoidalMotionProfile.jsx | ok |
| 893 | Joint Static & Dynamic Torque | wave7-robotics | toolkit/wave7/tools/JointStaticTorque.jsx | ok |
| 894 | Servo Inertia Matching | wave7-robotics | toolkit/wave7/tools/ServoInertiaMatching.jsx | ok |
| 895 | Ball Screw Thrust | wave7-robotics | toolkit/wave7/tools/BallScrewThrust.jsx | ok |
| 896 | Safety Scanner Minimum Distance | wave7-robotics | toolkit/wave7/tools/SafetyScannerDistance.jsx | ok |
| 897 | Pneumatic Gripper Force | wave7-robotics | toolkit/wave7/tools/PneumaticGripperForce.jsx | ok |
| 898 | Stepper Torque at Speed | wave7-robotics | toolkit/wave7/tools/StepperPulloutTorque.jsx | ok |
| 899 | Gearbox Backlash Error | wave7-robotics | toolkit/wave7/tools/GearboxBacklashError.jsx | ok |
| 900 | Work Envelope Volume Coverage | wave7-robotics | toolkit/wave7/tools/WorkEnvelopeCoverage.jsx | ok |
| 901 | RMS Duty Cycle Torque | wave7-robotics | toolkit/wave7/tools/RmsDutyTorque.jsx | ok |
| 902 | McKee Box Compression Strength | wave7-packaging | toolkit/wave7/tools/MckeeEdgeCrush.jsx | ok |
| 903 | Stacking Strength Derating | wave7-packaging | toolkit/wave7/tools/StackingStrengthDerating.jsx | ok |
| 904 | Pallet Pattern & Carton Count | wave7-packaging | toolkit/wave7/tools/PalletPatternCount.jsx | ok |
| 905 | Film Roll Yield | wave7-packaging | toolkit/wave7/tools/FilmRollYield.jsx | ok |
| 906 | Carton Board Utilisation | wave7-packaging | toolkit/wave7/tools/CartonBoardUtilisation.jsx | ok |
| 907 | Tube Fill Volume | wave7-packaging | toolkit/wave7/tools/TubeFillVolume.jsx | ok |
| 908 | Sachet Web Count | wave7-packaging | toolkit/wave7/tools/SachetWebCount.jsx | ok |
| 909 | Cushioning Thickness from Drop Height | wave7-packaging | toolkit/wave7/tools/DropHeightCushion.jsx | ok |
| 910 | Seal Peel Strength | wave7-packaging | toolkit/wave7/tools/SealPeelStrength.jsx | ok |
| 911 | Flute Caliper & Board Weight | wave7-packaging | toolkit/wave7/tools/FluteCaliperCheck.jsx | ok |
| 912 | Blast Powder Factor | wave7-mining | toolkit/wave7/tools/PowderFactor.jsx | ok |
| 913 | Blast Burden & Spacing | wave7-mining | toolkit/wave7/tools/BlastBurdenSpacing.jsx | ok |
| 914 | Drill Penetration Rate | wave7-mining | toolkit/wave7/tools/DrillPenetrationRate.jsx | ok |
| 915 | Haul Cycle Time | wave7-mining | toolkit/wave7/tools/HaulCycleTime.jsx | ok |
| 916 | Truck & Shovel Match | wave7-mining | toolkit/wave7/tools/TruckShovelMatch.jsx | ok |
| 917 | Ore Grade Cut-off | wave7-mining | toolkit/wave7/tools/OreGradeCutoff.jsx | ok |
| 918 | Mill Residence Time | wave7-mining | toolkit/wave7/tools/MillResidenceTime.jsx | ok |
| 919 | Crusher Reduction Ratio | wave7-mining | toolkit/wave7/tools/CrusherReductionRatio.jsx | ok |
| 920 | Tailings Settling Flux | wave7-mining | toolkit/wave7/tools/TailingsSettlingFlux.jsx | ok |
| 921 | Mine Ventilation Airflow | wave7-mining | toolkit/wave7/tools/MineVentilationAirflow.jsx | ok |
| 922 | Arc Weld Heat Input | wave8-welding | toolkit/wave8/tools/WeldHeatInput.jsx | ok |
| 923 | Weld Cooling Rate | wave8-welding | toolkit/wave8/tools/WeldCoolingRate.jsx | ok |
| 924 | Fillet Weld Throat & Strength | wave8-welding | toolkit/wave8/tools/FilletWeldThroat.jsx | ok |
| 925 | Weld Deposition Rate | wave8-welding | toolkit/wave8/tools/WeldDepositionRate.jsx | ok |
| 926 | Filler Metal Requirement | wave8-welding | toolkit/wave8/tools/FillerMetalMass.jsx | ok |
| 927 | Carbon Equivalent (IIW) | wave8-welding | toolkit/wave8/tools/CarbonEquivalent.jsx | ok |
| 928 | Transverse Weld Shrinkage | wave8-welding | toolkit/wave8/tools/WeldShrinkage.jsx | ok |
| 929 | Resistance Spot Weld Energy | wave8-welding | toolkit/wave8/tools/SpotWeldNugget.jsx | ok |
| 930 | Brazed Joint Capillary Rise | wave8-welding | toolkit/wave8/tools/BrazingClearance.jsx | ok |
| 931 | Stud & Bolt Shear Area | wave8-welding | toolkit/wave8/tools/StudWeldStress.jsx | ok |
| 932 | Lumen Method Fixture Count | wave8-lighting | toolkit/wave8/tools/RoomIndexLumen.jsx | ok |
| 933 | Room Cavity Ratio | wave8-lighting | toolkit/wave8/tools/RoomCavityRatio.jsx | ok |
| 934 | Point Source Illuminance | wave8-lighting | toolkit/wave8/tools/InverseSquareLux.jsx | ok |
| 935 | Luminaire Spacing to Mounting Height | wave8-lighting | toolkit/wave8/tools/LuminaireSpacing.jsx | ok |
| 936 | LED Driver Sizing | wave8-lighting | toolkit/wave8/tools/LedDriverSizing.jsx | ok |
| 937 | LED Junction Temperature | wave8-lighting | toolkit/wave8/tools/LedThermalJunction.jsx | ok |
| 938 | Lighting Power Density | wave8-lighting | toolkit/wave8/tools/LightingPowerDensity.jsx | ok |
| 939 | Daylight Factor Estimate | wave8-lighting | toolkit/wave8/tools/DaylightFactor.jsx | ok |
| 940 | Colour Temperature Mixing | wave8-lighting | toolkit/wave8/tools/ColourTemperatureMix.jsx | ok |
| 941 | Beam Spread Footprint | wave8-lighting | toolkit/wave8/tools/StageBeamSpread.jsx | ok |
| 942 | Hydraulic Cylinder Force & Speed | wave8-fluidpower | toolkit/wave8/tools/CylinderForceSpeed.jsx | ok |
| 943 | Hydraulic Pump Flow & Power | wave8-fluidpower | toolkit/wave8/tools/PumpFlowPower.jsx | ok |
| 944 | Accumulator Precharge Sizing | wave8-fluidpower | toolkit/wave8/tools/AccumulatorSizing.jsx | ok |
| 945 | Hydraulic Motor Torque & Speed | wave8-fluidpower | toolkit/wave8/tools/HydraulicMotorTorque.jsx | ok |
| 946 | Hydraulic Hose Pressure Drop | wave8-fluidpower | toolkit/wave8/tools/HosePressureDrop.jsx | ok |
| 947 | Pressure Intensifier Ratio | wave8-fluidpower | toolkit/wave8/tools/IntensifierRatio.jsx | ok |
| 948 | Reservoir Sizing & Dwell | wave8-fluidpower | toolkit/wave8/tools/ReservoirSizing.jsx | ok |
| 949 | Hydraulic System Heat Load | wave8-fluidpower | toolkit/wave8/tools/HydraulicHeatLoad.jsx | ok |
| 950 | Pneumatic Cylinder Air Use | wave8-fluidpower | toolkit/wave8/tools/PneumaticCylinderAir.jsx | ok |
| 951 | Compressed Air Receiver Sizing | wave8-fluidpower | toolkit/wave8/tools/AirReceiverSizing.jsx | ok |
| 952 | Cryogen Boil-off Rate | wave8-cryogenics | toolkit/wave8/tools/CryogenBoiloff.jsx | ok |
| 953 | Dewar Hold Time | wave8-cryogenics | toolkit/wave8/tools/DewarHoldTime.jsx | ok |
| 954 | Liquid to Gas Expansion Ratio | wave8-cryogenics | toolkit/wave8/tools/GasExpansionRatio.jsx | ok |
| 955 | Multilayer Insulation Heat Load | wave8-cryogenics | toolkit/wave8/tools/RadiationShieldHeat.jsx | ok |
| 956 | Vacuum System Leak Rate | wave8-cryogenics | toolkit/wave8/tools/VacuumLeakRate.jsx | ok |
| 957 | Effective Pumping Speed | wave8-cryogenics | toolkit/wave8/tools/PumpingSpeedEffective.jsx | ok |
| 958 | Gas Mean Free Path | wave8-cryogenics | toolkit/wave8/tools/MeanFreePath.jsx | ok |
| 959 | Cryogenic Thermal Contraction | wave8-cryogenics | toolkit/wave8/tools/ThermalContraction.jsx | ok |
| 960 | Cryogenic Relief Area | wave8-cryogenics | toolkit/wave8/tools/ReliefValveSizing.jsx | ok |
| 961 | Outgassing Gas Load | wave8-cryogenics | toolkit/wave8/tools/OutgassingLoad.jsx | ok |
| 962 | Dye Recipe Mass | wave8-textile | toolkit/wave8/tools/DyeRecipeMass.jsx | ok |
| 963 | Liquor Ratio & Bath Volume | wave8-textile | toolkit/wave8/tools/LiquorRatioVolume.jsx | ok |
| 964 | Exhaust Dyeing Salt Dose | wave8-textile | toolkit/wave8/tools/SaltDoseExhaust.jsx | ok |
| 965 | Fabric GSM Weight | wave8-textile | toolkit/wave8/tools/FabricGsmWeight.jsx | ok |
| 966 | Fabric Shrinkage Allowance | wave8-textile | toolkit/wave8/tools/ShrinkageAllowance.jsx | ok |
| 967 | Weave Thread Density | wave8-textile | toolkit/wave8/tools/ThreadCountDensity.jsx | ok |
| 968 | Yarn Twist Factor | wave8-textile | toolkit/wave8/tools/YarnTwistFactor.jsx | ok |
| 969 | Sewing Thread Consumption | wave8-textile | toolkit/wave8/tools/SewingThreadUse.jsx | ok |
| 970 | Peroxide Bleach Dose | wave8-textile | toolkit/wave8/tools/BleachPeroxideDose.jsx | ok |
| 971 | Stenter Dwell Time | wave8-textile | toolkit/wave8/tools/StenterDwellTime.jsx | ok |
| 972 | Tablet Press Weight & Yield | wave8-pharma | toolkit/wave8/tools/TabletWeightYield.jsx | ok |
| 973 | Dissolution Profile First-Order | wave8-pharma | toolkit/wave8/tools/DissolutionProfile.jsx | ok |
| 974 | Body Surface Dose Scaling | wave8-pharma | toolkit/wave8/tools/DoseConversionBsa.jsx | ok |
| 975 | Repeat Dose Accumulation | wave8-pharma | toolkit/wave8/tools/HalfLifeAccumulation.jsx | ok |
| 976 | Loading & Maintenance Dose | wave8-pharma | toolkit/wave8/tools/LoadingDose.jsx | ok |
| 977 | Solution Osmolarity | wave8-pharma | toolkit/wave8/tools/OsmolaritySolution.jsx | ok |
| 978 | Serial Dilution Planner | wave8-pharma | toolkit/wave8/tools/DilutionSeries.jsx | ok |
| 979 | Granulation Moisture Balance | wave8-pharma | toolkit/wave8/tools/GranulationMoisture.jsx | ok |
| 980 | Vial Fill Volume | wave8-pharma | toolkit/wave8/tools/ContainerFillVolume.jsx | ok |
| 981 | Steam Sterilisation Fo | wave8-pharma | toolkit/wave8/tools/SterilisationLethality.jsx | ok |
| 982 | SPT N-Value Correction | wave8-geotech | toolkit/wave8/tools/SptCorrection.jsx | ok |
| 983 | Plate Load Subgrade Modulus | wave8-geotech | toolkit/wave8/tools/PlateLoadModulus.jsx | ok |
| 984 | Falling Head Permeability | wave8-geotech | toolkit/wave8/tools/PermeabilityFallingHead.jsx | ok |
| 985 | Compaction Relative Density | wave8-geotech | toolkit/wave8/tools/ProctorCompaction.jsx | ok |
| 986 | Atterberg Plasticity Indices | wave8-geotech | toolkit/wave8/tools/AtterbergIndices.jsx | ok |
| 987 | Field Vane Shear Strength | wave8-geotech | toolkit/wave8/tools/VaneShearStrength.jsx | ok |
| 988 | Eccentric Footing Effective Width | wave8-geotech | toolkit/wave8/tools/BearingEffectiveWidth.jsx | ok |
| 989 | CBR to Subgrade Modulus | wave8-geotech | toolkit/wave8/tools/CbrSubgrade.jsx | ok |
| 990 | Pile Shaft Capacity | wave8-geotech | toolkit/wave8/tools/PileSkinFriction.jsx | ok |
| 991 | Dewatering Radius of Influence | wave8-geotech | toolkit/wave8/tools/DewateringRadius.jsx | ok |
| 992 | Octave Band Edges | wave8-acoustest | toolkit/wave8/tools/OctaveBandCentres.jsx | ok |
| 993 | Sound Pressure Level Distance Decay | wave8-acoustest | toolkit/wave8/tools/SplDistanceDecay.jsx | ok |
| 994 | Rectangular Room Modes | wave8-acoustest | toolkit/wave8/tools/RoomModeFrequency.jsx | ok |
| 995 | Half-Sine Shock Velocity Change | wave8-acoustest | toolkit/wave8/tools/ShockResponseSpectrum.jsx | ok |
| 996 | Vibration Velocity RMS | wave8-acoustest | toolkit/wave8/tools/VibrationSeverity.jsx | ok |
| 997 | Accelerometer Output Scaling | wave8-acoustest | toolkit/wave8/tools/AccelerometerSensitivity.jsx | ok |
| 998 | Occupational Noise Dose | wave8-acoustest | toolkit/wave8/tools/NoiseDose.jsx | ok |
| 999 | Tone-to-Noise Margin | wave8-acoustest | toolkit/wave8/tools/TonalMaskingMargin.jsx | ok |
| 1000 | Free-Free Bar Fundamental | wave8-acoustest | toolkit/wave8/tools/ResonantBarFrequency.jsx | ok |
| 1001 | Eyring Reverberation Time | wave8-acoustest | toolkit/wave8/tools/ReverberationT60Eyring.jsx | ok |
| 1002 | Split Velocity & Speed | wave9-sports | toolkit/wave9/tools/SprintSplitVelocity.jsx | ok |
| 1003 | Stride Length & Cadence | wave9-sports | toolkit/wave9/tools/StrideCadence.jsx | ok |
| 1004 | Jump Height from Flight Time | wave9-sports | toolkit/wave9/tools/JumpFlightHeight.jsx | ok |
| 1005 | Force–Velocity Profile | wave9-sports | toolkit/wave9/tools/ForceVelocityProfile.jsx | ok |
| 1006 | RPE Session & Weekly Load | wave9-sports | toolkit/wave9/tools/RpeSessionLoad.jsx | ok |
| 1007 | Acute:Chronic Workload Ratio | wave9-sports | toolkit/wave9/tools/AcuteChronicRatio.jsx | ok |
| 1008 | WBGT Heat Stress Index | wave9-sports | toolkit/wave9/tools/HeatStressWbgt.jsx | ok |
| 1009 | Sweat Rate & Fluid Deficit | wave9-sports | toolkit/wave9/tools/SweatRateDeficit.jsx | ok |
| 1010 | Altitude Performance Loss | wave9-sports | toolkit/wave9/tools/AltitudePerformance.jsx | ok |
| 1011 | Lactate Threshold & Zones | wave9-sports | toolkit/wave9/tools/LactateThresholdZones.jsx | ok |
| 1012 | Genlock Frame & Line Timing | wave9-broadcast | toolkit/wave9/tools/GenlockTiming.jsx | ok |
| 1013 | SDI Cable Run Budget | wave9-broadcast | toolkit/wave9/tools/SdiCableLength.jsx | ok |
| 1014 | Frames ⇄ Timecode Converter | wave9-broadcast | toolkit/wave9/tools/TimecodeConvert.jsx | ok |
| 1015 | Programme Loudness & True Peak | wave9-broadcast | toolkit/wave9/tools/LoudnessTruePeak.jsx | ok |
| 1016 | Multicam Sync Alignment | wave9-broadcast | toolkit/wave9/tools/MulticamSyncOffset.jsx | ok |
| 1017 | Livestream Bandwidth Ladder | wave9-broadcast | toolkit/wave9/tools/LivestreamBandwidth.jsx | ok |
| 1018 | Wireless Mic Link Margin | wave9-broadcast | toolkit/wave9/tools/WirelessMicMargin.jsx | ok |
| 1019 | Shutter Angle & Motion Blur | wave9-broadcast | toolkit/wave9/tools/ShutterAngleBlur.jsx | ok |
| 1020 | Autocue Scroll Speed | wave9-broadcast | toolkit/wave9/tools/PrompterScrollSpeed.jsx | ok |
| 1021 | Slow-Motion Playback Planner | wave9-broadcast | toolkit/wave9/tools/SlomoPlaybackDuration.jsx | ok |
| 1022 | Braking Distance & Gradient | wave9-rail | toolkit/wave9/tools/TrainBrakingDistance.jsx | ok |
| 1023 | Curve Cant & Cant Deficiency | wave9-rail | toolkit/wave9/tools/CurveCantDeficiency.jsx | ok |
| 1024 | Tractive Effort & Adhesion | wave9-rail | toolkit/wave9/tools/RailTractiveEffort.jsx | ok |
| 1025 | Turnout Versine & Speed | wave9-rail | toolkit/wave9/tools/TurnoutVersineSpeed.jsx | ok |
| 1026 | Welded Rail Thermal Stress | wave9-rail | toolkit/wave9/tools/RailThermalStress.jsx | ok |
| 1027 | Signal Block Headway & Capacity | wave9-rail | toolkit/wave9/tools/SignalBlockHeadway.jsx | ok |
| 1028 | Davis Resistance & Power | wave9-rail | toolkit/wave9/tools/DavisTrainResistance.jsx | ok |
| 1029 | Platform Dwell Time | wave9-rail | toolkit/wave9/tools/PlatformDwellTime.jsx | ok |
| 1030 | Regenerative Braking Energy | wave9-rail | toolkit/wave9/tools/RegenBrakeEnergy.jsx | ok |
| 1031 | Gradient Starting & Adhesion | wave9-rail | toolkit/wave9/tools/RailAdhesionStart.jsx | ok |
| 1032 | Pick Rate & Labour Plan | wave9-warehouse | toolkit/wave9/tools/PickRateLabour.jsx | ok |
| 1033 | Dock Turnaround & Slots | wave9-warehouse | toolkit/wave9/tools/DockTurnaround.jsx | ok |
| 1034 | Pallet Locations & Layout | wave9-warehouse | toolkit/wave9/tools/PalletPositionCount.jsx | ok |
| 1035 | Pick Path & Travel Time | wave9-warehouse | toolkit/wave9/tools/PickPathTravel.jsx | ok |
| 1036 | Slotting & ABC Velocity | wave9-warehouse | toolkit/wave9/tools/SlottingVelocity.jsx | ok |
| 1037 | Wave Batch Size | wave9-warehouse | toolkit/wave9/tools/OrderBatchSize.jsx | ok |
| 1038 | Shift Labour Planning | wave9-warehouse | toolkit/wave9/tools/LabourPlanningShifts.jsx | ok |
| 1039 | Returns Processing Capacity | wave9-warehouse | toolkit/wave9/tools/ReturnsProcessing.jsx | ok |
| 1040 | Inventory Accuracy & Counting | wave9-warehouse | toolkit/wave9/tools/CycleCountAccuracy.jsx | ok |
| 1041 | Order Cutoff & Release Plan | wave9-warehouse | toolkit/wave9/tools/OrderCutoffSla.jsx | ok |
| 1042 | Premium Proration & Refund | wave9-insurance | toolkit/wave9/tools/PremiumProration.jsx | ok |
| 1043 | Loss & Combined Ratio | wave9-insurance | toolkit/wave9/tools/LossRatioUnderwriting.jsx | ok |
| 1044 | Deductible & Coinsurance Split | wave9-insurance | toolkit/wave9/tools/DeductibleCoinsurance.jsx | ok |
| 1045 | Annuity & Present Value Factor | wave9-insurance | toolkit/wave9/tools/AnnuityFactor.jsx | ok |
| 1046 | Mortality Table & Survival | wave9-insurance | toolkit/wave9/tools/MortalitySurvival.jsx | ok |
| 1047 | IBNR Reserve Estimation | wave9-insurance | toolkit/wave9/tools/ClaimReserveIbnr.jsx | ok |
| 1048 | Exposure & Experience Rating | wave9-insurance | toolkit/wave9/tools/ExposureRating.jsx | ok |
| 1049 | Solvency Capital Coverage | wave9-insurance | toolkit/wave9/tools/SolvencyCapitalRatio.jsx | ok |
| 1050 | Income Protection & Offset | wave9-insurance | toolkit/wave9/tools/IncomeProtectionOffset.jsx | ok |
| 1051 | Cost of Insurance Present Value | wave9-insurance | toolkit/wave9/tools/MortalityChargePv.jsx | ok |
| 1052 | Weight-Based Drug Dose | wave9-veterinary | toolkit/wave9/tools/VetDrugDose.jsx | ok |
| 1053 | Fluid Deficit & Replacement | wave9-veterinary | toolkit/wave9/tools/FluidDeficitReplacement.jsx | ok |
| 1054 | Resting & Maintenance Energy | wave9-veterinary | toolkit/wave9/tools/VetEnergyRequirement.jsx | ok |
| 1055 | Drug Half-Life & Interval | wave9-veterinary | toolkit/wave9/tools/VetDrugInterval.jsx | ok |
| 1056 | Body Condition & Ideal Weight | wave9-veterinary | toolkit/wave9/tools/BodyConditionScore.jsx | ok |
| 1057 | Constant Rate Infusion | wave9-veterinary | toolkit/wave9/tools/CriInfusionRate.jsx | ok |
| 1058 | Feed Ration & Dry Matter | wave9-veterinary | toolkit/wave9/tools/LivestockFeedRation.jsx | ok |
| 1059 | Equine Weight from Tape | wave9-veterinary | toolkit/wave9/tools/EquineWeightTape.jsx | ok |
| 1060 | Stocking Rate & Grazing | wave9-veterinary | toolkit/wave9/tools/LivestockStockingRate.jsx | ok |
| 1061 | Faecal Egg Count Threshold | wave9-veterinary | toolkit/wave9/tools/FecalEggCount.jsx | ok |
| 1062 | Hardness Conversion Table | wave9-metallurgy | toolkit/wave9/tools/HardnessConversion.jsx | ok |
| 1063 | Jominy Distance to Hardness | wave9-metallurgy | toolkit/wave9/tools/JominyDistance.jsx | ok |
| 1064 | Quench Severity & Ideal Diameter | wave9-metallurgy | toolkit/wave9/tools/QuenchSeverityDi.jsx | ok |
| 1065 | Hollomon Tempering Parameter | wave9-metallurgy | toolkit/wave9/tools/TemperingParameter.jsx | ok |
| 1066 | Austenitising Soak Time | wave9-metallurgy | toolkit/wave9/tools/AustenitisingSoak.jsx | ok |
| 1067 | Carburising Case Depth | wave9-metallurgy | toolkit/wave9/tools/CarburisingCaseDepth.jsx | ok |
| 1068 | Nitriding Case Depth | wave9-metallurgy | toolkit/wave9/tools/NitridingCaseDepth.jsx | ok |
| 1069 | Hardness Profile & Case Depth | wave9-metallurgy | toolkit/wave9/tools/HardnessDepthProfile.jsx | ok |
| 1070 | Martensite Fraction (KM) | wave9-metallurgy | toolkit/wave9/tools/MartensiteFraction.jsx | ok |
| 1071 | Annealing Cooling & Energy | wave9-metallurgy | toolkit/wave9/tools/AnnealingCooling.jsx | ok |
| 1072 | CVSS v3.1 Base & Temporal Score | wave9-cyberops | toolkit/wave9/tools/CvssScore.jsx | ok |
| 1073 | Detection & Response SLA | wave9-cyberops | toolkit/wave9/tools/DetectRespondSla.jsx | ok |
| 1074 | Alert Triage Capacity | wave9-cyberops | toolkit/wave9/tools/AlertTriageCapacity.jsx | ok |
| 1075 | Risk Scoring & Priority | wave9-cyberops | toolkit/wave9/tools/RiskPriorityScore.jsx | ok |
| 1076 | Patch Coverage Forecast | wave9-cyberops | toolkit/wave9/tools/PatchSlaForecast.jsx | ok |
| 1077 | Key Rotation Interval | wave9-cyberops | toolkit/wave9/tools/KeyRotationInterval.jsx | ok |
| 1078 | Breach Cost Estimate | wave9-cyberops | toolkit/wave9/tools/BreachCostEstimate.jsx | ok |
| 1079 | Policy Password Entropy | wave9-cyberops | toolkit/wave9/tools/PasswordPolicyEntropy.jsx | ok |
| 1080 | Attack Surface Exposure | wave9-cyberops | toolkit/wave9/tools/AttackSurfaceExposure.jsx | ok |
| 1081 | MFA Coverage & Residual Risk | wave9-cyberops | toolkit/wave9/tools/MfaCoverageRisk.jsx | ok |
| 1082 | ABV from Gravity Readings | wave10-brewing | toolkit/wave10/tools/OriginalGravityAbv.jsx | ok |
| 1083 | Boil-Off & Pre-Boil Volume | wave10-brewing | toolkit/wave10/tools/WortBoilOff.jsx | ok |
| 1084 | Hop Bitterness (Tinseth IBU) | wave10-brewing | toolkit/wave10/tools/HopUtilisationIbu.jsx | ok |
| 1085 | Yeast Pitch Rate | wave10-brewing | toolkit/wave10/tools/YeastPitchRate.jsx | ok |
| 1086 | Priming Sugar for Carbonation | wave10-brewing | toolkit/wave10/tools/PrimingSugar.jsx | ok |
| 1087 | Mash Strike Water Temperature | wave10-brewing | toolkit/wave10/tools/MashStrikeWater.jsx | ok |
| 1088 | Proof & Dilution Planner | wave10-brewing | toolkit/wave10/tools/DilutionProof.jsx | ok |
| 1089 | Distillation Cut Volumes | wave10-brewing | toolkit/wave10/tools/StillFractionsCut.jsx | ok |
| 1090 | Beer Colour (SRM, Morey) | wave10-brewing | toolkit/wave10/tools/WortColourSrm.jsx | ok |
| 1091 | Sparge Water Volume | wave10-brewing | toolkit/wave10/tools/SpargeWaterVolume.jsx | ok |
| 1092 | Sugar Syrup Mix | wave10-bees | toolkit/wave10/tools/ColonyFeedSyrup.jsx | ok |
| 1093 | Honey Yield & Moisture | wave10-bees | toolkit/wave10/tools/HoneyMoistureYield.jsx | ok |
| 1094 | Varroa Mite Infestation Rate | wave10-bees | toolkit/wave10/tools/MiteWashInfestation.jsx | ok |
| 1095 | Brood Area & Colony Strength | wave10-bees | toolkit/wave10/tools/HiveBroodArea.jsx | ok |
| 1096 | Swarm Risk & Space | wave10-bees | toolkit/wave10/tools/SwarmRiskSpace.jsx | ok |
| 1097 | Queen Laying Rate | wave10-bees | toolkit/wave10/tools/QueenLayingRate.jsx | ok |
| 1098 | Winter Stores Requirement | wave10-bees | toolkit/wave10/tools/WinterStoresNeed.jsx | ok |
| 1099 | Wax Rendering Yield | wave10-bees | toolkit/wave10/tools/WaxRenderYield.jsx | ok |
| 1100 | Pollination Hive Density | wave10-bees | toolkit/wave10/tools/PollinationHiveCount.jsx | ok |
| 1101 | Nectar Flow & Forage Area | wave10-bees | toolkit/wave10/tools/NectarFlowForage.jsx | ok |
| 1102 | Tree Height from Clinometer | wave10-forestry | toolkit/wave10/tools/TreeHeightClinometer.jsx | ok |
| 1103 | Log Volume (Smalian) | wave10-forestry | toolkit/wave10/tools/LogVolumeSmalian.jsx | ok |
| 1104 | Stand Basal Area | wave10-forestry | toolkit/wave10/tools/BasalAreaStand.jsx | ok |
| 1105 | Stand Density Index | wave10-forestry | toolkit/wave10/tools/StandDensityIndex.jsx | ok |
| 1106 | Tree Carbon Stock | wave10-forestry | toolkit/wave10/tools/TreeCarbonStock.jsx | ok |
| 1107 | Board Feet in a Log | wave10-forestry | toolkit/wave10/tools/TimberBoardFeet.jsx | ok |
| 1108 | Firewood Cord Energy | wave10-forestry | toolkit/wave10/tools/FirewoodCordEnergy.jsx | ok |
| 1109 | Planting Spacing & Stems | wave10-forestry | toolkit/wave10/tools/TreeSpacingPlanting.jsx | ok |
| 1110 | Wood Shrinkage | wave10-forestry | toolkit/wave10/tools/WoodMoistureShrinkage.jsx | ok |
| 1111 | Canopy Cover & Light | wave10-forestry | toolkit/wave10/tools/CrownCoverLight.jsx | ok |
| 1112 | Nutrient EC & Dilution | wave10-hydroponics | toolkit/wave10/tools/NutrientEcMix.jsx | ok |
| 1113 | Reservoir Top-Up Plan | wave10-hydroponics | toolkit/wave10/tools/ReservoirTopUp.jsx | ok |
| 1114 | Daily Light Integral | wave10-hydroponics | toolkit/wave10/tools/GrowLightDli.jsx | ok |
| 1115 | pH Adjustment Dose | wave10-hydroponics | toolkit/wave10/tools/PhAdjustDose.jsx | ok |
| 1116 | Fish Feed & Ammonia | wave10-hydroponics | toolkit/wave10/tools/FishFeedAmmonia.jsx | ok |
| 1117 | Biofilter Media Area | wave10-hydroponics | toolkit/wave10/tools/BiofilterMediaArea.jsx | ok |
| 1118 | Fish Stocking Density | wave10-hydroponics | toolkit/wave10/tools/AquaponicStocking.jsx | ok |
| 1119 | NFT Channel Flow | wave10-hydroponics | toolkit/wave10/tools/NftChannelFlow.jsx | ok |
| 1120 | Water Use Efficiency | wave10-hydroponics | toolkit/wave10/tools/WaterUseEfficiency.jsx | ok |
| 1121 | Vapour Pressure Deficit | wave10-hydroponics | toolkit/wave10/tools/VpdGreenhouse.jsx | ok |
| 1122 | Dead Reckoning Position | wave10-navigation | toolkit/wave10/tools/DeadReckoningPosition.jsx | ok |
| 1123 | Tide Height by Twelfths | wave10-navigation | toolkit/wave10/tools/TidalHeightRuleTwelfths.jsx | ok |
| 1124 | Current Set & Drift | wave10-navigation | toolkit/wave10/tools/CurrentSetDrift.jsx | ok |
| 1125 | Fuel Range & Reserve | wave10-navigation | toolkit/wave10/tools/FuelRangeReserve.jsx | ok |
| 1126 | Anchor Scope & Swing | wave10-navigation | toolkit/wave10/tools/AnchorScopeDepth.jsx | ok |
| 1127 | Horizon & Light Range | wave10-navigation | toolkit/wave10/tools/HorizonDistanceEye.jsx | ok |
| 1128 | CPA & TCPA | wave10-navigation | toolkit/wave10/tools/CollisionCpaTcpa.jsx | ok |
| 1129 | Displacement Hull Speed | wave10-navigation | toolkit/wave10/tools/HullSpeedLength.jsx | ok |
| 1130 | Apparent Wind | wave10-navigation | (registry / shared workbench) | ok |
| 1131 | Passage ETA & Legs | wave10-navigation | toolkit/wave10/tools/PassageEtaLeg.jsx | ok |
| 1132 | Concrete Slab Volume | wave10-estimating | toolkit/wave10/tools/ConcreteSlabVolume.jsx | ok |
| 1133 | Brick & Block Count | wave10-estimating | toolkit/wave10/tools/BrickBlockCount.jsx | ok |
| 1134 | Paint Coverage | wave10-estimating | toolkit/wave10/tools/PaintCoverage.jsx | ok |
| 1135 | Roof Area & Pitch | wave10-estimating | toolkit/wave10/tools/RoofAreaPitch.jsx | ok |
| 1136 | Stair Rise & Run | wave10-estimating | toolkit/wave10/tools/StairRiseRun.jsx | ok |
| 1137 | Tile Quantity & Waste | wave10-estimating | toolkit/wave10/tools/TileQuantityWaste.jsx | ok |
| 1138 | Stud Wall Takeoff | wave10-estimating | toolkit/wave10/tools/TimberStudWall.jsx | ok |
| 1139 | Excavation Spoil & Bulking | wave10-estimating | toolkit/wave10/tools/ExcavationSpoilBulk.jsx | ok |
| 1140 | Rebar Weight Takeoff | wave10-estimating | toolkit/wave10/tools/RebarWeightTakeoff.jsx | ok |
| 1141 | Contingency & Margin | wave10-estimating | toolkit/wave10/tools/ProjectContingencyCost.jsx | ok |
| 1142 | Orbital Period from Altitude | wave10-spaceops | toolkit/wave10/tools/OrbitalPeriodAltitude.jsx | ok |
| 1143 | Ground Track Shift | wave10-spaceops | toolkit/wave10/tools/GroundTrackShift.jsx | ok |
| 1144 | Downlink Budget | wave10-spaceops | toolkit/wave10/tools/LinkBudgetDownlink.jsx | ok |
| 1145 | Delta-v Budget | wave10-spaceops | toolkit/wave10/tools/DeltaVBudget.jsx | ok |
| 1146 | Eclipse Duration in LEO | wave10-spaceops | toolkit/wave10/tools/EclipseDurationLeo.jsx | ok |
| 1147 | Solar Array Sizing | wave10-spaceops | toolkit/wave10/tools/SolarArraySizing.jsx | ok |
| 1148 | Battery Depth of Discharge | wave10-spaceops | toolkit/wave10/tools/BatteryDodOrbit.jsx | ok |
| 1149 | Radiation Shielding Dose | wave10-spaceops | toolkit/wave10/tools/RadiationDoseShield.jsx | ok |
| 1150 | Light Time & Comms Delay | wave10-spaceops | toolkit/wave10/tools/LightTimeDelay.jsx | ok |
| 1151 | Satellite Equilibrium Temperature | wave10-spaceops | toolkit/wave10/tools/ThermalEquilibriumSat.jsx | ok |
| 1152 | Hyperfocal Distance | wave10-photography | toolkit/wave10/tools/HyperfocalDistance.jsx | ok |
| 1153 | Field of View | wave10-photography | toolkit/wave10/tools/FieldOfViewSensor.jsx | ok |
| 1154 | Crop Factor Equivalence | wave10-photography | toolkit/wave10/tools/CropFactorEquivalent.jsx | ok |
| 1155 | Strobe Guide Number | wave10-photography | toolkit/wave10/tools/StrobeGuideNumber.jsx | ok |
| 1156 | Print Size & PPI | wave10-photography | toolkit/wave10/tools/PrintSizePpi.jsx | ok |
| 1157 | Diffraction Limit | wave10-photography | toolkit/wave10/tools/DiffractionLimitAperture.jsx | ok |
| 1158 | Long Exposure Compensation | wave10-photography | toolkit/wave10/tools/ReciprocityLongExposure.jsx | ok |
| 1159 | Timelapse Pan Rate | wave10-photography | toolkit/wave10/tools/GimbalTimelapsePan.jsx | ok |
| 1160 | Light Falloff & Ratio | wave10-photography | toolkit/wave10/tools/SoftboxLightFalloff.jsx | ok |
| 1161 | Memory Card Capacity | wave10-photography | toolkit/wave10/tools/MemoryCardCapacity.jsx | ok |
| 1162 | Burn Surface Area (Rule of Nines) | wave11-ems | toolkit/wave11/tools/BurnAreaTbsa.jsx | ok |
| 1163 | Parkland Fluid Rate | wave11-ems | toolkit/wave11/tools/ParklandFluidRate.jsx | ok |
| 1164 | IV Drip Rate | wave11-ems | toolkit/wave11/tools/IvDripRate.jsx | ok |
| 1165 | Oxygen Cylinder Duration | wave11-ems | toolkit/wave11/tools/OxygenCylinderDuration.jsx | ok |
| 1166 | Mass Casualty Triage Load | wave11-ems | toolkit/wave11/tools/TriageSieveLoad.jsx | ok |
| 1167 | Shock Index & MAP | wave11-ems | toolkit/wave11/tools/ShockIndexVitals.jsx | ok |
| 1168 | Apgar Score | wave11-ems | toolkit/wave11/tools/ApgarScore.jsx | ok |
| 1169 | CPR Compression Fraction | wave11-ems | toolkit/wave11/tools/CprCompressionFraction.jsx | ok |
| 1170 | Paediatric Weight & Energy | wave11-ems | toolkit/wave11/tools/PaediatricWeightEnergy.jsx | ok |
| 1171 | Golden Hour Transport Time | wave11-ems | toolkit/wave11/tools/TraumaGoldenHour.jsx | ok |
| 1172 | Density Altitude | wave11-dispatch | toolkit/wave11/tools/DensityAltitude.jsx | ok |
| 1173 | Takeoff Distance Correction | wave11-dispatch | toolkit/wave11/tools/TakeoffDistanceCorrection.jsx | ok |
| 1174 | Crosswind & Headwind | wave11-dispatch | toolkit/wave11/tools/CrosswindComponent.jsx | ok |
| 1175 | Weight & Balance Centre of Gravity | wave11-dispatch | toolkit/wave11/tools/WeightAndBalanceCg.jsx | ok |
| 1176 | Fuel Plan & Reserve | wave11-dispatch | toolkit/wave11/tools/FuelPlanReserve.jsx | ok |
| 1177 | Payload & Range Trade-off | wave11-dispatch | toolkit/wave11/tools/PayloadRangeTradeoff.jsx | ok |
| 1178 | Cruise TAS from Mach | wave11-dispatch | toolkit/wave11/tools/CruiseTasMach.jsx | ok |
| 1179 | Top of Descent Profile | wave11-dispatch | toolkit/wave11/tools/DescentProfileTod.jsx | ok |
| 1180 | Diversion Fuel (ETOPS) | wave11-dispatch | toolkit/wave11/tools/EtopsDiversionFuel.jsx | ok |
| 1181 | Fuel Tankering Savings | wave11-dispatch | toolkit/wave11/tools/FuelTankeringSavings.jsx | ok |
| 1182 | Table Turns & Covers | wave11-hospitality | toolkit/wave11/tools/TableTurnRate.jsx | ok |
| 1183 | Food Cost Percentage | wave11-hospitality | toolkit/wave11/tools/FoodCostPercent.jsx | ok |
| 1184 | Menu Item Contribution | wave11-hospitality | toolkit/wave11/tools/MenuItemMargin.jsx | ok |
| 1185 | Spirits Pour Cost | wave11-hospitality | toolkit/wave11/tools/PourCostSpirits.jsx | ok |
| 1186 | Labour Cost Percentage | wave11-hospitality | toolkit/wave11/tools/LabourCostPercent.jsx | ok |
| 1187 | Banquet Capacity & Spend | wave11-hospitality | toolkit/wave11/tools/BanquetCapacityPlan.jsx | ok |
| 1188 | Kitchen Peak Throughput | wave11-hospitality | toolkit/wave11/tools/KitchenThroughput.jsx | ok |
| 1189 | Break-Even Covers | wave11-hospitality | toolkit/wave11/tools/BreakevenCovers.jsx | ok |
| 1190 | Beverage Par Level | wave11-hospitality | toolkit/wave11/tools/BeverageInventoryPar.jsx | ok |
| 1191 | Occupancy & RevPAR | wave11-hospitality | toolkit/wave11/tools/OccupancyRevpar.jsx | ok |
| 1192 | Axle Load Distribution | wave11-freight | toolkit/wave11/tools/AxleLoadDistribution.jsx | ok |
| 1193 | Freight Class from Density | wave11-freight | toolkit/wave11/tools/FreightClassDensity.jsx | ok |
| 1194 | LTL vs FTL Break-Even | wave11-freight | toolkit/wave11/tools/LtlVsFtlBreakeven.jsx | ok |
| 1195 | Fuel Surcharge | wave11-freight | toolkit/wave11/tools/FuelSurcharge.jsx | ok |
| 1196 | Customs Duty & Landed Cost | wave11-freight | toolkit/wave11/tools/CustomsDutyValuation.jsx | ok |
| 1197 | Demurrage & Detention | wave11-freight | toolkit/wave11/tools/DemurrageDetention.jsx | ok |
| 1198 | Pallet Exchange Balance | wave11-freight | toolkit/wave11/tools/PalletExchangeBalance.jsx | ok |
| 1199 | Load Plan Utilisation | wave11-freight | toolkit/wave11/tools/LoadPlanUtilization.jsx | ok |
| 1200 | Transit Time Estimate | wave11-freight | toolkit/wave11/tools/TransitTimeEstimate.jsx | ok |
| 1201 | Cost Per Mile | wave11-freight | toolkit/wave11/tools/CostPerMile.jsx | ok |
| 1202 | Dew Point from Humidity | wave11-weather | toolkit/wave11/tools/DewPointRh.jsx | ok |
| 1203 | Lifting Condensation Level | wave11-weather | toolkit/wave11/tools/LclHeight.jsx | ok |
| 1204 | Precipitable Water | wave11-weather | toolkit/wave11/tools/PrecipitableWater.jsx | ok |
| 1205 | Snowfall Ratio | wave11-weather | toolkit/wave11/tools/SnowfallRatio.jsx | ok |
| 1206 | Mean Sea Level Pressure | wave11-weather | toolkit/wave11/tools/StationPressureMsl.jsx | ok |
| 1207 | Gust Factor & Wind Load | wave11-weather | toolkit/wave11/tools/GustFactorLoad.jsx | ok |
| 1208 | CAPE Estimate | wave11-weather | toolkit/wave11/tools/CapeEstimate.jsx | ok |
| 1209 | Visibility & Runway Band | wave11-weather | toolkit/wave11/tools/VisibilityConversion.jsx | ok |
| 1210 | Rainfall Volume | wave11-weather | toolkit/wave11/tools/RainfallVolume.jsx | ok |
| 1211 | Wind Direction Frequency | wave11-weather | toolkit/wave11/tools/WindDirectionFrequency.jsx | ok |
| 1212 | Prescription Transposition | wave11-optometry | toolkit/wave11/tools/RxTransposition.jsx | ok |
| 1213 | Vertex Distance Conversion | wave11-optometry | toolkit/wave11/tools/VertexDistanceConversion.jsx | ok |
| 1214 | Prism & Decentration | wave11-optometry | toolkit/wave11/tools/PrismDecentration.jsx | ok |
| 1215 | Snellen to logMAR | wave11-optometry | toolkit/wave11/tools/SnellenLogmar.jsx | ok |
| 1216 | Near Addition & Working Distance | wave11-optometry | toolkit/wave11/tools/NearAdditionOptometry.jsx | ok |
| 1217 | IOL Power (SRK II) | wave11-optometry | toolkit/wave11/tools/IolPowerSrk.jsx | ok |
| 1218 | PD & Segment Height | wave11-optometry | toolkit/wave11/tools/PdSegmentHeight.jsx | ok |
| 1219 | Low Vision Magnification | wave11-optometry | toolkit/wave11/tools/MagnificationLowVision.jsx | ok |
| 1220 | Toric Rotation Residual | wave11-optometry | toolkit/wave11/tools/ToricResidualCylinder.jsx | ok |
| 1221 | Acuity Letter Size | wave11-optometry | toolkit/wave11/tools/AcuityLetterSize.jsx | ok |
| 1222 | Elo Rating Update | wave11-analytics | toolkit/wave11/tools/EloRatingUpdate.jsx | ok |
| 1223 | Pythagorean Expectation | wave11-analytics | toolkit/wave11/tools/PythagoreanExpectation.jsx | ok |
| 1224 | Win Probability from Margin | wave11-analytics | toolkit/wave11/tools/WinProbabilityMargin.jsx | ok |
| 1225 | Strength of Schedule | wave11-analytics | toolkit/wave11/tools/StrengthOfSchedule.jsx | ok |
| 1226 | True Shooting Percentage | wave11-analytics | toolkit/wave11/tools/TrueShooting.jsx | ok |
| 1227 | Expected Goals (Shot Quality) | wave11-analytics | toolkit/wave11/tools/XgShotQuality.jsx | ok |
| 1228 | Pace & Efficiency Rating | wave11-analytics | toolkit/wave11/tools/PaceEfficiency.jsx | ok |
| 1229 | Clinch Magic Number | wave11-analytics | toolkit/wave11/tools/MagicNumberClinch.jsx | ok |
| 1230 | Draft Pick Value | wave11-analytics | toolkit/wave11/tools/DraftPickValue.jsx | ok |
| 1231 | Shot Conversion & xG | wave11-analytics | toolkit/wave11/tools/ExpectedGoalsConversion.jsx | ok |
| 1232 | Compost C:N Ratio | wave11-waste | toolkit/wave11/tools/CompostCnRatio.jsx | ok |
| 1233 | Bin Size & Collection | wave11-waste | toolkit/wave11/tools/BinSizeService.jsx | ok |
| 1234 | Diversion Rate | wave11-waste | toolkit/wave11/tools/DiversionRate.jsx | ok |
| 1235 | Landfill Gas Yield | wave11-waste | toolkit/wave11/tools/LandfillGasYield.jsx | ok |
| 1236 | Recycling Revenue | wave11-waste | toolkit/wave11/tools/RecyclingRevenue.jsx | ok |
| 1237 | Compactor Throughput | wave11-waste | toolkit/wave11/tools/CompactorThroughput.jsx | ok |
| 1238 | Collection Route Time | wave11-waste | toolkit/wave11/tools/CollectionRouteTime.jsx | ok |
| 1239 | Waste-to-Energy Output | wave11-waste | toolkit/wave11/tools/WasteToEnergyOutput.jsx | ok |
| 1240 | Leachate Generation | wave11-waste | toolkit/wave11/tools/LeachateGeneration.jsx | ok |
| 1241 | Collection Cost Per Household | wave11-waste | toolkit/wave11/tools/CollectionCostPerHousehold.jsx | ok |
| 1242 | Vineyard Crop Yield | wave12-winery | toolkit/wave12/tools/VineyardCropYield.jsx | ok |
| 1243 | Brix to Alcohol & Chaptalisation | wave12-winery | toolkit/wave12/tools/BrixToAlcohol.jsx | ok |
| 1244 | Must Acid Adjustment | wave12-winery | toolkit/wave12/tools/MustAcidAdjustment.jsx | ok |
| 1245 | Molecular SO₂ from pH | wave12-winery | toolkit/wave12/tools/So2MolecularFree.jsx | ok |
| 1246 | Sugar Fermented to Dryness | wave12-winery | toolkit/wave12/tools/FermentationSugarToDry.jsx | ok |
| 1247 | Barrel Surface to Volume | wave12-winery | toolkit/wave12/tools/BarrelSurfaceRatio.jsx | ok |
| 1248 | Wine Blend Calculator | wave12-winery | toolkit/wave12/tools/WineBlendVolume.jsx | ok |
| 1249 | Bottling Yield | wave12-winery | toolkit/wave12/tools/BottleFillEfficiency.jsx | ok |
| 1250 | Grape Ripening Degree Days | wave12-winery | toolkit/wave12/tools/GrapeRipeningGdd.jsx | ok |
| 1251 | Press Yield per Tonne | wave12-winery | toolkit/wave12/tools/PressYieldTonne.jsx | ok |
| 1252 | Milk Standardisation | wave12-dairy | toolkit/wave12/tools/MilkStandardisation.jsx | ok |
| 1253 | Cheese Yield (Van Slyke) | wave12-dairy | toolkit/wave12/tools/CheeseYieldVanslyke.jsx | ok |
| 1254 | Fat in Dry Matter & Salt in Moisture | wave12-dairy | toolkit/wave12/tools/CurdFdmSm.jsx | ok |
| 1255 | Brine Strength & Salt Uptake | wave12-dairy | toolkit/wave12/tools/BrineSaltingCheese.jsx | ok |
| 1256 | Butter Churning Yield | wave12-dairy | toolkit/wave12/tools/ButterChurningYield.jsx | ok |
| 1257 | Yoghurt Fermentation Time | wave12-dairy | toolkit/wave12/tools/YoghurtFermentationTime.jsx | ok |
| 1258 | Milk Powder Reconstitution | wave12-dairy | toolkit/wave12/tools/MilkPowderReconstitution.jsx | ok |
| 1259 | Cream Separation Balance | wave12-dairy | toolkit/wave12/tools/CreamSeparationMassBalance.jsx | ok |
| 1260 | Bulk Tank Cooling Time | wave12-dairy | toolkit/wave12/tools/MilkTankCoolingTime.jsx | ok |
| 1261 | Dairy Herd Production | wave12-dairy | toolkit/wave12/tools/DairyHerdProduction.jsx | ok |
| 1262 | Clay Shrinkage & Fired Size | wave12-ceramics | toolkit/wave12/tools/ClayShrinkageFiring.jsx | ok |
| 1263 | Glaze Batch Scaling | wave12-ceramics | toolkit/wave12/tools/GlazeBatchScaling.jsx | ok |
| 1264 | Glaze Specific Gravity | wave12-ceramics | toolkit/wave12/tools/GlazeSpecificGravity.jsx | ok |
| 1265 | Firing Heat Work | wave12-ceramics | toolkit/wave12/tools/KilnFiringHeatWork.jsx | ok |
| 1266 | Kiln Energy & Firing Cost | wave12-ceramics | toolkit/wave12/tools/KilnEnergyCost.jsx | ok |
| 1267 | Clay Body Batch | wave12-ceramics | toolkit/wave12/tools/ClayBodyBatch.jsx | ok |
| 1268 | Clay for a Thrown Form | wave12-ceramics | toolkit/wave12/tools/WheelThrowingClayMass.jsx | ok |
| 1269 | Kiln Loading Capacity | wave12-ceramics | toolkit/wave12/tools/KilnLoadingVolume.jsx | ok |
| 1270 | Safe Temperature Step | wave12-ceramics | toolkit/wave12/tools/ThermalShockDeltaT.jsx | ok |
| 1271 | Glaze Fit & Mismatch Stress | wave12-ceramics | toolkit/wave12/tools/GlazeFitCte.jsx | ok |
| 1272 | Glass Wind Load & Thickness | wave12-glazing | toolkit/wave12/tools/GlassWindLoad.jsx | ok |
| 1273 | Glass Thermal Stress | wave12-glazing | toolkit/wave12/tools/GlassThermalStress.jsx | ok |
| 1274 | Condensation & Dew Point | wave12-glazing | toolkit/wave12/tools/IguDewPoint.jsx | ok |
| 1275 | Annealing & Lehr Speed | wave12-glazing | toolkit/wave12/tools/GlassAnnealingLehr.jsx | ok |
| 1276 | Stained Glass Panel Layout | wave12-glazing | toolkit/wave12/tools/StainedGlassPanelLayout.jsx | ok |
| 1277 | Glass Weight & Handling | wave12-glazing | toolkit/wave12/tools/GlassWeightHandling.jsx | ok |
| 1278 | U-Value & Solar Heat Gain | wave12-glazing | toolkit/wave12/tools/GlassUValueShgc.jsx | ok |
| 1279 | Daylight Factor & Glazing Ratio | wave12-glazing | toolkit/wave12/tools/DaylightGlazingRatio.jsx | ok |
| 1280 | Mullion Deflection | wave12-glazing | toolkit/wave12/tools/MullionDeflection.jsx | ok |
| 1281 | Glazing Acoustic Rating | wave12-glazing | toolkit/wave12/tools/GlazingAcousticRating.jsx | ok |
| 1282 | Gear Train Ratio | wave12-horology | toolkit/wave12/tools/GearTrainRatio.jsx | ok |
| 1283 | Pendulum Period & Length | wave12-horology | toolkit/wave12/tools/PendulumPeriodLength.jsx | ok |
| 1284 | Balance Spring Frequency | wave12-horology | toolkit/wave12/tools/BalanceSpringRate.jsx | ok |
| 1285 | Rate & Beat Error | wave12-horology | toolkit/wave12/tools/BeatErrorRate.jsx | ok |
| 1286 | Mainspring Power Reserve | wave12-horology | toolkit/wave12/tools/MainspringPowerReserve.jsx | ok |
| 1287 | Amplitude from Impulse Energy | wave12-horology | toolkit/wave12/tools/WatchAmplitudeEnergy.jsx | ok |
| 1288 | Timekeeping Rate Error | wave12-horology | toolkit/wave12/tools/TimekeepingRateError.jsx | ok |
| 1289 | Clock Weight Runtime | wave12-horology | toolkit/wave12/tools/ClockWeightRuntime.jsx | ok |
| 1290 | Beats per Hour Train Ratio | wave12-horology | toolkit/wave12/tools/BphTrainRatio.jsx | ok |
| 1291 | Water Resistance Check | wave12-horology | toolkit/wave12/tools/WatchWaterResistance.jsx | ok |
| 1292 | Fret Spacing | wave12-luthiery | toolkit/wave12/tools/GuitarFretSpacing.jsx | ok |
| 1293 | String Tension | wave12-luthiery | toolkit/wave12/tools/StringTensionGauge.jsx | ok |
| 1294 | Soundhole Resonance | wave12-luthiery | toolkit/wave12/tools/SoundholeHelmholtz.jsx | ok |
| 1295 | Neck Angle & Action | wave12-luthiery | toolkit/wave12/tools/NeckAngleAction.jsx | ok |
| 1296 | Brace Stiffness & Deflection | wave12-luthiery | toolkit/wave12/tools/SoundboardBraceStiffness.jsx | ok |
| 1297 | String Set Balance | wave12-luthiery | toolkit/wave12/tools/InstrumentTensionBalance.jsx | ok |
| 1298 | Intervals and Cents | wave12-luthiery | toolkit/wave12/tools/TuningTemperamentCents.jsx | ok |
| 1299 | Lacquer Build | wave12-luthiery | toolkit/wave12/tools/LacquerBuildThickness.jsx | ok |
| 1300 | Pickup Winding | wave12-luthiery | toolkit/wave12/tools/PickupWindingOutput.jsx | ok |
| 1301 | Saddle Compensation | wave12-luthiery | toolkit/wave12/tools/SaddleCompensationIntonation.jsx | ok |
| 1302 | Maximum Operating Depth | wave12-diving | toolkit/wave12/tools/ModNitroxMod.jsx | ok |
| 1303 | Equivalent Air Depth | wave12-diving | toolkit/wave12/tools/EadNitrox.jsx | ok |
| 1304 | Partial Pressure Blending | wave12-diving | toolkit/wave12/tools/NitroxBlendPartialPressure.jsx | ok |
| 1305 | Gas Plan from SAC | wave12-diving | toolkit/wave12/tools/GasPlanSac.jsx | ok |
| 1306 | No-Decompression Limit | wave12-diving | toolkit/wave12/tools/NdlSingleCompartment.jsx | ok |
| 1307 | Ascent Time | wave12-diving | toolkit/wave12/tools/AscentRateTime.jsx | ok |
| 1308 | Oxygen Exposure Limits | wave12-diving | toolkit/wave12/tools/O2ExposureLimits.jsx | ok |
| 1309 | Surface Interval & Residual Nitrogen | wave12-diving | toolkit/wave12/tools/SurfaceIntervalResidual.jsx | ok |
| 1310 | Weighting & Buoyancy | wave12-diving | toolkit/wave12/tools/WeightingBuoyancy.jsx | ok |
| 1311 | Cylinder Fill Volumes | wave12-diving | toolkit/wave12/tools/TankFillVolumeGas.jsx | ok |
| 1312 | Brake Pad Life | wave12-workshop | toolkit/wave12/tools/BrakePadLife.jsx | ok |
| 1313 | Tyre Tread Life | wave12-workshop | toolkit/wave12/tools/TyreTreadLife.jsx | ok |
| 1314 | Tyre Size & Speedometer Error | wave12-workshop | toolkit/wave12/tools/TyreSizeSpeedoError.jsx | ok |
| 1315 | Service Interval from Duty | wave12-workshop | toolkit/wave12/tools/ServiceIntervalOilLife.jsx | ok |
| 1316 | Battery Health from CCA | wave12-workshop | toolkit/wave12/tools/BatteryCrankingHealth.jsx | ok |
| 1317 | Toe & Thrust Angle | wave12-workshop | toolkit/wave12/tools/AlignmentThrustAngle.jsx | ok |
| 1318 | Torque Setting with an Extension | wave12-workshop | toolkit/wave12/tools/TorqueExtensionSetting.jsx | ok |
| 1319 | Shop Bay Throughput | wave12-workshop | toolkit/wave12/tools/ShopBayThroughput.jsx | ok |
| 1320 | Job Pricing & Markup | wave12-workshop | toolkit/wave12/tools/PartsMarkupPrice.jsx | ok |
| 1321 | Fuel Trim Diagnosis | wave12-workshop | toolkit/wave12/tools/FuelTrimDiagnostic.jsx | ok |
| 1322 | Counterweight & Balance | wave13-elevators | toolkit/wave13/tools/CounterweightBalance.jsx | ok |
| 1323 | Traction Rope Safety Factor | wave13-elevators | toolkit/wave13/tools/RopeSafetyFactor.jsx | ok |
| 1324 | Travel Time & Round Trip | wave13-elevators | toolkit/wave13/tools/TravelTimeCycle.jsx | ok |
| 1325 | Traffic Handling & Cars | wave13-elevators | toolkit/wave13/tools/TrafficHandlingCars.jsx | ok |
| 1326 | Hydraulic Jack Pressure | wave13-elevators | toolkit/wave13/tools/HydraulicJackPressure.jsx | ok |
| 1327 | Rope Elongation & Levelling | wave13-elevators | toolkit/wave13/tools/RopeElongation.jsx | ok |
| 1328 | Machine Room Heat Load | wave13-elevators | toolkit/wave13/tools/MachineRoomHeat.jsx | ok |
| 1329 | Regenerative Energy Saving | wave13-elevators | toolkit/wave13/tools/RegenEnergySavings.jsx | ok |
| 1330 | Door Cycle & Passenger Flow | wave13-elevators | toolkit/wave13/tools/DoorCycleThroughput.jsx | ok |
| 1331 | Escalator Capacity & Power | wave13-elevators | toolkit/wave13/tools/EscalatorThroughput.jsx | ok |
| 1332 | Sludge Age (SRT) | wave13-wastewater | toolkit/wave13/tools/SrtSludgeAge.jsx | ok |
| 1333 | Food to Microorganism Ratio | wave13-wastewater | toolkit/wave13/tools/FmRatio.jsx | ok |
| 1334 | RAS Flow & Mixed Liquor | wave13-wastewater | toolkit/wave13/tools/RasMlssBalance.jsx | ok |
| 1335 | Aeration Oxygen Demand | wave13-wastewater | toolkit/wave13/tools/AerationOxygenDemand.jsx | ok |
| 1336 | Clarifier Surface Loading | wave13-wastewater | toolkit/wave13/tools/ClarifierSurfaceLoading.jsx | ok |
| 1337 | Digester Gas Yield | wave13-wastewater | toolkit/wave13/tools/DigesterGasYield.jsx | ok |
| 1338 | Denitrification Capacity | wave13-wastewater | toolkit/wave13/tools/DenitrificationCapacity.jsx | ok |
| 1339 | Dewatering & Cake Output | wave13-wastewater | toolkit/wave13/tools/SludgeDewatering.jsx | ok |
| 1340 | Disinfection Dose & CT | wave13-wastewater | toolkit/wave13/tools/ChlorineDose.jsx | ok |
| 1341 | Effluent Compliance Check | wave13-wastewater | toolkit/wave13/tools/EffluentCompliance.jsx | ok |
| 1342 | Pulp Yield & Kappa | wave13-paper | toolkit/wave13/tools/PulpYieldKappa.jsx | ok |
| 1343 | Refining Energy & Freeness | wave13-paper | toolkit/wave13/tools/RefiningEnergy.jsx | ok |
| 1344 | Stock Consistency & Dilution | wave13-paper | toolkit/wave13/tools/StockDilutionWater.jsx | ok |
| 1345 | Headbox Flow & Slice | wave13-paper | toolkit/wave13/tools/HeadboxFlowSlice.jsx | ok |
| 1346 | Wire Drainage & Couch | wave13-paper | toolkit/wave13/tools/WireDrainage.jsx | ok |
| 1347 | Press & Dryer Evaporation | wave13-paper | toolkit/wave13/tools/PressDryingLoad.jsx | ok |
| 1348 | Reel Trim & Offcut | wave13-paper | toolkit/wave13/tools/ReelTrimWaste.jsx | ok |
| 1349 | Basis Weight & Ream | wave13-paper | toolkit/wave13/tools/BasisWeightReam.jsx | ok |
| 1350 | Coating Colour Demand | wave13-paper | toolkit/wave13/tools/CoatingColourDemand.jsx | ok |
| 1351 | Machine Output & Efficiency | wave13-paper | toolkit/wave13/tools/MachineOutput.jsx | ok |
| 1352 | Sugar Boiling & Concentration | wave13-confectionery | toolkit/wave13/tools/SugarBoilConcentration.jsx | ok |
| 1353 | Invert Sugar & Acid Dose | wave13-confectionery | toolkit/wave13/tools/InvertSugarDose.jsx | ok |
| 1354 | Moulded Shell Mass | wave13-confectionery | toolkit/wave13/tools/MouldShellMass.jsx | ok |
| 1355 | Hard Candy Batch | wave13-confectionery | toolkit/wave13/tools/HardCandyBatch.jsx | ok |
| 1356 | Gummy Batch Formula | wave13-confectionery | toolkit/wave13/tools/GummyBatchFormula.jsx | ok |
| 1357 | Panning Syrup & Coats | wave13-confectionery | toolkit/wave13/tools/PanningCoats.jsx | ok |
| 1358 | Depositing Throughput | wave13-confectionery | toolkit/wave13/tools/DepositingThroughput.jsx | ok |
| 1359 | Chocolate Fat Balance | wave13-confectionery | toolkit/wave13/tools/ChocolateFatBalance.jsx | ok |
| 1360 | Sugar-Free Conversion | wave13-confectionery | toolkit/wave13/tools/SugarFreeConversion.jsx | ok |
| 1361 | Recipe Cost & Margin | wave13-confectionery | toolkit/wave13/tools/ConfectionCostYield.jsx | ok |
| 1362 | Hide Area & Yield | wave13-leather | toolkit/wave13/tools/HideAreaYield.jsx | ok |
| 1363 | Chromium Uptake & Offer | wave13-leather | toolkit/wave13/tools/ChromeUptake.jsx | ok |
| 1364 | Drum Float Ratio | wave13-leather | toolkit/wave13/tools/FloatRatioDrum.jsx | ok |
| 1365 | Basification & Alkalinity | wave13-leather | toolkit/wave13/tools/BasificationDose.jsx | ok |
| 1366 | Shaving Throughput & Blades | wave13-leather | toolkit/wave13/tools/ShavingThroughput.jsx | ok |
| 1367 | Dye Exhaustion | wave13-leather | toolkit/wave13/tools/DyeExhaustion.jsx | ok |
| 1368 | Fatliquor Offer | wave13-leather | toolkit/wave13/tools/FatliquorOffer.jsx | ok |
| 1369 | Drying Shrinkage & Area | wave13-leather | toolkit/wave13/tools/CrustAreaShrinkage.jsx | ok |
| 1370 | Cost per Square Foot | wave13-leather | toolkit/wave13/tools/LeatherCostArea.jsx | ok |
| 1371 | Water Use & Effluent Load | wave13-leather | toolkit/wave13/tools/TanneryWaterLoad.jsx | ok |
| 1372 | Truss Capacity & Utilisation | wave13-rigging | toolkit/wave13/tools/TrussCapacityCheck.jsx | ok |
| 1373 | Hoist Capacity per Point | wave13-rigging | toolkit/wave13/tools/HoistCapacityPoint.jsx | ok |
| 1374 | Bridle & Sling Tension | wave13-rigging | toolkit/wave13/tools/BridleTension.jsx | ok |
| 1375 | Ground Support Ballast | wave13-rigging | toolkit/wave13/tools/GroundSupportBallast.jsx | ok |
| 1376 | Safe Wind Speed Limit | wave13-rigging | toolkit/wave13/tools/WindLoadLimit.jsx | ok |
| 1377 | Crowd Barrier Load | wave13-rigging | toolkit/wave13/tools/CrowdBarrierLoad.jsx | ok |
| 1378 | Load-in Duration | wave13-rigging | toolkit/wave13/tools/LoadInDuration.jsx | ok |
| 1379 | Truck Pack & Cases | wave13-rigging | toolkit/wave13/tools/TruckPackCases.jsx | ok |
| 1380 | Counterweight Arbor | wave13-rigging | toolkit/wave13/tools/CounterweightArbor.jsx | ok |
| 1381 | Sling Angle Derating | wave13-rigging | toolkit/wave13/tools/SlingAngleDerate.jsx | ok |
| 1382 | Lift Charge & Muzzle Velocity | wave13-pyro | toolkit/wave13/tools/LiftChargeVelocity.jsx | ok |
| 1383 | Burst Charge & Break | wave13-pyro | toolkit/wave13/tools/BurstChargeFill.jsx | ok |
| 1384 | Mortar Pressure Estimate | wave13-pyro | toolkit/wave13/tools/MortarPeakPressure.jsx | ok |
| 1385 | Audience Separation Distance | wave13-pyro | toolkit/wave13/tools/AudienceStandoff.jsx | ok |
| 1386 | Mortar Rack Spacing | wave13-pyro | toolkit/wave13/tools/MortarRackSpacing.jsx | ok |
| 1387 | Cake Timing & Duration | wave13-pyro | toolkit/wave13/tools/CakeDuration.jsx | ok |
| 1388 | Firing Circuit & Voltage | wave13-pyro | toolkit/wave13/tools/FiringCircuitVoltage.jsx | ok |
| 1389 | Haze Fill & Clearance Time | wave13-pyro | toolkit/wave13/tools/HazeFillClearance.jsx | ok |
| 1390 | Confetti Coverage & Hang Time | wave13-pyro | toolkit/wave13/tools/ConfettiCoverage.jsx | ok |
| 1391 | Magazine & Net Explosive Quantity | wave13-pyro | toolkit/wave13/tools/MagazineQuantityLimits.jsx | ok |
| 1392 | Mesh Selectivity & L50 | wave13-fisheries | toolkit/wave13/tools/MeshSelectivityL50.jsx | ok |
| 1393 | Stock Surplus Production | wave13-fisheries | toolkit/wave13/tools/SurplusProduction.jsx | ok |
| 1394 | Fishing Mortality & Exploitation | wave13-fisheries | toolkit/wave13/tools/FishingMortality.jsx | ok |
| 1395 | Quota & Effort Allocation | wave13-fisheries | toolkit/wave13/tools/QuotaEffortAllocation.jsx | ok |
| 1396 | Feed Conversion & Growth | wave13-fisheries | toolkit/wave13/tools/FeedConversionRatio.jsx | ok |
| 1397 | Cage Biomass & Oxygen | wave13-fisheries | toolkit/wave13/tools/CageOxygenDemand.jsx | ok |
| 1398 | Sea Lice Counting & Threshold | wave13-fisheries | toolkit/wave13/tools/SeaLiceThreshold.jsx | ok |
| 1399 | Tag Recapture Estimate | wave13-fisheries | toolkit/wave13/tools/TagRecaptureEstimate.jsx | ok |
| 1400 | Growth & Length at Age | wave13-fisheries | toolkit/wave13/tools/VonbertalanffyGrowth.jsx | ok |
| 1401 | Bycatch & Discard Ratio | wave13-fisheries | toolkit/wave13/tools/BycatchRatio.jsx | ok |
| 1402 | Baker’s Percentage & Formula | wave14-bakery | toolkit/wave14/tools/BakersPercentage.jsx | ok |
| 1403 | Hydration & Flour Absorption | wave14-bakery | toolkit/wave14/tools/HydrationAdjustment.jsx | ok |
| 1404 | Desired Dough Temperature | wave14-bakery | toolkit/wave14/tools/DoughTemperature.jsx | ok |
| 1405 | Dough Yield & Scaling | wave14-bakery | toolkit/wave14/tools/DoughYieldScaling.jsx | ok |
| 1406 | Proof Time & Temperature | wave14-bakery | toolkit/wave14/tools/ProofTimeTemperature.jsx | ok |
| 1407 | Yeast & Preferment Inoculation | wave14-bakery | toolkit/wave14/tools/YeastInoculation.jsx | ok |
| 1408 | Salt Percentage & Sodium | wave14-bakery | toolkit/wave14/tools/SaltPercentage.jsx | ok |
| 1409 | Oven Spring & Loaf Volume | wave14-bakery | toolkit/wave14/tools/OvenSpringVolume.jsx | ok |
| 1410 | Bake Loss & Yield | wave14-bakery | toolkit/wave14/tools/BakeLossYield.jsx | ok |
| 1411 | Bread Cost & Margin | wave14-bakery | toolkit/wave14/tools/BreadCostLoaf.jsx | ok |
| 1412 | Roast Loss & Yield | wave14-coffee | toolkit/wave14/tools/RoastLossYield.jsx | ok |
| 1413 | Development Time Ratio | wave14-coffee | toolkit/wave14/tools/DevelopmentTimeRatio.jsx | ok |
| 1414 | Rate of Rise & Finish | wave14-coffee | toolkit/wave14/tools/RateOfRise.jsx | ok |
| 1415 | Batch Scaling & Roast Time | wave14-coffee | toolkit/wave14/tools/BatchScalingRoast.jsx | ok |
| 1416 | Brew Ratio & Strength | wave14-coffee | toolkit/wave14/tools/BrewRatioStrength.jsx | ok |
| 1417 | Espresso Recipe & Yield | wave14-coffee | toolkit/wave14/tools/EspressoRecipe.jsx | ok |
| 1418 | Extraction Yield Check | wave14-coffee | toolkit/wave14/tools/ExtractionYieldCheck.jsx | ok |
| 1419 | Brew Water Minerals | wave14-coffee | toolkit/wave14/tools/BrewWaterMinerals.jsx | ok |
| 1420 | Roast Energy & Cost | wave14-coffee | toolkit/wave14/tools/RoastEnergyCost.jsx | ok |
| 1421 | Café Batch Plan | wave14-coffee | toolkit/wave14/tools/CafeBatchPlan.jsx | ok |
| 1422 | Substrate Moisture & Water | wave14-mushroom | toolkit/wave14/tools/SubstrateHydration.jsx | ok |
| 1423 | Biological Efficiency & Yield | wave14-mushroom | toolkit/wave14/tools/BiologicalEfficiency.jsx | ok |
| 1424 | Spawn Rate & Inoculation | wave14-mushroom | toolkit/wave14/tools/SpawnRateDose.jsx | ok |
| 1425 | Pasteurisation Lethality | wave14-mushroom | toolkit/wave14/tools/PasteurisationLethality.jsx | ok |
| 1426 | Bag & Bed Fill Count | wave14-mushroom | toolkit/wave14/tools/BagFillCount.jsx | ok |
| 1427 | Flush & Crop Projection | wave14-mushroom | toolkit/wave14/tools/FlushCropProjection.jsx | ok |
| 1428 | Cropping Room Airflow | wave14-mushroom | toolkit/wave14/tools/CropRoomAirflow.jsx | ok |
| 1429 | CO₂ Generation & Ventilation | wave14-mushroom | toolkit/wave14/tools/Co2GenerationVentilation.jsx | ok |
| 1430 | Spawn Grain Plan | wave14-mushroom | toolkit/wave14/tools/SpawnGrainPlan.jsx | ok |
| 1431 | Grow Cost & Revenue | wave14-mushroom | toolkit/wave14/tools/GrowCostRevenue.jsx | ok |
| 1432 | Arrow Kinetic Energy & Momentum | wave14-archery | toolkit/wave14/tools/ArrowKineticEnergy.jsx | ok |
| 1433 | Arrow FOC & Balance | wave14-archery | toolkit/wave14/tools/FocBalancePoint.jsx | ok |
| 1434 | Arrow Weight Build-Up | wave14-archery | toolkit/wave14/tools/ArrowWeightBuild.jsx | ok |
| 1435 | Speed Estimate from IBO | wave14-archery | toolkit/wave14/tools/SpeedIboEstimate.jsx | ok |
| 1436 | Trajectory Drop & Sight Marks | wave14-archery | toolkit/wave14/tools/TrajectoryDropSight.jsx | ok |
| 1437 | Spine Chart Estimate | wave14-archery | toolkit/wave14/tools/SpineChartEstimate.jsx | ok |
| 1438 | Draw Length & Arrow Length | wave14-archery | toolkit/wave14/tools/DrawLengthFit.jsx | ok |
| 1439 | String Length & Brace Height | wave14-archery | toolkit/wave14/tools/BowStringLength.jsx | ok |
| 1440 | Bow Energy Efficiency | wave14-archery | toolkit/wave14/tools/BowEnergyEfficiency.jsx | ok |
| 1441 | Grains Per Pound Setup | wave14-archery | toolkit/wave14/tools/ArrowGppSetup.jsx | ok |
| 1442 | Rate of Spread (Screening) | wave14-wildfire | toolkit/wave14/tools/RateOfSpread.jsx | ok |
| 1443 | Fireline Intensity & Flame Length | wave14-wildfire | toolkit/wave14/tools/FirelineIntensity.jsx | ok |
| 1444 | Safety Zone Sizing | wave14-wildfire | toolkit/wave14/tools/SafetyZoneSizing.jsx | ok |
| 1445 | Crown Fire Initiation | wave14-wildfire | toolkit/wave14/tools/CrownFireThreshold.jsx | ok |
| 1446 | Containment & Line Production | wave14-wildfire | toolkit/wave14/tools/ContainmentLineTime.jsx | ok |
| 1447 | Aerial Drop Coverage | wave14-wildfire | toolkit/wave14/tools/AerialDropCoverage.jsx | ok |
| 1448 | Fine Fuel Moisture & Drying | wave14-wildfire | toolkit/wave14/tools/FuelMoistureDrying.jsx | ok |
| 1449 | Spotting Distance Estimate | wave14-wildfire | toolkit/wave14/tools/SpottingDistanceEstimate.jsx | ok |
| 1450 | Evacuation Time & Road Capacity | wave14-wildfire | toolkit/wave14/tools/EvacuationRoadTime.jsx | ok |
| 1451 | Burn Area & Perimeter Growth | wave14-wildfire | toolkit/wave14/tools/BurnAreaPerimeter.jsx | ok |
| 1452 | Flight Time & Endurance | wave14-drone | toolkit/wave14/tools/FlightTimeEndurance.jsx | ok |
| 1453 | Range & Wind Allowance | wave14-drone | toolkit/wave14/tools/RangeWindAllowance.jsx | ok |
| 1454 | Wind Triangle & Track | wave14-drone | toolkit/wave14/tools/WindTriangleTrack.jsx | ok |
| 1455 | Mapping GSD & Coverage | wave14-drone | toolkit/wave14/tools/MappingGsdCoverage.jsx | ok |
| 1456 | Mapping Mission Plan | wave14-drone | toolkit/wave14/tools/MappingMissionPlan.jsx | ok |
| 1457 | Payload & MTOW | wave14-drone | toolkit/wave14/tools/PayloadMtow.jsx | ok |
| 1458 | Battery C-Rate & Discharge | wave14-drone | toolkit/wave14/tools/BatteryCRate.jsx | ok |
| 1459 | Rotor Disk Loading & Thrust | wave14-drone | toolkit/wave14/tools/DiskLoadingThrust.jsx | ok |
| 1460 | Hover Power & Current | wave14-drone | toolkit/wave14/tools/HoverPowerModel.jsx | ok |
| 1461 | Centre of Gravity & Balance | wave14-drone | toolkit/wave14/tools/CgBalanceMoments.jsx | ok |
| 1462 | Fibre Link Budget | wave14-fibre | toolkit/wave14/tools/LinkBudgetLoss.jsx | ok |
| 1463 | Attenuation & Reach | wave14-fibre | toolkit/wave14/tools/AttenuationReach.jsx | ok |
| 1464 | OTDR Distance & Events | wave14-fibre | toolkit/wave14/tools/OtdrDistance.jsx | ok |
| 1465 | Splice & Connector Budget | wave14-fibre | toolkit/wave14/tools/SpliceConnectorBudget.jsx | ok |
| 1466 | Chromatic Dispersion & Reach | wave14-fibre | toolkit/wave14/tools/ChromaticDispersion.jsx | ok |
| 1467 | DWDM Channel Plan | wave14-fibre | toolkit/wave14/tools/DwdmChannelPlan.jsx | ok |
| 1468 | PON Split & Power Budget | wave14-fibre | toolkit/wave14/tools/PonPowerBudget.jsx | ok |
| 1469 | Cable Size & Spares | wave14-fibre | toolkit/wave14/tools/FibreCountSizing.jsx | ok |
| 1470 | Bend Radius & Handling | wave14-fibre | toolkit/wave14/tools/BendRadiusCheck.jsx | ok |
| 1471 | Latency & Round Trip | wave14-fibre | toolkit/wave14/tools/LatencyRoundTrip.jsx | ok |
| 1472 | Shrinkage Allowance & Pattern | wave14-foundry | toolkit/wave14/tools/PatternShrinkAllowance.jsx | ok |
| 1473 | Riser Sizing by Modulus | wave14-foundry | toolkit/wave14/tools/RiserSizingModulus.jsx | ok |
| 1474 | Solidification Time | wave14-foundry | toolkit/wave14/tools/SolidificationChvorinov.jsx | ok |
| 1475 | Gating & Choke Area | wave14-foundry | toolkit/wave14/tools/GatingChokeArea.jsx | ok |
| 1476 | Pouring Time & Rate | wave14-foundry | toolkit/wave14/tools/PouringTimeRate.jsx | ok |
| 1477 | Casting Yield & Metal Loss | wave14-foundry | toolkit/wave14/tools/CastingYieldRatio.jsx | ok |
| 1478 | Melt Energy & Cost | wave14-foundry | toolkit/wave14/tools/MeltEnergyCost.jsx | ok |
| 1479 | Moulding Sand Demand | wave14-foundry | toolkit/wave14/tools/MouldingSandDemand.jsx | ok |
| 1480 | Cooling & Shakeout | wave14-foundry | toolkit/wave14/tools/CoolingShakeoutTime.jsx | ok |
| 1481 | Wall Thickness & Fluidity | wave14-foundry | toolkit/wave14/tools/FluidityWallThickness.jsx | ok |
| 1482 | Liquor Ratio & Leaf Dose | wave15-tea | toolkit/wave15/tools/TeaLiquorRatio.jsx | ok |
| 1483 | Steep Temperature & Extraction | wave15-tea | toolkit/wave15/tools/TeaSteepExtraction.jsx | ok |
| 1484 | Caffeine Per Cup | wave15-tea | toolkit/wave15/tools/TeaCaffeinePerCup.jsx | ok |
| 1485 | Gongfu Session Plan | wave15-tea | toolkit/wave15/tools/TeaGongfuSession.jsx | ok |
| 1486 | Decaffeination & Caffeine Left | wave15-tea | toolkit/wave15/tools/TeaCaffeineDecafLoss.jsx | ok |
| 1487 | Wither & Oxidation Loss | wave15-tea | toolkit/wave15/tools/TeaOxidationWither.jsx | ok |
| 1488 | Blend Cost Per Kilogram | wave15-tea | toolkit/wave15/tools/TeaBlendCost.jsx | ok |
| 1489 | Water Mineral Balance | wave15-tea | toolkit/wave15/tools/TeaWaterMineral.jsx | ok |
| 1490 | Leaf Grade Distribution | wave15-tea | toolkit/wave15/tools/TeaLeafGradeSort.jsx | ok |
| 1491 | Astringency & Steep Time | wave15-tea | toolkit/wave15/tools/TeaTanninTime.jsx | ok |
| 1492 | PAR, DLI & Mounting Height | wave15-reef | toolkit/wave15/tools/ReefParDli.jsx | ok |
| 1493 | Alkalinity & Two-Part Dose | wave15-reef | toolkit/wave15/tools/ReefAlkalinityDose.jsx | ok |
| 1494 | Calcium & Carbonate Demand | wave15-reef | toolkit/wave15/tools/ReefCalciumUptake.jsx | ok |
| 1495 | Magnesium Balance | wave15-reef | toolkit/wave15/tools/ReefMagnesiumBalance.jsx | ok |
| 1496 | Salinity & Salt Mix | wave15-reef | toolkit/wave15/tools/ReefSalinityMix.jsx | ok |
| 1497 | Water Change & Nutrient Dilution | wave15-reef | toolkit/wave15/tools/ReefWaterChangeNutrient.jsx | ok |
| 1498 | Kalkwasser Top-Off | wave15-reef | toolkit/wave15/tools/ReefKalkwasserTopoff.jsx | ok |
| 1499 | Flow & Turnover | wave15-reef | toolkit/wave15/tools/ReefFlowTurnover.jsx | ok |
| 1500 | Heater Sizing & Warm-Up | wave15-reef | toolkit/wave15/tools/ReefHeaterWattage.jsx | ok |
| 1501 | Phosphate Removal & Media | wave15-reef | toolkit/wave15/tools/ReefPhosphateGfo.jsx | ok |
| 1502 | Print Time Estimate | wave15-additive | toolkit/wave15/tools/AmPrintTime.jsx | ok |
| 1503 | Filament & Part Cost | wave15-additive | toolkit/wave15/tools/AmFilamentCost.jsx | ok |
| 1504 | Flow Rate & E-Step Calibration | wave15-additive | toolkit/wave15/tools/AmFlowCalibration.jsx | ok |
| 1505 | Extrusion Volume & Line Width | wave15-additive | toolkit/wave15/tools/AmExtrusionVolume.jsx | ok |
| 1506 | Shrinkage Compensation | wave15-additive | toolkit/wave15/tools/AmShrinkageCompensation.jsx | ok |
| 1507 | Infill & Effective Strength | wave15-additive | toolkit/wave15/tools/AmInfillStrength.jsx | ok |
| 1508 | Resin Exposure & Layer Time | wave15-additive | toolkit/wave15/tools/AmResinExposure.jsx | ok |
| 1509 | Support Material & Waste | wave15-additive | toolkit/wave15/tools/AmSupportMaterial.jsx | ok |
| 1510 | Build Plate Nesting | wave15-additive | toolkit/wave15/tools/AmBuildPlateNesting.jsx | ok |
| 1511 | Layer Time & Part Cooling | wave15-additive | toolkit/wave15/tools/AmCoolingLayerTime.jsx | ok |
| 1512 | Gear Ratio & Development | wave15-bicycle | toolkit/wave15/tools/BikeGearRatio.jsx | ok |
| 1513 | Cadence, Gear & Speed | wave15-bicycle | toolkit/wave15/tools/BikeCadenceSpeed.jsx | ok |
| 1514 | Chain Wear & Replacement | wave15-bicycle | toolkit/wave15/tools/BikeChainWear.jsx | ok |
| 1515 | Tyre Pressure & Contact Patch | wave15-bicycle | toolkit/wave15/tools/BikeTyrePressure.jsx | ok |
| 1516 | Wheel Build Tension | wave15-bicycle | toolkit/wave15/tools/BikeWheelTension.jsx | ok |
| 1517 | Braking Distance & Grip | wave15-bicycle | toolkit/wave15/tools/BikeBrakingDistance.jsx | ok |
| 1518 | Climb Power & W per kg | wave15-bicycle | toolkit/wave15/tools/BikeClimbPower.jsx | ok |
| 1519 | E-Bike Range & Assist | wave15-bicycle | toolkit/wave15/tools/BikeEbikeRange.jsx | ok |
| 1520 | Frame Stack, Reach & Fit | wave15-bicycle | toolkit/wave15/tools/BikeFrameFit.jsx | ok |
| 1521 | Suspension Sag & Spring Rate | wave15-bicycle | toolkit/wave15/tools/BikeSuspensionSag.jsx | ok |
| 1522 | Slope Angle & Terrain | wave15-avalanche | toolkit/wave15/tools/AvalancheSlopeAngle.jsx | ok |
| 1523 | New Snow Load & Stress | wave15-avalanche | toolkit/wave15/tools/AvalancheSnowLoad.jsx | ok |
| 1524 | Snow Water Equivalent | wave15-avalanche | toolkit/wave15/tools/AvalancheSweWater.jsx | ok |
| 1525 | Skier Stress on a Layer | wave15-avalanche | toolkit/wave15/tools/AvalancheSkierStress.jsx | ok |
| 1526 | Runout & Alpha Angle | wave15-avalanche | toolkit/wave15/tools/AvalancheRunoutDistance.jsx | ok |
| 1527 | Beacon Search Time | wave15-avalanche | toolkit/wave15/tools/AvalancheBeaconSearch.jsx | ok |
| 1528 | Temperature Gradient & Faceting | wave15-avalanche | toolkit/wave15/tools/AvalancheTempGradient.jsx | ok |
| 1529 | Stability Index & Test Result | wave15-avalanche | toolkit/wave15/tools/AvalancheStabilityIndex.jsx | ok |
| 1530 | Ascent Time & Turnaround | wave15-avalanche | toolkit/wave15/tools/AvalancheTravelTime.jsx | ok |
| 1531 | Solar Loading on Slopes | wave15-avalanche | toolkit/wave15/tools/AvalancheSolarLoad.jsx | ok |
| 1532 | Local Anaesthetic Dose | wave15-dental | toolkit/wave15/tools/DentalLaDose.jsx | ok |
| 1533 | Fluoride Varnish Dose | wave15-dental | toolkit/wave15/tools/DentalFluorideVarnish.jsx | ok |
| 1534 | Alginate Impression Mix | wave15-dental | toolkit/wave15/tools/DentalAlginateMix.jsx | ok |
| 1535 | Composite & Curing Increment | wave15-dental | toolkit/wave15/tools/DentalCompositeIncrement.jsx | ok |
| 1536 | Crown Preparation & Reduction | wave15-dental | toolkit/wave15/tools/DentalCrownPrep.jsx | ok |
| 1537 | Radiograph Exposure & ALARA | wave15-dental | toolkit/wave15/tools/DentalRadiographExposure.jsx | ok |
| 1538 | Implant Torque & Insertion | wave15-dental | toolkit/wave15/tools/DentalImplantTorque.jsx | ok |
| 1539 | Orthodontic Force & Wire | wave15-dental | toolkit/wave15/tools/DentalOrthoForce.jsx | ok |
| 1540 | Whitening Gel & Dose | wave15-dental | toolkit/wave15/tools/DentalWhiteningGel.jsx | ok |
| 1541 | Plaque & Gingival Index | wave15-dental | toolkit/wave15/tools/DentalPlaqueIndex.jsx | ok |
| 1542 | Accord Ratio and Pyramid | wave15-fragrance | toolkit/wave15/tools/FragranceAccordRatio.jsx | ok |
| 1543 | Dilution & Concentration | wave15-fragrance | toolkit/wave15/tools/FragranceDilution.jsx | ok |
| 1544 | Cost Per Bottle | wave15-fragrance | toolkit/wave15/tools/FragranceCostPerBottle.jsx | ok |
| 1545 | Alcohol Strength & Proof | wave15-fragrance | toolkit/wave15/tools/FragranceAlcoholStrength.jsx | ok |
| 1546 | Essential Oil Yield | wave15-fragrance | toolkit/wave15/tools/FragranceOilYield.jsx | ok |
| 1547 | Evaporation & Longevity | wave15-fragrance | toolkit/wave15/tools/FragranceEvaporationCurve.jsx | ok |
| 1548 | IFRA Limit & Dosage | wave15-fragrance | toolkit/wave15/tools/FragranceIfraLimit.jsx | ok |
| 1549 | Maceration & Maturation | wave15-fragrance | toolkit/wave15/tools/FragranceMaturationTime.jsx | ok |
| 1550 | Fill Run & Bottles | wave15-fragrance | toolkit/wave15/tools/FragranceFillRun.jsx | ok |
| 1551 | Sillage & Spray Count | wave15-fragrance | toolkit/wave15/tools/FragranceSillageSpray.jsx | ok |
| 1552 | Sprayer Calibration | wave15-pest | toolkit/wave15/tools/PestSprayerCalibration.jsx | ok |
| 1553 | Pesticide Dilution & Tank Mix | wave15-pest | toolkit/wave15/tools/PestPesticideDilution.jsx | ok |
| 1554 | Application Rate & Coverage | wave15-pest | toolkit/wave15/tools/PestApplicationRate.jsx | ok |
| 1555 | Mosquito Indices | wave15-pest | toolkit/wave15/tools/PestMosquitoIndex.jsx | ok |
| 1556 | IPM Action Threshold | wave15-pest | toolkit/wave15/tools/PestIpmThreshold.jsx | ok |
| 1557 | Fumigation Dose & Volume | wave15-pest | toolkit/wave15/tools/PestFumigationDose.jsx | ok |
| 1558 | Trap Density & Catch Rate | wave15-pest | toolkit/wave15/tools/PestTrapDensity.jsx | ok |
| 1559 | Biological Control Release | wave15-pest | toolkit/wave15/tools/PestBiologicalRelease.jsx | ok |
| 1560 | Resistance Frequency | wave15-pest | toolkit/wave15/tools/PestResistanceFrequency.jsx | ok |
| 1561 | Rodent Bait & Placement | wave15-pest | toolkit/wave15/tools/PestBaitPlacement.jsx | ok |
| 1562 | Fall Factor & Impact Force | wave16-climbing | toolkit/wave16/tools/ClimbFallFactor.jsx | ok |
| 1563 | Impact Force & Belay | wave16-climbing | toolkit/wave16/tools/ClimbImpactForce.jsx | ok |
| 1564 | Anchor Load Sharing | wave16-climbing | toolkit/wave16/tools/ClimbAnchorVector.jsx | ok |
| 1565 | Rope Stretch Under Load | wave16-climbing | toolkit/wave16/tools/ClimbRopeStretch.jsx | ok |
| 1566 | Hauling & Mechanical Advantage | wave16-climbing | toolkit/wave16/tools/ClimbHaulSystem.jsx | ok |
| 1567 | Rappel Descent Plan | wave16-climbing | toolkit/wave16/tools/ClimbRappelDescent.jsx | ok |
| 1568 | Route Time & Turnaround | wave16-climbing | toolkit/wave16/tools/ClimbRouteTime.jsx | ok |
| 1569 | Belay Friction & Brake Force | wave16-climbing | toolkit/wave16/tools/ClimbBelayFriction.jsx | ok |
| 1570 | Bolt & Protection Loads | wave16-climbing | toolkit/wave16/tools/ClimbBoltLoad.jsx | ok |
| 1571 | Crimp & Finger Load | wave16-climbing | toolkit/wave16/tools/ClimbFingerLoad.jsx | ok |
| 1572 | Fly Line Weight & Rod Match | wave16-angling | toolkit/wave16/tools/AnglingFlightLineWeight.jsx | ok |
| 1573 | Tippet Strength & Drag | wave16-angling | toolkit/wave16/tools/AnglingTippetBreaking.jsx | ok |
| 1574 | Fish Weight from Length | wave16-angling | toolkit/wave16/tools/AnglingFishWeightLength.jsx | ok |
| 1575 | Cast Distance & Line Speed | wave16-angling | toolkit/wave16/tools/AnglingCastDistance.jsx | ok |
| 1576 | Hook Set & Rod Load | wave16-angling | toolkit/wave16/tools/AnglingHookSetForce.jsx | ok |
| 1577 | Trolling Depth & Sink Rate | wave16-angling | toolkit/wave16/tools/AnglingTrollingDepth.jsx | ok |
| 1578 | Leader Formula | wave16-angling | toolkit/wave16/tools/AnglingLeaderFormula.jsx | ok |
| 1579 | Catch Rate & Effort | wave16-angling | toolkit/wave16/tools/AnglingCatchRate.jsx | ok |
| 1580 | Berley & Bait Dispersal | wave16-angling | toolkit/wave16/tools/AnglingBaitDispersal.jsx | ok |
| 1581 | Knot Strength & Loss | wave16-angling | toolkit/wave16/tools/AnglingKnotStrength.jsx | ok |
| 1582 | Array Output & Yield | wave16-solar | toolkit/wave16/tools/SolarArrayOutput.jsx | ok |
| 1583 | String Voltage & Temperature | wave16-solar | toolkit/wave16/tools/SolarStringVoltage.jsx | ok |
| 1584 | Battery Bank Sizing | wave16-solar | toolkit/wave16/tools/SolarBatteryBank.jsx | ok |
| 1585 | Inverter Sizing | wave16-solar | toolkit/wave16/tools/SolarInverterSizing.jsx | ok |
| 1586 | Tilt, Azimuth & Yield | wave16-solar | toolkit/wave16/tools/SolarTiltYield.jsx | ok |
| 1587 | Payback & Levelised Cost | wave16-solar | toolkit/wave16/tools/SolarSystemPayback.jsx | ok |
| 1588 | Cable Voltage Drop | wave16-solar | toolkit/wave16/tools/SolarCableVoltageDrop.jsx | ok |
| 1589 | Roof Layout & Capacity | wave16-solar | toolkit/wave16/tools/SolarRoofLayout.jsx | ok |
| 1590 | Shading & Energy Loss | wave16-solar | toolkit/wave16/tools/SolarShadingLoss.jsx | ok |
| 1591 | Off-Grid System Sizing | wave16-solar | toolkit/wave16/tools/SolarOffgridSizing.jsx | ok |
| 1592 | Emulsion HLB Balance | wave16-cosmetic | toolkit/wave16/tools/CosmeticEmulsionHlb.jsx | ok |
| 1593 | Preservative Dose | wave16-cosmetic | toolkit/wave16/tools/CosmeticPreservativeDose.jsx | ok |
| 1594 | Batch Scaling | wave16-cosmetic | toolkit/wave16/tools/CosmeticBatchScaling.jsx | ok |
| 1595 | pH Adjustment | wave16-cosmetic | toolkit/wave16/tools/CosmeticPhAdjust.jsx | ok |
| 1596 | SPF & UV Filter Load | wave16-cosmetic | toolkit/wave16/tools/CosmeticSpfEstimate.jsx | ok |
| 1597 | Cost Per Unit | wave16-cosmetic | toolkit/wave16/tools/CosmeticCostPerUnit.jsx | ok |
| 1598 | Preservative Challenge Test | wave16-cosmetic | toolkit/wave16/tools/CosmeticChallengeTest.jsx | ok |
| 1599 | Active Dilution | wave16-cosmetic | toolkit/wave16/tools/CosmeticActiveDilution.jsx | ok |
| 1600 | UV Filter Regulatory Limit | wave16-cosmetic | toolkit/wave16/tools/CosmeticUvFilterLimit.jsx | ok |
| 1601 | Thickener & Viscosity | wave16-cosmetic | toolkit/wave16/tools/CosmeticTextureViscosity.jsx | ok |
| 1602 | One Rep Max Estimate | wave16-strength | toolkit/wave16/tools/StrengthOneRepMax.jsx | ok |
| 1603 | Training Loads & Percentages | wave16-strength | toolkit/wave16/tools/StrengthTrainingLoads.jsx | ok |
| 1604 | Barbell Plate Loading | wave16-strength | toolkit/wave16/tools/StrengthPlateLoading.jsx | ok |
| 1605 | Volume Load & Tonnage | wave16-strength | toolkit/wave16/tools/StrengthVolumeLoad.jsx | ok |
| 1606 | Progression Plan | wave16-strength | toolkit/wave16/tools/StrengthProgressionPlan.jsx | ok |
| 1607 | Body Composition Target | wave16-strength | toolkit/wave16/tools/StrengthBodyComposition.jsx | ok |
| 1608 | Energy & Macros | wave16-strength | toolkit/wave16/tools/StrengthEnergyIntake.jsx | ok |
| 1609 | Strength to Bodyweight | wave16-strength | toolkit/wave16/tools/StrengthBodyweightRatio.jsx | ok |
| 1610 | Warm-Up Ramp | wave16-strength | toolkit/wave16/tools/StrengthWarmupRamp.jsx | ok |
| 1611 | Rest Interval & Density | wave16-strength | toolkit/wave16/tools/StrengthRestInterval.jsx | ok |
| 1612 | Lye Calculator | wave16-soap | toolkit/wave16/tools/SoapLyeCalculator.jsx | ok |
| 1613 | Superfat Balance | wave16-soap | toolkit/wave16/tools/SoapSuperfatBalance.jsx | ok |
| 1614 | Water Discount & Trace | wave16-soap | toolkit/wave16/tools/SoapWaterDiscount.jsx | ok |
| 1615 | Soap Batch Scaling | wave16-soap | toolkit/wave16/tools/SoapBatchScaling.jsx | ok |
| 1616 | Cure Time & Water Loss | wave16-soap | toolkit/wave16/tools/SoapCureTime.jsx | ok |
| 1617 | Wick Sizing | wave16-soap | toolkit/wave16/tools/CandleWickSizing.jsx | ok |
| 1618 | Burn Time & Wax Use | wave16-soap | toolkit/wave16/tools/CandleBurnTime.jsx | ok |
| 1619 | Fragrance Load | wave16-soap | toolkit/wave16/tools/CandleFragranceLoad.jsx | ok |
| 1620 | Mould Volume & Pour | wave16-soap | toolkit/wave16/tools/CandleMouldVolume.jsx | ok |
| 1621 | Batch Cost Per Unit | wave16-soap | toolkit/wave16/tools/SoapCandleCost.jsx | ok |
| 1622 | Bevel Angle & Geometry | wave16-blade | toolkit/wave16/tools/BladeBevelAngle.jsx | ok |
| 1623 | Blade Mass & Balance | wave16-blade | toolkit/wave16/tools/BladeMassEstimate.jsx | ok |
| 1624 | Forge Yield & Loss | wave16-blade | toolkit/wave16/tools/BladeForgeYield.jsx | ok |
| 1625 | Heat Treatment Soak | wave16-blade | toolkit/wave16/tools/BladeHeatSoak.jsx | ok |
| 1626 | Grinding Time & Belts | wave16-blade | toolkit/wave16/tools/BladeGrindTime.jsx | ok |
| 1627 | Handle & Balance | wave16-blade | toolkit/wave16/tools/BladeHandleBalance.jsx | ok |
| 1628 | Edge Geometry & Sharpening | wave16-blade | toolkit/wave16/tools/BladeEdgeGeometry.jsx | ok |
| 1629 | Batch Time & Throughput | wave16-blade | toolkit/wave16/tools/BladeBatchTime.jsx | ok |
| 1630 | Sheath Fit & Leather | wave16-blade | toolkit/wave16/tools/BladeSheathFit.jsx | ok |
| 1631 | Knife Costing & Price | wave16-blade | toolkit/wave16/tools/BladeCosting.jsx | ok |
| 1632 | Saturation Flow | wave16-traffic | toolkit/wave16/tools/TrafficSaturationFlow.jsx | ok |
| 1633 | Degree of Saturation | wave16-traffic | toolkit/wave16/tools/TrafficDegreeSaturation.jsx | ok |
| 1634 | Webster Cycle Length | wave16-traffic | toolkit/wave16/tools/TrafficWebsterCycle.jsx | ok |
| 1635 | Green Split & Timing | wave16-traffic | toolkit/wave16/tools/TrafficGreenSplit.jsx | ok |
| 1636 | Junction Delay & Level of Service | wave16-traffic | toolkit/wave16/tools/TrafficJunctionDelay.jsx | ok |
| 1637 | Queue Length | wave16-traffic | toolkit/wave16/tools/TrafficQueueLength.jsx | ok |
| 1638 | Roundabout Capacity | wave16-traffic | toolkit/wave16/tools/TrafficRoundaboutCapacity.jsx | ok |
| 1639 | Parking Demand | wave16-traffic | toolkit/wave16/tools/TrafficParkingDemand.jsx | ok |
| 1640 | Pedestrian Crossing | wave16-traffic | toolkit/wave16/tools/TrafficPedestrianCrossing.jsx | ok |
| 1641 | Road Trip Time | wave16-traffic | toolkit/wave16/tools/TrafficRoadTripTime.jsx | ok |
| 1642 | Karat Alloying | wave17-jewellery | toolkit/wave17/tools/JewelKaratAlloy.jsx | ok |
| 1643 | Metal & Making Cost | wave17-jewellery | toolkit/wave17/tools/JewelMetalCost.jsx | ok |
| 1644 | Ring Size & Diameter | wave17-jewellery | toolkit/wave17/tools/JewelRingSize.jsx | ok |
| 1645 | Band Volume & Metal | wave17-jewellery | toolkit/wave17/tools/JewelBandMetal.jsx | ok |
| 1646 | Gemstone Weight | wave17-jewellery | toolkit/wave17/tools/JewelStoneWeight.jsx | ok |
| 1647 | Casting Yield & Sprue | wave17-jewellery | toolkit/wave17/tools/JewelCastingYield.jsx | ok |
| 1648 | Wax & Metal Shrinkage | wave17-jewellery | toolkit/wave17/tools/JewelWaxShrinkage.jsx | ok |
| 1649 | Solder & Joints | wave17-jewellery | toolkit/wave17/tools/JewelSolderJoint.jsx | ok |
| 1650 | Polishing & Finishing | wave17-jewellery | toolkit/wave17/tools/JewelPolishTime.jsx | ok |
| 1651 | Stone Setting & Bench | wave17-jewellery | toolkit/wave17/tools/JewelSettingTime.jsx | ok |
| 1652 | Spine Width & Case | wave17-bookbinding | toolkit/wave17/tools/BookSpineWidth.jsx | ok |
| 1653 | Signatures & Sections | wave17-bookbinding | toolkit/wave17/tools/BookSignatureCount.jsx | ok |
| 1654 | Board Cutting | wave17-bookbinding | toolkit/wave17/tools/BookBoardSize.jsx | ok |
| 1655 | Thread & Sewing | wave17-bookbinding | toolkit/wave17/tools/BookThreadLength.jsx | ok |
| 1656 | Glue & Adhesive | wave17-bookbinding | toolkit/wave17/tools/BookGlueArea.jsx | ok |
| 1657 | Paper Stock & Grain | wave17-bookbinding | toolkit/wave17/tools/BookPaperStock.jsx | ok |
| 1658 | Board Yield & Cost | wave17-bookbinding | toolkit/wave17/tools/BookBoardYield.jsx | ok |
| 1659 | Sewing & Binding Time | wave17-bookbinding | toolkit/wave17/tools/BookSewingTime.jsx | ok |
| 1660 | Cover Material & Cloth | wave17-bookbinding | toolkit/wave17/tools/BookCoverMaterial.jsx | ok |
| 1661 | Binding Batch Cost | wave17-bookbinding | toolkit/wave17/tools/BookBatchCost.jsx | ok |
| 1662 | Traverse Closure | wave17-surveying | toolkit/wave17/tools/SurveyTraverseClosure.jsx | ok |
| 1663 | Level Run & Rise Fall | wave17-surveying | toolkit/wave17/tools/SurveyLevelRun.jsx | ok |
| 1664 | Slope & Horizontal Distance | wave17-surveying | toolkit/wave17/tools/SurveySlopeCorrection.jsx | ok |
| 1665 | Area by Offsets | wave17-surveying | toolkit/wave17/tools/SurveyCoordinateArea.jsx | ok |
| 1666 | Horizontal Curve | wave17-surveying | toolkit/wave17/tools/SurveyCurveSetting.jsx | ok |
| 1667 | Vertical Curve & Grades | wave17-surveying | toolkit/wave17/tools/SurveyVerticalCurve.jsx | ok |
| 1668 | End Area Earthwork | wave17-surveying | toolkit/wave17/tools/SurveyEarthworkCross.jsx | ok |
| 1669 | Bearing & Coordinates | wave17-surveying | toolkit/wave17/tools/SurveyBearingDistance.jsx | ok |
| 1670 | Stadia & Tacheometry | wave17-surveying | toolkit/wave17/tools/SurveyStadiaDistance.jsx | ok |
| 1671 | Accuracy & Error Budget | wave17-surveying | toolkit/wave17/tools/SurveyErrorBudget.jsx | ok |
| 1672 | Air Changes & Room Volume | wave17-airquality | toolkit/wave17/tools/AirChangesRate.jsx | ok |
| 1673 | CO₂ Build-Up | wave17-airquality | toolkit/wave17/tools/AirCo2Equilibrium.jsx | ok |
| 1674 | Dilution Ventilation | wave17-airquality | toolkit/wave17/tools/AirDilutionVentilation.jsx | ok |
| 1675 | Hood Capture | wave17-airquality | toolkit/wave17/tools/AirCaptureVelocity.jsx | ok |
| 1676 | Filter Efficiency | wave17-airquality | toolkit/wave17/tools/AirFilterEfficiency.jsx | ok |
| 1677 | Filter Pressure Drop | wave17-airquality | toolkit/wave17/tools/AirFilterPressure.jsx | ok |
| 1678 | Particle Settling | wave17-airquality | toolkit/wave17/tools/AirParticleSettling.jsx | ok |
| 1679 | Occupancy Ventilation | wave17-airquality | toolkit/wave17/tools/AirOccupancyVentilation.jsx | ok |
| 1680 | Duct Velocity & Size | wave17-airquality | toolkit/wave17/tools/AirDuctVelocity.jsx | ok |
| 1681 | Exhaust & Make-Up Air | wave17-airquality | toolkit/wave17/tools/AirExhaustMakeup.jsx | ok |
| 1682 | Volume & Turnover | wave17-pools | toolkit/wave17/tools/PoolVolumeTurnover.jsx | ok |
| 1683 | Chlorine Dosing | wave17-pools | toolkit/wave17/tools/PoolChlorineDose.jsx | ok |
| 1684 | pH & Alkalinity | wave17-pools | toolkit/wave17/tools/PoolPhAdjust.jsx | ok |
| 1685 | Salt & Chlorinator | wave17-pools | toolkit/wave17/tools/PoolSaltLevel.jsx | ok |
| 1686 | Heater & Heat Loss | wave17-pools | toolkit/wave17/tools/PoolHeaterSizing.jsx | ok |
| 1687 | Filter Sizing | wave17-pools | toolkit/wave17/tools/PoolFilterArea.jsx | ok |
| 1688 | Backwash & Water | wave17-pools | toolkit/wave17/tools/PoolBackwashWater.jsx | ok |
| 1689 | Bather Load | wave17-pools | toolkit/wave17/tools/PoolBatherLoad.jsx | ok |
| 1690 | Season Chemical Budget | wave17-pools | toolkit/wave17/tools/PoolSeasonChemicals.jsx | ok |
| 1691 | Evaporation & Top-Up | wave17-pools | toolkit/wave17/tools/PoolEvaporationLoss.jsx | ok |
| 1692 | Spread Rate & Coverage | wave17-coatings | toolkit/wave17/tools/CoatSpreadRate.jsx | ok |
| 1693 | Wet to Dry Film | wave17-coatings | toolkit/wave17/tools/CoatWetDryFilm.jsx | ok |
| 1694 | VOC Content & Limits | wave17-coatings | toolkit/wave17/tools/CoatVocContent.jsx | ok |
| 1695 | Pigment Volume | wave17-coatings | toolkit/wave17/tools/CoatPigmentVolume.jsx | ok |
| 1696 | Thinning & Viscosity | wave17-coatings | toolkit/wave17/tools/CoatThinning.jsx | ok |
| 1697 | Drying Time | wave17-coatings | toolkit/wave17/tools/CoatDryingTime.jsx | ok |
| 1698 | Batch Scaling | wave17-coatings | toolkit/wave17/tools/CoatBatchScaling.jsx | ok |
| 1699 | Cost Per Square Metre | wave17-coatings | toolkit/wave17/tools/CoatCostPerM2.jsx | ok |
| 1700 | Film Build & Coats | wave17-coatings | toolkit/wave17/tools/CoatFilmBuild.jsx | ok |
| 1701 | Opacity & Hiding | wave17-coatings | toolkit/wave17/tools/CoatOpacityHiding.jsx | ok |
| 1702 | Glide Ratio & Distance | wave17-paragliding | toolkit/wave17/tools/PgGlideRatio.jsx | ok |
| 1703 | Wind & Ground Speed | wave17-paragliding | toolkit/wave17/tools/PgWindGlide.jsx | ok |
| 1704 | Thermal & Net Climb | wave17-paragliding | toolkit/wave17/tools/PgThermalClimb.jsx | ok |
| 1705 | Wing Loading | wave17-paragliding | toolkit/wave17/tools/PgWingLoading.jsx | ok |
| 1706 | Descent & Landing Plan | wave17-paragliding | toolkit/wave17/tools/PgDescentPlan.jsx | ok |
| 1707 | Speed to Fly | wave17-paragliding | toolkit/wave17/tools/PgSpeedToFly.jsx | ok |
| 1708 | Cross Country Potential | wave17-paragliding | toolkit/wave17/tools/PgXcDistance.jsx | ok |
| 1709 | Reserve Descent Rate | wave17-paragliding | toolkit/wave17/tools/PgReserveDescent.jsx | ok |
| 1710 | Altitude Budget | wave17-paragliding | toolkit/wave17/tools/PgAltitudeBudget.jsx | ok |
| 1711 | Task Time & Climbs | wave17-paragliding | toolkit/wave17/tools/PgTaskTime.jsx | ok |
| 1712 | Weir Flow | wave17-hydrology | toolkit/wave17/tools/HydroWeirFlow.jsx | ok |
| 1713 | Manning Channel Flow | wave17-hydrology | toolkit/wave17/tools/HydroManningChannel.jsx | ok |
| 1714 | Rational Method Runoff | wave17-hydrology | toolkit/wave17/tools/HydroRationalRunoff.jsx | ok |
| 1715 | Time of Concentration | wave17-hydrology | toolkit/wave17/tools/HydroTimeConcentration.jsx | ok |
| 1716 | Flood Frequency & Risk | wave17-hydrology | toolkit/wave17/tools/HydroFloodFrequency.jsx | ok |
| 1717 | Reservoir Water Balance | wave17-hydrology | toolkit/wave17/tools/HydroReservoirBalance.jsx | ok |
| 1718 | Darcy Groundwater Flow | wave17-hydrology | toolkit/wave17/tools/HydroDarcyGroundwater.jsx | ok |
| 1719 | Stage Discharge Rating | wave17-hydrology | toolkit/wave17/tools/HydroRatingCurve.jsx | ok |
| 1720 | Culvert Capacity | wave17-hydrology | toolkit/wave17/tools/HydroCulvertCapacity.jsx | ok |
| 1721 | Unit Hydrograph | wave17-hydrology | toolkit/wave17/tools/HydroUnitHydrograph.jsx | ok |
| 1722 | Shooting Ratio | wave18-film | (registry / shared workbench) | ok |
| 1723 | Script to Screen Time | wave18-film | (registry / shared workbench) | ok |
| 1724 | Lens Depth of Field | wave18-film | (registry / shared workbench) | ok |
| 1725 | Aspect Ratio & Crop | wave18-film | (registry / shared workbench) | ok |
| 1726 | Codec Data Rate & Storage | wave18-film | (registry / shared workbench) | ok |
| 1727 | Dailies & Backup | wave18-film | (registry / shared workbench) | ok |
| 1728 | Call Sheet & Setups | wave18-film | (registry / shared workbench) | ok |
| 1729 | Stripboard Schedule | wave18-film | (registry / shared workbench) | ok |
| 1730 | Crew Day Cost | wave18-film | (registry / shared workbench) | ok |
| 1731 | Location & Permits | wave18-film | (registry / shared workbench) | ok |
| 1732 | Conform & Render Time | wave18-film | (registry / shared workbench) | ok |
| 1733 | VFX Frames & Artist Days | wave18-film | (registry / shared workbench) | ok |
| 1734 | Budget Per Minute | wave18-film | (registry / shared workbench) | ok |
| 1735 | Lighting Package & Power | wave18-film | (registry / shared workbench) | ok |
| 1736 | Coverage & Takes | wave18-film | (registry / shared workbench) | ok |
| 1737 | Magnification & Exit Pupil | wave18-astroobs | (registry / shared workbench) | ok |
| 1738 | Limiting Magnitude | wave18-astroobs | (registry / shared workbench) | ok |
| 1739 | Resolving Power | wave18-astroobs | (registry / shared workbench) | ok |
| 1740 | True Field of View | wave18-astroobs | (registry / shared workbench) | ok |
| 1741 | Plate Scale & Sampling | wave18-astroobs | (registry / shared workbench) | ok |
| 1742 | Exposure for Signal to Noise | wave18-astroobs | (registry / shared workbench) | ok |
| 1743 | Star Trail Limit | wave18-astroobs | (registry / shared workbench) | ok |
| 1744 | Hour Angle & Altitude | wave18-astroobs | (registry / shared workbench) | ok |
| 1745 | Moon Phase & Brightness | wave18-astroobs | (registry / shared workbench) | ok |
| 1746 | Twilight & Dark Window | wave18-astroobs | (registry / shared workbench) | ok |
| 1747 | Planet Angular Size | wave18-astroobs | (registry / shared workbench) | ok |
| 1748 | Meridian Altitude | wave18-astroobs | (registry / shared workbench) | ok |
| 1749 | Air Mass & Extinction | wave18-astroobs | (registry / shared workbench) | ok |
| 1750 | Narrowband Filter Factor | wave18-astroobs | (registry / shared workbench) | ok |
| 1751 | Focal Ratio & Sampling | wave18-astroobs | (registry / shared workbench) | ok |
| 1752 | Fuel Per Lap & Stint | wave18-motorsport | (registry / shared workbench) | ok |
| 1753 | Stint Plan & Stops | wave18-motorsport | (registry / shared workbench) | ok |
| 1754 | Pit Window & Undercut | wave18-motorsport | (registry / shared workbench) | ok |
| 1755 | Gearing & Top Speed | wave18-motorsport | (registry / shared workbench) | ok |
| 1756 | Lap Time & Ideal Lap | wave18-motorsport | (registry / shared workbench) | ok |
| 1757 | Brake Energy & Temperature | wave18-motorsport | (registry / shared workbench) | ok |
| 1758 | Tyre Degradation | wave18-motorsport | (registry / shared workbench) | ok |
| 1759 | Downforce & Drag | wave18-motorsport | (registry / shared workbench) | ok |
| 1760 | Corner Speed & Lateral Load | wave18-motorsport | (registry / shared workbench) | ok |
| 1761 | Weight Transfer | wave18-motorsport | (registry / shared workbench) | ok |
| 1762 | Power to Weight & Top Speed | wave18-motorsport | (registry / shared workbench) | ok |
| 1763 | Fuel Load Penalty | wave18-motorsport | (registry / shared workbench) | ok |
| 1764 | Roll Stiffness & Balance | wave18-motorsport | (registry / shared workbench) | ok |
| 1765 | Tyre Pressure & Rise | wave18-motorsport | (registry / shared workbench) | ok |
| 1766 | Hybrid Deployment | wave18-motorsport | (registry / shared workbench) | ok |
| 1767 | Mowing Frequency | wave18-turf | (registry / shared workbench) | ok |
| 1768 | Irrigation Requirement | wave18-turf | (registry / shared workbench) | ok |
| 1769 | Nitrogen & Feed Plan | wave18-turf | (registry / shared workbench) | ok |
| 1770 | Seed Rate & Overseeding | wave18-turf | (registry / shared workbench) | ok |
| 1771 | Lime Requirement | wave18-turf | (registry / shared workbench) | ok |
| 1772 | Line Marking Paint | wave18-turf | (registry / shared workbench) | ok |
| 1773 | Aeration & Coring | wave18-turf | (registry / shared workbench) | ok |
| 1774 | Topdressing | wave18-turf | (registry / shared workbench) | ok |
| 1775 | Rootzone Mix | wave18-turf | (registry / shared workbench) | ok |
| 1776 | Infiltration & Drainage | wave18-turf | (registry / shared workbench) | ok |
| 1777 | Light & Growing Degree Days | wave18-turf | (registry / shared workbench) | ok |
| 1778 | Disease Risk Threshold | wave18-turf | (registry / shared workbench) | ok |
| 1779 | Renovation Cost | wave18-turf | (registry / shared workbench) | ok |
| 1780 | Rolling & Firmness | wave18-turf | (registry / shared workbench) | ok |
| 1781 | Mowing Time & Labour | wave18-turf | (registry / shared workbench) | ok |
| 1782 | Population Growth | wave18-wildlife | (registry / shared workbench) | ok |
| 1783 | Minimum Viable Population | wave18-wildlife | (registry / shared workbench) | ok |
| 1784 | Habitat Area Needed | wave18-wildlife | (registry / shared workbench) | ok |
| 1785 | Density by Transect | wave18-wildlife | (registry / shared workbench) | ok |
| 1786 | Camera Trap Occupancy | wave18-wildlife | (registry / shared workbench) | ok |
| 1787 | Carrying Capacity | wave18-wildlife | (registry / shared workbench) | ok |
| 1788 | Corridor Width | wave18-wildlife | (registry / shared workbench) | ok |
| 1789 | Edge Effect & Core Area | wave18-wildlife | (registry / shared workbench) | ok |
| 1790 | Predator & Prey Balance | wave18-wildlife | (registry / shared workbench) | ok |
| 1791 | Harvest Quota | wave18-wildlife | (registry / shared workbench) | ok |
| 1792 | Reintroduction Plan | wave18-wildlife | (registry / shared workbench) | ok |
| 1793 | Migration Energy | wave18-wildlife | (registry / shared workbench) | ok |
| 1794 | Wetland & Waterfowl | wave18-wildlife | (registry / shared workbench) | ok |
| 1795 | Invasive Removal Effort | wave18-wildlife | (registry / shared workbench) | ok |
| 1796 | Biodiversity Index | wave18-wildlife | (registry / shared workbench) | ok |
| 1797 | Mesh Count & Deposit | wave18-printmake | (registry / shared workbench) | ok |
| 1798 | Squeegee & Throughput | wave18-printmake | (registry / shared workbench) | ok |
| 1799 | Screen Exposure | wave18-printmake | (registry / shared workbench) | ok |
| 1800 | Screen Tension & Frame | wave18-printmake | (registry / shared workbench) | ok |
| 1801 | Ink Volume & Coverage | wave18-printmake | (registry / shared workbench) | ok |
| 1802 | Plate Bite & Etching | wave18-printmake | (registry / shared workbench) | ok |
| 1803 | Press Pressure & Nip | wave18-printmake | (registry / shared workbench) | ok |
| 1804 | Registration & Fit | wave18-printmake | (registry / shared workbench) | ok |
| 1805 | Edition & Proofs | wave18-printmake | (registry / shared workbench) | ok |
| 1806 | Paper Grain & Layout | wave18-printmake | (registry / shared workbench) | ok |
| 1807 | Drying & Rack Space | wave18-printmake | (registry / shared workbench) | ok |
| 1808 | Relief Block Carving | wave18-printmake | (registry / shared workbench) | ok |
| 1809 | Ink Viscosity | wave18-printmake | (registry / shared workbench) | ok |
| 1810 | Plate & Print Cost | wave18-printmake | (registry / shared workbench) | ok |
| 1811 | Embossing & Die Depth | wave18-printmake | (registry / shared workbench) | ok |
| 1812 | Gather Mass & Volume | wave18-glassblow | (registry / shared workbench) | ok |
| 1813 | Blow Time & Bubble | wave18-glassblow | (registry / shared workbench) | ok |
| 1814 | Mould Fit & Shrinkage | wave18-glassblow | (registry / shared workbench) | ok |
| 1815 | Annealing Cycle | wave18-glassblow | (registry / shared workbench) | ok |
| 1816 | Coefficient of Expansion Match | wave18-glassblow | (registry / shared workbench) | ok |
| 1817 | Colour & Frit Batch | wave18-glassblow | (registry / shared workbench) | ok |
| 1818 | Kiln Load & Firing | wave18-glassblow | (registry / shared workbench) | ok |
| 1819 | Punty & Working Time | wave18-glassblow | (registry / shared workbench) | ok |
| 1820 | Marver & Shaping Time | wave18-glassblow | (registry / shared workbench) | ok |
| 1821 | Cane & Murrine Pull | wave18-glassblow | (registry / shared workbench) | ok |
| 1822 | Melting Energy & Cost | wave18-glassblow | (registry / shared workbench) | ok |
| 1823 | Batch Recipe | wave18-glassblow | (registry / shared workbench) | ok |
| 1824 | Cooling Stress Check | wave18-glassblow | (registry / shared workbench) | ok |
| 1825 | Piece Cost & Price | wave18-glassblow | (registry / shared workbench) | ok |
| 1826 | Shop Throughput | wave18-glassblow | (registry / shared workbench) | ok |
| 1827 | Capacity & Occupancy | wave18-eventops | (registry / shared workbench) | ok |
| 1828 | Egress Time | wave18-eventops | (registry / shared workbench) | ok |
| 1829 | Seating Layout | wave18-eventops | (registry / shared workbench) | ok |
| 1830 | Catering Quantity | wave18-eventops | (registry / shared workbench) | ok |
| 1831 | Bar Stock | wave18-eventops | (registry / shared workbench) | ok |
| 1832 | Staffing & Ratios | wave18-eventops | (registry / shared workbench) | ok |
| 1833 | Power Load & Generator | wave18-eventops | (registry / shared workbench) | ok |
| 1834 | Ticket Revenue | wave18-eventops | (registry / shared workbench) | ok |
| 1835 | Event Budget | wave18-eventops | (registry / shared workbench) | ok |
| 1836 | Toilet Provision | wave18-eventops | (registry / shared workbench) | ok |
| 1837 | Parking & Access | wave18-eventops | (registry / shared workbench) | ok |
| 1838 | Waste & Recycling | wave18-eventops | (registry / shared workbench) | ok |
| 1839 | Accessible Provision | wave18-eventops | (registry / shared workbench) | ok |
| 1840 | Venue Climate & Cooling | wave18-eventops | (registry / shared workbench) | ok |
| 1841 | Sponsor Return | wave18-eventops | (registry / shared workbench) | ok |
| 1842 | Cell Cycle Time | wave19-robot | (registry / shared workbench) | ok |
| 1843 | Payload & Moment Use | wave19-robot | (registry / shared workbench) | ok |
| 1844 | Gripper Force & Slip | wave19-robot | (registry / shared workbench) | ok |
| 1845 | Vacuum Pad Count | wave19-robot | (registry / shared workbench) | ok |
| 1846 | Tool Centre Point | wave19-robot | (registry / shared workbench) | ok |
| 1847 | Safety Distance | wave19-robot | (registry / shared workbench) | ok |
| 1848 | Conveyor Tracking | wave19-robot | (registry / shared workbench) | ok |
| 1849 | Palletising Pattern | wave19-robot | (registry / shared workbench) | ok |
| 1850 | Servo Sizing | wave19-robot | (registry / shared workbench) | ok |
| 1851 | Brake & Gravity Load | wave19-robot | (registry / shared workbench) | ok |
| 1852 | Repeatability Stack-up | wave19-robot | (registry / shared workbench) | ok |
| 1853 | Vacuum Pump & Leakage | wave19-robot | (registry / shared workbench) | ok |
| 1854 | Welding Cell Cycle | wave19-robot | (registry / shared workbench) | ok |
| 1855 | Changeover & SMED | wave19-robot | (registry / shared workbench) | ok |
| 1856 | Cell Cost & Payback | wave19-robot | (registry / shared workbench) | ok |
| 1857 | Die Per Wafer | wave19-wafer | (registry / shared workbench) | ok |
| 1858 | Yield Models | wave19-wafer | (registry / shared workbench) | ok |
| 1859 | Wafer Starts & Lots | wave19-wafer | (registry / shared workbench) | ok |
| 1860 | Resist Spin Coating | wave19-wafer | (registry / shared workbench) | ok |
| 1861 | Lithography Limit | wave19-wafer | (registry / shared workbench) | ok |
| 1862 | Etch Time & Selectivity | wave19-wafer | (registry / shared workbench) | ok |
| 1863 | Deposition Time | wave19-wafer | (registry / shared workbench) | ok |
| 1864 | CMP Removal Rate | wave19-wafer | (registry / shared workbench) | ok |
| 1865 | Diffusion Drive-in | wave19-wafer | (registry / shared workbench) | ok |
| 1866 | Thermal Oxidation | wave19-wafer | (registry / shared workbench) | ok |
| 1867 | Cleanroom Air & Class | wave19-wafer | (registry / shared workbench) | ok |
| 1868 | Mask Set Cost | wave19-wafer | (registry / shared workbench) | ok |
| 1869 | Film Stress & Bow | wave19-wafer | (registry / shared workbench) | ok |
| 1870 | Sputter Target Life | wave19-wafer | (registry / shared workbench) | ok |
| 1871 | Lot Cycle Time | wave19-wafer | (registry / shared workbench) | ok |
| 1872 | Stem Count & Recipe | wave19-florist | (registry / shared workbench) | ok |
| 1873 | Spiral Bouquet Build | wave19-florist | (registry / shared workbench) | ok |
| 1874 | Foam & Container | wave19-florist | (registry / shared workbench) | ok |
| 1875 | Vase Life & Water | wave19-florist | (registry / shared workbench) | ok |
| 1876 | Hydration & Conditioning | wave19-florist | (registry / shared workbench) | ok |
| 1877 | Preservative Dose | wave19-florist | (registry / shared workbench) | ok |
| 1878 | Stem Length & Trim | wave19-florist | (registry / shared workbench) | ok |
| 1879 | Wholesale Cost & Markup | wave19-florist | (registry / shared workbench) | ok |
| 1880 | Bouquet Density | wave19-florist | (registry / shared workbench) | ok |
| 1881 | Cooler & Cold Chain | wave19-florist | (registry / shared workbench) | ok |
| 1882 | Delivery Load | wave19-florist | (registry / shared workbench) | ok |
| 1883 | Ribbon & Wrap | wave19-florist | (registry / shared workbench) | ok |
| 1884 | Bench Time & Labour | wave19-florist | (registry / shared workbench) | ok |
| 1885 | Wedding & Event Flowers | wave19-florist | (registry / shared workbench) | ok |
| 1886 | Cost, Margin & Break-even | wave19-florist | (registry / shared workbench) | ok |
| 1887 | Primal Yield & Value | wave19-butcher | (registry / shared workbench) | ok |
| 1888 | Curing Salt Dose | wave19-butcher | (registry / shared workbench) | ok |
| 1889 | Brine Strength | wave19-butcher | (registry / shared workbench) | ok |
| 1890 | Equilibrium Cure Time | wave19-butcher | (registry / shared workbench) | ok |
| 1891 | Smoke Time & Temperature | wave19-butcher | (registry / shared workbench) | ok |
| 1892 | Sausage Lean & Fat | wave19-butcher | (registry / shared workbench) | ok |
| 1893 | Casings & Links | wave19-butcher | (registry / shared workbench) | ok |
| 1894 | Sausage Yield & Cost | wave19-butcher | (registry / shared workbench) | ok |
| 1895 | Dry Cure Weight Loss | wave19-butcher | (registry / shared workbench) | ok |
| 1896 | Grinder Throughput | wave19-butcher | (registry / shared workbench) | ok |
| 1897 | Mince Temperature | wave19-butcher | (registry / shared workbench) | ok |
| 1898 | Sanitiser Dilution | wave19-butcher | (registry / shared workbench) | ok |
| 1899 | Freezer Capacity | wave19-butcher | (registry / shared workbench) | ok |
| 1900 | Cut Cost & Margin | wave19-butcher | (registry / shared workbench) | ok |
| 1901 | Shelf Life & Safety | wave19-butcher | (registry / shared workbench) | ok |
| 1902 | Gait Speed | wave19-physio | (registry / shared workbench) | ok |
| 1903 | Timed Up & Go | wave19-physio | (registry / shared workbench) | ok |
| 1904 | Six Minute Walk | wave19-physio | (registry / shared workbench) | ok |
| 1905 | Range of Motion Norms | wave19-physio | (registry / shared workbench) | ok |
| 1906 | Resistance Band Load | wave19-physio | (registry / shared workbench) | ok |
| 1907 | Reps & Load Progression | wave19-physio | (registry / shared workbench) | ok |
| 1908 | Walking Aid Height | wave19-physio | (registry / shared workbench) | ok |
| 1909 | Ramp Grade & Force | wave19-physio | (registry / shared workbench) | ok |
| 1910 | Transfer Height | wave19-physio | (registry / shared workbench) | ok |
| 1911 | Splint & Limb Size | wave19-physio | (registry / shared workbench) | ok |
| 1912 | Limb Volume & Swelling | wave19-physio | (registry / shared workbench) | ok |
| 1913 | Walking Energy Cost | wave19-physio | (registry / shared workbench) | ok |
| 1914 | Gait Symmetry | wave19-physio | (registry / shared workbench) | ok |
| 1915 | Exercise Dose | wave19-physio | (registry / shared workbench) | ok |
| 1916 | Rehab Plan & Milestones | wave19-physio | (registry / shared workbench) | ok |
| 1917 | Power Curve & Cp | wave19-windpower | (registry / shared workbench) | ok |
| 1918 | Betz Limit Check | wave19-windpower | (registry / shared workbench) | ok |
| 1919 | Weibull & Annual Energy | wave19-windpower | (registry / shared workbench) | ok |
| 1920 | Wind Shear & Hub Height | wave19-windpower | (registry / shared workbench) | ok |
| 1921 | Spacing & Wake Loss | wave19-windpower | (registry / shared workbench) | ok |
| 1922 | Tip Speed & Noise | wave19-windpower | (registry / shared workbench) | ok |
| 1923 | Gearbox & Generator | wave19-windpower | (registry / shared workbench) | ok |
| 1924 | Tower Thrust & Base | wave19-windpower | (registry / shared workbench) | ok |
| 1925 | Small Wind Battery | wave19-windpower | (registry / shared workbench) | ok |
| 1926 | Micro-Hydro Power | wave19-windpower | (registry / shared workbench) | ok |
| 1927 | Penstock Sizing | wave19-windpower | (registry / shared workbench) | ok |
| 1928 | Shaft Torque & Size | wave19-windpower | (registry / shared workbench) | ok |
| 1929 | Site Yield & Payback | wave19-windpower | (registry / shared workbench) | ok |
| 1930 | Guy Wires & Anchors | wave19-windpower | (registry / shared workbench) | ok |
| 1931 | Anemometry & Uncertainty | wave19-windpower | (registry / shared workbench) | ok |
| 1932 | Pin Stack & Shear Line | wave19-locksmith | (registry / shared workbench) | ok |
| 1933 | Maximum Adjacent Cut | wave19-locksmith | (registry / shared workbench) | ok |
| 1934 | Key Space & Combinations | wave19-locksmith | (registry / shared workbench) | ok |
| 1935 | Master Keying Levels | wave19-locksmith | (registry / shared workbench) | ok |
| 1936 | Driver Pin & Spring | wave19-locksmith | (registry / shared workbench) | ok |
| 1937 | Rekey Time & Labour | wave19-locksmith | (registry / shared workbench) | ok |
| 1938 | Bolt Throw & Strike | wave19-locksmith | (registry / shared workbench) | ok |
| 1939 | Door Closer & Force | wave19-locksmith | (registry / shared workbench) | ok |
| 1940 | Panic Bar & Exit Load | wave19-locksmith | (registry / shared workbench) | ok |
| 1941 | Safe Combination Space | wave19-locksmith | (registry / shared workbench) | ok |
| 1942 | Keys & Blanks | wave19-locksmith | (registry / shared workbench) | ok |
| 1943 | Master Key Exposure | wave19-locksmith | (registry / shared workbench) | ok |
| 1944 | Camera Coverage & Storage | wave19-locksmith | (registry / shared workbench) | ok |
| 1945 | Access Control Throughput | wave19-locksmith | (registry / shared workbench) | ok |
| 1946 | Security Grade Assessment | wave19-locksmith | (registry / shared workbench) | ok |
| 1947 | Quay Crane Cycle | wave19-portops | (registry / shared workbench) | ok |
| 1948 | Berth Productivity | wave19-portops | (registry / shared workbench) | ok |
| 1949 | Vessel Call Time | wave19-portops | (registry / shared workbench) | ok |
| 1950 | Yard Density & Slots | wave19-portops | (registry / shared workbench) | ok |
| 1951 | Reach Stacker Cycle | wave19-portops | (registry / shared workbench) | ok |
| 1952 | Gate & Truck Turnaround | wave19-portops | (registry / shared workbench) | ok |
| 1953 | Tide & Under Keel | wave19-portops | (registry / shared workbench) | ok |
| 1954 | Stack Load & Ground | wave19-portops | (registry / shared workbench) | ok |
| 1955 | Reefer Plugs & Power | wave19-portops | (registry / shared workbench) | ok |
| 1956 | Yard Vehicles & Moves | wave19-portops | (registry / shared workbench) | ok |
| 1957 | Terminal Capacity | wave19-portops | (registry / shared workbench) | ok |
| 1958 | Gang & Shift Plan | wave19-portops | (registry / shared workbench) | ok |
| 1959 | Cost Per Move | wave19-portops | (registry / shared workbench) | ok |
| 1960 | Bunkering & Fuel | wave19-portops | (registry / shared workbench) | ok |
| 1961 | Berth Occupancy & Waiting | wave19-portops | (registry / shared workbench) | ok |
| 1962 | Mud Weight & Barite | wave20-petroleum | (registry / shared workbench) | ok |
| 1963 | Annular Velocity & Cuttings | wave20-petroleum | (registry / shared workbench) | ok |
| 1964 | Casing Capacity & Displacement | wave20-petroleum | (registry / shared workbench) | ok |
| 1965 | Mud Pump Output | wave20-petroleum | (registry / shared workbench) | ok |
| 1966 | Bit Nozzles & Hydraulics | wave20-petroleum | (registry / shared workbench) | ok |
| 1967 | Kick & Kill Mud | wave20-petroleum | (registry / shared workbench) | ok |
| 1968 | Cementing Volume | wave20-petroleum | (registry / shared workbench) | ok |
| 1969 | Choke & Flow Rate | wave20-petroleum | (registry / shared workbench) | ok |
| 1970 | ROP & Cost Per Metre | wave20-petroleum | (registry / shared workbench) | ok |
| 1971 | Hydrostatic Pressure | wave20-petroleum | (registry / shared workbench) | ok |
| 1972 | Well Test & Productivity | wave20-petroleum | (registry / shared workbench) | ok |
| 1973 | Tank Gauging & Volume | wave20-petroleum | (registry / shared workbench) | ok |
| 1974 | Well Cost & AFE | wave20-petroleum | (registry / shared workbench) | ok |
| 1975 | Directional Well Path | wave20-petroleum | (registry / shared workbench) | ok |
| 1976 | Separator Sizing | wave20-petroleum | (registry / shared workbench) | ok |
| 1977 | Powder Factor & Blast | wave20-mining | (registry / shared workbench) | ok |
| 1978 | Drill Pattern & Metres | wave20-mining | (registry / shared workbench) | ok |
| 1979 | Haul Cycle & Match | wave20-mining | (registry / shared workbench) | ok |
| 1980 | Loader Payload & Passes | wave20-mining | (registry / shared workbench) | ok |
| 1981 | Bench & Stockpile Volume | wave20-mining | (registry / shared workbench) | ok |
| 1982 | Pit Slope & Bench Geometry | wave20-mining | (registry / shared workbench) | ok |
| 1983 | Mine Ventilation Air | wave20-mining | (registry / shared workbench) | ok |
| 1984 | Grade Blending | wave20-mining | (registry / shared workbench) | ok |
| 1985 | Dilution & Metal Recovery | wave20-mining | (registry / shared workbench) | ok |
| 1986 | Crusher Throughput | wave20-mining | (registry / shared workbench) | ok |
| 1987 | Conveyor Capacity & Power | wave20-mining | (registry / shared workbench) | ok |
| 1988 | Shaft Hoist Cycle | wave20-mining | (registry / shared workbench) | ok |
| 1989 | Pit Dewatering | wave20-mining | (registry / shared workbench) | ok |
| 1990 | Stripping Ratio & Reserve | wave20-mining | (registry / shared workbench) | ok |
| 1991 | Cost Per Tonne & Margin | wave20-mining | (registry / shared workbench) | ok |
| 1992 | Yield & Capital Value | wave20-property | (registry / shared workbench) | ok |
| 1993 | Mortgage & Affordability | wave20-property | (registry / shared workbench) | ok |
| 1994 | LTV, DSCR & Debt Yield | wave20-property | (registry / shared workbench) | ok |
| 1995 | Cash Flow & Return | wave20-property | (registry / shared workbench) | ok |
| 1996 | Service Charge Apportionment | wave20-property | (registry / shared workbench) | ok |
| 1997 | Rent Review & Uplift | wave20-property | (registry / shared workbench) | ok |
| 1998 | Lease Break Cost | wave20-property | (registry / shared workbench) | ok |
| 1999 | Acquisition Costs | wave20-property | (registry / shared workbench) | ok |
| 2000 | Refurbishment Cost & Value | wave20-property | (registry / shared workbench) | ok |
| 2001 | Development Appraisal | wave20-property | (registry / shared workbench) | ok |
| 2002 | Portfolio Yield & Weighting | wave20-property | (registry / shared workbench) | ok |
| 2003 | Overpayment & Term | wave20-property | (registry / shared workbench) | ok |
| 2004 | Void & Net Income | wave20-property | (registry / shared workbench) | ok |
| 2005 | Reinstatement & Insurance | wave20-property | (registry / shared workbench) | ok |
| 2006 | Effective Rent & Incentive | wave20-property | (registry / shared workbench) | ok |
| 2007 | Shelf Capacity & Metres | wave20-library | (registry / shared workbench) | ok |
| 2008 | Floor Loading & Storage | wave20-library | (registry / shared workbench) | ok |
| 2009 | Digitisation Throughput | wave20-library | (registry / shared workbench) | ok |
| 2010 | Preservation Climate | wave20-library | (registry / shared workbench) | ok |
| 2011 | Interlibrary Loan Time | wave20-library | (registry / shared workbench) | ok |
| 2012 | Turnover & Weeding | wave20-library | (registry / shared workbench) | ok |
| 2013 | Availability & Holds | wave20-library | (registry / shared workbench) | ok |
| 2014 | Desk Staffing & Queue | wave20-library | (registry / shared workbench) | ok |
| 2015 | Reading Room Capacity | wave20-library | (registry / shared workbench) | ok |
| 2016 | Subscription Cost Per Use | wave20-library | (registry / shared workbench) | ok |
| 2017 | Cataloguing Rate | wave20-library | (registry / shared workbench) | ok |
| 2018 | Archive Boxes & Shelving | wave20-library | (registry / shared workbench) | ok |
| 2019 | Archive Fire Suppression | wave20-library | (registry / shared workbench) | ok |
| 2020 | Binding & Repair | wave20-library | (registry / shared workbench) | ok |
| 2021 | Digital Storage & Derivatives | wave20-library | (registry / shared workbench) | ok |
| 2022 | Fabric Consumption | wave20-garment | (registry / shared workbench) | ok |
| 2023 | Marker Efficiency | wave20-garment | (registry / shared workbench) | ok |
| 2024 | Pattern Grading | wave20-garment | (registry / shared workbench) | ok |
| 2025 | Thread Consumption | wave20-garment | (registry / shared workbench) | ok |
| 2026 | Seam Strength & Stitch | wave20-garment | (registry / shared workbench) | ok |
| 2027 | Needle & Fabric Match | wave20-garment | (registry / shared workbench) | ok |
| 2028 | Cost Per Garment | wave20-garment | (registry / shared workbench) | ok |
| 2029 | Line Balancing | wave20-garment | (registry / shared workbench) | ok |
| 2030 | Output & Efficiency | wave20-garment | (registry / shared workbench) | ok |
| 2031 | Cutting Lay & Plies | wave20-garment | (registry / shared workbench) | ok |
| 2032 | Fabric Weight & Yield | wave20-garment | (registry / shared workbench) | ok |
| 2033 | Shrinkage & Allowance | wave20-garment | (registry / shared workbench) | ok |
| 2034 | Fit & Ease Allowance | wave20-garment | (registry / shared workbench) | ok |
| 2035 | Minute Value & Labour | wave20-garment | (registry / shared workbench) | ok |
| 2036 | AQL Sampling Plan | wave20-garment | (registry / shared workbench) | ok |
| 2037 | Salt Spread Rate | wave20-winter | (registry / shared workbench) | ok |
| 2038 | Ploughing Productivity | wave20-winter | (registry / shared workbench) | ok |
| 2039 | Gritting Route Time | wave20-winter | (registry / shared workbench) | ok |
| 2040 | Brine & De-icer Blend | wave20-winter | (registry / shared workbench) | ok |
| 2041 | Salt Stock & Storage | wave20-winter | (registry / shared workbench) | ok |
| 2042 | Roof Snow Load | wave20-winter | (registry / shared workbench) | ok |
| 2043 | Road Surface Temperature | wave20-winter | (registry / shared workbench) | ok |
| 2044 | Salt Dissolution & Action | wave20-winter | (registry / shared workbench) | ok |
| 2045 | Ice Patrol & Detection | wave20-winter | (registry / shared workbench) | ok |
| 2046 | Treatment Budget | wave20-winter | (registry / shared workbench) | ok |
| 2047 | Snow Clearing & Volume | wave20-winter | (registry / shared workbench) | ok |
| 2048 | Spreader Calibration | wave20-winter | (registry / shared workbench) | ok |
| 2049 | De-icer Comparison | wave20-winter | (registry / shared workbench) | ok |
| 2050 | Footpath Treatment | wave20-winter | (registry / shared workbench) | ok |
| 2051 | Winter Fleet & Drivers | wave20-winter | (registry / shared workbench) | ok |
| 2052 | Turnaround Critical Path | wave20-groundops | (registry / shared workbench) | ok |
| 2053 | Stand Capacity & Occupancy | wave20-groundops | (registry / shared workbench) | ok |
| 2054 | Baggage System Throughput | wave20-groundops | (registry / shared workbench) | ok |
| 2055 | Makeup Stand Allocation | wave20-groundops | (registry / shared workbench) | ok |
| 2056 | Fuel Uplift & Density | wave20-groundops | (registry / shared workbench) | ok |
| 2057 | De-icing Fluid & Holdover | wave20-groundops | (registry / shared workbench) | ok |
| 2058 | Boarding Rate & Gate Time | wave20-groundops | (registry / shared workbench) | ok |
| 2059 | Security Lane Queue | wave20-groundops | (registry / shared workbench) | ok |
| 2060 | Baggage Claim & Carousel | wave20-groundops | (registry / shared workbench) | ok |
| 2061 | GSE Fleet & Utilisation | wave20-groundops | (registry / shared workbench) | ok |
| 2062 | Runway Occupancy & Capacity | wave20-groundops | (registry / shared workbench) | ok |
| 2063 | Taxi Time & Fuel | wave20-groundops | (registry / shared workbench) | ok |
| 2064 | Pallet & ULD Build | wave20-groundops | (registry / shared workbench) | ok |
| 2065 | Ground Crew Shift Plan | wave20-groundops | (registry / shared workbench) | ok |
| 2066 | Delay & On-Time Cost | wave20-groundops | (registry / shared workbench) | ok |
| 2067 | Chemical Dilution | wave20-facility | (registry / shared workbench) | ok |
| 2068 | Area Rate & Labour | wave20-facility | (registry / shared workbench) | ok |
| 2069 | Cleaning Labour Plan | wave20-facility | (registry / shared workbench) | ok |
| 2070 | Cost Per Square Metre | wave20-facility | (registry / shared workbench) | ok |
| 2071 | Consumable Cost | wave20-facility | (registry / shared workbench) | ok |
| 2072 | Machine Productivity | wave20-facility | (registry / shared workbench) | ok |
| 2073 | Window Cleaning | wave20-facility | (registry / shared workbench) | ok |
| 2074 | Carpet Extraction | wave20-facility | (registry / shared workbench) | ok |
| 2075 | Floor Stripping & Sealing | wave20-facility | (registry / shared workbench) | ok |
| 2076 | Washroom Servicing | wave20-facility | (registry / shared workbench) | ok |
| 2077 | Waste & Recycling Route | wave20-facility | (registry / shared workbench) | ok |
| 2078 | Staff Cover & Ratio | wave20-facility | (registry / shared workbench) | ok |
| 2079 | Equipment Lifecycle | wave20-facility | (registry / shared workbench) | ok |
| 2080 | Audit & Standards Score | wave20-facility | (registry / shared workbench) | ok |
| 2081 | Tender Price & Margin | wave20-facility | (registry / shared workbench) | ok |
