# Engineering laboratories: 4 laboratories, 64 features

Source of the list: the main process registers every native app in `src/main/native/service.ts:208`, which includes `PHASE4_CATALOGUE` from `src/shared/native/phase4.ts:434`. Those four entries are the only ones in the catalogue that are laboratories with domain `engineering`. A fifth entry, the Optimiser (`src/shared/native/catalogue.ts:951-964`, domain `engineering`), is an app and not a laboratory, so it is left out here.

Each laboratory's declared controls (its "parameters") are in `src/shared/native/phase4.ts` lines 37-400. The on-screen panel for each is in `src/renderer/src/components/native/`. The calculations sit in `src/shared/compute/`. Line numbers below are for the panel file unless another file is named.

---

## 1. Circuit Laboratory

- Id: `circuit-lab`
- Catalogue entry: `src/shared/native/phase4.ts:436-487`
- Panel: `src/renderer/src/components/native/CircuitLab.tsx`
- Calculations: `src/shared/compute/circuits.ts`

Features:

1. **Capacitor charging.** Shows the voltage across a capacitor filling up through a resistor, drawn from a solved curve. Implemented at `CircuitLab.tsx:166-167` and `CircuitLab.tsx:236-289`. Option declared at `phase4.ts:45`. Engine: `circuits.ts:768` (`transient`).
2. **Capacitor discharging.** Shows the same circuit emptying. Implemented at `CircuitLab.tsx:166-167` and `CircuitLab.tsx:236-289`. Option at `phase4.ts:46`.
3. **Current building up in an inductor.** Shows the current rising in a coil. Implemented at `CircuitLab.tsx:166-167`, `CircuitLab.tsx:236-289`. Option at `phase4.ts:47`.
4. **Current dying away in an inductor.** Shows the current falling in a coil. Implemented at `CircuitLab.tsx:166-167`, `CircuitLab.tsx:236-289`. Option at `phase4.ts:48`.
5. **Time-constant marks.** Marks on the charging curve where one, two and about five time constants have passed, so a person can see they land at fixed multiples. Implemented at `CircuitLab.tsx:253` (markers) and `CircuitLab.tsx:255` (explanation text).
6. **Voltage and current plots.** Two stacked graphs of voltage and current against time for the transient circuits. Implemented at `CircuitLab.tsx:243-268`.
7. **Ringing or not (RLC step).** Shows an RLC circuit given a step, and says whether it overshoots and rings, settles exactly, or creeps up slowly. Implemented at `CircuitLab.tsx:291-340`. Wording for each case at `CircuitLab.tsx:85-90`. Option at `phase4.ts:49`. Engine: `circuits.ts:911` (`rlc`).
8. **Damping readouts.** Shows the damping ratio, natural frequency, the frequency it rings at, and the quality factor Q. Implemented at `CircuitLab.tsx:312-333`.
9. **Resonance sweep.** Plots the gain of an RLC circuit across frequency and marks the resonant frequency and the two −3 dB cut-offs. Implemented at `CircuitLab.tsx:342-370`. Option at `phase4.ts:50`. Engine: `circuits.ts:1032` (`resonanceSweep`).
10. **Phase at resonance.** A second graph showing the phase shift across frequency, with the zero-crossing at resonance explained. Implemented at `CircuitLab.tsx:356-370`.
11. **Resistor combiner.** Works out the total of several resistors in series or in parallel, and how much voltage or current each one takes. Implemented at `CircuitLab.tsx:393-430`. Option at `phase4.ts:51`. Engine: `circuits.ts:682` (`combineResistors`).
12. **Resistor list entry.** A box where the person types the resistor values, separated by spaces or commas. Implemented at `CircuitLab.tsx:92-98` (reader) and `CircuitLab.tsx:117` and `CircuitLab.tsx:137` (use).
13. **Series or parallel choice.** Switches an RLC circuit or a resistor network between series and parallel. Declared at `phase4.ts:113-128`. Used at `CircuitLab.tsx:116`.
14. **Component values.** Resistance, capacitance, inductance and supply voltage controls. Each one only appears for the circuits where it matters. Declared at `phase4.ts:56` (resistance), `phase4.ts:67` (capacitance), `phase4.ts:85` (inductance), `phase4.ts:102` (supply). Read at `CircuitLab.tsx:112-115`.
15. **What the solver found.** A list of plain notes from the solver about the result on screen. Implemented at `CircuitLab.tsx:175-184`.
16. **What this does not model.** A list of the simplifications behind the answer (ideal parts, no wire resistance, no semiconductors). Implemented at `CircuitLab.tsx:186-194`.

