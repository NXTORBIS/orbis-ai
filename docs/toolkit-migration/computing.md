# Computing laboratories: what each one does

Laboratories: 18. Features: 170.

How this was found: the main process builds its list of apps from `PHASE2_CATALOGUE` through `PHASE12_CATALOGUE` (src/main/native/service.ts:208, and src/shared/native/every.ts). Every app whose `domain` is `'computing'` is in this document. Each lab's on-screen part is in src/renderer/src/components/native/ and is wired in src/renderer/src/components/native/surfaces.tsx (lines 108-252). All file paths are relative to the repository root. Line numbers are as read in this session.

Retired labs: three computing labs are marked as superseded by the Computer Science Studio (Algorithm Laboratory, Cybersecurity Laboratory, Code Playground). They are out of the catalogue but still open for anybody who already has one on screen. Their sections are kept below and marked as retired.

Note on the Studio: src/shared/native/phase11.ts (lines 14-24) says the Studio supersedes sixteen laboratories. Only three of them carry the `supersededBy` marker in the code (phase2.ts:479, phase7.ts:361, phase9.ts:134). The other computing laboratories (processor, operating system, network, image, learning, neural, logic, compiler, automata, graphics, consensus) are still in the catalogue as separate apps.

---

## 1. Algorithm Laboratory (id: `algorithm-lab`) - RETIRED, superseded by cs-studio

File: src/shared/native/phase2.ts (declaration, lines 431-479). Screen: src/renderer/src/components/native/AlgorithmLab.tsx.

1. Run a sorting or searching method on your own list. Type numbers, press Start, and the method runs. (AlgorithmLab.tsx:220; phase2.ts:46-63)
2. Make a test list of a chosen shape and size, instead of typing one. Shapes include the worst cases for each method. (phase2.ts:75-92)
3. Get the same test list again by picking a seed number. (phase2.ts:95-102)
4. Play, pause, step forward, step back, jump to the start or jump to the end. (AlgorithmLab.tsx:223-241)
5. Set playback speed from 0.1 times to 128 times. (AlgorithmLab.tsx:245-249; SPEEDS at line 49)
6. Drag a slider to any step of the run. (AlgorithmLab.tsx:282-291)
7. Read a plain sentence saying what the current step is. (AlgorithmLab.tsx:301)
8. See the values as bars, with the ones already in their final place marked. (AlgorithmLab.tsx:512-548)
9. See a graph drawn for graph methods, and choose its shape and number of nodes. (AlgorithmLab.tsx:550-607; phase2.ts:164-188)
10. See a table being filled in, for methods that build a table. (AlgorithmLab.tsx:609-650)
11. See the call stack for recursive methods. (AlgorithmLab.tsx:680-699, heading "Call stack, here" at 382)
12. Follow the code line by line, with the current line marked. (AlgorithmLab.tsx:257-266 button; CodePanel at 436-466)
13. Watch the variables change as the run goes. (AlgorithmLab.tsx:267-273 button; VarsPanel at 468-496)
14. Read the method's complexity beside what was measured. (AlgorithmLab.tsx:354-370)
15. Count comparisons and swaps as they happen. (AlgorithmLab.tsx:498-510)
16. Open a full list of every comparison and swap, and click any one to jump to it. (AlgorithmLab.tsx:652-678)
17. Choose how quicksort picks its pivot. (phase2.ts:105-119)
18. Search a piece of text for a pattern with the simple method. (phase2.ts:121-137)
19. Set the size for the Tower of Hanoi or the queens puzzle. Both refuse past their own limit. (phase2.ts:139-150)
20. Set the knapsack capacity. (phase2.ts:151-161)

Feature count for this lab: 20.

---

## 2. Algorithm Comparison (id: `algorithm-compare`)

File: src/shared/native/phase2.ts (declaration, lines 482-510). Screen: src/renderer/src/components/native/AlgorithmCompare.tsx.

