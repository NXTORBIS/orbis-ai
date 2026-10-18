# Systems subject: 5 laboratories, 64 features

Paths below are relative to `src/`. Line numbers are the start of each piece of code.

**Which labs count as "systems".** The catalogue has no app with the domain `systems` (`src/shared/native/manifest.ts:52`). Phase 5 is described as "systems and intelligence" (`src/shared/native/phase5.ts:12`). This list takes the systems half: digital logic, the processor, the operating system and the network. It also takes Distributed Systems from Phase 7, which is named as a systems lab. Image, Machine Learning and Neural Network labs are left out. They run in the intelligence worker (`components/native/intelligence.worker.ts`), and the Phase 5 header groups them with intelligence.

Each feature has a "where it is shown" line (the screen) and a "where it is computed" line (the engine). The worker dispatch is in `renderer/src/components/native/systems.worker.ts` and `cs.worker.ts`.

---

## 1. Digital Logic Laboratory

- **Id:** `logic-lab`
- **Lab file:** `renderer/src/components/native/LogicLab.tsx`
- **Catalogue entry:** `shared/native/phase5.ts:852`
- **Parameters:** `shared/native/phase5.ts:45-121`
- **Worker dispatch:** `renderer/src/components/native/systems.worker.ts:187` (case `logic`)
- **Engine:** `shared/compute/logic.ts`

1. **Pick a built-in circuit.** Choose one of twelve ready circuits, such as a half adder, a ripple adder or an SR latch, and see how it is built from gates.
   - Shown: parameter `phase5.ts:61`. Computed: `logic.ts:611` (list), `logic.ts:641` (`blueprint`), worker `systems.worker.ts:211`.
2. **See the circuit and its settled outputs.** The picture of the chosen circuit, with the value each wire settles to.
   - Shown: `LogicLab.tsx:148` ("The circuit"). Computed: `logic.ts:318` (`evaluate`), worker `systems.worker.ts:223`.
3. **Check the wiring.** Says whether the circuit is wired properly, and flags wiring problems or a circuit that never settles because it loops back on itself.
   - Shown: `LogicLab.tsx:172` ("It never settles"), `LogicLab.tsx:189` ("Problems with the wiring"). Computed: `logic.ts:157` (`checkNetwork`), `logic.ts:243` (loop detection), worker `systems.worker.ts:213`.
4. **Explain every gate in words.** A plain-language line for each gate in the circuit.
   - Shown: `LogicLab.tsx:222` ("Every gate, in words").
5. **Truth table.** Runs the circuit for every input combination and lists the results. Not offered for a circuit with memory in it.
   - Shown: `LogicLab.tsx:241` ("Every combination, run"). Computed: `logic.ts:404` (`truthTable`), worker `systems.worker.ts:218`.
6. **Smallest expression.** Reduces one chosen output to the shortest Boolean expression that gives the same results.
   - Shown: `LogicLab.tsx:161` ("The smallest expression"). Parameter: `phase5.ts:75` ("Reduce which output"). Computed: `logic.ts:478` (`simplify`), worker `systems.worker.ts:219-222`.
7. **Clocked circuit choice.** Pick a counter or a shift register.
   - Parameter: `phase5.ts:84`. Computed: `logic.ts:995` (`counter`), `logic.ts:1017` (`shiftRegister`), worker `systems.worker.ts:188-190`.
8. **Width of the clocked circuit.** How many flip-flops it has.
   - Parameter: `phase5.ts:97`. Computed: `logic.ts:995` and `logic.ts:1017`.
9. **Signals over time.** A chart of each signal across the clock ticks.
   - Shown: `LogicLab.tsx:287` ("The signals over time"). Computed: `logic.ts:900` (`runClocked`), worker `systems.worker.ts:198-204`.
10. **Number of ticks.** How many clock edges to run.
    - Parameter: `phase5.ts:108`. Shown in the tick view.
11. **Tick-by-tick stepper.** A slider and buttons to move through the ticks one at a time.
    - Shown: `LogicLab.tsx:306-314` ("Tick by tick", slider at 308), buttons at `LogicLab.tsx:348-353`.

Features in this lab: **11**.

---

## 2. Processor Laboratory