---

## 2. Control Laboratory

- Id: `control-lab`
- Catalogue entry: `src/shared/native/phase4.ts:489-542`
- Panel: `src/renderer/src/components/native/ControlLab.tsx`
- Calculations: `src/shared/compute/controls.ts`

Features:

1. **Step response of a PID loop.** Simulates a controller pushing a plant towards a target and plots what the plant measures against what it was asked for. Implemented at `ControlLab.tsx:249-275`. Engine: `controls.ts:933` (`simulatePid`).
2. **Actuator limit view.** Plots the control signal the controller asked for against the most and least the actuator can give, and says what fraction of the run was saturated. Implemented at `ControlLab.tsx:276-309`.
3. **Measured readouts.** Overshoot, rise time, settling time, steady-state error and stability, all measured from the simulated curve. Implemented at `ControlLab.tsx:395-431`. Engine: `controls.ts:302` (`stepResponse`).
4. **Total error.** A single number for how far off the loop was over the whole run. Implemented at `ControlLab.tsx:419-424`.
5. **Unstable loop warning.** Says when the response grows instead of settling, and stops showing overshoot and settling time. Implemented at `ControlLab.tsx:218-226`.
6. **Gain across frequency.** A Bode gain plot with the 0 dB crossing marked. Implemented at `ControlLab.tsx:313-324`. Engine: `controls.ts:479` (`bode`).
7. **Phase across frequency.** A Bode phase plot with the −180° line marked and the phase margin stated. Implemented at `ControlLab.tsx:325-352`.
8. **Pole map.** Draws where the closed loop's poles and zeros sit on the complex plane, with the unstable half shaded. Implemented at `ControlLab.tsx:356-363` (tab) and `ControlLab.tsx:526-593` (drawing). Engine: `controls.ts:173` (`poleZero`).
9. **Routh table.** Shows the stability table and says whether the loop is stable without finding the poles. Implemented at `ControlLab.tsx:364-389`. Engine: `controls.ts:608` (`routhHurwitz`).
10. **Tuning rule suggestion.** Shows what a standard tuning rule (Ziegler-Nichols and the others offered) would set the three gains to, beside the current values. It is shown, never applied. Implemented at `ControlLab.tsx:433-476`. Rule choice declared at `phase4.ts:222-227`. Engine: `controls.ts:767` (`tunePid`).
11. **Gain controls.** Proportional, integral and derivative gains (Kp, Ki, Kd). Declared at `phase4.ts:159`, `phase4.ts:161`, `phase4.ts:171`. Read at `ControlLab.tsx:142-144`.
12. **Plant entry.** Two boxes for the numerator and denominator of the plant's transfer function, with the plant written out as a fraction above the panel. Declared at `phase4.ts:144-157`. Read at `ControlLab.tsx:140-141`. Display at `ControlLab.tsx:118-133`.
13. **Output limits and anti-windup.** The most and least the actuator can give, and a switch for whether the integral term is stopped from building up while saturated. Declared at `phase4.ts:194-221`. Read at `ControlLab.tsx:148-150`.
14. **Setpoint, run length and time step.** The target value, how long to simulate, and the size of each simulation step. Declared at `phase4.ts:180-193`. Read at `ControlLab.tsx:145-147`.
15. **Worth knowing warnings.** Collects warnings from the step, frequency and simulation results into one list. Implemented at `ControlLab.tsx:478-487`.

---

## 3. Robot Arm Laboratory

- Id: `robot-lab`
- Catalogue entry: `src/shared/native/phase4.ts:544-593`
- Panel: `src/renderer/src/components/native/RobotLab.tsx`
- Calculations: `src/shared/compute/robotics.ts`

