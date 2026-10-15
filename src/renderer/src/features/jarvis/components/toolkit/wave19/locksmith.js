import { D, F, M, O, T } from '@jarvis/components/toolkit/wave19/model';

const bottomPinMm = (plugDiameterMm, cutDepthMm, keywayOffsetMm) => Math.max(0, plugDiameterMm - cutDepthMm - keywayOffsetMm);
const driverPinMm = (chamberDepthMm, bottomPin) => Math.max(0, chamberDepthMm - bottomPin);
const macsViolations = (cuts, macs) => cuts.slice(1).reduce((sum, cut, i) => sum + (Math.abs(cut - cuts[i]) >= macs ? 1 : 0), 0);
const largestStep = (cuts) => cuts.slice(1).reduce((max, cut, i) => Math.max(max, Math.abs(cut - cuts[i])), 0);
const keyCombinations = (depths, cuts) => Math.pow(depths, cuts);
const duplicateAt50 = (combinations) => Math.sqrt(2 * combinations * Math.log(2));
const masterPins = (levels, cuts) => Math.max(0, (levels - 1) * cuts);
const boltEngagementMm = (boltLengthMm, gapMm, strikeDepthMm) => Math.max(0, Math.min(boltLengthMm - gapMm, strikeDepthMm));
const openingForceN = (closerForceN, doorWidthMm, doorMassKg) => closerForceN * (1 + Math.max(0, doorWidthMm - 900) / 2000) + doorMassKg * 9.81 * .03;
const egressMinutes = (occupants, exitRatePerMetreMin, doorWidthMm) => occupants / Math.max(exitRatePerMetreMin * (doorWidthMm / 1000), .01);
const safeCombinations = (dialNumbers, wheels) => Math.pow(dialNumbers, wheels);
const keyCost = (blankCostEach, machineSecondsPerKey, hourlyRate) => blankCostEach + machineSecondsPerKey / 3600 * hourlyRate;
const exposureKeys = (keysIssued, masterSharePct, lossRatePctPerYear, years) => keysIssued * masterSharePct / 100 * lossRatePctPerYear / 100 * years;
const storageTb = (cameras, bitrateMbps, days) => cameras * bitrateMbps * 1e6 * 86400 * days / 8 / 1e12;
const entriesPerMinute = (users, peakSharePct, peakMinutes) => users * peakSharePct / 100 / Math.max(peakMinutes, .01);
const securityScore = (doorGrade, frameGrade, lockGrade, glassScore, lightingScore) => (doorGrade + frameGrade + lockGrade) / 15 * 70 + (glassScore + lightingScore) / 10 * 30;