1. Pick two to six methods to race against each other. (phase2.ts:194-204; AlgorithmCompare.tsx:122)
2. Give every method the same kind of input. (phase2.ts:206-213)
3. Give every method the same size and seed, so the comparison is fair. (phase2.ts:215-233)
4. See a table of the work each method did. (AlgorithmCompare.tsx:130-186)
5. See how each method's work grows as the list gets longer, beside the textbook rate. (phase2.ts:235-242; GrowthTable at AlgorithmCompare.tsx:216-250)
6. See a method that refuses the input, with the reason, instead of having it left out. (AlgorithmCompare.tsx:103-116)

Feature count for this lab: 6.

---

## 3. Data Structures Laboratory (id: `structure-lab`)

File: src/shared/native/phase2.ts (declaration, lines 511-570). Screen: src/renderer/src/components/native/StructureLab.tsx.

1. Choose one of twelve structures to work with. (phase2.ts:267-276)
2. Type the keys to put into it. (phase2.ts:277-284; Build button at StructureLab.tsx:347)
3. Choose an operation, such as insert, find or remove. An operation the structure does not have is refused. (phase2.ts:285-294)
4. Type the value that operation works on. (phase2.ts:295-300)
5. Choose the order to visit a tree in: sorted or otherwise. (phase2.ts:302-319)
6. Choose what a hash table does when two keys land in the same slot. (phase2.ts:321-334)
7. Choose how many slots a hash table starts with. (phase2.ts:335-345)
8. Turn path flattening on or off for union-find. (phase2.ts:346-355)
9. Step through each recorded change with a slider and back and forward buttons. (StructureLab.tsx:353-380)
10. See the structure drawn as a row, a chain or a tree. (Row at StructureLab.tsx:141; Chain at 155; Tree at 184)
11. Read what the operation cost in steps and pointer changes. (StructureLab.tsx:469-495)
12. See how evenly the keys spread across a hash table. (StructureLab.tsx:502-523)
13. Run the same work on other structures and compare the costs. (phase2.ts:356-363; StructureLab.tsx:529-552)
14. Read what each structure is good at, what it is bad at, and what to watch for. (StructureLab.tsx:447-461)
15. Read what the laboratory does not do. (StructureLab.tsx:570)

Feature count for this lab: 15.

---

## 4. Database Laboratory (id: `sql-lab`)

File: src/shared/native/phase2.ts (declaration, lines 571-625). Screen: src/renderer/src/components/native/SqlLab.tsx.

1. Choose a practice database to start from. All its data is made up. (phase2.ts:369-381)
2. Write SQL and run it. (phase2.ts:383-389; query box at SqlLab.tsx:318; Run button at 337)
3. See the rows a query returns, in a table. Results stop at 2,000 rows with a note. (SqlLab.tsx:359-390)
4. Copy the result. (SqlLab.tsx:342)
5. See how the database decided to answer, and whether it used an index or read the whole table. (phase2.ts:391-398; SqlLab.tsx:407-415)
6. See how the tables relate to each other. (SqlLab.tsx:430)
7. Browse the tables, their columns and their indexes. (SqlLab.tsx:454-490)
8. Click a column to add its name to the query. (SqlLab.tsx:467-473)
9. Start from a list of ready-made queries. (SqlLab.tsx:498-505)
10. See a statement refused, with the reason, when it would open a file. (SqlLab.tsx:311-316)

Feature count for this lab: 10.

---

## 5. Digital Logic Laboratory (id: `logic-lab`)

File: src/shared/native/phase5.ts (declaration, lines 851-884). Screen: src/renderer/src/components/native/LogicLab.tsx.

1. Check a circuit is wired properly. Pick one of the built-in circuits. (phase5.ts:61-73; LogicLab.tsx:196)
2. Read each gate described in words. (LogicLab.tsx:222)
3. Build a truth table by running every input combination. (phase5.ts:53-56; LogicLab.tsx:241)
4. Reduce one output to the smallest expression that does the same job. (phase5.ts:75-82; capability at 866)
5. Run a clocked counter or shift register, one tick at a time. (phase5.ts:84-94, width at 97-105, ticks at 108-116)
6. See the signals over time as a chart. (LogicLab.tsx:287)
7. Step through the clock ticks one at a time. (LogicLab.tsx:306)
8. Get a warning when a circuit never settles. (LogicLab.tsx:172)