Features:

1. **Build and draw an arm.** Builds a flat arm from link lengths and starting joint angles, and draws each joint where the maths puts it. Implemented at `RobotLab.tsx:105-139` (links and angles) and `RobotLab.tsx:449-513` (drawing). Declared at `phase4.ts:236` (lengths) and `phase4.ts:244` (angles). Engine: `robotics.ts:186` (`forwardKinematics`).
2. **Gripper position readout.** Shows the x, y and z position of the gripper, and how far it is from the base out of the full reach. Implemented at `RobotLab.tsx:194-198` (header) and `RobotLab.tsx:294-323` (panel).
3. **Joint limits.** Sets how far each joint may turn, and shows which joints are past their limit. Declared at `phase4.ts:252` (limit) and `phase4.ts:274` (respect limits). Read at `RobotLab.tsx:107` and `RobotLab.tsx:111-112`. Warning at `RobotLab.tsx:220-228`.
4. **Reach a target point.** Works out the joint angles that put the gripper on a chosen point, and reports how close it got and how many tries it took. Declared at `phase4.ts:263` (switch) and `phase4.ts:270-272` (target x, y, z). Implemented at `RobotLab.tsx:147-176` (request) and `RobotLab.tsx:325-372` (panel). Engine: `robotics.ts:461` (`inverseKinematics`).
5. **Out-of-reach warning.** Says when the target is further away than the arm can reach, and that the arm is drawn reaching as far as it can. Implemented at `RobotLab.tsx:212-218`.
6. **Target marker.** Draws the target on the arm picture, marked as reached or not reached. Implemented at `RobotLab.tsx:493-499` and `RobotLab.tsx:507-509`.
7. **Reach circle.** Draws the circle the gripper can sweep, so the workspace can be seen. Implemented at `RobotLab.tsx:468-469`.
8. **Freedom of movement.** Shows how freely the gripper can move from the current pose, and warns when the arm is in a singular pose where a direction is lost. Implemented at `RobotLab.tsx:374-393`. Engine: `robotics.ts:344` (`jacobian`).
9. **Joint holding torque.** Shows how much turning force each joint must hold to keep the payload up, using the payload set on the panel. Declared at `phase4.ts:283` (payload). Read at `RobotLab.tsx:113` and `RobotLab.tsx:160`. Panel at `RobotLab.tsx:395-411`. Engine: `robotics.ts:772` (`staticTorques`).
10. **Joint move planner.** Plans a smooth move of one joint to a chosen angle over a chosen time, with a choice of speed shape (trapezoidal, cubic or quintic). Declared at `phase4.ts:294` (shape), `phase4.ts:302` (which joint), `phase4.ts:303` (angle), `phase4.ts:304` (time). Implemented at `RobotLab.tsx:115-117` and `RobotLab.tsx:242-262`. Engine: `robotics.ts:635` (`trajectory`).
11. **Speed and acceleration graphs.** Plots the speed and acceleration of the planned joint move, showing both go to zero at each end. Implemented at `RobotLab.tsx:264-284`.

---

## 4. Structures Laboratory

- Id: `structure-load-lab`
- Catalogue entry: `src/shared/native/phase4.ts:594-649`
- Panel: `src/renderer/src/components/native/StructureLoadLab.tsx`
- Calculations: beams in `src/shared/compute/beams.ts`; trusses in `src/shared/compute/statics.ts` (truss solver, section starting near line 490); the truss is run in the worker `src/renderer/src/components/native/engineering.worker.ts:466`.

Features:

1. **Beam support type.** Chooses a beam resting on two supports, fixed at one end, or overhanging. Declared at `phase4.ts:311-321`. Read at `StructureLoadLab.tsx:142` and placed at `StructureLoadLab.tsx:163-167`. Engine: `beams.ts:440` (`analyseBeam`).
2. **Beam length.** Sets the length of the beam. Declared at `phase4.ts:323`. Read at `StructureLoadLab.tsx:143`.
3. **Point load.** Sets the size and position of one load on the beam, which is drawn as an arrow. Declared at `phase4.ts:325` (size) and `phase4.ts:335` (position). Read at `StructureLoadLab.tsx:144-145`. Drawing at `StructureLoadLab.tsx:535-540`.
4. **Spread load.** Sets a load spread evenly along the beam. Declared at `phase4.ts:337`. Read at `StructureLoadLab.tsx:146`. Drawing at `StructureLoadLab.tsx:541-544`.
5. **Shear diagram.** Graph of the internal shear force along the beam, with the worst point marked. Implemented at `StructureLoadLab.tsx:270-278`.
6. **Bending moment diagram.** Graph of the bending moment along the beam, with the worst point and any points where bending reverses marked. Implemented at `StructureLoadLab.tsx:279-292`.
7. **Sag curve.** Graph of how far the beam bends down, with the worst sag and how it compares with the span. Implemented at `StructureLoadLab.tsx:293-312`. When the stiffness is unknown it says the sag cannot be worked out instead (`StructureLoadLab.tsx:313-319`).
8. **Exaggerated bent shape.** Draws the beam's bent shape, scaled up, with the scale stated on screen. Implemented at `StructureLoadLab.tsx:502-558` (`BeamView`), with the scale note at `StructureLoadLab.tsx:550-554`.
9. **Support reactions and self-check.** Lists the force at each support, and shows how well the calculation adds back up to the load. Implemented at `StructureLoadLab.tsx:330-348`.
10. **Section shape.** Chooses the cross-section of the beam (rectangle, circle or tube). Declared at `phase4.ts:348-355`. Read at `StructureLoadLab.tsx:147`. Section results at `StructureLoadLab.tsx:350-372`. Engine: `beams.ts:169` (`sectionProperties`).
11. **Section size.** Sets width, depth, diameter and wall thickness of the section. Declared at `phase4.ts:356-383`. Read at `StructureLoadLab.tsx:148-151`.
12. **Material.** Chooses the material of the beam, which sets its stiffness and yield strength. Declared at `phase4.ts:385-392`. Read at `StructureLoadLab.tsx:152`.
13. **Strength check.** Compares the worst bending stress with the stress the material gives way at, shows the margin, and warns when the beam would be permanently bent. Implemented at `StructureLoadLab.tsx:374-406`.
14. **Buckling warning.** When the beam is pushed along its length, shows the load at which it would buckle and its slenderness. Implemented at `StructureLoadLab.tsx:407-413`. Engine: `beams.ts:954` (`eulerBuckling`).
15. **Truss builder.** Builds a standard triangulated truss from the number of bays, the span and the depth. Declared at `phase4.ts:393-395`. Read at `StructureLoadLab.tsx:154-156`. Builder at `StructureLoadLab.tsx:111-135`.
16. **Truss load.** Sets the load hung at each interior joint of the truss. Declared at `phase4.ts:397`. Read at `StructureLoadLab.tsx:157`. Applied at `StructureLoadLab.tsx:132`.
17. **Truss drawing.** Draws each member coloured by whether it is pulled apart or squashed, with thickness showing the size of the force. Implemented at `StructureLoadLab.tsx:561-636`.
18. **Member force table.** Lists every member, its force in kilonewtons, and whether it is being pulled or squashed. Implemented at `StructureLoadLab.tsx:417-441`.
19. **Zero-force members.** Names the members carrying no force under this load and explains why they are there. Implemented at `StructureLoadLab.tsx:447-453`.
20. **Truss type warning.** Says when the truss is a mechanism that would fold, or has more members than it needs. Implemented at `StructureLoadLab.tsx:454-465`. Solver logic at `statics.ts:600-606`.
21. **Truss balance check.** Reports whether every joint balances, to a stated tolerance. Implemented at `StructureLoadLab.tsx:443-446`.
22. **Beam or truss switch.** Changes the whole panel between the beam view and the truss view. Implemented at `StructureLoadLab.tsx:140` and `StructureLoadLab.tsx:249-259`.

---

## Totals

- Laboratories: 4
- Features: 16 (Circuit) + 15 (Control) + 11 (Robot Arm) + 22 (Structures) = 64

Not included: the Optimiser (`src/shared/native/catalogue.ts:951-964`) is an engineering app but not a laboratory, so it is left out.