- **Id:** `processor-lab`
- **Lab file:** `renderer/src/components/native/ProcessorLab.tsx`
- **Catalogue entry:** `shared/native/phase5.ts:888`
- **Parameters:** `shared/native/phase5.ts:122-190`
- **Worker dispatch:** `renderer/src/components/native/systems.worker.ts:230` (case `processor`)
- **Engine:** `shared/compute/processor.ts`

1. **Pick a sample program.** Choose one of eight ready programs: count, sum of an array, max of an array, factorial, Fibonacci, load-use, branch-heavy, stride walk.
   - Parameter: `phase5.ts:124`. Computed: `processor.ts:1095` (list), `processor.ts:1117` (`sample`), worker `systems.worker.ts:232-236`.
2. **Assemble and run the program.** Turns the program text into instructions and runs it, with a cost summary ("What it cost").
   - Shown: `ProcessorLab.tsx:172`. Computed: `processor.ts:187` (`assemble`), `processor.ts:665` (`run`), worker `systems.worker.ts:240-251`.
3. **Pipeline schedule.** A grid showing which of the five stages (fetch, decode, execute, memory, write back) each instruction is in on each cycle.
   - Shown: `ProcessorLab.tsx:233-250` (tab "The pipeline", `ProcessorLab.tsx:155`). Computed: `processor.ts:928` (`pipeline`), `processor.ts:866` (stages).
4. **Pass results straight on (forwarding).** Switch that lets a result go to the next instruction without waiting for write back. The lab always computes both schedules, so the cycle difference is shown.
   - Parameter: `phase5.ts:133`. Shown: `ProcessorLab.tsx:186` ("What passing results on is worth"). Computed: worker `systems.worker.ts:258-260`, `processor.ts:928`.
5. **Guess that branches are taken.** Switch that changes how branches are predicted, and the cost of a wrong guess.
   - Parameter: `phase5.ts:141`. Computed: `processor.ts:928` (option `predictTaken`), worker `systems.worker.ts:258-260`.
6. **Where it had to wait.** A list of the stalls: which instruction waited, and for what.
   - Shown: `ProcessorLab.tsx:269` ("Where it had to wait").
7. **Step through the instructions.** A slider to move through the run one instruction at a time, with the line of code each one came from.
   - Shown: `ProcessorLab.tsx:288-294` (slider), `ProcessorLab.tsx:239` (line numbers).
8. **Registers view.** The value of every register at the chosen step.
   - Shown: `ProcessorLab.tsx:304` ("Registers").
9. **Memory view.** The memory locations the program touched and their values.
   - Shown: `ProcessorLab.tsx:316` ("Memory it touched").
10. **Every memory access.** The list of memory reads and writes in order, each marked as a cache hit or miss.
    - Shown: `ProcessorLab.tsx:334-343` (tab "The cache" at `ProcessorLab.tsx:157`). Computed: `processor.ts:665` (`run`).
11. **Cache size.** Total words the cache holds.
    - Parameter: `phase5.ts:149`. Computed: `processor.ts:510` (class `Cache`).
12. **Words per cache line.** How many words are fetched together.
    - Parameter: `phase5.ts:159`. Computed: `processor.ts:510`.
13. **Lines per set (associativity).** One gives a direct-mapped cache; more gives a set-associative one.
    - Parameter: `phase5.ts:169`. Computed: `processor.ts:510`.
14. **Which line to evict.** Least recently used, first in first out, or random.
    - Parameter: `phase5.ts:179`. Computed: `processor.ts:464` (`REPLACEMENTS`), `processor.ts:510`.
15. **Cache hit rate.** The count of hits, misses, cold misses and conflict misses, with the hit rate as a percentage.
    - Shown: `ProcessorLab.tsx:213` (panel "The cache"), `ProcessorLab.tsx:226` (notes). Computed: `processor.ts:581-616`.

Features in this lab: **15**.

---

## 3. Operating System Laboratory

- **Id:** `os-lab`
- **Lab file:** `renderer/src/components/native/OsLab.tsx`
- **Catalogue entry:** `shared/native/phase5.ts:924`
- **Parameters:** `shared/native/phase5.ts:191-320`
- **Worker dispatch:** `renderer/src/components/native/systems.worker.ts:267` (case `scheduling`)
- **Engine:** `shared/compute/scheduling.ts`