Feature count for this lab: 8.

---

## 6. Processor Laboratory (id: `processor-lab`)

File: src/shared/native/phase5.ts (declaration, lines 887-921). Screen: src/renderer/src/components/native/ProcessorLab.tsx.

1. Run a built-in sample program, which is assembled and then executed. (phase5.ts:124-130; capability at 900)
2. Turn passing results straight on between stages, or turn it off, and compare the cycle count. (phase5.ts:133-138; ProcessorLab.tsx:186)
3. Guess that branches are taken, which avoids throwing away the two instructions behind. (phase5.ts:141-146)
4. See the registers after each step. (ProcessorLab.tsx:304)
5. See the instructions moving through the five stages, with each stall marked. (ProcessorLab.tsx:233-269; capability at 901)
6. Set the cache: total size, words per line, and lines per set. (phase5.ts:149-176)
7. Choose which line the cache throws out when a set is full. (phase5.ts:179-185)
8. See every memory access in order, and whether the cache hit or missed. (ProcessorLab.tsx:316-334)

Feature count for this lab: 8.

---

## 7. Operating System Laboratory (id: `os-lab`)

File: src/shared/native/phase5.ts (declaration, lines 923-960). Screen: src/renderer/src/components/native/OsLab.tsx.

1. Choose which part of an operating system to look at: scheduling, memory, deadlock or a race. (phase5.ts:193-204)
2. Choose a scheduling policy for handing out the processor. (phase5.ts:207-214; OsLab.tsx:324)
3. Set how long a process may hold the processor in one turn (the slice). (phase5.ts:217-226)
4. Type the processes: name, arrival time, how long each needs, and how urgent it is. (phase5.ts:228-235)
5. See what each process got, and how long it waited. (OsLab.tsx:344)
6. Run several policies over the same work and compare them. (phase5.ts:237-244; OsLab.tsx:234)
7. Run a page-replacement policy over a list of page requests and count the faults. (phase5.ts:246-285; OsLab.tsx:380)
8. See whether adding memory would reduce the faults. (OsLab.tsx:276)
9. See who is waiting on whom, and whether everybody can still finish. (OsLab.tsx:439-456)
10. See what happens to a shared counter with and without a lock. (phase5.ts:288-316; OsLab.tsx:465)

Feature count for this lab: 10.

---

## 8. Network Laboratory (id: `network-lab`)

File: src/shared/native/phase5.ts (declaration, lines 962-998). Screen: src/renderer/src/components/native/NetworkLab.tsx.

1. Work out the network, broadcast and host range for an address and prefix length. (phase5.ts:341-358; NetworkLab.tsx:262)
2. Split a network into equal smaller networks. (phase5.ts:361-369; NetworkLab.tsx:302)
3. Build a network and see the route a message takes from one machine to another. (phase5.ts:372-382; NetworkLab.tsx:336)
4. See each machine and the cables between them. (NetworkLab.tsx:374, 388)
5. Unplug a cable and see what the route does. (phase5.ts:384-391)
6. Follow a protocol exchange message by message, for getting an address, looking up a name, opening a connection, or sharing one public address. (phase5.ts:394-402; NetworkLab.tsx:419)
7. See a sender find out how much a path can carry, with the sawtooth that results, under random loss. (phase5.ts:429-446; NetworkLab.tsx:482)
8. Check firewall rules and find the ones that can never match. (phase5.ts:974-979; NetworkLab.tsx:245)

Feature count for this lab: 8.

---

## 9. Image Laboratory (id: `image-lab`)

File: src/shared/native/phase5.ts (declaration, lines 1000-1034). Screen: src/renderer/src/components/native/ImageLab.tsx.

