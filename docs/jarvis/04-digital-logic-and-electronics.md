# J.A.R.V.I.S. — Digital Logic Lab (`/digital-logic-lab`) and Electronics Lab (`/electronics-lab`)

## Digital Logic Lab — a real breadboard, not a diagram

The index's own keywords for it: *digital, logic, **breadboard**, gates, flip-flop, **ic**, truth table, electronics,
circuit, simulator, **placement**, **multi-selection**, **shortcuts**, **copy paste**, **retractable panel***.

**Two views:** **Breadboard** and **Schematic**.

The breadboard is drawn properly: 30 columns, rows **a–j** split by the centre channel, and **+/− power rails** top
and bottom. Parts are placed into holes.

**Toolbar:** Code · Help · Clear · Hide instruments · Hide components · **Start Simulation**.

**Canvas tools:** Select / wire tool · Hand / pan tool · Zoom in · Zoom out · Reset view · **Fullscreen**.

**Status line:** `STOPPED` · `t = 0.000 s` · `0 parts · 0 wires` — a real clock, so it is a timed simulation.

**Instrument tabs (5):** **Oscilloscope** (CH1–CH4, "Place a Scope Probe on a node to capture", "No probes
connected") · **Multimeter** · **Logic Analyzer** · **Truth Table** · **Console**.

**Starter circuits** (one click each):
- Two toggles into an AND gate driving an LED
- XOR of two toggles — LED on when inputs differ
- Sum (XOR) and Carry (AND) of two inputs
- Clock and D input into a D flip-flop, Q drives an LED
- Quad-NAND IC — gate 1 used as a NAND, driving an LED
- Two inputs select one of four outputs (logic probes)

**Component palette** — searchable ("Search components…"), drag to the breadboard or click to add, in six groups:

| Group | Parts |
| --- | --- |
| **Input** | Push Button · Clock · Logic HIGH · Logic LOW · Toggle Switch · Photoresistor · Temp Sensor |
| **Output** | LED · 7-Segment · Buzzer · Logic Probe · Binary Display |
| **Instruments** | Multimeter (V) · Multimeter (A) · Oscilloscope Probe |
| **Integrated Circuits** | Op-Amp (741) · 74HC00 NAND · 74HC02 NOR · 74HC04 Inverter · 74HC08 AND · 74HC32 OR · 74HC86 XOR |
| **Logic** | AND · OR · NAND · NOR · XOR · XNOR · NOT · Buffer · 2:1 MUX · 1:2 DEMUX · 2:4 Decoder · Half Adder · Full Adder |
| **Sequential** | D Flip-Flop · SR Latch · Binary Counter · D Latch · JK Flip-Flop · T Flip-Flop · Shift Register |

42 distinct parts. Real 74HC-series part numbers, a real op-amp, and real sensors (photoresistor, temperature).

## Electronics Lab (`/electronics-lab`)

Listed on the CS labs page as **Available**: *"Analog circuit design with a real MNA simulation engine."*
(MNA = modified nodal analysis — the method SPICE uses.)

## How Orbis compares

Orbis's Digital Logic Laboratory picks a blueprint from a list and shows the gates, a truth table and waveforms. It
has **no breadboard, no placement, no wiring, no instruments, no ICs, no analogue parts and no clock**. JARVIS's is a
circuit construction environment; ours is a circuit viewer.