1. **Who had the processor (Gantt chart).** A timeline showing which process ran at each moment.
   - Shown: `OsLab.tsx:324` ("Who had the processor"). Computed: `scheduling.ts:202` (`schedule`), worker `systems.worker.ts:276-281`.
2. **What each process got.** A table of each process's waiting time and turnaround, and who was left waiting.
   - Shown: `OsLab.tsx:344` ("What each one got"), `OsLab.tsx:224` ("Left waiting").
3. **Scheduling policy and slice length.** Choose the policy (first come, shortest job, round robin and others) and the time slice that round robin uses.
   - Parameters: policy `phase5.ts:207`, slice `phase5.ts:217`, processes `phase5.ts:228`. Computed: `scheduling.ts:66` (`POLICIES`), `scheduling.ts:202`.
4. **Compare policies side by side.** Runs the same processes through other policies and shows how each one did.
   - Parameter: `phase5.ts:237`. Shown: `OsLab.tsx:234` ("Against the others"). Computed: `scheduling.ts:444` (`comparePolicies`), worker `systems.worker.ts:278`.
5. **Page replacement fault count.** Runs a list of page requests through limited memory and counts the page faults.
   - Parameters: `phase5.ts:246` (pages), `phase5.ts:255` (frames), `phase5.ts:266` (policy). Shown: `OsLab.tsx:263` ("Page faults"). Computed: `scheduling.ts:520` (`paging`), worker `systems.worker.ts:283-288`.
6. **What memory holds, reference by reference.** Step-by-step view of the frames after each page request.
   - Shown: `OsLab.tsx:380` ("What was in memory, reference by reference"), `OsLab.tsx:406` ("The same thing, as numbers").
7. **Does more memory help?** Checks whether adding a frame ever makes faults worse, which can happen with first in first out.
   - Shown: `OsLab.tsx:276` ("Does more memory help?"). Computed: `scheduling.ts:700` (`beladyCheck`), worker `systems.worker.ts:286`.
8. **Deadlock detection.** Shows a circular wait between two processes that each hold one resource and want the other's.
   - Shown: `OsLab.tsx:439` ("Who is waiting on what"). Computed: `scheduling.ts:750` (`findDeadlock`), worker `systems.worker.ts:289-296`.