export const locksmithTools = [
D({ id: 'lock-pin-stack', sweep: 'cutDepthMm', fields: [F('plugDiameterMm','Plug diameter (mm)',12.7,8,30,.1),F('cutDepthMm','Depth of the key cut (mm)',4.5,1,9,.1),F('keywayOffsetMm','Keyway to the bottom of the plug (mm)',1.5,0,6,.1),F('chamberDepthMm','Chamber depth above the shear line (mm)',10,5,25,.1),F('keyCutSpacingMm','Spacing between cuts (mm)',4.5,3,8,.1)], equation:'the bottom pin plus the key cut make up the plug diameter to the shear line', note:'The pin lengths a key cut calls for, worked from the plug diameter and where the cut sits. The bottom pin and the key cut have to add up to the plug diameter for the shear line to line up, which is why a pin kit is measured in half millimetres and why a worn key opens a lock it should not.', calculate: p => {
  const bottom = bottomPinMm(p.plugDiameterMm, p.cutDepthMm, p.keywayOffsetMm), driver = driverPinMm(p.chamberDepthMm, bottom);
  return O('Bottom pin', bottom, 'mm', [
    M('Driver pin', driver, 'mm'),
    M('Total stack', bottom + driver, 'mm'),
    M('Stack against the chamber', (bottom + driver) / Math.max(p.chamberDepthMm, .001) * 100, '%'),
    M('Bottom pin for a 6 mm cut', bottomPinMm(p.plugDiameterMm, 6, p.keywayOffsetMm), 'mm'),
    M('Bottom pin at a shallower 3 mm cut', bottomPinMm(p.plugDiameterMm, 3, p.keywayOffsetMm), 'mm'),
    M('Reading', bottom < 2 ? 'A very short bottom pin, check the cut is inside the range for this cylinder' : 'A pin length a standard kit will cover', '')]);
}, references: [T('A 12.7 mm plug with a 4.5 mm cut', {plugDiameterMm:12.7,cutDepthMm:4.5,keywayOffsetMm:1.5,chamberDepthMm:10,keyCutSpacingMm:4.5}, bottomPinMm(12.7,4.5,1.5)), T('A deeper 6.5 mm cut for the same plug', {plugDiameterMm:12.7,cutDepthMm:6.5,keywayOffsetMm:1.5,chamberDepthMm:10,keyCutSpacingMm:4.5}, bottomPinMm(12.7,6.5,1.5))] }),
D({ id: 'lock-macs-check', sweep: 'cut3', fields: [F('cut1','Cut 1 depth (mm)',5,1,10,.5),F('cut2','Cut 2 depth (mm)',1,1,10,.5),F('cut3','Cut 3 depth (mm)',7,1,10,.5),F('cut4','Cut 4 depth (mm)',3,1,10,.5),F('cut5','Cut 5 depth (mm)',1,1,10,.5),F('macs','Maximum adjacent cut step (mm)',4,2,8,.5)], equation:'a step of the maximum or more between neighbouring cuts is the weak point', note:'A check that a key bitting stays inside the maximum adjacent cut step, the limit that stops a key being bent into a neighbouring lock. A bitting that breaks the rule will still cut and still open its own lock, and it will also open the one next door when someone tries it.', calculate: p => {
  const cuts = [p.cut1, p.cut2, p.cut3, p.cut4, p.cut5], violations = macsViolations(cuts, p.macs), worst = largestStep(cuts);
  return O('Violations of the step limit', violations, '', [
    M('Largest step between cuts', worst, 'mm'),
    M('Adjacent pairs checked', cuts.length - 1, ''),
    M('Step limit', p.macs, 'mm'),
    M('Key range used', Math.max(p.cut1, p.cut2, p.cut3, p.cut4, p.cut5) - Math.min(p.cut1, p.cut2, p.cut3, p.cut4, p.cut5), 'mm'),
    M('Violations with the limit at 5 mm', macsViolations(cuts, 5), ''),
    M('Reading', violations > 0 ? 'This bitting breaks the step limit, change it before it is cut' : 'A bitting inside the step limit', '')]);
}, references: [T('A bitting of 5, 1, 7, 3 and 1 against a 4 mm limit', {cut1:5,cut2:1,cut3:7,cut4:3,cut5:1,macs:4}, macsViolations([5,1,7,3,1],4)), T('A gentler bitting of 5, 3, 5, 3 and 2', {cut1:5,cut2:3,cut3:5,cut4:3,cut5:2,macs:4}, macsViolations([5,3,5,3,2],4))] }),
D({ id: 'lock-keyspace', sweep: 'depths', fields: [F('cuts','Cuts in the key',5,3,10,1),F('depths','Depths available',6,3,12,1),F('positions','Positions the bitting may use',5,1,10,1),F('keysIssued','Keys in circulation',200,1,100000,1),F('lossRatePct','Keys lost a year (%)',3,.1,30,.1)], equation:'the space is the depths raised to the power of the cuts', note:'How large the key space of a system really is, which is the depths raised to the power of the cuts rather than multiplied. The check that matters is against the keys in circulation, because the chance of two matching by accident rises with the square of the number issued rather than with the number itself.', calculate: p => {
  const combinations = keyCombinations(p.depths, p.cuts), duplicates = duplicateAt50(combinations);
  return O('Key combinations', combinations, '', [
    M('Keys before a 50 % chance of a duplicate', duplicates, 'keys'),
    M('Keys in circulation', p.keysIssued, 'keys'),
    M('Combinations with five depths', keyCombinations(5, p.cuts), ''),
    M('Share of the space in use', p.keysIssued / Math.max(combinations, 1) * 100, '%'),
    M('Keys lost a year', p.keysIssued * p.lossRatePct / 100, 'keys'),
    M('Reading', p.keysIssued > duplicates ? 'More keys in circulation than the space supports, expect accidental duplication' : 'Enough combinations for the number of keys in use', '')]);
}, references: [T('Five cuts from six depths', {cuts:5,depths:6,positions:5,keysIssued:200,lossRatePct:3}, keyCombinations(6,5)), T('Six cuts from eight depths', {cuts:6,depths:8,positions:6,keysIssued:200,lossRatePct:3}, keyCombinations(8,6))] }),
D({ id: 'lock-master-keying', sweep: 'levels', fields: [F('levels','Levels in the hierarchy',3,2,6,1),F('cuts','Cuts in the key',5,3,10,1),F('depths','Depths available',6,3,12,1),F('cylindersPerLevel','Cylinders a level',20,1,1000,1),F('masterSharePct','Share that are master keys (%)',10,1,100,1)], equation:'each level below the top needs a master pin at every cut position it shares', note:'What a master key hierarchy costs in pins and what it takes out of the key space. Every level below the top needs master pins, and the wider the cuts the fewer combinations are left for the change keys, which is why a deep hierarchy and a large key space pull against each other.', calculate: p => {
  const pins = masterPins(p.levels, p.cuts), combinations = keyCombinations(p.depths, p.cuts), keys = p.levels * p.cylindersPerLevel + 1;
  return O('Master pins needed', pins, 'pins', [
    M('Keys in the hierarchy', keys, 'keys'),
    M('Master keys', Math.round(keys * p.masterSharePct / 100), 'keys'),
    M('Bitting combinations available', combinations, ''),
    M('Combinations for each level', combinations / Math.max(p.levels, 1), ''),
    M('Master pins for a four level system', masterPins(4, p.cuts), 'pins'),
    M('Reading', p.levels > 4 ? 'A deep hierarchy, the change keys will be fighting over the bitting space' : 'A hierarchy most systems carry comfortably', '')]);
}, references: [T('Three levels over five cut positions', {levels:3,cuts:5,depths:6,cylindersPerLevel:20,masterSharePct:10}, masterPins(3,5)), T('A four level hierarchy on the same cuts', {levels:4,cuts:5,depths:6,cylindersPerLevel:20,masterSharePct:10}, masterPins(4,5))] }),
D({ id: 'lock-driver-pin', sweep: 'cutDepthMm', fields: [F('plugDiameterMm','Plug diameter (mm)',12.7,8,30,.1),F('cutDepthMm','Key cut depth (mm)',4.5,1,9,.1),F('keywayOffsetMm','Keyway offset (mm)',1.5,0,6,.1),F('springFreeMm','Spring free length (mm)',8,3,20,.5),F('chamberDepthMm','Chamber depth (mm)',10,5,25,.1)], equation:'the driver pin fills the chamber above the bottom pin, with the spring on top', note:'Whether the pins and the spring will fit inside the chamber above the shear line, which is what a pinning chart is written from. A stack that is too tall will not let the plug turn, and one that is too short leaves the driver pin below the shear line and the lock openable with anything.', calculate: p => {
  const bottom = bottomPinMm(p.plugDiameterMm, p.cutDepthMm, p.keywayOffsetMm), driver = driverPinMm(p.chamberDepthMm, bottom);
  return O('Driver pin', driver, 'mm', [
    M('Bottom pin', bottom, 'mm'),
    M('Total stack', bottom + driver, 'mm'),
    M('Spring travel', p.springFreeMm - driver, 'mm'),
    M('Driver pin for a shallow 2 mm cut', driverPinMm(p.chamberDepthMm, bottomPinMm(p.plugDiameterMm, 2, p.keywayOffsetMm)), 'mm'),
    M('Driver pin for a deep 8 mm cut', driverPinMm(p.chamberDepthMm, bottomPinMm(p.plugDiameterMm, 8, p.keywayOffsetMm)), 'mm'),
    M('Reading', p.springFreeMm - driver < 2 ? 'Less than two millimetres of spring travel, the pins will bind' : 'Enough spring travel for the driver pins to sit clear', '')]);
}, references: [T('A 4.5 mm cut in a 12.7 mm plug', {plugDiameterMm:12.7,cutDepthMm:4.5,keywayOffsetMm:1.5,springFreeMm:8,chamberDepthMm:10}, driverPinMm(10, bottomPinMm(12.7,4.5,1.5))), T('A deeper 7 mm cut in the same plug', {plugDiameterMm:12.7,cutDepthMm:7,keywayOffsetMm:1.5,springFreeMm:8,chamberDepthMm:10}, driverPinMm(10, bottomPinMm(12.7,7,1.5)))] }),
D({ id: 'lock-rekey-time', sweep: 'cylinders', fields: [F('cylinders','Cylinders to rekey',24,1,500,1),F('minutesEach','Minutes a cylinder',8,2,40,.5),F('tripMinutes','Travel between doors (min)',30,0,300,5),F('hourlyRate','Labour rate ($ an h)',45,10,200,.5),F('materialsPerCylinder','Pins and parts a cylinder ($)',4,0,100,.5),F('markupPct','Markup on the work (%)',60,0,300,5)], equation:'time=cylinders×minutes each, plus the travelling between them', note:'What a rekey costs in labour and what it should be charged at, with the travelling between the doors counted. Travelling is a large share of a small job, so the price a cylinder barely moves when the visit is already being made for something else, and that is worth telling the client.', calculate: p => {
  const hours = (p.cylinders * p.minutesEach + p.tripMinutes) / 60, cost = hours * p.hourlyRate + p.cylinders * p.materialsPerCylinder;
  return O('Time on the job', hours, 'h', [
    M('Labour cost', hours * p.hourlyRate, '$'),
    M('Materials', p.cylinders * p.materialsPerCylinder, '$'),
    M('Cost a cylinder', cost / Math.max(p.cylinders, 1), '$'),
    M('Price to the client', cost * (1 + p.markupPct / 100), '$'),
    M('Time without the travelling', p.cylinders * p.minutesEach / 60, 'h'),
    M('Reading', p.tripMinutes / 60 / Math.max(hours, .001) > .2 ? 'Travelling is a fifth of the job, quote it separately' : 'A job where the work dominates the visit', '')]);
}, references: [T('Twenty-four cylinders at eight minutes each', {cylinders:24,minutesEach:8,tripMinutes:30,hourlyRate:45,materialsPerCylinder:4,markupPct:60}, (24 * 8 + 30) / 60), T('A larger fifty cylinder contract', {cylinders:50,minutesEach:8,tripMinutes:30,hourlyRate:45,materialsPerCylinder:4,markupPct:60}, (50 * 8 + 30) / 60)] }),
D({ id: 'lock-bolt-throw', sweep: 'boltLengthMm', fields: [F('boltLengthMm','Bolt length (mm)',25,10,80,.5),F('gapMm','Gap between door and frame (mm)',3,0,20,.5),F('strikeDepthMm','Depth of the strike (mm)',20,5,60,.5),F('doorThicknessMm','Door thickness (mm)',44,25,120,1)], equation:'engagement is what is left of the bolt once the gap is taken out', note:'How much of a bolt actually reaches into the strike, which is the security figure rather than the bolt length printed on the box. The gap between the door and the frame comes straight off it, and a bolt that engages by only a few millimetres can be sprung with a shim in seconds.', calculate: p => {
  const engagement = boltEngagementMm(p.boltLengthMm, p.gapMm, p.strikeDepthMm);
  return O('Bolt engagement', engagement, 'mm', [
    M('Bolt left outside the strike', Math.max(0, p.boltLengthMm - p.gapMm - p.strikeDepthMm), 'mm'),
    M('Share of the bolt engaged', engagement / Math.max(p.boltLengthMm, .001) * 100, '%'),
    M('Engagement with a 10 mm gap', boltEngagementMm(p.boltLengthMm, 10, p.strikeDepthMm), 'mm'),
    M('Engagement with a 40 mm strike', boltEngagementMm(p.boltLengthMm, p.gapMm, 40), 'mm'),
    M('Bolt length for a 20 mm engagement', 20 + p.gapMm + Math.min(p.strikeDepthMm, 60), 'mm'),
    M('Reading', engagement < 15 ? 'Less than fifteen millimetres engaged, this door can be sprung open' : 'An engagement that will resist a shim', '')]);
}, references: [T('A 25 mm bolt across a 3 mm gap into a 20 mm strike', {boltLengthMm:25,gapMm:3,strikeDepthMm:20,doorThicknessMm:44}, boltEngagementMm(25,3,20)), T('The same bolt with a 10 mm gap', {boltLengthMm:25,gapMm:10,strikeDepthMm:20,doorThicknessMm:44}, boltEngagementMm(25,10,20))] }),
D({ id: 'lock-closer-force', sweep: 'closerForceN', fields: [F('closerForceN','Force the closer adds (N)',15,5,150,1),F('doorWidthMm','Door width (mm)',900,600,1500,10),F('doorMassKg','Door leaf mass (kg)',25,10,200,1),F('maxForceN','Force allowed (N)',22,5,60,.5)], equation:'opening force=the closer, widened by the door, plus the friction of the leaf', note:'The force needed to open a door, which is set by the closer and by how heavy and wide the leaf is. Accessibility limits put a ceiling on this force, and a closer turned up to make a fire door latch reliably is the usual reason a building fails that check.', calculate: p => {
  const force = openingForceN(p.closerForceN, p.doorWidthMm, p.doorMassKg);
  return O('Opening force', force, 'N', [
    M('Closer contribution', p.closerForceN * (1 + Math.max(0, p.doorWidthMm - 900) / 2000), 'N'),
    M('Friction of the leaf', p.doorMassKg * 9.81 * .03, 'N'),
    M('Against the limit', force / Math.max(p.maxForceN, .001) * 100, '%'),
    M('Force at a 1 200 mm door', openingForceN(p.closerForceN, 1200, p.doorMassKg), 'N'),
    M('Closer force that would meet the limit', Math.max(0, (p.maxForceN - p.doorMassKg * 9.81 * .03) / (1 + Math.max(0, p.doorWidthMm - 900) / 2000)), 'N'),
    M('Reading', force > p.maxForceN ? 'Over the force allowed, adjust the closer and check the latch still holds' : 'Inside the force allowed for an accessible door', '')]);
}, references: [T('A 25 kg leaf 900 mm wide with a 15 N closer', {closerForceN:15,doorWidthMm:900,doorMassKg:25,maxForceN:22}, openingForceN(15,900,25)), T('A heavier 40 kg leaf on the same closer', {closerForceN:15,doorWidthMm:900,doorMassKg:40,maxForceN:22}, openingForceN(15,900,40))] }),
D({ id: 'lock-panic-load', sweep: 'occupants', fields: [F('occupants','People to clear',250,1,5000,1),F('doorWidthMm','Clear width of the exit (mm)',1000,600,2000,10),F('exitRatePerMetreMin','Throughput a metre a minute',60,10,300,5),F('targetMinutes','Time to clear (min)',5,.5,30,.5),F('leafMassKg','Mass of the leaf (kg)',60,5,300,1)], equation:'clearance time=people÷(the rate a metre×the width), with exits added for the target', note:'How long a room takes to empty through its exits and how many exits the target time needs. The rate is quoted a metre of clear width rather than a door, which is what makes a pair of narrow doors worse than one wide one, and the leaf mass is what decides whether a panic bar is needed rather than a handle.', calculate: p => {
  const minutes = egressMinutes(p.occupants, p.exitRatePerMetreMin, p.doorWidthMm), rate = p.exitRatePerMetreMin * p.doorWidthMm / 1000;
  return O('Clearance time', minutes, 'min', [
    M('Throughput a minute', rate, 'people'),
    M('Exits for the target time', Math.ceil(p.occupants / Math.max(rate * p.targetMinutes, .01)), 'exits'),
    M('Push force to open the leaf', p.leafMassKg * 9.81 * .1, 'N'),
    M('Clearance with a 1 200 mm exit', egressMinutes(p.occupants, p.exitRatePerMetreMin, 1200), 'min'),
    M('Clearance with a 10 % higher rate', egressMinutes(p.occupants, p.exitRatePerMetreMin * 1.1, p.doorWidthMm), 'min'),
    M('Reading', minutes > p.targetMinutes ? 'Slower than the target, add width or an exit rather than relying on the crowd' : 'Clears inside the target time', '')]);
}, references: [T('Two hundred and fifty people through a metre wide exit', {occupants:250,doorWidthMm:1000,exitRatePerMetreMin:60,targetMinutes:5,leafMassKg:60}, egressMinutes(250,60,1000)), T('Five hundred people through the same exit', {occupants:500,doorWidthMm:1000,exitRatePerMetreMin:60,targetMinutes:5,leafMassKg:60}, egressMinutes(500,60,1000))] }),
D({ id: 'lock-safe-combination', sweep: 'wheels', fields: [F('dialNumbers','Numbers on the dial',100,20,200,5),F('wheels','Wheels in the combination',3,2,5,1),F('secondsPerTry','Seconds a try',8,2,60,.5),F('hoursADay','Hours of trying a day',8,.5,24,.5)], equation:'the count is the numbers raised to the power of the wheels', note:'How many combinations a dial safe has and how long that would take to work through by hand. Adding one wheel multiplies the work by the number of numbers, which is the whole point of a combination lock, and it is why the number of wheels matters far more than the size of the dial.', calculate: p => {
  const combinations = safeCombinations(p.dialNumbers, p.wheels), seconds = combinations * p.secondsPerTry;
  const full = safeCombinations(p.dialNumbers, p.wheels + 1) * p.secondsPerTry;
  return O('Combinations', combinations, '', [
    M('Time to try them all', seconds / 86400, 'days'),
    M('Time in years at this rate', seconds / 86400 / 365 / Math.max(p.hoursADay / 24, .01), 'years'),
    M('Days at a faster two seconds a try', combinations * 2 / 86400, 'days'),
    M('Combinations with one more wheel', safeCombinations(p.dialNumbers, p.wheels + 1), ''),
    M('Years with one more wheel', full / 86400 / 365 / Math.max(p.hoursADay / 24, .01), 'years'),
    M('Reading', combinations < 1000000 ? 'A small combination space, this safe is a delay rather than a barrier' : 'A combination space that resists a hand attack', '')]);
}, references: [T('Three wheels on a hundred number dial', {dialNumbers:100,wheels:3,secondsPerTry:8,hoursADay:8}, safeCombinations(100,3)), T('Four wheels on the same dial', {dialNumbers:100,wheels:4,secondsPerTry:8,hoursADay:8}, safeCombinations(100,4))] }),
D({ id: 'lock-key-duplication', sweep: 'keys', fields: [F('keys','Keys to cut',200,1,5000,1),F('machineSecondsPerKey','Seconds a key on the machine',40,10,300,5),F('blankCostEach','Cost a blank ($)',1.2,.1,20,.1),F('keysPerBlankBox','Keys in a blank box',50,10,1000,10),F('hourlyRate','Labour cost an hour ($)',45,10,200,.5),F('markupPct','Markup (%)',80,0,400,5)], equation:'cost a key=the blank+the machine time at the labour rate', note:'What a key costs to cut and what it should sell for, with the machine time costed at the labour rate rather than left out. A duplicate looks like a margin on the price of a blank and is really a small manufacturing job, and a worn original key is the reason a cut copy often does not work.', calculate: p => {
  const cost = keyCost(p.blankCostEach, p.machineSecondsPerKey, p.hourlyRate), boxes = Math.ceil(p.keys / Math.max(p.keysPerBlankBox, 1));
  return O('Cost a key', cost, '$', [
    M('Price at this markup', cost * (1 + p.markupPct / 100), '$'),
    M('Blanks needed', p.keys, 'blanks'),
    M('Boxes to order', boxes, 'boxes'),
    M('Machine hours', p.keys * p.machineSecondsPerKey / 3600, 'h'),
    M('Cost of the order', cost * p.keys, '$'),
    M('Reading', cost > 3 ? 'The machine time dominates the cost, price the labour not the blank' : 'A cheap cut where the blank is most of the cost', '')]);
}, references: [T('Two hundred keys at forty seconds each', {keys:200,machineSecondsPerKey:40,blankCostEach:1.2,keysPerBlankBox:50,hourlyRate:45,markupPct:80}, keyCost(1.2,40,45)), T('A larger five hundred key order', {keys:500,machineSecondsPerKey:40,blankCostEach:1.2,keysPerBlankBox:50,hourlyRate:45,markupPct:80}, keyCost(1.2,40,45))] }),
D({ id: 'lock-master-exposure', sweep: 'keysIssued', fields: [F('keysIssued','Keys issued',400,1,100000,1),F('masterSharePct','Share that are master keys (%)',10,1,100,1),F('lossRatePctPerYear','Keys lost a year (%)',3,.1,30,.1),F('yearsHeld','Years the system has been in use',3,1,50,1)], equation:'expected losses are the master keys in use × the loss rate × the years', note:'The exposure a master key system builds up over the years, which is the risk nobody notices until a lost master key turns up. Master keys are few and open everything, so their losses are worth counting separately from the change keys, and a system in use for years has usually lost some.', calculate: p => {
  const masters = p.keysIssued * p.masterSharePct / 100, lost = exposureKeys(p.keysIssued, p.masterSharePct, p.lossRatePctPerYear, p.yearsHeld);
  return O('Master keys expected lost', lost, 'keys', [
    M('Master keys in use', masters, 'keys'),
    M('Keys lost a year, all types', p.keysIssued * p.lossRatePctPerYear / 100, 'keys'),
    M('Years before a master is lost each year', 1 / Math.max(masters * p.lossRatePctPerYear / 100, 1e-9), 'years'),
    M('Losses after ten years', exposureKeys(p.keysIssued, p.masterSharePct, p.lossRatePctPerYear, 10), 'keys'),
    M('Losses with twice the master share', exposureKeys(p.keysIssued, p.masterSharePct * 2, p.lossRatePctPerYear, p.yearsHeld), 'keys'),
    M('Reading', lost >= 1 ? 'At least one master key is out there, plan a rekey or move to a restricted system' : 'No master key losses expected yet, keep the issue record straight', '')]);
}, references: [T('Four hundred keys with ten per cent masters over three years', {keysIssued:400,masterSharePct:10,lossRatePctPerYear:3,yearsHeld:3}, exposureKeys(400,10,3,3)), T('The same system after ten years', {keysIssued:400,masterSharePct:10,lossRatePctPerYear:3,yearsHeld:10}, exposureKeys(400,10,3,10))] }),
D({ id: 'lock-cctv-storage', sweep: 'days', fields: [F('cameras','Cameras',16,1,200,1),F('bitrateMbps','Bitrate a camera (Mbps)',4,.5,25,.5),F('days','Days of retention',30,1,365,1),F('resolutionMp','Resolution (MP)',4,1,12,.5),F('fps','Frames a second',15,1,60,1),F('recorderTb','Recorder drives (TB)',24,1,400,1)], equation:'storage=cameras×bitrate×seconds÷eight, in terabytes', note:'The storage a camera system needs for its retention period, which is set by the bitrate rather than by the resolution on the box. Retention is usually a regulatory requirement rather than a choice, and the honest check is whether the drives fitted actually cover the days the site claims to keep.', calculate: p => {
  const tb = storageTb(p.cameras, p.bitrateMbps, p.days);
  return O('Storage needed', tb, 'TB', [
    M('Bandwidth', p.cameras * p.bitrateMbps, 'Mbps'),
    M('Drives needed at 8 TB each', Math.ceil(tb / 8), 'drives'),
    M('Days the drives fitted give', p.recorderTb / Math.max(storageTb(p.cameras, p.bitrateMbps, 1), 1e-9), 'days'),
    M('Storage at double the bitrate', storageTb(p.cameras, p.bitrateMbps * 2, p.days), 'TB'),
    M('Storage for a hundred and eighty days', storageTb(p.cameras, p.bitrateMbps, 180), 'TB'),
    M('Reading', p.recorderTb < tb ? 'The recorders fitted cannot hold the retention claimed' : 'The drives cover the retention period', '')]);
}, references: [T('Sixteen cameras at four megabits for thirty days', {cameras:16,bitrateMbps:4,days:30,resolutionMp:4,fps:15,recorderTb:24}, storageTb(16,4,30)), T('The same system with a sixty day retention', {cameras:16,bitrateMbps:4,days:60,resolutionMp:4,fps:15,recorderTb:24}, storageTb(16,4,60))] }),
D({ id: 'lock-access-throughput', sweep: 'users', fields: [F('users','People using the building',250,1,10000,1),F('doors','Doors',4,1,200,1),F('secondsPerEntry','Seconds a person at the reader',3,.5,20,.5),F('peakSharePct','Share arriving in the peak (%)',30,1,100,1),F('peakMinutes','Minutes in the peak',15,2,120,1)], equation:'the peak arrival rate is compared with what the readers can pass', note:'Whether the readers, doors and credentials can pass a building peak arrival rate, which is where access control fails in practice rather than in the security review. The peak is what matters, and it is usually far shorter and sharper than the spread of arrival times across the morning.', calculate: p => {
  const peak = entriesPerMinute(p.users, p.peakSharePct, p.peakMinutes), capacity = 60 / Math.max(p.secondsPerEntry, .001);
  return O('Arrivals a minute at the peak', peak, 'people', [
    M('Capacity a door a minute', capacity, 'people'),
    M('Doors needed at the peak', Math.ceil(peak / Math.max(capacity, 1)), 'doors'),
    M('Spare capacity with these doors', p.doors * capacity - peak, 'people a minute'),
    M('Arrivals at a sharper five minute peak', entriesPerMinute(p.users, p.peakSharePct, 5), 'people'),
    M('Credentials to issue', Math.ceil(p.users * 1.2), 'credentials'),
    M('Reading', peak > p.doors * capacity ? 'There will be a queue at the peak, add a door or shorten the read time' : 'The doors pass the peak with capacity to spare', '')]);
}, references: [T('Two hundred and fifty people over four doors', {users:250,doors:4,secondsPerEntry:3,peakSharePct:30,peakMinutes:15}, entriesPerMinute(250,30,15)), T('A larger building of a thousand people', {users:1000,doors:4,secondsPerEntry:3,peakSharePct:30,peakMinutes:15}, entriesPerMinute(1000,30,15))] }),
D({ id: 'lock-security-grade', sweep: 'lockGrade', fields: [F('doorGrade','Door construction (1 to 5)',3,1,5,1),F('frameGrade','Frame and fixing (1 to 5)',3,1,5,1),F('lockGrade','Lock and cylinder (1 to 5)',3,1,5,1),F('glassScore','Glazing (0 to 5)',2,0,5,1),F('lightingScore','Lighting and visibility (0 to 5)',2,0,5,1),F('targetScore','Score you are working to',70,20,100,5)], equation:'the structure carries most of the score, with the surroundings making up the rest', note:'A rough security score for an entrance, weighted towards the door, the frame and the lock because that is where an attack goes. The useful output is the weakest link rather than the total, since an attack takes the easy route and ignores everything else.', calculate: p => {
  const score = securityScore(p.doorGrade, p.frameGrade, p.lockGrade, p.glassScore, p.lightingScore);
  const link = Math.min(p.doorGrade, p.frameGrade, p.lockGrade, p.glassScore + 1, p.lightingScore + 1);
  const weakest = link === p.doorGrade ? 'Door construction' : link === p.frameGrade ? 'Frame and fixing' : link === p.lockGrade ? 'Lock and cylinder' : link === p.glassScore + 1 ? 'Glazing' : 'Lighting and visibility';
  return O('Security score', score, 'out of 100', [
    M('Against the target', score - p.targetScore, 'points'),
    M('Weakest link', weakest, ''),
    M('Score with the lock upgraded', securityScore(p.doorGrade, p.frameGrade, 5, p.glassScore, p.lightingScore), 'out of 100'),
    M('Score with the glazing improved', securityScore(p.doorGrade, p.frameGrade, p.lockGrade, 4, p.lightingScore), 'out of 100'),
    M('Structure share of the score', (p.doorGrade + p.frameGrade + p.lockGrade) / 15 * 70, 'points'),
    M('Reading', score < p.targetScore ? 'Below the score you are working to, fix the weakest link first' : 'At or above the score you are working to', '')]);
}, references: [T('A mid grade door, frame and lock with average glazing', {doorGrade:3,frameGrade:3,lockGrade:3,glassScore:2,lightingScore:2,targetScore:70}, securityScore(3,3,3,2,2)), T('A high security door and lock on a dark entrance', {doorGrade:5,frameGrade:5,lockGrade:5,glassScore:1,lightingScore:0,targetScore:70}, securityScore(5,5,5,1,0))] })
];