1. See the picture as its actual pixels. (ImageLab.tsx:45-67)
2. Apply a filter, such as a sharpen or an edge filter, pixel by pixel. (phase5.ts:473-487)
3. Blur the picture with a chosen radius. (phase5.ts:493-497)
4. Choose what happens to pixels at the edge of the picture. (phase5.ts:504-512)
5. Brighten or darken by an amount you choose. (phase5.ts:519-535)
6. Turn the picture into black and white at a threshold: chosen from the histogram, the average, or a level you set. (phase5.ts:542-559)
7. Find the edges, with the direction each one runs. (phase5.ts:594-610; capability at 1014)
8. Find the separate shapes and measure each one, counting touching corners as one shape or two. (phase5.ts:570-585; ImageLab.tsx:258)
9. See a histogram of how many pixels there are at each brightness. (ImageLab.tsx:237)

Feature count for this lab: 9.

---

## 10. Machine Learning Laboratory (id: `learning-lab`)

File: src/shared/native/phase5.ts (declaration, lines 1036-1071). Screen: src/renderer/src/components/native/LearningLab.tsx.

1. Choose a dataset and how much of it to hold back for testing. (phase5.ts:619-639; LearningLab.tsx:265)
2. Choose the model and its settings: how many neighbours, tree depth, number of groups, curve degree, learning rate and rounds. (phase5.ts:641-707)
3. Train the model and score it on data it never saw, beside a baseline that always guesses. (phase5.ts:1050-1051; LearningLab.tsx:311, 327)
4. See the scores for each class, not just one overall figure. (LearningLab.tsx:284)
5. See what was mistaken for what, in a table. (LearningLab.tsx:350)
6. Check whether the model learned or memorised, by comparing splits. (phase5.ts:718; LearningLab.tsx:216-237; capability at 1052)
7. See the loss fall while it trains. (LearningLab.tsx:393)
8. Find the main directions the data varies in. (phase5.ts:728; LearningLab.tsx:416; capability at 1053)

Feature count for this lab: 8.

---

## 11. Neural Network Laboratory (id: `neural-lab`)

File: src/shared/native/phase5.ts (declaration, lines 1073-1100). Screen: src/renderer/src/components/native/NeuralLab.tsx.

1. Choose the problem the network learns. (phase5.ts:742-750)
2. Set the number and size of hidden layers. (phase5.ts:752-758)
3. Choose the activation function for hidden layers and for the output. (phase5.ts:760-776)
4. Set the learning settings: learning rate, examples per step and momentum. (phase5.ts:778-811)
5. Train the network by gradient descent and record every step. (phase5.ts:1086; NeuralLab.tsx:284)
6. See how much it gets right over time. (NeuralLab.tsx:320)
7. See the boundary the network has learned, drawn over the training points. (NeuralLab.tsx:230-232; capability at 1087)
8. Check the gradients are right by nudging each weight. (phase5.ts:813; NeuralLab.tsx:197; capability at 1088)
9. See neurons that have stopped working. (NeuralLab.tsx:215)
10. See the gradient reaching the first layer. (NeuralLab.tsx:329)
11. See the network drawn layer by layer. (NeuralLab.tsx:352, 400)

Feature count for this lab: 11.

---

## 12. Compiler Laboratory (id: `compiler-lab`)

File: src/shared/native/phase7.ts (declaration, lines 256-289). Screen: src/renderer/src/components/native/CompilerLab.tsx.

1. Write a small program in a toy language. (phase7.ts:34-40; editor at CompilerLab.tsx:198)
2. Split the program into tokens, and see what kind each token is and how many there are. (CompilerLab.tsx:138; capability at phase7.ts:269)
3. See the tree the program is parsed into, where precedence is decided. (CompilerLab.tsx:181; capability at phase7.ts:270)
4. Run the program and see what it printed. (CompilerLab.tsx:123; capability at phase7.ts:271)
5. See the variables at the end of the run. (CompilerLab.tsx:102)