9. **Safe-state check (banker's algorithm).** Says whether every process can still finish, given what each holds and may still need.
   - Shown: `OsLab.tsx:295` ("Is the state safe?"), `OsLab.tsx:456` ("Can everybody still finish?"). Computed: `scheduling.ts:854` (`bankersCheck`), worker `systems.worker.ts:297-312`.
10. **Race condition without a lock.** Two or more processes add to one shared counter with no lock, and the lab shows the interleaving and the lost increments.
    - Parameters: rounds `phase5.ts:253`, workers `phase5.ts:264`. Shown: `OsLab.tsx:307` ("The counter"), `OsLab.tsx:465` ("Without a lock"). Computed: `scheduling.ts:957` (`race`), worker `systems.worker.ts:319`.
11. **Race condition with a lock.** Same race with a lock switched on, so the increments are no longer lost.
    - Parameter: `phase5.ts:244` ("Use a lock"). Shown: `OsLab.tsx:465` ("With a lock"). Computed: `scheduling.ts:957`, worker `systems.worker.ts:320`.

Features in this lab: **11**.

---

## 4. Network Laboratory

- **Id:** `network-lab`
- **Lab file:** `renderer/src/components/native/NetworkLab.tsx`
- **Catalogue entry:** `shared/native/phase5.ts:963`
- **Parameters:** `shared/native/phase5.ts:322-455`
- **Worker dispatch:** `renderer/src/components/native/systems.worker.ts:341` (case `networking`)
- **Engine:** `shared/compute/networking.ts`

Nothing here touches a real network. Every address, route and packet is made up inside the model.

1. **Subnet calculator.** Gives the network address, broadcast address, mask and host range for an address and prefix length.
   - Parameters: address `phase5.ts:341`, prefix `phase5.ts:350`. Shown: `NetworkLab.tsx:191` ("The arithmetic"), `NetworkLab.tsx:262` ("Where the network ends and the host begins"). Computed: `networking.ts:109` (`subnet`), worker `systems.worker.ts:350-354`.
2. **Split a block into equal subnets.** Divides a block into a chosen number of smaller networks.
   - Parameter: `phase5.ts:361`. Shown: `NetworkLab.tsx:302` ("Split into"). Computed: `networking.ts:197` (`splitBlock`), worker `systems.worker.ts:352-353`.
3. **Network layout.** Choose a ready arrangement (two hosts, small office, two networks, star, ring and others) and see its devices and cables.
   - Parameter: `phase5.ts:372`. Shown: `NetworkLab.tsx:336` ("The network"). Computed: `networking.ts:991` (`shape`), `networking.ts:272` (`checkTopology`), worker `systems.worker.ts:355-361`.
4. **Each machine.** The list of devices in the chosen layout, with what kind each one is (host, switch, router, server).
   - Shown: `NetworkLab.tsx:374` ("Each machine"). Computed: `networking.ts:226` (`DEVICE_ABOUT`).
5. **Cables.** The list of links between the devices.
   - Shown: `NetworkLab.tsx:388` ("The cables").
6. **Route a packet.** Work out the path a packet takes from one machine to another, with a set of "from" and "to" boxes.
   - Parameters: from `phase5.ts:381`, to `phase5.ts:382`. Shown: `NetworkLab.tsx:209` ("The route"). Computed: `networking.ts:380` (`findRoute`), worker `systems.worker.ts:361`.
7. **Unplug a device.** Pulls every cable from a named device so that a route can be watched changing, or failing.
   - Parameter: `phase5.ts:384`. Computed: worker `systems.worker.ts:357-371` (marks the links down), `networking.ts:380`.
8. **Get an address (exchange).** Follows the message exchange that gives a machine an address (the catalogue describes it as four messages over two round trips). The message-by-message view is shown here.
   - Parameter: `phase5.ts:393` (value `address`). Shown: `NetworkLab.tsx:419` ("Message by message"). Computed: `networking.ts:488` (`addressAssignment`), worker `systems.worker.ts:374-375`.
9. **Look a name up.** Follows the walk from the root servers down to the answer for a name.
   - Parameter: `phase5.ts:393` (value `name`). Shown: `NetworkLab.tsx:419`. Computed: `networking.ts:545` (`nameLookup`), worker `systems.worker.ts:376`.
10. **Name lookup cache.** Shows that a cached answer takes one step rather than four.
    - Parameter: `phase5.ts:408` ("Already cached"). Computed: `networking.ts:545` (option `cached`), worker `systems.worker.ts:376`.
11. **Open and close a connection (handshake).** Follows the three-way handshake and its close.
    - Parameter: `phase5.ts:393` (value `handshake`). Computed: `networking.ts:952` (`handshake`), worker `systems.worker.ts:377`.
12. **Translate many machines to one public address (NAT).** Shows several private machines sharing one public address.
    - Parameter: `phase5.ts:393` (value `translation`). Computed: `networking.ts:673` (`translate`), worker `systems.worker.ts:378-384`.
13. **Cost of the route.** A panel giving what the chosen route costs.
    - Shown: `NetworkLab.tsx:222` ("What it cost").
14. **Congestion sawtooth.** A chart of how much is in flight over the rounds, showing the sender finding the path's limit and backing off on loss.
    - Shown: `NetworkLab.tsx:233` ("How well it used the path"), `NetworkLab.tsx:451` (plot "How much is in flight"). Computed: `networking.ts:872` (`congestion`), worker `systems.worker.ts:388-395`.
15. **Congestion settings.** Set the capacity of the path, how many rounds to run, and the amount of random loss unrelated to congestion.
    - Parameters: `phase5.ts:417` (capacity), `phase5.ts:428` (rounds), `phase5.ts:439` (random loss). Computed: `networking.ts:872`.
16. **Firewall rules that can never match.** Lists rules that a later rule always hides, so they can never apply.
    - Shown: `NetworkLab.tsx:245` ("Rules that can never match"). Computed: `networking.ts:748` (`firewall`), worker `systems.worker.ts:396-411`.
17. **What got through the firewall.** Applies the rule list to a set of sample packets and shows which were allowed or blocked.
    - Shown: `NetworkLab.tsx:482` ("What got through"). Computed: `networking.ts:748`.

Features in this lab: **17**.

---

## 5. Distributed Systems Laboratory

- **Id:** `consensus-lab`
- **Lab file:** `renderer/src/components/native/ConsensusLab.tsx`
- **Catalogue entry:** `shared/native/phase7.ts:399` (named "Distributed Systems")
- **Parameters:** `shared/native/phase7.ts:179-227`
- **Worker dispatch:** `renderer/src/components/native/cs.worker.ts:260` (case `consensus`)
- **Engine:** `shared/cs/consensus.ts`

1. **Build a cluster.** Sets how many machines there are (1 to 9) and a seed that decides which node times out first. The same seed gives the same run. Starting again also comes through here.
   - Parameters: `phase7.ts:180` (nodes), `phase7.ts:181` (seed), start again `phase7.ts:188` ("make"). Computed: `consensus.ts:89` (`makeCluster`), worker `cs.worker.ts:261-268`.
2. **Run until a leader is elected.** Runs the cluster until one node is elected leader, with every vote kept.
   - Parameter: `phase7.ts:183` ("settle"). Computed: `consensus.ts:242` (`settle`), worker `cs.worker.ts:279`.
3. **One tick.** Advances the cluster by a single step.
   - Parameter: `phase7.ts:183` ("step"). Computed: `consensus.ts:132` (`step`), worker `cs.worker.ts:276`.
4. **Crash a node.** Stops one named node, and the rest react to it.
   - Parameters: `phase7.ts:201` (which node), `phase7.ts:183` ("crash"). Computed: `consensus.ts:251` (`crash`), worker `cs.worker.ts:282`.
5. **Bring a node back.** Restarts a crashed node.
   - Parameter: `phase7.ts:183` ("recover"). Computed: `consensus.ts:277` (`recover`), worker `cs.worker.ts:285`.
6. **Split the cluster.** Divides the nodes into two sides that can talk only within each side.
   - Parameter: `phase7.ts:210` ("Split off"), `phase7.ts:183` ("partition"). Shown: the "Can decide" value in `ConsensusLab.tsx:66`. Computed: `consensus.ts:296` (`partition`), worker `cs.worker.ts:288`.
7. **Heal the split.** Reconnects the two sides.
   - Parameter: `phase7.ts:183` ("heal"). Computed: `consensus.ts:320` (`heal`), worker `cs.worker.ts:291`.
8. **Propose a value.** Sends a value to the leader, which commits it only after a majority holds it.
   - Parameter: `phase7.ts:219` ("Value to agree"), `phase7.ts:183` ("propose"). Computed: `consensus.ts:329` (`propose`), worker `cs.worker.ts:294`.
9. **Status panel.** Shows the current leader, term, nodes up, the majority needed, whether the cluster can still decide, and how many failures it survives.
   - Shown: `ConsensusLab.tsx:119-129` ("Now"), `ConsensusLab.tsx:70` (survival text). Computed: `consensus.ts:377` (`describe`), `consensus.ts:119` (`majority`).
10. **Replicated log.** The list of committed entries.
    - Shown: `ConsensusLab.tsx:180` ("The replicated log") (tab "The log", `ConsensusLab.tsx:51`).
11. **What each node holds.** The log, term and role of each node.
    - Shown: `ConsensusLab.tsx:210` ("What each node holds").
12. **Event history.** A running list of what happened in the cluster, in order.
    - Shown: `ConsensusLab.tsx:240` ("Everything that happened") (tab "What happened", `ConsensusLab.tsx:52`).

Features in this lab: **12**.

---

## Totals

- Laboratories: **5**
- Features: **64** (logic 11, processor 15, operating system 11, network 17, distributed systems 12)

## Excluded from this subject

- **Image Laboratory** (`image-lab`, `phase5.ts:1001`). Imaging, run in `intelligence.worker.ts:201`. Listed under intelligence in the Phase 5 header.
- **Learning Laboratory** (`learning-lab`) and **Neural Network Laboratory** (`neural-lab`). Machine learning, run in `intelligence.worker.ts:285` and `:405`.
- **Theory of Computation, Compiler, Cybersecurity, Computer Graphics** (Phase 7). Computing topics, not systems.