Feature count for this lab: 5.

---

## 13. Theory of Computation (id: `automata-lab`)

File: src/shared/native/phase7.ts (declaration, lines 291-325). Screen: src/renderer/src/components/native/AutomataLab.tsx.

1. Choose one of the built-in machines. Two of them are non-deterministic. (phase7.ts:48-57)
2. Feed a string to the machine one symbol at a time, and see whether it accepted or rejected, and why. (phase7.ts:59-66; AutomataLab.tsx:155)
3. See the machine's transition table. (AutomataLab.tsx:194)
4. Build the deterministic machine that does the same job as a non-deterministic one. (phase7.ts:305; AutomataLab.tsx:237)
5. Test every string up to a chosen length, to see what the machine really accepts. (phase7.ts:67-72; AutomataLab.tsx:270)

Feature count for this lab: 5.

---

## 14. Cybersecurity Laboratory (id: `crypto-lab`) - RETIRED, superseded by cs-studio

File: src/shared/native/phase7.ts (declaration, lines 326-362). Screen: src/renderer/src/components/native/CryptoLab.tsx.

1. Work out a SHA-256 digest of a message, and see the rounds that produced it. (phase7.ts:82-87; CryptoLab.tsx:152-163)
2. Compare two messages and count how many of the 256 bits change. (phase7.ts:90-96; CryptoLab.tsx:120, 158)
3. Encode a message in Base64. (phase7.ts:83-87; CryptoLab.tsx:195)
4. See the same bytes in hexadecimal. (CryptoLab.tsx:197)
5. Shift letters with a Caesar cipher by a chosen amount. (phase7.ts:99-104; CryptoLab.tsx:209)
6. Apply ROT13. (CryptoLab.tsx:211)
7. Try all twenty-six Caesar shifts to break a cipher. (CryptoLab.tsx:222; capability at phase7.ts:341)
8. Encipher with XOR using a repeating key, and reverse it. (phase7.ts:109-115; CryptoLab.tsx:250-253)

Feature count for this lab: 8.

---

## 15. Computer Graphics (id: `graphics-lab`)

File: src/shared/native/phase7.ts (declaration, lines 363-397). Screen: src/renderer/src/components/native/GraphicsLab.tsx.

1. Choose a shape to put through the pipeline: a cube, a sphere, a torus and so on. (phase7.ts:122-127)
2. Turn the shape around each of the three axes. (phase7.ts:131-133)
3. Set the detail of a curved shape: more bands is rounder and slower. (phase7.ts:134-139)
4. Set the camera's distance from the shape. (phase7.ts:146)
5. Set the field of view, wide or narrow. (phase7.ts:147-152)
6. Switch between perspective and orthographic projection, and see the far side stop shrinking. (phase7.ts:159-164; GraphicsLab.tsx:155-157)
7. Hide the faces that point away from the camera. (phase7.ts:167-172; GraphicsLab.tsx:61, 86)
8. See the same four points at each stage of the pipeline. (GraphicsLab.tsx:164)
9. See the three matrices that do the work. (GraphicsLab.tsx:204)

Feature count for this lab: 9.

---

## 16. Distributed Systems (id: `consensus-lab`)

File: src/shared/native/phase7.ts (declaration, lines 398-433). Screen: src/renderer/src/components/native/ConsensusLab.tsx.

1. Choose how many machines are in the cluster. (phase7.ts:180)
2. Set the seed, which decides which machine times out first and makes a run repeatable. (phase7.ts:181)
3. Run the cluster until it elects a leader, and read a summary of what happened. (ConsensusLab.tsx:138; capability at phase7.ts:411)
4. Crash a machine, or bring one back. (phase7.ts:182-205)
5. Split the network into two sides, and see which side can still decide anything. (phase7.ts:209-214; ConsensusLab.tsx:151-152)
6. Propose a value and see it committed once a majority holds it. (phase7.ts:218-223; ConsensusLab.tsx:180)
7. See what each machine holds. (ConsensusLab.tsx:210)
8. Read the full record of everything that happened. (ConsensusLab.tsx:240)

Feature count for this lab: 8.

---

## 17. Code Playground (id: `code-playground`) - RETIRED, superseded by cs-studio

File: src/shared/native/phase9.ts (declaration, lines 82-134). Screen: src/renderer/src/components/native/CodePlaygroundLab.tsx.

1. Pick the programming language. Twenty are offered. (phase9.ts:31-40; CodePlaygroundLab.tsx:210-212)
2. Write the program. (phase9.ts:41-48; editor at CodePlaygroundLab.tsx:311)
3. Type the input the program reads, one value per line. (phase9.ts:49-56; CodePlaygroundLab.tsx:338-343)
4. Run the program in a sandbox and see exactly what it printed. (CodePlaygroundLab.tsx:226; capability at phase9.ts:111)
5. Ask Orion to say what the program would print, as a labelled guess, without running it. (phase9.ts:57-62; CodePlaygroundLab.tsx:230)
6. See the output, or the errors, or the reason it would not compile. (CodePlaygroundLab.tsx:270-282)
7. See the list of languages and which can really be run. (CodePlaygroundLab.tsx:350; capability at phase9.ts:113)
8. See where the answer came from: a sandbox run, or a reading. (CodePlaygroundLab.tsx:376)
9. Read what the playground does not do. (CodePlaygroundLab.tsx:386)

Feature count for this lab: 9.

---

## 18. Computer Science Studio (id: `cs-studio`)

File: src/shared/native/phase11.ts (declaration, lines 106-205). Screen shell: src/renderer/src/components/native/CSStudio.tsx. Section pages: src/renderer/src/cs/. Section list: src/shared/cs/sections.ts.

The Studio is one app with many sections. Its declared abilities are at phase11.ts:167-177. Its sections are listed at sections.ts:23-46. Labs.jsx lines 13-27 mark most of its areas as not yet built. Only the areas marked available are counted below.

1. Show an algorithm running step by step, with its array, variables, the code line and a count of comparisons and swaps. Ninety-two methods are traced in the Algorithms and DSA section. (phase11.ts:167; sections.ts:62-116)
2. Count the real work an algorithm did on a given input. (phase11.ts:168)
3. Compare the same input across several algorithms. (phase11.ts:169)
4. Build and walk a data structure one operation at a time. (phase11.ts:170)
5. Open a coding problem with its tests, write a solution and have it judged. (phase11.ts:171; sections.ts:25)
6. Write a program in any language and have it read or run. (phase11.ts:172; sections.ts:28)
7. Ask for a labelled prediction of what a program would print. (phase11.ts:173)
8. Hash, encode or encipher a message, and measure how strong a password is. (phase11.ts:175)
9. Set a model's settings, train it and see what it predicts. (phase11.ts:176)
10. Work through computer science lessons, with completed lessons recorded. (phase11.ts:177; sections.ts:24)
11. Take a daily challenge. (sections.ts:26)
12. Enter contests. (sections.ts:27)
13. See progress and achievements. (sections.ts:45-46)

Feature count for this lab: 13.

Not counted: the Studio's other areas (electronics, architecture, operating systems, networks, databases, compilers, theory, cybersecurity, AI and machine learning, data science, graphics, distributed systems and software engineering) are marked not built in src/renderer/src/cs/Labs.jsx:16-27. The Orbis laboratories above do the work for several of them.

---

Total: 18 laboratories, 170 features. Count per lab: algorithm-lab 20, algorithm-compare 6, structure-lab 15, sql-lab 10, logic-lab 8, processor-lab 8, os-lab 10, network-lab 8, image-lab 9, learning-lab 8, neural-lab 11, compiler-lab 5, automata-lab 5, crypto-lab 8, graphics-lab 9, consensus-lab 8, code-playground 9, cs-studio 13.

Sum check: 20+6+15+10+8+8+10+8+9+8+11+5+5+8+9+8+9+13 = 170.
